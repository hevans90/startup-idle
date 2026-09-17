/**
 * PASS 4 on the device — the twin of `columns.ts`'s `applyDepths`.
 *
 * The per-cell half is the easiest yet: a depth moves by its own delta, a rate
 * falls out of that delta, and a material is taken from whatever filled the
 * cell. Nothing is shared, nothing is ordered.
 *
 * THE OTHER HALF IS A REDUCTION, and it is the first thing in this port that
 * genuinely needs atomics. Three numbers have to be agreed by every thread at
 * once:
 *
 *  - the DEEPEST column, which sizes the next substep;
 *  - the ACTIVE BOX, which every other pass is bounded by;
 *  - whether anything is BREAKING, which decides if the diffusion runs at all.
 *
 * All three are combined with operations that do not care what order they
 * arrive in — max, min, or — so the answer is exact and reproducible however
 * the device schedules its threads. That is the whole reason to reduce with
 * min and max rather than with a sum: `atomicAdd` on floats does not exist in
 * WGSL, and even where it does, float addition does not associate and the
 * answer would depend on the scheduling.
 *
 * DEEPEST IS A FLOAT IN AN INTEGER ATOMIC. Every depth here is non-negative —
 * the line above clamps it — and for non-negative IEEE floats the bit pattern
 * orders the same way the value does. So the bits go through `atomicMax` and
 * come back a float. For anything that could be negative this would be wrong,
 * and the clamp is what makes it safe.
 *
 * A BOX THAT NOTHING IS IN. The CPU starts it inside out — x0 at nx, x1 at
 * minus one — so that a map with no wet cell leaves it that way and `activeBox`
 * reads it as empty. The atomics are seeded the same, and for the same reason.
 */
import { BREAK_START, BREAK_STOP, PERSIST, VERTICAL } from "../columns";
import {
  CLAMP_SCALE, CLAMP_SLOT, DELTA_SCALE, DELTA_SLOT, REDUCE_SLOTS,
  AIR_SLOT, DEPTH_SLOT, WATER_SCALE, WET_SLOT,
  STATE_WGSL, beginPass, bindState, stateLayout, type GpuState,
} from "./state";
import type { Box } from "./accelerate";

const WORKGROUP = 8;

/**
 * A number as a WGSL FLOAT literal.
 *
 * `PERSIST` is 5 and interpolates as "5", which WGSL reads as an i32 and then
 * refuses to multiply by an f32. Every constant crossing into a shader goes
 * through here so that none of them has to be remembered individually.
 */
const f = (v: number) => (Number.isInteger(v) ? `${v}.0` : String(v));

