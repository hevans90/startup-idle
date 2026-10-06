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
 * It runs over the box the landings FELL in now, which the falls pass keeps
 * as it banks them, so nothing banked is outside it. @see landOrigin
 */
import { PLUNGE_CAP, PLUNGE_PUSH } from "../columns";
import { ACROSS } from "../drips";
import { ACC, LAND_SCALE } from "./falls";
import { createIndirectRing } from "./indirect";
import {
  LAND_BOX_FAR, STATE_WGSL, beginPass, bindState, stateLayout, type GpuState, shaderModule,} from "./state";

const WORKGROUP = 8;

const f = (v: number) => (Number.isInteger(v) ? `${v}.0` : String(v));

const LANDINGS_WGSL = `
${STATE_WGSL}

// NO BACKTICKS IN HERE — see the note at the top of the shared header.

const LAND_SCALE: f32 = ${f(LAND_SCALE)};

fn accAt(region: i32, i: i32) -> i32 { return region * (nx() * ny() * slots()) + i; }

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
 * THE BOX THIS PASS RUNS OVER: everything that landed, and one column and one
 * row before it, since a column's push gathers the backward half from the
 * column after it. Every write this pass makes is to the column's own edges,
 * so a kick outside the box is stale and never read — the clamp runs over the
 * same box. @see landBoxAt, SIZE_WGSL
 */
fn landOrigin() -> vec4<i32> {
  let lb = landBoxAt();
  return vec4<i32>(
    max(0, ${LAND_BOX_FAR} - atomicLoad(&acc[lb]) - 1),
    max(0, ${LAND_BOX_FAR} - atomicLoad(&acc[lb + 1]) - 1),
    atomicLoad(&acc[lb + 2]) - 1,
    atomicLoad(&acc[lb + 3]) - 1,
  );
}

/**
 * THE WATER, and the material it brought.
 *
 * The material is decided against the depth as it stood BEFORE any of this
 * step's landings, which is why the test comes before the add and not after.
 */
@compute @workgroup_size(${WORKGROUP}, ${WORKGROUP})
fn water(@builtin(global_invocation_id) gid: vec3<u32>) {
  let o = landOrigin();
  let x = o.x + i32(gid.x);
  let y = o.y + i32(gid.y);
  if (x >= nx() || y >= ny() || x > o.z || y > o.w) { return; }
  let i = y * nx() + x;
  for (var a = 0; a < slots(); a = a + 1) {
    let ia = slotBase(a) + i;
    let came = landingAt(ia);
    if (came <= 0.0) { continue; }
    let mat = landMatAt(ia);
    if (mat != 0u && depthAt(ia) <= dryDepth()) { setMaterial(ia, f32(mat)); }
    setDepth(ia, depthAt(ia) + came);
  }
}

/**
 * How hard slot i pushes, and the most it may push an edge to.
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
/** Does this slot push at all? Nothing standing dry turns anything at a bed. */
fn pushes(i: i32) -> bool {
  return impulseAt(i) > 0.0 && depthAt(i) > dryDepth();
}

/**
 * WHICH PLANE a raw push should be written to, or -1 for nowhere.
 *
 * A head-driven flux works itself out: accelerate visits every plane and the
 * ones that are not joined come out nought. A plunge does not — it is
 * momentum written straight onto an edge, and an edge has to be chosen. So:
 * the joined plane with the most gap in it, which on a map with no decks is
 * the only plane there is. THE LARGEST AND NOT THE FIRST, so the answer does
 * not depend on the order the slots happen to be numbered in. The twin of
 * pushPlane in fluid/columns.
 */
fn pushPlaneOf(i: i32, axis: i32, a: i32, back: bool, surface: f32) -> i32 {
  let x = i % nx();
  let y = i / nx();
  let step = select(nx(), 1, axis == 0);
  let jx = select(x, select(x + 1, x - 1, back), axis == 0);
  let jy = select(select(y + 1, y - 1, back), y, axis == 0);
  if (jx < 0 || jy < 0 || jx >= nx() || jy >= ny()) { return -1; }
  let j = select(i + step, i - step, back);
  let ia = slotBase(a) + i;
  var best = -1;
  var most = 0.0;
  for (var b = 0; b < slots(); b = b + 1) {
    let jb = slotBase(b) + j;
    // AND ONLY ONTO GROUND THE WATER COULD GET TO, which is the test this has
    // always made: a crater is a raw flux rather than something a head drove,
    // so at the foot of a cliff it would otherwise shove water UP the face.
    if (groundAt(jb) >= surface) { continue; }
    let lo = max(groundAt(ia), groundAt(jb));
    let hi = min(roofAt(ia), roofAt(jb));
    if (hi - lo > most) { most = hi - lo; best = b; }
  }
  if (best < 0) { return -1; }
  // On the way BACK the edge belongs to the neighbour, so the near side of it
  // is the neighbour's slot and this one is the far side.
  return select(pairBase(a, best) + i, pairBase(best, a) + j, back);
}

/**
 * The push, per edge — AND EVERY INVOCATION WRITES ONLY ITS OWN EDGES.
 *
 * The CPU walks slots and writes four edges from each: two of its own and two
 * belonging to the neighbour it pushed back against. Transcribed straight onto
 * the device that is a data race, and a bad one, because it is two races at
 * once. Each invocation cleared its own edges in the same dispatch it wrote
 * the neighbour's, so a clear could land after a write and erase it; and an
 * edge has TWO authors — the column on its near side pushing forward and the
 * column on its far side pushing back — doing an unsynchronised read-add-write
 * on the same float. Whichever lost, lost silently.
 *
 * It had been there since the pass was written and no scene had asked: a lip
 * has to land water in two columns that share an edge before either race can
 * fire at all. The spanned scene does, at the mouth of the bridge, and the y flux came
 * out 0.174 different against a rounding floor of 1e-7 — stably, run after
 * run, because a GPU schedules a fixed dispatch the same way every time and a
 * race that always loses the same way looks exactly like a rule that is wrong.
 *
 * So the backward half is GATHERED instead of scattered. An edge on my column
 * takes the forward push from my own slot and the backward push from the
 * column beyond it, and I read that neighbour rather than letting it write me.
 * Nothing crosses an invocation, so there is nothing to synchronise, and the
 * sum is the same two terms in the same order. @see applyLandings
 */
@compute @workgroup_size(${WORKGROUP}, ${WORKGROUP})
fn push(@builtin(global_invocation_id) gid: vec3<u32>) {
  let o = landOrigin();
  let x = o.x + i32(gid.x);
  let y = o.y + i32(gid.y);
  if (x >= nx() || y >= ny() || x > o.z || y > o.w) { return; }
  let i = y * nx() + x;
  let L = slots();

  // EVERY PLANE OF THIS COLUMN'S TWO EDGES, cleared then filled: a plane
  // nobody pushes has to end at nought or it keeps last step's kick.
  for (var a = 0; a < L; a = a + 1) {
    for (var b = 0; b < L; b = b + 1) {
      let e = pairBase(a, b) + i;
      setKickX(e, 0.0);
      setCapX(e, 0.0);
      setKickY(e, 0.0);
      setCapY(e, 0.0);
    }
  }
  // MY OWN SLOTS, PUSHING FORWARD, which land on my own edges.
  for (var a = 0; a < L; a = a + 1) {
    let ia = slotBase(a) + i;
    if (pushes(ia)) {
      let surface = groundAt(ia) + depthAt(ia);
      let e = pushPlaneOf(i, 0, a, false, surface);
      if (e >= 0) { setKickX(e, kickXAt(e) + pushOf(ia)); setCapX(e, max(capXAt(e), capOf(ia))); }
      let so = pushPlaneOf(i, 1, a, false, surface);
      if (so >= 0) { setKickY(so, kickYAt(so) + pushOf(ia)); setCapY(so, max(capYAt(so), capOf(ia))); }
    }
  }
  // AND THE COLUMN BEYOND EACH EDGE, PUSHING BACK ONTO IT. pushPlaneOf with
  // back set returns an edge on the NEAR column, which is this one — so asking
  // the neighbour's question here writes the same float the neighbour would
  // have written, without the neighbour reaching across to do it.
  for (var b = 0; b < L; b = b + 1) {
    if (x + 1 < nx()) {
      let jb = slotBase(b) + i + 1;
      if (pushes(jb)) {
        let surface = groundAt(jb) + depthAt(jb);
        let w = pushPlaneOf(i + 1, 0, b, true, surface);
        if (w >= 0) { setKickX(w, kickXAt(w) - pushOf(jb)); setCapX(w, max(capXAt(w), capOf(jb))); }
      }
    }
    if (y + 1 < ny()) {
      let jb = slotBase(b) + i + nx();
      if (pushes(jb)) {
        let surface = groundAt(jb) + depthAt(jb);
        let no = pushPlaneOf(i + nx(), 1, b, true, surface);
        if (no >= 0) { setKickY(no, kickYAt(no) - pushOf(jb)); setCapY(no, max(capYAt(no), capOf(jb))); }
      }
    }
  }
}

/**
 * AND THE CLAMP, once per edge.
 *
 * A push can only ever move a flux AWAY from nought and never past the cap,
 * which is what the room said one arrival at a time.
 */
@compute @workgroup_size(${WORKGROUP}, ${WORKGROUP})
fn clampFlux(@builtin(global_invocation_id) gid: vec3<u32>) {
  let o = landOrigin();
  let x = o.x + i32(gid.x);
  let y = o.y + i32(gid.y);
  if (x >= nx() || y >= ny() || x > o.z || y > o.w) { return; }
  let i = y * nx() + x;
  let L = slots();
  for (var a = 0; a < L; a = a + 1) {
    for (var b = 0; b < L; b = b + 1) {
      let e = pairBase(a, b) + i;
      let kx = kickXAt(e);
      if (kx > 0.0) { setFx(e, max(fxAt(e), min(fxAt(e) + kx, capXAt(e)))); }
      else if (kx < 0.0) { setFx(e, min(fxAt(e), max(fxAt(e) + kx, -capXAt(e)))); }
      let ky = kickYAt(e);
      if (ky > 0.0) { setFy(e, max(fyAt(e), min(fyAt(e) + ky, capYAt(e)))); }
      else if (ky < 0.0) { setFy(e, min(fyAt(e), max(fyAt(e) + ky, -capYAt(e)))); }
    }
  }
}
`;

