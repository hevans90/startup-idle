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
import { oncePerRender } from "./frame-uniforms";
import { holdShown } from "./hold";
import { fieldWater } from "./water-mode";
import { groundMode } from "./ground-mode";
import { PIECE, PIECE_STEP } from "./water-piece";
import { MIN_TEXTURE_DIMENSION, heldGpu } from "./device";
import {
  Buffer, BufferImageSource, BufferUsage, Geometry, GlProgram, GpuProgram, Mesh,
  Shader, TextureSource, UniformGroup,
} from "pixi.js";

import {
  activeBox, MATERIAL_SLOTS, MAX_FLOW_SPEED, type ColumnField,
} from "../../fluid/columns";
import { RIM, atBrink as brinkOnHost, brinkRuleSource, cornerRuleSource } from "./corner-rule";
import { OPEN_SKY } from "../../fluid/slots";
import { stampsNow } from "../debug/gpu-stamps";
import { quadRuleSource } from "./quad-rule";
import { sheetGroupSource } from "./sheet-group";
import { BAND_MARGIN, createQuadsPass, type QuadsPass } from "./quads-gpu";
import { brinkRow, createBrinkPass, type BrinkPass } from "./brink-gpu";
import { FALL_MIN, FALL_STOP, LATCH_ROW } from "../../fluid/falls";
import { fluidMaterial } from "../water/materials";
import { COLUMNS_PER_TILE, STOREYS } from "../water/field";
import { pollutionOf, type Pollution } from "../water/pollution";
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
/**
 * HOW THE WATER IS LIT this frame — its clock and the night — ONE group for every band and for the falls, so a frame
 * is one upload and a fall runs on the same clock as the pool it leaves. @see waterLook, falls-gpu
 */
export const waterLookGroup = oncePerRender(new UniformGroup({ uLook: { value: new Float32Array([0, 0, 0, 0]), type: "vec4<f32>" } }));

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
/** FOULED WATER: the brown it is mixed toward, and how far at the worst. @see fouled */
const MUD_RGB = [0.6, 0.42, 0.2] as const;
const MUD = `vec3<f32>(${MUD_RGB.join(", ")})`;
const MUD_GL = MUD_RGB.join(", ");
const FOUL_MOST = 0.85;
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

/** How many corners the spare table has room for — four entries each. @see cornerTableSource */
export const SPARE_CORNERS = 16384;
/**
 * How many quads the deck table — and the rare table, which shares its slots — has room for: every quad but the
 * smooth field's surface, which is a few hundred on a busy fixture. @see deckCorner, rareTable
 */
export const DECK_SLOTS = 16384;
/** Where the rare table starts in the deck table's buffer: after the deck corners, two texels each. @see rareTable */
const RARE_AT = DECK_SLOTS * 8;
/** Workgroups striding over the rare table. @see rareTable */
const RARE_WG = 64;
/**
 * Workgroups for the spare table's work and for the deck table's, striding over however much there is: enough that
 * a busy frame's (some 800 spare corners, 150 deck quads) is done in one stride. @see cornerRest
 */
const SPARE_WG = 512;
const DECK_WG = 128;

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

/** How deep water on sloped ground still lies on it as it is drawn, half steps; by three times that it is level. */
const THIN_ON_SLOPE = 0.5;
/** How thick the film the surface lays down a face water is pouring down, in height units. @see pouredAt */
export const POUR_FILM = "0.35";
/** How far above one a corner's cover goes where it is wholly pouring. @see fieldCorner, mainFragment */
const POUR_FLAG = "0.45";
/** How steep a corner has to be, in height units a column, before it asks whether water pours down it. */
const POUR_FACE = "2.0";
/**
 * WATER POURING, as the surface draws it down a rock face and a deck's sheet draws it off the edge — one recipe, so
 * the two are the same water: streaks long down the fall line and narrow across, falling on the water's clock, lit
 * along them and foaming in them; off-white, and never a white panel. Over a colour already finished (premultiplied)
 * by waterLook; `across` is x − y in tiles, `z` the height in height units, `fall` how much of it is pouring,
 * `close` how near opaque it is (a film down rock nearly; a sheet in the air by how thick it is).
 */
export const POUR_WGSL = /* wgsl */ `
fn pourNoise(p: vec2<f32>) -> f32 {
  let i = floor(p); let q = fract(p); let u = q * q * (3.0 - 2.0 * q);
  return mix(mix(lookHash(i), lookHash(i + vec2<f32>(1.0, 0.0)), u.x),
    mix(lookHash(i + vec2<f32>(0.0, 1.0)), lookHash(i + vec2<f32>(1.0, 1.0)), u.x), u.y);
}
fn pourOver(c: vec4<f32>, across: f32, z: f32, fall: f32, u: vec4<f32>, close: f32) -> vec4<f32> {
  let ac = across * 5.0;
  let down = z * 0.35 + u.x * 2.2;
  // (Two layers, offset and at their own rates, so no grid shows.)
  let s2 = pourNoise(vec2<f32>(ac, down)) * 0.6 + pourNoise(vec2<f32>(ac * 1.9 + 7.3, down * 1.6 + 2.1)) * 0.4;
  let froth = vec3<f32>(0.78, 0.86, 0.9) * (1.0 - 0.45 * u.y);
  let foam = smoothstep(0.45, 0.9, s2) * 0.55 * fall;
  let lift = (s2 - 0.5) * 0.18 * fall;
  let a = max(c.a, close * fall);
  // (Premultiplied: closing it up brings its colour up with it.)
  let body = c.rgb * (a / max(c.a, 0.001)) * (1.0 + lift);
  return vec4<f32>(mix(body, froth * a, foam), a);
}
`;

