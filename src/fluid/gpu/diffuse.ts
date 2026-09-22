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
fn qAt(e: i32) -> f32 {
  return select(fyAt(e), fxAt(e), AXIS == 0);
}
fn setQ(e: i32, v: f32) {
  if (AXIS == 0) { setFx(e, v); } else { setFy(e, v); }
}

/**
 * The depth under an edge: the mean of the two cells it lies between, floored
 * so that dividing a flux by it cannot explode where the water is a film.
 */
fn headUnder(i: i32, a: i32, b: i32) -> f32 {
  let step = select(nx(), 1, AXIS == 0);
  let far = i + step;
  let here = depthAt(slotBase(a) + i);
  let beyond = select(here, depthAt(slotBase(b) + far), far < nx() * ny());
  return max((here + beyond) * 0.5, dryDepth() * 8.0);
}

@compute @workgroup_size(${WORKGROUP}, ${WORKGROUP})
fn prep(@builtin(global_invocation_id) gid: vec3<u32>) {
  let x = consts.box.x + i32(gid.x);
  let y = consts.box.y + i32(gid.y);
  if (x > consts.box.z || y > consts.box.w) { return; }
  let i = y * nx() + x;
  let L = slots();
  for (var a = 0; a < L; a = a + 1) {
    for (var b = 0; b < L; b = b + 1) {
      let e = pairBase(a, b) + i;
      let v = qAt(e) / headUnder(i, a, b);
      setVelo(e, v);
      setIterA(e, v);
    }
  }
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
 * for it, which is a zero-gradient wall rather than a hole. IN THIS PLANE,
 * because a deck's momentum has nothing to say to the channel's.
 */
fn sweep(i: i32, x: i32, y: i32, readA: bool) {
  let L = slots();
  for (var a = 0; a < L; a = a + 1) {
    let ia = slotBase(a) + i;
    let d = diffScale() * brokeAt(ia) * ${f(MIXING)} * depthAt(ia) * rateAt(ia) * breakingOn();
    for (var b = 0; b < L; b = b + 1) {
      let P = pairBase(a, b);
      let e = P + i;
      if (d <= 0.0) {
        if (readA) { setIterB(e, veloAt(e)); } else { setIterA(e, veloAt(e)); }
        continue;
      }
      let here = select(iterBAt(e), iterAAt(e), readA);
      let w = select(here, select(iterBAt(e - 1), iterAAt(e - 1), readA),
        x > consts.box.x && depthAt(ia - 1) > dryDepth());
      let ea = select(here, select(iterBAt(e + 1), iterAAt(e + 1), readA),
        x < consts.box.z && depthAt(ia + 1) > dryDepth());
      let n = select(here, select(iterBAt(e - nx()), iterAAt(e - nx()), readA),
        y > consts.box.y && depthAt(ia - nx()) > dryDepth());
      let so = select(here, select(iterBAt(e + nx()), iterAAt(e + nx()), readA),
        y < consts.box.w && depthAt(ia + nx()) > dryDepth());
      let out = (veloAt(e) + d * (w + ea + n + so)) / (1.0 + 4.0 * d);
      if (readA) { setIterB(e, out); } else { setIterA(e, out); }
    }
  }
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
  let L = slots();
  for (var a = 0; a < L; a = a + 1) {
    // Only where something broke. Elsewhere the flux is left exactly as it
    // was, rather than round-tripped through a division and a multiplication
    // that would not give it back unchanged.
    if (brokeAt(slotBase(a) + i) <= 0.0) { continue; }
    for (var b = 0; b < L; b = b + 1) {
      let e = pairBase(a, b) + i;
      setQ(e, iterAAt(e) * headUnder(i, a, b));
    }
  }
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
