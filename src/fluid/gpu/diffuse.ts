/**
 * PASS 0 on the device — the twin of `columns.ts`'s `diffuseBreaking`.
 *
 * Pass NOUGHT because it runs first in a substep: what was breaking at the end
 * of the last step dissipates at the start of this one, on the viscosity that
 * step worked out. A step behind, which is what an explicit indicator always
 * is.
 *
 * FOUR DISPATCHES PER AXIS, and no atomics anywhere. The CPU does it in four
 * loops and so does this:
 *
 *   1. PREP — the velocity on each edge, from its flux and the depth under it,
 *      copied into the first iterate.
 *   2. SWEEP, reading A and writing B.
 *   3. SWEEP, reading B and writing A.
 *   4. WRITE BACK — the settled velocity becomes a flux again.
 *
 * THE PING-PONG IS THE WHOLE POINT. A Jacobi sweep reads its four neighbours
 * and writes itself, so reading and writing the same array is a different
 * algorithm — Gauss-Seidel, which converges differently and depends on the
 * order the cells are visited in. Two arrays and a swap is what makes a sweep
 * order-independent, which is what makes it safe to run 65,536 cells at once.
 * The CPU needs the two arrays for correctness; the device needs them for
 * correctness AND for the race.
 *
 * What carries the values between the four is the DISPATCH BOUNDARY: within a
 * pass each dispatch is its own synchronization scope and they behave as if
 * run serially — see the note in `state.ts`. Nothing else is needed and
 * nothing else is encoded.
 *
 * SWEEPS IS TWO AND THE CODE KNOWS IT. After an even number of sweeps the
 * answer is back in A, which is why stage 4 reads A. An odd count would leave
 * it in B and this would silently read the sweep before last.
 */
import { MIXING, SWEEPS } from "../columns";
import {
  STATE_WGSL, beginPass, bindState, stateLayout, type GpuState,
} from "./state";
import type { Box } from "./accelerate";

const WORKGROUP = 8;

const f = (v: number) => (Number.isInteger(v) ? `${v}.0` : String(v));

/**
 * The shader, with the axis baked in.
 *
 * Emitted twice from one text rather than written twice, and rather than made
 * a uniform: a uniform would have to be rewritten between the two halves,
 * which means either two buffers and two bind groups or a second submit. One
 * text, two modules, and the axis is a literal the compiler can fold.
 */