/**
 * THE DISPATCH, SIZED BY THE DEVICE, as the falls' is. It ran three
 * dispatches over the whole map every substep — 1.4 ms of GPU on a flooded
 * 204 tile map — to put in landings that fell on a few hundred columns. The
 * whole map and not the active box, for a reason that still holds: a lip can
 * throw its water outside the box. The box the landings actually fell in has
 * no such problem. Read here, after the falls have banked, in a pass of its
 * own, into arguments of their own. @see landOrigin, createIndirectRing
 */
const SIZE_WGSL = `
@group(0) @binding(0) var<storage, read> acc: array<i32>;
@group(0) @binding(1) var<storage, read_write> args: array<u32>;
@group(0) @binding(2) var<uniform> at: vec4<i32>;

fn span(lo: i32, hi: i32) -> u32 {
  if (hi < lo) { return 0u; }
  return u32((hi - lo + ${WORKGROUP}) / ${WORKGROUP});
}

@compute @workgroup_size(1)
fn main() {
  let lb = at.x;
  let x0 = max(0, ${LAND_BOX_FAR} - acc[lb] - 1);
  let y0 = max(0, ${LAND_BOX_FAR} - acc[lb + 1] - 1);
  args[0] = span(x0, acc[lb + 2] - 1);
  args[1] = span(y0, acc[lb + 3] - 1);
  args[2] = 1u;
}
`;

