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
  STATE_WGSL, beginPass, bindState, stateLayout, type GpuState, shaderModule,} from "./state";
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
fn divertedAt(i: i32, axis: i32, a: i32, b: i32, moved: f32) -> bool {
  // THE SIGN OF THE FLUX AGAINST THE SIGN OF THE DROP. An edge is a cliff in
  // one direction at most, and water only goes into the air when it is going
  // the way the ground falls. Asked of the +x way alone, a fall facing west
  // or north was crossed in a single step. @see dropAt
  let drop = dropAt(i, axis, a, b);
  return (moved > 0.0 && drop > 0.0) || (moved < 0.0 && drop < 0.0);
}

@compute @workgroup_size(${WORKGROUP}, ${WORKGROUP})
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let x = consts.box.x + i32(gid.x);
  let y = consts.box.y + i32(gid.y);
  if (x > consts.box.z || y > consts.box.w) { return; }
  let i = y * nx() + x;
  let sp = spread();
  let L = slots();

  // ONE SLOT AT A TIME, and every plane that reaches it. At one storey this
  // is the four incident edges it always was.
  // WHICH STOREYS THE FOUR NEIGHBOURS HAVE. An edge to a storey that is not
  // there carries nought — accelerate has just written it so — and adding a
  // nought changes no sum, so those terms are skipped rather than loaded.
  // @see hasSlot
  let north = select(0u, slotMaskAt(i - nx()), y - 1 >= consts.box.y);
  let west = select(0u, slotMaskAt(i - 1), x - 1 >= consts.box.x);
  let east = select(0u, slotMaskAt(i + 1), x + 1 < nx());
  let south = select(0u, slotMaskAt(i + nx()), y + 1 < ny());
  for (var a = 0; a < L; a = a + 1) {
    let ia = slotBase(a) + i;
    // A STOREY THAT IS NOT THERE: nothing in, nothing out, nothing won.
    if (!hasSlot(i, a)) {
      setDelta(ia, 0.0);
      setBestMat(ia, 0.0);
      continue;
    }
    var d = 0.0;
    // The biggest thing arriving, and what it is made of, so a cell that fills
    // this step knows what filled it. Strictly greater, so on a tie the first
    // contributor wins — which is the order below, and the CPU's.
    var bestIn = 0.0;
    var bestMat = 0.0;

    for (var b = 0; b < L; b = b + 1) {
      // 1. The row above's southward move into this slot. Only if that row
      //    was walked at all: outside the box the CPU never pushed here.
      let bit = 1u << u32(b);
      if ((north & bit) != 0u) {
        let e = pairBase(b, a) + i - nx();
        let moved = fyAt(e) * sp;
        // Lost to the air only when it was coming TOWARDS this slot: a move
        // the other way over that edge is water THIS slot gave up, and it
        // gives it up whether the far side receives it or the air does.
        if (!(moved > 0.0 && divertedAt(i - nx(), 1, b, a, moved))) {
          d = d + moved;
          if (moved > bestIn) {
            bestIn = moved;
            bestMat = field[consts.o0.z + slotBase(b) + i - nx()];
          }
        }
      }
      // 2. The cell before's eastward one.
      if ((west & bit) != 0u) {
        let e = pairBase(b, a) + i - 1;
        let moved = fxAt(e) * sp;
        if (!(moved > 0.0 && divertedAt(i - 1, 0, b, a, moved))) {
          d = d + moved;
          if (moved > bestIn) {
            bestIn = moved;
            bestMat = field[consts.o0.z + slotBase(b) + i - 1];
          }
        }
      }
      // 3. Its own two, which LEAVE whether or not they go into the air —
      //    that is what falling off a lip is. A move the other way is water
      //    arriving from the slot beyond, and is credited like the two above.
      if ((east & bit) != 0u) {
        let moved = fxAt(pairBase(a, b) + i) * sp;
        // A MOVE THE OTHER WAY THAT WENT INTO THE AIR NEVER ARRIVES. It is
        // the slot beyond that gave it up, and this one neither gains it nor
        // takes its material — which is the mirror of what the outward case
        // has always done.
        let held = moved < 0.0 && divertedAt(i, 0, a, b, moved);
        if (!held) {
          d = d - moved;
          if (moved < 0.0 && -moved > bestIn) {
            bestIn = -moved;
            bestMat = field[consts.o0.z + slotBase(b) + i + 1];
          }
        }
      }
      if ((south & bit) != 0u) {
        let moved = fyAt(pairBase(a, b) + i) * sp;
        let held = moved < 0.0 && divertedAt(i, 1, a, b, moved);
        if (!held) {
          d = d - moved;
          if (moved < 0.0 && -moved > bestIn) {
            bestIn = -moved;
            bestMat = field[consts.o0.z + slotBase(b) + i + nx()];
          }
        }
      }
    }

    setDelta(ia, d);
    setBestMat(ia, bestMat);

    // And what went over a lip is held in the air on the edge it left by. One
    // writer per edge, so this is the same write the scatter makes.
    for (var b = 0; b < L; b = b + 1) {
      let p = pairBase(a, b) + i;
      let bit = 1u << u32(b);
      if ((east & bit) != 0u) {
        let moved = fxAt(p) * sp;
        if (divertedAt(i, 0, a, b, moved)) { addAir(p * 2, abs(moved)); }
      }
      if ((south & bit) != 0u) {
        let moved = fyAt(p) * sp;
        if (divertedAt(i, 1, a, b, moved)) { addAir(p * 2 + 1, abs(moved)); }
      }
    }
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
      module: shaderModule(device, DIVERGENCE_WGSL, "divergence"),
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
