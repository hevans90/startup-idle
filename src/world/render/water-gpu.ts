/**
 * World v2 — the water surface built in a VERTEX SHADER, as a measurement.
 *
 * A prototype behind `?gpuwater=1`, not a replacement. The CPU mesh builder in
 * `water.ts` is still the one that ships and the one the tests hold to
 * account; this exists to put a number on what moving it to the GPU is worth.
 *
 * WHAT IT MOVES. Measured on a flooded 64² map, `drawWater` costs 9.15ms: the
 * two carried fields 2.14ms, working the corners out 3.29ms, and writing the
 * vertices 3.71ms. The last two are 7ms of arithmetic whose entire life is to
 * become bytes the GPU reads once — computed on the CPU, uploaded as 3.1MB of
 * vertices, thrown away, done again next frame. A vertex shader computes them
 * where they are used, and the only thing crossing the bus is the state the
 * simulation already holds.
 *
 * NOTHING IS COPIED TO UPLOAD IT. Every texture here is a view straight onto
 * the solver's own arrays — depth, ground, the two fluxes, the two carried
 * fields — so a frame's cost is the DMA and no CPU touches the data at all.
 * That is why the state goes up as six single-channel textures rather than one
 * packed four-channel one: packing would mean interleaving half a million
 * floats a frame, which is the sort of work this is meant to be getting rid
 * of.
 *
 * HOW IT IS SHAPED. The draw is PROCEDURAL. Every band draws a fixed run of
 * vertices and each one works out from its own index which tile of the band it
 * belongs to, which column of that tile, and which corner of that column, then
 * reads the simulation out of the textures and computes its own position and
 * colour. The vertex and index buffers are built once and shared by all 127
 * bands, so there is no per-frame geometry at all.
 *
 * A dry column collapses its quad to a point: a vertex shader invocation and
 * no fragments. That is the one place this is wasteful where the CPU version
 * is not — the CPU walks the wet columns and this walks all of them, so a
 * nearly dry map costs it the same as a flooded one. On the map being measured
 * they are the same map.
 *
 * WHY PER BAND. The scene is sorted by diagonal band, because water draws
 * between the terrain behind it and the structures in front of it, so one draw
 * for the whole map would put every drop either in front of everything or
 * behind it. A band is `x + y` in tiles, so its tiles are `(tx, b - tx)` over a
 * range, and that range is all a vertex needs to find itself.
 *
 * WHAT IT DOES NOT DO. Side faces and falls are still the CPU's — they are
 * conditional geometry, and a procedural draw would have to allocate for the
 * worst case whether or not it is there. On a flooded map they are a small
 * part of the work, which is exactly why this measures the surface first.
 */
import {
  Buffer, BufferImageSource, BufferUsage, Geometry, GlProgram, GpuProgram, Mesh,
  Shader, TextureSource, UniformGroup,
} from "pixi.js";

import { activeBox, MATERIAL_SLOTS, MAX_FLOW_SPEED } from "../../fluid/columns";
import { RIM, cornerRuleSource } from "./corner-rule";
import { FALL_MIN } from "../../fluid/falls";
import { fluidMaterial } from "../water/materials";
import { COLUMNS_PER_TILE, type WaterField } from "../water/field";
import { HEIGHT_UNIT, HH, HW } from "../iso";
import type { BandLayer } from "./bands";
import { createFlowWash, stepFlowWash, type FlowWash } from "./flow-wash";
import { createFoam, stepFoam, type FoamField } from "./foam";

/**
 * Does the water draw on the GPU? Yes, unless `?cpuwater=1` says otherwise.
 *
 * The CPU builder in `water.ts` is still here and still the reference the
 * render tests hold to account — it is not dead code, it is the answer this
 * path is checked against. The flag is how to get back to it: to compare the
 * two on a scene, and to have somewhere to stand if this one turns out to be
 * wrong about something on hardware nobody here has.
 *
 * Measured on a 64² map, both paths in the same session: an empty map costs
 * neither of them anything, a small pond costs this one about 0.4ms MORE, and
 * a flooded map costs it 3.8ms against 26.9ms. The small pond is the price of
 * a procedural draw — it walks what could exist rather than what does — and it
 * is worth paying for the other end of the range.
 */
export function waterOnGpu(): boolean {
  if (typeof location === "undefined") return true;
  return !new URLSearchParams(location.search).has("cpuwater");
}

/**
 * Everything about how water is SHADED comes from the CPU builder.
 *
 * Not copied — imported. Two copies of the corner logic is what put a hairline
 * of grass along every dip in the bed on this path and not on that one: the
 * rule changed in one place and not the other. Anything both paths have to
 * agree about lives in `water.ts` and is read from here.
 */
import {
  DRAWDOWN, FOAM_COVER, FOAM_TINTS, FOAM_WHITE, LIGHTEST,
  OPAQUE_DEPTH, SHADES, SHOW_DEPTH, SLOPE_REF, STREAK_SPEED, TINTS,
} from "./water";

const PER_TILE = COLUMNS_PER_TILE * COLUMNS_PER_TILE;
/**
 * Quads a column gets: its surface and its two visible SIDES.
 *
 * The FALLS used to be two more. They are their own layer now, because water
 * thrown off a lip travels toward the camera as it drops and lands in a
 * different band from the column it left — which is the one thing a mesh
 * sorted by column cannot express. See `render/falls-render`.
 *
 * Allocated whether or not they are there, because a procedural draw has no
 * way to skip: a part that is not drawn collapses its four vertices onto one
 * point, which costs four vertex shader invocations and no fragments. That is
 * the trade this path makes everywhere — the CPU builder walks what exists,
 * this walks what could exist.
 */
const PARTS = 5;

