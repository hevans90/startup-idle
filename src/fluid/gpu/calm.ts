/**
 * PASS 0, SECOND HALF, on the device — the twin of `columns.ts`'s `calmChop`.
 *
 * Deep water is calmed at the scale of the grid by fourth differences of the
 * edge velocities, ONCE A FRAME — in the first substep, over `frameDt`. Why fourth and not second, and why only in deep water, is
 * on the host function; this is the arithmetic, kept to the same order.
 *
 * THREE DISPATCHES PER AXIS, the shape of `diffuse` with a stage between:
 *
 *   1. PREP — for every edge its depth and velocity, or a depth of nought for
 *      an edge that takes no part.
 *   2. LAP — every edge's Laplacian, once, into `iterA`.
 *   3. EXCHANGE — every edge moves its OWN flux by the difference of its
 *      neighbours' Laplacians and its own.
 *
 * Conserved by arithmetic as the exchange in `diffuse` is: both sides of a
 * face read the same two stored Laplacians.
 * @see calmChop
 */
import { CALM, CALM_FROM, CALM_FULL, CALM_STEP } from "../columns";
import {
  STATE_WGSL, beginPass, bindState, stateLayout, type GpuState, shaderModule,
} from "./state";
import type { Box } from "./accelerate";

const WORKGROUP = 8;

const f = (v: number) => (Number.isInteger(v) ? `${v}.0` : String(v));

/**
 * The depth an edge counts as, to the calm and to the breaking diffusion
 * both — one spelling, since the two passes trade momentum the same way and
 * went wrong the same way. The calm also leaves walls out; the breaking does
 * not. @see lipDepth, calmDepth
 */
export const CALM_DEPTH_WGSL = `
/**
 * An edge's depth over its lip: the mean of the two depths over the SILL,
 * capped at the gap under any lid. On level ground the plain mean, exactly.
 * @see lipDepth, calmDepth, which carry the whole note
 */
fn lipDepth(gn: f32, rn: f32, dn: f32, gf: f32, rf: f32, df: f32) -> f32 {
  let sill = max(gn, gf);
  let lid = min(rn, rf);
  let hn = max(0.0, dn - (sill - gn));
  let hf = max(0.0, df - (sill - gf));
  let h = (hn + hf) * 0.5;
  let gap = lid - sill;
  return select(max(0.0, gap), h, h < gap);
}

// And the calm's: over a real step the edge takes no part. @see calmDepth
fn calmDepth(gn: f32, rn: f32, dn: f32, gf: f32, rf: f32, df: f32) -> f32 {
  let sill = max(gn, gf);
  let over = (max(0.0, dn - (sill - gn)) + max(0.0, df - (sill - gf))) * 0.5;
  return select(lipDepth(gn, rn, dn, gf, rf, df), 0.0, over < ${f(CALM_STEP)} * (dn + df) * 0.5);
}
`;