const APPLY_WGSL = `
${STATE_WGSL}

// NO BACKTICKS IN HERE — see the note at the top of the shared header.

/**
 * How hard this cell is breaking, from the rate its surface just moved at.
 *
 * The twin of columns.ts's stepBreaking. A wave qualifies above a bar set by
 * its own wave speed, the bar drops once it HAS qualified so a breaker does not
 * flicker in and out, and what comes out ramps in over the first half of the
 * way past the bar rather than arriving at full strength.
 */
fn stepBreaking(i: i32, d: f32) {
  let wave = sqrt(gravity() * d);
  let age = breakAgeAt(i);
  var bar = ${f(BREAK_START)} * wave;
  if (age >= 0.0) {
    let over = ${f(PERSIST)} * (d * ${f(VERTICAL)}) / wave;
    let t = select(1.0, min(1.0, age / over), over > 0.0);
    bar = (${f(BREAK_START)} + (${f(BREAK_STOP)} - ${f(BREAK_START)}) * t) * wave;
  }
  if (rateAt(i) < bar) {
    setBreakAge(i, -1.0);
    setBroke(i, 0.0);
    return;
  }
  setBreakAge(i, select(age + dt(), 0.0, age < 0.0));
  let b = min(1.0, (rateAt(i) / bar - 1.0) * 2.0);
  let broke = select(0.0, b, b > 0.0);
  setBroke(i, broke);
  // Left as a per-cell atomic: it is a MAX to one, so the hardware can drop
  // every write after the first, and it only fires where something is
  // actually breaking rather than on every cell of the map.
  if (broke > 0.0) { atomicMax(&reduce[5], 1); }
}

/**
 * ONE WORKGROUP'S SHARE OF THE RUNNING TOTALS, so that sixty five thousand
 * threads do not queue up on six addresses.
 *
 * Every one of the reductions below is an atomic on a SINGLE slot, and an
 * atomic on a single slot is a queue: the hardware serialises them, so the
 * cost goes as the number of threads and not as the work. Timed, on a flooded
 * map, this pass was FIVE MILLISECONDS — seven times the whole of the rest of
 * the solver — and the arithmetic in it is trivial. Combined in workgroup
 * memory first and handed up by one thread in sixty four, it is one atomic per
 * workgroup instead of one per cell.
 *
 * The box's min and max are here for the same reason and were there before:
 * four more per wet cell, which is what made the pass expensive in the first
 * place rather than anything the counting added.
 */
var<workgroup> partDelta: array<f32, ${WORKGROUP * WORKGROUP}>;
var<workgroup> partClamp: array<f32, ${WORKGROUP * WORKGROUP}>;
var<workgroup> partDeep: array<f32, ${WORKGROUP * WORKGROUP}>;
var<workgroup> partX0: array<i32, ${WORKGROUP * WORKGROUP}>;
var<workgroup> partY0: array<i32, ${WORKGROUP * WORKGROUP}>;
var<workgroup> partX1: array<i32, ${WORKGROUP * WORKGROUP}>;
var<workgroup> partY1: array<i32, ${WORKGROUP * WORKGROUP}>;

@compute @workgroup_size(${WORKGROUP}, ${WORKGROUP})
fn main(
  @builtin(global_invocation_id) gid: vec3<u32>,
  @builtin(local_invocation_index) li: u32,
) {
  let x = consts.box.x + i32(gid.x);
  let y = consts.box.y + i32(gid.y);
  // NOT AN EARLY RETURN ANY MORE. There is a workgroup barrier below and a
  // barrier reached by only some of a workgroup's threads is undefined
  // behaviour, not a slow path — so the threads outside the region stay, do
  // nothing, and contribute an identity to the reduction.
  let inside = x <= consts.box.z && y <= consts.box.w;
  // The identities: nothing to add, nothing to clamp, no depth, and a box
  // that is inside out. @see reduceSeed
  partDelta[li] = 0.0;
  partClamp[li] = 0.0;
  partDeep[li] = 0.0;
  partX0[li] = nx();
  partY0[li] = ny();
  partX1[li] = -1;
  partY1[li] = -1;
  if (inside) { cell(x, y, li); }
  workgroupBarrier();
  if (li == 0u) { handUp(); }
}

/** One workgroup's totals, combined and sent up. @see partDelta */
fn handUp() {
  var dSum = 0.0;
  var cSum = 0.0;
  var deep = 0.0;
  var x0 = nx();
  var y0 = ny();
  var x1 = -1;
  var y1 = -1;
  for (var k = 0u; k < ${WORKGROUP * WORKGROUP}u; k = k + 1u) {
    dSum = dSum + partDelta[k];
    cSum = cSum + partClamp[k];
    deep = max(deep, partDeep[k]);
    x0 = min(x0, partX0[k]);
    y0 = min(y0, partY0[k]);
    x1 = max(x1, partX1[k]);
    y1 = max(y1, partY1[k]);
  }
  atomicAdd(&reduce[${DELTA_SLOT}], i32(dSum * ${f(DELTA_SCALE)}));
  if (cSum > 0.0) {
    atomicAdd(&reduce[${CLAMP_SLOT}], i32(cSum * ${f(CLAMP_SCALE)}));
  }
  atomicMax(&reduce[4], bitcast<i32>(deep));
  if (x1 >= 0) {
    atomicMin(&reduce[0], x0);
    atomicMin(&reduce[1], y0);
    atomicMax(&reduce[2], x1);
    atomicMax(&reduce[3], y1);
  }
}

fn cell(x: i32, y: i32, li: u32) {
  let i = y * nx() + x;

  let wasDry = depthAt(i) <= dryDepth();
  // The limiter guarantees this is already non-negative; the max only guards
  // against a rounding residue leaving a tiny negative behind. It is also what
  // makes the atomicMax on the bits below safe.
  // AND IT COUNTS WHAT IT EATS, because if that guarantee fails the water goes
  // without a word. @see CLAMP_SLOT
  // EVERY DELTA, ADDED UP, because the divergence's conservation is a claim
  // about telescoping and this is what holds it to account. @see DELTA_SLOT
  partDelta[li] = deltaAt(i);
  let raw = depthAt(i) + deltaAt(i);
  if (raw < 0.0) { partClamp[li] = -raw; }
  let d = max(0.0, raw);
  setDepth(i, d);
  partDeep[li] = d;
  setRate(i, abs(deltaAt(i)) / dt());

  if (d > dryDepth() && breakingOn() > 0.0 && !openEdgeRim(i)) {
    stepBreaking(i, d);
  } else {
    setBreakAge(i, -1.0);
    setBroke(i, 0.0);
  }

  var inBox = true;
  if (d <= 0.0) {
    setMaterial(i, 0.0);
    // A COLUMN WITH WATER IN THE AIR off one of its edges stays in the box even
    // when nothing is standing on it. Dropped out, the fall stops being stepped
    // and whatever is falling hangs there for ever.
    inBox = airAt(i * 2) > 0.0 || airAt(i * 2 + 1) > 0.0;
  } else if (wasDry && bestMatAt(i) != 0.0) {
    setMaterial(i, bestMatAt(i));
  }

  if (inBox) {
    partX0[li] = x;
    partY0[li] = y;
    partX1[li] = x;
    partY1[li] = y;
  }
}
`;