/**
 * Why FIVE and not three.
 *
 * A side face hangs DOWN from the surface, so a face on a tile's far edge
 * pokes into the diamond of the tile in FRONT of it — whose terrain is a later
 * band and paints over it. On flat water nothing shows, because the tile in
 * front is at the same level and its own water covers the same strip; at a LIP
 * it is six half steps down and covers nothing there, so the ground shows
 * through the sheet in band-shaped bites, one per band, each as tall as the
 * water is deep.
 *
 * The CPU builder simply files those quads into the next band's batch. This
 * path cannot: a band's mesh IS its band, and a slot can only choose what to
 * draw, not where to put it. So a band draws two more parts — the far-edge
 * faces of the columns BEHIND it, which is the same thing said the only way a
 * procedural draw can say it.
 *
 * They are idle for every column that is not on a tile boundary, which is
 * three in four of them, and idle again wherever the ground in front is not
 * below the water. An idle part collapses to a point: four vertex invocations
 * and no fragments, the trade this whole path is built on.
 */

const WGSL = /* wgsl */ `
struct GlobalUniforms {
  uProjectionMatrix: mat3x3<f32>,
  uWorldTransformMatrix: mat3x3<f32>,
  uWorldColorAlpha: vec4<f32>,
  uResolution: vec2<f32>,
};
@group(0) @binding(0) var<uniform> globalUniforms : GlobalUniforms;

struct LocalUniforms {
  uTransformMatrix: mat3x3<f32>,
  uColor: vec4<f32>,
  uRound: f32,
};
@group(1) @binding(0) var<uniform> localUniforms : LocalUniforms;

struct Water {
  uGrid: vec4<f32>,       // nx, ny, columns per tile, 1 / columns per tile
  uIso: vec4<f32>,        // HW, HH, HEIGHT_UNIT (all scaled), faces on
  uBand: vec4<f32>,       // band, first tile x, dry depth, tiles in this band
};
@group(2) @binding(0) var<uniform> water : Water;
@group(2) @binding(1) var uDepth : texture_2d<f32>;
@group(2) @binding(2) var uGround : texture_2d<f32>;
@group(2) @binding(3) var uWash : texture_2d<f32>;
@group(2) @binding(4) var uFoam : texture_2d<f32>;
@group(2) @binding(5) var uFx : texture_2d<f32>;
@group(2) @binding(6) var uFy : texture_2d<f32>;
@group(2) @binding(7) var uTint : texture_2d<f32>;
@group(2) @binding(8) var uMaterial : texture_2d<f32>;

struct VSOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) vColor: vec4<f32>,
};

fn depthAt(x: i32, y: i32) -> f32 { return textureLoad(uDepth, vec2<i32>(x, y), 0).r; }
fn groundAt(x: i32, y: i32) -> f32 { return textureLoad(uGround, vec2<i32>(x, y), 0).r; }
/** The four things the shared corner rule asks its host for. */
fn dryDepth() -> f32 { return water.uBand.z; }
fn fallMin() -> f32 { return ${FALL_MIN}.0; }
/** Whether the sides of the water are drawn at all — a debug switch. */
fn facesOn() -> bool { return water.uIso.w > 0.5; }

fn inside(x: i32, y: i32) -> bool {
  return x >= 0 && y >= 0 && x < i32(water.uGrid.x) && y < i32(water.uGrid.y);
}

${cornerRuleSource("wgsl", DRAWDOWN)}

/** Flux over a depth FLOOR, clamped — flowX and flowY, in the shader. */
fn flowAt(cx: i32, cy: i32, d: f32) -> vec2<f32> {
  let by = max(d, water.uBand.z * 8.0);
  var west = 0.0;
  if (cx > 0) { west = textureLoad(uFx, vec2<i32>(cx - 1, cy), 0).r; }
  var north = 0.0;
  if (cy > 0) { north = textureLoad(uFy, vec2<i32>(cx, cy - 1), 0).r; }
  let vx = (west + textureLoad(uFx, vec2<i32>(cx, cy), 0).r) * 0.5 / by;
  let vy = (north + textureLoad(uFy, vec2<i32>(cx, cy), 0).r) * 0.5 / by;
  return clamp(vec2<f32>(vx, vy), vec2<f32>(-${MAX_FLOW_SPEED}.0), vec2<f32>(${MAX_FLOW_SPEED}.0));
}

/** Depth, wash, foam and flow speed, averaged over the same contributors. */
fn cornerExtras(vx: i32, vy: i32) -> vec4<f32> {
  var d = 0.0; var wash = 0.0; var foam = 0.0; var n = 0.0;
  var vel = vec2<f32>(0.0, 0.0);
  var bed = -1000.0;
  for (var k = 0; k < 4; k = k + 1) {
    let cx = vx - 1 + (k & 1);
    let cy = vy - 1 + (k >> 1);
    if (!inside(cx, cy)) { continue; }
    let dd = depthAt(cx, cy);
    if (dd <= water.uBand.z) { continue; }
    // THE EXTRAS FOLLOW THE BED, the same way the corner's height does — see
    // water.ts's cornerValues, which is this. Averaged over both groups, the
    // last corner before a lip took much of its colour from the water at the
    // foot of the cliff, and that is the hard seam at the top of a fall.
    let g = groundAt(cx, cy);
    if (g < bed) { continue; }
    if (g > bed) { d = 0.0; wash = 0.0; foam = 0.0; n = 0.0;
      vel = vec2<f32>(0.0, 0.0); bed = g; }
    // A lip is not a shoreline — see corner-rule's atBrink, and water.ts's
    // shownDepth, which is this.
    d = d + max(dd, ${SHOW_DEPTH} * atBrink(cx, cy));
    wash = wash + textureLoad(uWash, vec2<i32>(cx, cy), 0).r;
    foam = foam + textureLoad(uFoam, vec2<i32>(cx, cy), 0).r;
    vel = vel + flowAt(cx, cy, dd);
    n = n + 1.0;
  }
  if (n == 0.0) { return vec4<f32>(0.0, 0.0, 0.0, 0.0); }
  return vec4<f32>(d / n, wash / n, foam / n, length(vel / n));
}

/** A neighbouring corner's surface, or this one's where there is no water. */
fn nearby(vx: i32, vy: i32, fallback: f32) -> f32 {
  let c = cornerOf(vx, vy);
  return select(fallback, c.x, c.w > 0.0);
}

/** A shade off the fluid's own ramp, the way the CPU builder lightens one. */
fn aerated(mat: i32, t: f32) -> vec3<f32> {
  let k = clamp(t / ${LIGHTEST}, 0.0, 1.0) * ${TINTS - 1}.0;
  return textureLoad(uTint, vec2<i32>(i32(k + 0.5), mat), 0).rgb;
}

/** How fast this column is going, nought to one. */
fn pace(cx: i32, cy: i32, d: f32) -> f32 {
  let v = flowAt(cx, cy, d);
  return min(1.0, (abs(v.x) + abs(v.y)) * 0.5);
}

struct Part {
  ok: bool,
  fx: f32,
  fy: f32,
  h: f32,
  colour: vec3<f32>,
  alpha: f32,
};

/**
 * The SIDE of the water on this column: its surface down to the ground it is
 * standing on, and no further.
 *
 * Down to where the NEIGHBOUR'S OWN quad reaches, corner for corner, and no
 * lower than this column's bed, because below that is rock. Read off what is
 * actually drawn rather than guessed at, which is the only way it cannot leave
 * a gap — see the long note the CPU builder carries.
 */
/**
 * Is this face filed FORWARD, into the band of the tile in front? See PARTS.
 *
 * Only on a tile's own far edge — an interior face never crosses a band
 * boundary — and only where the ground in front is BELOW this water, because a
 * tile in front that stands higher is genuinely in front and its terrain
 * covering the face is the band order doing its job.
 *
 * The sub-index is worked out here rather than handed in, so that asking about
 * the column BEHIND cannot be asked with the wrong one.
 */
fn forward(cx: i32, cy: i32, axis: i32, cpt: i32) -> bool {
  let onEdge = select(cy % cpt, cx % cpt, axis == 0) == cpt - 1;
  if (!onEdge) { return false; }
  let jx = cx + select(0, 1, axis == 0);
  let jy = cy + select(1, 0, axis == 0);
  if (!inside(jx, jy)) { return false; }
  return groundAt(jx, jy) < groundAt(cx, cy) + depthAt(cx, cy);
}

fn sidePart(cx: i32, cy: i32, axis: i32, corner: i32, fx0: f32, fy0: f32, step: f32, d: f32) -> Part {
  var p: Part;
  p.ok = false;
  let jx = cx + select(0, 1, axis == 0);
  let jy = cy + select(1, 0, axis == 0);
  // THE RIM OF THE MAP IS NOT A NEIGHBOUR. This used to return here, and water
  // running to the edge came out a sheet with a void under it. The edge is
  // treated as dry ground at this column's own level, which is what takes the
  // body all the way down to the bed it stands on.
  let rim = !inside(jx, jy);
  let bed = groundAt(cx, cy);
  let bedJ = select(groundAt(jx, jy), bed, rim);
  let wetJ = !rim && depthAt(jx, jy) > dryDepth();

  // The edge: east runs (fx1,fy0)-(fx1,fy1), south runs (fx0,fy1)-(fx1,fy1).
  let ax = select(fx0, fx0 + step, axis == 0);
  let ay = select(fy0 + step, fy0, axis == 0);
  let vax = cx + select(0, 1, axis == 0);
  let vay = cy + select(1, 0, axis == 0);

  // Where it starts and where it reaches down to — the shared rule.
  let s = resolveSide(bed, bedJ, wetJ, cornerOf(vax, vay), cornerOf(cx + 1, cy + 1));

  // Corners run round the face: top A, top B, foot B, foot A.
  let onA = corner == 0 || corner == 3;
  let onTop = corner == 0 || corner == 1;
  p.fx = select(fx0 + step, ax, onA);
  p.fy = select(fy0 + step, ay, onA);
  let top = select(s.y, s.x, onA);
  let foot = select(s.w, s.z, onA);
  p.h = select(foot, top, onTop);

  // Barely lightened: this is the side of a body of water seen edge on, not
  // spray. Whitened as hard as a fall it came out near white, and a ring of
  // near-white round every pool on a plateau read as a panel stuck to the rock.
  let mat = i32(textureLoad(uMaterial, vec2<i32>(cx, cy), 0).r * 255.0 + 0.5);
  p.colour = aerated(mat, 0.08 + pace(cx, cy, d) * 0.14);
  // The same ramp the surface uses, on the water standing at this edge: you
  // see through the side of a puddle and not through the side of a lake. Flat
  // at a third of an alpha, a deep body read as a sheet over a void — the
  // faces were there, and what you saw through them was the grass. The same
  // top to bottom, too: grading the waterline lighter is the physical story
  // and reads worse, because it puts the ground's colour through the top half
  // of every edge.
  // Floored at a brink, the same as the surface — see corner-rule's atBrink.
  let sd = max(d, ${SHOW_DEPTH} * atBrink(cx, cy));
  let body = (0.30 + 0.62 * min(1.0, sd / ${OPAQUE_DEPTH}.0)) * min(1.0, sd / ${SHOW_DEPTH});
  // HANDED OVER TO THE SHEET AT A LIP — see water.ts's sideFace, which is
  // this. A face is a pane of water, and a pane is only one of the three ways
  // water is bounded: a shore's corner has already come down to its bed, the
  // map's edge is an honest cut, and a LIP is bounded by the sheet leaving it.
  let beside = select(bedJ, bedJ + depthAt(jx, jy), wetJ);
  p.alpha = body * (1.0 - ${RIM}.0 * spillAt(bed, beside));
  p.ok = true;
  return p;
}

@vertex
fn mainVertex(@location(0) aVertexId: f32) -> VSOutput {
  let cpt = i32(water.uGrid.z);
  let per = cpt * cpt;
  let vi = i32(aVertexId);
  let quad = vi >> 2;
  let corner = vi & 3;
  let part = quad % ${PARTS};
  let slot = quad / ${PARTS};
  let tileIdx = slot / per;
  let sub = slot % per;

  var out: VSOutput;
  out.position = vec4<f32>(0.0, 0.0, 0.0, 1.0);
  out.vColor = vec4<f32>(0.0, 0.0, 0.0, 0.0);
  if (f32(tileIdx) >= water.uBand.w) { return out; }

  let tx = i32(water.uBand.y) + tileIdx;
  let ty = i32(water.uBand.x) - tx;
  let sx = sub % cpt;
  let sy = sub / cpt;
  let cx = tx * cpt + sx;
  let cy = ty * cpt + sy;
  if (!inside(cx, cy)) { return out; }

  let d = depthAt(cx, cy);
  let step = water.uGrid.w;
  let fx0 = f32(tx) - 0.5 + f32(sx) * step;
  let fy0 = f32(ty) - 0.5 + f32(sy) * step;

  var fx = 0.0;
  var fy = 0.0;
  var h = 0.0;
  var rgb = vec3<f32>(0.0);
  var alpha = 0.0;

  if (part == 0) {
    // THE SURFACE.
    if (d <= water.uBand.z) { return out; }
    let ox = ((corner + 1) >> 1) & 1;
    let oy = corner >> 1;
    let c = cornerOf(cx + ox, cy + oy);
    let bed = groundAt(cx, cy);
    h = max(levelAt(c, bed), bed);
    fx = fx0 + f32(ox) * step;
    fy = fy0 + f32(oy) * step;

    let e = cornerExtras(cx + ox, cy + oy);
    let cd = e.x; let wash = e.y; let foam = e.z; let speed = e.w;
    let gx = nearby(cx + ox - 1, cy + oy, c.x) - nearby(cx + ox + 1, cy + oy, c.x);
    let gy = nearby(cx + ox, cy + oy - 1, c.x) - nearby(cx + ox, cy + oy + 1, c.x);
    let lean = (gx + gy) * 0.5;
    let respond = lean / (abs(lean) + ${SLOPE_REF});
    let rough = min(1.0, (abs(gx) + abs(gy)) / ${SLOPE_REF * 2});
    let shown = max(rough, min(1.0, speed / ${STREAK_SPEED}));
    let lit = 0.5 + respond * 0.34 + wash * (0.2 + 0.8 * shown) * 0.3;
    let base = clamp(lit, 0.0, 1.0) * ${TINTS - 1}.0;
    let shade = base + foam * (${SHADES - 1}.0 - base);
    let fade = min(1.0, cd / ${SHOW_DEPTH});
    let body = (0.30 + 0.62 * min(1.0, cd / ${OPAQUE_DEPTH}.0)) * fade;
    alpha = body + (1.0 - body) * foam * ${FOAM_COVER} * fade;
    let mat = i32(textureLoad(uMaterial, vec2<i32>(cx, cy), 0).r * 255.0 + 0.5);
    rgb = textureLoad(uTint, vec2<i32>(i32(shade + 0.5), mat), 0).rgb;
  } else if (part <= 2) {
    // A SIDE of this column. Hung from the very corners the surface quad
    // used, so the two share vertices and there is no seam between them.
    // Skipped where it is filed FORWARD instead — see PARTS.
    if (d <= water.uBand.z) { return out; }
    if (!facesOn()) { return out; }
    let axis = part - 1;
    if (forward(cx, cy, axis, cpt)) { return out; }
    let p = sidePart(cx, cy, axis, corner, fx0, fy0, step, d);
    if (!p.ok) { return out; }
    fx = p.fx; fy = p.fy; h = p.h; rgb = p.colour; alpha = p.alpha;
  } else {
    // The far-edge face of the column BEHIND this one, filed into this band
    // because that is the diamond it hangs into — see PARTS.
    if (!facesOn()) { return out; }
    let axis = part - 3;
    let bx = cx - select(0, 1, axis == 0);
    let by = cy - select(1, 0, axis == 0);
    if (!inside(bx, by)) { return out; }
    let bd = depthAt(bx, by);
    if (bd <= water.uBand.z) { return out; }
    if (!forward(bx, by, axis, cpt)) { return out; }
    let p = sidePart(bx, by, axis, corner,
      fx0 - select(0.0, step, axis == 0), fy0 - select(step, 0.0, axis == 0), step, bd);
    if (!p.ok) { return out; }
    fx = p.fx; fy = p.fy; h = p.h; rgb = p.colour; alpha = p.alpha;
  }

  let px = (fx - fy) * water.uIso.x;
  let py = (fx + fy) * water.uIso.y - h * water.uIso.z;
  let mvp = globalUniforms.uProjectionMatrix
          * globalUniforms.uWorldTransformMatrix
          * localUniforms.uTransformMatrix;
  let clip = mvp * vec3<f32>(px, py, 1.0);
  out.position = vec4<f32>(clip.xy, 0.0, 1.0);
  out.vColor = vec4<f32>(rgb * alpha, alpha)
             * localUniforms.uColor
             * globalUniforms.uWorldColorAlpha;
  return out;
}
`;