const WGSL = /* wgsl */ `
// THE SLIM DRAW, where the gathering has sent every quad but the smooth field's surface to the rare table: the
// vertex shader is then only the surface from the corner table and the rare quads as the rare pass left them, and
// everything else is compiled out of it — a shader that big ran every vertex slower, whatever path it took.
// @see rareTable, slimProgram
const SLIM = false;
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
  uTable: vec4<f32>,      // the corner table filled, its row width @see cornerTableSource
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
// HOW FOULED EACH TILE'S WATER IS, a byte a tile. After the falling latch, as
// it is in the resources. @see world/water/pollution
@group(2) @binding(12) var uPollution : texture_2d<f32>;
@group(2) @binding(13) var uQuads : texture_2d<u32>;
// THE GROUND AS IT IS DRAWN, two texels a tile: its corners; then its middle and whether it is a SHELF — a tile
// of standing water at a shore, where the drawn ground comes up through the surface and the water is cut to it.
// @see render/drawn.ts, ground-mesh.ts surfaceOf
@group(2) @binding(14) var uShore : texture_2d<f32>;
// EACH CORNER OF THE SMOOTH FIELD, WORKED OUT ONCE where it can be: by a pass of its own, a texel a corner, for
// the quads that meet there to read rather than each work out again. After the look, as it is in the resources.
// @see cornerTableSource
@group(2) @binding(16) var<storage, read> uCorner : array<vec4<u32>>;
// AND WHERE A CORNER IS NOT THE SAME FOR ALL FOUR COLUMNS, each one's, four texels a corner. @see cornerTableSource
@group(2) @binding(17) var<storage, read> uCornerX : array<vec4<u32>>;
// AND THE DECK TABLE: each deck quad's corners, two entries a corner, four corners a slot; and which quad each slot
// is. @see deckCorner
@group(2) @binding(18) var<storage, read> uDeck : array<vec4<u32>>;
@group(2) @binding(19) var<storage, read> uDeckAt : array<u32>;
// (Read through these, which the corner pass's source points at the tables it writes. @see cornerTableSource)
fn tableAt(i: u32) -> vec4<u32> { return uCorner[i]; }
fn spareTableAt(i: u32) -> vec4<u32> { return uCornerX[i]; }
fn deckEntry(i: u32) -> vec4<u32> { return uDeck[i]; }
// THE BAND AND TIER BEING DRAWN: the mesh's own in the draw, the quad's own in the rare pass. @see rareTable
var<private> bandAt: vec4<f32> = vec4<f32>(0.0);
var<private> roofedAt: bool = false;

struct VSOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) vColor: vec4<f32>,
  // Where on the ground (tiles, a tile covering x…x+1), the level of the water there, and in w two things at once:
  // AS ONE SMOOTH FIELD, how much of what is round this corner is water, 0 to 1 — the surface is cut along a line of
  // it and not along the columns' sides (@see fieldCorner) — and on the mesh joined by rule 1, or 2 where it is to be
  // cut to the shore. ONE SLOT FOR BOTH because every float a vertex hands on is written out and read back for
  // every vertex of every band: a fourth vec4 here cost a third of a millisecond on a lake before it did anything.
  @location(1) vShore: vec4<f32>,
  // A SURFACE, shaded per pixel as water: its depth (x; below nought on anything that is not a surface) and its foam
  // (y). vColor is then the fluid's own colour and how lit the corner is, not a finished colour. @see waterLook
  @location(2) vLook: vec2<f32>,
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
fn roofedTier() -> bool { return roofedAt; }
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

/** SLOP IN THE WATER: browned by how fouled its tile is, keeping its light; the open storey only. */
fn fouled(rgb: vec3<f32>, cx: i32, cy: i32, a: i32) -> vec3<f32> {
  if (a != 0) { return rgb; }
  let k = textureLoad(uPollution, vec2<i32>(cx / ${COLUMNS_PER_TILE}, cy / ${COLUMNS_PER_TILE}), 0).r;
  let lum = dot(rgb, vec3<f32>(0.3, 0.59, 0.11));
  return mix(rgb, ${MUD} * (0.7 + lum * 0.8), k * ${FOUL_MOST});
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
  p.colour = fouled(aerated(mat, 0.08 + pace(cx, cy, d, a) * 0.14), cx, cy, a);
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

// ─── THE WATER AS ONE SMOOTH FIELD ───────────────────────────────────────────
// @see render/water-mode.ts. The solver's floor is the ground as it is drawn, a column at a time; and every corner
// of the surface is worked out from WHERE IT IS — the columns round it — and from nothing about which column asks:
// so every quad that has the corner puts it in one place, and the mesh cannot tear.
fn fieldOn() -> bool { return water.uList.z > 0.5; }
fn skirtOn() -> bool { return water.uList.z > 0.5; }
// Whether two columns are of ONE PIECE of ground: their floors within a bank of each other. Across a cliff or a
// wall they are not, and neither's water has anything to do with the other's.
fn onePiece(g: f32, gq: f32) -> bool { return abs(g - gq) < ${PIECE}; }
// Whether two columns are of ONE PIECE of ground AT A CORNER (vx, vy) of the grid of columns: the same tile; or
// tiles whose drawn ground THERE is within a small step of each other. Asked of the place, not of the whole edge
// between them: a scarp that dies out along its length parts the water where it is a drop and not where it is a
// ripple in the ground — and every column at the corner gets the same answer. @see groundFan
fn tileGround(tx: i32, ty: i32, vx: i32, vy: i32) -> f32 {
  let cpt = i32(water.uGrid.z);
  return groundFan(tx, ty, clamp(f32(vx - tx * cpt) / f32(cpt), 0.0, 1.0), clamp(f32(vy - ty * cpt) / f32(cpt), 0.0, 1.0));
}
// (Set by the corner table's pass where it has found every column round a corner one piece with every other: then
// it needs no asking. Never in the vertex shader. @see cornerTableSource)
var<private> allOnePiece: bool = false;
fn pieceOf(cx: i32, cy: i32, qx: i32, qy: i32, vx: i32, vy: i32) -> bool {
  if (allOnePiece) { return true; }
  let cpt = i32(water.uGrid.z);
  let ax = cx / cpt; let ay = cy / cpt; let bx = qx / cpt; let by = qy / cpt;
  if (ax == bx && ay == by) { return true; }
  // ON GROUND DRAWN AS ONE CONTINUOUS SURFACE THERE IS NO STEP IN BARE GROUND AT ALL, however steep: bare tiles
  // are one piece, always. Only what is BUILT can stand apart from what is beside it — a quay, a wall between two
  // roads — and that by the step between their floors.
  var ga = 0.0;
  var gb = 0.0;
  if (water.uList.w > 0.5) {
    let builtA = (i32(textureLoad(uShore, vec2<i32>(ax * 2 + 1, ay), 0).w + 0.5) & 16) != 0;
    let builtB = (i32(textureLoad(uShore, vec2<i32>(bx * 2 + 1, by), 0).w + 0.5) & 16) != 0;
    if (!builtA && !builtB) { return true; }
    ga = groundAt(cx, cy, 0);
    gb = groundAt(qx, qy, 0);
  } else {
    ga = tileGround(ax, ay, vx, vy);
    gb = tileGround(bx, by, vx, vy);
  }
  if (abs(ga - gb) < ${PIECE_STEP}) { return true; }
  // OR A STEP THE WATER STANDS OVER. A drop parts the water only where the water on the low side is under the
  // ground on the high side — a lip it falls from, a wall that holds it. Where both stand over both grounds the
  // step is drowned, and the water above it is one level sheet whatever the bed does.
  let da = depthAt(cx, cy, 0);
  let db = depthAt(qx, qy, 0);
  let sa = groundAt(cx, cy, 0) + select(0.0, da, wet(da));
  let sb = groundAt(qx, qy, 0) + select(0.0, db, wet(db));
  return min(sa, sb) > max(ga, gb) + 0.1;
}
// WHICH OF THE FOUR COLUMNS AT A CORNER (vx, vy) ARE ON ONE PIECE WITH COLUMN (cx, cy), as a mask (bit k for the
// column at vx - 1 + k % 2, vy - 1 + k / 2): of a piece with it, OR WITH ONE THAT IS. Pieces are not transitive —
// a road's water stands over the bank beside it, and the bank runs on into the river, while the road's water is
// nothing to the river's — and asked only of itself each column put the corner at a height of its own: the mesh
// tore there, in holes and spikes. Joined through one another, every column of the piece puts it at one height.
fn cornerPiece(vx: i32, vy: i32, cx: i32, cy: i32) -> i32 {
  var m = 0;
  var adj = 0;
  for (var k = 0; k < 4; k++) {
    let qx = vx - 1 + (k % 2);
    let qy = vy - 1 + (k / 2);
    if (!inside(qx, qy)) { continue; }
    if (qx == cx && qy == cy) { m = m | (1 << u32(k)); }
    // (The pairs: k with each column after it — six in all.)
    for (var j = k + 1; j < 4; j++) {
      let rx = vx - 1 + (j % 2);
      let ry = vy - 1 + (j / 2);
      if (inside(rx, ry) && pieceOf(qx, qy, rx, ry, vx, vy)) { adj = adj | (1 << u32(k * 4 + j)); }
    }
  }
  // (Not a column of this corner — a neighbour's, for a slope: what it is of a piece with, directly.)
  if (m == 0) {
    for (var k = 0; k < 4; k++) {
      let qx = vx - 1 + (k % 2);
      let qy = vy - 1 + (k / 2);
      if (inside(qx, qy) && pieceOf(cx, cy, qx, qy, vx, vy)) { m = m | (1 << u32(k)); }
    }
  }
  for (var r = 0; r < 3; r++) {
    for (var k = 0; k < 4; k++) {
      for (var j = k + 1; j < 4; j++) {
        if (((adj >> u32(k * 4 + j)) & 1) == 0) { continue; }
        if (((m >> u32(k)) & 1) != 0) { m = m | (1 << u32(j)); }
        if (((m >> u32(j)) & 1) != 0) { m = m | (1 << u32(k)); }
      }
    }
  }
  return m;
}
// The water at a corner, as the piece column (cx, cy) is on has it — its surface, and its depth: the mean over the
// columns of that piece that meet there. For the slope its light is taken from.
fn fieldHeight(vx: i32, vy: i32, cx: i32, cy: i32, a: i32) -> vec2<f32> {
  var n = 0.0; var s = 0.0; var dd = 0.0;
  for (var k = 0; k < 4; k++) {
    let qx = vx - 1 + (k % 2);
    let qy = vy - 1 + (k / 2);
    if (!inside(qx, qy) || !pieceOf(cx, cy, qx, qy, vx, vy)) { continue; }
    let dq = depthAt(qx, qy, a);
    n += 1.0; s += groundAt(qx, qy, a) + select(0.0, dq, wet(dq)); dd += select(0.0, dq, wet(dq));
  }
  return vec2<f32>(s, dd) / max(n, 1.0);
}
struct FieldCorner { g: f32, d: f32, foam: f32, wash: f32, speed: f32, cover: f32, brink: f32, hx: i32, hy: i32 };
// A corner of the grid of columns, as the piece of ground column (cx, cy) is on has it: the ground there and the
// water's depth there — the mean over the columns of that piece that meet at it, a dry one counting as none — and
// what the water carries; and which wet column to colour it by.
fn fieldCorner(vx: i32, vy: i32, cx: i32, cy: i32, a: i32) -> FieldCorner {
  var o: FieldCorner;
  var n = 0.0; var wets = 0.0; var g = 0.0; var d = 0.0;
  var vel = vec2<f32>(0.0, 0.0);
  o.hx = cx; o.hy = cy;
  // (The four grounds kept, for how steep the corner is below. Off the map or under a roof, no face there.)
  var gq = array<f32, 4>(0.0, 0.0, 0.0, 0.0);
  var edge = false;
  var spanned = false;
  let piece = cornerPiece(vx, vy, cx, cy);
  for (var k = 0; k < 4; k++) {
    let qx = vx - 1 + (k % 2);
    let qy = vy - 1 + (k / 2);
    if (!inside(qx, qy)) { edge = true; continue; }
    let gk = groundAt(qx, qy, a);
    gq[k] = gk;
    // (UNDER A DECK the ground there is the channel's bed, roofed by the span: no face the water lies on. At a
    // bridge's mouth the road's water runs on level onto the deck, and read as a cliff it was cut away.)
    if (roofAt(qx, qy, a) < ${OPEN_SKY}) { edge = true; spanned = true; }
    if (((piece >> u32(k)) & 1) == 0) { continue; }
    n += 1.0; g += gk;
    let dq = depthAt(qx, qy, a);
    if (!wet(dq)) { continue; }
    if (wets == 0.0) { o.hx = qx; o.hy = qy; }
    // (Drawn down toward a lip exactly as the sheet that falls from it is — @see falls-render's sharedBrink — so
    // the surface comes to the brink where that sheet begins, and the two are one.)
    let brink = atBrink(qx, qy, a);
    o.brink = max(o.brink, brink);
    wets += 1.0; d += dq * (1.0 - ${DRAWDOWN} * brink);
    o.wash += textureLoad(uWash, vec2<i32>(qx, qy), 0).r;
    o.foam += textureLoad(uFoam, vec2<i32>(qx, slotRow(qy, a)), 0).r;
    vel += flowAt(qx, qy, dq, a);
  }
  o.g = g / max(n, 1.0);
  o.d = d / max(n, 1.0);
  // AT THE MOUTH OF A SPAN the road's water runs on level onto the deck, a storey up, and the deck's corner rule
  // has the two as one sheet there: so the field puts the corner where that rule does, or the two left a strip
  // of bare road between them along the mouth. Only where this column's sheet does reach a storey above.
  if (spanned && a == 0) {
    let mk = cornerMask(vx, vy, contribOf(vx, vy, cx, cy, 0));
    var up = false;
    for (var m = 0; m < 4 * slots(); m++) { if (bitAt(mk, m) == 1 && (m % slots()) > 0) { up = true; } }
    if (up) { o.d = max(cornerOf(vx, vy, mk).x - o.g, 0.0); }
  }
  if (wets > 0.0) { o.wash = o.wash / wets; o.foam = o.foam / wets; o.speed = length(vel / wets); }
  // HOW MUCH ROUND IT IS WATER, smoothed over the sixteen columns round the corner, the near ones counting for
  // more: so the line the surface is cut along bends round a front. Off the map, and any other piece of ground —
  // a wall that holds the water, a drop it goes over — count as water: those are not its edge.
  var cover = 0.0;
  for (var j = 0; j < 16; j++) {
    let qx = vx - 2 + (j % 4);
    let qy = vy - 2 + (j / 4);
    let wgt = select(1.0, 3.0, (j % 4) == 1 || (j % 4) == 2) * select(1.0, 3.0, (j / 4) == 1 || (j / 4) == 2);
    if (!inside(qx, qy)) { cover += wgt; continue; }
    // (The four at the corner, by the corner's own pieces, so every column that shares it agrees. @see cornerPiece)
    let ix = (j % 4) - 1; let iy = (j / 4) - 1;
    let near = ix >= 0 && ix <= 1 && iy >= 0 && iy <= 1;
    var mine = false;
    if (near) { mine = ((piece >> u32(ix + iy * 2)) & 1) != 0; } else { mine = pieceOf(cx, cy, qx, qy, vx, vy); }
    if (wet(depthAt(qx, qy, a)) || !mine) { cover += wgt; }
  }
  o.cover = cover / 64.0;
  // NOT ON A ROCK FACE. On ground drawn as one smooth surface a cliff is a steep slope, and the thin water lying
  // on it was drawn as a body clinging to the face in tongues. Where the GROUND under the corner is that steep and
  // the water on it that thin, it is not drawn; a pool at the foot is deep. Off the ground and not the surface, so a wave front on level
  // ground, however steep, is untouched.
  let rise = select(max(abs(gq[1] + gq[3] - gq[0] - gq[2]), abs(gq[2] + gq[3] - gq[0] - gq[1])) * 0.5, 0.0, edge);
  // (Except at a BRINK — water going over a lip, which the fall's sheet hangs from and the two are one.)
  let face = smoothstep(2.0, 3.5, rise) * (1.0 - smoothstep(0.3, 0.8, o.d)) * (1.0 - smoothstep(0.0, 0.05, o.brink));
  o.cover = o.cover * (1.0 - face);
  // UNLESS WATER IS POURING DOWN IT: then the surface carries on down the face, a film over the rock, wholly
  // covered — and how much of the corner is pouring rides ABOVE ONE in the cover, which the fragment clamps for
  // the edge and reads for the falling look: up to POUR_FLAG over, short of the 1.5 that marks a shelf's shore. (No new varying: they cost more than the shading.) @see pouredAt
  // (Only on a face, and only UP it: from the corner's low side along the way it climbs most, in each of the two
  // rows or columns that meet at it — two short walks, not one a column a way.)
  if (rise > ${POUR_FACE}) {
    let gx = gq[1] + gq[3] - gq[0] - gq[2];
    let gy = gq[2] + gq[3] - gq[0] - gq[1];
    var pour = false;
    if (abs(gx) >= abs(gy)) {
      let dx = select(1, -1, gx > 0.0);
      let lx = select(vx, vx - 1, gx > 0.0);
      pour = pouredFrom(lx, vy - 1, dx, 0, a) || pouredFrom(lx, vy, dx, 0, a);
    } else {
      let dy = select(1, -1, gy > 0.0);
      let ly = select(vy, vy - 1, gy > 0.0);
      pour = pouredFrom(vx - 1, ly, 0, dy, a) || pouredFrom(vx, ly, 0, dy, a);
    }
    if (pour && a == 0) {
      o.d = max(o.d, ${POUR_FILM});
      o.cover = 1.0 + ${POUR_FLAG};
    }
  }
  return o;
}

// HOW LIT A CORNER OF THE FIELD IS, BY ITS OWN SLOPE, as the water always was: the fall of the surface across the
// corner, from the corners either side of it, leans the shade light or dark — which is what a chop on it looks like.
// (Of its DEPTH where it is thin — it lies on the ground, whose own slope is no chop — and of its surface where it is
// deep and stands level over a bed that is not.)
fn fieldLit(c: FieldCorner, vx: i32, vy: i32, cx: i32, cy: i32, a: i32) -> f32 {
  return fieldLitOf(c,
    fieldHeight(vx - 1, vy, cx, cy, a) - fieldHeight(vx + 1, vy, cx, cy, a),
    fieldHeight(vx, vy - 1, cx, cy, a) - fieldHeight(vx, vy + 1, cx, cy, a));
}
// …given the falls across it, in x and in y.
fn fieldLitOf(c: FieldCorner, g2x: vec2<f32>, g2y: vec2<f32>) -> f32 {
  let deepness = smoothstep(0.75, 2.0, c.d);
  let gx = mix(g2x.y, g2x.x, deepness);
  let gy = mix(g2y.y, g2y.x, deepness);
  let lean = (gx + gy) * 0.5;
  let respond = lean / (abs(lean) + ${SLOPE_REF});
  let rough = min(1.0, (abs(gx) + abs(gy)) / ${SLOPE_REF * 2});
  let shown = max(rough, min(1.0, c.speed / ${STREAK_SPEED}));
  return 0.5 + respond * 0.34 + c.wash * (0.2 + 0.8 * shown) * 0.3;
}

// A CORNER OF A SURFACE OFF THE DECK RULE — over a storey above the ground, or wherever the water is not one smooth
// field — for column (ccx, ccy) at its corner (vcx, vcy), shaded off the columns (flat) or off the sheet: its height,
// the height the shore cuts it at and whether it is a shelf, how lit it is, and its look. @see mainVertex
struct DeckCorner { h: f32, hs: f32, lit: f32, shelf: bool, look: vec2<f32> };
fn deckCorner(ccx: i32, ccy: i32, vcx: i32, vcy: i32, flat: bool, a: i32) -> DeckCorner {
  // THIS COLUMN'S COMPONENT AT THIS CORNER, worked out ONCE. A column is
  // always one of its own corners' four, so what comes back is always the
  // component it is in and always the one it helped make — and everything
  // this vertex asks of this corner is asked with it. @see render/sheet-group
  let mine = cornerMask(vcx, vcy, contribOf(vcx, vcy, ccx, ccy, a));
  let c = cornerOf(vcx, vcy, mine);
  let g = vec4<f32>(
    deckSlope(vcx, vcy, -1, 0, flat, a, mine, c.x), deckSlope(vcx, vcy, 1, 0, flat, a, mine, c.x),
    deckSlope(vcx, vcy, 0, -1, flat, a, mine, c.x), deckSlope(vcx, vcy, 0, 1, flat, a, mine, c.x),
  );
  return deckCornerOf(ccx, ccy, vcx, vcy, a, mine, c, g);
}
// ZOOMED OUT AND WHOLE, the gradient off the columns; otherwise off the
// sheet, as the column-by-column mesh and the host builder have it — one way of four.
// @see nearbyFlat
fn deckSlope(vcx: i32, vcy: i32, dx: i32, dy: i32, flat: bool, a: i32, mine: i32, here: f32) -> f32 {
  if (flat) { return nearbyFlat(vcx, vcy, dx, dy, a, here); }
  return nearby(vcx, vcy, dx, dy, mine, here);
}
// …and the rest of it, given its component, its corner and the four ways' surfaces (-x, +x, -y, +y).
fn deckCornerOf(ccx: i32, ccy: i32, vcx: i32, vcy: i32, a: i32, mine: i32, c: vec4<f32>, n: vec4<f32>) -> DeckCorner {
  var o: DeckCorner;
  o.shelf = false;
  let cpt = i32(water.uGrid.z);
  let bed = groundAt(ccx, ccy, a);
  var h = max(c.x, bed);
  // AT A SHORE the surface stays level to the tile's edge — not drawn down to the bed there — and the fragment
  // cuts it where the drawn ground comes up through it. @see mainFragment
  // ASKED OF THE CORNER, NOT THE COLUMN: every column that shares this vertex must put it at one height, or the
  // mesh tears between them. So: whether any tile round the corner is a shelf, and the mean surface of the wet
  // columns round it — which is what the corner already is wherever all four are wet.
  var sloped = false;
  if (a == 0) {
    var shelf = false;
    var sum = 0.0;
    var wets = 0.0;
    for (var k = 0; k < 4; k++) {
      let qx = vcx - (k % 2);
      let qy = vcy - (k / 2);
      if (!inside(qx, qy)) { continue; }
      let qk = groundKind(qx / cpt, qy / cpt, a);
      if (qk == 1) { shelf = true; }
      if (qk == 2) { sloped = true; }
      let qd = depthAt(qx, qy, a);
      if (wet(qd)) { sum += groundAt(qx, qy, a) + qd; wets += 1.0; }
    }
    if (shelf && wets > 0.0) { h = max(h, sum / wets); }
    if (groundKind(ccx / cpt, ccy / cpt, a) == 1) {
      o.shelf = true;
      o.hs = h;
    }
  }

  let e = cornerExtras(vcx, vcy, mine);
  let cd = e.x; let wash = e.y; let foam = e.z; let speed = e.w;
  // THIN WATER LIES ON THE GROUND AS IT IS DRAWN. The solver's floor is the tile's, flat; the ground drawn under
  // it may be a bank. So where any tile round this corner is sloped, the corner is put at the DRAWN ground there
  // plus the depth of the water at it — and the deeper the water the less, till standing water is level as it
  // was. Asked of the corner, with the drawn ground the same from every tile that meets there, so every column
  // that shares the vertex agrees. @see render/drawn.ts
  if (sloped) {
    let tx0 = ccx / cpt; let ty0 = ccy / cpt;
    let lie = 1.0 - smoothstep(${THIN_ON_SLOPE}, ${THIN_ON_SLOPE * 3}, cd);
    h = mix(h, groundFan(tx0, ty0, f32(vcx - tx0 * cpt) / f32(cpt), f32(vcy - ty0 * cpt) / f32(cpt)) + cd, lie);
  }
  let gx = n.x - n.y;
  let gy = n.z - n.w;
  let lean = (gx + gy) * 0.5;
  let respond = lean / (abs(lean) + ${SLOPE_REF});
  let rough = min(1.0, (abs(gx) + abs(gy)) / ${SLOPE_REF * 2});
  let shown = max(rough, min(1.0, speed / ${STREAK_SPEED}));
  let lit = 0.5 + respond * 0.34 + wash * (0.2 + 0.8 * shown) * 0.3;
  o.h = h;
  o.lit = lit;
  o.look = vec2<f32>(cd, foam);
  return o;
}

// A CORNER OF THE FIELD FROM THE TABLE, as column (cx, cy) — one of the four there — has it: ok where the table has
// it, and then its light too. @see cornerTableSource
struct TableCorner { ok: bool, c: FieldCorner, lit: f32 };
fn tableCorner(vx: i32, vy: i32, cx: i32, cy: i32) -> TableCorner {
  var o: TableCorner;
  o.ok = false;
  if (water.uTable.x < 0.5) { return o; }
  var t = tableAt(u32(vy) * u32(water.uTable.y) + u32(vx));
  if ((t.w & 17u) == 16u) {
    // (Each column's own, in the spare table.)
    let i = i32(t.w >> 8u) * 4 + (cx - vx + 1) + 2 * (cy - vy + 1);
    t = spareTableAt(u32(i));
  }
  if ((t.w & 1u) == 0u) { return o; }
  o.ok = true;
  o.c.g = bitcast<f32>(t.x);
  o.c.d = bitcast<f32>(t.y);
  o.c.cover = unpack2x16unorm(t.z).x * 2.0;
  o.c.foam = unpack2x16float(t.z).y;
  o.c.brink = f32((t.w >> 5u) & 0x7ffu) / 2047.0;
  o.c.hx = cx; o.c.hy = cy;
  if ((t.w & 2u) != 0u) {
    let k = i32((t.w >> 2u) & 3u);
    o.c.hx = vx - 1 + k % 2;
    o.c.hy = vy - 1 + k / 2;
  }
  o.lit = unpack2x16float(t.w).y;
  return o;
}
// Either way: from the table where it has it, worked out here where it has not.
fn fieldCornerAt(vx: i32, vy: i32, cx: i32, cy: i32, a: i32) -> FieldCorner {
  if (a == 0) {
    let t = tableCorner(vx, vy, cx, cy);
    if (t.ok) { return t.c; }
  }
  return fieldCorner(vx, vy, cx, cy, a);
}

// AS ONE SMOOTH FIELD, A FACE DOWN A STEP THE FIELD PARTS AT — a kerb, a quay, a road's edge: the field has no
// sides, and where the ground parts the water the high side's surface stopped at the step with nothing under it.
// One end of the far edge (axis) of column (cx, cy), at its top (corners 0, 1: this column's water as its own
// piece has it there) or its foot (2, 3: the water, or the ground, of the piece across). Where the two are one
// piece they agree and the face is nothing. Not into a channel under a span: that is the bridge's. @see quad-rule's fieldStep
struct FieldFace { ok: bool, fx: f32, fy: f32, h: f32, fall: f32, d: f32, foam: f32 };
fn fieldFace(cx: i32, cy: i32, axis: i32, corner: i32, a: i32) -> FieldFace {
  var o: FieldFace;
  o.ok = false;
  let jx = cx + select(0, 1, axis == 0);
  let jy = cy + select(1, 0, axis == 0);
  if (!inside(jx, jy) || roofAt(jx, jy, a) < ${OPEN_SKY}) { return o; }
  // (Only where something BUILT parts the water — bare ground is one piece, however steep — and only between two
  // tiles: asked first, as it is cheap, and most of the edges the gathering keeps are not one.) @see pieceOf
  let cpt = i32(water.uGrid.z);
  let ax = cx / cpt; let ay = cy / cpt; let bx = jx / cpt; let by = jy / cpt;
  if (ax == bx && ay == by) { return o; }
  let builtA = (i32(textureLoad(uShore, vec2<i32>(ax * 2 + 1, ay), 0).w + 0.5) & 16) != 0;
  let builtB = (i32(textureLoad(uShore, vec2<i32>(bx * 2 + 1, by), 0).w + 0.5) & 16) != 0;
  if (!builtA && !builtB && water.uList.w > 0.5) { return o; }
  let far = corner == 1 || corner == 2;
  let vx = cx + select(select(0, 1, far), 1, axis == 0);
  let vy = cy + select(1, select(0, 1, far), axis == 0);
  let c = fieldCornerAt(vx, vy, cx, cy, a);
  let top = c.g + c.d;
  let q = fieldCornerAt(vx, vy, jx, jy, a);
  let step = 1.0 / f32(cpt);
  o.fx = f32(vx) * step - 0.5;
  o.fy = f32(vy) * step - 0.5;
  o.h = select(top, min(top, q.g + q.d), corner >= 2);
  o.fall = c.brink;
  o.d = c.d;
  o.foam = c.foam;
  o.ok = true;
  return o;
}

// HOW A FACE DOWN A STEP IS SHADED: where the water is going over it, as the surface's own water pouring down a
// face (the pour flag over one in the cover, the look a thin film's); where it only stands at it, as the body of
// the water cut through, as at the map's edge. @see fieldFace, mainFragment
struct StepLook { rgb: vec3<f32>, alpha: f32, cover: f32, look: vec2<f32> };
fn stepLook(cx: i32, cy: i32, f: FieldFace, a: i32) -> StepLook {
  var o: StepLook;
  let mat = i32(textureLoad(uMaterial, vec2<i32>(cx, slotRow(cy, a)), 0).r * 255.0 + 0.5);
  let tint = fouled(textureLoad(uTint, vec2<i32>(0, mat), 0).rgb, cx, cy, a);
  let pour = smoothstep(0.0, 0.05, f.fall);
  o.rgb = mix(tint * vec3<f32>(0.2, 0.3, 0.42), tint, pour);
  o.alpha = mix(0.86, 0.5, pour);
  o.cover = 1.0 + ${POUR_FLAG} * pour;
  o.look = select(vec2<f32>(-1.0, 0.0), vec2<f32>(max(f.d, ${POUR_FILM}), f.foam), pour > 0.0);
  return o;
}

// WHAT THE DRAWN GROUND OF A TILE IS to the water on it: 1 a SHELF (a shore, cut to the ground), 2 SLOPED bare
// ground (thin water lies on it), 0 flat. The ground storey only. @see ground-mesh.ts surfaceOf
fn groundKind(tx: i32, ty: i32, a: i32) -> i32 {
  if (a != 0) { return 0; }
  return i32(textureLoad(uShore, vec2<i32>(tx * 2 + 1, ty), 0).y + 0.5);
}
// The drawn ground of a tile at (u, v) of it, each 0 to 1: a fan from its middle to its corners. @see drawnHeight
fn groundFan(tx: i32, ty: i32, u: f32, v: f32) -> f32 {
  let c = textureLoad(uShore, vec2<i32>(tx * 2, ty), 0);
  let m = textureLoad(uShore, vec2<i32>(tx * 2 + 1, ty), 0).x;
  let f = vec2<f32>(u - 0.5, v - 0.5);
  let t = 2.0 * max(abs(f.x), abs(f.y));
  var ea = c.x; var eb = c.w; var s = 0.5;
  if (abs(f.x) >= abs(f.y)) {
    s = 0.5 + f.y / max(2.0 * abs(f.x), 0.0001);
    if (f.x > 0.0) { ea = c.y; eb = c.z; }
  } else {
    s = 0.5 + f.x / max(2.0 * abs(f.y), 0.0001);
    if (f.y > 0.0) { ea = c.w; eb = c.z; } else { eb = c.y; }
  }
  return m + t * (mix(ea, eb, s) - m);
}

struct QuadOut { ok: bool, fx: f32, fy: f32, h: f32, rgb: vec3<f32>, alpha: f32, shore: vec4<f32>, look: vec2<f32> };
// ONE CORNER OF ONE QUAD — everything a vertex is but where it lands on the screen — for the draw, and for the rare
// pass to work out the quads the slim draw leaves to it. ("out" as it was in the vertex shader, so it reads as it did.)
fn quadCorner(raw: u32, deckSlot: i32, corner: i32) -> QuadOut {
  var out: QuadOut;
  out.ok = false;
  out.shore = vec4<f32>(0.0, 0.0, 0.0, 1.0);
  out.look = vec2<f32>(-1.0, 0.0);
  let cpt = i32(water.uGrid.z);
  let per = cpt * cpt;
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

  if (f32(tileIdx) >= bandAt.w) { return out; }

  let tx = i32(bandAt.y) + tileIdx;
  let ty = i32(bandAt.x) - tx;
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
    if (SLIM) { return out; }
    if (!facesOn()) { return out; }
    // (As one smooth field the water has no sides but at the map's edge, which are the column's own, and down a
    // step the field parts at, filed forward as any face is.)
    if (fieldOn() && a == 0) {
      let f = fieldFace(ocx, ocy, part, corner, a);
      if (!f.ok) { return out; }
      fx = f.fx; fy = f.fy; h = f.h;
      let st = stepLook(ocx, ocy, f, a);
      rgb = st.rgb; alpha = st.alpha; out.shore = vec4<f32>(fx + 0.5, fy + 0.5, h, st.cover); out.look = st.look;
    } else {
    // (A shelf has no sides: its water is cut to the ground, not stood on a bed. @see mainFragment)
    let okind = groundKind(ocx / cpt, ocy / cpt, a);
    if (okind == 1) { return out; }
    let bd = depthAt(ocx, ocy, a);
    if (bd <= water.uBand.z) { return out; }
    // (Thin water on sloped ground lies on it and has no sides: there is no step there for one to stand on.)
    if (okind == 2 && bd < ${THIN_ON_SLOPE}) { return out; }
    if (!forward(ocx, ocy, part, cpt, a)) { return out; }
    let p = sidePart(ocx, ocy, part, corner,
      fx0 - select(0.0, step, part == 0), fy0 - select(step, 0.0, part == 0), step, bd, a);
    if (!p.ok) { return out; }
    fx = p.fx; fy = p.fy; h = p.h; rgb = p.colour; alpha = p.alpha;
    }
  } else if (part == 2 && fieldOn() && a == 0) {
    // THE SURFACE, AS ONE SMOOTH FIELD: of a wet column, or of a dry one beside water (its edge runs through it).
    let ox = ((corner + 1) >> 1) & 1;
    let oy = corner >> 1;
    let span = select(1, cpt, whole);
    let ccx = cx + ox * (span - 1);
    let ccy = cy + oy * (span - 1);
    fx = fx0 + f32(ox * span) * step;
    fy = fy0 + f32(oy * span) * step;
    // FROM THE CORNER TABLE where it has this corner — the same corner, worked out once and not by each quad that
    // meets there — and where it has not, worked out here as it always was. @see cornerTableSource
    var hx = ccx;
    var hy = ccy;
    let t = tableCorner(ccx + ox, ccy + oy, ccx, ccy);
    if (t.ok) {
      h = t.c.g + t.c.d;
      out.shore = vec4<f32>(fx + 0.5, fy + 0.5, h, t.c.cover);
      alpha = clamp(t.lit, 0.0, 1.0);
      hx = t.c.hx; hy = t.c.hy;
      out.look = vec2<f32>(t.c.d, t.c.foam);
    } else {
      if (SLIM) { return out; }
      let c = fieldCorner(ccx + ox, ccy + oy, ccx, ccy, a);
      h = c.g + c.d;
      out.shore = vec4<f32>(fx + 0.5, fy + 0.5, h, c.cover);
      alpha = clamp(fieldLit(c, ccx + ox, ccy + oy, ccx, ccy, a), 0.0, 1.0);
      hx = c.hx; hy = c.hy;
      out.look = vec2<f32>(c.d, c.foam);
    }
    let mat = i32(textureLoad(uMaterial, vec2<i32>(hx, slotRow(hy, a)), 0).r * 255.0 + 0.5);
    rgb = fouled(textureLoad(uTint, vec2<i32>(0, mat), 0).rgb, hx, hy, a);
  } else if (part == 2) {
    // THE SURFACE.
    if (SLIM) { return out; }
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
    fx = fx0 + f32(ox * span) * step;
    fy = fy0 + f32(oy * span) * step;
    // FROM THE DECK TABLE where this quad was given a slot in it — the same corner, worked out once by a thread of
    // its own rather than in the band's draw — and where it was not, worked out here. @see deckCorner
    var dc: DeckCorner;
    if (deckSlot >= 0 && water.uTable.x > 0.5) {
      let e0 = deckEntry(u32(deckSlot * 8 + corner * 2));
      let e1 = deckEntry(u32(deckSlot * 8 + corner * 2 + 1));
      dc.h = bitcast<f32>(e0.x); dc.hs = bitcast<f32>(e0.y); dc.lit = bitcast<f32>(e0.z); dc.shelf = e0.w == 1u;
      dc.look = vec2<f32>(bitcast<f32>(e1.x), bitcast<f32>(e1.y));
    } else {
      dc = deckCorner(ccx, ccy, ccx + ox, ccy + oy, whole || cheap, a);
    }
    h = dc.h;
    let mat = i32(textureLoad(uMaterial, vec2<i32>(ccx, slotRow(ccy, a)), 0).r * 255.0 + 0.5);
    rgb = fouled(textureLoad(uTint, vec2<i32>(0, mat), 0).rgb, ccx, ccy, a);
    alpha = clamp(dc.lit, 0.0, 1.0);
    out.look = dc.look;
    // (At a shelf, the surface as it stood before it was laid on a slope: the fragment cuts it to the shore.)
    out.shore = select(vec4<f32>(fx + 0.5, fy + 0.5, h, 1.0), vec4<f32>(fx + 0.5, fy + 0.5, dc.hs, 2.0), dc.shelf);
  } else {
    // A SIDE of this column. Hung from the very corners the surface quad
    // used, so the two share vertices and there is no seam between them.
    // Skipped where it is filed FORWARD instead — see PARTS.
    if (SLIM) { return out; }
    if (d <= water.uBand.z) { return out; }
    if (!facesOn()) { return out; }
    if (fieldOn() && a == 0) {
      // THE MAP'S EDGE cuts the water through: a face from its surface down to the ground, corner for corner.
      let axis = part - 3;
      let jx = cx + select(0, 1, axis == 0);
      let jy = cy + select(1, 0, axis == 0);
      if (inside(jx, jy)) {
        // (DOWN A STEP the field parts at, unless filed forward into the band in front. @see fieldFace)
        if (forward(cx, cy, axis, cpt, a)) { return out; }
        let f = fieldFace(cx, cy, axis, corner, a);
        if (!f.ok) { return out; }
        fx = f.fx; fy = f.fy; h = f.h;
        let st = stepLook(cx, cy, f, a);
        rgb = st.rgb; alpha = st.alpha; out.shore = vec4<f32>(fx + 0.5, fy + 0.5, h, st.cover); out.look = st.look;
      } else {
      // Along the edge: its two ends, each at the top (corners 0, 1) or the foot (2, 3).
      let far = corner == 1 || corner == 2;
      let vx = cx + select(select(0, 1, far), 1, axis == 0);
      let vy = cy + select(1, select(0, 1, far), axis == 0);
      let c = fieldCornerAt(vx, vy, cx, cy, a);
      fx = f32(tx) - 0.5 + f32(vx - tx * cpt) * step;
      fy = f32(ty) - 0.5 + f32(vy - ty * cpt) * step;
      h = c.g + select(c.d, 0.0, corner >= 2);
      // (As dark as the body of deep water is: it is that water, cut through, not a pale veil. @see waterLook)
      alpha = 0.86;
      let mat = i32(textureLoad(uMaterial, vec2<i32>(cx, slotRow(cy, a)), 0).r * 255.0 + 0.5);
      rgb = fouled(textureLoad(uTint, vec2<i32>(0, mat), 0).rgb, cx, cy, a) * vec3<f32>(0.2, 0.3, 0.42);
      }
    } else {
    let kind = groundKind(cx / cpt, cy / cpt, a);
    if (kind == 1) { return out; }
    if (kind == 2 && d < ${THIN_ON_SLOPE}) { return out; }
    let axis = part - 3;
    if (forward(cx, cy, axis, cpt, a)) { return out; }
    let p = sidePart(cx, cy, axis, corner, fx0, fy0, step, d, a);
    if (!p.ok) { return out; }
    fx = p.fx; fy = p.fy; h = p.h; rgb = p.colour; alpha = p.alpha;
    }
  }

  out.ok = true;
  out.fx = fx; out.fy = fy; out.h = h; out.rgb = rgb; out.alpha = alpha;
  return out;
}

@vertex
fn mainVertex(
  @location(0) aVertexId: f32,
  @builtin(instance_index) inst: u32,
) -> VSOutput {
  var out: VSOutput;
  out.position = vec4<f32>(0.0, 0.0, 0.0, 1.0);
  out.vColor = vec4<f32>(0.0, 0.0, 0.0, 0.0);
  out.vShore = vec4<f32>(0.0, 0.0, 0.0, 1.0);
  out.vLook = vec2<f32>(-1.0, 0.0);
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
  var raw = textureLoad(uQuads, vec2<i32>(at % lw, at / lw), 0).r;
  // A DECK QUAD'S ENTRY points at its slot in the deck table, which says which quad it is. @see deckCorner
  var deckSlot = -1;
  if ((raw >> 31u) == 1u) {
    deckSlot = i32(raw & 0x7fffffffu);
    if (!SLIM) { raw = uDeckAt[u32(deckSlot)]; }
  }
  bandAt = water.uBand;
  roofedAt = water.uSlots.y > 0.5;
  // A RARE QUAD in the slim draw, as the rare pass worked it out; any other, worked out here. @see rareTable
  var q: QuadOut;
  if (SLIM && deckSlot >= 0) {
    let base = u32(${RARE_AT} + deckSlot * 16 + corner * 4);
    let e0 = uDeck[base];
    let e1 = uDeck[base + 1u];
    let e2 = uDeck[base + 2u];
    let e3 = uDeck[base + 3u];
    q.ok = e0.w == 1u;
    q.fx = bitcast<f32>(e0.x); q.fy = bitcast<f32>(e0.y); q.h = bitcast<f32>(e0.z);
    q.rgb = bitcast<vec3<f32>>(e1.xyz); q.alpha = bitcast<f32>(e1.w);
    q.shore = bitcast<vec4<f32>>(e2);
    q.look = bitcast<vec2<f32>>(e3.xy);
  } else {
    q = quadCorner(raw, deckSlot, corner);
  }
  if (!q.ok) { return out; }
  let fx = q.fx; let fy = q.fy; let h = q.h; let rgb = q.rgb; let alpha = q.alpha;
  out.vShore = q.shore;
  out.vLook = q.look;

  let px = (fx - fy) * water.uIso.x;
  let py = (fx + fy) * water.uIso.y - h * water.uIso.z;
  let mvp = globalUniforms.uProjectionMatrix
          * globalUniforms.uWorldTransformMatrix
          * localUniforms.uTransformMatrix;
  let clip = mvp * vec3<f32>(px, py, 1.0);
  out.position = vec4<f32>(clip.xy, 0.0, 1.0);
  // (A surface's colour is finished per pixel. @see waterLook)
  if (out.vLook.x >= 0.0) {
    out.vColor = vec4<f32>(rgb, alpha);
  } else {
    out.vColor = vec4<f32>(rgb * alpha, alpha)
               * localUniforms.uColor
               * globalUniforms.uWorldColorAlpha;
  }
  return out;
}
`;

