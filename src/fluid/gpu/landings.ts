/**
 * PASS 6 on the device — the twin of `columns.ts`'s `applyLandings`.
 *
 * What the falls pass banked, put in. It is a separate pass and not the tail
 * of the falls for the reason the banking exists at all: nothing a fall does
 * may be visible to another fall in the same step, and "another dispatch" is
 * how a shader says "after all of them".
 *
 * AND THE PUSH IS A GATHER, which is the interesting part. Written as the CPU
 * writes it, a plunge SCATTERS: the cell turns its momentum at the bed and
 * sends it out four ways, so it writes its own edge and its neighbour's, and
 * two cells can write the same edge. That is the shape that needs an atomic —
 * except that an edge has exactly two cells that can push it, its own and the
 * one across, and each of those pushes is a function of that cell alone. So
 * the edge can simply ask them both:
 *
 *     kickX[e] = +q(e)    if the ground across is under e's surface
 *                -q(e+1)  if the ground across is under e+1's surface
 *
 * which is the same arithmetic in the same order with nothing shared. The
 * fourth pass in this solver to look like a scatter and turn out not to be.
 * Only the landings themselves are a true scatter, because a lip can throw its
 * water at a cell that has no idea it is coming.
 *
 * THREE DISPATCHES, and the boundaries between them are load-bearing: the
 * push reads the depth the water pass has just changed, and the clamp reads
 * the kick the push has just written.
 *
 * OVER THE WHOLE MAP, NOT THE ACTIVE BOX, and that is not a missed
 * optimisation. A lip throws its water where its trajectory puts it, which can
 * be a dry column well outside the box — `applyLandings` loops the whole array
 * for exactly that reason. Dispatched over the box instead, a landing beyond
 * it is banked, never applied, and then wiped by the clear at the end of the
 * substep: the water is simply destroyed. It cost 0.13% of the map's volume
 * over thirty frames, accelerating as more water went over the lips, and it
 * left a pit at the foot of a fall bone dry while the CPU filled it to 7.8.
 */
import { PLUNGE_CAP, PLUNGE_PUSH } from "../columns";
import { ACROSS } from "../drips";
import { ACC, LAND_SCALE } from "./falls";
import {
  STATE_WGSL, beginPass, bindState, stateLayout, type GpuState,
} from "./state";

const WORKGROUP = 8;

const f = (v: number) => (Number.isInteger(v) ? `${v}.0` : String(v));