const FRAGMENT_WGSL = /* wgsl */ `
@fragment
fn mainFragment(@location(0) vColor: vec4<f32>) -> @location(0) vec4<f32> {
  return vColor;
}
`;

/**
 * The same shader again for WebGL2, because a browser without WebGPU has to
 * get water and not a blank map.
 *
 * It is a transliteration and deliberately nothing cleverer: the same
 * functions in the same order doing the same arithmetic, so that a change to
 * one is an obvious change to the other. `textureLoad` becomes `texelFetch`,
 * `select(f, t, c)` becomes `c ? t : f`, and the uniform group arrives as
 * plain uniforms rather than a struct — Pixi uploads a uniform group field by
 * field on this backend instead of as a buffer.
 *
 * The floats survive the trip. `r32float` maps to `R32F`/`RED`/`FLOAT`, which
 * WebGL2 has in core, and `texelFetch` never filters, so the one thing that
 * needs saying is said at `viewOf`: the textures have to be NEAREST or the
 * driver calls them incomplete and hands back black.
 */
const VERTEX_GLSL = /* glsl */ `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;

in float aVertexId;
out vec4 vColor;

// PLAIN uniforms, not a block. Pixi hands the globals to a WebGL program one
// at a time — its own shaders are built that way, in globalUniformsBitGl — and
// the block form is only ever used where it binds a buffer to match. Declared
// as a block here, nothing binds it: the driver says "used but unbound uniform
// buffer" and drops the draw, which is water that does not appear at all on
// WebGL while looking perfect on WebGPU.
uniform mat3 uProjectionMatrix;
uniform mat3 uWorldTransformMatrix;
uniform vec4 uWorldColorAlpha;
uniform vec2 uResolution;
uniform mat3 uTransformMatrix;
uniform vec4 uColor;

uniform vec4 uGrid;
uniform vec4 uIso;
uniform vec4 uBand;

uniform sampler2D uDepth;
uniform sampler2D uGround;
uniform sampler2D uWash;
uniform sampler2D uFoam;
uniform sampler2D uFx;
uniform sampler2D uFy;
uniform sampler2D uTint;
uniform sampler2D uMaterial;

float depthAt(int x, int y) { return texelFetch(uDepth, ivec2(x, y), 0).r; }
float groundAt(int x, int y) { return texelFetch(uGround, ivec2(x, y), 0).r; }
float dryDepth() { return uBand.z; }
float fallMin() { return ${FALL_MIN}.0; }
bool facesOn() { return uIso.w > 0.5; }
// WGSL has this and GLSL does not. One helper is cheaper than teaching the
// shared rule about two ways of writing a conditional.
float select(float a, float b, bool c) { return c ? b : a; }

bool inside(int x, int y) {
  return x >= 0 && y >= 0 && x < int(uGrid.x) && y < int(uGrid.y);
}

${cornerRuleSource("glsl", DRAWDOWN)}

vec2 flowAt(int cx, int cy, float d) {
  float by = max(d, uBand.z * 8.0);
  float west = cx > 0 ? texelFetch(uFx, ivec2(cx - 1, cy), 0).r : 0.0;
  float north = cy > 0 ? texelFetch(uFy, ivec2(cx, cy - 1), 0).r : 0.0;
  float vx = (west + texelFetch(uFx, ivec2(cx, cy), 0).r) * 0.5 / by;
  float vy = (north + texelFetch(uFy, ivec2(cx, cy), 0).r) * 0.5 / by;
  return clamp(vec2(vx, vy), vec2(-${MAX_FLOW_SPEED}.0), vec2(${MAX_FLOW_SPEED}.0));
}

vec4 cornerExtras(int vx, int vy) {
  float d = 0.0; float wash = 0.0; float foam = 0.0; float n = 0.0;
  vec2 vel = vec2(0.0);
  float bed = -1000.0;
  for (int k = 0; k < 4; ++k) {
    int cx = vx - 1 + (k & 1);
    int cy = vy - 1 + (k >> 1);
    if (!inside(cx, cy)) { continue; }
    float dd = depthAt(cx, cy);
    if (dd <= uBand.z) { continue; }
    // The extras follow the BED — see the WGSL twin.
    float g = groundAt(cx, cy);
    if (g < bed) { continue; }
    if (g > bed) { d = 0.0; wash = 0.0; foam = 0.0; n = 0.0;
      vel = vec2(0.0); bed = g; }
    // A lip is not a shoreline — see corner-rule's atBrink, and water.ts's
    // shownDepth, which is this.
    d += max(dd, ${SHOW_DEPTH} * atBrink(cx, cy));
    wash += texelFetch(uWash, ivec2(cx, cy), 0).r;
    foam += texelFetch(uFoam, ivec2(cx, cy), 0).r;
    vel += flowAt(cx, cy, dd);
    n += 1.0;
  }
  if (n == 0.0) { return vec4(0.0); }
  return vec4(d / n, wash / n, foam / n, length(vel / n));
}

float nearby(int vx, int vy, float fallback) {
  vec4 c = cornerOf(vx, vy);
  return c.w > 0.0 ? c.x : fallback;
}

vec3 aerated(int mat, float t) {
  float k = clamp(t / ${LIGHTEST}, 0.0, 1.0) * ${TINTS - 1}.0;
  return texelFetch(uTint, ivec2(int(k + 0.5), mat), 0).rgb;
}

float pace(int cx, int cy, float d) {
  vec2 v = flowAt(cx, cy, d);
  return min(1.0, (abs(v.x) + abs(v.y)) * 0.5);
}

struct Part {
  bool ok;
  float fx;
  float fy;
  float h;
  vec3 colour;
  float alpha;
};

// The same rule as the WGSL forward().
bool forward(int cx, int cy, int axis, int cpt) {
  bool onEdge = (axis == 0 ? cx % cpt : cy % cpt) == cpt - 1;
  if (!onEdge) { return false; }
  int jx = cx + (axis == 0 ? 1 : 0);
  int jy = cy + (axis == 0 ? 0 : 1);
  if (!inside(jx, jy)) { return false; }
  return groundAt(jx, jy) < groundAt(cx, cy) + depthAt(cx, cy);
}

Part sidePart(int cx, int cy, int axis, int corner, float fx0, float fy0, float step, float d) {
  Part p;
  p.ok = false;
  p.fx = 0.0; p.fy = 0.0; p.h = 0.0; p.colour = vec3(0.0); p.alpha = 0.0;
  int jx = cx + (axis == 0 ? 1 : 0);
  int jy = cy + (axis == 0 ? 0 : 1);
  // THE RIM OF THE MAP IS NOT A NEIGHBOUR — see the WGSL twin.
  bool rim = !inside(jx, jy);
  float bed = groundAt(cx, cy);
  float bedJ = rim ? bed : groundAt(jx, jy);
  bool wetJ = !rim && depthAt(jx, jy) > dryDepth();

  float ax = axis == 0 ? fx0 + step : fx0;
  float ay = axis == 0 ? fy0 : fy0 + step;
  int vax = cx + (axis == 0 ? 1 : 0);
  int vay = cy + (axis == 0 ? 0 : 1);

  // Where it starts and where it reaches down to — the shared rule.
  vec4 s = resolveSide(bed, bedJ, wetJ, cornerOf(vax, vay), cornerOf(cx + 1, cy + 1));

  bool onA = corner == 0 || corner == 3;
  bool onTop = corner == 0 || corner == 1;
  p.fx = onA ? ax : fx0 + step;
  p.fy = onA ? ay : fy0 + step;
  float top = onA ? s.x : s.y;
  float foot = onA ? s.z : s.w;
  p.h = onTop ? top : foot;

  int mat = int(texelFetch(uMaterial, ivec2(cx, cy), 0).r * 255.0 + 0.5);
  p.colour = aerated(mat, 0.08 + pace(cx, cy, d) * 0.14);
  // The same ramp the surface uses — see the WGSL twin.
  // Floored at a brink, the same as the surface — see the WGSL twin.
  float sd = max(d, ${SHOW_DEPTH} * atBrink(cx, cy));
  float body = (0.30 + 0.62 * min(1.0, sd / ${OPAQUE_DEPTH}.0)) * min(1.0, sd / ${SHOW_DEPTH});
  // HANDED OVER TO THE SHEET AT A LIP — see the WGSL twin.
  float beside = wetJ ? bedJ + depthAt(jx, jy) : bedJ;
  p.alpha = body * (1.0 - ${RIM}.0 * spillAt(bed, beside));
  p.ok = true;
  return p;
}

void main() {
  int cpt = int(uGrid.z);
  int per = cpt * cpt;
  int vi = int(aVertexId);
  int quad = vi >> 2;
  int corner = vi & 3;
  int part = quad % ${PARTS};
  int slot = quad / ${PARTS};
  int tileIdx = slot / per;
  int sub = slot % per;

  gl_Position = vec4(0.0, 0.0, 0.0, 1.0);
  vColor = vec4(0.0);
  if (float(tileIdx) >= uBand.w) { return; }

  int tx = int(uBand.y) + tileIdx;
  int ty = int(uBand.x) - tx;
  int sx = sub % cpt;
  int sy = sub / cpt;
  int cx = tx * cpt + sx;
  int cy = ty * cpt + sy;
  if (!inside(cx, cy)) { return; }

  float d = depthAt(cx, cy);
  float step = uGrid.w;
  float fx0 = float(tx) - 0.5 + float(sx) * step;
  float fy0 = float(ty) - 0.5 + float(sy) * step;

  float fx = 0.0;
  float fy = 0.0;
  float h = 0.0;
  vec3 rgb = vec3(0.0);
  float alpha = 0.0;

  if (part == 0) {
    if (d <= uBand.z) { return; }
    int ox = ((corner + 1) >> 1) & 1;
    int oy = corner >> 1;
    vec4 c = cornerOf(cx + ox, cy + oy);
    float bed = groundAt(cx, cy);
    h = max(levelAt(c, bed), bed);
    fx = fx0 + float(ox) * step;
    fy = fy0 + float(oy) * step;

    vec4 e = cornerExtras(cx + ox, cy + oy);
    float cd = e.x; float wash = e.y; float foam = e.z; float speed = e.w;
    float gx = nearby(cx + ox - 1, cy + oy, c.x) - nearby(cx + ox + 1, cy + oy, c.x);
    float gy = nearby(cx + ox, cy + oy - 1, c.x) - nearby(cx + ox, cy + oy + 1, c.x);
    float lean = (gx + gy) * 0.5;
    float respond = lean / (abs(lean) + ${SLOPE_REF});
    float rough = min(1.0, (abs(gx) + abs(gy)) / ${SLOPE_REF * 2});
    float shown = max(rough, min(1.0, speed / ${STREAK_SPEED}));
    float lit = 0.5 + respond * 0.34 + wash * (0.2 + 0.8 * shown) * 0.3;
    float base = clamp(lit, 0.0, 1.0) * ${TINTS - 1}.0;
    float shade = base + foam * (${SHADES - 1}.0 - base);
    float fade = min(1.0, cd / ${SHOW_DEPTH});
    float body = (0.30 + 0.62 * min(1.0, cd / ${OPAQUE_DEPTH}.0)) * fade;
    alpha = body + (1.0 - body) * foam * ${FOAM_COVER} * fade;
    int mat = int(texelFetch(uMaterial, ivec2(cx, cy), 0).r * 255.0 + 0.5);
    rgb = texelFetch(uTint, ivec2(int(shade + 0.5), mat), 0).rgb;
  } else if (part <= 2) {
    if (d <= uBand.z) { return; }
    if (!facesOn()) { return; }
    int axis = part - 1;
    if (forward(cx, cy, axis, cpt)) { return; }
    Part p = sidePart(cx, cy, axis, corner, fx0, fy0, step, d);
    if (!p.ok) { return; }
    fx = p.fx; fy = p.fy; h = p.h; rgb = p.colour; alpha = p.alpha;
  } else {
    if (!facesOn()) { return; }
    int axis = part - 3;
    int bx = cx - (axis == 0 ? 1 : 0);
    int by = cy - (axis == 0 ? 0 : 1);
    if (!inside(bx, by)) { return; }
    float bd = depthAt(bx, by);
    if (bd <= uBand.z) { return; }
    if (!forward(bx, by, axis, cpt)) { return; }
    Part p = sidePart(bx, by, axis, corner,
      fx0 - (axis == 0 ? step : 0.0), fy0 - (axis == 0 ? 0.0 : step), step, bd);
    if (!p.ok) { return; }
    fx = p.fx; fy = p.fy; h = p.h; rgb = p.colour; alpha = p.alpha;
  }

  float px = (fx - fy) * uIso.x;
  float py = (fx + fy) * uIso.y - h * uIso.z;
  mat3 mvp = uProjectionMatrix * uWorldTransformMatrix * uTransformMatrix;
  gl_Position = vec4((mvp * vec3(px, py, 1.0)).xy, 0.0, 1.0);
  vColor = vec4(rgb * alpha, alpha) * uColor * uWorldColorAlpha;
}
`;