/**
 * EACH CORNER OF THE SMOOTH FIELD, WORKED OUT ONCE A FRAME, as a texel the vertex shader reads.
 *
 * A corner of the field is shared by the four columns round it, and every quad that meets there worked it out for
 * itself: the four columns, their pieces of ground, the sixteen round it for where the edge is cut, and the four
 * corners either side for the slope it is lit by — some hundred and seventy texture reads, four times over, for one
 * point. It was most of the water's cost on the GPU.
 *
 * WHERE ALL FOUR WOULD COME TO THE SAME ANSWER, this pass gives it them: on ground drawn as one smooth surface, with
 * nothing built anywhere in the sixteen columns round the corner — or the ground under all sixteen within a step of
 * itself — and no roof over the four at it, every column is
 * one piece with every other there, and the corner — its height, depth, cover, foam, how lit it is — is the same
 * whichever of the four asks; even the column it is coloured by, unless none of them is wet and each is its own.
 * Anywhere else the texel says so and the quads work it out as they always have. The same functions, the same text:
 * the vertex shader's own, with an entry point added. @see fieldCorner, fieldLit
 *
 * Packed into one texel: the ground and the depth exactly; the cover to a sixteen-bit fraction of two (as a half it
 * moved the cut a hair, and edge pixels flipped); foam and the light as halves; and a flag that
 * it is filled, whether a column there is wet, and which. @see the surface branch of mainVertex
 */
