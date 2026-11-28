/**
 * World v2 — THE NIGHT'S OWN LIGHT, worked out on the map. A SPIKE.
 *
 * The night was one colour multiplied over the whole screen, and the town's lamps and windows soft sprites added
 * on top of it: light that no wall stops, that lights nothing, and that is the same whichever way a street runs.
 * Here the light is worked out in the map's own plane — a texture a few texels a tile, as the ground's shade is —
 * by RADIANCE CASCADES (Sannikov): every lamp and lit building an emitter, every building a wall, and
 * the cost the same for one light as for a thousand. The night's colour is then laid over the screen through
 * that texture: dark where no light comes, lifted toward day where it does.
 *
 * THE CASCADES. Cascade `i` has a probe every `s0·2^i` texels, each looking `4^(i+1)` ways along the stretch from
 * `l0·(4^i − 1)/3` to four times as far on: near a light, many places and few directions; far from it, few
 * places and many — which is all a shadow's edge asks for. From the furthest cascade inward each takes what its
 * rays found and, where they found no wall, what the cascade beyond it saw on along them.
 *
 * WHAT IT IS NOT, YET. It is flat: a wall is whatever stands taller than a lamp, and stops all light or none.
 * It lights the ground's plane, so what stands on the ground takes the light of the ground behind it. Buildings
 * and cars are not lit by it as themselves. WebGPU only; without it, or switched off, the night is as it was.
 * @see light.ts, ground-mesh castGround, lights.ts lightsOf
 */
import { BufferImageSource, Buffer, BufferUsage, Geometry, GpuProgram, Mesh, Shader, UniformGroup, type Container, type Renderer, type TextureSource } from "pixi.js";
import { HH, HW } from "../iso";

/** What the spike can be asked for, live. @see setGi */
export type GiOptions = {
  /** Whether the light is worked out at all — it is, unless turned off: off, the night is the flat grade and the glows it always was. */
  on: boolean;
  /** How many cascades: 3 look as far as any light carries (@see REACH); more find nothing further at two quarter-tiles between probes, and are for one. */
  cascades: 3 | 4 | 5;
  /** Quarter-tiles between the nearest cascade's probes: 1 is finer and four times the work of 2. */
  spacing: 1 | 2;
  /** Whether lit buildings show their own windows lit, each by its hours. @see lit-windows */
  floors: boolean;
  /** Whether the water gives the light back as streaks of its own: off, as the water mirrors what is drawn, day and night. @see mirror */
  water: boolean;
  /** How many heights the light is worked out at: 1, the ground alone; 4, up a tower's side. @see LAYER_HEIGHTS */
  layers: 1 | 2 | 4;
  /** Whether the old glows — the soft sprites over the lamps, windows and headlights — are drawn too. */
  glows: boolean;
  /** Whether buildings stop light. Off, light passes through everything. */
  walls: boolean;
  /** Whether the lamps, the lit buildings and the headlights each give light. */
  lamps: boolean; windows: boolean; headlights: boolean;
  /** How strongly the light lifts the night. */
  gain: number;
  /** Show the light alone, over a black map: what was worked out, and nothing else. */
  only: boolean;
};
const options: GiOptions = { on: true, cascades: 3, spacing: 2, floors: true, water: false, layers: 4, glows: false, walls: true, lamps: true, windows: true, headlights: true, gain: 0.5, only: false };
let version = 0;
export const giOptions = (): Readonly<GiOptions> => options;
export const giVersion = () => version;
export function setGi(o: Partial<GiOptions>): GiOptions { Object.assign(options, o); version++; return { ...options }; }
/** How long the passes took on the GPU last time it was asked, ms; NaN if it cannot be told. */
let lastMs = NaN;
export const giMs = () => lastMs;

// ASKED FOR IN THE ADDRESS, or from the console: `?gi=off` turns it off (`?gi=glows,only,5,fine` are options), and
// `__gi({ ... })` changes anything live; `__giMs()` says what it cost.
if (typeof window !== "undefined") {
  const w = window as unknown as { __gi?: (o?: Partial<GiOptions>) => GiOptions; __giMs?: () => number };
  w.__gi = (o = {}) => setGi(o);
  w.__giMs = giMs;
  const q = typeof location !== "undefined" ? /[?&]gi(?:=([^&]*))?(?:&|$)/.exec(location.search) : null;
  if (q) {
    const words = (q[1] ?? "").split(",");
    setGi({
      on: !words.includes("off"), glows: words.includes("glows"), floors: !words.includes("nofloors"), water: words.includes("glare"), only: words.includes("only"), walls: !words.includes("nowalls"),
      ...(words.includes("3") ? { cascades: 3 } : words.includes("5") ? { cascades: 5 } : {}), ...(words.includes("fine") ? { spacing: 1 } : {}), ...(words.includes("flat") ? { layers: 1 } : {}),
    });
  }
}

/** A light: its middle and half its size, quarter-tiles; its colour, as strong as it is; whether it is a soft round pool (0) or a lit block (1); and how high it is, half steps over its ground (0 where not said). */
export type GiLight = { x: number; y: number; hx: number; hy: number; r: number; g: number; b: number; solid: 0 | 1; z?: number };
/**
 * THE HEIGHTS THE LIGHT IS WORKED OUT AT, half steps over the ground: the street, some four floors up, some nine,
 * some sixteen. Each is the flat light of its own height — what is built taller than it a wall, the lights near it
 * its lights — and a point between two takes of both. @see GiOptions.layers
 */
export const LAYER_HEIGHTS = [0, 5, 11, 20] as const;
/** How strongly the water gives the light back. @see GLINT_WGSL */
const GLINT = 1.1;
/** How strong a lit window's glare on the water is, for its colour as the cascades are given it; and any other light's, for its colour at full strength. */
const GLARE_WINDOW = 0.15, GLARE_LIGHT = 0.24;
/** How strong the pool a light lays on the water all round it is, against its image: a window's, and any other light's. @see GLARE_WGSL */
const POOL_WINDOW = 0.35, POOL_LIGHT = 0.45;
/** How what is built is sent to the GPU: half steps to a full byte. @see scene */
const HEIGHT_SPAN = 64;
/** The least time between two workings-out of the light, ms: a little under a frame at sixty a second. */
const WORK_EVERY = 15;

/** How far any light carries, quarter-tiles: it thins to nothing by here — as far as three cascades look (2 + 8 + 32), so there is nothing for a fourth to find. */
const REACH = 42;
/** A vehicle's beam, as long and as wide as this, tiles; the lit road's light where it is strongest. @see BEAM_WGSL */
const BEAM_LONG = 3.6, BEAM_NEAR = 0.2, BEAM_WIDE = 0.95, BEAM_BRIGHT = 0.95;
/** How far above or below the height it drives at a beam still lights the ground, half steps: a ramp's rise, and a little. */
const BEAM_LEVEL = 3.5;
/** Quarter-tiles a tile: the grid the ground's shade and what is built are kept on. @see ground-mesh SHADE_PER_TILE */
const Q = 4;
/** Lights at most, a frame. */
const MAX_LIGHTS = 16384;
const FLOATS = 12;
/** Vehicles with their beams on, at most, and how many numbers each is. */
const MAX_BEAMS = 4096;
/** Numbers a beam: where its lamps are and which way it shines, tiles; and the height it drives at, half steps. */
export const BEAM_FLOATS = 5;

const EMIT_WGSL = /* wgsl */ `
// The map's size, quarter-tiles; this height, the one under it and the one over it, half steps; the clock, s, and how many windows are lit.
struct U { scene: vec2<f32>, pad: vec2<f32>, heights: vec4<f32>, clock: vec4<f32> };
@group(0) @binding(0) var<uniform> u: U;
struct V { @builtin(position) pos: vec4<f32>, @location(0) at: vec2<f32>, @location(1) col: vec3<f32>, @location(2) solid: f32 };
fn roll(a: f32, b: f32) -> f32 { return fract(sin(a * 127.1 + b * 311.7) * 43758.5453); }
@vertex
fn vs(@builtin(vertex_index) i: u32, @location(0) box: vec4<f32>, @location(1) col: vec4<f32>, @location(2) more: vec4<f32>) -> V {
  var c = array<vec2<f32>, 6>(vec2(-1.0, -1.0), vec2(1.0, -1.0), vec2(1.0, 1.0), vec2(-1.0, -1.0), vec2(1.0, 1.0), vec2(-1.0, 1.0));
  let q = c[i];
  let p = box.xy + q * box.zw;
  // HOW MUCH OF IT IS THIS HEIGHT'S: all of it at this height, none at the next one up or down, and in between by how near.
  let z = more.x;
  var w = 1.0;
  if (z < u.heights.y) { w = clamp((z - u.heights.x) / max(u.heights.y - u.heights.x, 0.001), 0.0, 1.0); }
  else { w = clamp((u.heights.z - z) / max(u.heights.z - u.heights.y, 0.001), 0.0, 1.0); }
  // A WINDOW'S HOURS, as the window itself is drawn by them. (A light with no number is always lit.) @see lit-windows
  var on = 1.0;
  if (more.y >= 0.0) {
    let seed = more.y;
    let ph = u.clock.x / ${150}.0 + seed * 13.0; let slot = floor(ph); let f = ph - slot;
    let share = clamp(u.clock.y + more.z, 0.0, 1.0);
    let now = step(roll(seed, slot), share); let was = step(roll(seed, slot - 1.0), share);
    on = mix(was, now, smoothstep(0.0, ${1.5} / ${150}.0, f)) * (0.55 + 0.6 * roll(seed, 3.7));
  }
  var o: V;
  o.pos = vec4<f32>(p.x / u.scene.x * 2.0 - 1.0, 1.0 - p.y / u.scene.y * 2.0, 0.0, 1.0);
  // (Nothing of it here: drawn nowhere.)
  if (w * on <= 0.0) { o.pos = vec4<f32>(-4.0, -4.0, 0.0, 1.0); }
  o.at = q; o.col = col.rgb * w * on; o.solid = col.a;
  return o;
}
@fragment
fn fs(v: V) -> @location(0) vec4<f32> {
  let d = length(v.at);
  let round = max(0.0, 1.0 - d * d);
  return vec4<f32>(v.col * mix(round * round, 1.0, v.solid), 1.0);
}
`;