const FRAGMENT_GLSL = /* glsl */ `#version 300 es
precision highp float;
in vec4 vColor;
out vec4 finalColor;
void main() { finalColor = vColor; }
`;

/**
 * The two halves of the surface shader, for anyone checking they agree.
 *
 * Unlike the corner rule and the drip shaders, these two are written out by
 * hand rather than generated from one text — they are long, and the
 * transliteration is the price of that. The price is real: the falls learned
 * to leave the rock in the WGSL and not in the GLSL, because an edit matched
 * one twin's exact lines and silently did nothing to the other's, and nothing
 * noticed until somebody counted. Exposed so a test can count.
 */
export const waterShaderSource = () => ({
  wgsl: WGSL + FRAGMENT_WGSL,
  glsl: VERTEX_GLSL + FRAGMENT_GLSL,
});

export type GpuWaterLayer = {
  meshes: Mesh<Geometry, Shader>[];
  /** Whether the sides of the water are drawn — a debug switch. @see drawGpuWater */
  faces: number;
  /** The textures, each a view straight onto an array the solver owns. */
  sources: TextureSource[];
  wash: FlowWash;
  foam: FoamField;
  /** Milliseconds of CPU the last frame's build took, for measuring. */
  cpuMs: number;
};

/** `GPUShaderStage.VERTEX` and `.FRAGMENT`, without needing the global. */
const VERTEX_STAGE = 1;
const FRAGMENT_STAGE = 2;

