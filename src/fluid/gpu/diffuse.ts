/**
 * PASS 0 on the device — the twin of `columns.ts`'s `diffuseBreaking`.
 *
 * Pass NOUGHT because it runs first in a substep: what was breaking at the end
 * of the last step dissipates at the start of this one, on the viscosity that
 * step worked out. A step behind, which is what an explicit indicator always
 * is.
 *
 * TWO DISPATCHES PER AXIS, and no atomics anywhere:
 *
 *   1. PREP — for every edge, its depth, its velocity and its viscosity, or a
 *      depth of nought for an edge that takes no part.
 *   2. EXCHANGE — every edge trades momentum with its four neighbours and
 *      writes ITS OWN flux. It reads only what the prep wrote, never a flux,
 *      so writing the flux in the same dispatch races nothing.
 *
 * What carries the values between the two is the DISPATCH BOUNDARY: within a
 * pass each dispatch is its own synchronization scope and they behave as if
 * run serially — see the note in `state.ts`.
 *
 * CONSERVED BY ARITHMETIC, not by an atomic. Each side of a face works out
 * the same `D` from the same two numbers — sums and products, which do not
 * care about order — so what one edge gains its neighbour loses, without
 * either writing the other's flux. The Jacobi sweeps this replaced needed two
 * arrays and a ping-pong to be order-independent; the exchange is
 * order-independent by construction.
 */
import { MIXING } from "../columns";
import {
  STATE_WGSL, beginPass, bindState, stateLayout, type GpuState, shaderModule,} from "./state";
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
 * PREP: the edge's depth, velocity and viscosity, IN EVERY PLANE.
 *
 * Only an edge with BOTH its cells wet takes part, and one that does not
 * writes a depth of nought, which is what the exchange tests. The far cell
 * is read only where the edge has one — the last column of a row has no east
 * edge, and reading past it lands in the first cell of the next row.
 *
 * The viscosity is the mean of the two cells', so a cell's breaking reaches
 * all four of its edges and not only the two it owns. Each cell's is a mixing
 * length squared over a time, the length being the depth.
 */
@compute @workgroup_size(${WORKGROUP}, ${WORKGROUP})
fn prep(@builtin(global_invocation_id) gid: vec3<u32>) {
  let x = consts.box.x + i32(gid.x);
  let y = consts.box.y + i32(gid.y);
  if (x > consts.box.z || y > consts.box.w) { return; }
  let i = y * nx() + x;
  let step = select(nx(), 1, AXIS == 0);
  let inMap = select(y + 1 < ny(), x + 1 < nx(), AXIS == 0);
  let L = slots();
  for (var a = 0; a < L; a = a + 1) {
    let ia = slotBase(a) + i;
    let dn = depthAt(ia);
    for (var b = 0; b < L; b = b + 1) {
      let e = pairBase(a, b) + i;
      var df = 0.0;
      var jb = 0;
      if (inMap) {
        jb = slotBase(b) + i + step;
        df = depthAt(jb);
      }
      if (dn <= dryDepth() || df <= dryDepth()) {
        setIterB(e, 0.0);
        setIterA(e, 0.0);
        continue;
      }
      let h = max((dn + df) * 0.5, dryDepth() * 8.0);
      setIterB(e, h);
      setVelo(e, qAt(e) / h);
      setIterA(e, breakingOn() * ${f(MIXING)} * 0.5
        * (brokeAt(ia) * dn * rateAt(ia) + brokeAt(jb) * df * rateAt(jb)));
    }
  }
}

/**
 * EXCHANGE: trade momentum with the four neighbours, in this plane.
 *
 * D dv / (1 + 8 D / h) a face, h the shallower edge — graded where the
 * viscosity is small and approaching an eighth of the way where it is large,
 * so an edge keeps at least half its own velocity. At a QUARTER the one
 * pattern a grid can hold that is not a wave flips sign every substep instead
 * of dying, and the breaking test reads that as breaking. @see diffuseBreaking
 *
 * A neighbour outside the box is not a neighbour: its prep never ran, so what
 * is there is last substep's. Every edge that takes part is inside the box.
 */
@compute @workgroup_size(${WORKGROUP}, ${WORKGROUP})
fn exchange(@builtin(global_invocation_id) gid: vec3<u32>) {
  let x = consts.box.x + i32(gid.x);
  let y = consts.box.y + i32(gid.y);
  if (x > consts.box.z || y > consts.box.w) { return; }
  let i = y * nx() + x;
  let L = slots();
  for (var a = 0; a < L; a = a + 1) {
    for (var b = 0; b < L; b = b + 1) {
      let P = pairBase(a, b);
      let e = P + i;
      let hi = iterBAt(e);
      if (hi <= 0.0) { continue; }
      let vi = veloAt(e);
      let ni = iterAAt(e);
      var moved = 0.0;
      for (var k = 0; k < 4; k = k + 1) {
        let jx = x + select(select(0, 1, k == 1), -1, k == 0);
        let jy = y + select(select(0, 1, k == 3), -1, k == 2);
        if (jx < consts.box.x || jx > consts.box.z
            || jy < consts.box.y || jy > consts.box.w) { continue; }
        let ej = P + jy * nx() + jx;
        let hj = iterBAt(ej);
        if (hj <= 0.0) { continue; }
        let nf = (ni + iterAAt(ej)) * 0.5;
        if (nf <= 0.0) { continue; }
        let d = diffScale() * nf * ((hi + hj) * 0.5);
        moved = moved + d * (veloAt(ej) - vi) / (1.0 + 8.0 * d / min(hi, hj));
      }
      if (moved != 0.0) { setQ(e, qAt(e) + moved); }
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
    const module = shaderModule(device, diffuseWgsl(axis), `diffuse-${axis}`);
    return ["prep", "exchange"].map((entryPoint) =>
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

export const diffuseSource = (axis: 0 | 1 = 0) => diffuseWgsl(axis);
