/**
 * World v2 — the water surface built in a VERTEX SHADER.
 *
 * THE PATH THAT SHIPS, wherever there is a device. This began as a prototype
 * behind a flag, with `water.ts` as the one that shipped, and that is the
 * other way round now: the host mesh builder is the REFERENCE — what
 * `__frameCompare` diffs against, and what runs on WebGL and anywhere WebGPU
 * is not to be had — and this is what a player sees. @see drawWater
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
 * no fragments. That used to be the one place this was wasteful where the CPU
 * version is not — the CPU walks the wet columns and this walked all of them,
 * so a nearly dry map cost it the same as a flooded one. The gathering fixed
 * that: a compute pass lists the quads worth drawing and the draw is cut to
 * what it found. @see gatherQuads
 *
 * WHY PER BAND. The scene is sorted by diagonal band, because water draws
 * between the terrain behind it and the structures in front of it, so one draw
 * for the whole map would put every drop either in front of everything or
 * behind it. A band is `x + y` in tiles, so its tiles are `(tx, b - tx)` over a
 * range, and that range is all a vertex needs to find itself.
 *
 * WHAT IT DOES NOW that it did not. Side faces are here — five PARTS to a
 * column, the surface and four sides, switched by `facesOn` — and the falls'
 * sheets are built by a compute pass of their own. Both were named here as
 * conditional geometry a procedural draw could not afford, which was true of
 * the shape this had then and is not true of the shape it has now: the
 * gathering allocates for what is actually there rather than the worst case.
 * @see createSheet, gatherQuads
 */
import { heldGpu, textureLimit } from "./device";
import {
  Buffer, BufferImageSource, BufferUsage, Geometry, GlProgram, GpuProgram, Mesh,
  Shader, TextureSource, UniformGroup,
} from "pixi.js";

import {
  activeBox, MATERIAL_SLOTS, MAX_FLOW_SPEED, type ColumnField,
} from "../../fluid/columns";
import { RIM, cornerRuleSource } from "./corner-rule";
import { NO_BODY, createBodies, findBodies, type Bodies } from "./bodies";
import { OPEN_SKY } from "../../fluid/slots";
import { quadRuleSource } from "./quad-rule";
import { createQuadsPass, type QuadsPass } from "./quads-gpu";
import { FALL_MIN } from "../../fluid/falls";
import { fluidMaterial } from "../water/materials";
import { COLUMNS_PER_TILE } from "../water/field";
import { HEIGHT_UNIT, HH, HW } from "../iso";
import type { BandLayer } from "./bands";
import { createFlowWash, stepFlowWash, type FlowWash } from "./flow-wash";
import {
  canCopyOut, type FieldName, type Sink,
} from "../../fluid/gpu/state";
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
  OPAQUE_DEPTH, SHADES, SHOW_DEPTH, SLOPE_REF, SOLID_FLOOR, SOLID_RANGE,
  STREAK_SPEED, TINTS,
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
 * WHICH QUADS A BAND ACTUALLY DRAWS, as a list it looks up by draw index.
 *
 * The note above states the trade this path makes — every part allocated
 * whether or not it is there, four vertex invocations for a quad that
 * collapses to a point — and the trade has now been priced. Timed on the
 * `waterfall` fixture, the render pass is about three milliseconds of having
 * the hundred and twenty seven draws at all plus eleven and a half
 * PROPORTIONAL TO THE QUAD COUNT, and it is the whole of the frame's GPU:
 * fourteen and a half milliseconds with the water drawn against a third of one
 * with its meshes hidden, identical on both solvers, and unchanged by quartering
 * the pixels.
 *
 * So the quads that draw are gathered into a list, the band draws only as many
 * as the list holds, and the vertex shader reads which quad it is from the
 * list rather than deriving it from its own index. The entries are the SAME
 * numbers the derivation produced — a subset of them, in whatever order the
 * gathering happened to claim — so everything downstream of the lookup is
 * untouched.
 *
 * THE IDENTITY IS THE DEFAULT and it is what makes this safe. Filled with
 * `0, 1, 2 …` the lookup is exactly the arithmetic it replaced, so a path with
 * nothing to compact it — WebGL, which has no compute, or the device solver
 * switched off — draws precisely what it always drew.
 */
/**
 * Room for the widest band's worth of quads — which is the LONGEST DIAGONAL and
 * not a constant. This was written as sixty four, which is the tile count of
 * the only map anybody had run it on.
 *
 * Still the widest band, and still what the gather's worst case is measured
 * against — but no longer the STRIDE every band is stored at. @see quadList.
 */
export const quadCap = (w: number, h: number) =>
  Math.min(w, h) * PER_TILE * PARTS;

/** Tiles on band `b` of a `w` by `h` map — its own diagonal, not the longest. */
export const bandTiles = (w: number, h: number, b: number): number =>
  Math.max(0, Math.min(w - 1, b) - Math.max(0, b - (h - 1)) + 1);

/**
 * Texels across the quad list.
 *
 * ANY MULTIPLE OF 64 WOULD DO, and that is the point of packing it flat: the
 * list is a one-dimensional thing stored two-dimensionally, so its width is now
 * a number chosen for the copy rather than a number the map dictates. 64
 * because a buffer-to-texture row must be a multiple of 256 bytes and these are
 * four bytes each; 2048 because it keeps the height small at every map size
 * anyone will ask for.
 */
export const LIST_W = 2048;

/**
 * Where each band's quads live in the list, and how many it may hold.
 *
 * THE STRIDE USED TO BE THE WIDEST BAND'S, FOR EVERY BAND, and that is two
 * copies of the map in a texture that can only ever address one. A band on a
 * corner holds one tile's worth of quads; the middle band holds `min(w, h)`.
 * Laid out in a rectangle as wide as the widest, the total comes to
 * `min(w,h) * (w+h-1) * 80` slots against the `w * h * 80` quads that could
 * exist anywhere on the map at once — measured at 64², 96² and 128², exactly
 * 1.99 times, so half of every allocation was unreachable by construction:
 *
 *     64²   5120 x 127 =   650,240 slots = 2.48 MB, against 1.25 MB of quads
 *     96²   7680 x 191 = 1,466,880 slots = 5.60 MB, against 2.81 MB
 *     128² 10240 x 255 = 2,611,200 slots = 9.96 MB, against 5.00 MB
 *
 * It was also a hard ceiling on the map: the stride is a texture WIDTH, and
 * 128 tiles wants 10,240 against the 8,192 a WebGPU device is guaranteed. The
 * texture came back invalid, Pixi bound it anyway, and every frame after was
 * "invalid due to a previous error" with the first error long gone.
 *
 * Given its own offset each band takes exactly what it needs, the total is the
 * quads that can exist and not twice that, and the texture's width is chosen
 * rather than imposed — so the limit stops being about the map at all.
 */
export type QuadList = {
  /** Slots band `b` may hold. */
  caps: Uint32Array;
  /** Where band `b` starts in the flat list. */
  offsets: Uint32Array;
  /** Slots in all, and the buffer's length. */
  total: number;
  /** Rows of `LIST_W` the texture needs to hold them. */
  rows: number;
};

export function quadList(w: number, h: number, layers = 1): QuadList {
  const bands = w + h - 1;
  const caps = new Uint32Array(bands);
  const offsets = new Uint32Array(bands);
  let at = 0;
  for (let b = 0; b < bands; b++) {
    offsets[b] = at;
    // TIMES THE STOREYS. A bridge column draws the river under the span and
    // whatever stands on the deck, and a list too short for both silently
    // drops whichever the gather reached second. @see ColumnField.layers
    caps[b] = bandTiles(w, h, b) * PER_TILE * PARTS * layers;
    at += caps[b];
  }
  return { caps, offsets, total: at, rows: Math.max(1, Math.ceil(at / LIST_W)) };
}

/**
 * The largest square map whose quad list still fits in a texture.
 *
 * THE LIST IS AS WIDE AS THE CAP, so the device's texture limit is a limit on
 * the MAP, and one nobody had met because the only map anybody ran was 64².
 * At the guaranteed 8,192 it is 102 tiles; on hardware that offers 16,384, and
 * asked for it, 204. Exported because a size the player can choose has to stop
 * where the device does — a slider that offers a map the GPU will refuse is a
 * slider that offers a wall of validation errors. @see textureLimit
 */
export const maxMapTiles = (textureWidth: number): number =>
  Math.floor(textureWidth / (PER_TILE * PARTS));

/**
 * The largest map this machine will actually draw, rounded DOWN to `step`.
 *
 * Down, because a size that rounds up is a size the device refuses — which is
 * the whole failure this exists to stop. Synchronous on purpose: a slider's
 * range cannot wait for a promise, and before the device arrives the
 * guaranteed minimum is the right answer. @see heldGpu
 */
export const mapSizeCeiling = (step = 1): number => {
  const tiles = maxMapTiles(textureLimit(heldGpu()?.device));
  return Math.max(step, Math.floor(tiles / step) * step);
};