/**
 * The bind group layout, written out rather than left to Pixi.
 *
 * Pixi generates one from the WGSL and it is generated for the case Pixi
 * cares about: every texture `visibility: FRAGMENT` and `sampleType: "float"`.
 * Both are wrong here. These textures are read in the VERTEX stage, which is
 * the entire point, and a single-channel float texture is `r32float`, which
 * WebGPU classes as UNFILTERABLE — a filterable binding will not accept one.
 * The device says so plainly and then invalidates the pipeline, which
 * invalidates the command buffer, which is why getting this wrong drew not
 * merely no water but no world at all:
 *
 *   None of the supported sample types (UnfilterableFloat) of
 *   [Texture 256x256 R32Float] match the expected sample types (Float).
 *
 * Nothing is filtered here in any case — every read is a `textureLoad` at an
 * integer coordinate, which is a fetch and not a sample, and needs no sampler.
 */
const FLOAT_FIELDS = ["uDepth", "uGround", "uWash", "uFoam", "uFx", "uFy"];
const BYTE_FIELDS = ["uTint", "uMaterial"];

function gpuLayout(): GPUBindGroupLayoutEntry[][] {
  const uniform = (binding: number): GPUBindGroupLayoutEntry => ({
    binding, visibility: VERTEX_STAGE | FRAGMENT_STAGE, buffer: { type: "uniform" },
  });
  const texture = (binding: number, sampleType: GPUTextureSampleType): GPUBindGroupLayoutEntry => ({
    binding, visibility: VERTEX_STAGE,
    texture: { sampleType, viewDimension: "2d", multisampled: false },
  });
  const own: GPUBindGroupLayoutEntry[] = [uniform(0)];
  FLOAT_FIELDS.forEach((_, k) => own.push(texture(1 + k, "unfilterable-float")));
  BYTE_FIELDS.forEach((_, k) => own.push(texture(1 + FLOAT_FIELDS.length + k, "float")));
  return [[uniform(0)], [uniform(0)], own];
}