export const CORNER_WG = 8;
const withoutVertex = (src: string) => {
  const at = src.indexOf("@vertex\nfn mainVertex(");
  return src.slice(0, at) + src.slice(src.indexOf("\n}\n", at) + 3);
};
export const cornerTableSource = () => withoutVertex(WGSL)
  // (No vertex entry here: the draw's, through these, would reach the tables this pass writes.)
  .replace("{ return uCorner[i]; }", "{ return cornerOut[i]; }")
  .replace("{ return uCornerX[i]; }", "{ return spareOut[i]; }")
  .replace("{ return uDeck[i]; }", "{ return deckOut[i]; }") + /* wgsl */ `
@group(2) @binding(20) var<storage, read_write> cornerOut : array<vec4<u32>>;
@group(2) @binding(21) var<storage, read_write> spareOut : array<vec4<u32>>;
@group(2) @binding(22) var<storage, read_write> spareN : atomic<u32>;
@group(2) @binding(23) var<storage, read_write> spareAt : array<u32>;
// WHICH CORNERS A QUAD THIS FRAME WILL READ, marked by the gathering: no other is worked out. @see quads-gpu
@group(2) @binding(24) var<storage, read_write> need : array<u32>;
// THE DECK TABLE'S QUADS, given their slots by the gathering, and where it writes their corners. @see deckCorner
@group(2) @binding(25) var<storage, read_write> deckAt : array<u32>;
// [0] how many, from [4] each slot's band
@group(2) @binding(26) var<storage, read_write> deckMeta : array<atomic<u32>>;
@group(2) @binding(28) var<storage, read_write> deckOut : array<vec4<u32>>;
fn tileBuilt(tx: i32, ty: i32) -> bool {
  return (i32(textureLoad(uShore, vec2<i32>(tx * 2 + 1, ty), 0).w + 0.5) & 16) != 0;
}
// The corner as column (sx, sy) has it, packed. @see the surface branch of mainVertex
fn entryFor(vx: i32, vy: i32, sx: i32, sy: i32) -> vec4<u32> {
  let c = fieldCorner(vx, vy, sx, sy, 0);
  return entryOf(vx, vy, c, fieldLit(c, vx, vy, sx, sy, 0));
}
fn entryOf(vx: i32, vy: i32, c: FieldCorner, lit: f32) -> vec4<u32> {
  // (The brink in the bits between the flags and the light, rounded up: a corner going over a lip, however little,
  // still is. @see fieldFace)
  var flags = 1u | (u32(ceil(clamp(c.brink, 0.0, 1.0) * 2047.0)) << 5u);
  if (wet(depthAt(c.hx, c.hy, 0))) {
    flags = flags | 2u | (u32((c.hx - vx + 1) + 2 * (c.hy - vy + 1)) << 2u);
  }
  return vec4<u32>(
    bitcast<u32>(c.g), bitcast<u32>(c.d),
    (pack2x16unorm(vec2<f32>(c.cover * 0.5, 0.0)) & 0xffffu) | (pack2x16float(vec2<f32>(0.0, c.foam)) & 0xffff0000u),
    (pack2x16float(vec2<f32>(0.0, lit)) & 0xffff0000u) | flags,
  );
}
fn cornerEntry(vx: i32, vy: i32) -> vec4<u32> {
  if (!fieldOn() || water.uList.w < 0.5) { return vec4<u32>(0u); }
  let cpt = i32(water.uGrid.z);
  let nx = i32(water.uGrid.x);
  let ny = i32(water.uGrid.y);
  // (Every corner a kept quad reads, wet round it or not — zoomed out, a dry tile's whole surface beside water has
  // corners with nothing wet near, and the slim draw has nothing but the table to ask. @see SLIM)
  // ONE ANSWER FOR ALL FOUR where nothing is built in the sixteen, or the ground across them all is within a step of
  // itself — then every column there is one piece with every other (@see pieceOf) — and nothing is roofed at the
  // corner, where it is the deck rule's (@see fieldCorner).
  var one = true;
  let tx0 = max(vx - 2, 0) / cpt; let tx1 = min(vx + 1, nx - 1) / cpt;
  let ty0 = max(vy - 2, 0) / cpt; let ty1 = min(vy + 1, ny - 1) / cpt;
  var built = false;
  for (var ty = ty0; ty <= ty1; ty++) {
    for (var tx = tx0; tx <= tx1; tx++) {
      if (tileBuilt(tx, ty)) { built = true; }
    }
  }
  if (built) {
    var lo = 1e9; var hi = -1e9;
    for (var j = 0; j < 16; j++) {
      let qx = vx - 2 + (j % 4);
      let qy = vy - 2 + (j / 4);
      if (!inside(qx, qy)) { continue; }
      let gq = groundAt(qx, qy, 0);
      lo = min(lo, gq); hi = max(hi, gq);
    }
    if (hi - lo >= ${PIECE_STEP}) { one = false; }
  }
  var sx = -1; var sy = -1;
  for (var k = 3; k >= 0; k--) {
    let qx = vx - 1 + (k % 2);
    let qy = vy - 1 + (k / 2);
    if (!inside(qx, qy)) { continue; }
    if (roofAt(qx, qy, 0) < ${OPEN_SKY}) { one = false; }
    sx = qx; sy = qy;
  }
  if (sx < 0) { return vec4<u32>(0u); }
  if (one) {
    allOnePiece = true;
    return entryFor(vx, vy, sx, sy);
  }
  // ELSE AN ANSWER FOR EACH OF THE FOUR, in the spare table, four texels a corner, this texel saying where — worked
  // out by cornerSpare, a thread a column, and not here one after another: a frame waits on its slowest thread.
  let i = atomicAdd(&spareN, 1u);
  if (i >= ${SPARE_CORNERS}u) { return vec4<u32>(0u); }
  spareAt[i] = u32(vx) | (u32(vy) << 16u);
  return vec4<u32>(0u, 0u, 0u, (i << 8u) | 16u);
}
// THE REST, IN ONE DISPATCH, side by side as neither waits on the other: the spare table's entries, eight threads
// each — the corner and the heights either side of it at once, not one after another (a frame waits on its slowest
// thread) — and the deck table's corners, four threads each, one way each for the slope. Each half strides over
// however many there are this frame. @see cornerEntry, deckCorner
var<workgroup> restN : u32;
var<workgroup> restH : array<vec2<f32>, 64>;
var<workgroup> deckWays : array<f32, 64>;
@compute @workgroup_size(64)
fn cornerRest(@builtin(workgroup_id) wid: vec3<u32>, @builtin(local_invocation_index) li: u32) {
  if (wid.x < ${SPARE_WG}u) { spareRest(wid.x, li); } else { deckRest(wid.x - ${SPARE_WG}u, li); }
}
fn spareRest(w: u32, li: u32) {
  if (li == 0u) { restN = min(atomicLoad(&spareN), ${SPARE_CORNERS}u) * 4u; }
  let total = workgroupUniformLoad(&restN);
  for (var base = w * 8u; base < total; base += ${SPARE_WG}u * 8u) {
    let n = base + li / 8u;
    let part = li % 8u;
    let live = n < total;
    var vx = 0; var vy = 0; var qx = 0; var qy = 0;
    var ok = false;
    if (live) {
      let at = spareAt[n / 4u];
      vx = i32(at & 0xffffu);
      vy = i32(at >> 16u);
      let k = i32(n % 4u);
      qx = vx - 1 + (k % 2);
      qy = vy - 1 + (k / 2);
      ok = inside(qx, qy);
    }
    var c: FieldCorner;
    if (ok && part < 4u) {
      let ox = select(select(1, -1, part == 0u), 0, part >= 2u);
      let oy = select(0, select(1, -1, part == 2u), part >= 2u);
      restH[li] = fieldHeight(vx + ox, vy + oy, qx, qy, 0);
    }
    if (ok && part == 4u) { c = fieldCorner(vx, vy, qx, qy, 0); }
    workgroupBarrier();
    if (live && part == 4u) {
      var e = vec4<u32>(0u);
      if (ok) {
        let h = li - 4u;
        e = entryOf(vx, vy, c, fieldLitOf(c, restH[h] - restH[h + 1u], restH[h + 2u] - restH[h + 3u]));
      }
      spareOut[n] = e;
    }
    workgroupBarrier();
  }
}
fn deckRest(w: u32, li: u32) {
  if (li == 0u) { restN = min(atomicLoad(&deckMeta[0]), ${DECK_SLOTS}u) * 4u; }
  let total = workgroupUniformLoad(&restN);
  for (var base = w * 16u; base < total; base += ${DECK_WG}u * 16u) {
  let n = base + li / 4u;
  let way = li % 4u;
  let slot = n / 4u;
  var live = n < total;
  var ccx = 0; var ccy = 0; var vcx = 0; var vcy = 0; var a = 0;
  var mine = 0;
  var c = vec4<f32>(0.0);
  if (live) {
  let corner = i32(n % 4u);
  let raw = deckAt[slot];
  let said = atomicLoad(&deckMeta[4u + slot]);
  let b = i32(said & 0xffffu);
  roofedAt = (said >> 16u) == 1u;
  let whole = ((raw >> 30u) & 1u) == 1u;
  let cheap = ((raw >> 29u) & 1u) == 1u;
  let quad = i32(raw & 0x1fffffffu) - 1;
  let cpt = i32(water.uGrid.z);
  let per = cpt * cpt;
  let L = slots();
  // (Only the surfaces off the deck rule: the rest of the rare table's quads ask nothing of it. @see rareTable)
  live = (quad / L) % ${PARTS} == 2;
  if (live) {
  let qa = quad % L;
  let at = (quad / L) / ${PARTS};
  let tileIdx = at / per;
  let sub = at % per;
  let tx = max(0, b - (i32(water.uGrid.y) / cpt - 1)) + tileIdx;
  let ty = b - tx;
  let cx = tx * cpt + sub % cpt;
  let cy = ty * cpt + sub / cpt;
  let ox = ((corner + 1) >> 1) & 1;
  let oy = corner >> 1;
  let span = select(1, cpt, whole);
  ccx = cx + ox * (span - 1);
  ccy = cy + oy * (span - 1);
  vcx = ccx + ox;
  vcy = ccy + oy;
  a = qa;
  mine = cornerMask(vcx, vcy, contribOf(vcx, vcy, ccx, ccy, a));
  c = cornerOf(vcx, vcy, mine);
  let d = vec2<i32>(select(select(1, -1, way == 0u), 0, way >= 2u), select(0, select(1, -1, way == 2u), way >= 2u));
  deckWays[li] = deckSlope(vcx, vcy, d.x, d.y, whole || cheap, a, mine, c.x);
  }
  }
  workgroupBarrier();
  if (live && way == 0u) {
    let dc = deckCornerOf(ccx, ccy, vcx, vcy, a, mine, c,
      vec4<f32>(deckWays[li], deckWays[li + 1u], deckWays[li + 2u], deckWays[li + 3u]));
    deckOut[n * 2u] = vec4<u32>(bitcast<u32>(dc.h), bitcast<u32>(dc.hs), bitcast<u32>(dc.lit), select(0u, 1u, dc.shelf));
    deckOut[n * 2u + 1u] = vec4<u32>(bitcast<u32>(dc.look.x), bitcast<u32>(dc.look.y), 0u, 0u);
  }
  workgroupBarrier();
  }
}
// THE RARE TABLE: every quad the slim draw does not work out for itself — faces, sides, a storey above the ground,
// the surface wherever it is not the smooth field — worked out whole, a thread a corner, by the vertex shader's own
// rule, after the corner and deck tables it reads. Its band and tier are the quad's own. @see SLIM, quadCorner
fn bandOf(b: i32) -> vec4<f32> {
  let cpt = i32(water.uGrid.z);
  let tx0 = max(0, b - (i32(water.uGrid.y) / cpt - 1));
  let tx1 = min(i32(water.uGrid.x) / cpt - 1, b);
  return vec4<f32>(f32(b), f32(tx0), water.uBand.z, f32(max(0, tx1 - tx0 + 1)));
}
@compute @workgroup_size(64)
fn rareTable(@builtin(global_invocation_id) gid: vec3<u32>) {
  let total = min(atomicLoad(&deckMeta[0]), ${DECK_SLOTS}u) * 4u;
  for (var n = gid.x; n < total; n += ${RARE_WG * 64}u) {
    let slot = n / 4u;
    let said = atomicLoad(&deckMeta[4u + slot]);
    bandAt = bandOf(i32(said & 0xffffu));
    roofedAt = (said >> 16u) == 1u;
    let q = quadCorner(deckAt[slot], i32(slot), i32(n % 4u));
    let base = ${RARE_AT}u + n * 4u;
    deckOut[base] = vec4<u32>(bitcast<u32>(q.fx), bitcast<u32>(q.fy), bitcast<u32>(q.h), select(0u, 1u, q.ok));
    deckOut[base + 1u] = vec4<u32>(bitcast<vec3<u32>>(q.rgb), bitcast<u32>(q.alpha));
    deckOut[base + 2u] = bitcast<vec4<u32>>(q.shore);
    deckOut[base + 3u] = vec4<u32>(bitcast<vec2<u32>>(q.look), 0u, 0u);
  }
}
@compute @workgroup_size(${CORNER_WG}, ${CORNER_WG})
fn cornerTable(@builtin(global_invocation_id) gid: vec3<u32>) {
  let vx = i32(gid.x);
  let vy = i32(gid.y);
  if (vx > i32(water.uGrid.x) || vy > i32(water.uGrid.y)) { return; }
  let at = u32(vy) * u32(water.uTable.y) + u32(vx);
  if (need[at] == 0u) { return; }
  cornerOut[at] = cornerEntry(vx, vy);
}
`;