const CASCADE_WGSL = /* wgsl */ `
// (height: this layer's, half steps over the ground: what is built taller than it is its walls.)
struct U { level: f32, count: f32, s0: f32, l0: f32, scene: vec2<f32>, size: vec2<f32>, walls: f32, height: f32, p1: f32, p2: f32 };
@group(0) @binding(0) var<uniform> u: U;
@group(0) @binding(1) var occ: texture_2d<f32>;
@group(0) @binding(2) var emit: texture_2d<f32>;
@group(0) @binding(3) var upper: texture_2d<f32>;
@group(0) @binding(4) var samp: sampler;
@vertex
fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4<f32> {
  var p = array<vec2<f32>, 3>(vec2(-1.0, -1.0), vec2(3.0, -1.0), vec2(-1.0, 3.0));
  return vec4<f32>(p[i], 0.0, 1.0);
}
@fragment
fn fs(@builtin(position) pos: vec4<f32>) -> @location(0) vec4<f32> {
  let lvl = u32(u.level);
  // A probe's block: as many texels a side as it has directions a quarter turn... 2, 4, 8.
  let d = 2u << lvl;
  let p = vec2<u32>(pos.xy);
  let probe = p / d; let dp = p % d; let idx = dp.x + dp.y * d; let nd = d * d;
  let ang = (f32(idx) + 0.5) / f32(nd) * 6.2831853;
  let dir = vec2<f32>(cos(ang), sin(ang));
  let spacing = u.s0 * f32(1u << lvl);
  let origin = (vec2<f32>(probe) + 0.5) * spacing;
  let p4 = pow(4.0, u.level);
  let t0 = u.l0 * (p4 - 1.0) / 3.0; let t1 = t0 + u.l0 * p4;
  let step = max(1.0, f32(1u << lvl) * 0.5);
  var rad = vec3<f32>(0.0); var tr = 1.0;
  var t = t0 + step * 0.5;
  // A PROBE UNDER A BUILDING looks out through its own walls: what stands there is lit as the street round it is,
  // and its footprint is not a hole in the light for the building's own picture to fall into.
  let tall = (u.height + 0.6) / ${HEIGHT_SPAN}.0;
  // HOW WIDE A RAY IS at its distance: what it looks at is blurred as wide. A lamp smaller than the gap between two
  // rays was hit by one and missed by the next, and its light lay over the map in spokes.
  let fan = 6.2831853 / f32(nd);
  var within = textureSampleLevel(occ, samp, origin / u.scene, 0.0).r > tall;
  for (var k = 0; k < 256; k++) {
    if (t >= t1) { break; }
    let q = origin + dir * t;
    if (q.x < 0.0 || q.y < 0.0 || q.x >= u.scene.x || q.y >= u.scene.y) { break; }
    let uv = q / u.scene;
    // (And thinned by how far it has come, to nothing: light in a plane alone would carry over the whole map.)
    let far = clamp(1.0 - t * t / ${REACH * REACH}.0, 0.0, 1.0);
    let e = textureSampleLevel(emit, samp, uv, clamp(log2(max(1.0, t * fan)) + select(0.0, 0.5, lvl > 0u), 0.0, 2.0)).rgb * far * far;
    let wall = textureSampleLevel(occ, samp, uv, 0.0).r > tall;
    if (wall && !within && u.walls > 0.5) { rad += tr * e; tr = 0.0; break; }
    if (!wall) { within = false; rad += tr * e * step * 0.25; }
    t += step;
  }
  // WHAT LIES BEYOND, where nothing stopped the ray: the next cascade's four directions round this one, from the
  // four of its probes round this point, weighed by how near each is.
  if (u.level + 1.5 < u.count && tr > 0.0) {
    let ud = d * 2u;
    let uprobes = vec2<i32>(vec2<u32>(u.size) / ud);
    let up = origin / (spacing * 2.0) - 0.5;
    let b = floor(up); let f = up - b;
    var acc = vec4<f32>(0.0);
    for (var j = 0; j < 2; j++) { for (var i = 0; i < 2; i++) {
      let pc = clamp(vec2<i32>(b) + vec2<i32>(i, j), vec2<i32>(0), uprobes - vec2<i32>(1));
      let w = mix(1.0 - f.x, f.x, f32(i)) * mix(1.0 - f.y, f.y, f32(j));
      var s = vec4<f32>(0.0);
      for (var k = 0u; k < 4u; k++) {
        let ui = idx * 4u + k;
        s += textureLoad(upper, vec2<u32>(pc) * ud + vec2<u32>(ui % ud, ui / ud), 0);
      }
      acc += w * s * 0.25;
    } }
    rad += tr * acc.rgb; tr *= acc.a;
  }
  return vec4<f32>(rad, tr);
}
`;

const FINAL_WGSL = /* wgsl */ `
// (left: where this height's stretch of the light's texture begins, texels.)
struct U { gain: f32, left: f32, p1: f32, p2: f32 };
@group(0) @binding(0) var<uniform> u: U;
@group(0) @binding(1) var near: texture_2d<f32>;
@vertex
fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4<f32> {
  var p = array<vec2<f32>, 3>(vec2(-1.0, -1.0), vec2(3.0, -1.0), vec2(-1.0, 3.0));
  return vec4<f32>(p[i], 0.0, 1.0);
}
@fragment
fn fs(@builtin(position) pos: vec4<f32>) -> @location(0) vec4<f32> {
  // The light come to a probe from every way it looks: its four directions together.
  let p = vec2<u32>(vec2<f32>(pos.x - u.left, pos.y)) * 2u;
  let l = (textureLoad(near, p, 0).rgb + textureLoad(near, p + vec2<u32>(1u, 0u), 0).rgb + textureLoad(near, p + vec2<u32>(0u, 1u), 0).rgb + textureLoad(near, p + vec2<u32>(1u, 1u), 0).rgb) * 0.25;
  // (Rolled off, not cut off: under a lamp it is bright, and no brighter than day.)
  return vec4<f32>(vec3<f32>(1.0) - exp(-l * u.gain), 1.0);
}
`;