/** Which group each named resource belongs to — the other half Pixi infers. */
function nameLayout(): Record<string, number>[] {
  const own: Record<string, number> = { water: 0 };
  [...FLOAT_FIELDS, ...BYTE_FIELDS].forEach((n, k) => { own[n] = 1 + k; });
  return [{ globalUniforms: 0 }, { localUniforms: 0 }, own];
}

let shared: { gpu: GpuProgram; gl: GlProgram } | null = null;
function programs() {
  if (!shared) {
    shared = {
      gpu: new GpuProgram({
        vertex: { source: WGSL, entryPoint: "mainVertex" },
        fragment: { source: FRAGMENT_WGSL, entryPoint: "mainFragment" },
        name: "water-surface",
        layout: nameLayout(),
        gpuLayout: gpuLayout(),
      }),
      gl: GlProgram.from({ vertex: VERTEX_GLSL, fragment: FRAGMENT_GLSL, name: "water-surface" }),
    };
  }
  return shared;
}

/** The shade ramp as a texture: SHADES across, one row per material. */
function tintSource(): TextureSource {
  const px = new Uint8Array(SHADES * MATERIAL_SLOTS * 4);
  for (let m = 0; m < MATERIAL_SLOTS; m++) {
    const base = fluidMaterial(m)?.colour ?? 0x2a6f97;
    for (let k = 0; k < SHADES; k++) {
      const t = k < TINTS
        ? LIGHTEST * k / (TINTS - 1)
        : LIGHTEST + (FOAM_WHITE - LIGHTEST) * (k - TINTS + 1) / FOAM_TINTS;
      const o = (m * SHADES + k) * 4;
      for (let ch = 0; ch < 3; ch++) {
        const c = (base >> (16 - ch * 8)) & 0xff;
        px[o + ch] = Math.min(255, Math.round(c + (255 - c) * t));
      }
      px[o + 3] = 255;
    }
  }
  return new BufferImageSource({
    resource: px, width: SHADES, height: MATERIAL_SLOTS, format: "rgba8unorm",
    scaleMode: "nearest",
  });
}

