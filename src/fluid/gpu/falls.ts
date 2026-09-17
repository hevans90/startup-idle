/**
 * PASS 5 on the device — the twin of `falls.ts`'s `stepFalls`, and the last.
 *
 * THE ONLY TRUE SCATTER IN THE SOLVER. The four passes before it looked like
 * scatters and turned out to be gathers in disguise: an edge scaled only by
 * the cell it flows out of, a delta touched only by its own incident edges. Not
 * this one. A fall lands where its TRAJECTORY puts it — `landsAt` throws the
 * sheet forward by the lip's own speed — so two lips can land in one cell, and
 * no rearrangement makes that a gather, because the cell cannot know which
 * lips are aimed at it without searching for them.
 *
 * So: FIXED POINT AND INTEGER ATOMICS, which is the whole reason the plan asks
 * for them. WGSL has no float `atomicAdd`, and that is just as well — float
 * addition does not associate, so a float scatter would answer differently
 * depending on how the device happened to schedule its threads, and the
 * comparison against the CPU would be unrepeatable. Integer addition
 * associates exactly. The answer is the answer.
 *
 * EVERYTHING ELSE HERE IS PER EDGE. The state machine, the spray's bite out of
 * the sheet, the drowned-cliff drain — all of them read and write one edge's
 * own numbers. They need no atomic and get none.
 *
 * THE SPRAY IS POSTED, NOT MADE. A drop leaving a breaking sheet is two
 * things: water out of the sheet, which is this pass's business, and a parcel
 * in the drip list, which is not — the list is a packed array with a coalesce
 * rule and a per-drop integrator, and none of that wants to be a scatter. So
 * the shader works out everything that depends on state living HERE (how much,
 * how far down the sheet, the scatter, the lip's speed) and appends it to an
 * outbox; `drainSpawns` turns each request into a drop on the host, through
 * the same `dropFrom` the CPU path uses. The arc is written once.
 *
 * The outbox is claimed with an `atomicAdd`, which is the second scatter in
 * this pass and the only other one in the solver.
 *
 * TWO KINDS OF DROP GO THROUGH IT, and the second was not obvious. A breaking
 * sheet sheds drops out of its own mass on the way down — that one is written
 * all over `shedSpray`. A sheet HITTING WATER throws a crown back up off the
 * impact, and that one is buried in `plungeInto` and comes out of the landing
 * rather than the air. Missing it left the sheet's own water agreeing to the
 * last bit while the pool was over by 0.66 across 41 cells, which is exactly
 * what a waterfall with no plume looks like.
 */
import {
  BREAK, CLING, DROWN, FALL_GRAVITY, FALL_MIN, SHED, dropFrom,
} from "../falls";
import {
  CROWN_SPEED, IMPACT_REF, PLUNGE_ROOM, PLUNGE_SPRAY, PLUNGE_WHITE,
  type ColumnField,
} from "../columns";
import { DROP, crown } from "../drips";
import {
  SPAWN_CROWN, SPAWN_MAX, SPAWN_SHED, SPAWN_STRIDE, STATE_WGSL, beginPass,
  bindState, stateLayout, type GpuState,
} from "./state";

const WORKGROUP = 64;

const f = (v: number) => (Number.isInteger(v) ? `${v}.0` : String(v));

/**
 * What a fixed-point unit is worth, in half steps.
 *
 * A landing is a fraction of a half step and an impulse is that times a speed
 * of tens, so a million to the unit leaves both far inside an `i32`: the
 * largest impulse seen on a cascade is about one, which is 2^20 against a
 * ceiling of 2^31, so two thousand lips could land in one cell before it
 * mattered. The resolution is 1e-6 of a half step, which is finer than the
 * f32 the CPU keeps its depths in.
 */
export const LAND_SCALE = 1 << 20;

/** Where in `acc` each region starts, in cells. @see GpuState.acc */
export const ACC = { landing: 0, impulse: 1, mat: 2, splash: 3 } as const;