export type LandingsPass = {
  encode: (enc: GPUCommandEncoder, s: GpuState) => void;
  layout: GPUBindGroupLayout;
};

export function createLandings(device: GPUDevice): LandingsPass {
  const layout = stateLayout(device);
  const pipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [layout] });
  const module = shaderModule(device, LANDINGS_WGSL, "landings");
  const stages = ["water", "push", "clampFlux"].map((entryPoint) =>
    device.createComputePipeline({
      label: `landings:${entryPoint}`,
      layout: pipelineLayout,
      compute: { module, entryPoint },
    }));
  const sizeLayout = device.createBindGroupLayout({
    label: "landings:size",
    entries: [
      { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: "read-only-storage" } },
      { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } },
      { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: "uniform" } },
    ],
  });
  const sizer = device.createComputePipeline({
    label: "landings:size",
    layout: device.createPipelineLayout({ bindGroupLayouts: [sizeLayout] }),
    compute: { module: shaderModule(device, SIZE_WGSL, "landings:size"), entryPoint: "main" },
  });
  /** Where the box sits in acc, per state: fixed for the state's life. */
  const ats = new WeakMap<GpuState, GPUBuffer>();
  const atOf = (s: GpuState) => {
    let at = ats.get(s);
    if (at) return at;
    at = device.createBuffer({
      size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      label: "landings:at",
    });
    device.queue.writeBuffer(at, 0, new Int32Array([s.cells * s.layers * 4, 0, 0, 0]));
    ats.set(s, at);
    return at;
  };
  // @see createIndirectRing, for why not one buffer.
  const ring = createIndirectRing(device, "landings", sizeLayout, (key, args) => {
    const s = key as GpuState;
    return [
      { binding: 0, resource: { buffer: s.acc } },
      { binding: 1, resource: { buffer: args } },
      { binding: 2, resource: { buffer: atOf(s) } },
    ];
  });

  return {
    layout,
    encode: (enc, s) => {
      const { args, bound } = ring.next(s);
      const size = enc.beginComputePass({ label: "landings:size" });
      size.setPipeline(sizer);
      size.setBindGroup(0, bound);
      size.dispatchWorkgroups(1);
      size.end();
      const pass = beginPass(enc, s, "landings");
      for (const pipeline of stages) {
        pass.setPipeline(pipeline);
        bindState(pass, s, layout);
        pass.dispatchWorkgroupsIndirect(args, 0);
      }
      pass.end();
    },
  };
}

export const landingsSource = () => LANDINGS_WGSL;