// EACH COARSER COPY OF THE LIGHTS: the one before it, four texels to one.
const SHRINK_WGSL = /* wgsl */ `
@group(0) @binding(0) var finer: texture_2d<f32>;
@vertex
fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4<f32> {
  var p = array<vec2<f32>, 3>(vec2(-1.0, -1.0), vec2(3.0, -1.0), vec2(-1.0, 3.0));
  return vec4<f32>(p[i], 0.0, 1.0);
}
@fragment
fn fs(@builtin(position) pos: vec4<f32>) -> @location(0) vec4<f32> {
  let p = vec2<i32>(pos.xy) * 2;
  return (textureLoad(finer, p, 0) + textureLoad(finer, p + vec2<i32>(1, 0), 0) + textureLoad(finer, p + vec2<i32>(0, 1), 0) + textureLoad(finer, p + vec2<i32>(1, 1), 0)) * 0.25;
}
`;
// A VEHICLE'S BEAM, laid on the map by itself: ahead of it, widening, as long as a beam is and no longer, and stopped
// by the first wall it meets. Headlamps were lights among the cascades' own, shining every way and as far as any,
// and every car swept the town through the gaps between its buildings.
const BEAM_WGSL = /* wgsl */ `
// The map, tiles; how tall a wall is, as the scene has it; the lowest ground, half steps.
struct U { map: vec2<f32>, tall: f32, low: f32 };
@group(0) @binding(0) var<uniform> u: U;
@group(0) @binding(1) var uSceneTex: texture_2d<f32>;
struct V { @builtin(position) pos: vec4<f32>, @location(0) at: vec2<f32>, @location(1) p: vec2<f32>, @location(2) @interpolate(flat) lamp: vec2<f32>, @location(3) @interpolate(flat) z: f32 };
@vertex
fn vs(@builtin(vertex_index) i: u32, @location(0) car: vec4<f32>, @location(1) z: f32) -> V {
  var c = array<vec2<f32>, 6>(vec2(0.0, -1.0), vec2(1.0, -1.0), vec2(1.0, 1.0), vec2(0.0, -1.0), vec2(1.0, 1.0), vec2(0.0, 1.0));
  let q = vec2<f32>(c[i].x * ${BEAM_LONG}, c[i].y * ${BEAM_WIDE});
  let dir = car.zw;
  var o: V;
  o.p = car.xy + dir * q.x + vec2<f32>(-dir.y, dir.x) * q.y;
  o.pos = vec4<f32>(o.p.x / u.map.x * 2.0 - 1.0, 1.0 - o.p.y / u.map.y * 2.0, 0.0, 1.0);
  o.at = q; o.lamp = car.xy;
  // (Its height as the scene keeps heights: from the lowest ground, a byte's worth over ${HEIGHT_SPAN} half steps.)
  o.z = (z - u.low) / ${HEIGHT_SPAN}.0;
  return o;
}
@fragment
fn fs(v: V) -> @location(0) vec4<f32> {
  let f = v.at.x / ${BEAM_LONG};
  let wide = mix(${BEAM_NEAR}, ${BEAM_WIDE}, f);
  let a = max(0.0, 1.0 - (v.at.y / wide) * (v.at.y / wide));
  var b = a * a * smoothstep(0.0, 0.12, f) * (1.0 - f) * (1.0 - f) * ${BEAM_BRIGHT};
  if (b <= 0.002) { return vec4<f32>(0.0); }
  let size = vec2<f32>(textureDimensions(uSceneTex));
  // ONLY WHAT IS AT ITS OWN HEIGHT: the ground there, or a bridge's deck. A car on a bridge lit the river under it;
  // one under the bridge, the deck over it.
  let here = textureLoad(uSceneTex, vec2<i32>(clamp(v.p / u.map * size, vec2<f32>(0.0), size - vec2<f32>(1.0))), 0);
  let near = min(abs(here.g - v.z), select(1.0, abs(here.b - v.z), here.b > 0.0));
  if (near > ${BEAM_LEVEL} / ${HEIGHT_SPAN}.0) { return vec4<f32>(0.0); }
  for (var k = 1; k <= 12; k++) {
    let q = mix(v.lamp, v.p, f32(k) / 12.0) / u.map * size;
    if (textureLoad(uSceneTex, vec2<i32>(clamp(q, vec2<f32>(0.0), size - vec2<f32>(1.0))), 0).r > u.tall) { return vec4<f32>(0.0); }
  }
  return vec4<f32>(b, 0.0, 0.0, b);
}
`;
const SHEET_COMMON = /* wgsl */ `
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
// The night's grade (a: the light alone); the light's reach in tiles, how far toward the eye to look for what
// stands there (tiles), and how many heights; the heights; the map in tiles, its lowest ground, and how the
// heights are packed.
struct Sheet { uGrade: vec4<f32>, uMap: vec4<f32>, uHeights: vec4<f32>, uScene: vec4<f32> };
@group(2) @binding(0) var<uniform> sheet : Sheet;
@group(2) @binding(1) var uLight : texture_2d<f32>;
@group(2) @binding(2) var uLightSampler : sampler;
@group(2) @binding(3) var uSceneTex : texture_2d<f32>;
struct VSOutput { @builtin(position) position: vec4<f32>, @location(0) vGround: vec2<f32> };
@vertex
fn mainVertex(@location(0) aPosition: vec2<f32>, @location(1) aGround: vec2<f32>) -> VSOutput {
  let mvp = globalUniforms.uProjectionMatrix * globalUniforms.uWorldTransformMatrix * localUniforms.uTransformMatrix;
  var out: VSOutput;
  out.position = vec4<f32>((mvp * vec3<f32>(aPosition, 1.0)).xy, 0.0, 1.0);
  out.vGround = aGround;
  return out;
}
// The ground's height and what is built on it, half steps, at a point of the map, tiles: nothing, off it.
fn sceneAt(q: vec2<f32>) -> vec2<f32> {
  let uv = q / sheet.uScene.xy;
  if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) { return vec2<f32>(sheet.uScene.z, 0.0); }
  // WHAT IS BUILT, AS FAR AS ALL FOUR QUARTER-TILES ROUND THE POINT ARE: the least of them. Blended, every
  // building stood in a skirt sloping from its roof to the ground; taken as the nearest, it stood a part of a
  // quarter-tile wider than it is drawn, and the ground at its foot was lit as its wall, in teeth. Taken as the
  // least it is a little narrower than drawn — and what is drawn covers the difference.
  let size = vec2<f32>(textureDimensions(uSceneTex));
  let q0 = uv * size - vec2<f32>(0.5);
  let c = vec2<i32>(floor(q0));
  let hi = vec2<i32>(size) - vec2<i32>(1);
  let s00 = textureLoad(uSceneTex, clamp(c, vec2<i32>(0), hi), 0);
  let s10 = textureLoad(uSceneTex, clamp(c + vec2<i32>(1, 0), vec2<i32>(0), hi), 0);
  let s01 = textureLoad(uSceneTex, clamp(c + vec2<i32>(0, 1), vec2<i32>(0), hi), 0);
  let s11 = textureLoad(uSceneTex, clamp(c + vec2<i32>(1, 1), vec2<i32>(0), hi), 0);
  let f = q0 - floor(q0);
  let ground = mix(mix(s00.g, s10.g, f.x), mix(s01.g, s11.g, f.x), f.y);
  let built = min(min(s00.r, s10.r), min(s01.r, s11.r));
  return vec2<f32>(ground * ${HEIGHT_SPAN}.0 + sheet.uScene.z, built * ${HEIGHT_SPAN}.0);
}
// The ground and what is built on it at a point, half steps, both blended between the quarter-tiles round it, in
// one look: as much as sceneAt gives or more (what is built is there the least of the four), and a little over
// for the blend's own coarseness.
fn blendAt(q: vec2<f32>) -> f32 {
  let s = textureSampleLevel(uSceneTex, uLightSampler, clamp(q / sheet.uScene.xy, vec2<f32>(0.0), vec2<f32>(1.0)), 0.0);
  return (s.g + s.r) * ${HEIGHT_SPAN}.0 + sheet.uScene.z + 0.3;
}
// The highest that anything stands — ground and what is built on it, half steps — within a tile back along the
// line of sight from a point, and a quarter-tile all round that: never less than what sceneAt gives anywhere there.
fn highNear(q: vec2<f32>) -> f32 {
  let size = vec2<i32>(textureDimensions(uSceneTex));
  let c = clamp(vec2<i32>(floor(q / sheet.uScene.xy * vec2<f32>(size))), vec2<i32>(0), size - vec2<i32>(1));
  return textureLoad(uSceneTex, c, 0).a * ${HEIGHT_SPAN}.0 + sheet.uScene.z;
}
// One height's light at a point of the map, tiles: its own stretch of the texture, side by side with the others'.
fn layerAt(q: vec2<f32>, l: f32) -> vec3<f32> {
  let n = sheet.uMap.w;
  let size = vec2<f32>(textureDimensions(uLight));
  let w = size.x / n;
  let uv = q / sheet.uMap.xy;
  if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) { return vec3<f32>(0.0); }
  // (Kept half a texel inside its stretch: the next height's light is not blended in at the edge.)
  let x = clamp(uv.x * w, 0.5, w - 0.5) + l * w;
  return textureSampleLevel(uLight, uLightSampler, vec2<f32>(x / size.x, uv.y), 0.0).rgb;
}
// WHAT IS SEEN AT A PIXEL. The sheet lies on the map's plane, but what the eye sees through it may stand nearer
// and higher: along the line of sight — a tile along both axes for every four half steps up — the nearest thing
// that stands as high as the line. From the far end of it back toward the plane, the first thing met. Where it
// is, tiles; how far along the line; and how high over its own ground (nothing, on the ground itself).
struct Seen { at: vec2<f32>, t: f32, up: f32, built: f32, ground: f32 };
fn seen(g: vec2<f32>) -> Seen {
  let reach = sheet.uMap.z;
  let low = min(0.0, sheet.uScene.z / 4.0);
  let dt = 0.2;
  var t = reach;
  var hit = low;
  var found = false;
  // A TILE OF THE LINE AT A TIME, and only the tiles where something stands as high as the line are gone over in
  // fifths: the rest are passed in one look at the highest thing near (the scene's fourth number). Every pixel
  // of the screen going over its whole line in fifths, four looks a fifth, was most of what the night cost.
  for (var j = 0; j < 16; j++) {
    if (t < low) { break; }
    if (highNear(g + vec2<f32>(t)) >= 4.0 * (t - 1.0) - 0.01) {
      var u = t;
      for (var k = 0; k < 5; k++) {
        if (u < low) { break; }
        // (One blended look first: it is never under what the four give, and where it is under the line they are not asked.)
        if (blendAt(g + vec2<f32>(u)) >= 4.0 * u) {
          let s = sceneAt(g + vec2<f32>(u));
          if (s.x + s.y >= 4.0 * u) { hit = u; found = true; break; }
        }
        u -= dt;
      }
      if (found) { break; }
    }
    t -= 1.0;
  }
  // (Its edge found a little finer: a wall's top is not a stair of fifths of a tile.)
  var lo = hit; var hi = min(hit + dt, reach);
  for (var k = 0; k < 3; k++) {
    let m = (lo + hi) * 0.5;
    var at = false;
    if (blendAt(g + vec2<f32>(m)) >= 4.0 * m) { let s = sceneAt(g + vec2<f32>(m)); at = s.x + s.y >= 4.0 * m; }
    if (at) { lo = m; } else { hi = m; }
  }
  var o: Seen;
  o.at = g + vec2<f32>(lo);
  let here = sceneAt(o.at);
  o.t = lo; o.built = step(0.3, here.y); o.ground = here.x;
  o.up = select(0.0, max(0.0, 4.0 * lo - here.x), here.y > 0.3);
  return o;
}
// THE LIGHT AT A HEIGHT over a point: each height's, by how near it is — the nearest most, and something of the
// others within spread half steps, as light from a floor falls on the street under it and rises to the floors over it.
fn lightOver(q: vec2<f32>, up: f32, spread: f32) -> vec3<f32> {
  var l = vec3<f32>(0.0);
  let n = i32(sheet.uMap.w);
  for (var i = 0; i < n; i++) {
    let d = abs(up - sheet.uHeights[i]) / spread;
    l += layerAt(q, f32(i)) / (1.0 + d * d);
  }
  return l;
}
`;
const SHEET_WGSL = SHEET_COMMON + /* wgsl */ `
// The vehicles' beams, as the map has them. @see BEAM_WGSL
@group(2) @binding(4) var uBeam : texture_2d<f32>;
// The face a line of sight meets in each column: the water's, or dry, what stands (blue), and whether it is water
// (alpha) — the water's mirror's own answer. @see mirror
@group(2) @binding(5) var uFace : texture_2d<f32>;
fn faceAt(q: vec2<f32>) -> vec4<f32> { return textureSampleLevel(uFace, uLightSampler, q / sheet.uScene.xy, 0.0); }
@fragment
fn mainFragment(in: VSOutput) -> @location(0) vec4<f32> {
  var s = seen(in.vGround);
  // THE WATER'S FACE, where the line meets it nearer the eye than what it met under it — the lake's bed, a tile and
  // more further on. Lit there, as the ground is: the light a lamp lays on the street goes on over the water.
  if (faceAt(in.vGround + vec2<f32>(s.t)).a > 0.02) {
    var t = s.t;
    for (var k = 0; k < 3; k++) { t = faceAt(in.vGround + vec2<f32>(t)).b / 4.0; }
    let w = faceAt(in.vGround + vec2<f32>(t));
    if (w.a > 0.5 && abs(w.b - 4.0 * t) < 0.4 && t > s.t + 0.01) {
      s.at = in.vGround + vec2<f32>(t); s.t = t; s.built = 0.0; s.up = 0.0; s.ground = w.b;
    }
  }
  // (A wall is lit from the air in front of it, not from inside itself.)
  let front = s.at + vec2<f32>(0.12 * s.built);
  var l = lightOver(front, s.up, 5.0);
  // (And the beams: the road's light, and a wall's foot's. Added as light on light is, never past day.)
  let b = textureSampleLevel(uBeam, uLightSampler, front / sheet.uScene.xy, 0.0).r / (1.0 + s.up * s.up * 0.2) * sheet.uScene.w;
  l = vec3<f32>(1.0) - (vec3<f32>(1.0) - min(l, vec3<f32>(1.0))) * (vec3<f32>(1.0) - b * vec3<f32>(1.0, 0.94, 0.78));
  // The night's colour, lifted toward the light's own as it is strong: under a lamp the street is lamp-lit, warm.
  let a = min(max(l.r, max(l.g, l.b)), 1.0);
  let lit = mix(sheet.uGrade.rgb, min(l / max(a, 0.0001), vec3<f32>(1.0)), a);
  return vec4<f32>(mix(lit, min(l, vec3<f32>(1.0)), sheet.uGrade.a), 1.0);
}
`;
// THE LIGHT THE WATER GIVES BACK, WORKED OUT ON THE MAP and not on the screen: a texel for each small square of
// the map, and at each what a line of sight leaving the water there goes on to meet. The screen has many times the
// pixels the map has squares, and asking this of each of them was three times the cost of everything else drawn.
const FIELD_WGSL = /* wgsl */ `
// The light's reach in tiles, how many heights, how strong a reflection is; the heights; the map in tiles and its lowest ground.
struct F { map: vec4<f32>, heights: vec4<f32>, scene: vec4<f32> };
@group(0) @binding(0) var<uniform> u: F;
@group(0) @binding(1) var uLight : texture_2d<f32>;
@group(0) @binding(2) var uSamp : sampler;
@group(0) @binding(3) var uSceneTex : texture_2d<f32>;
@group(0) @binding(4) var uDepth : texture_2d<f32>;
@group(0) @binding(5) var uBed : texture_2d<f32>;
struct V { @builtin(position) pos: vec4<f32>, @location(0) uv: vec2<f32> };
@vertex
fn vs(@builtin(vertex_index) i: u32) -> V {
  var p = array<vec2<f32>, 3>(vec2(-1.0, -1.0), vec2(3.0, -1.0), vec2(-1.0, 3.0));
  var o: V;
  o.pos = vec4<f32>(p[i], 0.0, 1.0);
  o.uv = vec2<f32>(p[i].x * 0.5 + 0.5, 0.5 - p[i].y * 0.5);
  return o;
}
fn waterCol(c: vec2<i32>, size: vec2<i32>, rows: i32) -> vec2<f32> {
  if (c.x < 0 || c.y < 0 || c.x >= size.x || c.y >= rows) { return vec2<f32>(0.0); }
  return vec2<f32>(textureLoad(uDepth, c, 0).r, textureLoad(uBed, c, 0).r);
}
// How deep the water is at a point of the map, and its bed: between the four columns round the point, so its face is one face
// and not a stair of quarter-tiles — which the light lay on in teeth.
fn waterAt(q: vec2<f32>) -> vec2<f32> {
  let size = vec2<i32>(textureDimensions(uDepth));
  // (The ground storey's rows: the first of them, as many as the map is deep in quarter-tiles.)
  let rows = i32(u.scene.y * ${Q}.0);
  let g = q * ${Q}.0 - vec2<f32>(0.5);
  let c = vec2<i32>(floor(g)); let f = g - floor(g);
  return mix(mix(waterCol(c, size, rows), waterCol(c + vec2<i32>(1, 0), size, rows), f.x), mix(waterCol(c + vec2<i32>(0, 1), size, rows), waterCol(c + vec2<i32>(1, 1), size, rows), f.x), f.y);
}
@fragment
fn fs(v: V) -> @location(0) vec4<f32> {
  // (A point of the water's face, as the map has it.)
  let p = v.uv * u.scene.xy;
  let w0 = waterAt(p);
  let depth = w0.x;
  // (With the light, how high the water's face is there — or the ground, where it is dry: the screen finds by it
  // which point of the map a pixel shows.)
  let level = w0.y + depth;
  // (The light on it is drawn over this, a light at a time. @see GLARE_WGSL)
  return vec4<f32>(0.0, 0.0, 0.0, level);
}
`;
// A LIGHT'S GLARE ON THE WATER, drawn on the map a light at a time — every lamp, lit window and headlamp the
// cascades are given — in two parts. ITS IMAGE: a soft streak where it would lie on flat water — as far toward the
// eye from its foot as it is high — drawn out along the line of sight as ripples draw it, the longer the higher the
// light. AND ITS LIGHT ON THE WATER ROUND IT: a light sends its light every way, and the ripples give some of it back
// wherever it falls — a pool all round its foot, dimmer, the wider the higher the light. (The image alone was a
// streak straight down the screen from every light and nothing to either side of it, whatever lit the water.)
const GLARE_WGSL = /* wgsl */ `
// The map's size, quarter-tiles; how strong a window's glare is, and any other light's; the clock, s, and how many windows are lit.
struct U { scene: vec2<f32>, gain: vec2<f32>, clock: vec4<f32> };
@group(0) @binding(0) var<uniform> u: U;
struct V { @builtin(position) pos: vec4<f32>, @location(0) at: vec2<f32>, @location(1) col: vec3<f32>, @location(2) @interpolate(flat) pool: f32 };
fn roll(a: f32, b: f32) -> f32 { return fract(sin(a * 127.1 + b * 311.7) * 43758.5453); }
@vertex
fn vs(@builtin(vertex_index) i: u32, @location(0) box: vec4<f32>, @location(1) col: vec4<f32>, @location(2) more: vec4<f32>) -> V {
  var c = array<vec2<f32>, 6>(vec2(-1.0, -1.0), vec2(1.0, -1.0), vec2(1.0, 1.0), vec2(-1.0, -1.0), vec2(1.0, 1.0), vec2(-1.0, 1.0));
  let q = c[i % 6u];
  // (The first six corners the image, the next six the pool.)
  let pool = i >= 6u;
  // A WINDOW'S HOURS, as the window itself is drawn by them. (A light with no number is always lit.) @see lit-windows
  var on = 1.0;
  var gain = u.gain.y / max(0.001, max(col.r, max(col.g, col.b)));
  if (more.y >= 0.0) {
    let seed = more.y;
    let ph = u.clock.x / ${150}.0 + seed * 13.0; let slot = floor(ph); let f = ph - slot;
    let share = clamp(u.clock.y + more.z, 0.0, 1.0);
    let now = step(roll(seed, slot), share); let was = step(roll(seed, slot - 1.0), share);
    on = mix(was, now, smoothstep(0.0, ${1.5} / ${150}.0, f)) * (0.55 + 0.6 * roll(seed, 3.7));
    gain = u.gain.x;
  }
  // (How high it is over the water, half steps — the water taken to lie a little under the ground the light stands on.)
  let h = max(0.0, more.x) + 1.5;
  let along = vec2<f32>(0.7071, 0.7071) * (2.4 + 0.8 * h);
  let across = vec2<f32>(0.7071, -0.7071) * clamp(max(box.z, box.w), 1.4, 3.0);
  var p = box.xy + vec2<f32>(h) + q.x * across + q.y * along;
  var k = 1.0;
  // THE POOL round its foot, quarter-tiles across: wider the higher it stands, as a lamp's light spreads.
  if (pool) {
    let lamp = more.y < 0.0;
    let reach = select(clamp(5.0 + 0.5 * h, 5.0, 14.0), clamp(8.0 + 0.8 * h, 8.0, 20.0), lamp);
    p = box.xy + q * reach;
    k = select(${POOL_WINDOW}, ${POOL_LIGHT}, lamp);
  }
  var o: V;
  o.pos = vec4<f32>(p.x / u.scene.x * 2.0 - 1.0, 1.0 - p.y / u.scene.y * 2.0, 0.0, 1.0);
  // (Not lit, or not a light but a lit area — a building's glow on its own ground: drawn nowhere.)
  if (on <= 0.0 || col.a > 0.5 || max(box.z, box.w) > 8.0) { o.pos = vec4<f32>(-4.0, -4.0, 0.0, 1.0); }
  o.at = q; o.col = col.rgb * gain * on * k; o.pool = select(0.0, 1.0, pool);
  return o;
}
@fragment
fn fs(v: V) -> @location(0) vec4<f32> {
  // (The pool: falling off from its foot alike every way.)
  if (v.pool > 0.5) { let r = max(0.0, 1.0 - dot(v.at, v.at)); return vec4<f32>(v.col * r * r * r, 0.0); }
  let a = max(0.0, 1.0 - v.at.x * v.at.x); let b = max(0.0, 1.0 - v.at.y * v.at.y);
  return vec4<f32>(v.col * a * a * b * b, 0.0);
}
`;
// THE WATER'S SHEET: at each pixel, the point of the water seen there, what the map has for it — looked up a little
// aside, by the ripples — and nothing where a building or a bridge's deck stands between it and the eye.
// WHERE THERE IS LIT WATER TO BE SEEN, on the plane the sheet lies on, a tile a texel: every small square of the
// field that is wet and has light on it, drawn as a point where a line of sight meets the plane after it — as far
// back along both axes as its water stands high. The screen asks this first, one look, and most of it has neither
// water nor light: it was finding that out a pixel at a time, eight looks each.
const MASK_WGSL = /* wgsl */ `
// The field's size, texels; the map's, tiles; and the water's rows of columns.
struct U { field: vec2<f32>, map: vec2<f32>, rows: vec4<f32> };
@group(0) @binding(0) var<uniform> u: U;
@group(0) @binding(1) var uField : texture_2d<f32>;
@group(0) @binding(2) var uDepth : texture_2d<f32>;
fn wet(c: vec2<i32>) -> f32 {
  let size = vec2<i32>(textureDimensions(uDepth));
  if (c.x < 0 || c.y < 0 || c.x >= size.x || c.y >= i32(u.rows.x)) { return 0.0; }
  return textureLoad(uDepth, c, 0).r;
}
@vertex
fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4<f32> {
  let fw = u32(u.field.x);
  let c = vec2<i32>(i32(i % fw), i32(i / fw));
  let f = textureLoad(uField, c, 0);
  // (Where it is, tiles; and the four columns of water round it: any of them deep enough to give light back.)
  let p = (vec2<f32>(c) + vec2<f32>(0.5)) / u.field * u.map;
  let d = vec2<i32>(floor(p * ${Q}.0 - vec2<f32>(0.5)));
  let deep = max(max(wet(d), wet(d + vec2<i32>(1, 0))), max(wet(d + vec2<i32>(0, 1)), wet(d + vec2<i32>(1, 1))));
  if (max(f.r, max(f.g, f.b)) <= 0.0005 || deep < 0.04) { return vec4<f32>(-4.0, -4.0, 0.0, 1.0); }
  let g = clamp(floor(p - vec2<f32>(f.a / 4.0)), vec2<f32>(0.0), u.map - vec2<f32>(1.0)) + vec2<f32>(0.5);
  return vec4<f32>(g.x / u.map.x * 2.0 - 1.0, 1.0 - g.y / u.map.y * 2.0, 0.0, 1.0);
}
@fragment
fn fs() -> @location(0) vec4<f32> { return vec4<f32>(1.0); }
`;
const GLINT_WGSL = SHEET_COMMON + /* wgsl */ `
@group(2) @binding(7) var uMask : texture_2d<f32>;
@group(2) @binding(4) var uDepth : texture_2d<f32>;
@group(2) @binding(5) var uField : texture_2d<f32>;
// How strong (unused here: the map's texture has it), the clock, and the highest deck's height.
struct Glint { uGlint: vec4<f32> };
@group(2) @binding(6) var<uniform> glint : Glint;
fn sceneLin(q: vec2<f32>) -> vec4<f32> { return textureSampleLevel(uSceneTex, uLightSampler, q / sheet.uScene.xy, 0.0); }
// How deep the water is in the column a point is in, as the solver has it.
fn depthNear(q: vec2<f32>) -> f32 {
  let size = vec2<i32>(textureDimensions(uDepth));
  let c = vec2<i32>(floor(q * ${Q}.0));
  if (c.x < 0 || c.y < 0 || c.x >= size.x || c.y >= i32(sheet.uScene.y * ${Q}.0)) { return 0.0; }
  return textureLoad(uDepth, c, 0).r;
}
// What the map has for a point: the light the water gives back there, and how high its face is — or the ground, dry.
fn fieldAt(q: vec2<f32>) -> vec4<f32> { return textureSampleLevel(uField, uLightSampler, q / sheet.uScene.xy, 0.0); }
@fragment
fn mainFragment(in: VSOutput) -> @location(0) vec4<f32> {
  let g = in.vGround;
  let low = sheet.uScene.z;
  // (No lit water within a tile of here, on the map's own word: nothing more to ask. Blended between the four
  // texels round the point, so one of them marked is enough. @see MASK_WGSL)
  if (textureSampleLevel(uMask, uLightSampler, g / sheet.uScene.xy, 0.0).r <= 0.0) { return vec4<f32>(0.0); }
  // WHERE THE LINE OF SIGHT MEETS THE WATER'S FACE: a tile along both axes for every four half steps up, so as far
  // along as the face there is high — found by going to where the last guess says, and asking again.
  var t = 0.0;
  t = fieldAt(g + vec2<f32>(t)).a / 4.0;
  t = fieldAt(g + vec2<f32>(t)).a / 4.0;
  t = fieldAt(g + vec2<f32>(t)).a / 4.0;
  let p = g + vec2<f32>(t);
  // (No water there, or the guesses never settled — a cliff: nothing.)
  // (How deep, between the four columns round the point: read from the one it is in, the glare's fade up the
  // shallows — and its edge at the bank — was a stair of quarter-tiles.)
  let dg = p * ${Q}.0 - vec2<f32>(0.5); let df = dg - floor(dg); let dc = (floor(dg) + vec2<f32>(0.5)) / ${Q}.0;
  let depth = mix(mix(depthNear(dc), depthNear(dc + vec2<f32>(${1 / Q}, 0.0)), df.x), mix(depthNear(dc + vec2<f32>(0.0, ${1 / Q})), depthNear(dc + vec2<f32>(${1 / Q})), df.x), df.y);
  if (depth < 0.04 || abs(fieldAt(p).a - 4.0 * t) > 0.4) { return vec4<f32>(0.0); }
  // ITS RIPPLES: two slow swells crossing, by where and when, that set the glare swaying.
  let c = glint.uGlint.y;
  let rip = vec2<f32>(sin(p.x * 9.0 + p.y * 3.1 + c * 1.3) + sin(p.x * 4.3 - p.y * 7.7 - c * 0.9), sin(p.y * 8.3 - p.x * 2.7 + c * 1.1) + sin(p.x * 6.1 + p.y * 5.3 + c * 0.7)) * 0.5;
  // (Fading out up the shallows: a hand's depth of water over the bank is not a mirror.)
  // (Blurred on the water's face: five looks, the middle one and four round it a quarter-tile off, swayed a little by the ripples — a little, or its edge is a zigzag.)
  let fp = p + rip * 0.03;
  let l = (fieldAt(fp).rgb * 2.0 + fieldAt(fp + vec2<f32>(0.3, 0.12)).rgb + fieldAt(fp - vec2<f32>(0.3, 0.12)).rgb
    + fieldAt(fp + vec2<f32>(-0.12, 0.3)).rgb + fieldAt(fp - vec2<f32>(-0.12, 0.3)).rgb) / 6.0 * smoothstep(0.04, 0.7, depth);
  // (Dark water — most of it: nothing more to ask.)
  if (max(l.r, max(l.g, l.b)) < 0.006) { return vec4<f32>(0.0); }
  // WHAT STANDS BETWEEN IT AND THE EYE: on up the line from the water, the ground and what is built on it as high
  // as the line, or a bridge's deck at the height the line is at.
  var cover = 0.0;
  let u0 = t + 0.2;
  let size = vec2<f32>(textureDimensions(uSceneTex));
  // A TILE OF THE LINE AT A TIME: where nothing near stands as high as the line (the scene's fourth number), its
  // four quarters are not looked at. Up a tower's height of open air over a harbour that was most of the looks.
  for (var j = 0; j < 15; j++) {
    let lo = u0 + f32(j);
    if (lo > sheet.uMap.z) { break; }
    if (highNear(g + vec2<f32>(lo + 1.0)) < 4.0 * lo - 0.45) { continue; }
    for (var k = 0; k < 4; k++) {
      let u = lo + f32(k) * 0.25;
      if (u > sheet.uMap.z) { break; }
      let s = sceneLin(g + vec2<f32>(u));
      cover = max(cover, smoothstep(-0.4, 0.4, (s.g + s.r) * ${HEIGHT_SPAN}.0 + low - 4.0 * u));
    }
    if (cover > 0.98) { return vec4<f32>(0.0); }
  }
  // A BRIDGE'S DECK at the height the line is at: only as high as the highest deck, and only where there are any.
  if (glint.uGlint.z > -500.0) {
    var u = u0;
    for (var k = 0; k < 60; k++) {
      if (u > sheet.uMap.z || 4.0 * u > glint.uGlint.z + 1.0) { break; }
      let q = g + vec2<f32>(u);
      let db = textureLoad(uSceneTex, vec2<i32>(clamp(q / sheet.uScene.xy * size, vec2<f32>(0.0), size - vec2<f32>(1.0))), 0).b;
      if (db > 0.0 && abs(db * ${HEIGHT_SPAN}.0 + low - 4.0 * u) <= 0.6) { return vec4<f32>(0.0); }
      u += 0.25;
    }
  }
  return vec4<f32>(l * (1.0 - cover), 0.0);
}
`;