const FALLS_WGSL = `
${STATE_WGSL}

// NO BACKTICKS IN HERE — see the note at the top of the shared header.

const LAND_SCALE: f32 = ${f(LAND_SCALE)};

fn accAt(region: i32, i: i32) -> i32 { return region * (nx() * ny()) + i; }

/**
 * Bank a landing: the water, its momentum, and what it is made of.
 *
 * Three atomics and a packed fourth. The material is an ARGMAX — the biggest
 * arrival decides what a cell that fills this step is made of — and an argmax
 * needs the value and its payload to move together. They are packed into one
 * integer, the quantised amount above and the material in the low four bits,
 * so a single atomicMax carries both. A material index is 0 to 15 and fits.
 */
fn bankLanding(to: i32, amount: f32, material: u32, speed: f32) {
  // AND THE CELL JOINS THE ACTIVE BOX, which is what the CPU include does at
  // exactly this moment and the device had no answer to. A lip throws its
  // water where its trajectory puts it, which can be a dry column outside the
  // box entirely; left out, the box is a column short of the CPU's from the
  // very first frame, and short in a way that RATCHETS — the front is clipped,
  // so no water arrives beyond it, so the box never grows to reach it. It cost
  // a whole column of water by frame thirty and a fiftieth of a percent of the
  // map's volume with it.
  atomicMin(&reduce[0], to % nx());
  atomicMin(&reduce[1], to / nx());
  atomicMax(&reduce[2], to % nx());
  atomicMax(&reduce[3], to / nx());
  atomicAdd(&acc[accAt(${ACC.landing}, to)], i32(amount * LAND_SCALE));
  atomicAdd(&acc[accAt(${ACC.impulse}, to)], i32(amount * speed * LAND_SCALE));
  if (material != 0u) {
    let packed = (i32(amount * LAND_SCALE) << 4) | i32(material & 15u);
    atomicMax(&acc[accAt(${ACC.mat}, to)], packed);
  }
}

/** Where a neighbour's water, or failing that its ground, stands. */
fn besideAt2(j: i32) -> f32 {
  let dj = depthAt(j);
  return select(groundAt(j), groundAt(j) + dj, dj > dryDepth());
}

/** How far a sheet has drifted after falling this far. @see driftAt */
fn driftAt(v: f32, below: f32) -> f32 {
  return v * sqrt(2.0 * max(below, 0.0) / ${f(FALL_GRAVITY)});
}

/**
 * Where the SHEET gets to, which is not the column over the edge.
 *
 * The lip's smoothed throw carries it forward as it falls. Only onto ground
 * LOWER than the lip — thrown at a wall it lands at the foot of the wall.
 */
fn landsAt(i: i32, j: i32, drop: f32) -> i32 {
  let ox = i32(round(driftAt(throwXAt(i), drop) / cellSize()));
  let oy = i32(round(driftAt(throwYAt(i), drop) / cellSize()));
  if (ox == 0 && oy == 0) { return j; }
  let jx = (j % nx()) + ox;
  let jy = (j / nx()) + oy;
  if (jx < 0 || jy < 0 || jx >= nx() || jy >= ny()) { return j; }
  let to = jy * nx() + jx;
  return select(j, to, groundAt(to) < groundAt(i));
}

/** Take a share of what is in the air on this edge, and bank it. */
fn land(k: i32, to: i32, src: i32, share: f32, drop: f32) {
  let air = airAt(k);
  if (air <= 0.0) { return; }
  let amount = air * share;
  setAir(k, air - amount);
  // A column takes the arriving material only if it had none: the rule
  // otherwise is whatever arrived last, which lets a trickle recolour a lake.
  let mat = select(0u, materialAt(src), depthAt(to) <= dryDepth());
  if (drop > 0.0) {
    let speed = sqrt(2.0 * ${f(FALL_GRAVITY)} * drop);
    // NOT ALL OF IT JOINS THE POOL. A sheet coming in hard throws a plume
    // straight back up, and that is the loudest thing about a waterfall. It
    // comes out of the LANDING rather than out of the air, which is why the
    // sheet's own water can match to the last bit while the pool is wrong —
    // 0.66 of it across 41 cells, which is what a missing plume looks like.
    var spray = 0.0;
    if (speed > ${f(CROWN_SPEED)} && roomNow() > ${f(PLUNGE_ROOM)}) {
      spray = amount * ${f(PLUNGE_SPRAY)}
        * min(1.0, (speed - ${f(CROWN_SPEED)}) / ${f(CROWN_SPEED)});
    }
    // Posted before it is held back, for the reason postSpawn gives: water
    // taken out of the landing that no drop carries is water lost.
    if (spray > 0.0 && !postSpawn(
      k, ${SPAWN_CROWN}, to, spray,
      groundAt(to) + depthAt(to), speed, 0.0, f32(mat)
    )) {
      spray = 0.0;
    }
    bankLanding(to, amount - spray, mat, speed);
    let white = min(1.0, (amount * ${f(PLUNGE_WHITE)} * speed) / ${f(IMPACT_REF)});
    atomicMax(&acc[accAt(${ACC.splash}, to)], i32(white * LAND_SCALE));
    return;
  }
  // The tidying-up calls: the cliff has gone, or the fall caught its own
  // front. Nothing fell anywhere, so nothing lands on anything.
  bankLanding(to, amount, mat, 0.0);
}

fn resetFall(k: i32) {
  setFront(k, 0.0);
  setHead(k, 0.0);
  setFrontSpeed(k, 0.0);
  setHeadSpeed(k, 0.0);
  setSince(k, ${f(CLING)});
}

@compute @workgroup_size(${WORKGROUP})
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let n = i32(gid.x);
  // FROM THE DEVICE'S OWN COUNT, not from a uniform the host filled in. Once
  // the cliff pass builds the index there is no frame in which the host knows
  // how long it is, and a dispatch sized from a stale count walks either too
  // few edges or somebody else's.
  if (n >= cliffCount()) { return; }
  let k = cliffAt(n);
  if (k < 0) { return; }
  let i = k >> 1;
  let axis = k & 1;
  let x = i % nx();
  let y = i / nx();
  // The box still decides, exactly as it does on the CPU.
  if (x < consts.box.x || x > consts.box.z || y < consts.box.y || y > consts.box.w) {
    return;
  }

  // THE SMOOTHED LAUNCH IS NOT HERE ANY MORE. It was, once per column, and a
  // thread decided whether it was its column's first edge by looking at the
  // previous entry in the cliff index — which is the host's lastCol test and
  // is only valid on the host's ordering. The index here is claimed with
  // atomics, so a column's two edges need not be adjacent, and when they are
  // not both threads ease and the step lands twice. It is one thread per
  // column in the cliffs pass now, where nothing has to be decided about
  // order at all. @see the cliffs pass

  let jx = select(x, x + 1, axis == 0);
  let jy = select(y + 1, y, axis == 0);
  let j = jy * nx() + jx;
  let drop = groundAt(i) - besideAt2(j);

  if (drop < fallMin()) {
    // The cliff has gone — filled in from below, or the ground moved. What is
    // in the air belongs to the cell below, but it arrives over DROWN rather
    // than all at once: dumped, it puts the pool up over the cliff and kills
    // the next fall too, which is a flicker and not a waterfall.
    land(k, j, i, min(1.0, dt() / ${f(DROWN)}), 0.0);
    resetFall(k);
    return;
  }

  let flux = select(fyAt(i), fxAt(i), axis == 0);
  setSince(k, select(sinceAt(k) + dt(), 0.0, flux > 0.0 && depthAt(i) > dryDepth()));

  if (sinceAt(k) < ${f(CLING)}) {
    setHead(k, 0.0);                            // more is coming over behind it
    setHeadSpeed(k, 0.0);
  } else {
    setHeadSpeed(k, headSpeedAt(k) + ${f(FALL_GRAVITY)} * dt());
    setHead(k, headAt(k) + headSpeedAt(k) * dt());
  }
  if (frontAt(k) < drop) {
    setFrontSpeed(k, frontSpeedAt(k) + ${f(FALL_GRAVITY)} * dt());
    setFront(k, min(drop, frontAt(k) + frontSpeedAt(k) * dt()));
  }

  // Past the breaking point it throws water off itself, and what it throws is
  // DROPS out of its own mass — so the sheet is lighter for it. The water
  // leaving is this pass's business and is done here; where the drop goes is
  // the drip system's, and is recorded for the host to make.
  if (frontAt(k) > ${f(BREAK)} && airAt(k) > 0.0) {
    let loose = min(1.0, (frontAt(k) - ${f(BREAK)}) / ${f(BREAK)});
    setShed(k, shedAt(k) + ${f(SHED)} * loose * roomNow() * dt());
    if (shedAt(k) >= ${f(DROP)}) {
      let take = min(airAt(k), ${f(DROP)});
      if (take > 0.0) {
        // frontSpeed FREEZES once the front saturates, so each edge sheds
        // from a point of its own and keeps it. Seeding this on shedAt was
        // tried and put back: see the note on the host's shedSpray for why a
        // seed that tracks the water costs more than it buys.
        let u = scatterOf(k, frontSpeedAt(k), 0);
        let v = scatterOf(k, frontSpeedAt(k), 1);
        // Out of the LOWER half of the sheet: the top of a nappe is still a
        // sheet, and it is the part that has thinned and sped up that comes
        // apart.
        let below = min(drop, headAt(k) + (frontAt(k) - headAt(k)) * (0.5 + 0.5 * v));
        // Tiles a second into columns a second. The SMOOTHED launch, the same
        // one the sheet is drawn on, so a drop leaves from where the sheet is.
        let lip = select(throwYAt(i), throwXAt(i), axis == 0) / cellSize();
        // POSTED BEFORE THE WATER MOVES. If the outbox is full the request
        // cannot be recorded, and then the shed must not happen either — the
        // alternative is a sheet that loses water no drop ever carries, which
        // is a leak, and a leaking sim is one nobody can reason about.
        if (postSpawn(
          k, ${SPAWN_SHED}, i, take, below, u, lip, f32(materialAt(i))
        )) {
          setShed(k, shedAt(k) - take);
          setAir(k, airAt(k) - take);
        }
      }
    }
  }

  // NOTHING LANDS until the front gets there. After that it leaves the air at
  // the rate it is arriving, which in a steady fall is the rate it went over.
  if (frontAt(k) >= drop && airAt(k) > 0.0) {
    let fall = sqrt((2.0 * drop) / ${f(FALL_GRAVITY)});
    land(k, landsAt(i, j, drop), i, min(1.0, dt() / fall), drop);
  }
  // Caught its own front, or fallen past the bottom: nothing is left of it.
  if (headAt(k) >= frontAt(k) || headAt(k) >= drop) {
    land(k, j, i, 1.0, 0.0);
    resetFall(k);
  }
}
`;