const diffuseWgsl = (axis: 0 | 1) => `
${STATE_WGSL}

// NO BACKTICKS IN HERE — see the note at the top of the shared header.

const AXIS: i32 = ${axis};

/** The flux on this cell's edge along the axis being diffused. */
fn qAt(i: i32) -> f32 {
  return select(fyAt(i), fxAt(i), AXIS == 0);
}
fn setQ(i: i32, v: f32) {
  if (AXIS == 0) { setFx(i, v); } else { setFy(i, v); }
}

/**
 * The depth under an edge: the mean of the two cells it lies between, floored
 * so that dividing a flux by it cannot explode where the water is a film.
 */
fn headUnder(i: i32) -> f32 {
  let step = select(nx(), 1, AXIS == 0);
  let far = i + step;
  let beyond = select(depthAt(i), depthAt(far), far < nx() * ny());
  return max((depthAt(i) + beyond) * 0.5, dryDepth() * 8.0);
}

@compute @workgroup_size(${WORKGROUP}, ${WORKGROUP})
fn prep(@builtin(global_invocation_id) gid: vec3<u32>) {
  let x = consts.box.x + i32(gid.x);
  let y = consts.box.y + i32(gid.y);
  if (x > consts.box.z || y > consts.box.w) { return; }
  let i = y * nx() + x;
  let v = qAt(i) / headUnder(i);
  setVelo(i, v);
  setIterA(i, v);
}

/**
 * One Jacobi sweep: each cell is its own OLD value plus its neighbours' NEW
 * ones, in the ratio the viscosity sets.
 *
 * The viscosity comes from the breaking intensity — a mixing length squared
 * over a time, the length being the depth. Where nothing is breaking it is
 * nought and the cell keeps the velocity it came in with.
 *
 * A neighbour outside the box, or dry, is not a neighbour: the cell stands in
 * for it, which is a zero-gradient wall rather than a hole.
 */
fn sweep(i: i32, x: i32, y: i32, readA: bool) {
  let d = diffScale() * brokeAt(i) * ${f(MIXING)} * depthAt(i) * rateAt(i) * breakingOn();
  if (d <= 0.0) {
    if (readA) { setIterB(i, veloAt(i)); } else { setIterA(i, veloAt(i)); }
    return;
  }
  let here = select(iterBAt(i), iterAAt(i), readA);
  let w = select(here, select(iterBAt(i - 1), iterAAt(i - 1), readA),
    x > consts.box.x && depthAt(i - 1) > dryDepth());
  let e = select(here, select(iterBAt(i + 1), iterAAt(i + 1), readA),
    x < consts.box.z && depthAt(i + 1) > dryDepth());
  let n = select(here, select(iterBAt(i - nx()), iterAAt(i - nx()), readA),
    y > consts.box.y && depthAt(i - nx()) > dryDepth());
  let s = select(here, select(iterBAt(i + nx()), iterAAt(i + nx()), readA),
    y < consts.box.w && depthAt(i + nx()) > dryDepth());
  let out = (veloAt(i) + d * (w + e + n + s)) / (1.0 + 4.0 * d);
  if (readA) { setIterB(i, out); } else { setIterA(i, out); }
}

@compute @workgroup_size(${WORKGROUP}, ${WORKGROUP})
fn sweepAB(@builtin(global_invocation_id) gid: vec3<u32>) {
  let x = consts.box.x + i32(gid.x);
  let y = consts.box.y + i32(gid.y);
  if (x > consts.box.z || y > consts.box.w) { return; }
  sweep(y * nx() + x, x, y, true);
}

@compute @workgroup_size(${WORKGROUP}, ${WORKGROUP})
fn sweepBA(@builtin(global_invocation_id) gid: vec3<u32>) {
  let x = consts.box.x + i32(gid.x);
  let y = consts.box.y + i32(gid.y);
  if (x > consts.box.z || y > consts.box.w) { return; }
  sweep(y * nx() + x, x, y, false);
}

@compute @workgroup_size(${WORKGROUP}, ${WORKGROUP})
fn writeBack(@builtin(global_invocation_id) gid: vec3<u32>) {
  let x = consts.box.x + i32(gid.x);
  let y = consts.box.y + i32(gid.y);
  if (x > consts.box.z || y > consts.box.w) { return; }
  let i = y * nx() + x;
  // Only where something broke. Elsewhere the flux is left exactly as it was,
  // rather than round-tripped through a division and a multiplication that
  // would not give it back unchanged.
  if (brokeAt(i) <= 0.0) { return; }
  setQ(i, iterAAt(i) * headUnder(i));
}
`;

export type DiffusePass = {
  encode: (enc: GPUCommandEncoder, s: GpuState, box: Box) => void;
  layout: GPUBindGroupLayout;
};

export function createDiffuse(device: GPUDevice): DiffusePass {
  const layout = stateLayout(device);
  const pipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [layout] });
  const stages = ([0, 1] as const).map((axis) => {
    const module = device.createShaderModule({
      code: diffuseWgsl(axis), label: `diffuse-${axis}`,
    });
    return ["prep", "sweepAB", "sweepBA", "writeBack"].map((entryPoint) =>
      device.createComputePipeline({
        label: `diffuse-${axis}:${entryPoint}`,
        layout: pipelineLayout,
        compute: { module, entryPoint },
      }));
  });

  return {
    layout,
    encode: (enc, s, box) => {
      const gx = Math.ceil((box.x1 - box.x0 + 1) / WORKGROUP);
      const gy = Math.ceil((box.y1 - box.y0 + 1) / WORKGROUP);
      const pass = beginPass(enc, s, "diffuse");
      for (const axis of stages) {
        for (const pipeline of axis) {
          pass.setPipeline(pipeline);
          bindState(pass, s, layout);
          pass.dispatchWorkgroups(gx, gy);
        }
      }
      pass.end();
    },
  };
}

/** Two, and `writeBack` reads A because of it. @see SWEEPS */
export const sweepsHere = SWEEPS;

export const diffuseSource = (axis: 0 | 1 = 0) => diffuseWgsl(axis);