/**
 * A single-channel float texture over an array the solver already owns.
 *
 * NEAREST, and not because of how it looks. Every read of these is a fetch at
 * an integer coordinate, so filtering would never happen anyway — but WebGL2
 * will not call an `R32F` texture complete if it is asked to filter one
 * without `OES_texture_float_linear`, and an incomplete texture reads as
 * black. Left on Pixi's default of linear, the whole map comes out flat and
 * empty on the WebGL path and perfectly fine on the WebGPU one.
 */
const viewOf = (data: Float32Array, nx: number, ny: number) =>
  new BufferImageSource({
    resource: data, width: nx, height: ny, format: "r32float", scaleMode: "nearest",
  });

export function createGpuWaterLayer(field: WaterField, bands: BandLayer, scale = 1): GpuWaterLayer {
  const { columns } = field;
  const { nx, ny } = columns;
  const { gpu, gl } = programs();

  // Every vertex knows only its own index. One buffer, built once, shared by
  // every band — the widest band is the longest diagonal, and no band needs
  // more than that many tiles.
  const maxTiles = Math.min(bands.w, bands.h);
  const maxQuads = maxTiles * PER_TILE * PARTS;
  const ids = new Float32Array(maxQuads * 4);
  for (let v = 0; v < ids.length; v++) ids[v] = v;
  const idx = new Uint32Array(maxQuads * 6);
  for (let q = 0; q < maxQuads; q++) {
    const v = q * 4, o = q * 6;
    idx[o] = v; idx[o + 1] = v + 1; idx[o + 2] = v + 2;
    idx[o + 3] = v; idx[o + 4] = v + 2; idx[o + 5] = v + 3;
  }
  const idBuffer = new Buffer({ data: ids, usage: BufferUsage.VERTEX | BufferUsage.COPY_DST });

  const depth = viewOf(columns.depth, nx, ny);
  const ground = viewOf(columns.ground, nx, ny);
  const fx = viewOf(columns.fx, nx, ny);
  const fy = viewOf(columns.fy, nx, ny);
  const wash = createFlowWash(columns);
  const foam = createFoam(columns);
  const washTex = viewOf(wash.now, nx, ny);
  const foamTex = viewOf(foam.now, nx, ny);
  const material = new BufferImageSource({
    resource: columns.material, width: nx, height: ny, format: "r8unorm",
    scaleMode: "nearest",
  });
  const tint = tintSource();

  const meshes: Mesh<Geometry, Shader>[] = [];
  for (let b = 0; b < bands.bands.length; b++) {
    // The tiles on this diagonal, and where they start.
    const tx0 = Math.max(0, b - (bands.h - 1));
    const tx1 = Math.min(bands.w - 1, b);
    const tiles = Math.max(0, tx1 - tx0 + 1);

    const water = new UniformGroup({
      uGrid: { value: new Float32Array([nx, ny, COLUMNS_PER_TILE, 1 / COLUMNS_PER_TILE]), type: "vec4<f32>" },
      uIso: { value: new Float32Array([HW * scale, HH * scale, HEIGHT_UNIT * scale, 1]), type: "vec4<f32>" },
      uBand: { value: new Float32Array([b, tx0, columns.params.dryDepth, tiles]), type: "vec4<f32>" },
    });

    // Its own index buffer, exactly as long as the band is: the vertex buffer
    // is shared and sized for the widest diagonal, and how much of it a band
    // draws is simply how many indices it hands over.
    const geometry = new Geometry({
      attributes: { aVertexId: { buffer: idBuffer, format: "float32", stride: 4, offset: 0 } },
      indexBuffer: new Buffer({
        data: idx.slice(0, tiles * PER_TILE * PARTS * 6),
        usage: BufferUsage.INDEX | BufferUsage.COPY_DST,
      }),
    });
    const shader = new Shader({
      gpuProgram: gpu, glProgram: gl,
      resources: {
        water,
        uDepth: depth, uGround: ground, uWash: washTex, uFoam: foamTex,
        uFx: fx, uFy: fy,
        uTint: tint, uMaterial: material,
      },
    });
    const mesh = new Mesh<Geometry, Shader>({ geometry, shader });
    mesh.eventMode = "none";
    bands.structureOf[b].addChild(mesh);
    meshes.push(mesh);
  }

  return {
    meshes,
    faces: 1,
    sources: [depth, ground, washTex, foamTex, fx, fy, material],
    wash, foam, cpuMs: 0,
  };
}

