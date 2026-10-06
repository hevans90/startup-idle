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
import { holdShown } from "./hold";
import { MIN_TEXTURE_DIMENSION, heldGpu } from "./device";
import {
  Buffer, BufferImageSource, BufferUsage, Geometry, GlProgram, GpuProgram, Mesh,
  Shader, TextureSource, UniformGroup,
} from "pixi.js";

import {
  activeBox, MATERIAL_SLOTS, MAX_FLOW_SPEED, type ColumnField,
} from "../../fluid/columns";
import { RIM, brinkRuleSource, cornerRuleSource } from "./corner-rule";
import { OPEN_SKY } from "../../fluid/slots";
import { quadRuleSource } from "./quad-rule";
import { sheetGroupSource } from "./sheet-group";
import { createQuadsPass, type QuadsPass } from "./quads-gpu";
import { brinkRow, createBrinkPass, type BrinkPass } from "./brink-gpu";
import { FALL_MIN, FALL_STOP, LATCH_ROW } from "../../fluid/falls";
import { fluidMaterial } from "../water/materials";
import { COLUMNS_PER_TILE, STOREYS } from "../water/field";
import { HEIGHT_UNIT, HH, HW } from "../iso";
import type { BandLayer } from "./bands";
import { createFlowWash, stepFlowWash, type FlowWash } from "./flow-wash";
import {
  stateBytes, type FieldName, type Sink,
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
 *
 * AND THE NUMBER IS THE DRAW ORDER, which is why they are numbered as they
 * are. A band draws its quads in index order, so what a part IS decides what
 * is painted over what:
 *
 *   0, 1  the far-edge face of the column BEHIND, filed into this diamond
 *   2     this column's surface
 *   3, 4  this column's own side faces
 *
 * The forward-filed faces come FIRST because they belong to water further
 * from the camera than anything this column draws. Numbered last, they were
 * painted over the surface of the tile they hang into — while the mesh
 * builder, which files the same face into the band ahead before reaching any
 * of that band's columns, painted it under. Ten of the pixels the water
 * comparison used to carry were that and nothing else, and the other twelve
 * were the STOREY sitting outside the part in a quad's id, which is the same
 * mistake one level up. @see quadRuleSource, mainVertex
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
  /**
   * Where the ROOFED tier's copy of the layout begins, or nought on a map of
   * one storey, which has no roofed water. Band `b`'s roofed quads live at
   * `second + offsets[b]`, with the same cap. @see BandLayer.underOf
   */
  second: number;
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
  // TWICE OVER WHERE THERE ARE TWO TIERS. Each band draws twice on a map with
  // decks — once under the paving for water with something over it, once over
  // it for the rest — and each used to be handed the SAME list and throw away
  // what was not its own, so every quad on the map paid for its vertex shader
  // twice once a single deck existed anywhere: a flooded bridge drew 38,698
  // quads where a flooded river drew 15,226. The gathering sorts each quad
  // into its tier now, and the roofed ones need a list of their own.
  const second = layers > 1 ? at : 0;
  const total = layers > 1 ? at * 2 : at;
  return { caps, offsets, total, rows: Math.max(1, Math.ceil(total / LIST_W)), second };
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
  const device = heldGpu()?.device;
  const tiles = ceilingFor(device ? device.limits : null);
  return Math.max(step, Math.floor(tiles / step) * step);
};

/**
 * How wide a tile has to be on screen, in pixels, before it is drawn column
 * by column. Narrower than this a column is two pixels or less, and a flat
 * tile is drawn as one quad. @see zoomedOut, quads-gpu's tiles
 *
 * WHY: the render is vertex-bound, and on a big map the mesh is the map's
 * area in quads whatever the screen can show. A 128 tile map flooded drew
 * 252,000 surfaces for 12 ms of GPU, fitted to a window where each of them
 * is under a pixel across.
 */
export const LOD_TILE_PX = 8;

/**
 * And how wide a tile has to be before a COLUMN'S surface is shaded off the
 * sheet it is in, rather than off the columns round each corner — the cheap
 * gradient whole tiles already use. @see nearbyFlat, cheapGradient
 *
 * WHY: the sheet-aware gradient is four calls of the sheet grouping a vertex,
 * and on a big window it is half the render. A 128 tile map poured over,
 * fitted to a 1512 point window, drew 296,000 surfaces in 24.8 ms; the cheap
 * gradient drew them in 11.5. What it gives up is shading at shores and
 * lips, where the columns round a corner are in different sheets — 2.5 to
 * 3.7 per cent of the water's pixels move by more than five levels at the
 * pixel comparison's zoom — and under 24 points a column is under six.
 */
export const GRAD_TILE_PX = 24;

/** Whether, at this on-screen scale, columns are shaded cheaply. @see GRAD_TILE_PX */
export const cheapGradient = (scale: number) => 2 * HW * scale < GRAD_TILE_PX;

/**
 * The most instances any band's water mesh draws, for a MEASUREMENT: one keeps
 * every draw and drops nearly all the work, which says what the draws alone
 * cost. Never set outside one. @see perf-scene
 */
let instanceCap = Infinity;
export const setInstanceCap = (n: number) => { instanceCap = n; };

/**
 * Whether, at this ON-SCREEN scale — the world's scale times the viewport's
 * zoom — flat tiles are drawn whole. @see LOD_TILE_PX
 */
export const zoomedOut = (scale: number) => 2 * HW * scale < LOD_TILE_PX;

/**
 * Which tiles can be on screen across it, as a range of tx - ty, from the
 * viewport's left and right edges in world units.
 *
 * A tile's x on screen is (tx - ty) times the half-width and NOTHING ELSE —
 * its height moves it up and down, never sideways — so this is exact up to
 * the tile's own width, and the margin covers that and the faces a tile
 * files into the band in front of it. Above and below is the bands' own cull.
 * At scale one a 128 tile map drew all of every visible band, the map's full
 * width of it, into a window a few dozen tiles across. @see visibleBandRange
 */
export const CULL_MARGIN = 3;
export const cullFor = (left: number, right: number, scale: number) => ({
  from: Math.floor(left / (HW * scale)) - CULL_MARGIN,
  to: Math.ceil(right / (HW * scale)) + CULL_MARGIN,
});

/** The device limits a map's size is held to. @see ceilingFor */
export type SizeLimits = {
  maxTextureDimension2D: number;
  maxStorageBufferBindingSize: number;
  maxBufferSize: number;
};

/**
 * The guaranteed limits, for when there is no device to ask: the one answer
 * true everywhere. @see MIN_TEXTURE_DIMENSION
 */
