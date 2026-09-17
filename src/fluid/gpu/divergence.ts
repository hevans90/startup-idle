/**
 * PASS 3 on the device — the twin of `columns.ts`'s `divergence`.
 *
 * THE ONE PASS THAT IS NOT A TRANSCRIPTION. The CPU scatters — each cell
 * pushes its two moves into its neighbours — and this gathers, each cell
 * summing the four edges incident on it.
 *
 * THE SHAPE IS EXACT; THE ARITHMETIC IS NOT, and the difference between those
 * two claims is worth being careful about, because the first draft of this
 * note claimed the second and was wrong. `divergence.test.ts` runs the CPU
 * scatter against a CPU gather written exactly as below and demands ZERO cells
 * differ — so turning the loop round costs nothing at all. Against the DEVICE
 * it is one f32 ULP, like every other pass, because the CPU works out a move
 * as `fx[i] * spread` in double and the device rounds that product. Measured
 * solo, from state both sides uploaded identically: worst 1.19e-7 on a delta
 * scale of 1.21, which is 2^-23 exactly.
 *
 * Two things make the SHAPE exact and both are easy to lose, so both have
 * their own test asserting the wrong version differs:
 *
 *  - THE ORDER. Floating-point addition does not associate. A cell's delta is
 *    accumulated by the row above first, then by the cell before it in the
 *    row, then by itself; written the obvious way — own outflows first — it
 *    comes out different in hundreds of cells.
 *  - THE ROUNDING. The CPU's `delta` is a `Float32Array`, so the scatter
 *    rounds on every accumulation. Here that is free: every operation on an
 *    f32 rounds, which is exactly what a chain of stores into a Float32Array
 *    does. It is the CPU that has to be asked, with `Math.fround`.
 *
 * NO ATOMICS. Not because they were avoided cleverly, but because there is
 * nothing to serialise: a cell's delta is written only by that cell, and `air`
 * is per EDGE and an edge belongs to exactly one cell. The scatter LOOKS like
 * it needs them and does not, the same way `limit` does.
 */
import {
  STATE_WGSL, beginPass, bindState, stateLayout, type GpuState,
} from "./state";
import type { Box } from "./accelerate";

const WORKGROUP = 8;

const DIVERGENCE_WGSL = `
${STATE_WGSL}

// NO BACKTICKS IN HERE — see the note at the top of the shared header.

/**
 * Did the water crossing this edge go into the AIR instead of into the cell
 * beyond it?
 *
 * A pure function of ground and depth, both of which this pass only reads, so
 * the cell DOWNSTREAM can ask it about an edge it does not own. That is the
 * whole reason the scatter can be turned round: an arriving amount can be
 * checked for diversion by the cell it would have arrived at.
 *
 * Called moved rather than the obvious name because that one is RESERVED in
 * WGSL, as from is. The error scopes in compare-pass are what turn either into
 * a message instead of a pass that silently does nothing.
 */
fn divertedAt(i: i32, axis: i32, moved: f32) -> bool {
  return moved > 0.0 && dropAt(i, axis) > 0.0;
}

@compute @workgroup_size(${WORKGROUP}, ${WORKGROUP})
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let x = consts.box.x + i32(gid.x);
  let y = consts.box.y + i32(gid.y);
  if (x > consts.box.z || y > consts.box.w) { return; }
  let i = y * nx() + x;
  let sp = spread();

  var d = 0.0;
  // The biggest thing arriving, and what it is made of, so a cell that fills
  // this step knows what filled it. Strictly greater, so on a tie the first
  // contributor wins — which is the order below, and the CPU's.
  var bestIn = 0.0;
  var bestMat = 0.0;

  // 1. The row above's southward move. Only if that row was walked at all:
  //    outside the box the CPU never pushed anything here.
  if (y - 1 >= consts.box.y) {
    let moved = fyAt(i - nx()) * sp;
    if (!divertedAt(i - nx(), 1, moved)) {
      d = d + moved;
      if (moved > bestIn) { bestIn = moved; bestMat = field[consts.o0.z + i - nx()]; }
    }
  }
  // 2. The cell before's eastward one.
  if (x - 1 >= consts.box.x) {
    let moved = fxAt(i - 1) * sp;
    if (!divertedAt(i - 1, 0, moved)) {
      d = d + moved;
      if (moved > bestIn) { bestIn = moved; bestMat = field[consts.o0.z + i - 1]; }
    }
  }
  // 3. Its own two, which LEAVE whether or not they go into the air — that is
  //    what falling off a lip is. A move the other way is water arriving from
  //    the cell beyond, and is credited like the two above.
  if (x + 1 < nx()) {
    let moved = fxAt(i) * sp;
    d = d - moved;
    if (moved < 0.0 && -moved > bestIn) { bestIn = -moved; bestMat = field[consts.o0.z + i + 1]; }
  }
  if (y + 1 < ny()) {
    let moved = fyAt(i) * sp;
    d = d - moved;
    if (moved < 0.0 && -moved > bestIn) { bestIn = -moved; bestMat = field[consts.o0.z + i + nx()]; }
  }

  setDelta(i, d);
  setBestMat(i, bestMat);

  // And what went over a lip is held in the air on the edge it left by. One
  // writer per edge, so this is the same write the scatter makes.
  if (x + 1 < nx()) {
    let moved = fxAt(i) * sp;
    if (divertedAt(i, 0, moved)) { addAir(i * 2, moved); }
  }
  if (y + 1 < ny()) {
    let moved = fyAt(i) * sp;
    if (divertedAt(i, 1, moved)) { addAir(i * 2 + 1, moved); }
  }
}
`;

export type DivergencePass = {
  encode: (enc: GPUCommandEncoder, s: GpuState, box: Box) => void;
  layout: GPUBindGroupLayout;
};

export function createDivergence(device: GPUDevice): DivergencePass {
  const layout = stateLayout(device);
  const pipeline = device.createComputePipeline({
    label: "divergence",
    layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }),
    compute: {
      module: device.createShaderModule({ code: DIVERGENCE_WGSL, label: "divergence" }),
      entryPoint: "main",
    },
  });
  return {
    layout,
    encode: (enc, s, box) => {
      const pass = beginPass(enc, s, "divergence");
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

export const divergenceSource = () => DIVERGENCE_WGSL;