export function destroyGpuWaterLayer(wl: GpuWaterLayer) {
  for (const m of wl.meshes) {
    m.parent?.removeChild(m);
    m.destroy({ children: true });
  }
  wl.meshes.length = 0;
}

/**
 * A frame: step the two carried fields, then say the textures have changed.
 *
 * That is the whole of it. There are no corners to average and no vertices to
 * write, because the vertex shader does both — so what is left on the CPU is
 * the simulation's own work and six calls to mark a texture dirty.
 */
export function drawGpuWater(
  wl: GpuWaterLayer, field: WaterField, bands: BandLayer, dt: number,
  faces = true,
) {
  const t0 = performance.now();
  const { columns } = field;
  // The debug switch, into the spare slot of `uIso`. Written per band because
  // each one carries its own group, and only when it changes: a uniform
  // upload per band per frame to say the same thing again is not free.
  const want = faces ? 1 : 0;
  if (wl.faces !== want) {
    wl.faces = want;
    for (const m of wl.meshes) {
      const grp = m.shader?.resources.water as UniformGroup | undefined;
      if (!grp) continue;
      (grp.uniforms.uIso as Float32Array)[3] = want;
      grp.update();
    }
  }
  const region = activeBox(columns);
  if (region && dt > 0) {
    stepFlowWash(wl.wash, columns, dt, region);
    stepFoam(wl.foam, columns, dt, region);
  }
  for (const s of wl.sources) s.update();

  // WHICH BANDS DRAW AT ALL, which is the one thing this path has to be told
  // and the CPU builder works out for itself by walking the wet columns. Left
  // out, every band draws its whole complement of vertices every frame however
  // little water there is and however little of the map is on screen — and a
  // map is mostly dry most of the time, which is the case that matters.
  //
  // Two ranges, intersected. The camera's is the band renderer's own, since it
  // was built around exactly that question. The water's comes from the solver's
  // active box: a band is `x + y` in tiles, so the box's corners bound which
  // bands can hold anything at all.
  let lo = bands.visibleLo, hi = bands.visibleHi;
  if (region) {
    const tile = (c: number) => Math.floor(c / COLUMNS_PER_TILE);
    lo = Math.max(lo, tile(region.x0) + tile(region.y0));
    hi = Math.min(hi, tile(region.x1) + tile(region.y1));
  } else {
    hi = lo - 1;                                  // nothing wet: nothing draws
  }
  for (let b = 0; b < wl.meshes.length; b++) {
    const show = b >= lo && b <= hi;
    // Only on a change: visibility is structural, and flipping it every frame
    // makes the renderer rebuild the scene's instruction list every frame.
    if (wl.meshes[b].visible !== show) wl.meshes[b].visible = show;
  }
  wl.cpuMs = performance.now() - t0;
}

/** For measuring: how many quads the GPU is asked to consider, wet or dry. */
export const gpuQuadsConsidered = (wl: GpuWaterLayer) =>
  wl.meshes.reduce((n, m) => n + (m.geometry.indexBuffer.data?.length ?? 0) / 6, 0);