export type FallsPass = {
  encode: (enc: GPUCommandEncoder, s: GpuState, cliffN: number) => void;
  layout: GPUBindGroupLayout;
};

export function createFalls(device: GPUDevice): FallsPass {
  const layout = stateLayout(device);
  const pipeline = device.createComputePipeline({
    label: "falls",
    layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }),
    compute: {
      module: device.createShaderModule({ code: FALLS_WGSL, label: "falls" }),
      entryPoint: "main",
    },
  });
  return {
    layout,
    encode: (enc, s, edges) => {
      if (edges <= 0) return;
      const pass = beginPass(enc, s, "falls");
      pass.setPipeline(pipeline);
      bindState(pass, s, layout);
      // ONE THREAD PER SLOT THE INDEX COULD HOLD, which on the device path is
      // TWO PER CELL and not one per cliff edge — 131,072 threads on a
      // 256-square map to walk an index of about 732. The header on this file
      // says one per edge and that is the intent, not the dispatch.
      //
      // `edges` is what the caller can GUARANTEE covers the index: the exact
      // count where the host built it, and the worst case where the device
      // did, because only the device knows this frame's count and the host
      // does not hear it until the readback lands three to five frames later.
      // Threads past the end read the count and return.
      //
      // MEASURED BEFORE SHRINKING IT, and it is not worth shrinking. Over 1500
      // frames of the waterfall fixture this pass costs 0.019 ms a frame, next
      // to 0.102 for `diffuse` and 4.28 for the render, on a frame that is
      // vsync-locked at 8.3. Sizing it from `lipCap` the way `fallout` does
      // would save about 0.012 ms — and `fallout` can afford that bound
      // because under-dispatching it only means fewer rows come back, where
      // under-dispatching THIS means water in the air that nobody steps. An
      // edit that more than doubles the lip count would do exactly that until
      // the next readback. A tenth of a percent of a frame is not worth a
      // physics pass that silently skips edges.
      pass.dispatchWorkgroups(Math.ceil(edges / WORKGROUP));
      pass.end();
    },
  };
}