/**
 * STORED ONE HIGHER THAN IT IS, so that nought means EMPTY.
 *
 * The list is cleared before it is gathered and the count the host draws by is
 * a frame or two stale, so a band can be asked for more instances than the
 * gathering put there. Those have to draw nothing — and with the ids stored
 * as they are, nought is a perfectly good quad: tile nought, column nought,
 * the surface. Shifted by one, an empty slot is unmistakable and a clear is
 * all it takes to make one.
 */

/** The list, as a texture: a storage buffer would have no WebGL twin. */
function quadListSource(list: QuadList): TextureSource {
  const ids = new Uint32Array(LIST_W * list.rows);
  for (let b = 0; b < list.caps.length; b++) {
    const at = list.offsets[b];
    for (let q = 0; q < list.caps[b]; q++) ids[at + q] = q + 1;
  }
  return new BufferImageSource({
    resource: ids, width: LIST_W, height: list.rows, format: "r32uint",
    scaleMode: "nearest",
  });
}

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
  uList: vec4<f32>,       // this band's offset into the quad list, list width
  uSlots: vec4<f32>,      // storeys, and which band tier this mesh draws
};
@group(2) @binding(0) var<uniform> water : Water;
@group(2) @binding(1) var uDepth : texture_2d<f32>;
@group(2) @binding(2) var uGround : texture_2d<f32>;
@group(2) @binding(3) var uWash : texture_2d<f32>;
@group(2) @binding(4) var uFoam : texture_2d<f32>;
@group(2) @binding(5) var uFx : texture_2d<f32>;
@group(2) @binding(6) var uFy : texture_2d<f32>;
@group(2) @binding(7) var uBody : texture_2d<f32>;
@group(2) @binding(8) var uRoof : texture_2d<f32>;
@group(2) @binding(9) var uTint : texture_2d<f32>;
@group(2) @binding(10) var uMaterial : texture_2d<f32>;
@group(2) @binding(11) var uQuads : texture_2d<u32>;

struct VSOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) vColor: vec4<f32>,
};

/** How many STOREYS a column has. @see ColumnField.layers */
fn slots() -> i32 { return i32(water.uSlots.x); }
/**
 * WHETHER THIS MESH IS THE ONE UNDER THE PAVING.
 *
 * A band sorts on x + y with height left out, which is sound while a cell
 * holds one surface. A bridge is the cell that holds two, and water under a
 * span drew after the span — so a channel running full painted itself across
 * the front of the bridge. There are two meshes per band now: one in the tier
 * before the paving for water with something over it, one after for the rest,
 * and each skips the quads that are not its own. See BandLayer.underOf.
 */
fn roofedTier() -> bool { return water.uSlots.y > 0.5; }
/**
 * A SLOT'S ROW. Every per-slot field is a stack of planes, one per storey,
 * because that is what the arrays already are: slot a of column i sits at
 * a * cells + i, and cells is nx * ny, so the plane begins at row a * ny and
 * nothing had to be re-packed to get it here.
 */
fn slotRow(y: i32, a: i32) -> i32 { return a * i32(water.uGrid.y) + y; }
fn depthAt(x: i32, y: i32, a: i32) -> f32 {
  return textureLoad(uDepth, vec2<i32>(x, slotRow(y, a)), 0).r;
}
fn groundAt(x: i32, y: i32, a: i32) -> f32 {
  return textureLoad(uGround, vec2<i32>(x, slotRow(y, a)), 0).r;
}
/** WHICH SHEET stands in a slot, or -1 where it is dry. @see render/bodies */
fn sheetAt(x: i32, y: i32, a: i32) -> f32 {
  return textureLoad(uBody, vec2<i32>(x, slotRow(y, a)), 0).r;
}
/** The underside of whatever is over a slot, or the open sky. @see fluid/slots */
fn roofAt(x: i32, y: i32, a: i32) -> f32 {
  return textureLoad(uRoof, vec2<i32>(x, slotRow(y, a)), 0).r;
}
/** The four things the shared corner rule asks its host for. */
fn dryDepth() -> f32 { return water.uBand.z; }
fn fallMin() -> f32 { return ${FALL_MIN}.0; }
/** Whether the sides of the water are drawn at all — a debug switch. */
fn facesOn() -> bool { return water.uIso.w > 0.5; }

fn inside(x: i32, y: i32) -> bool {
  return x >= 0 && y >= 0 && x < i32(water.uGrid.x) && y < i32(water.uGrid.y);
}

${cornerRuleSource("wgsl", DRAWDOWN)}
${quadRuleSource("wgsl")}

/** Flux over a depth FLOOR, clamped — flowX and flowY, in the shader. */
fn flowAt(cx: i32, cy: i32, d: f32, a: i32) -> vec2<f32> {
  let by = max(d, water.uBand.z * 8.0);
  let L = slots();
  let ny = i32(water.uGrid.y);
  // SUMMED OVER EVERYWHERE THIS SLOT'S WATER CAN GO, which is a plane per
  // slot on the far side of the edge — off the end of a bridge onto the road
  // AND over the parapet beside it, from the same water. The twin of outX and
  // inX in fluid/columns.
  var west = 0.0; var north = 0.0; var east = 0.0; var south = 0.0;
  for (var b = 0; b < L; b = b + 1) {
    let out = (a * L + b) * ny;
    let back = (b * L + a) * ny;
    east = east + textureLoad(uFx, vec2<i32>(cx, out + cy), 0).r;
    south = south + textureLoad(uFy, vec2<i32>(cx, out + cy), 0).r;
    if (cx > 0) { west = west + textureLoad(uFx, vec2<i32>(cx - 1, back + cy), 0).r; }
    if (cy > 0) { north = north + textureLoad(uFy, vec2<i32>(cx, back + cy - 1), 0).r; }
  }
  let vx = (west + east) * 0.5 / by;
  let vy = (north + south) * 0.5 / by;
  return clamp(vec2<f32>(vx, vy), vec2<f32>(-${MAX_FLOW_SPEED}.0), vec2<f32>(${MAX_FLOW_SPEED}.0));
}

/** Depth, wash, foam and flow speed, averaged over the same contributors. */
fn cornerExtras(vx: i32, vy: i32, sheet: f32) -> vec4<f32> {
  var d = 0.0; var wash = 0.0; var foam = 0.0; var n = 0.0;
  var vel = vec2<f32>(0.0, 0.0);
  for (var k = 0; k < 4; k = k + 1) {
    let cx = vx - 1 + (k & 1);
    let cy = vy - 1 + (k >> 1);
    if (!inside(cx, cy)) { continue; }
    // THE EXTRAS FOLLOW THE SHEET, exactly as the corner's height does — see
    // water.ts's cornerValues, which is this. Grouped by the BED instead,
    // the last corner before a lip took much of its colour from the water at
    // the foot of the cliff, and the river under a bridge took all of its
    // colour from whatever stood on the deck. @see render/bodies
    for (var a = 0; a < slots(); a = a + 1) {
      let dd = depthAt(cx, cy, a);
      if (dd <= water.uBand.z) { continue; }
      if (sheetAt(cx, cy, a) != sheet) { continue; }
      // A lip is not a shoreline — see corner-rule's atBrink, and water.ts's
      // shownDepth, which is this.
      d = d + max(dd, ${SHOW_DEPTH} * atBrink(cx, cy, a));
      // The wash and the foam are the WORLD'S, one per column: a tile carries
      // one current pattern whatever is built over it.
      wash = wash + textureLoad(uWash, vec2<i32>(cx, cy), 0).r;
      foam = foam + textureLoad(uFoam, vec2<i32>(cx, cy), 0).r;
      vel = vel + flowAt(cx, cy, dd, a);
      n = n + 1.0;
    }
  }
  if (n == 0.0) { return vec4<f32>(0.0, 0.0, 0.0, 0.0); }
  return vec4<f32>(d / n, wash / n, foam / n, length(vel / n));
}

/**
 * The same sheet's surface one corner away, or this one's where it does not
 * reach — unless what is over there is BELOW, which is a lip.
 *
 * The twin of water.ts's nearby, and the asymmetry is the point: a surface
 * really does tip over an edge, and the sheet leaving one is lit from exactly
 * that, so a brink read as level stops agreeing with its own waterfall. Water
 * ABOVE is a bridge, and a bridge is not a slope in the water under it.
 */
fn nearby(vx: i32, vy: i32, sheet: f32, here: f32) -> f32 {
  let c = cornerOf(vx, vy, sheet);
  if (c.w > 0.0) { return c.x; }
  var below = here;
  for (var k = 0; k < 4; k = k + 1) {
    let cx = vx - 1 + (k & 1);
    let cy = vy - 1 + (k >> 1);
    if (!inside(cx, cy)) { continue; }
    for (var a = 0; a < slots(); a = a + 1) {
      if (depthAt(cx, cy, a) <= water.uBand.z) { continue; }
      let o = cornerOf(vx, vy, sheetAt(cx, cy, a));
      if (o.w > 0.0 && o.x < below) { below = o.x; }
    }
  }
  return below;
}