const calmWgsl = (axis: 0 | 1) => `
${STATE_WGSL}

// NO BACKTICKS IN HERE — see the note at the top of the shared header.

const AXIS: i32 = ${axis};

fn qAt(e: i32) -> f32 {
  return select(fyAt(e), fxAt(e), AXIS == 0);
}
fn setQ(e: i32, v: f32) {
  if (AXIS == 0) { setFx(e, v); } else { setFy(e, v); }
}

/** @see calmWeight */
fn calmWeight(h: f32) -> f32 {
  return clamp((h - ${f(CALM_FROM)}) / ${f(CALM_FULL - CALM_FROM)}, 0.0, 1.0);
}

/** @see calmScale — over the FRAME's time, since it runs once a frame. */
fn calmScale() -> f32 {
  let c = cellSize();
  return min(1.0 / 80.0, ${f(CALM)} * frameDt() / (c * c * c * c));
}

${CALM_DEPTH_WGSL}

fn inBox(x: i32, y: i32) -> bool {
  return x >= consts.box.x && x <= consts.box.z && y >= consts.box.y && y <= consts.box.w;
}

/** The Laplacian of the edge velocities at (x, y) in plane P. @see lapAt */
fn lapAt(P: i32, x: i32, y: i32) -> f32 {
  let e = P + y * nx() + x;
  let vi = veloAt(e);
  var L = 0.0;
  if (x > consts.box.x && iterBAt(e - 1) > 0.0) { L = L + (veloAt(e - 1) - vi); }
  if (x < consts.box.z && iterBAt(e + 1) > 0.0) { L = L + (veloAt(e + 1) - vi); }
  if (y > consts.box.y && iterBAt(e - nx()) > 0.0) { L = L + (veloAt(e - nx()) - vi); }
  if (y < consts.box.w && iterBAt(e + nx()) > 0.0) { L = L + (veloAt(e + nx()) - vi); }
  return L;
}

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
      if (inMap) { df = depthAt(slotBase(b) + i + step); }
      if (dn <= dryDepth() || df <= dryDepth()) {
        setIterB(e, 0.0);
        continue;
      }
      // FROM THE SILL, not the mean of the two beds. @see calmDepth
      let jb = slotBase(b) + i + step;
      let h = calmDepth(groundAt(ia), roofAt(ia), dn, groundAt(jb), roofAt(jb), df);
      if (h <= dryDepth()) {
        setIterB(e, 0.0);
        continue;
      }
      setIterB(e, h);
      setVelo(e, qAt(e) / h);
    }
  }
}

/** LAP: each edge's Laplacian, once, into iterA — free once the breaking exchange is done. */
@compute @workgroup_size(${WORKGROUP}, ${WORKGROUP})
fn lap(@builtin(global_invocation_id) gid: vec3<u32>) {
  let x = consts.box.x + i32(gid.x);
  let y = consts.box.y + i32(gid.y);
  if (x > consts.box.z || y > consts.box.w) { return; }
  let i = y * nx() + x;
  let L = slots();
  for (var a = 0; a < L; a = a + 1) {
    for (var b = 0; b < L; b = b + 1) {
      let P = pairBase(a, b);
      setIterA(P + i, select(0.0, lapAt(P, x, y), iterBAt(P + i) > 0.0));
    }
  }
}

@compute @workgroup_size(${WORKGROUP}, ${WORKGROUP})
fn exchange(@builtin(global_invocation_id) gid: vec3<u32>) {
  let x = consts.box.x + i32(gid.x);
  let y = consts.box.y + i32(gid.y);
  if (x > consts.box.z || y > consts.box.w) { return; }
  let i = y * nx() + x;
  let k = calmScale();
  let L = slots();
  for (var a = 0; a < L; a = a + 1) {
    for (var b = 0; b < L; b = b + 1) {
      let P = pairBase(a, b);
      let e = P + i;
      let hi = iterBAt(e);
      let wi = calmWeight(hi);
      if (wi <= 0.0) { continue; }
      let li = iterAAt(e);
      var moved = 0.0;
      for (var n = 0; n < 4; n = n + 1) {
        let jx = x + select(select(0, 1, n == 1), -1, n == 0);
        let jy = y + select(select(0, 1, n == 3), -1, n == 2);
        if (!inBox(jx, jy)) { continue; }
        let hj = iterBAt(P + jy * nx() + jx);
        let wj = calmWeight(hj);
        if (wj <= 0.0) { continue; }
        moved = moved + min(wi, wj) * ((hi + hj) * 0.5) * (iterAAt(P + jy * nx() + jx) - li);
      }
      if (moved != 0.0) { setQ(e, qAt(e) - k * moved); }
    }
  }
}
`;

export type CalmPass = {
  encode: (enc: GPUCommandEncoder, s: GpuState, box: Box) => void;
  layout: GPUBindGroupLayout;
};

export function createCalm(device: GPUDevice): CalmPass {
  const layout = stateLayout(device);
  const pipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [layout] });
  const stages = ([0, 1] as const).map((axis) => {
    const module = shaderModule(device, calmWgsl(axis), `calm-${axis}`);
    return ["prep", "lap", "exchange"].map((entryPoint) =>
      device.createComputePipeline({
        label: `calm-${axis}:${entryPoint}`,
        layout: pipelineLayout,
        compute: { module, entryPoint },
      }));
  });

  return {
    layout,
    encode: (enc, s, box) => {
      const gx = Math.ceil((box.x1 - box.x0 + 1) / WORKGROUP);
      const gy = Math.ceil((box.y1 - box.y0 + 1) / WORKGROUP);
      const pass = beginPass(enc, s, "calm");
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

export const calmSource = (axis: 0 | 1 = 0) => calmWgsl(axis);