/**
 * Turn the outbox into drops.
 *
 * IN EDGE ORDER, and that is not tidiness. `markCliffs` walks the map and
 * pushes `k` then `k + 1` per column, so the CPU's cliff set is ascending in
 * `k` and it sheds in that order; the device's threads claim outbox slots in
 * whatever order they happen to reach the atomic. Sorting by the edge puts the
 * two back in step, and the drip list — which is a packed array where position
 * decides who coalesces when it fills — then comes out identical rather than
 * merely equivalent.
 *
 * `raw` is the spawn region as read back, `claimed` the counter from
 * `reduce`. They differ when the outbox overflowed: the counter counts
 * requests and the buffer holds the ones that fitted. The shader does not
 * shed what it cannot post, so an overflow costs drops and never water — but
 * it is returned rather than swallowed, because a scene reaching it is a scene
 * whose spray has silently stopped.
 */
export function drainSpawns(
  f: ColumnField, raw: Float32Array, claimed: number,
): { made: number; shed: number; crowns: number; lost: number } {
  // BOUNDED BY THE BUFFER IN HAND, not by the ceiling it usually has. They
  // are the same in the solver and are not in a test, and a drain that reads
  // past what it was given is a drain that invents drops out of whatever is
  // next in memory.
  const got = Math.min(claimed, (raw.length / SPAWN_STRIDE) | 0, SPAWN_MAX);
  const key = (n: number) =>
    raw[n * SPAWN_STRIDE] * 2 + raw[n * SPAWN_STRIDE + 1];
  const order = Array.from({ length: got }, (_, n) => n)
    .sort((a, b) => key(a) - key(b));
  let shed = 0, crowns = 0;
  for (const n of order) {
    const at = n * SPAWN_STRIDE;
    if (raw[at + 1] === SPAWN_CROWN) {
      crowns++;
      crown(
        f.drips, (raw[at + 2] | 0) % f.nx, ((raw[at + 2] | 0) / f.nx) | 0,
        raw[at + 4], raw[at + 3], raw[at + 7] | 0, raw[at + 5],
      );
    } else {
      shed++;
      dropFrom(
        f, raw[at] | 0, raw[at + 3], raw[at + 4], raw[at + 5], raw[at + 6],
        raw[at + 7] | 0,
      );
    }
  }
  return { made: got, shed, crowns, lost: claimed - got };
}

export const fallsSource = () => FALLS_WGSL;
export { FALL_MIN, SPAWN_MAX, SPAWN_STRIDE };