const GUARANTEED: SizeLimits = {
  maxTextureDimension2D: MIN_TEXTURE_DIMENSION,
  maxStorageBufferBindingSize: 128 * 1024 * 1024,
  maxBufferSize: 256 * 1024 * 1024,
};

/**
 * The largest square map, in tiles, that every buffer and texture the water
 * makes will fit, on a device with these limits.
 *
 * NOT JUST THE QUAD LIST. This used to be {@link maxMapTiles} alone — the one
 * texture somebody had once hit — and offered 204 tiles on a device that
 * could not hold a 128 tile map's water: the solver's state is one storage
 * buffer of every field, which at 128 tiles with a deck is a 161 MB binding
 * against the 128 a device gets unasked. Nothing threw. The water stopped.
 *
 * AS IF THE MAP HAD A DECK, because it can be given one at any moment and
 * the field grows its second storey then, after the size was chosen.
 * @see STOREYS, fieldSizes
 */
export function ceilingFor(limits: SizeLimits | null): number {
  const lim = limits ?? GUARANTEED;
  const tex = lim.maxTextureDimension2D;
  const buffer = Math.min(lim.maxStorageBufferBindingSize, lim.maxBufferSize);
  const L = STOREYS;
  const fits = (t: number) => {
    const n = t * COLUMNS_PER_TILE;
    // A wind cell is four tiles across. @see ColumnField.wstride
    const wind = Math.ceil(t / 4) ** 2;
    if (stateBytes(n, n, L, wind) > buffer) return false;
    if (n * L > tex) return false;                              // a plane per storey
    if (Math.ceil((n * n * L * L * 2) / LATCH_ROW) > tex) return false;   // the latch
    const list = quadList(t, t, L);
    if (list.rows > tex || LIST_W * list.rows * 4 > buffer) return false;
    return true;
  };
  let t = maxMapTiles(tex);
  while (t > 1 && !fits(t)) t--;
  return t;
}

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
  // THE IDENTITY, IN BOTH TIERS: until something gathers, each tier considers
  // every quad and keeps its own, which is what both did before there was a
  // gathering at all. @see QuadList.second
  for (const base of list.second ? [0, list.second] : [0]) {
    for (let b = 0; b < list.caps.length; b++) {
      const at = base + list.offsets[b];
      for (let q = 0; q < list.caps[b]; q++) ids[at + q] = q + 1;
    }
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
  uSlots: vec4<f32>,      // storeys, which band tier, brink filled, latch fresh
};
@group(2) @binding(0) var<uniform> water : Water;
@group(2) @binding(1) var uDepth : texture_2d<f32>;
@group(2) @binding(2) var uGround : texture_2d<f32>;
@group(2) @binding(3) var uWash : texture_2d<f32>;
@group(2) @binding(4) var uFoam : texture_2d<f32>;
@group(2) @binding(5) var uFx : texture_2d<f32>;
@group(2) @binding(6) var uFy : texture_2d<f32>;
@group(2) @binding(7) var uRoof : texture_2d<f32>;
// HOW HARD EACH SLOT IS LEAVING, worked out once a frame. @see brink-gpu
//
// IN THE ORDER THE RESOURCES ARE HANDED OVER, which is what decides the
// binding and not the number written here: Pixi walks the resource object and
// assigns them in turn, so a texture inserted in the middle of that object and
// numbered at the end here silently shifts every binding past it. What that
// looks like is the quad list arriving where the shade ramp was expected —
// "none of the supported sample types (Uint) match the expected (Float)" — and
// the whole water pass refusing to build.
@group(2) @binding(8) var uBrink : texture_2d<f32>;
@group(2) @binding(9) var uTint : texture_2d<f32>;
@group(2) @binding(10) var uMaterial : texture_2d<f32>;
// WHICH EDGES THE SOLVER SAYS ARE FALLING, so a sheet splits at a lip exactly
// when the lip falls. A BYTE TEXTURE, so after the material in the resources
// too. See latchAt.
@group(2) @binding(11) var uFalling : texture_2d<f32>;
@group(2) @binding(12) var uQuads : texture_2d<u32>;

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
/** The underside of whatever is over a slot, or the open sky. @see fluid/slots */
fn roofAt(x: i32, y: i32, a: i32) -> f32 {
  return textureLoad(uRoof, vec2<i32>(x, slotRow(y, a)), 0).r;
}
// A CORNER'S CONTRIBUTORS AS A BITMASK, twelve at the very most. Here and not
// in the shared rule because WGSL wants a u32 on the right of a shift and GLSL
// has no u32 at all, so the two cannot be spelled the same way — the same
// reason select is on this side. @see render/sheet-group
// IS THERE WATER HERE. One spelling of the one threshold, because there used
// to be several and they drifted: a run at moving the cutoff changed some of
// them and not the others, and what that made was a column feeding a corner's
// HEIGHT but not its alpha — a hole with extra steps, on the device only, that
// the mesh builder could not reproduce. @see wetRule
fn wet(d: f32) -> bool { return d > dryDepth(); }
fn bitOf(k: i32) -> i32 { return 1i << u32(k); }
fn bitAt(m: i32, k: i32) -> i32 { return (m >> u32(k)) & 1; }
// Whether the brink texture was filled this frame. @see brink-gpu
fn brinkOn() -> bool { return water.uSlots.z > 0.5; }
/** The four things the shared corner rule asks its host for. */
fn dryDepth() -> f32 { return water.uBand.z; }
fn fallMin() -> f32 { return ${FALL_MIN}.0; }
fn fallStop() -> f32 { return ${FALL_STOP}.0; }
// WHETHER THE SOLVER'S LATCH SAYS THIS EDGE IS ALREADY FALLING, so the sheet
// grouping asks the same bar dropAt does. The edge of a slot PAIR, owned by
// the column (x, y), packed the way the solver packs it: a byte an edge, read
// back off a texture LATCH_ROW wide — ANY byte set, because the device packs a
// falling edge as 255 and the host keeps it as 1, and through r8unorm those
// read 1.0 and a 255th. Where the latch is not fresh this frame
// it answers no, and the grouping falls back to FALL_MIN alone. See
// FALL_STOP, LATCH_ROW, sameSheet.
fn latchAt(x: i32, y: i32, axis: i32, a: i32, b: i32) -> bool {
  if (water.uSlots.w < 0.5) { return false; }
  let w = i32(water.uGrid.x);
  let k = ((a * slots() + b) * w * i32(water.uGrid.y) + y * w + x) * 2 + axis;
  return textureLoad(uFalling, vec2<i32>(k % ${LATCH_ROW}, k / ${LATCH_ROW}), 0).r > 0.0;
}
/** Whether the sides of the water are drawn at all — a debug switch. */
fn facesOn() -> bool { return water.uIso.w > 0.5; }