const LANDINGS_WGSL = `
${STATE_WGSL}

// NO BACKTICKS IN HERE — see the note at the top of the shared header.

const LAND_SCALE: f32 = ${f(LAND_SCALE)};

fn accAt(region: i32, i: i32) -> i32 { return region * (nx() * ny()) + i; }

/** What was banked there, back in half steps. */
fn landingAt(i: i32) -> f32 {
  return f32(atomicLoad(&acc[accAt(${ACC.landing}, i)])) / LAND_SCALE;
}
fn impulseAt(i: i32) -> f32 {
  return f32(atomicLoad(&acc[accAt(${ACC.impulse}, i)])) / LAND_SCALE;
}
/** The argmax winner's material, out of the low bits. @see bankLanding */
fn landMatAt(i: i32) -> u32 {
  let packed = atomicLoad(&acc[accAt(${ACC.mat}, i)]);
  return select(0u, u32(packed & 15), packed > 0);
}

/**
 * THE WATER, and the material it brought.
 *
 * The material is decided against the depth as it stood BEFORE any of this
 * step's landings, which is why the test comes before the add and not after.
 */
@compute @workgroup_size(${WORKGROUP}, ${WORKGROUP})
fn water(@builtin(global_invocation_id) gid: vec3<u32>) {
  let x = i32(gid.x);
  let y = i32(gid.y);
  if (x >= nx() || y >= ny()) { return; }
  let i = y * nx() + x;
  let came = landingAt(i);
  if (came <= 0.0) { return; }
  let mat = landMatAt(i);
  if (mat != 0u && depthAt(i) <= dryDepth()) { setMaterial(i, f32(mat)); }
  setDepth(i, depthAt(i) + came);
}

/**
 * How hard cell i pushes, and the most it may push an edge to.
 *
 * Beware the units — this is what got it wrong the first time. The sheet
 * arrives in HALF STEPS a second and the solver moves water in TILES a
 * second; a half step draws at an eighth of a tile -- half a column --
 * so ACROSS converts to columns and the cell size from columns to tiles.
 */
fn pushOf(i: i32) -> f32 {
  return impulseAt(i) * (${f(ACROSS)} * cellSize()) * ${f(PLUNGE_PUSH)} * 0.25;
}
fn capOf(i: i32) -> f32 {
  let h = depthAt(i);
  return h * ${f(PLUNGE_CAP)} * sqrt(gravity() * h);
}
/** Does this cell push at all? Nothing standing dry turns anything at a bed. */
fn pushes(i: i32) -> bool {
  return impulseAt(i) > 0.0 && depthAt(i) > dryDepth();
}
/** Only onto ground the water could reach. A plunge that pushes back up its
 *  own wall is a waterfall feeding itself. */
fn spillsTo(src: i32, to: i32) -> bool {
  return groundAt(to) < groundAt(src) + depthAt(src);
}

/** The push, per edge, asked of the two cells that can give it. */
@compute @workgroup_size(${WORKGROUP}, ${WORKGROUP})
fn push(@builtin(global_invocation_id) gid: vec3<u32>) {
  let x = i32(gid.x);
  let y = i32(gid.y);
  if (x >= nx() || y >= ny()) { return; }
  let i = y * nx() + x;

  var kx = 0.0;
  var cx = 0.0;
  if (x + 1 < nx()) {
    let j = i + 1;
    // In the CPU order: the near cell adds, then the far cell subtracts.
    if (pushes(i) && spillsTo(i, j)) { kx = kx + pushOf(i); cx = max(cx, capOf(i)); }
    if (pushes(j) && spillsTo(j, i)) { kx = kx - pushOf(j); cx = max(cx, capOf(j)); }
  }
  setKickX(i, kx);
  setCapX(i, cx);

  var ky = 0.0;
  var cy = 0.0;
  if (y + 1 < ny()) {
    let j = i + nx();
    if (pushes(i) && spillsTo(i, j)) { ky = ky + pushOf(i); cy = max(cy, capOf(i)); }
    if (pushes(j) && spillsTo(j, i)) { ky = ky - pushOf(j); cy = max(cy, capOf(j)); }
  }
  setKickY(i, ky);
  setCapY(i, cy);
}

/**
 * AND THE CLAMP, once per edge.
 *
 * A push can only ever move a flux AWAY from nought and never past the cap,
 * which is what the room said one arrival at a time.
 */
@compute @workgroup_size(${WORKGROUP}, ${WORKGROUP})
fn clampFlux(@builtin(global_invocation_id) gid: vec3<u32>) {
  let x = i32(gid.x);
  let y = i32(gid.y);
  if (x >= nx() || y >= ny()) { return; }
  let i = y * nx() + x;
  let kx = kickXAt(i);
  if (kx > 0.0) { setFx(i, max(fxAt(i), min(fxAt(i) + kx, capXAt(i)))); }
  else if (kx < 0.0) { setFx(i, min(fxAt(i), max(fxAt(i) + kx, -capXAt(i)))); }
  let ky = kickYAt(i);
  if (ky > 0.0) { setFy(i, max(fyAt(i), min(fyAt(i) + ky, capYAt(i)))); }
  else if (ky < 0.0) { setFy(i, min(fyAt(i), max(fyAt(i) + ky, -capYAt(i)))); }
}
`;

export type LandingsPass = {
  encode: (enc: GPUCommandEncoder, s: GpuState) => void;
  layout: GPUBindGroupLayout;
};

export function createLandings(device: GPUDevice): LandingsPass {
  const layout = stateLayout(device);
  const pipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [layout] });
  const module = device.createShaderModule({
    code: LANDINGS_WGSL, label: "landings",
  });
  const stages = ["water", "push", "clampFlux"].map((entryPoint) =>
    device.createComputePipeline({
      label: `landings:${entryPoint}`,
      layout: pipelineLayout,
      compute: { module, entryPoint },
    }));

  return {
    layout,
    encode: (enc, s) => {
      const gx = Math.ceil(s.nx / WORKGROUP);
      const gy = Math.ceil(s.ny / WORKGROUP);
      const pass = beginPass(enc, s, "landings");
      for (const pipeline of stages) {
        pass.setPipeline(pipeline);
        bindState(pass, s, layout);
        pass.dispatchWorkgroups(gx, gy);
      }
      pass.end();
    },
  };
}

export const landingsSource = () => LANDINGS_WGSL;