type Gpu = { gpu?: { device: GPUDevice }; texture?: { getGpuSource: (s: unknown) => GPUTexture } };

/** What a frame gives the light: every field as it is now. */
export type GiFrame = {
  /** The lights that are told a frame at a time: lamps, signs, headlights. */
  lights: readonly GiLight[];
  /** How many of them, the last of the list, are headlamps: their light on the road is their beams' (@see beams), and only the water gives these back. */
  heads?: number;
  /** The vehicles with their lamps lit: where each one's lamps are, tiles, and which way it points. `BEAM_FLOATS` numbers apiece. */
  beams?: { data: Float32Array; n: number };
  /** The windows, each a light with its own hours — `FLOATS` numbers apiece, as {@link windowLight} lays them — and a count that moves when they do. */
  windows?: { data: Float32Array; n: number; rev: number };
  /** The ground's height and what is built on it, half steps a quarter-tile; a count that moves when either does; the lowest ground and the highest thing. */
  heights: Float32Array; casts: Float32Array; sceneRev: number; low: number; top: number;
  /** The night's grade as a colour, and how dark it is (0–1). */
  grade: number; night: number;
  /** The water, where the solver has it on the GPU: how deep and its bed, a quarter-tile, as Pixi's own textures. @see water-gpu */
  water?: { depth: unknown; bed: unknown } | null;
  /** The face a line of sight meets in each column — the water's, or what stands — as the water's mirror found it: lit as the ground is. @see mirror */
  face?: unknown;
  /** The bridges' decks, a tile: which tiles have one, and how high it runs, half steps. Nothing of the light on water is laid over them. */
  decks?: { on: Uint8Array; z: Int8Array } | null;
  /** The windows' clock, s, and how many of them are lit (0–1). @see lit-windows */
  clock: number; share: number;
};
/** A window as a light, into `out` at `o`: where, how big, its colour, how high, its number and its odds. @see GiFrame.windows */
export function windowLight(out: Float32Array, o: number, x: number, y: number, hx: number, hy: number, r: number, g: number, b: number, z: number, seed: number, bias: number): void {
  out[o] = x; out[o + 1] = y; out[o + 2] = hx; out[o + 3] = hy; out[o + 4] = r; out[o + 5] = g; out[o + 6] = b; out[o + 7] = 0; out[o + 8] = z; out[o + 9] = seed; out[o + 10] = bias; out[o + 11] = 0;
}
export const WINDOW_FLOATS = FLOATS;