fn inside(x: i32, y: i32) -> bool {
  return x >= 0 && y >= 0 && x < i32(water.uGrid.x) && y < i32(water.uGrid.y);
}

${brinkRuleSource("wgsl")}
// READ, NOT RUN, wherever the brink pass has been. The scan is two thirds of
// this shader's cost and its answer is the same for every one of the dozens of
// callers a column has in a frame — so it is worked out once per slot, on the
// device, and this is a texel. Where the map's width will not take the copy
// into the texture there is nothing to read and it runs, exactly as it did
// before. @see brink-gpu, canCopyOut
fn atBrink(cx: i32, cy: i32, a: i32) -> f32 {
  if (brinkOn()) { return textureLoad(uBrink, vec2<i32>(cx, slotRow(cy, a)), 0).r; }
  return brinkCalc(cx, cy, a);
}
${sheetGroupSource("wgsl")}
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
fn cornerExtras(vx: i32, vy: i32, mine: i32) -> vec4<f32> {
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
    // colour from whatever stood on the deck. @see render/sheet-group
    for (var a = 0; a < slots(); a = a + 1) {
      let dd = depthAt(cx, cy, a);
      if (dd <= water.uBand.z) { continue; }
      if (bitAt(mine, k * slots() + a) == 0) { continue; }
      // A lip is not a shoreline — see corner-rule's atBrink, and water.ts's
      // shownDepth, which is this.
      d = d + max(dd, ${SHOW_DEPTH} * atBrink(cx, cy, a));
      // The wash is the WORLD'S, one per column: a tile carries one resting
      // pattern whatever is built over it. The foam is this SLOT'S, because a
      // deck's white is carried by the deck's own current. @see stepFoam
      wash = wash + textureLoad(uWash, vec2<i32>(cx, cy), 0).r;
      foam = foam + textureLoad(uFoam, vec2<i32>(cx, slotRow(cy, a)), 0).r;
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
fn nearby(vx: i32, vy: i32, dx: i32, dy: i32, mine: i32, here: f32) -> f32 {
  // ASKED THROUGH A COLUMN THE TWO CORNERS SHARE. A component decided AT the
  // home corner says nothing about the corner a step away, but the two of them
  // do share two columns — so the question travels along one of those, picked
  // canonically so that every column of this sheet asks the same one.
  // The home component comes in as an argument: this is called four times per
  // vertex and flooding the same corner four times over is most of what the
  // grouping cost. @see sharedOf
  let m = sharedOf(mine, dx, dy);
  let jx = vx + dx;
  let jy = vy + dy;
  if (m >= 0) {
    let q = m / slots();
    let c = cornerFor(jx, jy, vx - 1 + (q & 1), vy - 1 + (q >> 1), m % slots());
    if (c.w > 0.0) { return c.x; }
  }
  var below = here;
  // ONE FLOOD PER COMPONENT, not one per contributor. Everything a flood
  // finds is in the component it just answered for, so it never has to be
  // asked again — which takes this loop from eight floods to the number of
  // separate bodies of water meeting the corner, which is one or two.
  var seen = 0;
  for (var k = 0; k < 4; k = k + 1) {
    let cx = jx - 1 + (k & 1);
    let cy = jy - 1 + (k >> 1);
    if (!inside(cx, cy)) { continue; }
    for (var a = 0; a < slots(); a = a + 1) {
      let at = k * slots() + a;
      if (bitAt(seen, at) == 1) { continue; }
      if (depthAt(cx, cy, a) <= water.uBand.z) { continue; }
      let msk = cornerMask(jx, jy, at);
      seen = seen | msk;
      let o = cornerOf(jx, jy, msk);
      if (o.w > 0.0 && o.x < below) { below = o.x; }
    }
  }
  return below;
}

/**
 * NEARBY, CHEAPLY: the mean surface of the columns showing round the corner
 * one step away, in this quad's storey, or this corner's own where none do.
 *
 * FOR A WHOLE TILE ONLY. nearby above asks the corner one step away which
 * sheet it is in, and that is a flood — four of them a vertex, two thirds of
 * what the surface cost on a flooded 204 tile map: 27 ms with them, 9.5
 * without. A tile drawn whole is under eight pixels across, and the gradient
 * between its corners is shading detail inside a pixel or two, so it is read
 * straight off the columns. A lower corner still pulls the mean down, so a
 * brink still leans toward its lip. @see LOD_TILE_PX
 */
fn nearbyFlat(vx: i32, vy: i32, dx: i32, dy: i32, a: i32, here: f32) -> f32 {
  let jx = vx + dx;
  let jy = vy + dy;
  var sum = 0.0;
  var n = 0.0;
  for (var k = 0; k < 4; k = k + 1) {
    let cx = jx - 1 + (k & 1);
    let cy = jy - 1 + (k >> 1);
    if (!inside(cx, cy)) { continue; }
    if (!shows(cx, cy, a)) { continue; }
    sum = sum + min(groundAt(cx, cy, a) + depthAt(cx, cy, a), roofAt(cx, cy, a));
    n = n + 1.0;
  }
  return select(here, sum / n, n > 0.0);
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

  // BOTH SHEETS, EACH NAMED BY THE COLUMN THAT STANDS IN IT. The face hangs
  // from what THIS column's water draws at each corner down to what the
  // NEIGHBOUR'S draws there — which used to be two picks between a corner's
  // two groups, a stand-in for exactly this question. Asked by contributor it
  // is a lookup, and a neighbour that is a different body of water answers
  // differently without anything having to infer that from heights. A
  // neighbour off the map or dry belongs to nothing and comes back with a
  // count of nought. The twin of water.ts's sideFace.
  let ownTop = min(bed + d, roofAt(cx, cy, a));
  let theirTop = select(bedJ, min(bedJ + depthAt(jx, jy, a), roofAt(jx, jy, a)), wetJ);
  let cA = cornerFor(vax, vay, cx, cy, a);
  let cB = cornerFor(cx + 1, cy + 1, cx, cy, a);
  let oA = cornerFor(vax, vay, jx, jy, a);
  let oB = cornerFor(cx + 1, cy + 1, jx, jy, a);
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
  let raw = textureLoad(uQuads, vec2<i32>(at % lw, at / lw), 0).r;
  // A WHOLE TILE: zoomed out, a flat tile's surface is one quad from its
  // first column to its far corner, marked by the gathering. Only ever set in
  // a gathered list, so the identity draws as it always did. @see LOD_TILE_PX
  let whole = ((raw >> 30u) & 1u) == 1u;
  // AND A SURFACE TO SHADE CHEAPLY, the gathering's other mark: its tile is
  // small enough on screen that the gradient comes off the columns round
  // each corner, as a whole tile's always has. @see GRAD_TILE_PX
  let cheap = ((raw >> 29u) & 1u) == 1u;
  let quad = i32(raw & 0x1fffffffu) - 1;
  if (quad < 0) { return out; }
  // A QUAD IS A PART, A STOREY AND A COLUMN. A bridge column draws the river
  // under the span and whatever stands on the deck, so the storey is as much
  // a part of a quad's identity as which of the five pieces it is.
  let L = slots();
  // A QUAD IS A PART, A STOREY AND A COLUMN, and the STOREY is the innermost
  // of the three — which is the draw order as much as it is the packing.
  // Storey outside part, and all of storey nought's quads came before any of
  // storey one's: the road's own water was painted before the far-edge face
  // the SPAN beside it hangs into the same diamond, so the face landed on top
  // of water that is nearer the camera than it is. The builder, which files
  // that face into the band ahead before reaching any of that band's columns
  // whatever storey they are in, painted it under. @see PARTS
  let a = quad % L;
  let rest = quad / L;
  let part = rest % ${PARTS};
  let slot = rest / ${PARTS};
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
  // WHICHEVER COLUMN THIS QUAD HANGS OFF DECIDES ITS TIER, and for a face
  // filed FORWARD that is the column BEHIND, not the one whose diamond it
  // lands in. Asked about (cx, cy) here and "asked again" with the column
  // behind in the branch below, it was really asked about BOTH — and the
  // second question cannot undo the first.
  //
  // At a DECK-TO-ROAD SEAM that loses the face. An upper slot over a column
  // with no deck on it is ABSENT — floor and roof equal, which reads as
  // roofed — so the open tier of the band in front rejected the span's own
  // far-edge face before the branch that owns it ever ran. The builder drew
  // it and the device did not, and that is 22 of the 28 pixels the water
  // comparison has been carrying. @see syncSlots, forward
  let back = part <= 1;
  let ocx = cx - select(0, select(0, 1, part == 0), back);
  let ocy = cy - select(0, select(1, 0, part == 0), back);
  if (!inside(ocx, ocy)) { return out; }
  if ((roofAt(ocx, ocy, a) < ${OPEN_SKY}) != roofedTier()) { return out; }
  let step = water.uGrid.w;
  let fx0 = f32(tx) - 0.5 + f32(sx) * step;
  let fy0 = f32(ty) - 0.5 + f32(sy) * step;

  var fx = 0.0;
  var fy = 0.0;
  var h = 0.0;
  var rgb = vec3<f32>(0.0);
  var alpha = 0.0;

  if (back) {
    // The far-edge face of the column BEHIND this one, filed into this band
    // because that is the diamond it hangs into, and drawn FIRST because it
    // belongs to water further from the camera — see PARTS.
    //
    // ocx/ocy ARE that column, and the tier gate above has already been asked
    // about it, once, where every part asks.
    if (!facesOn()) { return out; }
    let bd = depthAt(ocx, ocy, a);
    if (bd <= water.uBand.z) { return out; }
    if (!forward(ocx, ocy, part, cpt, a)) { return out; }
    let p = sidePart(ocx, ocy, part, corner,
      fx0 - select(0.0, step, part == 0), fy0 - select(step, 0.0, part == 0), step, bd, a);
    if (!p.ok) { return out; }
    fx = p.fx; fy = p.fy; h = p.h; rgb = p.colour; alpha = p.alpha;
  } else if (part == 2) {
    // THE SURFACE.
    if (d <= water.uBand.z) { return out; }
    let ox = ((corner + 1) >> 1) & 1;
    let oy = corner >> 1;
    // HOW MANY COLUMNS THIS QUAD SPANS: one, or a whole tile. A whole tile's
    // corners are the tile's own, each asked by the tile's column AT that
    // corner — so each comes out exactly as the column-by-column mesh has it
    // there, and only what lies between them is lost. @see LOD_TILE_PX
    let span = select(1, cpt, whole);
    let ccx = cx + ox * (span - 1);
    let ccy = cy + oy * (span - 1);
    // THIS COLUMN'S COMPONENT AT THIS CORNER, worked out ONCE. A column is
    // always one of its own corners' four, so what comes back is always the
    // component it is in and always the one it helped make — and everything
    // this vertex asks of this corner is asked with it. @see render/sheet-group
    let vcx = ccx + ox;
    let vcy = ccy + oy;
    let mine = cornerMask(vcx, vcy, contribOf(vcx, vcy, ccx, ccy, a));
    let c = cornerOf(vcx, vcy, mine);
    let bed = groundAt(ccx, ccy, a);
    h = max(c.x, bed);
    fx = fx0 + f32(ox * span) * step;
    fy = fy0 + f32(oy * span) * step;

    let e = cornerExtras(vcx, vcy, mine);
    let cd = e.x; let wash = e.y; let foam = e.z; let speed = e.w;
    // ZOOMED OUT AND WHOLE, the gradient off the columns; otherwise off the
    // sheet, as the column-by-column mesh and the host builder have it.
    // @see nearbyFlat
    var gx = 0.0;
    var gy = 0.0;
    if (whole || cheap) {
      gx = nearbyFlat(vcx, vcy, -1, 0, a, c.x) - nearbyFlat(vcx, vcy, 1, 0, a, c.x);
      gy = nearbyFlat(vcx, vcy, 0, -1, a, c.x) - nearbyFlat(vcx, vcy, 0, 1, a, c.x);
    } else {
      gx = nearby(vcx, vcy, -1, 0, mine, c.x) - nearby(vcx, vcy, 1, 0, mine, c.x);
      gy = nearby(vcx, vcy, 0, -1, mine, c.x) - nearby(vcx, vcy, 0, 1, mine, c.x);
    }
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
    let mat = i32(textureLoad(uMaterial, vec2<i32>(ccx, slotRow(ccy, a)), 0).r * 255.0 + 0.5);
    rgb = textureLoad(uTint, vec2<i32>(i32(shade + 0.5), mat), 0).rgb;
  } else {
    // A SIDE of this column. Hung from the very corners the surface quad
    // used, so the two share vertices and there is no seam between them.
    // Skipped where it is filed FORWARD instead — see PARTS.
    if (d <= water.uBand.z) { return out; }
    if (!facesOn()) { return out; }
    let axis = part - 3;
    if (forward(cx, cy, axis, cpt, a)) { return out; }
    let p = sidePart(cx, cy, axis, corner, fx0, fy0, step, d, a);
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
uniform sampler2D uRoof;
uniform sampler2D uTint;
uniform sampler2D uMaterial;
uniform highp usampler2D uQuads;
// How hard each slot is leaving, once a frame. See brink-gpu.
uniform sampler2D uBrink;
// Which edges the solver says are falling. See the WGSL twin's latchAt.
uniform sampler2D uFalling;

// How many STOREYS a column has, and where a storey's plane of rows begins —
// see the WGSL twin, where the layout is argued.
int slots() { return int(uSlots.x); }
// Whether this mesh is the one under the paving — see the WGSL twin.
bool roofedTier() { return uSlots.y > 0.5; }
int slotRow(int y, int a) { return a * int(uGrid.y) + y; }
float depthAt(int x, int y, int a) { return texelFetch(uDepth, ivec2(x, slotRow(y, a)), 0).r; }
float groundAt(int x, int y, int a) { return texelFetch(uGround, ivec2(x, slotRow(y, a)), 0).r; }
float roofAt(int x, int y, int a) { return texelFetch(uRoof, ivec2(x, slotRow(y, a)), 0).r; }
// A corner's contributors as a bitmask — see the WGSL twin, where the two
// spellings are argued. @see render/sheet-group
// Is there water here — see the WGSL twin.
bool wet(float d) { return d > dryDepth(); }
int bitOf(int k) { return 1 << k; }
int bitAt(int m, int k) { return (m >> k) & 1; }
// Whether the brink texture was filled this frame. See brink-gpu.
bool brinkOn() { return uSlots.z > 0.5; }
float dryDepth() { return uBand.z; }
float fallMin() { return ${FALL_MIN}.0; }
float fallStop() { return ${FALL_STOP}.0; }
// Whether the solver's latch says this edge is already falling — see the WGSL
// twin, where the packing and the fallback are argued.
bool latchAt(int x, int y, int axis, int a, int b) {
  if (uSlots.w < 0.5) { return false; }
  int w = int(uGrid.x);
  int k = ((a * slots() + b) * w * int(uGrid.y) + y * w + x) * 2 + axis;
  return texelFetch(uFalling, ivec2(k - (k / ${LATCH_ROW}) * ${LATCH_ROW}, k / ${LATCH_ROW}), 0).r > 0.0;
}
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
bool  select(bool a, bool b, bool c)   { return c ? b : a; }
vec2  select(vec2 a, vec2 b, bool c)   { return c ? b : a; }
vec3  select(vec3 a, vec3 b, bool c)   { return c ? b : a; }
vec4  select(vec4 a, vec4 b, bool c)   { return c ? b : a; }

bool inside(int x, int y) {
  return x >= 0 && y >= 0 && x < int(uGrid.x) && y < int(uGrid.y);
}

${brinkRuleSource("glsl")}
// Read, not run, wherever the brink pass has been — see the WGSL twin.
float atBrink(int cx, int cy, int a) {
  if (brinkOn()) { return texelFetch(uBrink, ivec2(cx, slotRow(cy, a)), 0).r; }
  return brinkCalc(cx, cy, a);
}
${sheetGroupSource("glsl")}
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

vec4 cornerExtras(int vx, int vy, int mine) {
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
      if (bitAt(mine, k * slots() + a) == 0) { continue; }
      // A lip is not a shoreline — see corner-rule's atBrink, and water.ts's
      // shownDepth, which is this.
      d += max(dd, ${SHOW_DEPTH} * atBrink(cx, cy, a));
      wash += texelFetch(uWash, ivec2(cx, cy), 0).r;
      foam += texelFetch(uFoam, ivec2(cx, slotRow(cy, a)), 0).r;
      vel += flowAt(cx, cy, dd, a);
      n += 1.0;
    }
  }
  if (n == 0.0) { return vec4(0.0); }
  return vec4(d / n, wash / n, foam / n, length(vel / n));
}

// The same sheet one corner away, and otherwise only what is BELOW — see the
// WGSL twin, where the asymmetry is argued.
float nearby(int vx, int vy, int dx, int dy, int mine, float here) {
  // Asked through a column the two corners share, with the home component
  // passed in — see the WGSL twin.
  int m = sharedOf(mine, dx, dy);
  int jx = vx + dx;
  int jy = vy + dy;
  if (m >= 0) {
    int q = m / slots();
    vec4 c = cornerFor(jx, jy, vx - 1 + (q & 1), vy - 1 + (q >> 1), m % slots());
    if (c.w > 0.0) { return c.x; }
  }
  float below = here;
  // One flood per component, not one per contributor — see the WGSL twin.
  int seen = 0;
  for (int k = 0; k < 4; ++k) {
    int cx = jx - 1 + (k & 1);
    int cy = jy - 1 + (k >> 1);
    if (!inside(cx, cy)) { continue; }
    for (int a = 0; a < slots(); ++a) {
      int at = k * slots() + a;
      if (bitAt(seen, at) == 1) { continue; }
      if (depthAt(cx, cy, a) <= uBand.z) { continue; }
      int msk = cornerMask(jx, jy, at);
      seen = seen | msk;
      vec4 o = cornerOf(jx, jy, msk);
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

  float ownTop = min(bed + d, roofAt(cx, cy, a));
  float theirTop = wetJ ? min(bedJ + depthAt(jx, jy, a), roofAt(jx, jy, a)) : bedJ;
  vec4 cA = cornerFor(vax, vay, cx, cy, a);
  vec4 cB = cornerFor(cx + 1, cy + 1, cx, cy, a);
  vec4 oA = cornerFor(vax, vay, jx, jy, a);
  vec4 oB = cornerFor(cx + 1, cy + 1, jx, jy, a);
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
  // A QUAD IS A PART, A STOREY AND A COLUMN, and the STOREY is the innermost
  // of the three — which is the draw order as much as it is the packing.
  // Storey outside part, and all of storey nought's quads came before any of
  // storey one's: the road's own water was painted before the far-edge face
  // the SPAN beside it hangs into the same diamond, so the face landed on top
  // of water that is nearer the camera than it is. The builder, which files
  // that face into the band ahead before reaching any of that band's columns
  // whatever storey they are in, painted it under. @see PARTS
  int a = quad % L;
  int rest = quad / L;
  int part = rest % ${PARTS};
  int slot = rest / ${PARTS};
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
  // WHICHEVER COLUMN THIS QUAD HANGS OFF DECIDES ITS TIER, and for a face
  // filed FORWARD that is the column BEHIND, not the one whose diamond it
  // lands in. Asked about (cx, cy) here and "asked again" with the column
  // behind in the branch below, it was really asked about BOTH — and the
  // second question cannot undo the first.
  //
  // At a DECK-TO-ROAD SEAM that loses the face. An upper slot over a column
  // with no deck on it is ABSENT — floor and roof equal, which reads as
  // roofed — so the open tier of the band in front rejected the span's own
  // far-edge face before the branch that owns it ever ran. The builder drew
  // it and the device did not, and that is 22 of the 28 pixels the water
  // comparison has been carrying. @see syncSlots, forward
  bool back = part <= 1;
  int ocx = cx - (back ? (part == 0 ? 1 : 0) : 0);
  int ocy = cy - (back ? (part == 0 ? 0 : 1) : 0);
  if (!inside(ocx, ocy)) { return; }
  if ((roofAt(ocx, ocy, a) < ${OPEN_SKY}) != roofedTier()) { return; }
  float step = uGrid.w;
  float fx0 = float(tx) - 0.5 + float(sx) * step;
  float fy0 = float(ty) - 0.5 + float(sy) * step;

  float fx = 0.0;
  float fy = 0.0;
  float h = 0.0;
  vec3 rgb = vec3(0.0);
  float alpha = 0.0;

  if (back) {
    // The far-edge face of the column BEHIND, drawn FIRST — see the WGSL twin.
    if (!facesOn()) { return; }
    float bd = depthAt(ocx, ocy, a);
    if (bd <= uBand.z) { return; }
    if (!forward(ocx, ocy, part, cpt, a)) { return; }
    Part p = sidePart(ocx, ocy, part, corner,
      fx0 - (part == 0 ? step : 0.0), fy0 - (part == 0 ? 0.0 : step), step, bd, a);
    if (!p.ok) { return; }
    fx = p.fx; fy = p.fy; h = p.h; rgb = p.colour; alpha = p.alpha;
  } else if (part == 2) {
    if (d <= uBand.z) { return; }
    int ox = ((corner + 1) >> 1) & 1;
    int oy = corner >> 1;
    // This column's component at this corner, worked out ONCE — see the
    // WGSL twin.
    int vcx = cx + ox;
    int vcy = cy + oy;
    int mine = cornerMask(vcx, vcy, contribOf(vcx, vcy, cx, cy, a));
    vec4 c = cornerOf(vcx, vcy, mine);
    float bed = groundAt(cx, cy, a);
    h = max(c.x, bed);
    fx = fx0 + float(ox) * step;
    fy = fy0 + float(oy) * step;

    vec4 e = cornerExtras(vcx, vcy, mine);
    float cd = e.x; float wash = e.y; float foam = e.z; float speed = e.w;
    float gx = nearby(vcx, vcy, -1, 0, mine, c.x) - nearby(vcx, vcy, 1, 0, mine, c.x);
    float gy = nearby(vcx, vcy, 0, -1, mine, c.x) - nearby(vcx, vcy, 0, 1, mine, c.x);
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
  } else {
    if (d <= uBand.z) { return; }
    if (!facesOn()) { return; }
    int axis = part - 3;
    if (forward(cx, cy, axis, cpt, a)) { return; }
    Part p = sidePart(cx, cy, axis, corner, fx0, fy0, step, d, a);
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
  /** Frames each band's roofed tier has gathered nothing. @see holdShown */
  underIdle: Uint16Array;
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
  /**
   * Whether the fall latch the shaders read is the solver's own this frame,
   * as last written into their uniforms; -1 before the first frame. @see
   * latchAt, FALLING_AT
   */
  latchOn: number;
  wash: FlowWash;
  foam: FoamField;
  /** How many storeys the field has. @see ColumnField.layers */
  layers: number;
  /**
   * Which of `sources` the DEVICE is filling, as indices.
   *
   * Empty until `deviceSinks` says otherwise, so a layer with no solver on it
   * uploads everything — which is what the host path wants. What must never
   * happen is skipping an upload for a texture the device turned down.
   * @see deviceSinks, FED
   */
  fed: Set<number>;
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
const FLOAT_FIELDS = ["uDepth", "uGround", "uWash", "uFoam", "uFx", "uFy", "uRoof", "uBrink"];
const BYTE_FIELDS = ["uTint", "uMaterial", "uFalling"];
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
  // `wash` stays ONE PLANE: it is the resting pattern of the world, what a
  // tile's surface looks like when nothing is happening to it, and a bridge
  // does not give a tile two of those. `foam` is a plane per storey, because
  // foam is CARRIED and BORN — by this slot's current, where this slot breaks
  // — and on a span the deck and the channel are two different waters running
  // two different ways. @see stepFoam
  const { layers } = columns;
  const depth = viewOf(columns.depth, nx, ny * layers);
  const ground = viewOf(columns.ground, nx, ny * layers);
  const roof = viewOf(columns.roof, nx, ny * layers);
  const fx = viewOf(columns.fx, nx, ny * layers * layers);
  const fy = viewOf(columns.fy, nx, ny * layers * layers);
  const wash = createFlowWash(columns);
  const foam = createFoam(columns);
  const washTex = viewOf(wash.now, nx, ny);
  const foamTex = viewOf(foam.now, nx, ny * layers);
  const material = new BufferImageSource({
    resource: columns.material, width: nx, height: ny * layers, format: "r8unorm",
    scaleMode: "nearest",
  });
  // HOW HARD EACH SLOT IS LEAVING. Filled by the device once a frame and by
  // nothing else — the host has no use for it and never uploads it, so the
  // array behind it stays the zeros it was made with. @see brink-gpu
  const brinkF32 = new Float32Array(nx * ny * layers);
  const brinkTex = viewOf(brinkF32, nx, ny * layers);
  // WHICH EDGES ARE FALLING, a byte per edge of a slot pair, the solver's own
  // latch and its own packing, LATCH_ROW wide. @see latchAt, LATCH_ROW
  const fallingTex = new BufferImageSource({
    resource: columns.falls.falling, width: LATCH_ROW,
    height: columns.falls.falling.length / LATCH_ROW, format: "r8unorm",
    scaleMode: "nearest",
  });
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
        uFx: fx, uFy: fy, uRoof: roof, uBrink: brinkTex,
        uTint: tint, uMaterial: material, uFalling: fallingTex, uQuads: quads,
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
      // ITS OWN SLICE, in the roofed tier's copy of the list. @see QuadList.second
      uList: { value: new Float32Array([list.second + list.offsets[b], LIST_W, 0, 0]), type: "vec4<f32>" },
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
        uFx: fx, uFy: fy, uRoof: roof, uBrink: brinkTex,
        uTint: tint, uMaterial: material, uFalling: fallingTex, uQuads: quads,
      },
    });
    const underMesh = new Mesh<Geometry, Shader>({ geometry: underGeom, shader: underShader });
    underMesh.eventMode = "none";
    bands.underOf[b].addChild(underMesh);
    under.push(underMesh);
  }

  return {
    meshes,
    underIdle: new Uint16Array(meshes.length),
    under,
    faces: 1,
    sources: [depth, ground, washTex, foamTex, fx, fy, material, roof, brinkTex, fallingTex],
    // THE SHADE RAMP, kept on the layer because the falls colour from it too:
    // a sheet and the surface it leaves are the same water, so they read the
    // same table. @see createSheet
    tint,
    quads,
    wash, foam, layers, gather: null, fed: new Set(),
    groundSent: -1,
    latchOn: -1,
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
const FED: readonly (readonly [number, FieldName, 1 | 4, number?])[] = [
  [0, "depth", 4], [2, "washNow", 4], [3, "foamNow", 4],
  [4, "fx", 4], [5, "fy", 4], [6, "matByte", 1],
  // The fall latch as bytes, LATCH_ROW wide rather than the map's width — so
  // every map can take the copy, where at nx a byte texture needs 64 tiles.
  [9, "fallByte", 1, LATCH_ROW],
];
/** Where the ground sits in `sources`. The one the device never writes. */
const GROUND_AT = 1;
/** And the roofs, which are geometry and move only when the map does. */
const ROOF_AT = 7;
/**
 * And the brink, which the DEVICE fills and the host never does.
 *
 * Not in {@link FED} because that table is about what `copyOut` moves off the
 * solver's own field buffer, and this comes out of a pass of its own. It is
 * skipped by the upload loop unconditionally: the array behind it is zeros,
 * and sending those up would overwrite the only copy that means anything.
 * @see createBrinkPass
 */
const BRINK_AT = 8;
/**
 * And the solver's fall latch. In {@link FED}: the device copies it out. On the
 * host-solver path it is uploaded like the rest. With the device solving on a
 * map that cannot take the copy, the host's copy is not the device's latch and
 * is not sent at all — the shaders are told it is not fresh and fall back to
 * FALL_MIN. @see latchAt
 */
const FALLING_AT = 9;

/** Just enough of the renderer to ask what stands behind a texture source. */
type GpuTextureSystem = {
  texture: { getGpuSource: (s: TextureSource) => GPUTexture };
};

/**
 * The textures for the solver to fill, or nothing at all.
 *
 * Nothing at all on the WebGL path, where there is no `getGpuSource` to ask,
 * and then the layer keeps uploading from the host exactly as it always has.
 *
 * The solver READS THIS BACK: were the material left out here it would have to
 * keep coming down every frame, because the host's copy would then be what
 * fills the texture.
 */
export function deviceSinks(wl: GpuWaterLayer, renderer: unknown): Sink[] {
  const sys = renderer as Partial<GpuTextureSystem>;
  if (typeof sys?.texture?.getGpuSource !== "function") return [];
  const get = sys.texture.getGpuSource.bind(sys.texture);
  // EVERY TEXTURE, ON EVERY MAP. A field whose rows are not a multiple of 256
  // bytes — a float one under 64 columns' multiple, the material's under 256
  // — is padded on the device into rows that are, and copied from there; it
  // used to be left to the host to upload, which kept the host's copy of the
  // material coming back whole every frame on most map sizes, and the depth
  // too. @see createPadOut
  const fed = FED;
  // AND REMEMBER WHICH, because the layer has to stop uploading exactly the
  // textures the device is really filling and no others. Told the static list
  // instead, a texture this refused was skipped by the host AND never written
  // by the device: nobody wrote it, and it kept whatever it held when the
  // layer was built. That is water from the moment the map loaded, standing
  // still underneath the water that is actually there — which is what "old
  // water persists and the two surfaces flicker" was.
  //
  // It only began to bite on maps with DECKS on them, and not because decks
  // are special: `carried` is only true while the device owns the water, and
  // a decked map only started running on the device recently.
  wl.fed = new Set(fed.map(([k]) => k));
  return fed.map(([k, name, texel, width]) => ({
    name, texture: get(wl.sources[k]), texel, width,
  }));
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
  /** The layer it gathers for, whose latch flag it shares. @see latchAt */
  layer: GpuWaterLayer;
  /** Where the ids land, in the shader's own texture. */
  into: GPUTexture;
  /**
   * The last counts to come back, padded and clamped when they are used: one
   * per band for the open tier, then one per band for the roofed tier where
   * the map has one. @see QuadList.second
   */
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
  /**
   * The brink pass and where its answer goes. On every map since its rows
   * were padded; null would mean the shaders run the scan inline, which is
   * what they did before this existed. @see createBrinkPass, brinkRow
   */
  brink: { pass: BrinkPass; into: GPUTexture; slots: number } | null;
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
  // A COUNT PER BAND PER TIER: the open ones, then the roofed. @see QuadList.second
  const tiers = list.second ? 2 : 1;
  // THE ROW RULE IS NOW SATISFIED BY CONSTRUCTION. A buffer-to-texture row has
  // to be a multiple of 256 bytes, and it used to be a band's STRIDE — so a map
  // whose shorter side was not a multiple of four lost its gathering outright
  // and every band drew its whole complement for ever, correctly and slowly,
  // which is exactly why nobody noticed. The row is `LIST_W` now and nothing
  // about the map's shape can change it.
  const pass = createQuadsPass(device, list, LIST_W * list.rows, DRAWDOWN, w * h * wl.layers);
  const depthView = get(wl.sources[0]).createView();
  const groundView = get(wl.sources[1]).createView();
  const roofView = get(wl.sources[ROOF_AT]).createView();
  const brinkView = get(wl.sources[BRINK_AT]).createView();
  const fallingView = get(wl.sources[FALLING_AT]).createView();
  pass.bind(depthView, groundView, roofView, brinkView, fallingView);
  // AND THE BRINK, which both this pass and the vertex shader read. On every
  // map now: the pass writes its rows padded to whole 256 bytes, which is
  // what the copy into the texture asks. @see brinkRow
  const plane = wl.sources[0] as unknown as { width: number; height: number };
  const bnx = plane.width, bny = plane.height / wl.layers;
  let brink: QuadGather["brink"] = null;
  {
    const bp = createBrinkPass(device, brinkRow(bnx) * bny * wl.layers);
    bp.bind(depthView, groundView, roofView);
    brink = { pass: bp, into: get(wl.sources[BRINK_AT]), slots: bnx * bny * wl.layers };
    // The shaders only read it once there is something in it to read.
    for (const m of [...wl.meshes, ...wl.under]) {
      const u = m.shader?.resources.water as UniformGroup | undefined;
      if (!u) continue;
      (u.uniforms.uSlots as Float32Array)[2] = 1;
      u.update();
    }
  }
  return {
    pass,
    layer: wl,
    into: get(wl.quads),
    count: new Uint32Array(bands * tiers),
    grew: new Int32Array(bands * tiers),
    was: new Uint32Array(bands * tiers),
    staging: device.createBuffer({
      size: Math.max(16, bands * tiers * 4),
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
      label: "quad counts back",
    }),
    busy: false,
    gathered: false,
    watch: 4,
    brink,
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
  w: number, h: number, faces: boolean, zoomedOut = false,
  cull: { from: number; to: number; lo?: number; hi?: number } | null = null,
  cheap = false,
) {
  g.pass.say(
    columns.nx, columns.ny, COLUMNS_PER_TILE, h,
    columns.params.dryDepth, FALL_MIN, faces, columns.layers,
    g.brink !== null, g.layer.latchOn === 1, zoomedOut, cull, cheap,
  );
  const enc = device.createCommandEncoder({ label: "quads" });
  // THE BRINK FIRST, because the gathering reads it and so does the draw that
  // follows. One thread per slot, then straight into the texture — both in
  // this encoder, so the barriers between them are the API's problem and not
  // ours. @see createBrinkPass
  if (g.brink) {
    g.brink.pass.say(
      columns.nx, columns.ny, columns.layers, columns.params.dryDepth, FALL_MIN,
    );
    g.brink.pass.encode(enc, g.brink.slots);
    enc.copyBufferToTexture(
      {
        buffer: g.brink.pass.out, bytesPerRow: brinkRow(columns.nx) * 4,
        rowsPerImage: columns.ny * columns.layers,
      },
      { texture: g.brink.into },
      { width: columns.nx, height: columns.ny * columns.layers, depthOrArrayLayers: 1 },
    );
  }
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
      g.grew[b] = nextGrew(g.grew[b], got[b] - g.was[b]);
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
 * How fast the remembered growth comes back down: an EIGHTH of it a frame,
 * and never less than this many quads.
 *
 * It was one quad a frame, flat, on the reasoning that a pour widens a band by
 * about as many quads as it is wide — tens — and so is padded for half a
 * second. A flood is not tens. Pour over a 128 tile map and a band grows by a
 * thousand and more, and at a quad a frame it stayed padded by that for
 * twenty-five seconds: 182,000 instances of padding over 252,000 real quads,
 * every one of them a vertex shader that runs to its empty-slot test, and 8%
 * of the render for as long as it lasted. Taking an eighth, a frame still
 * keeps seven eighths of what it grew by — which is what the padding is for,
 * a readback a frame or two behind a band that is still growing — and a flood
 * of 1,500 is back to the floor in 44 frames, under a second. @see nextGrew
 */
const LEAK = 1;
const LEAK_SHARE = 8;

/**
 * A band's remembered growth, given what it had and what it just grew by.
 * The larger of the new growth and the old one leaked down. @see LEAK
 */
export const nextGrew = (grew: number, by: number): number => {
  const fell = grew - Math.max(LEAK, Math.ceil(grew / LEAK_SHARE));
  return Math.max(by, fell > 0 ? fell : 0);
};

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
  // AND WHETHER THE FALL LATCH IS FRESH, into the spare slot of uSlots, on
  // the same terms. Fresh when the host is solving, because the host's latch
  // is the solver's and goes up with the rest; fresh when the device is
  // solving and copying it out; not otherwise, and then the grouping asks
  // FALL_MIN alone rather than read a latch nobody is keeping. @see latchAt
  const latch = !carried || wl.fed.has(FALLING_AT) ? 1 : 0;
  if (wl.latchOn !== latch) {
    wl.latchOn = latch;
    for (const m of [...wl.meshes, ...wl.under]) {
      const grp = m.shader?.resources.water as UniformGroup | undefined;
      if (!grp) continue;
      (grp.uniforms.uSlots as Float32Array)[3] = latch;
      grp.update();
    }
  }
  const region = activeBox(columns);
  const tA = performance.now();
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
    // NEVER THE BRINK. @see BRINK_AT
    if (k === BRINK_AT) continue;
    if (carried && wl.fed.has(k)) continue;
    // NOR A LATCH THE DEVICE IS NOT COPYING OUT: the host's copy is not the
    // solver's then, and the shaders have been told not to read it.
    if (carried && k === FALLING_AT) continue;
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
    // EACH TIER ITS OWN COUNT, off its own list. Both tiers used to be handed
    // the same count and the same list, and each threw away what was not its
    // own — every quad's vertex shader run twice. @see QuadList.second
    const n = g && g.gathered
      ? roomFor(g.count[b], g.grew[b], wl.most[b])
      : wl.most[b];
    wl.meshes[b].geometry.instanceCount = Math.min(n, instanceCap);
    // Only on a change: visibility is structural, and flipping it every frame
    // makes the renderer rebuild the scene's instruction list every frame.
    if (wl.meshes[b].visible !== show) wl.meshes[b].visible = show;
    const u = wl.under[b];
    if (u) {
      const B = wl.meshes.length;
      u.geometry.instanceCount = Math.min(instanceCap, g && g.gathered
        ? roomFor(g.count[B + b], g.grew[B + b], wl.most[b])
        : wl.most[b]);
      // THE ROOFED TIER ONLY WHERE THERE IS ROOFED WATER. Every band has one
      // on a map with a deck anywhere, and all but the few the bridge crosses
      // gather nothing — but the spare in roomFor meant each still drew, and
      // a draw has a fixed cost: on a flooded 204 tile map 814 of them were
      // 5.3 ms of the surface's 26 before a quad was drawn. Held rather than
      // flipped, so water coming and going under a span does not rebuild the
      // scene's instructions; a band that starts to hold some shows when the
      // count comes back, a frame or two after. Ungathered, the identity has
      // no count to ask, and the band draws as it always did. @see holdShown
      if (!show) {
        if (u.visible) u.visible = false;
      } else if (g && g.gathered) {
        holdShown(u, g.count[B + b] > 0 || g.grew[B + b] > 0, wl.underIdle, b);
      } else if (!u.visible) {
        u.visible = true;
      }
    }
  }
  wl.cpuMs = performance.now() - t0;
}

/** For measuring: how many quads the GPU is asked to consider, wet or dry. */
export const gpuQuadsConsidered = (wl: GpuWaterLayer) =>
  wl.meshes.reduce((n, m) => n + (m.geometry.indexBuffer.data?.length ?? 0) / 6, 0);