/**
 * WATER AS WATER, not as a tinted veil: what a surface pixel looks like, from what the solver says is there.
 *
 * It was a colour lightened toward white the more lit it was, laid over the ground at a third to nine tenths opaque
 * — which is a blue mist: pale, and as see-through over a deep lake as over a puddle. Real water does three things
 * that did not: it SWALLOWS light with depth (the bed shows through the shallows, darkened and tinted, and deep water
 * goes dark and closes up), it MIRRORS the sky (more of it the more it is looked across, Schlick's Fresnel), and it
 * throws the SUN back in glints off the facets that face it. So:
 *
 *  - the body: the fluid's own colour toward a clear teal where it is shallow and a dark navy where deep, its cover
 *    by Beer's law, `1 - e^-kd`, over a floor that keeps a thin sheet visible at all;
 *  - the surface's normal: its slope across the corner as the solver has it (the chop, a river's standing waves), and
 *    under that fine ripples, a few crossing trains of them drifting on the water's own clock;
 *  - from the normal, the share of the sky it reflects and a tight highlight where a facet catches the sun — gone
 *    with the day. Both go IN premultiplied, so a reflection lights the surface without closing it up any more than
 *    a mirror does: cover is `a(1 - F) + F`.
 *
 * Foam on top as it always was: toward white, and closing the surface up. Nothing here makes water where the solver
 * has none — it only says how the water it has looks. @see surfaceLook, water-is-the-sim
 */
export function lookSource(lang: "wgsl" | "glsl"): string {
  const w = lang === "wgsl";
  const f = w ? "f32" : "float";
  const v2 = w ? "vec2<f32>" : "vec2";
  const v3 = w ? "vec3<f32>" : "vec3";
  const v4 = w ? "vec4<f32>" : "vec4";
  const L = (name: string, type: string) => (w ? `let ${name}` : `${type} ${name}`);
  const V = (name: string, type: string) => (w ? `var ${name}` : `${type} ${name}`);
  const fnDecl = (name: string, args: [string, string][], ret: string) => (w
    ? `fn ${name}(${args.map(([n, t]) => `${n}: ${t}`).join(", ")}) -> ${ret}`
    : `${ret} ${name}(${args.map(([n, t]) => `${t} ${n}`).join(", ")})`);
  return `
// A hash without a sine: a few multiply-adds, where sin() is a long call on many GPUs and this runs per pixel.
${fnDecl("lookHash", [["p", v2]], f)} {
  ${V("q", v3)} = fract(${v3}(p.x, p.y, p.x) * 0.1031);
  q += dot(q, q.yzx + 33.33);
  return fract((q.x + q.y) * q.z);
}
// RIPPLES, as the slope of a drifting noise: never a lattice. Trains of regular waves crossing each other made a
// checkerboard over every lake; noise, turned off the grid's axes and moving, has no period for the eye to find.
// Its slope worked out with it (four corners, once), not by asking the noise three times.
${fnDecl("lookSlope", [["p", v2]], v2)} {
  ${L("i", v2)} = floor(p); ${L("q", v2)} = fract(p);
  ${L("u", v2)} = q * q * (3.0 - 2.0 * q);
  ${L("du", v2)} = 6.0 * q * (1.0 - q);
  ${L("a", f)} = lookHash(i);
  ${L("b", f)} = lookHash(i + ${v2}(1.0, 0.0));
  ${L("c", f)} = lookHash(i + ${v2}(0.0, 1.0));
  ${L("e", f)} = lookHash(i + ${v2}(1.0, 1.0));
  return du * ${v2}(b - a + (a - b - c + e) * u.y, c - a + (a - b - c + e) * u.x);
}
${fnDecl("waterLook", [["lit", v4], ["lk", v2], ["p", v2], ["u", v4]], v4)} {
  ${L("d", f)} = lk.x;
  ${L("fade", f)} = min(1.0, d / ${SHOW_DEPTH});
  // THE BODY: clear and tinted in the shallows, dark and closed up where deep.
  // (Depths as the solver has them: a pond or a river runs half a unit to one and a half, a lake's middle more.)
  ${L("deep", f)} = smoothstep(0.1, 2.2, d);
  ${V("a", f)} = (0.16 + 0.8 * (1.0 - exp(-d * 1.3))) * fade;
  ${L("body", v3)} = mix(lit.rgb * ${v3}(0.62, 0.95, 0.85), lit.rgb * ${v3}(0.16, 0.27, 0.4), deep) * (0.72 + 0.56 * lit.a);
  // THE NORMAL: the solver's slope, and fine ripples under it, stronger in patches.
  ${L("t", f)} = u.x;
  // (Stronger where the current's own pattern is lit, so the ripples come in patches.)
  ${L("calm", f)} = 0.5 + 0.9 * lit.a;
  // Two scales, each turned and drifting its own way. (Rotations, in tiles: the finer the faster.)
  ${L("p1", v2)} = ${v2}(p.x * 0.8 - p.y * 0.6, p.x * 0.6 + p.y * 0.8) * 2.3 + ${v2}(t * 0.21, t * 0.13);
  ${L("p2", v2)} = ${v2}(p.x * 0.28 + p.y * 0.96, p.y * 0.28 - p.x * 0.96) * 5.1 - ${v2}(t * 0.37, -t * 0.29);
  ${L("g1", v2)} = lookSlope(p1);
  ${L("g2", v2)} = lookSlope(p2);
  // (Back from each turned frame to the ground's.)
  ${L("r", v2)} = ${v2}(g1.x * 0.8 + g1.y * 0.6, g1.y * 0.8 - g1.x * 0.6) * 0.6
    + ${v2}(g2.x * 0.28 - g2.y * 0.96, g2.x * 0.96 + g2.y * 0.28) * 0.4;
  // (The solver's slope as the vertex has already shaded it — its lean toward the camera, which is the lean that
  // decides how much sky a surface shows — rather than the slope again as two more numbers a vertex. @see VSOutput)
  ${L("s", f)} = (lit.a - 0.5) * 0.6;
  ${L("n", v3)} = normalize(${v3}(s + r.x * 0.06 * calm, s + r.y * 0.06 * calm, 1.0));
  // THE SKY IT MIRRORS, from the camera's side: Schlick's Fresnel, for a view thirty degrees above the ground.
  ${L("view", v3)} = ${v3}(0.6124, 0.6124, 0.5);
  ${L("fres", f)} = 0.04 + 0.96 * pow(1.0 - max(dot(n, view), 0.0), 5.0);
  ${L("refl", f)} = clamp(fres * 1.5, 0.0, 0.5) * fade;
  ${L("rz", f)} = clamp(reflect(-view, n).z, 0.0, 1.0);
  ${L("sky", v3)} = mix(${v3}(0.62, 0.74, 0.86), ${v3}(0.3, 0.5, 0.78), rz) * (1.0 - 0.55 * u.y);
  // AND THE SUN, off the facets that face it, by day.
  ${L("spec", f)} = pow(max(dot(n, normalize(${v3}(0.14, 0.24, 1.0))), 0.0), 1400.0) * 0.6 * (1.0 - u.y) * fade * (1.0 - lk.y);
  ${V("rgb", v3)} = body * a * (1.0 - refl) + sky * refl + ${v3}(1.0, 0.97, 0.9) * spec;
  a = clamp(a * (1.0 - refl) + refl + spec * 0.5, 0.0, 1.0);
  // FOAM: toward white, and closing it up. @see surfaceLook
  ${L("fa", f)} = a + (1.0 - a) * lk.y * ${FOAM_COVER} * fade;
  rgb = mix(rgb, ${v3}(0.92, 0.95, 0.96) * fa, lk.y);
  return ${v4}(rgb, fa);
}
`;
}