/** A shade off the fluid's own ramp, the way the CPU builder lightens one. */
fn aerated(mat: i32, t: f32) -> vec3<f32> {
  let k = clamp(t / ${LIGHTEST}, 0.0, 1.0) * ${TINTS - 1}.0;
  return textureLoad(uTint, vec2<i32>(i32(k + 0.5), mat), 0).rgb;
}

/** How fast this column is going, nought to one. */
fn pace(cx: i32, cy: i32, d: f32, a: i32) -> f32 {
  let v = flowAt(cx, cy, d, a);
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

fn sidePart(cx: i32, cy: i32, axis: i32, corner: i32, fx0: f32, fy0: f32, step: f32, d: f32, a: i32) -> Part {
  var p: Part;
  p.ok = false;
  let jx = cx + select(0, 1, axis == 0);
  let jy = cy + select(1, 0, axis == 0);
  // THE RIM OF THE MAP IS NOT A NEIGHBOUR. This used to return here, and water
  // running to the edge came out a sheet with a void under it. The edge is
  // treated as dry ground at this column's own level, which is what takes the
  // body all the way down to the bed it stands on.
  let rim = !inside(jx, jy);
  let bed = groundAt(cx, cy, a);
  let bedJ = select(groundAt(jx, jy, a), bed, rim);
  let wetJ = !rim && depthAt(jx, jy, a) > dryDepth();

  // The edge: east runs (fx1,fy0)-(fx1,fy1), south runs (fx0,fy1)-(fx1,fy1).
  let ax = select(fx0, fx0 + step, axis == 0);
  let ay = select(fy0 + step, fy0, axis == 0);
  let vax = cx + select(0, 1, axis == 0);
  let vay = cy + select(1, 0, axis == 0);

  // BOTH SHEETS BY NAME. The face hangs from what THIS sheet draws at each
  // corner down to what the NEIGHBOUR'S sheet draws there — which used to be
  // two picks between a corner's two groups, a stand-in for exactly this
  // question. Asked by sheet it is a lookup, and a neighbour that is a
  // different body of water answers differently without anything having to
  // infer that from heights. The twin of water.ts's sideFace.
  let mine = sheetAt(cx, cy, a);
  let theirs = select(-1.0, sheetAt(jx, jy, a), wetJ);
  let ownTop = min(bed + d, roofAt(cx, cy, a));
  let theirTop = select(bedJ, min(bedJ + depthAt(jx, jy, a), roofAt(jx, jy, a)), wetJ);
  let cA = cornerOf(vax, vay, mine);
  let cB = cornerOf(cx + 1, cy + 1, mine);
  let oA = cornerOf(vax, vay, theirs);
  let oB = cornerOf(cx + 1, cy + 1, theirs);
  let s = resolveSide(
    bed, bedJ, wetJ,
    select(ownTop, cA.x, cA.w > 0.0), select(theirTop, oA.x, oA.w > 0.0),
    select(ownTop, cB.x, cB.w > 0.0), select(theirTop, oB.x, oB.w > 0.0),
  );

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
  let mat = i32(textureLoad(uMaterial, vec2<i32>(cx, slotRow(cy, a)), 0).r * 255.0 + 0.5);
  p.colour = aerated(mat, 0.08 + pace(cx, cy, d, a) * 0.14);
  // The same ramp the surface uses, on the water standing at this edge: you
  // see through the side of a puddle and not through the side of a lake. Flat
  // at a third of an alpha, a deep body read as a sheet over a void — the
  // faces were there, and what you saw through them was the grass. The same
  // top to bottom, too: grading the waterline lighter is the physical story
  // and reads worse, because it puts the ground's colour through the top half
  // of every edge.
  // Floored at a brink, the same as the surface — see corner-rule's atBrink.
  let sd = max(d, ${SHOW_DEPTH} * atBrink(cx, cy, a));
  let body = (${SOLID_FLOOR} + ${SOLID_RANGE} * min(1.0, sd / ${OPAQUE_DEPTH}.0)) * min(1.0, sd / ${SHOW_DEPTH});
  // HANDED OVER TO THE SHEET AT A LIP — see water.ts's sideFace, which is
  // this. A face is a pane of water, and a pane is only one of the three ways
  // water is bounded: a shore's corner has already come down to its bed, the
  // map's edge is an honest cut, and a LIP is bounded by the sheet leaving it.
  let beside = select(bedJ, bedJ + depthAt(jx, jy, a), wetJ);
  p.alpha = body * (1.0 - ${RIM}.0 * spillAt(bed, beside));
  p.ok = true;
  return p;
}

@vertex
fn mainVertex(
  @location(0) aVertexId: f32,
  @builtin(instance_index) inst: u32,
) -> VSOutput {
  var out: VSOutput;
  out.position = vec4<f32>(0.0, 0.0, 0.0, 1.0);
  out.vColor = vec4<f32>(0.0, 0.0, 0.0, 0.0);
  let cpt = i32(water.uGrid.z);
  let per = cpt * cpt;
  // ONE INSTANCE PER QUAD, four vertices each. The band's instance count is
  // how many quads it has to draw, which is what lets it draw the ones that
  // survive rather than all the ones that might.
  let corner = i32(aVertexId);
  // WHICH QUAD THIS INSTANCE STANDS FOR. The identity unless something has
  // gathered the list, in which case it is the n'th quad that actually draws.
  // Nought is an EMPTY slot and not quad nought. @see quadCap
  // THE LIST IS FLAT, stored two-dimensionally. A band's slots run from its
  // own offset, so the texel is that offset plus the instance, unwrapped by
  // the list's width. @see quadList
  let at = i32(water.uList.x) + i32(inst);
  let lw = i32(water.uList.y);
  let quad = i32(textureLoad(
    uQuads, vec2<i32>(at % lw, at / lw), 0,
  ).r) - 1;
  if (quad < 0) { return out; }
  // A QUAD IS A PART, A STOREY AND A COLUMN. A bridge column draws the river
  // under the span and whatever stands on the deck, so the storey is as much
  // a part of a quad's identity as which of the five pieces it is.
  let L = slots();
  let part = quad % ${PARTS};
  let cell = quad / ${PARTS};
  let a = cell % L;
  let slot = cell / L;
  let tileIdx = slot / per;
  let sub = slot % per;

  if (f32(tileIdx) >= water.uBand.w) { return out; }

  let tx = i32(water.uBand.y) + tileIdx;
  let ty = i32(water.uBand.x) - tx;
  let sx = sub % cpt;
  let sy = sub / cpt;
  let cx = tx * cpt + sx;
  let cy = ty * cpt + sy;
  if (!inside(cx, cy)) { return out; }

  let d = depthAt(cx, cy, a);
  // Whichever column this quad hangs off decides its tier — the far-edge
  // faces below use the column BEHIND, and ask again with that one.
  if ((roofAt(cx, cy, a) < ${OPEN_SKY}) != roofedTier()) { return out; }
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
    // THIS COLUMN'S OWN SHEET, which is what every corner it reads is keyed
    // on. A column contributed to its corners under this id, so the tier is
    // always there and always the one it helped make. @see render/bodies
    let sheet = sheetAt(cx, cy, a);
    let c = cornerOf(cx + ox, cy + oy, sheet);
    let bed = groundAt(cx, cy, a);
    h = max(c.x, bed);
    fx = fx0 + f32(ox) * step;
    fy = fy0 + f32(oy) * step;

    let e = cornerExtras(cx + ox, cy + oy, sheet);
    let cd = e.x; let wash = e.y; let foam = e.z; let speed = e.w;
    let gx = nearby(cx + ox - 1, cy + oy, sheet, c.x)
           - nearby(cx + ox + 1, cy + oy, sheet, c.x);
    let gy = nearby(cx + ox, cy + oy - 1, sheet, c.x)
           - nearby(cx + ox, cy + oy + 1, sheet, c.x);
    let lean = (gx + gy) * 0.5;
    let respond = lean / (abs(lean) + ${SLOPE_REF});
    let rough = min(1.0, (abs(gx) + abs(gy)) / ${SLOPE_REF * 2});
    let shown = max(rough, min(1.0, speed / ${STREAK_SPEED}));
    let lit = 0.5 + respond * 0.34 + wash * (0.2 + 0.8 * shown) * 0.3;
    let base = clamp(lit, 0.0, 1.0) * ${TINTS - 1}.0;
    let shade = base + foam * (${SHADES - 1}.0 - base);
    let fade = min(1.0, cd / ${SHOW_DEPTH});
    let body = (${SOLID_FLOOR} + ${SOLID_RANGE} * min(1.0, cd / ${OPAQUE_DEPTH}.0)) * fade;
    alpha = body + (1.0 - body) * foam * ${FOAM_COVER} * fade;
    let mat = i32(textureLoad(uMaterial, vec2<i32>(cx, slotRow(cy, a)), 0).r * 255.0 + 0.5);
    rgb = textureLoad(uTint, vec2<i32>(i32(shade + 0.5), mat), 0).rgb;
  } else if (part <= 2) {
    // A SIDE of this column. Hung from the very corners the surface quad
    // used, so the two share vertices and there is no seam between them.
    // Skipped where it is filed FORWARD instead — see PARTS.
    if (d <= water.uBand.z) { return out; }
    if (!facesOn()) { return out; }
    let axis = part - 1;
    if (forward(cx, cy, axis, cpt, a)) { return out; }
    let p = sidePart(cx, cy, axis, corner, fx0, fy0, step, d, a);
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
    let bd = depthAt(bx, by, a);
    if (bd <= water.uBand.z) { return out; }
    if ((roofAt(bx, by, a) < ${OPEN_SKY}) != roofedTier()) { return out; }
    if (!forward(bx, by, axis, cpt, a)) { return out; }
    let p = sidePart(bx, by, axis, corner,
      fx0 - select(0.0, step, axis == 0), fy0 - select(step, 0.0, axis == 0), step, bd, a);
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
uniform vec4 uList;
uniform vec4 uSlots;

uniform sampler2D uDepth;
uniform sampler2D uGround;
uniform sampler2D uWash;
uniform sampler2D uFoam;
uniform sampler2D uFx;
uniform sampler2D uFy;
uniform sampler2D uBody;
uniform sampler2D uRoof;
uniform sampler2D uTint;
uniform sampler2D uMaterial;
uniform highp usampler2D uQuads;

// How many STOREYS a column has, and where a storey's plane of rows begins —
// see the WGSL twin, where the layout is argued.
int slots() { return int(uSlots.x); }
// Whether this mesh is the one under the paving — see the WGSL twin.
bool roofedTier() { return uSlots.y > 0.5; }
int slotRow(int y, int a) { return a * int(uGrid.y) + y; }
float depthAt(int x, int y, int a) { return texelFetch(uDepth, ivec2(x, slotRow(y, a)), 0).r; }
float groundAt(int x, int y, int a) { return texelFetch(uGround, ivec2(x, slotRow(y, a)), 0).r; }
// WHICH SHEET stands in a slot, or -1 where it is dry. @see render/bodies
float sheetAt(int x, int y, int a) { return texelFetch(uBody, ivec2(x, slotRow(y, a)), 0).r; }
float roofAt(int x, int y, int a) { return texelFetch(uRoof, ivec2(x, slotRow(y, a)), 0).r; }
float dryDepth() { return uBand.z; }
float fallMin() { return ${FALL_MIN}.0; }
bool facesOn() { return uIso.w > 0.5; }
// WGSL has this and GLSL does not. One helper is cheaper than teaching the
// shared rule about two ways of writing a conditional.
//
// ONE OVERLOAD PER TYPE THE RULE USES, and the float one alone is why the
// WebGL path did not compile. WGSL's select is generic; GLSL's functions are
// not, so select(0, 1, k < 2) on INTS -- which the corner rule writes, to pick
// a neighbour offset -- found only the float signature, returned a float into
// an int, and took another dozen expressions down with it in the cascade. The
// shared rule is written in the vocabulary both languages have, so this side
// has to actually have it.
float select(float a, float b, bool c) { return c ? b : a; }
int   select(int a, int b, bool c)     { return c ? b : a; }
vec2  select(vec2 a, vec2 b, bool c)   { return c ? b : a; }
vec3  select(vec3 a, vec3 b, bool c)   { return c ? b : a; }
vec4  select(vec4 a, vec4 b, bool c)   { return c ? b : a; }

bool inside(int x, int y) {
  return x >= 0 && y >= 0 && x < int(uGrid.x) && y < int(uGrid.y);
}

${cornerRuleSource("glsl", DRAWDOWN)}
${quadRuleSource("glsl")}

vec2 flowAt(int cx, int cy, float d, int a) {
  float by = max(d, uBand.z * 8.0);
  int L = slots();
  int ny = int(uGrid.y);
  // Summed over every plane this slot's water can leave by — see the WGSL twin.
  float west = 0.0; float north = 0.0; float east = 0.0; float south = 0.0;
  for (int b = 0; b < L; ++b) {
    int out_ = (a * L + b) * ny;
    int back = (b * L + a) * ny;
    east += texelFetch(uFx, ivec2(cx, out_ + cy), 0).r;
    south += texelFetch(uFy, ivec2(cx, out_ + cy), 0).r;
    if (cx > 0) { west += texelFetch(uFx, ivec2(cx - 1, back + cy), 0).r; }
    if (cy > 0) { north += texelFetch(uFy, ivec2(cx, back + cy - 1), 0).r; }
  }
  float vx = (west + east) * 0.5 / by;
  float vy = (north + south) * 0.5 / by;
  return clamp(vec2(vx, vy), vec2(-${MAX_FLOW_SPEED}.0), vec2(${MAX_FLOW_SPEED}.0));
}

vec4 cornerExtras(int vx, int vy, float sheet) {
  float d = 0.0; float wash = 0.0; float foam = 0.0; float n = 0.0;
  vec2 vel = vec2(0.0);
  for (int k = 0; k < 4; ++k) {
    int cx = vx - 1 + (k & 1);
    int cy = vy - 1 + (k >> 1);
    if (!inside(cx, cy)) { continue; }
    // The extras follow the SHEET, and every storey meets this corner — see
    // the WGSL twin.
    for (int a = 0; a < slots(); ++a) {
      float dd = depthAt(cx, cy, a);
      if (dd <= uBand.z) { continue; }
      if (sheetAt(cx, cy, a) != sheet) { continue; }
      // A lip is not a shoreline — see corner-rule's atBrink, and water.ts's
      // shownDepth, which is this.
      d += max(dd, ${SHOW_DEPTH} * atBrink(cx, cy, a));
      wash += texelFetch(uWash, ivec2(cx, cy), 0).r;
      foam += texelFetch(uFoam, ivec2(cx, cy), 0).r;
      vel += flowAt(cx, cy, dd, a);
      n += 1.0;
    }
  }
  if (n == 0.0) { return vec4(0.0); }
  return vec4(d / n, wash / n, foam / n, length(vel / n));
}

// The same sheet one corner away, and otherwise only what is BELOW — see the
// WGSL twin, where the asymmetry is argued.
float nearby(int vx, int vy, float sheet, float here) {
  vec4 c = cornerOf(vx, vy, sheet);
  if (c.w > 0.0) { return c.x; }
  float below = here;
  for (int k = 0; k < 4; ++k) {
    int cx = vx - 1 + (k & 1);
    int cy = vy - 1 + (k >> 1);
    if (!inside(cx, cy)) { continue; }
    for (int a = 0; a < slots(); ++a) {
      if (depthAt(cx, cy, a) <= uBand.z) { continue; }
      vec4 o = cornerOf(vx, vy, sheetAt(cx, cy, a));
      if (o.w > 0.0 && o.x < below) { below = o.x; }
    }
  }
  return below;
}

vec3 aerated(int mat, float t) {
  float k = clamp(t / ${LIGHTEST}, 0.0, 1.0) * ${TINTS - 1}.0;
  return texelFetch(uTint, ivec2(int(k + 0.5), mat), 0).rgb;
}

float pace(int cx, int cy, float d, int a) {
  vec2 v = flowAt(cx, cy, d, a);
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

Part sidePart(int cx, int cy, int axis, int corner, float fx0, float fy0, float step, float d, int a) {
  Part p;
  p.ok = false;
  p.fx = 0.0; p.fy = 0.0; p.h = 0.0; p.colour = vec3(0.0); p.alpha = 0.0;
  int jx = cx + (axis == 0 ? 1 : 0);
  int jy = cy + (axis == 0 ? 0 : 1);
  // THE RIM OF THE MAP IS NOT A NEIGHBOUR — see the WGSL twin.
  bool rim = !inside(jx, jy);
  float bed = groundAt(cx, cy, a);
  float bedJ = rim ? bed : groundAt(jx, jy, a);
  bool wetJ = !rim && depthAt(jx, jy, a) > dryDepth();

  float ax = axis == 0 ? fx0 + step : fx0;
  float ay = axis == 0 ? fy0 : fy0 + step;
  int vax = cx + (axis == 0 ? 1 : 0);
  int vay = cy + (axis == 0 ? 0 : 1);

  // BOTH SHEETS BY NAME — see the WGSL twin, and water.ts's sideFace.
  float mine = sheetAt(cx, cy, a);
  float theirs = wetJ ? sheetAt(jx, jy, a) : -1.0;
  float ownTop = min(bed + d, roofAt(cx, cy, a));
  float theirTop = wetJ ? min(bedJ + depthAt(jx, jy, a), roofAt(jx, jy, a)) : bedJ;
  vec4 cA = cornerOf(vax, vay, mine);
  vec4 cB = cornerOf(cx + 1, cy + 1, mine);
  vec4 oA = cornerOf(vax, vay, theirs);
  vec4 oB = cornerOf(cx + 1, cy + 1, theirs);
  vec4 s = resolveSide(
    bed, bedJ, wetJ,
    cA.w > 0.0 ? cA.x : ownTop, oA.w > 0.0 ? oA.x : theirTop,
    cB.w > 0.0 ? cB.x : ownTop, oB.w > 0.0 ? oB.x : theirTop
  );

  bool onA = corner == 0 || corner == 3;
  bool onTop = corner == 0 || corner == 1;
  p.fx = onA ? ax : fx0 + step;
  p.fy = onA ? ay : fy0 + step;
  float top = onA ? s.x : s.y;
  float foot = onA ? s.z : s.w;
  p.h = onTop ? top : foot;

  int mat = int(texelFetch(uMaterial, ivec2(cx, slotRow(cy, a)), 0).r * 255.0 + 0.5);
  p.colour = aerated(mat, 0.08 + pace(cx, cy, d, a) * 0.14);
  // The same ramp the surface uses — see the WGSL twin.
  // Floored at a brink, the same as the surface — see the WGSL twin.
  float sd = max(d, ${SHOW_DEPTH} * atBrink(cx, cy, a));
  float body = (${SOLID_FLOOR} + ${SOLID_RANGE} * min(1.0, sd / ${OPAQUE_DEPTH}.0)) * min(1.0, sd / ${SHOW_DEPTH});
  // HANDED OVER TO THE SHEET AT A LIP — see the WGSL twin.
  float beside = wetJ ? bedJ + depthAt(jx, jy, a) : bedJ;
  p.alpha = body * (1.0 - ${RIM}.0 * spillAt(bed, beside));
  p.ok = true;
  return p;
}

void main() {
  int cpt = int(uGrid.z);
  int per = cpt * cpt;
  // ONE INSTANCE PER QUAD — see the WGSL twin.
  int corner = int(aVertexId);
  gl_Position = vec4(0.0, 0.0, 0.0, 1.0);
  vColor = vec4(0.0);
  // Nought is an EMPTY slot and not quad nought. Identity here in practice:
  // WebGL has no compute to gather a list with.
  // THE LIST IS ALWAYS THE IDENTITY HERE, so this path does not read it.
  //
  // Gathering is a compute pass and WebGL has none, so the list this twin
  // would look in holds exactly 0, 1, 2 … and the answer is the instance
  // index. The WGSL side reads a texture because there the list has been
  // compacted; reading it here buys nothing and costs the one thing this path
  // could not do — an r32uint texture sampled through a usampler2D, which is
  // where the water stopped drawing on WebGL even after the shader compiled.
  int quad = gl_InstanceID;
  // A part, a STOREY and a column — see the WGSL twin.
  int L = slots();
  int part = quad % ${PARTS};
  int cell = quad / ${PARTS};
  int a = cell % L;
  int slot = cell / L;
  int tileIdx = slot / per;
  int sub = slot % per;

  if (float(tileIdx) >= uBand.w) { return; }

  int tx = int(uBand.y) + tileIdx;
  int ty = int(uBand.x) - tx;
  int sx = sub % cpt;
  int sy = sub / cpt;
  int cx = tx * cpt + sx;
  int cy = ty * cpt + sy;
  if (!inside(cx, cy)) { return; }

  float d = depthAt(cx, cy, a);
  if ((roofAt(cx, cy, a) < ${OPEN_SKY}) != roofedTier()) { return; }
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
    // THIS COLUMN'S OWN SHEET — see the WGSL twin.
    float sheet = sheetAt(cx, cy, a);
    vec4 c = cornerOf(cx + ox, cy + oy, sheet);
    float bed = groundAt(cx, cy, a);
    h = max(c.x, bed);
    fx = fx0 + float(ox) * step;
    fy = fy0 + float(oy) * step;

    vec4 e = cornerExtras(cx + ox, cy + oy, sheet);
    float cd = e.x; float wash = e.y; float foam = e.z; float speed = e.w;
    float gx = nearby(cx + ox - 1, cy + oy, sheet, c.x)
             - nearby(cx + ox + 1, cy + oy, sheet, c.x);
    float gy = nearby(cx + ox, cy + oy - 1, sheet, c.x)
             - nearby(cx + ox, cy + oy + 1, sheet, c.x);
    float lean = (gx + gy) * 0.5;
    float respond = lean / (abs(lean) + ${SLOPE_REF});
    float rough = min(1.0, (abs(gx) + abs(gy)) / ${SLOPE_REF * 2});
    float shown = max(rough, min(1.0, speed / ${STREAK_SPEED}));
    float lit = 0.5 + respond * 0.34 + wash * (0.2 + 0.8 * shown) * 0.3;
    float base = clamp(lit, 0.0, 1.0) * ${TINTS - 1}.0;
    float shade = base + foam * (${SHADES - 1}.0 - base);
    float fade = min(1.0, cd / ${SHOW_DEPTH});
    float body = (${SOLID_FLOOR} + ${SOLID_RANGE} * min(1.0, cd / ${OPAQUE_DEPTH}.0)) * fade;
    alpha = body + (1.0 - body) * foam * ${FOAM_COVER} * fade;
    int mat = int(texelFetch(uMaterial, ivec2(cx, slotRow(cy, a)), 0).r * 255.0 + 0.5);
    rgb = texelFetch(uTint, ivec2(int(shade + 0.5), mat), 0).rgb;
  } else if (part <= 2) {
    if (d <= uBand.z) { return; }
    if (!facesOn()) { return; }
    int axis = part - 1;
    if (forward(cx, cy, axis, cpt, a)) { return; }
    Part p = sidePart(cx, cy, axis, corner, fx0, fy0, step, d, a);
    if (!p.ok) { return; }
    fx = p.fx; fy = p.fy; h = p.h; rgb = p.colour; alpha = p.alpha;
  } else {
    if (!facesOn()) { return; }
    int axis = part - 3;
    int bx = cx - (axis == 0 ? 1 : 0);
    int by = cy - (axis == 0 ? 0 : 1);
    if (!inside(bx, by)) { return; }
    float bd = depthAt(bx, by, a);
    if (bd <= uBand.z) { return; }
    if ((roofAt(bx, by, a) < ${OPEN_SKY}) != roofedTier()) { return; }
    if (!forward(bx, by, axis, cpt, a)) { return; }
    Part p = sidePart(bx, by, axis, corner,
      fx0 - (axis == 0 ? step : 0.0), fy0 - (axis == 0 ? 0.0 : step), step, bd, a);
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
  /**
   * The same bands again, drawn BEFORE the paving, for water with something
   * over it. @see BandLayer.underOf
   */
  under: Mesh<Geometry, Shader>[];
  /** Whether the sides of the water are drawn — a debug switch. @see drawGpuWater */
  faces: number;
  /** The textures, each a view straight onto an array the solver owns. */
  sources: TextureSource[];
  /** Which quads each band draws, by draw index. @see quadCap */
  quads: TextureSource;
  /** The gathering that fills it, where there is a device to do it. */
  gather: QuadGather | null;
  /**
   * How many quads each band draws when NOTHING has gathered — the whole
   * complement, in draw order, which is what the identity list means.
   *
   * ON THE LAYER AND NOT ON THE GATHER, because it has to outlive it. The
   * gather goes when the device hands the water back to the host, and the
   * count the meshes were left holding is the last COMPACTED one: a few
   * hundred quads where identity wants tens of thousands. The map went dry the
   * instant it came off the device, which read as the host path being broken.
   * @see drawGpuWater
   */
  most: number[];
  /** The shade ramp, shared with whatever else paints this water. */
  tint: TextureSource;
  /** The ground revision the texture holds. @see ColumnField.groundRev */
  groundSent: number;
  wash: FlowWash;
  foam: FoamField;
  /**
   * WHICH SHEET each column's water belongs to, and the float mirror of it
   * the shader reads.
   *
   * The corner rule groups by body of water, not by bed — see
   * `render/bodies`, which is where the grouping is decided and why. That is
   * a FLOOD FILL, which is global, and a vertex shader has no global
   * anything: it sees four columns round a corner and nothing else. So the
   * fill runs here, on the host, where it already ran for the other builder,
   * and goes up as one more texture.
   *
   * Ids are small integers and exact in an f32 well past any number of
   * sheets a map can have, so this rides the same `r32float` machinery as
   * every other field rather than earning a format of its own.
   */
  bodies: Bodies;
  bodyF32: Float32Array;
  /** How many storeys the field has. @see ColumnField.layers */
  layers: number;
  /** Whether the meshes draw at all. A measurement switch. @see showGpuWater */
  drawing: boolean;
  /** Milliseconds of CPU the last frame's build took, for measuring. */
  cpuMs: number;
  /** The two carried fields' advection, and the textures' re-upload. */
  advectMs: number;
  uploadMs: number;
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
const FLOAT_FIELDS = ["uDepth", "uGround", "uWash", "uFoam", "uFx", "uFy", "uBody", "uRoof"];
const BYTE_FIELDS = ["uTint", "uMaterial"];
/** The quad list, which is `r32uint` and so neither of the above. @see QUAD_CAP */
const UINT_FIELDS = ["uQuads"];

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
  UINT_FIELDS.forEach((_, k) => own.push(texture(
    1 + FLOAT_FIELDS.length + BYTE_FIELDS.length + k, "uint",
  )));
  return [[uniform(0)], [uniform(0)], own];
}

/** Which group each named resource belongs to — the other half Pixi infers. */
function nameLayout(): Record<string, number>[] {
  const own: Record<string, number> = { water: 0 };
  [...FLOAT_FIELDS, ...BYTE_FIELDS, ...UINT_FIELDS]
    .forEach((n, k) => { own[n] = 1 + k; });
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

/**
 * `columns` and not a `WaterField`, so a SECOND storey can have a layer too.
 *
 * Nothing here ever wanted the world's field — it reads the columns and
 * nothing else — and a bridge's water is a column field like any other, over
 * the same bands, drawn at the deck's own level because that is where its
 * ground is. @see WaterField.over
 */
export function createGpuWaterLayer(columns: ColumnField, bands: BandLayer, scale = 1): GpuWaterLayer {
  const { nx, ny } = columns;
  const { gpu, gl } = programs();

  // Every vertex knows only its own index. One buffer, built once, shared by
  // every band — the widest band is the longest diagonal, and no band needs
  // more than that many tiles.
  // ONE QUAD, and every band draws it as many times as it has quads. This was
  // a vertex per corner of every quad a band could ever hold and an index
  // buffer to match — hundreds of thousands of them, whose only content was
  // the numbers 0, 1, 2 … counted out. An instance index is that number.
  const idBuffer = new Buffer({
    data: new Float32Array([0, 1, 2, 3]),
    usage: BufferUsage.VERTEX | BufferUsage.COPY_DST,
  });
  const idxBuffer = new Buffer({
    data: new Uint32Array([0, 1, 2, 0, 2, 3]),
    usage: BufferUsage.INDEX | BufferUsage.COPY_DST,
  });

  // A SLOT'S PLANE IS A BLOCK OF ROWS, which is what the arrays already are:
  // slot `a` of column `i` lives at `a * cells + i`, and `cells` is `nx * ny`,
  // so the plane starts at row `a * ny` and nothing has to be re-packed. The
  // flux has a plane per slot PAIR and so is taller again.
  //
  // `wash` and `foam` stay one plane. They are fields of the WORLD — what the
  // current is carrying over a tile — and a bridge does not give a tile two
  // of them.
  const { layers } = columns;
  const depth = viewOf(columns.depth, nx, ny * layers);
  const ground = viewOf(columns.ground, nx, ny * layers);
  const roof = viewOf(columns.roof, nx, ny * layers);
  const fx = viewOf(columns.fx, nx, ny * layers * layers);
  const fy = viewOf(columns.fy, nx, ny * layers * layers);
  const wash = createFlowWash(columns);
  const foam = createFoam(columns);
  const washTex = viewOf(wash.now, nx, ny);
  const foamTex = viewOf(foam.now, nx, ny);
  const material = new BufferImageSource({
    resource: columns.material, width: nx, height: ny * layers, format: "r8unorm",
    scaleMode: "nearest",
  });
  // WHICH SHEET each column is part of. @see GpuWaterLayer.bodies
  const bodies = createBodies(columns);
  const bodyF32 = new Float32Array(nx * ny * layers).fill(NO_BODY);
  const body = viewOf(bodyF32, nx, ny * layers);
  const tint = tintSource();
  // WHICH QUADS EACH BAND DRAWS. The identity until something gathers it.
  // @see quadList
  const list = quadList(bands.w, bands.h, layers);
  const quads = quadListSource(list);

  const meshes: Mesh<Geometry, Shader>[] = [];
  const under: Mesh<Geometry, Shader>[] = [];
  for (let b = 0; b < bands.bands.length; b++) {
    // The tiles on this diagonal, and where they start.
    const tx0 = Math.max(0, b - (bands.h - 1));
    const tx1 = Math.min(bands.w - 1, b);
    const tiles = Math.max(0, tx1 - tx0 + 1);

    const water = new UniformGroup({
      uGrid: { value: new Float32Array([nx, ny, COLUMNS_PER_TILE, 1 / COLUMNS_PER_TILE]), type: "vec4<f32>" },
      uIso: { value: new Float32Array([HW * scale, HH * scale, HEIGHT_UNIT * scale, 1]), type: "vec4<f32>" },
      uBand: { value: new Float32Array([b, tx0, columns.params.dryDepth, tiles]), type: "vec4<f32>" },
      // WHERE THIS BAND'S SLICE OF THE LIST STARTS, and how wide the list is.
      // A uniform rather than a lookup because a band already has its own
      // shader — the offset is as much a property of the band as its first
      // tile is. @see quadList
      uList: { value: new Float32Array([list.offsets[b], LIST_W, 0, 0]), type: "vec4<f32>" },
      // HOW MANY STOREYS a column has, and the spare. @see ColumnField.layers
      //
      // LAST, because the struct it fills says last. Pixi lays a uniform group
      // out in the order the fields are written here and the shader reads it
      // by offset, so a field inserted in the middle of one and appended to
      // the other is every field after it reading its neighbour's numbers.
      // What that looked like was a storey count of 66 — the scaled half-width
      // out of uIso — and a map with no water drawn on it at all.
      uSlots: { value: new Float32Array([layers, 0, 0, 0]), type: "vec4<f32>" },
    });

    // Its own index buffer, exactly as long as the band is: the vertex buffer
    // is shared and sized for the widest diagonal, and how much of it a band
    // draws is simply how many indices it hands over.
    const geometry = new Geometry({
      attributes: { aVertexId: { buffer: idBuffer, format: "float32", stride: 4, offset: 0 } },
      indexBuffer: idxBuffer,
      // EVERY QUAD THIS BAND COULD HOLD, until something gathers the list and
      // says how many of them are worth drawing. @see drawGpuWater
      instanceCount: tiles * PER_TILE * PARTS * layers,
    });
    const shader = new Shader({
      gpuProgram: gpu, glProgram: gl,
      resources: {
        water,
        uDepth: depth, uGround: ground, uWash: washTex, uFoam: foamTex,
        uFx: fx, uFy: fy, uBody: body, uRoof: roof,
        uTint: tint, uMaterial: material, uQuads: quads,
      },
    });
    const mesh = new Mesh<Geometry, Shader>({ geometry, shader });
    mesh.eventMode = "none";
    bands.structureOf[b].addChild(mesh);
    meshes.push(mesh);

    // AND THE SAME BAND AGAIN, one tier lower, for the water that has
    // something over it. Its own uniform group because the tier is a uniform,
    // its own geometry because the instance count is its own — but the same
    // textures and the same program. @see BandLayer.underOf
    //
    // ONLY WHERE THERE CAN BE ANY. A map with no decks on it has no roofed
    // water and never will, so a second mesh per band there is a second pass
    // over every quad to throw all of them away.
    if (layers < 2) continue;
    const underWater = new UniformGroup({
      uGrid: { value: new Float32Array([nx, ny, COLUMNS_PER_TILE, 1 / COLUMNS_PER_TILE]), type: "vec4<f32>" },
      uIso: { value: new Float32Array([HW * scale, HH * scale, HEIGHT_UNIT * scale, 1]), type: "vec4<f32>" },
      uBand: { value: new Float32Array([b, tx0, columns.params.dryDepth, tiles]), type: "vec4<f32>" },
      uList: { value: new Float32Array([list.offsets[b], LIST_W, 0, 0]), type: "vec4<f32>" },
      uSlots: { value: new Float32Array([layers, 1, 0, 0]), type: "vec4<f32>" },
    });
    const underGeom = new Geometry({
      attributes: { aVertexId: { buffer: idBuffer, format: "float32", stride: 4, offset: 0 } },
      indexBuffer: idxBuffer,
      instanceCount: tiles * PER_TILE * PARTS * layers,
    });
    const underShader = new Shader({
      gpuProgram: gpu, glProgram: gl,
      resources: {
        water: underWater,
        uDepth: depth, uGround: ground, uWash: washTex, uFoam: foamTex,
        uFx: fx, uFy: fy, uBody: body, uRoof: roof,
        uTint: tint, uMaterial: material, uQuads: quads,
      },
    });
    const underMesh = new Mesh<Geometry, Shader>({ geometry: underGeom, shader: underShader });
    underMesh.eventMode = "none";
    bands.underOf[b].addChild(underMesh);
    under.push(underMesh);
  }

  return {
    meshes,
    under,
    faces: 1,
    // `body` LAST, and deliberately past the end of what the device fills —
    // see FED, which is by index. The host owns this one whichever solver is
    // running, because the fill is the host's. @see GpuWaterLayer.bodies
    sources: [depth, ground, washTex, foamTex, fx, fy, material, body, roof],
    // THE SHADE RAMP, kept on the layer because the falls colour from it too:
    // a sheet and the surface it leaves are the same water, so they read the
    // same table. @see createSheet
    tint,
    quads,
    wash, foam, bodies, bodyF32, layers, gather: null, groundSent: -1,
    most: meshes.map((m) => m.geometry.instanceCount),
    drawing: true, cpuMs: 0, advectMs: 0, uploadMs: 0,
  };
}

/**
 * WHICH SOURCE THE DEVICE CAN FILL, and out of which field.
 *
 * By index into `sources`, which is built once just above and in one place, so
 * the pairing is stated next to it rather than searched for.
 *
 * `ground` is not here and never will be: the device does not write the
 * terrain, so there is nothing to copy.
 *
 * MATERIAL IS HERE, and it comes out of a different field from the one it
 * lives in. Its texture is `r8unorm` — one byte a column — while the solver
 * holds material as a float like everything else, and a buffer-to-texture copy
 * does not convert. So a pass packs four of them into a word, which is exactly
 * the bytes the texture wants in exactly the order it wants them, and the copy
 * reads THAT. @see createMatpack
 */
const FED: readonly (readonly [number, FieldName, 1 | 4])[] = [
  [0, "depth", 4], [2, "washNow", 4], [3, "foamNow", 4],
  [4, "fx", 4], [5, "fy", 4], [6, "matByte", 1],
];
const FED_AT = new Set(FED.map(([k]) => k));
/** Where the ground sits in `sources`. The one the device never writes. */
const GROUND_AT = 1;
/** And the sheet ids, which the host fills whichever solver is running. */
const BODY_AT = 7;
/** And the roofs, which are geometry and move only when the map does. */
const ROOF_AT = 8;

/** Just enough of the renderer to ask what stands behind a texture source. */
type GpuTextureSystem = {
  texture: { getGpuSource: (s: TextureSource) => GPUTexture };
};

/**
 * The textures for the solver to fill, or nothing at all.
 *
 * Nothing at all on the WebGL path, where there is no `getGpuSource` to ask,
 * and one at a time on a map whose rows are the wrong width for that texel —
 * see `canCopyOut`. Whatever is left out the layer keeps uploading exactly as
 * it always has, which is slower and right rather than faster and absent.
 *
 * The solver READS THIS BACK: material left out here has to keep coming down
 * every frame, because the host's copy is then what fills the texture.
 */
export function deviceSinks(
  wl: GpuWaterLayer, renderer: unknown, nx: number,
): Sink[] {
  const sys = renderer as Partial<GpuTextureSystem>;
  if (typeof sys?.texture?.getGpuSource !== "function") return [];
  const get = sys.texture.getGpuSource.bind(sys.texture);
  // PER TEXTURE, not once for the layer. A map 128 columns across can take the
  // float copies and cannot take the material's byte one, and asking the
  // question once gave the stricter answer to all six. @see canCopyOut
  const fed = FED.filter(([, , texel]) => canCopyOut(nx, texel));
  // AND SAY SO WHEN ONE IS REFUSED. A map whose rows are the wrong width falls
  // back to the host uploading that texture every frame — slower, correct, and
  // completely silent, so the first anybody knows is a frame time that does
  // not match the same code on a different map. Once, at build, with the
  // number that would have to change.
  if (import.meta.env.DEV && fed.length < FED.length) {
    const out = FED.filter(([, , t]) => !canCopyOut(nx, t)).map(([, n]) => n);
    console.info(
      `WATER: ${out.join(", ")} cannot be copied into at ${nx} columns and will`
      + " be uploaded by the host every frame. A row must be a multiple of 256"
      + " bytes: 64 columns for a float texture, 256 for the material's byte one.",
    );
  }
  return fed.map(([k, name, texel]) => ({ name, texture: get(wl.sources[k]), texel }));
}

/**
 * THE WATER'S MESHES, HIDDEN, to find out what they cost the GPU.
 *
 * Everything the scene draws goes into ONE render pass, so the timestamps on
 * it are a single number for the lot and there is no splitting it from the
 * inside. What there is is subtraction: time the pass with the water drawing
 * and again with it hidden, and the difference is the water's share of it.
 *
 * A measurement and not a feature — it leaves the map showing terrain with
 * nothing on it — which is why it is a function nobody calls rather than a
 * switch on the layer. The band visibility it overwrites is recomputed from
 * the active box on the next frame that draws, so turning it back on needs
 * nothing but turning it back on.
 */
export function showGpuWater(wl: GpuWaterLayer, show: boolean) {
  wl.drawing = show;
  for (const m of [...wl.meshes, ...wl.under]) m.visible = show && m.visible;
}

/**
 * The gathering, and what the host needs to draw by its answer.
 *
 * Held on the layer because it is the layer's textures it reads and the
 * layer's texture it fills. Null on WebGL and anywhere there is no device.
 */
export type QuadGather = {
  pass: QuadsPass;
  /** Where the ids land, in the shader's own texture. */
  into: GPUTexture;
  /** The last counts to come back, padded and clamped when they are used. */
  count: Uint32Array;
  /**
   * WHAT EACH BAND HAS LATELY GROWN BY between one gathering and the next.
   *
   * The pad the draw uses, rather than a constant. A constant has to be sized
   * for the worst thing that can happen to a band — a pour landing on dry
   * ground, which is 34% and 72 quads — and is then paid on every frame of the
   * steady state, which asks for 3.2% and 18. Measured over twenty-five
   * thousand band-frames, the constant that was here was eight times what the
   * still map needed.
   *
   * A RUNNING MAXIMUM THAT LEAKS DOWN. It rises the frame after a band grows
   * and comes back a quad a frame, so a pour widens that band for about half a
   * second and nothing else. @see LEAK
   */
  grew: Int32Array;
  /** The counts the growth is measured against. @see grew */
  was: Uint32Array;
  /** One readback at a time; it is a frame or two behind and that is fine. */
  staging: GPUBuffer;
  busy: boolean;
  /** Whether the list currently holds a gathering or the identity. */
  gathered: boolean;
  /** Frames still checked for validation errors. @see createQuadsPass */
  watch: number;
  /** Where each band's quads live. @see quadList */
  list: QuadList;
};

/** Just enough of the renderer to ask what stands behind a texture source. */
type GetGpu = { texture: { getGpuSource: (s: TextureSource) => GPUTexture } };

export function attachQuadGather(
  wl: GpuWaterLayer, renderer: unknown, device: GPUDevice | null,
  w: number, h: number,
): QuadGather | null {
  const sys = renderer as Partial<GetGpu>;
  if (!device || typeof sys?.texture?.getGpuSource !== "function") return null;
  const get = sys.texture.getGpuSource.bind(sys.texture);
  const list = quadList(w, h, wl.layers);
  const bands = wl.meshes.length;
  // THE ROW RULE IS NOW SATISFIED BY CONSTRUCTION. A buffer-to-texture row has
  // to be a multiple of 256 bytes, and it used to be a band's STRIDE — so a map
  // whose shorter side was not a multiple of four lost its gathering outright
  // and every band drew its whole complement for ever, correctly and slowly,
  // which is exactly why nobody noticed. The row is `LIST_W` now and nothing
  // about the map's shape can change it.
  const pass = createQuadsPass(device, list, LIST_W * list.rows, DRAWDOWN);
  pass.bind(
    get(wl.sources[0]).createView(),
    get(wl.sources[1]).createView(),
    // The sheet ids, which this pass shares the corner rule with and so needs
    // the same answer from. @see GpuWaterLayer.bodies
    get(wl.sources[BODY_AT]).createView(),
    get(wl.sources[ROOF_AT]).createView(),
  );
  return {
    pass,
    into: get(wl.quads),
    count: new Uint32Array(bands),
    grew: new Int32Array(bands),
    was: new Uint32Array(bands),
    staging: device.createBuffer({
      size: Math.max(16, bands * 4),
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
      label: "quad counts back",
    }),
    busy: false,
    gathered: false,
    watch: 4,
    list,
  };
}

/**
 * Gather this frame's quads, and ask for the counts.
 *
 * Its own encoder and its own submit, after the solver's: the pass reads the
 * depth and the ground TEXTURES, and on the device path those are filled by a
 * copy on the end of the solver's frame. Run before it, this would gather
 * last frame's water.
 */
export function gatherQuads(
  g: QuadGather, device: GPUDevice, columns: ColumnField,
  w: number, h: number, faces: boolean,
) {
  g.pass.say(
    columns.nx, columns.ny, COLUMNS_PER_TILE, h,
    columns.params.dryDepth, FALL_MIN, faces, columns.layers,
  );
  const enc = device.createCommandEncoder({ label: "quads" });
  // A THREAD PER QUAD, and a column has a storey's worth of them.
  g.pass.encode(enc, columns.nx * columns.ny * columns.layers);
  enc.copyBufferToTexture(
    { buffer: g.pass.list, bytesPerRow: LIST_W * 4, rowsPerImage: g.list.rows },
    { texture: g.into },
    { width: LIST_W, height: g.list.rows, depthOrArrayLayers: 1 },
  );
  if (!g.busy) {
    enc.copyBufferToBuffer(
      g.pass.counts, 0, g.staging, 0, g.count.length * 4,
    );
  }
  if (g.watch > 0) {
    g.watch--;
    device.pushErrorScope("validation");
    device.queue.submit([enc.finish()]);
    void device.popErrorScope().then((e) => {
      if (e) console.error("WATER: the gathering did not validate —", e.message);
    });
  } else device.queue.submit([enc.finish()]);
  g.gathered = true;
  void w;
  if (g.busy) return;
  g.busy = true;
  void g.staging.mapAsync(GPUMapMode.READ).then(() => {
    const got = new Uint32Array(g.staging.getMappedRange());
    // HOW MUCH EACH BAND JUST GREW, before the new counts overwrite the old.
    // @see QuadGather.grew
    for (let b = 0; b < g.count.length; b++) {
      const by = got[b] - g.was[b];
      const fell = g.grew[b] - LEAK;
      g.grew[b] = Math.max(by, fell > 0 ? fell : 0);
      g.was[b] = got[b];
    }
    g.count.set(got);
    g.staging.unmap();
  }).catch(() => { /* torn down mid-flight */ })
    .finally(() => { g.busy = false; });
}

/**
 * How many instances a band draws: what came back, with room to grow.
 *
 * The count is a readback and so a frame or two old, and a puddle spreading
 * under it means the real number is a little larger by the time it is used.
 * Too MANY is free — the list is cleared every frame, so the slots past the
 * gathering read as empty and collapse — and too few would drop quads that
 * exist, which is water flickering. So it rounds up generously and clamps to
 * what the band can hold.
 */
/**
 * How fast the remembered growth comes back down, in quads a frame.
 *
 * One. A band that took a pour is padded for it for about as many frames as
 * the pour was wide — half a second on the worst one measured — and a band
 * that is merely spreading is back to the floor within a few.
 */
const LEAK = 1;

/**
 * And the floor, which is what a band that has never grown still carries.
 *
 * Above the 18 quads the steady state was measured to want, so a map that is
 * simply flowing never reaches for the remembered part at all.
 */
const SPARE = 24;

/**
 * How many quads a band draws: what was gathered, plus room to have grown.
 *
 * SHORT IS NOT A FAULT. The count is a frame stale, so a band that has just
 * grown draws fewer quads than it has for one frame and a sliver of new water
 * appears eight milliseconds late. That is the trade this is making, and both
 * halves of it are measured over 38,100 band-frames:
 *
 *   steady        no band ever drew short at all
 *   six pours     58 band-frames short, 0.15%, by at most 36 quads
 *   drawn         108,576 -> 73,963 for the same 60,600 gathered
 *   render        4.63ms -> 3.98ms
 *
 * Thirty-six quads is thirty-six columns of sixty thousand, for one frame, at
 * the moment of a click. Covering it would want `SPARE` at 64, which is seven
 * per cent more vertices on every frame of the session to remove something
 * nobody can see.
 */
export const roomFor = (n: number, grew: number, most: number) =>
  Math.min(most, n + (grew > 0 ? grew : 0) + SPARE);

export function destroyQuadGather(g: QuadGather | null) {
  if (!g) return;
  g.pass.destroy();
  g.staging.destroy();
}

export function destroyGpuWaterLayer(wl: GpuWaterLayer) {
  for (const m of [...wl.meshes, ...wl.under]) {
    m.parent?.removeChild(m);
    m.destroy({ children: true });
  }
  wl.meshes.length = 0;
  wl.under.length = 0;
}

/**
 * A frame: step the two carried fields, then say the textures have changed.
 *
 * That is the whole of it. There are no corners to average and no vertices to
 * write, because the vertex shader does both — so what is left on the CPU is
 * the simulation's own work and six calls to mark a texture dirty.
 */
export function drawGpuWater(
  wl: GpuWaterLayer, columns: ColumnField, bands: BandLayer, dt: number,
  faces = true, carried = false,
) {
  const t0 = performance.now();
  // The debug switch, into the spare slot of `uIso`. Written per band because
  // each one carries its own group, and only when it changes: a uniform
  // upload per band per frame to say the same thing again is not free.
  const want = faces ? 1 : 0;
  if (wl.faces !== want) {
    wl.faces = want;
    for (const m of [...wl.meshes, ...wl.under]) {
      const grp = m.shader?.resources.water as UniformGroup | undefined;
      if (!grp) continue;
      (grp.uniforms.uIso as Float32Array)[3] = want;
      grp.update();
    }
  }
  const region = activeBox(columns);
  const tA = performance.now();
  if (region) {
    // WHICH WATER IS ONE SHEET, before anything is drawn from it. One column
    // wider than the box for the same reason the CPU builder needs it: a side
    // face asks what the NEIGHBOUR draws, and the neighbour of the last
    // column in the box is outside it. @see findBodies
    findBodies(columns, {
      x0: region.x0 - 1, y0: region.y0 - 1,
      x1: region.x1 + 1, y1: region.y1 + 1,
    }, wl.bodies);
    // Into the float mirror the texture is a view over. The whole array,
    // because `findBodies` now clears what it labelled last time and the
    // two have to agree everywhere, not only where the water is.
    const at = wl.bodies.at;
    for (let i = 0; i < wl.bodyF32.length; i++) wl.bodyF32[i] = at[i];
  }
  if (region && dt > 0) {
    // `carried` says the device has already advected the wash and filled
    // `wash.now` from its own readback. Stepping it again here would not just
    // waste the time — it would advect the device's answer a second time.
    if (!carried) {
      stepFlowWash(wl.wash, columns, dt, region);
      stepFoam(wl.foam, columns, dt, region);
    }
  }
  const tB = performance.now();
  // ONLY THE ONES THE DEVICE IS NOT FILLING. With the solver running, five of
  // these seven textures are written by a buffer copy on the end of its own
  // command buffer, and marking them dirty here would send the host's copy of
  // the same numbers straight back up — a megabyte and a quarter a frame to
  // overwrite the answer with itself. @see deviceSinks
  for (let k = 0; k < wl.sources.length; k++) {
    if (carried && FED_AT.has(k)) continue;
    // THE GROUND ONLY WHEN IT MOVES. With the device filling the rest, this
    // loop was uploading the terrain and nothing else — a quarter of a
    // megabyte a frame to say what it said last frame. The CPU path still
    // marks everything, because on that path nothing else is filling them.
    if (carried && k === GROUND_AT && columns.groundRev === wl.groundSent) {
      continue;
    }
    wl.sources[k].update();
  }
  wl.groundSent = columns.groundRev;
  const tC = performance.now();
  wl.advectMs = tB - tA;
  wl.uploadMs = tC - tB;

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
  const g = wl.gather;
  for (let b = 0; b < wl.meshes.length; b++) {
    const show = wl.drawing && b >= lo && b <= hi;
    // HOW MANY QUADS THIS BAND DRAWS. What the gathering found, with room to
    // grow, or every quad it could hold when nothing has gathered. @see roomFor
    //
    // `wl.most` EITHER WAY, so losing the gather falls back to identity rather
    // than to whatever the last gathering happened to leave behind. @see most
    // BOTH TIERS THE SAME. The gather counts quads and not which mesh will
    // keep them, so each tier is asked to consider the same complement and
    // each throws away what is not its own. @see roofedTier
    const n = g && g.gathered
      ? roomFor(g.count[b], g.grew[b], wl.most[b])
      : wl.most[b];
    wl.meshes[b].geometry.instanceCount = n;
    // Only on a change: visibility is structural, and flipping it every frame
    // makes the renderer rebuild the scene's instruction list every frame.
    if (wl.meshes[b].visible !== show) wl.meshes[b].visible = show;
    const u = wl.under[b];
    if (u) {
      u.geometry.instanceCount = n;
      if (u.visible !== show) u.visible = show;
    }
  }
  wl.cpuMs = performance.now() - t0;
}

/** For measuring: how many quads the GPU is asked to consider, wet or dry. */
export const gpuQuadsConsidered = (wl: GpuWaterLayer) =>
  wl.meshes.reduce((n, m) => n + (m.geometry.indexBuffer.data?.length ?? 0) / 6, 0);