export type Gi = {
  /** This frame. True if the light was worked out and laid: the flat night is then not to be drawn. */
  tick: (f: GiFrame) => boolean;
  /** Put by: nothing worked out, nothing laid. */
  rest: () => void;
  destroy: () => void;
};

/** The heights a count of layers stands for. @see LAYER_HEIGHTS */
const heightsFor = (n: number): number[] => (n >= 4 ? [...LAYER_HEIGHTS] : n === 2 ? [0, 8] : [0]);

/**
 * The map's own light, for a map `w` by `h` tiles; null where there is no WebGPU. Its sheet is `world`'s child — the
 * map's own container — so it moves with the map exactly, in the frame the map does: laid from outside by last
 * frame's transform it trailed the camera by a frame, and a zoom pulled the light off what it lit.
 */
export function createGi(renderer: Renderer, world: Container, zIndex: number, w: number, h: number, scale: number): Gi | null {
  const sys = renderer as unknown as Gpu, device = sys.gpu?.device;
  if (!device || typeof sys.texture?.getGpuSource !== "function") return null;
  const SW = w * Q, SH = h * Q;
  const fmt: GPUTextureFormat = "rgba16float";
  const tex = (width: number, height: number, format: GPUTextureFormat, usage: number) => device.createTexture({ size: [width, height], format, usage });
  const RT = GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING;
  // THE SCENE: what is built (red) and the ground under it (green), half steps to a byte — read by the cascades
  // for their walls, and by the sheet for what stands at each pixel. Pixi's texture, written here.
  const sceneBytes = new Uint8Array(SW * SH * 4);
  const scene = new BufferImageSource({ resource: sceneBytes, width: SW, height: SH, format: "rgba8unorm", scaleMode: "linear" });
  const sceneGpu = sys.texture.getGpuSource(scene);
  // (The lights as they are and twice shrunk. @see SHRINK_WGSL)
  const emit = device.createTexture({ size: [SW, SH], format: fmt, usage: RT, mipLevelCount: 3 });
  const emitViews = [0, 1, 2].map((m) => emit.createView({ baseMipLevel: m, mipLevelCount: 1 }));
  const linear = device.createSampler({ magFilter: "linear", minFilter: "linear", mipmapFilter: "linear", addressModeU: "clamp-to-edge", addressModeV: "clamp-to-edge" });
  const lightData = new Float32Array(MAX_LIGHTS * FLOATS);
  const lightBuf = device.createBuffer({ size: lightData.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
  let windowBuf: GPUBuffer | null = null, windowN = 0, windowRev = -1;

  const emitMod = device.createShaderModule({ code: EMIT_WGSL });
  const emitPipe = device.createRenderPipeline({
    layout: "auto",
    vertex: {
      module: emitMod, entryPoint: "vs",
      buffers: [{
        arrayStride: FLOATS * 4, stepMode: "instance",
        attributes: [{ shaderLocation: 0, offset: 0, format: "float32x4" }, { shaderLocation: 1, offset: 16, format: "float32x4" }, { shaderLocation: 2, offset: 32, format: "float32x4" }],
      }],
    },
    fragment: { module: emitMod, entryPoint: "fs", targets: [{ format: fmt, blend: { color: { srcFactor: "one", dstFactor: "one" }, alpha: { srcFactor: "one", dstFactor: "one" } } }] },
  });
  const shrinkMod = device.createShaderModule({ code: SHRINK_WGSL });
  const shrinkPipe = device.createRenderPipeline({ layout: "auto", vertex: { module: shrinkMod, entryPoint: "vs" }, fragment: { module: shrinkMod, entryPoint: "fs", targets: [{ format: fmt }] } });
  const shrinkBinds = [0, 1].map((m) => device.createBindGroup({ layout: shrinkPipe.getBindGroupLayout(0), entries: [{ binding: 0, resource: emitViews[m] }] }));
  // THE BEAMS: a texture of their own, finer than the light's — a beam is no wider than a lane.
  const BT = Math.max(4, Math.min(8, Math.floor(1024 / Math.max(w, h))));
  // (Nowhere water, until the water's mirror gives its face. @see GiFrame.face)
  const noFace = new BufferImageSource({ resource: new Uint16Array(4), width: 1, height: 1, format: "rgba16float", scaleMode: "linear" });
  const beamTex = new BufferImageSource({ resource: new Uint8Array(w * BT * h * BT), width: w * BT, height: h * BT, format: "r8unorm", scaleMode: "linear" });
  const beamView = sys.texture.getGpuSource(beamTex).createView();
  const beamMod = device.createShaderModule({ code: BEAM_WGSL });
  const beamPipe = device.createRenderPipeline({
    layout: "auto",
    vertex: { module: beamMod, entryPoint: "vs", buffers: [{ arrayStride: BEAM_FLOATS * 4, stepMode: "instance", attributes: [{ shaderLocation: 0, offset: 0, format: "float32x4" }, { shaderLocation: 1, offset: 16, format: "float32" }] }] },
    // (Light on light: two beams on one patch of road are no brighter than day.)
    fragment: { module: beamMod, entryPoint: "fs", targets: [{ format: "r8unorm", blend: { color: { srcFactor: "one", dstFactor: "one-minus-src" }, alpha: { srcFactor: "one", dstFactor: "one" } } }] },
  });
  const beamBuf = device.createBuffer({ size: MAX_BEAMS * BEAM_FLOATS * 4, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
  const beamU = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  device.queue.writeBuffer(beamU, 0, new Float32Array([w, h, 0.6 / HEIGHT_SPAN, 0]));
  const beamBind = device.createBindGroup({ layout: beamPipe.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: beamU } }, { binding: 1, resource: sceneGpu.createView() }] });
  /** Whether the beams' texture has any in it. */
  let beamsIn = false;
  const cascMod = device.createShaderModule({ code: CASCADE_WGSL });
  const cascPipe = device.createRenderPipeline({ layout: "auto", vertex: { module: cascMod, entryPoint: "vs" }, fragment: { module: cascMod, entryPoint: "fs", targets: [{ format: fmt }] } });
  const finalMod = device.createShaderModule({ code: FINAL_WGSL });
  const finalPipe = device.createRenderPipeline({ layout: "auto", vertex: { module: finalMod, entryPoint: "vs" }, fragment: { module: finalMod, entryPoint: "fs", targets: [{ format: "rgba8unorm" }] } });
  const ubuf = (size: number) => device.createBuffer({ size, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  // THE WATER'S LIGHT ON THE MAP. (Its layout said outright: the solver's depths are a texture that cannot be filtered.)
  const fieldLayout = device.createBindGroupLayout({ entries: [
    { binding: 0, visibility: 2, buffer: { type: "uniform" } },
    { binding: 1, visibility: 2, texture: { sampleType: "float" } },
    { binding: 2, visibility: 2, sampler: { type: "filtering" } },
    { binding: 3, visibility: 2, texture: { sampleType: "float" } },
    { binding: 4, visibility: 2, texture: { sampleType: "unfilterable-float" } },
    { binding: 5, visibility: 2, texture: { sampleType: "unfilterable-float" } },
  ] });
  const fieldMod = device.createShaderModule({ code: FIELD_WGSL });
  const fieldPipe = device.createRenderPipeline({ layout: device.createPipelineLayout({ bindGroupLayouts: [fieldLayout] }), vertex: { module: fieldMod, entryPoint: "vs" }, fragment: { module: fieldMod, entryPoint: "fs", targets: [{ format: fmt }] } });
  const maskMod = device.createShaderModule({ code: MASK_WGSL });
  const maskPipe = device.createRenderPipeline({
    layout: "auto", primitive: { topology: "point-list" },
    vertex: { module: maskMod, entryPoint: "vs" }, fragment: { module: maskMod, entryPoint: "fs", targets: [{ format: "r8unorm" }] },
  });
  const maskU = ubuf(32);
  const glareMod = device.createShaderModule({ code: GLARE_WGSL });
  const glarePipe = device.createRenderPipeline({
    layout: "auto",
    vertex: {
      module: glareMod, entryPoint: "vs",
      buffers: [{
        arrayStride: FLOATS * 4, stepMode: "instance",
        attributes: [{ shaderLocation: 0, offset: 0, format: "float32x4" }, { shaderLocation: 1, offset: 16, format: "float32x4" }, { shaderLocation: 2, offset: 32, format: "float32x4" }],
      }],
    },
    // (Added to the light; the water's height, which is the texture's fourth number, left as it is.)
    fragment: { module: glareMod, entryPoint: "fs", targets: [{ format: fmt, blend: { color: { srcFactor: "one", dstFactor: "one" }, alpha: { srcFactor: "zero", dstFactor: "one" } } }] },
  });
  const glareU = ubuf(32);
  const glareBind = device.createBindGroup({ layout: glarePipe.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: glareU } }] });
  // (As many texels a tile as keeps it to some hundreds a side: eight on a small map.)
  const FT = Math.max(2, Math.min(8, Math.floor(640 / Math.max(w, h)))), FW = w * FT, FH = h * FT;
  const fieldU = ubuf(48);

  /**
   * What is sized by the options. ONE CHAIN OF CASCADES, gone through once for each height: the heights differ in
   * their numbers — which lights, how tall a wall — and not in their textures, and each leaves its light in its
   * own stretch of the one texture the sheet reads.
   */
  type Sized = {
    key: string; count: number; px: number; py: number; heights: number[];
    chain: { view: GPUTextureView; texture: GPUTexture }[];
    layers: { emitU: GPUBuffer; emitBind: GPUBindGroup; levels: { u: GPUBuffer; bind: GPUBindGroup }[]; finalU: GPUBuffer; finalBind: GPUBindGroup }[];
    light: BufferImageSource; lightView: GPUTextureView; mesh: Mesh<Geometry, Shader>; sheetU: UniformGroup;
    /** The water's reflections: a second sheet, added. Made when there is water to read. */
    glint: Mesh<Geometry, Shader> | null; glintU: UniformGroup; glintOf: unknown;
    /** What the water gives back, on the map: Pixi's texture, written here. @see FIELD_WGSL */
    field: BufferImageSource | null; fieldView: GPUTextureView | null; fieldBind: GPUBindGroup | null;
    /** Where there is lit water to be seen, a tile a texel: Pixi's texture, written here. @see MASK_WGSL */
    mask: BufferImageSource | null; maskView: GPUTextureView | null; maskBind: GPUBindGroup | null;
  };
  let sized: Sized | null = null;
  const unsize = () => {
    if (!sized) return;
    const s = sized; sized = null;
    s.mesh.parent?.removeChild(s.mesh);
    s.glint?.parent?.removeChild(s.glint);
    // (A moment later: the frame that drew with them may still be reading them. @see batches-keep-destroyed-sources)
    setTimeout(() => {
      for (const c of s.chain) c.texture.destroy();
      for (const l of s.layers) { l.emitU.destroy(); l.finalU.destroy(); for (const v of l.levels) v.u.destroy(); }
      s.glint?.destroy(); s.field?.destroy();
      const geo = s.mesh.geometry; s.mesh.destroy(); geo.destroy(true); s.light.destroy();
    }, 500);
  };
  const size = (): Sized => {
    const count = options.cascades, s0 = options.spacing, heights = heightsFor(options.layers), key = `${count}|${s0}|${heights.length}`;
    if (sized?.key === key) return sized;
    unsize();
    // Probes of the nearest cascade a side, rounded up to what the furthest cascade's blocks divide.
    const m = 1 << (count - 1), px = Math.ceil(SW / s0 / m) * m, py = Math.ceil(SH / s0 / m) * m, T: [number, number] = [px * 2, py * 2];
    const textures = Array.from({ length: count }, () => tex(T[0], T[1], fmt, RT));
    const blank = tex(1, 1, fmt, RT);
    const chain = textures.map((texture) => ({ view: texture.createView(), texture }));
    const layers = heights.map((height, li) => {
      const emitU = ubuf(48);
      device.queue.writeBuffer(emitU, 0, new Float32Array([SW, SH, 0, 0, li ? heights[li - 1] : -1e6, height, li + 1 < heights.length ? heights[li + 1] : 1e6, 0, 0, 0, 0, 0]));
      const emitBind = device.createBindGroup({ layout: emitPipe.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: emitU } }] });
      const levels = textures.map((_t, i) => {
        const u = ubuf(48);
        device.queue.writeBuffer(u, 0, new Float32Array([i, count, s0, s0, SW, SH, T[0], T[1], options.walls ? 1 : 0, height, 0, 0]));
        const bind = device.createBindGroup({
          layout: cascPipe.getBindGroupLayout(0),
          entries: [
            { binding: 0, resource: { buffer: u } }, { binding: 1, resource: sceneGpu.createView() }, { binding: 2, resource: emit.createView() },
            { binding: 3, resource: (textures[i + 1] ?? blank).createView() }, { binding: 4, resource: linear },
          ],
        });
        return { u, bind };
      });
      const finalU = ubuf(16);
      const finalBind = device.createBindGroup({ layout: finalPipe.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: finalU } }, { binding: 1, resource: chain[0].view }] });
      return { emitU, emitBind, levels, finalU, finalBind };
    });
    const light = new BufferImageSource({ resource: new Uint8Array(px * heights.length * py * 4), width: px * heights.length, height: py, format: "rgba8unorm", scaleMode: "linear" });
    const lightView = sys.texture!.getGpuSource(light).createView();
    // THE SHEET: the map's plane and as much again all round it, so the night reaches the screen's corners.
    const sheetU = new UniformGroup({
      uGrade: { value: new Float32Array([1, 1, 1, 0]), type: "vec4<f32>" },
      // (The light's texture covers the probes' grid, which may run a little past the map: in tiles.)
      uMap: { value: new Float32Array([(px * s0) / Q, (py * s0) / Q, 0, heights.length]), type: "vec4<f32>" },
      uHeights: { value: new Float32Array([heights[0] ?? 0, heights[1] ?? 0, heights[2] ?? 0, heights[3] ?? 0]), type: "vec4<f32>" },
      uScene: { value: new Float32Array([w, h, 0, 0]), type: "vec4<f32>" },
    });
    const R = Math.max(w, h) * 3, corners = [[-R, -R], [w + R, -R], [w + R, h + R], [-R, h + R]];
    const verts = new Float32Array(corners.flatMap(([gu, gv]) => [(gu - 0.5 - (gv - 0.5)) * HW * scale, (gu - 0.5 + gv - 0.5) * HH * scale, gu, gv]));
    const vb = new Buffer({ data: verts, usage: BufferUsage.VERTEX | BufferUsage.COPY_DST });
    const ib = new Buffer({ data: new Uint32Array([0, 1, 2, 0, 2, 3]), usage: BufferUsage.INDEX | BufferUsage.COPY_DST });
    const geometry = new Geometry({
      attributes: { aPosition: { buffer: vb, format: "float32x2", stride: 16, offset: 0 }, aGround: { buffer: vb, format: "float32x2", stride: 16, offset: 8 } },
      indexBuffer: ib,
    });
    const shader = new Shader({
      gpuProgram: GpuProgram.from({
        vertex: { source: SHEET_WGSL, entryPoint: "mainVertex" }, fragment: { source: SHEET_WGSL, entryPoint: "mainFragment" }, name: "gi-sheet",
        layout: [{ globalUniforms: 0 }, { localUniforms: 0 }, { sheet: 0, uLight: 1, uLightSampler: 2, uSceneTex: 3, uBeam: 4, uFace: 5 }],
        gpuLayout: [
          [{ binding: 0, visibility: 3, buffer: { type: "uniform" } }],
          [{ binding: 0, visibility: 3, buffer: { type: "uniform" } }],
          [
            { binding: 0, visibility: 2, buffer: { type: "uniform" } },
            { binding: 1, visibility: 2, texture: { sampleType: "float", viewDimension: "2d", multisampled: false } },
            { binding: 2, visibility: 2, sampler: { type: "filtering" } },
            { binding: 3, visibility: 2, texture: { sampleType: "float", viewDimension: "2d", multisampled: false } },
            { binding: 4, visibility: 2, texture: { sampleType: "float", viewDimension: "2d", multisampled: false } },
            { binding: 5, visibility: 2, texture: { sampleType: "float", viewDimension: "2d", multisampled: false } },
          ],
        ],
      }),
      // (No water's face until the water's mirror has one: nothing anywhere is water.)
      resources: { sheet: sheetU, uLight: light, uLightSampler: light.style, uSceneTex: scene, uBeam: beamTex, uFace: noFace },
    });
    const mesh = new Mesh<Geometry, Shader>({ geometry, shader });
    mesh.eventMode = "none";
    mesh.blendMode = "multiply";
    mesh.zIndex = zIndex;
    world.addChild(mesh);
    seenWalls = options.walls;
    const glintU = new UniformGroup({ uGlint: { value: new Float32Array([0, 0, 0, 0]), type: "vec4<f32>" } });
    return (sized = { key, count, px, py, heights, chain, layers, light, lightView, mesh, sheetU, glint: null, glintU, glintOf: null, field: null, fieldView: null, fieldBind: null, mask: null, maskView: null, maskBind: null });
  };

  // HOW LONG IT TOOK, where the device can say: the first pass's start to the last's end.
  const stamps = device.features.has("timestamp-query") ? {
    set: device.createQuerySet({ type: "timestamp", count: 2 }),
    resolve: device.createBuffer({ size: 16, usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC }),
    read: device.createBuffer({ size: 16, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ }),
    busy: false,
  } : null;

  let seenScene = -1, seenWalls: boolean | null = null, frame = 0;
  // (The decks as they were last sent, and the highest of them: looked at again twice a second, there being nothing that counts their changes.)
  let seenDecks = 0, deckTop = -1e3, fieldFresh = false;
  let high = new Uint8Array(0), highRow = new Uint8Array(0);
  /** When the light was last worked out, ms, and how many times it has been. @see WORK_EVERY */
  let worked = -1e9, turns = 0;
  let fresh = "", freshScene = -1, freshWindows = -2, freshWalls: boolean | null = null;
  return {
    rest() { if (sized) { sized.mesh.visible = false; if (sized.glint) sized.glint.visible = false; } },
    tick(f) {
      if (!options.on || f.night <= 0.02) { if (sized) { sized.mesh.visible = false; if (sized.glint) sized.glint.visible = false; } return false; }
      const s = size();
      frame++;
      // WHAT STANDS, AND ON WHAT: sent again when either changes.
      let decks = seenDecks;
      if (f.decks && (frame % 32 === 1 || f.sceneRev !== seenScene)) {
        decks = 0;
        for (let i = 0; i < f.decks.on.length; i++) if (f.decks.on[i]) decks = (Math.imul(decks, 31) + i * 64 + f.decks.z[i] + 129) | 0;
      }
      if (f.sceneRev !== seenScene || decks !== seenDecks) {
        seenScene = f.sceneRev; seenDecks = decks; deckTop = -1e3;
        const k = 255 / HEIGHT_SPAN, tw = SW / Q;
        for (let i = 0, o = 0; i < SW * SH; i++, o += 4) {
          sceneBytes[o] = Math.min(255, Math.round(f.casts[i] * k));
          sceneBytes[o + 1] = Math.max(0, Math.min(255, Math.round((f.heights[i] - f.low) * k)));
          // (A deck over this quarter-tile, and how high: nothing, where there is none.)
          const tile = f.decks ? (((i / SW) | 0) >> 2) * tw + ((i % SW) >> 2) : -1;
          const deck = tile >= 0 && f.decks!.on[tile] !== 0;
          sceneBytes[o + 2] = deck ? Math.max(1, Math.min(255, Math.round((f.decks!.z[tile] - f.low) * k))) : 0;
          if (deck) deckTop = Math.max(deckTop, f.decks!.z[tile]);
        }
        // THE HIGHEST THING NEAR each quarter-tile, its fourth number: over the two tiles before its own and the one
        // after, each way — more than what a tile of a line of sight ending there can meet (five quarter-tiles
        // before it and one after), and a tile at a time so a town's worth is a millisecond when a building changes
        // and not ten. @see highNear
        const TW = SW / Q, TH = SH / Q;
        if (high.length !== TW * TH) { high = new Uint8Array(TW * TH); highRow = new Uint8Array(TW * TH); }
        high.fill(0);
        for (let y = 0; y < SH; y++) {
          const row = (y >> 2) * TW;
          for (let x = 0, o = y * SW * 4; x < SW; x++, o += 4) {
            const v = sceneBytes[o] + sceneBytes[o + 1], t = row + (x >> 2);
            if (v > high[t]) high[t] = v > 255 ? 255 : v;
          }
        }
        for (let ty = 0; ty < TH; ty++) for (let tx = 0, r = ty * TW; tx < TW; tx++) {
          let m = 0;
          for (let a = Math.max(0, tx - 2), b = Math.min(TW - 1, tx + 1); a <= b; a++) { const v = high[r + a]; if (v > m) m = v; }
          highRow[r + tx] = m;
        }
        for (let ty = 0; ty < TH; ty++) {
          const y0 = Math.max(0, ty - 2), y1 = Math.min(TH - 1, ty + 1);
          for (let tx = 0; tx < TW; tx++) {
            let m = 0;
            for (let a = y0; a <= y1; a++) { const v = highRow[a * TW + tx]; if (v > m) m = v; }
            for (let dy = 0; dy < Q; dy++) for (let dx = 0, o = (((ty * Q + dy) * SW) + tx * Q) * 4 + 3; dx < Q; dx++, o += 4) sceneBytes[o] = m;
          }
        }
        device.queue.writeTexture({ texture: sceneGpu }, sceneBytes, { bytesPerRow: SW * 4 }, [SW, SH]);
      }
      if (options.walls !== seenWalls) {
        seenWalls = options.walls;
        for (const l of s.layers) for (const v of l.levels) device.queue.writeBuffer(v.u, 32, new Float32Array([options.walls ? 1 : 0]));
      }
      const water = options.water ? f.water : null;
      // NO OFTENER THAN SIXTY TIMES A SECOND, however fast the frames come: the light lies in its texture between
      // times, and worked out at every frame of two hundred a second it was three times the work for nothing seen.
      // At once, all the same, when what it is made from has changed. @see all
      const now = performance.now();
      const stale = fresh !== s.key || freshScene !== f.sceneRev || freshWindows !== (options.floors && f.windows ? f.windows.rev : windowRev) || freshWalls !== options.walls || (!!water && s.glintOf !== water.depth);
      work: {
      if (!stale && now - worked < WORK_EVERY) break work;
      worked = now; turns++;
      const n = Math.min(f.lights.length, MAX_LIGHTS);
      for (let i = 0; i < n; i++) {
        const l = f.lights[i], o = i * FLOATS;
        lightData[o] = l.x; lightData[o + 1] = l.y; lightData[o + 2] = l.hx; lightData[o + 3] = l.hy; lightData[o + 4] = l.r; lightData[o + 5] = l.g; lightData[o + 6] = l.b; lightData[o + 7] = l.solid;
        // (No number: always lit.)
        lightData[o + 8] = l.z ?? 0; lightData[o + 9] = -1; lightData[o + 10] = 0; lightData[o + 11] = 0;
      }
      if (n) device.queue.writeBuffer(lightBuf, 0, lightData, 0, n * FLOATS);
      // THE WINDOWS, sent once for each state of the town: which are lit is the shader's to say, by the clock.
      const wins = options.floors ? f.windows : undefined;
      if (wins && wins.rev !== windowRev) {
        windowRev = wins.rev; windowN = wins.n;
        const old = windowBuf;
        if (old) setTimeout(() => old.destroy(), 500);
        windowBuf = wins.n ? device.createBuffer({ size: wins.n * FLOATS * 4, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST }) : null;
        if (windowBuf) device.queue.writeBuffer(windowBuf, 0, wins.data, 0, wins.n * FLOATS);
      }
      const clock = new Float32Array([f.clock, f.share, 0, 0]);
      s.layers.forEach((l, li) => {
        device.queue.writeBuffer(l.emitU, 32, clock);
        device.queue.writeBuffer(l.finalU, 0, new Float32Array([options.gain * f.night, li * s.px, 0, 0]));
      });

      // THE WATER GIVES THE LIGHT BACK: a second sheet over the first, added, where there is water to read.
      if (water && s.glintOf !== water.depth) {
        s.glint?.parent?.removeChild(s.glint); s.glint?.destroy();
        const oldField = s.field, oldMask = s.mask;
        if (oldField) setTimeout(() => { oldField.destroy(); oldMask?.destroy(); }, 500);
        const field = new BufferImageSource({ resource: new Uint16Array(FW * FH * 4), width: FW, height: FH, format: "rgba16float", scaleMode: "linear" });
        s.field = field; s.fieldView = sys.texture!.getGpuSource(field).createView();
        s.fieldBind = device.createBindGroup({ layout: fieldLayout, entries: [
          { binding: 0, resource: { buffer: fieldU } }, { binding: 1, resource: s.lightView }, { binding: 2, resource: linear },
          { binding: 3, resource: sceneGpu.createView() }, { binding: 4, resource: sys.texture!.getGpuSource(water.depth as TextureSource).createView() }, { binding: 5, resource: sys.texture!.getGpuSource(water.bed as TextureSource).createView() },
        ] });
        const mask = new BufferImageSource({ resource: new Uint8Array(w * h), width: w, height: h, format: "r8unorm", scaleMode: "linear" });
        s.mask = mask; s.maskView = sys.texture!.getGpuSource(mask).createView();
        s.maskBind = device.createBindGroup({ layout: maskPipe.getBindGroupLayout(0), entries: [
          { binding: 0, resource: { buffer: maskU } }, { binding: 1, resource: s.fieldView },
          { binding: 2, resource: sys.texture!.getGpuSource(water.depth as TextureSource).createView() },
        ] });
        device.queue.writeBuffer(maskU, 0, new Float32Array([FW, FH, w, h, h * Q, 0, 0, 0]));
        fieldFresh = true;
        const shader = new Shader({
          gpuProgram: GpuProgram.from({
            vertex: { source: GLINT_WGSL, entryPoint: "mainVertex" }, fragment: { source: GLINT_WGSL, entryPoint: "mainFragment" }, name: "gi-glint",
            layout: [{ globalUniforms: 0 }, { localUniforms: 0 }, { sheet: 0, uLight: 1, uLightSampler: 2, uSceneTex: 3, uDepth: 4, uField: 5, glint: 6, uMask: 7 }],
            gpuLayout: [
              [{ binding: 0, visibility: 3, buffer: { type: "uniform" } }],
              [{ binding: 0, visibility: 3, buffer: { type: "uniform" } }],
              [
                { binding: 0, visibility: 2, buffer: { type: "uniform" } },
                { binding: 1, visibility: 2, texture: { sampleType: "float", viewDimension: "2d", multisampled: false } },
                { binding: 2, visibility: 2, sampler: { type: "filtering" } },
                { binding: 3, visibility: 2, texture: { sampleType: "float", viewDimension: "2d", multisampled: false } },
                { binding: 4, visibility: 2, texture: { sampleType: "unfilterable-float", viewDimension: "2d", multisampled: false } },
                { binding: 5, visibility: 2, texture: { sampleType: "float", viewDimension: "2d", multisampled: false } },
                { binding: 6, visibility: 2, buffer: { type: "uniform" } },
                { binding: 7, visibility: 2, texture: { sampleType: "float", viewDimension: "2d", multisampled: false } },
              ],
            ],
          }),
          resources: { sheet: s.sheetU, uLight: s.light, uLightSampler: s.light.style, uSceneTex: scene, uDepth: water.depth, uField: field, glint: s.glintU, uMask: mask },
        });
        const g2 = new Mesh<Geometry, Shader>({ geometry: s.mesh.geometry, shader });
        g2.eventMode = "none"; g2.blendMode = "add"; g2.zIndex = zIndex + 0.5;
        world.addChild(g2);
        s.glint = g2; s.glintOf = water.depth;
      }
      // (Every other frame: the ripples that move it are the screen's, and a light on the water a frame late is not seen to be.)
      const fieldDue = !!water && !options.only && !!s.fieldBind && (fieldFresh || turns % 2 === 0);
      if (fieldDue) device.queue.writeBuffer(fieldU, 0, new Float32Array([(s.px * options.spacing) / Q, (s.py * options.spacing) / Q, s.heights.length, GLINT, s.heights[0] ?? 0, s.heights[1] ?? 0, s.heights[2] ?? 0, s.heights[3] ?? 0, w, h, f.low, 0]));
      if (fieldDue) device.queue.writeBuffer(glareU, 0, new Float32Array([SW, SH, GLARE_WINDOW, GLARE_LIGHT, f.clock, f.share, 0, 0]));
      const enc = device.createCommandEncoder();
      const timed = stamps && !stamps.busy && turns % 30 === 0 ? stamps : null;
      const pass = (view: GPUTextureView, load = false, first = false, last = false, label = "gi") => enc.beginRenderPass({
        label,
        colorAttachments: [{ view, loadOp: load ? "load" : "clear", storeOp: "store", clearValue: [0, 0, 0, 0] }],
        ...(timed && (first || last) ? { timestampWrites: { querySet: timed.set, ...(first ? { beginningOfPassWriteIndex: 0 } : {}), ...(last ? { endOfPassWriteIndex: 1 } : {}) } } : {}),
      });
      // THE BEAMS, every time: a car is somewhere else each frame. (Once more when there are none left, to clear them.)
      const beams = options.headlights ? Math.min(f.beams?.n ?? 0, MAX_BEAMS) : 0;
      if (beams || beamsIn) {
        beamsIn = beams > 0;
        if (beams) { device.queue.writeBuffer(beamBuf, 0, f.beams!.data, 0, beams * BEAM_FLOATS); device.queue.writeBuffer(beamU, 12, new Float32Array([f.low])); }
        const bp = pass(beamView, false, false, false, "gi beams");
        if (beams) { bp.setPipeline(beamPipe); bp.setBindGroup(0, beamBind); bp.setVertexBuffer(0, beamBuf); bp.draw(6, beams); }
        bp.end();
      }
      const steady = Math.min(n, f.lights.length - (f.heads ?? 0));
      // NOT EVERY HEIGHT EVERY FRAME. The street's light moves with every car and is worked out each frame; the
      // heights over it change as windows come on and go out, over a second or more, and take turns — one of them
      // a frame. All of them at once when anything they are made from has changed: what is built, the options.
      const all = fresh !== s.key || freshScene !== f.sceneRev || freshWindows !== windowRev || freshWalls !== options.walls;
      fresh = s.key; freshScene = f.sceneRev; freshWindows = windowRev; freshWalls = options.walls;
      const turn = s.layers.length > 1 ? 1 + (turns % (s.layers.length - 1)) : 0;
      const due = s.layers.map((_l, li) => all || li === 0 || li === turn);
      const firstDue = due.indexOf(true), lastDue = due.lastIndexOf(true);
      s.layers.forEach((l, li) => {
        if (!due[li]) return;
        // This height's lights; then the cascades from the furthest in; then its light, into its own stretch.
        const e = pass(emitViews[0], false, li === firstDue, false, `gi emit ${li}`);
        e.setPipeline(emitPipe); e.setBindGroup(0, l.emitBind);
        if (steady) { e.setVertexBuffer(0, lightBuf); e.draw(6, steady); }
        if (wins && windowBuf && windowN) { e.setVertexBuffer(0, windowBuf); e.draw(6, windowN); }
        e.end();
        for (let m = 0; m < 2; m++) {
          const sp = pass(emitViews[m + 1], false, false, false, `gi shrink ${m}`);
          sp.setPipeline(shrinkPipe); sp.setBindGroup(0, shrinkBinds[m]); sp.draw(3);
          sp.end();
        }
        for (let i = s.count - 1; i >= 0; i--) {
          const p = pass(s.chain[i].view, false, false, false, `gi cascade ${i}`);
          p.setPipeline(cascPipe); p.setBindGroup(0, l.levels[i].bind); p.draw(3);
          p.end();
        }
        // (Its own stretch written over; the others' kept as they were last worked out.)
        const fin = pass(s.lightView, !(all && li === 0), false, li === lastDue && !fieldDue, `gi final ${li}`);
        fin.setViewport(li * s.px, 0, s.px, s.py, 0, 1);
        fin.setPipeline(finalPipe); fin.setBindGroup(0, l.finalBind); fin.draw(3);
        fin.end();
      });
      if (fieldDue) {
        fieldFresh = false;
        const fp = pass(s.fieldView!, false, false, true, "gi field");
        fp.setPipeline(fieldPipe); fp.setBindGroup(0, s.fieldBind!); fp.draw(3);
        fp.setPipeline(glarePipe); fp.setBindGroup(0, glareBind);
        if (n) { fp.setVertexBuffer(0, lightBuf); fp.draw(12, n); }
        if (wins && windowBuf && windowN) { fp.setVertexBuffer(0, windowBuf); fp.draw(12, windowN); }
        fp.end();
        // AND WHERE THE LIT WATER IS, for the screen to ask first: a point for each square of the field. @see MASK_WGSL
        if (s.maskView && s.maskBind) {
          const mp = pass(s.maskView, false, false, false, "gi mask");
          mp.setPipeline(maskPipe); mp.setBindGroup(0, s.maskBind); mp.draw(FW * FH);
          mp.end();
        }
      }
      if (timed) { enc.resolveQuerySet(timed.set, 0, 2, timed.resolve, 0); enc.copyBufferToBuffer(timed.resolve, 0, timed.read, 0, 16); }
      device.queue.submit([enc.finish()]);
      if (timed) {
        timed.busy = true;
        timed.read.mapAsync(GPUMapMode.READ).then(() => {
          const t = new BigInt64Array(timed.read.getMappedRange().slice(0));
          timed.read.unmap(); timed.busy = false;
          lastMs = Number(t[1] - t[0]) / 1e6;
        }).catch(() => { timed.busy = false; });
      }
      }

      const g = s.sheetU.uniforms.uGrade as Float32Array;
      if (options.only) { g[0] = 0; g[1] = 0; g[2] = 0; g[3] = 1; }
      else { g[0] = ((f.grade >> 16) & 255) / 255; g[1] = ((f.grade >> 8) & 255) / 255; g[2] = (f.grade & 255) / 255; g[3] = 0; }
      // (As far toward the eye as the tallest thing could stand in the way: four half steps up a tile.)
      (s.sheetU.uniforms.uMap as Float32Array)[2] = Math.min(14, Math.max(0.4, f.top / 4 + 0.4));
      (s.sheetU.uniforms.uScene as Float32Array)[2] = f.low;
      if (f.face && s.mesh.shader!.resources.uFace !== f.face) s.mesh.shader!.resources.uFace = f.face;
      (s.sheetU.uniforms.uScene as Float32Array)[3] = beamsIn ? Math.min(1, f.night * 1.2) : 0;
      s.sheetU.update();
      s.mesh.visible = true;
      if (s.glint) {
        // (Nothing lit, nothing given back: the sheet is not drawn over the screen to find that out a pixel at a time.)
        s.glint.visible = !!water && !options.only && (f.lights.length > 0 || (options.floors && windowN > 0));
        const u = s.glintU.uniforms.uGlint as Float32Array;
        u[0] = GLINT; u[1] = f.clock; u[2] = deckTop;
        s.glintU.update();
      }
      return true;
    },
    destroy() {
      unsize();
      setTimeout(() => { emit.destroy(); beamTex.destroy(); noFace.destroy(); beamBuf.destroy(); lightBuf.destroy(); windowBuf?.destroy(); scene.destroy(); stamps?.set.destroy(); stamps?.resolve.destroy(); stamps?.read.destroy(); }, 600);
    },
  };
}