const FRAGMENT_WGSL = /* wgsl */ `
@group(2) @binding(14) var uShore : texture_2d<f32>;
// (The fragment is a module of its own, so it says again what it reads of the globals.)
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
// HOW THE SURFACE IS LIT this frame, one group for every band: x the water's own clock (seconds of drawn time, for
// the ripples), y how far into the night (the sun's glints go with the day). @see waterLook
struct Look { uLook: vec4<f32>, };
@group(2) @binding(15) var<uniform> look : Look;
fn shoreHash(p: vec2<f32>) -> f32 { return fract(sin(dot(p, vec2<f32>(127.1, 311.7))) * 43758.5453); }
fn shoreNoise(p: vec2<f32>) -> f32 {
  let i = floor(p); let f = fract(p); let u = f * f * (3.0 - 2.0 * f);
  return mix(mix(shoreHash(i), shoreHash(i + vec2<f32>(1.0, 0.0)), u.x), mix(shoreHash(i + vec2<f32>(0.0, 1.0)), shoreHash(i + vec2<f32>(1.0, 1.0)), u.x), u.y);
}
${lookSource("wgsl")}
${POUR_WGSL}
@fragment
fn mainFragment(@location(0) vLit: vec4<f32>, @location(1) vShore: vec4<f32>, @location(2) vLook: vec2<f32>) -> @location(0) vec4<f32> {
  let vCover = min(vShore.w, 1.0);
  var vColor = vLit;
  if (vLook.x >= 0.0) {
    vColor = waterLook(vLit, vLook, vShore.xy, look.uLook) * localUniforms.uColor * globalUniforms.uWorldColorAlpha;
  }
  {
    // POURING DOWN A ROCK FACE: the same water, running down it — streaks long down the fall line (down the
    // screen) and narrow across, falling on the water's clock, lit along them and foaming in them; off-white,
    // more as it goes down, and never a white panel. @see pouredAt, fieldCorner
    let fall = clamp((vShore.w - 1.0) / ${POUR_FLAG}, 0.0, 1.0);
    if (fall > 0.0) { vColor = pourOver(vColor, vShore.x - vShore.y, vShore.z, fall, look.uLook, 0.92); }
  }
  // AS ONE SMOOTH FIELD, THE WATER'S EDGE: along a line of how much round each point is water, soft, with a faint
  // broken line of foam. @see fieldCorner
  if (vCover < 0.999) {
    // (NOTHING, NOT A DISCARD, where there is no water: blended premultiplied, nothing leaves the pixel as it was —
    // and a shader that can discard is one the GPU cannot shade ahead of its draw order; it cost a lake half its
    // water's time.)
    if (vCover < 0.36) { return vec4<f32>(0.0); }
    var body = vColor * smoothstep(0.36, 0.46, vCover);
    let lace = (1.0 - smoothstep(0.38, 0.54, vCover)) * (0.1 + 0.3 * smoothstep(0.35, 0.7, shoreNoise(vShore.xy * 1.7 + 3.0)));
    body = mix(body, vec4<f32>(0.94, 0.97, 0.96, 1.0), lace * body.a);
    return body;
  }
  // THE SHORE: the drawn ground under this pixel — a fan from the tile's middle to its corners, as the ground's
  // mesh has it — and the water only where it is over that; clear at the very edge, with a line of foam.
  if (vShore.w < 1.5) { return vColor; }
  let cell = vec2<i32>(floor(vShore.xy));
  let c = textureLoad(uShore, vec2<i32>(cell.x * 2, cell.y), 0);
  let m = textureLoad(uShore, vec2<i32>(cell.x * 2 + 1, cell.y), 0).x;
  let f = vShore.xy - floor(vShore.xy) - 0.5;
  let t = 2.0 * max(abs(f.x), abs(f.y));
  // The two corners of the edge this pixel's triangle of the fan goes out to, and how far along it.
  var ea = c.x; var eb = c.w; var s = 0.5;
  if (abs(f.x) >= abs(f.y)) {
    s = 0.5 + f.y / max(2.0 * abs(f.x), 0.0001);
    if (f.x > 0.0) { ea = c.y; eb = c.z; }
  } else {
    s = 0.5 + f.x / max(2.0 * abs(f.y), 0.0001);
    if (f.y > 0.0) { ea = c.w; eb = c.z; } else { eb = c.y; }
  }
  let deep = vShore.z - (m + t * (mix(ea, eb, s) - m));
  if (deep <= 0.0) { return vec4<f32>(0.0); }  // (Nothing, not a discard: as at the field's edge.)
  // How far from the waterline, in tiles along the ground: the depth over how fast that triangle falls.
  let out = deep / max(length(vec2<f32>(ea + eb - 2.0 * m, eb - ea)), 0.05);
  var col = vColor * mix(0.4, 1.0, smoothstep(0.0, 0.25, deep));
  // A thin line of it, and broken: here and there, not a white rim round every bank.
  let patchy = smoothstep(0.35, 0.7, shoreNoise(vShore.xy * 1.7 + 3.0));
  let reach = 0.012 + 0.02 * shoreNoise(vShore.xy * 9.0 + 7.0);
  let foam = (1.0 - smoothstep(reach * 0.5, reach, out)) * (1.0 - smoothstep(0.08, 0.2, deep)) * (0.12 + 0.4 * patchy);
  col = mix(col, vec4<f32>(0.94, 0.97, 0.96, 1.0), foam);
  return col;
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
// A surface, shaded per pixel as water — see the WGSL twin's vLook — and where on the ground it is.
out vec2 vLook;
out vec2 vPos;

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
// How fouled each tile's water is. See the WGSL twin's uPollution.
uniform sampler2D uPollution;

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
float dryDepth() { return uBand.z; }
// Is there water here — see the WGSL twin. After dryDepth: GLSL, unlike
// WGSL, wants a function defined before anything calls it.
bool wet(float d) { return d > dryDepth(); }
int bitOf(int k) { return 1 << k; }
int bitAt(int m, int k) { return (m >> k) & 1; }
// Whether the brink texture was filled this frame. See brink-gpu.
bool brinkOn() { return uSlots.z > 0.5; }
// (The water as one smooth field is the device's: here a dry column draws nothing. @see quad-rule's skirtAt)
bool skirtOn() { return false; }
bool onePiece(float g, float gq) { return abs(g - gq) < ${PIECE}; }
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

// Slop in the water. The WGSL twin's fouled.
vec3 fouled(vec3 rgb, int cx, int cy, int a) {
  if (a != 0) return rgb;
  float k = texelFetch(uPollution, ivec2(cx / ${COLUMNS_PER_TILE}, cy / ${COLUMNS_PER_TILE}), 0).r;
  float lum = dot(rgb, vec3(0.3, 0.59, 0.11));
  return mix(rgb, vec3(${MUD_GL}) * (0.7 + lum * 0.8), k * ${FOUL_MOST});
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
  p.colour = fouled(aerated(mat, 0.08 + pace(cx, cy, d, a) * 0.14), cx, cy, a);
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
  vLook = vec2(-1.0, 0.0);
  vPos = vec2(0.0);
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
  if ((roofAt(ocx, ocy, a) < ${OPEN_SKY}.0) != roofedTier()) { return; }
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
    int mat = int(texelFetch(uMaterial, ivec2(cx, slotRow(cy, a)), 0).r * 255.0 + 0.5);
    rgb = fouled(texelFetch(uTint, ivec2(0, mat), 0).rgb, cx, cy, a);
    alpha = clamp(lit, 0.0, 1.0);
    vLook = vec2(cd, foam);
    vPos = vec2(fx + 0.5, fy + 0.5);
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
  // (A surface's colour is finished per pixel. See the WGSL twin.)
  vColor = vLook.x >= 0.0 ? vec4(rgb, alpha) : vec4(rgb * alpha, alpha) * uColor * uWorldColorAlpha;
}
`;

