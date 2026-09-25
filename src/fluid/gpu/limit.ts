/**
 * PASS 2 on the device — the twin of `columns.ts`'s `limit`.
 *
 * TWO DISPATCHES FOR ONE CPU LOOP, and the reason is the only interesting
 * thing here. The CPU walks cells, works out each one's scale from the fluxes
 * as they stand, and applies it immediately. That is safe in a loop because an
 * edge is only ever scaled by the cell it flows OUT of — proved by running the
 * CPU pass forwards and backwards over the same state and getting the same
 * answer to the bit — so no cell ever reads a flux another cell has already
 * scaled.
 *
 * On a device every cell runs at once, and "no cell READS a scaled flux" stops
 * being free: thread A may write a flux while thread B is still summing its
 * own outflows, and B's answer then depends on who won. So the two halves are
 * separated. Every scale is computed from the pre-limit fluxes, that dispatch
 * ends, and only then is anything multiplied.
 *
 * ONE PASS IS ENOUGH TO SEPARATE THEM, which is settled and not assumed. A
 * WebGPU spec editor, on gpuweb discussion 4434:
 *
 *   dispatches are each their own synchronization scope so in terms of memory
 *   it is as-if they were run serially. However implementation should optimize
 *   this so that two dispatches that only read from the same resource (but
 *   don't write to any shared resource) run in parallel.
 *
 * So the API inserts the barrier itself and a second pass buys nothing. This
 * was worth settling rather than guessing: the first version of this file used
 * two passes and said the pass boundary was the barrier, and the sabotage that
 * should have proved it — both dispatches in one pass — came back clean five
 * times out of five. That was not luck and not a weak test. It cannot fail.
 *
 * The APPLY half needs no atomics either, because of that same exclusivity:
 * each edge has exactly one writer. A cell scales its own east and south edges
 * when they run outward, and its west and north neighbours' edges when THOSE
 * run outward through it, and no other cell can claim either.
 */
import {
  STATE_WGSL, beginPass, bindState, stateLayout, type GpuState, shaderModule,} from "./state";
import type { Box } from "./accelerate";

const WORKGROUP = 8;

const LIMIT_WGSL = `
${STATE_WGSL}

/**
 * How much this cell is trying to send out, over all four of its edges.
 *
 * OUTFLOWS ONLY. What arrives is somebody else's problem and somebody else's
 * limit; counting it here would let a cell with a big inflow send out water it
 * has not received yet, which is the whole failure this pass exists to stop.
 */
fn outflowAt(a: i32, i: i32, x: i32, y: i32) -> f32 {
  var out = 0.0;
  let L = slots();
  // A SLOT'S OUTFLOWS, WHICHEVER SLOT THEY GO TO. Water leaving slot a
  // eastward may be going onto the deck of the column beside it or into the
  // channel under that deck, and those are different planes of the same edge
  // — but it is one slot's water paying for both, so one limit covers the lot.
  // Scaled per plane, the deck and the channel could each take all of it.
  //
  // The planes are walked the OTHER WAY ROUND on the edges arriving from the
  // west and the north: on this column's own edge a is the near side, and on
  // those it is the far one.
  for (var b = 0; b < L; b = b + 1) {
    let e = pairBase(a, b) + i;
    if (fxAt(e) > 0.0) { out = out + fxAt(e); }
    if (fyAt(e) > 0.0) { out = out + fyAt(e); }
    let w = pairBase(b, a) + i - 1;
    if (x > 0 && fxAt(w) < 0.0) { out = out - fxAt(w); }
    let n = pairBase(b, a) + i - nx();
    if (y > 0 && fyAt(n) < 0.0) { out = out - fyAt(n); }
  }
  return out;
}

@compute @workgroup_size(${WORKGROUP}, ${WORKGROUP})
fn scales(@builtin(global_invocation_id) gid: vec3<u32>) {
  let x = consts.box.x + i32(gid.x);
  let y = consts.box.y + i32(gid.y);
  if (x > consts.box.z || y > consts.box.w) { return; }
  let i = y * nx() + x;
  for (var a = 0; a < slots(); a = a + 1) {
    let ia = slotBase(a) + i;
    let want = outflowAt(a, i, x, y) * spread();
    // ONE where the slot is within its means, which is the CPU's early exit
    // written as a number: it leaves those edges alone, and multiplying by
    // one is leaving them alone.
    setScale(ia, select(1.0, depthAt(ia) / want, want > depthAt(ia) && want > 0.0));
  }
}

@compute @workgroup_size(${WORKGROUP}, ${WORKGROUP})
fn apply(@builtin(global_invocation_id) gid: vec3<u32>) {
  let x = consts.box.x + i32(gid.x);
  let y = consts.box.y + i32(gid.y);
  if (x > consts.box.z || y > consts.box.w) { return; }
  let i = y * nx() + x;
  let L = slots();
  for (var a = 0; a < L; a = a + 1) {
    let s = scaleAt(slotBase(a) + i);
    if (s >= 1.0) { continue; }
    // ITS OWN SCALE ON ALL OF THEM, including the edges that belong to the
    // neighbours: an edge running west out of this slot is this slot's
    // outflow and is limited by this slot's water, wherever the array happens
    // to keep it. The CPU does exactly this and it is where the shape comes
    // from.
    for (var b = 0; b < L; b = b + 1) {
      let e = pairBase(a, b) + i;
      if (fxAt(e) > 0.0) { setFx(e, fxAt(e) * s); }
      if (fyAt(e) > 0.0) { setFy(e, fyAt(e) * s); }
      let w = pairBase(b, a) + i - 1;
      if (x > 0 && fxAt(w) < 0.0) { setFx(w, fxAt(w) * s); }
      let n = pairBase(b, a) + i - nx();
      if (y > 0 && fyAt(n) < 0.0) { setFy(n, fyAt(n) * s); }
    }
  }
}
`;

export type LimitPass = {
  encode: (enc: GPUCommandEncoder, s: GpuState, box: Box) => void;
  layout: GPUBindGroupLayout;
};

export function createLimit(device: GPUDevice): LimitPass {
  const layout = stateLayout(device);
  const module = shaderModule(device, LIMIT_WGSL, "limit");
  const pipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [layout] });
  const of = (entryPoint: string) => device.createComputePipeline({
    label: `limit:${entryPoint}`,
    layout: pipelineLayout,
    compute: { module, entryPoint },
  });
  const scales = of("scales");
  const applyStage = of("apply");

  return {
    layout,
    encode: (enc, s, box) => {
      const groups: [number, number] = [
        Math.ceil((box.x1 - box.x0 + 1) / WORKGROUP),
        Math.ceil((box.y1 - box.y0 + 1) / WORKGROUP),
      ];
      // ONE PASS, TWO DISPATCHES. The dispatch boundary is the barrier — see
      // the note at the top — so the second reads what the first wrote and a
      // second pass would only be two more objects to make per substep.
      const pass = beginPass(enc, s, "limit");
      for (const pipeline of [scales, applyStage]) {
        pass.setPipeline(pipeline);
        bindState(pass, s, layout);
        pass.dispatchWorkgroups(groups[0], groups[1]);
      }
      pass.end();
    },
  };
}

export const limitSource = () => LIMIT_WGSL;