export type ApplyPass = {
  encode: (enc: GPUCommandEncoder, s: GpuState, box: Box) => void;
  layout: GPUBindGroupLayout;
};

/**
 * What the reduction starts at: a box that is inside out, no depth, nothing
 * breaking, and no drops asked for. @see GpuState.reduce
 */
export const reduceSeed = (nx: number, ny: number) => {
  const out = new Int32Array(REDUCE_SLOTS);
  out[0] = nx; out[1] = ny; out[2] = -1; out[3] = -1;
  return out;
};

/** The reduction read back as the numbers it stands for. */
export const readReduce = (raw: Int32Array) => ({
  x0: raw[0], y0: raw[1], x1: raw[2], y1: raw[3],
  deepest: new Float32Array(new Int32Array([raw[4]]).buffer)[0],
  breaking: raw[5] !== 0,
  /** How many drops the spray CLAIMED — which can exceed what it got. */
  spawned: raw[6],
  /** How many edges the cliff pass found. @see createCliffs */
  cliffN: raw[7],
  /** Water the clamp ate, which should be nought. @see CLAMP_SLOT */
  clamped: raw[CLAMP_SLOT] / CLAMP_SCALE,
  /** Every delta summed, which should also be nought. @see DELTA_SLOT */
  deltaSum: raw[DELTA_SLOT] / DELTA_SCALE,
  /** Tiles whose mean depth is over the dry depth. @see WET_SLOT */
  wet: raw[WET_SLOT],
  /**
   * What the COLUMNS hold, summed on the device. @see DEPTH_SLOT
   *
   * The leak alarm's number: this alone is what the device's own passes are
   * responsible for, and on a closed map with nothing pouring it is a
   * constant. @see GpuFrame.deviceWater
   */
  depth: raw[DEPTH_SLOT] / WATER_SCALE,
  /** And what is still in the air off a lip. @see AIR_SLOT */
  air: raw[AIR_SLOT] / WATER_SCALE,
  /** The two together, which is what the readout puts on the screen. */
  water: (raw[DEPTH_SLOT] + raw[AIR_SLOT]) / WATER_SCALE,
});

export function createApply(device: GPUDevice): ApplyPass {
  const layout = stateLayout(device);
  const pipeline = device.createComputePipeline({
    label: "apply",
    layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }),
    compute: {
      module: device.createShaderModule({ code: APPLY_WGSL, label: "apply" }),
      entryPoint: "main",
    },
  });
  return {
    layout,
    encode: (enc, s, box) => {
      const pass = beginPass(enc, s, "apply");
      pass.setPipeline(pipeline);
      bindState(pass, s, layout);
      pass.dispatchWorkgroups(
        Math.ceil((box.x1 - box.x0 + 1) / WORKGROUP),
        Math.ceil((box.y1 - box.y0 + 1) / WORKGROUP),
      );
      pass.end();
    },
  };
}

export const applySource = () => APPLY_WGSL;