const FRAGMENT_GLSL = /* glsl */ `#version 300 es
precision highp float;
in vec4 vColor;
in vec2 vLook;
in vec2 vPos;
uniform vec4 uColor;
uniform vec4 uWorldColorAlpha;
uniform vec4 uLook;
out vec4 finalColor;
${lookSource("glsl")}
void main() {
  finalColor = vLook.x >= 0.0 ? waterLook(vColor, vLook, vPos, uLook) * uColor * uWorldColorAlpha : vColor;
}
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
  // (As one module: the shore texture is declared once, not once a stage.)
  wgsl: WGSL + FRAGMENT_WGSL.replace("@group(2) @binding(14) var uShore : texture_2d<f32>;", "")
    .replace(/struct GlobalUniforms \{[^}]*\};\n@group\(0\)[^\n]*\n/, "")
    .replace(/struct LocalUniforms \{[^}]*\};\n@group\(1\)[^\n]*\n/, ""),
  glsl: VERTEX_GLSL + FRAGMENT_GLSL,
});

export type GpuWaterLayer = {
  meshes: Mesh<Geometry, Shader>[];
  /** How fouled each tile's water is, and the count of its changes last sent up. @see world/water/pollution */
  fouled: { src: BufferImageSource; of: Pollution; sent: number };
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
  /** Each corner of the smooth field, worked out once, and how wide and how many its rows are. @see cornerTableSource */
  corner: Buffer;
  cornerRow: number;
  cornerRows: number;
  /** And where a corner is each column's own, four entries a corner. @see SPARE_CORNERS */
  cornerSpare: Buffer;
  /** The deck table, and which quad each of its slots is. @see deckCorner */
  deck: Buffer;
  deckAt: Buffer;
  /** Whether the meshes are told to read it. @see drawGpuWater */
  tableOn: number;
  /** Whether the bands draw with the slim program. @see SLIM */
  slimOn: boolean;
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
  /** How the surface is lit, shared by every band, and the water's own clock it carries. @see waterLook */
  look: UniformGroup;
  lookT: number;
  /** The ground revision the texture holds, and of which field. @see ColumnField.groundRev */
  groundSent: number;
  groundOf: ColumnField | null;
  /**
   * THE BRINK'S ARRAY, and who fills it. The device's brink pass when there
   * is one; otherwise the host, once a frame, so the vertex shader reads it
   * rather than scanning for it per vertex. @see fillBrinkOnHost
   */
  brink: { data: Float32Array; byDevice: boolean; hostOn: boolean };
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
const BYTE_FIELDS = ["uTint", "uMaterial", "uFalling", "uPollution"];
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
  // The drawn ground, read by the vertex stage (is this tile a shelf) and the fragment (where the shore cuts it).
  own.push({
    binding: 1 + FLOAT_FIELDS.length + BYTE_FIELDS.length + UINT_FIELDS.length, visibility: VERTEX_STAGE | FRAGMENT_STAGE,
    texture: { sampleType: "unfilterable-float", viewDimension: "2d", multisampled: false },
  });
  // How the surface is lit this frame, one group shared by every band. @see waterLook
  own.push({ binding: 2 + FLOAT_FIELDS.length + BYTE_FIELDS.length + UINT_FIELDS.length, visibility: FRAGMENT_STAGE, buffer: { type: "uniform" } });
  // The corner table and its spare, after the look: the corner pass's own buffers, read where it wrote them.
  // @see cornerTableSource
  for (const k of [3, 4, 5, 6]) {
    own.push({
      binding: k + FLOAT_FIELDS.length + BYTE_FIELDS.length + UINT_FIELDS.length, visibility: VERTEX_STAGE,
      buffer: { type: "read-only-storage" },
    });
  }
  return [[uniform(0)], [uniform(0)], own];
}

/** Which group each named resource belongs to — the other half Pixi infers. */
function nameLayout(): Record<string, number>[] {
  const own: Record<string, number> = { water: 0 };
  [...FLOAT_FIELDS, ...BYTE_FIELDS, ...UINT_FIELDS, "uShore", "look", "uCorner", "uCornerX", "uDeck", "uDeckAt"]
    .forEach((n, k) => { own[n] = 1 + k; });
  return [{ globalUniforms: 0 }, { localUniforms: 0 }, own];
}

let shared: { gpu: GpuProgram; slim: GpuProgram; gl: GlProgram } | null = null;
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
      // (The same, with everything but the field's surface and the rare table's quads compiled out. @see SLIM)
      slim: new GpuProgram({
        vertex: { source: WGSL.replace("const SLIM = false;", "const SLIM = true;"), entryPoint: "mainVertex" },
        fragment: { source: FRAGMENT_WGSL, entryPoint: "mainFragment" },
        name: "water-surface-slim",
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
export function createGpuWaterLayer(columns: ColumnField, bands: BandLayer, scale = 1, shore?: BufferImageSource): GpuWaterLayer {
  // (With no ground to cut to — a second storey's water, a test — a texture that says nowhere is a shore.)
  const shoreTex = shore ?? new BufferImageSource({ resource: new Float32Array(8), width: 2, height: 1, format: "rgba32float", scaleMode: "nearest" });
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
  // HOW HARD EACH SLOT IS LEAVING. Filled by the device's brink pass once a
  // frame where there is a device, and by the host where there is not.
  // @see brink-gpu, fillBrinkOnHost
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
  // HOW FOULED EACH TILE'S WATER IS, sent up when it changes. @see world/water/pollution
  const fouledOf = pollutionOf(columns);
  const fouledTex = new BufferImageSource({
    resource: fouledOf.level, width: fouledOf.w, height: fouledOf.h, format: "r8unorm", scaleMode: "nearest",
  });
  // WHICH QUADS EACH BAND DRAWS. The identity until something gathers it.
  // @see quadList
  const list = quadList(bands.w, bands.h, layers);
  const quads = quadListSource(list);
  // An entry a corner of the columns.
  const cornerRow = nx + 1;
  // (Buffers the corner pass writes and the meshes read, as they are: storage on the device, nothing on the host.)
  const cornerTex = new Buffer({
    data: new Uint32Array(cornerRow * (ny + 1) * 4), usage: BufferUsage.STORAGE | BufferUsage.COPY_DST,
  });
  const spareTex = new Buffer({
    data: new Uint32Array(SPARE_CORNERS * 4 * 4), usage: BufferUsage.STORAGE | BufferUsage.COPY_DST,
  });
  const deckTex = new Buffer({
    data: new Uint32Array((RARE_AT + DECK_SLOTS * 16) * 4), usage: BufferUsage.STORAGE | BufferUsage.COPY_DST,
  });
  const deckAtTex = new Buffer({
    data: new Uint32Array(DECK_SLOTS), usage: BufferUsage.STORAGE | BufferUsage.COPY_DST,
  });

  const meshes: Mesh<Geometry, Shader>[] = [];
  const under: Mesh<Geometry, Shader>[] = [];
  // ONE for every band, so a frame's clock is one upload and not one a band. @see waterLook
  const look = waterLookGroup;
  // (And how big a tile and a height unit are on the layer, for the falls' sheets, which have only pixels. @see pourOver)
  {
    const lk = look.uniforms.uLook as Float32Array;
    lk[2] = 1 / (HW * scale); lk[3] = 1 / (HEIGHT_UNIT * scale);
    look.update();
  }
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
      uList: { value: new Float32Array([list.offsets[b], LIST_W, fieldWater() ? 1 : 0, groundMode() === "smooth" ? 1 : 0]), type: "vec4<f32>" },
      // HOW MANY STOREYS a column has, and the spare. @see ColumnField.layers
      //
      // LAST, because the struct it fills says last. Pixi lays a uniform group
      // out in the order the fields are written here and the shader reads it
      // by offset, so a field inserted in the middle of one and appended to
      // the other is every field after it reading its neighbour's numbers.
      // What that looked like was a storey count of 66 — the scaled half-width
      // out of uIso — and a map with no water drawn on it at all.
      uSlots: { value: new Float32Array([layers, 0, 0, 0]), type: "vec4<f32>" },
      // AND THE CORNER TABLE: whether to read it, and its row width. Last, after uSlots, as the struct has it.
      uTable: { value: new Float32Array([0, cornerRow, 0, 0]), type: "vec4<f32>" },
    // (Static: sent when one of its numbers is written and said so — `update()`, as every writer below does — and
    // not at every draw of the band, every frame, to say the same again.)
    }, { isStatic: true });

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
        uTint: tint, uMaterial: material, uFalling: fallingTex, uPollution: fouledTex, uQuads: quads, uShore: shoreTex, look, uCorner: cornerTex, uCornerX: spareTex, uDeck: deckTex, uDeckAt: deckAtTex,
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
      uList: { value: new Float32Array([list.second + list.offsets[b], LIST_W, fieldWater() ? 1 : 0, groundMode() === "smooth" ? 1 : 0]), type: "vec4<f32>" },
      uSlots: { value: new Float32Array([layers, 1, 0, 0]), type: "vec4<f32>" },
      uTable: { value: new Float32Array([0, cornerRow, 0, 0]), type: "vec4<f32>" },
    }, { isStatic: true });
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
        uTint: tint, uMaterial: material, uFalling: fallingTex, uPollution: fouledTex, uQuads: quads, uShore: shoreTex, look, uCorner: cornerTex, uCornerX: spareTex, uDeck: deckTex, uDeckAt: deckAtTex,
      },
    });
    const underMesh = new Mesh<Geometry, Shader>({ geometry: underGeom, shader: underShader });
    underMesh.eventMode = "none";
    bands.underOf[b].addChild(underMesh);
    under.push(underMesh);
  }

  return {
    meshes,
    fouled: { src: fouledTex, of: fouledOf, sent: fouledOf.rev },
    underIdle: new Uint16Array(meshes.length),
    under,
    faces: 1,
    sources: [depth, ground, washTex, foamTex, fx, fy, material, roof, brinkTex, fallingTex],
    // THE SHADE RAMP, kept on the layer because the falls colour from it too:
    // a sheet and the surface it leaves are the same water, so they read the
    // same table. @see createSheet
    tint,
    look, lookT: 0,
    quads,
    corner: cornerTex, cornerRow, cornerRows: ny + 1, cornerSpare: spareTex, deck: deckTex, deckAt: deckAtTex, tableOn: 0, slimOn: false,
    wash, foam, layers, gather: null, fed: new Set(),
    groundSent: -1,
    groundOf: null,
    brink: { data: brinkF32, byDevice: false, hostOn: false },
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
 * And the brink, which the DEVICE fills where there is one, and the host
 * where there is not.
 *
 * Not in {@link FED} because that table is about what `copyOut` moves off the
 * solver's own field buffer, and this comes out of a pass of its own. The
 * upload loop sends it only when the host filled it: with a device pass, the
 * array behind it is zeros, and sending those up would overwrite the only
 * copy that means anything. @see createBrinkPass, fillBrinkOnHost
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
  /**
   * WHICH GATHERING THE COUNTS DESCRIBE, and which this frame's is: the bands
   * it took in and whether flat tiles were whole.
   *
   * A count is a frame or two old, which is fine while the gathering it came
   * from is the one running — a band grows a little, and the pad covers it.
   * It is not fine when the gathering CHANGED: a band that has just come on
   * screen was not gathered, so its count is nought, and a band crossing the
   * whole-tile cutoff needs sixteen times the quads it had. Drawn off that
   * count, the water blinked out on every quick zoom and came back when the
   * readback did. Such a band draws everything it could hold instead — empty
   * slots draw nothing — until a count from a gathering like this one lands.
   * @see trusted
   */
  now: GatherKey | null;
  took: GatherKey | null;
  sent: GatherKey | null;
  counted: GatherKey | null;
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
  /** The pass that works each corner of the smooth field out once. @see cornerTableSource */
  corners: CornerPass | null;
};

/**
 * THE CORNER TABLE'S PASS: the vertex shader's own text with an entry point added, bound to the very textures the
 * meshes read, writing a texel a corner into a buffer that is copied into the meshes' table. @see cornerTableSource
 */
type CornerPass = {
  encode: (enc: GPUCommandEncoder, columns: ColumnField) => void;
  destroy: () => void;
  out: GPUBuffer;
  /** Which corners to work out, marked by the gathering. Cleared before it. */
  need: GPUBuffer;
  /** The deck quads the gathering gives slots, and how many. Its count cleared before it. @see deckCorner */
  decks: { at: GPUBuffer; meta: GPUBuffer };
};

let cornerModule: {
  device: GPUDevice; pipeline: GPUComputePipeline; rest: GPUComputePipeline; rare: GPUComputePipeline;
  layout: GPUBindGroupLayout;
} | null = null;

function createCornerPass(
  device: GPUDevice, wl: GpuWaterLayer, get: (s: TextureSource) => GPUTexture, gpuBuffer: (b: Buffer) => GPUBuffer,
): CornerPass {
  if (!cornerModule || cornerModule.device !== device) {
    const entries: GPUBindGroupLayoutEntry[] = [
      { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: "uniform" } },
    ];
    const tex = (binding: number, sampleType: GPUTextureSampleType) => entries.push({
      binding, visibility: GPUShaderStage.COMPUTE, texture: { sampleType, viewDimension: "2d" },
    });
    FLOAT_FIELDS.forEach((_, k) => tex(1 + k, "unfilterable-float"));
    BYTE_FIELDS.forEach((_, k) => tex(1 + FLOAT_FIELDS.length + k, "float"));
    UINT_FIELDS.forEach((_, k) => tex(1 + FLOAT_FIELDS.length + BYTE_FIELDS.length + k, "uint"));
    tex(1 + FLOAT_FIELDS.length + BYTE_FIELDS.length + UINT_FIELDS.length, "unfilterable-float");
    for (const b of [20, 21, 22, 23, 24, 25, 26, 28]) entries.push({ binding: b, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } });
    const layout = device.createBindGroupLayout({ entries, label: "water corners" });
    const empty = device.createBindGroupLayout({ entries: [], label: "water corners (none)" });
    const module = device.createShaderModule({ code: cornerTableSource(), label: "water corners" });
    void module.getCompilationInfo?.().then((info) => {
      for (const m of info.messages) {
        if (m.type === "info") continue;
        console.error(`WATER: the corner table shader, line ${m.lineNum}: ${m.message}`);
      }
    }).catch(() => { /* older implementations have no compilation info */ });
    const pipeline = device.createComputePipeline({
      label: "water corners",
      layout: device.createPipelineLayout({ bindGroupLayouts: [empty, empty, layout] }),
      compute: { module, entryPoint: "cornerTable" },
    });
    const rest = device.createComputePipeline({
      label: "water corners rest",
      layout: device.createPipelineLayout({ bindGroupLayouts: [empty, empty, layout] }),
      compute: { module, entryPoint: "cornerRest" },
    });
    const rare = device.createComputePipeline({
      label: "water rare quads",
      layout: device.createPipelineLayout({ bindGroupLayouts: [empty, empty, layout] }),
      compute: { module, entryPoint: "rareTable" },
    });
    cornerModule = { device, pipeline, rest, rare, layout };
  }
  const { pipeline, rest, rare, layout } = cornerModule;
  const nx = (wl.sources[0] as unknown as { width: number }).width;
  const ny = wl.cornerRows - 1;
  const uniform = device.createBuffer({
    size: 96, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST, label: "water corners say",
  });
  const out = gpuBuffer(wl.corner);
  const spare = gpuBuffer(wl.cornerSpare);
  const need = device.createBuffer({
    size: wl.cornerRow * (ny + 1) * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    label: "water corners needed",
  });
  const spareN = device.createBuffer({
    size: 16, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST, label: "water corners spare count",
  });
  const spareAt = device.createBuffer({
    size: SPARE_CORNERS * 4, usage: GPUBufferUsage.STORAGE, label: "water corners spare at",
  });
  const deckOut = gpuBuffer(wl.deck);
  const deckAt = gpuBuffer(wl.deckAt);
  const deckMeta = device.createBuffer({
    size: 16 + DECK_SLOTS * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST, label: "water decks",
  });
  const say = new Float32Array(24);
  const names = [...FLOAT_FIELDS, ...BYTE_FIELDS, ...UINT_FIELDS, "uShore"];
  return {
    encode: (enc) => {
      const m = wl.meshes[0];
      if (!m) return;
      const res = m.shader!.resources as Record<string, unknown>;
      const u = (res.water as UniformGroup).uniforms as Record<string, Float32Array>;
      say.set(u.uGrid, 0); say.set(u.uIso, 4); say.set(u.uBand, 8); say.set(u.uList, 12); say.set(u.uSlots, 16);
      say.set([1, wl.cornerRow, 0, 0], 20);
      device.queue.writeBuffer(uniform, 0, say);
      // (Bound afresh each frame: a texture Pixi re-creates — the ground's, when the map is edited — would leave a
      // group made once reading the old one.)
      const group = device.createBindGroup({
        layout,
        entries: [
          { binding: 0, resource: { buffer: uniform } },
          ...names.map((n, k) => ({ binding: 1 + k, resource: get(res[n] as TextureSource).createView() })),
          { binding: 20, resource: { buffer: out } },
          { binding: 21, resource: { buffer: spare } },
          { binding: 22, resource: { buffer: spareN } },
          { binding: 23, resource: { buffer: spareAt } },
          { binding: 24, resource: { buffer: need } },
          { binding: 25, resource: { buffer: deckAt } },
          { binding: 26, resource: { buffer: deckMeta } },
          { binding: 28, resource: { buffer: deckOut } },
        ],
      });
      enc.clearBuffer(spareN);
      const writes = stampsNow()?.take("corners");
      const pass = enc.beginComputePass(writes ? { label: "corners", timestampWrites: writes } : { label: "corners" });
      pass.setPipeline(pipeline);
      pass.setBindGroup(2, group);
      pass.dispatchWorkgroups(Math.ceil((nx + 1) / CORNER_WG), Math.ceil((ny + 1) / CORNER_WG));
      pass.setPipeline(rest);
      pass.dispatchWorkgroups(SPARE_WG + DECK_WG);
      pass.setPipeline(rare);
      pass.dispatchWorkgroups(RARE_WG);
      pass.end();
    },
    destroy: () => { uniform.destroy(); need.destroy(); spareN.destroy(); spareAt.destroy(); deckMeta.destroy(); },
    out, need, decks: { at: deckAt, meta: deckMeta },
  };
}

/** Just enough of the renderer to ask what stands behind a texture source. */
type GetGpu = { texture: { getGpuSource: (s: TextureSource) => GPUTexture } };

/**
 * The bands a gathering took in, the tiles across the screen it took, and
 * whether flat tiles were whole. @see QuadGather.now
 */
type GatherKey = { lo: number; hi: number; from: number; to: number; whole: boolean };

/**
 * Whether band b's count can be drawn from: it came from a gathering that
 * covered everything THIS FRAME'S GATHERING took of the band — the band and
 * at least as much of its width — with flat tiles the same way. Not merely
 * what is on screen: a band draws the first so many entries of its list, in
 * order along the band, and a list gathered wider than the count's has more
 * of them, so what is on screen can sit past the count. A count off a wider
 * gathering is safe: it draws a few empty slots. @see QuadGather.now
 */
const trusted = (g: QuadGather, b: number) => {
  const c = g.counted, t = g.took;
  return c !== null && t !== null && c.whole === t.whole
    && b >= c.lo && b <= c.hi && b >= t.lo && b <= t.hi
    && c.from <= t.from && c.to >= t.to;
};

/** Tiles of band b whose x across the screen (tx - ty) lies in [from, to]. */
const tilesAcross = (b: number, from: number, to: number, w: number, h: number) => {
  // tx = (b + a) / 2, ty = (b - a) / 2: a must share b's parity, and both
  // must land on the map — which bounds a to [b - 2(h-1), b] and [-b, 2(w-1) - b].
  let lo = Math.max(from, -b, b - 2 * (h - 1));
  let hi = Math.min(to, b, 2 * (w - 1) - b);
  if (!Number.isFinite(lo)) lo = Math.max(-b, b - 2 * (h - 1));
  if (!Number.isFinite(hi)) hi = Math.min(b, 2 * (w - 1) - b);
  lo = Math.ceil(lo); hi = Math.floor(hi);
  if (((lo - b) % 2 + 2) % 2 !== 0) lo++;
  if (((hi - b) % 2 + 2) % 2 !== 0) hi--;
  return hi < lo ? 0 : (hi - lo) / 2 + 1;
};

/**
 * THE MOST band b's list can hold this frame, when its count is from a
 * different gathering — instead of everything the band could ever hold.
 *
 * That was the fallback, and zooming OUT is a fallback on nearly every band on
 * every frame: the view keeps widening past the last gathering. On a 128 tile
 * map that drew 4.3 million instances a frame and took the GPU to 20 ms,
 * where zooming in drew 0.23 million. But a list can only have grown by the
 * tiles this frame's gathering took that the counted one did not, and a tile
 * holds at most `perTile` quads — so the count plus that is a bound, and a
 * tight one for a zoom a few tiles a frame. Going to whole tiles only ever
 * removes surfaces, so a count from columns bounds it; going back to columns,
 * each counted tile can regain the fifteen surfaces its whole quad stood in
 * for, and no more. @see trusted
 */
const boundFor = (
  g: QuadGather, b: number, count: number, w: number, h: number,
  perTile: number, unwhole: number, most: number,
) => {
  const c = g.counted, t = g.took;
  if (c === null || t === null) return most;
  const inC = b >= c.lo && b <= c.hi;
  const all = tilesAcross(b, t.from, t.to, w, h);
  const kept = inC
    ? tilesAcross(b, Math.max(t.from, c.from), Math.min(t.to, c.to), w, h)
    : 0;
  // AND OUT OF WHOLE TILES, each tile it counted can grow by the surfaces a
  // whole tile stood in for — only surfaces: the faces are the same either
  // way. Everything the band could hold was the fallback here, and it is the
  // one a zoom IN crosses: 4 million instances for a frame. @see unwhole
  const regrown = c.whole && !t.whole ? kept * unwhole : 0;
  return Math.min(most, (inC ? count : 0) + (all - kept) * perTile + regrown);
};

/**
 * How much wider than the screen the gathering reaches, as a share of what is
 * on it, each side. A zoom that stays inside it keeps drawing off its counts;
 * one that leaves it draws everything until a count catches up. @see trusted
 */
const GATHER_REACH = 0.25;

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
  // THE CORNER TABLE'S PASS, where the renderer can hand over the buffers it reads. @see cornerTableSource
  const bufs = (renderer as { buffer?: { getGPUBuffer?: (b: Buffer) => GPUBuffer } }).buffer;
  const corners = typeof bufs?.getGPUBuffer === "function"
    ? createCornerPass(device, wl, get, bufs.getGPUBuffer.bind(bufs)) : null;
  pass.bind(
    depthView, groundView, roofView, brinkView, fallingView, corners?.need ?? null, wl.cornerRow,
    corners ? { ...corners.decks, slots: DECK_SLOTS, field: fieldWater() } : null,
  );
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
    wl.brink.byDevice = true;
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
    now: null, took: null, sent: null, counted: null,
    watch: 4,
    brink,
    list,
    corners,
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
  // WHAT THIS FRAME NEEDS, and a GATHERING WIDER THAN IT, so a count from a
  // frame or two back still covers a view that has moved since. @see trusted
  const all = { lo: -Infinity, hi: Infinity, from: -Infinity, to: Infinity };
  const need = cull && cull.lo !== undefined && cull.hi !== undefined
    ? { lo: cull.lo, hi: cull.hi, from: cull.from, to: cull.to }
    : cull ? { ...all, from: cull.from, to: cull.to } : all;
  const wide = (lo: number, hi: number) => {
    const m = Number.isFinite(lo) ? Math.ceil((hi - lo) * GATHER_REACH) : 0;
    return [lo - m, hi + m];
  };
  const [glo, ghi] = wide(need.lo, need.hi);
  const [gfrom, gto] = wide(need.from, need.to);
  const reach = cull
    ? { from: gfrom, to: gto, ...(Number.isFinite(glo) ? { lo: glo, hi: ghi } : {}) }
    : null;
  g.pass.say(
    columns.nx, columns.ny, COLUMNS_PER_TILE, h,
    columns.params.dryDepth, FALL_MIN, faces, columns.layers,
    g.brink !== null, g.layer.latchOn === 1, zoomedOut, reach, cheap,
  );
  g.now = { ...need, whole: zoomedOut };
  // What the gathering took in, which is what its counts will describe —
  // the shader's band range carries BAND_MARGIN on top. @see quads-gpu
  g.took = {
    lo: glo - BAND_MARGIN, hi: ghi + BAND_MARGIN, from: gfrom, to: gto, whole: zoomedOut,
  };
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
  if (g.corners) { enc.clearBuffer(g.corners.need); enc.clearBuffer(g.corners.decks.meta, 0, 16); }
  g.pass.encode(enc, columns.nx * columns.ny * columns.layers);
  g.corners?.encode(enc, columns);
  enc.copyBufferToTexture(
    { buffer: g.pass.list, bytesPerRow: LIST_W * 4, rowsPerImage: g.list.rows },
    { texture: g.into },
    { width: LIST_W, height: g.list.rows, depthOrArrayLayers: 1 },
  );
  if (!g.busy) {
    enc.copyBufferToBuffer(
      g.pass.counts, 0, g.staging, 0, g.count.length * 4,
    );
    g.sent = g.took;
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
    g.counted = g.sent;
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
  g.corners?.destroy();
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
 * THE BRINK SCAN, ON THE HOST, into the array the brink texture reads: every
 * wet slot's, once a frame, by the same rule the device's brink pass runs.
 *
 * WebGL has no pass to run it in, so its vertex shader scanned for the brink
 * itself — four ways, three columns out, through every slot over there — and
 * asked it once per contributor of every corner of every vertex. That was the
 * GPU's whole frame on the WebGL path: a Large map stood at 13 fps in Firefox
 * without WebGPU and 32 with the brink read as nought (2026-11-08). Only wet
 * slots are ever asked for theirs, so only those are worked out; a dry slot's
 * stale value is never read. @see brinkRuleSource, BRINK_AT
 */
export function fillBrinkOnHost(out: Float32Array, columns: ColumnField) {
  const { nx, ny, layers, ground, depth, roof } = columns;
  const cells = nx * ny, dry = columns.params.dryDepth;
  for (let a = 0; a < layers; a++) {
    const base = a * cells;
    for (let i = 0; i < cells; i++) {
      if (depth[base + i] <= dry) continue;
      out[base + i] = brinkOnHost(nx, ny, i, ground, depth, dry, FALL_MIN, base, roof);
    }
  }
}

/**
 * A frame: step the two carried fields, then say the textures have changed.
 *
 * That is the whole of it. There are no corners to average and no vertices to
 * write, because the vertex shader does both — so what is left on the CPU is
 * the simulation's own work and six calls to mark a texture dirty.
 */
/** How far into the night it is, 0 by day and 1 at its darkest: the sun's glints on the water go with the day. */
let waterNight = 0;
export function setWaterNight(n: number) { waterNight = Math.max(0, Math.min(1, n)); }

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
  // AND WHETHER THE CORNER TABLE IS FILLED, which it is when the gathering's pass made it this frame from the
  // textures the device has filled — not on the host's path, where they go up after it and it would be a frame
  // behind the rest of the mesh. @see cornerTableSource
  const table = carried && wl.gather?.corners && wl.gather.gathered ? 1 : 0;
  // AND WITH IT, AS ONE SMOOTH FIELD, THE SLIM DRAW: every quad but the surface is in the rare table then. @see SLIM
  const slim = table === 1 && fieldWater() && groundMode() === "smooth";
  if (wl.tableOn !== table || wl.slimOn !== slim) {
    wl.tableOn = table;
    wl.slimOn = slim;
    const { gpu, slim: slimGpu } = programs();
    for (const m of [...wl.meshes, ...wl.under]) {
      const grp = m.shader?.resources.water as UniformGroup | undefined;
      if (!grp || !m.shader) continue;
      (grp.uniforms.uTable as Float32Array)[0] = table;
      grp.update();
      m.shader.gpuProgram = slim ? slimGpu : gpu;
    }
  }
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
  // THE BRINK, ON THE HOST, where no device pass fills it. @see fillBrinkOnHost
  if (!wl.brink.byDevice) {
    fillBrinkOnHost(wl.brink.data, columns);
    if (!wl.brink.hostOn) {
      wl.brink.hostOn = true;
      for (const m of [...wl.meshes, ...wl.under]) {
        const grp = m.shader?.resources.water as UniformGroup | undefined;
        if (!grp) continue;
        (grp.uniforms.uSlots as Float32Array)[2] = 1;
        grp.update();
      }
    }
  }
  // THE SURFACE'S CLOCK, by the frame's own step (so a bench or a comparison draws the same frame every time),
  // and how far into the night it is. @see waterLook
  wl.lookT = (wl.lookT + Math.max(0, dt)) % 3600;
  const lk = wl.look.uniforms.uLook as Float32Array;
  if (lk[0] !== wl.lookT || lk[1] !== waterNight) {
    lk[0] = wl.lookT; lk[1] = waterNight;
    wl.look.update();
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
    // THE BRINK ONLY WHERE THE HOST FILLED IT. @see BRINK_AT
    if (k === BRINK_AT && wl.brink.byDevice) continue;
    if (carried && wl.fed.has(k)) continue;
    // NOR A LATCH THE DEVICE IS NOT COPYING OUT: the host's copy is not the
    // solver's then, and the shaders have been told not to read it.
    if (carried && k === FALLING_AT) continue;
    // THE GROUND AND THE ROOFS ONLY WHEN THEY MOVE, on either path: both are
    // written by `syncGround`, which bumps the revision, and never by the
    // solver. With the device filling the rest, this loop was uploading the
    // terrain and nothing else — a quarter of a megabyte a frame to say what
    // it said last frame; on the CPU path, where everything else does change,
    // it was two of the uploads that made WebGL's `texSubImage2D` a third of
    // the frame (2026-11-08). A field REPLACED starts its revision again, so
    // the field is asked after too. @see syncGround
    if ((k === GROUND_AT || k === ROOF_AT) && columns === wl.groundOf && columns.groundRev === wl.groundSent) {
      continue;
    }
    wl.sources[k].update();
  }
  wl.groundSent = columns.groundRev;
  wl.groundOf = columns;
  // THE FOULING, when it has changed: a byte a tile, a few times a second at most.
  if (wl.fouled.of.rev !== wl.fouled.sent) { wl.fouled.src.update(); wl.fouled.sent = wl.fouled.of.rev; }
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
  // WHERE THERE IS WATER, which decides whether a band's mesh is shown, and
  // WHAT IS ON SCREEN, which decides only how many quads it draws. They were
  // one range and both went into `visible` — structural, so every band the
  // view crossed while zooming rebuilt the render group it is in. A count of
  // nought is not structural. @see BandLayer.chunks
  let lo = 0, hi = -1;                            // nothing wet: nothing draws
  if (region) {
    const tile = (c: number) => Math.floor(c / COLUMNS_PER_TILE);
    lo = tile(region.x0) + tile(region.y0);
    hi = tile(region.x1) + tile(region.y1);
  }
  const vlo = bands.visibleLo, vhi = bands.visibleHi;
  // The most quads one tile can put in a band's list. @see boundFor
  const perTile = COLUMNS_PER_TILE * COLUMNS_PER_TILE * PARTS * wl.layers;
  // And the surfaces a whole tile stands in for, going back to columns.
  const unwhole = (COLUMNS_PER_TILE * COLUMNS_PER_TILE - 1) * wl.layers;
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
    // AND EVERYTHING, where the count is from a different gathering. @see trusted
    const onScreen = b >= vlo && b <= vhi;
    // Off a count from another gathering, the most its list can now hold.
    // @see boundFor
    const n = !onScreen ? 0 : g && g.gathered
      ? roomFor(
        trusted(g, b) ? g.count[b] : boundFor(g, b, g.count[b], bands.w, bands.h, perTile, unwhole, wl.most[b]),
        g.grew[b], wl.most[b],
      )
      : wl.most[b];
    wl.meshes[b].geometry.instanceCount = Math.min(n, instanceCap);
    // Only on a change: visibility is structural, and flipping it every frame
    // makes the renderer rebuild the scene's instruction list every frame.
    if (wl.meshes[b].visible !== show) wl.meshes[b].visible = show;
    const u = wl.under[b];
    if (u) {
      const B = wl.meshes.length;
      u.geometry.instanceCount = !onScreen ? 0 : Math.min(instanceCap, g && g.gathered
        ? roomFor(
          trusted(g, b) ? g.count[B + b]
            : boundFor(g, b, g.count[B + b], bands.w, bands.h, perTile, unwhole, wl.most[b]),
          g.grew[B + b], wl.most[b],
        )
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
        // A count from a different gathering says nothing about this one:
        // shown, as it would be ungathered. @see trusted
        holdShown(u, !trusted(g, b) || g.count[B + b] > 0 || g.grew[B + b] > 0, wl.underIdle, b);
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
