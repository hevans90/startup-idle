/**
 * World v2 — LIT WINDOWS, each its own.
 *
 * A building lit at night was one soft glow hung in front of it: the same blur on a cottage and a tower, on no
 * floor in particular, shining through whatever stood in front. Here the light is in the windows themselves —
 * their own shapes, taken from the model each building is made from — and a window a nearer building stands in
 * front of is not drawn.
 *
 * NOT EVERY WINDOW, AND NOT FOR GOOD. Each window keeps its own hours: lit or dark for a few minutes at a time,
 * its own minutes, more of them lit in the evening than in the small hours — worked out in the shader from a
 * number each window is given and the clock, so the town's lights come and go with nothing built again. A lit
 * window is its pane, warm or cold as the room behind it is, and the glow round it.
 *
 * AND THEIR LIGHT FALLS OUTSIDE. The windows of a ground floor light the street in front of them: each face's lit
 * windows, counted by the same hours, are a light just outside its wall for the map's own light to carry — out
 * from the wall, and not back through it. @see gi.ts
 *
 * THE WINDOWS ARE THE MODELS' OWN. A house is its kit's parts (@see houses/models): the panes of its ground floor,
 * of each floor over it and of its roof, as the sheet was baked from. A project's or a landmark's building is its
 * masses (@see structures/projects/model): each floor of each seen face, by its facade — windows in their bays, a
 * ribbon, a wall of glass.
 *
 * HIDDEN BY WHAT STANDS IN FRONT. There is no depth to ask: a window looks toward the eye — a tile nearer along
 * both axes for every four half steps the line of sight climbs — over what is built (@see ground-mesh castGround),
 * and if a roof stands in that line the window is behind it. A window whole, shown or not: a half-hidden one is
 * one or the other.
 * @see gi.ts, lights.ts
 */
import { Buffer, BufferUsage, Geometry, GlProgram, GpuProgram, Mesh, Shader, UniformGroup, type Container } from "pixi.js";
import { HALF_STEPS_PER_M, TILES_PER_M } from "../agents/cars/models";
import { footprintCells, idx, inBounds, type Grid, type Structure } from "../grid";
import { houseOf } from "../houses/models";
import { HEIGHT_UNIT, HH, HW } from "../iso";
import { HOUSE_PLOT } from "../landmarks/models";
import { hasYard } from "../landmarks/yard";
import { structureDef } from "../structures/def";
import { lookOf } from "../structures/projects/looks";
import { bays, floorsOf, type Facade, type Mass } from "../structures/projects/model";
import { floorsFor, kitIdOf } from "../structures/tiles-renderer";
import { WINDOW_FLOATS, windowLight } from "./gi";
import { SHADE_PER_TILE, type GroundMesh } from "./ground-mesh";

/** A window: on the face toward +u (`face` 0, at `u = at`, from `a0` to `a1` along `v`) or toward +v (1), tiles; from `z0` to `z1` up, half steps; and its floor. */
export type Win = { face: 0 | 1; at: number; a0: number; a1: number; z0: number; z1: number; floor: number };
type V3 = [number, number, number];

/** The windows a set of panes' triangles make: the two halves of a pane are one window, and a pane's own edge, seen side on, is none. */
function winsOf(tris: readonly { p: V3[]; n: V3 }[], floor: number): Win[] {
  const by = new Map<string, Win>();
  for (const t of tris) {
    if (!(t.n[0] > 0.7 || t.n[1] > 0.7)) continue;
    const face: 0 | 1 = t.n[0] > 0.7 ? 0 : 1, along = face === 0 ? 1 : 0;
    const at = t.p[0][face], a0 = Math.min(t.p[0][along], t.p[1][along], t.p[2][along]), a1 = Math.max(t.p[0][along], t.p[1][along], t.p[2][along]);
    const z0 = Math.min(t.p[0][2], t.p[1][2], t.p[2][2]), z1 = Math.max(t.p[0][2], t.p[1][2], t.p[2][2]);
    if (a1 - a0 < 0.02 || z1 - z0 < 0.05) continue;
    by.set(`${face}|${at.toFixed(3)}|${a0.toFixed(3)}|${a1.toFixed(3)}|${z0.toFixed(2)}|${z1.toFixed(2)}`, { face, at, a0, a1, z0, z1, floor });
  }
  return [...by.values()];
}

/** A kit's windows by part — its ground floor, each kind of floor over it, its roof — found once. Tiles from the house's middle, half steps from the part's foot. */
const kits = new Map<string, { ground: Win[]; mids: Win[][]; roof: Win[] } | null>();
function kitWins(kit: string) {
  let k = kits.get(kit);
  if (k !== undefined) return k;
  const house = houseOf(kit);
  if (!house) { kits.set(kit, null); return null; }
  const parts = house.parts();
  // (Window panes only: a glass roof or a canopy is not a lit room.)
  const of = (tris: readonly { p: V3[]; mat: string; n: V3 }[]) =>
    winsOf(tris.filter((t) => t.mat === "pane").map((t) => ({ n: t.n, p: t.p.map((q) => [q[0] * TILES_PER_M, q[1] * TILES_PER_M, q[2] * HALF_STEPS_PER_M] as V3) })), 0);
  k = { ground: of(parts.ground), mids: parts.mids.map(of), roof: of(parts.roof) };
  kits.set(kit, k);
  return k;
}

/** A facade's glass on one floor of one face, as rectangles: from `a0` to `a1` along the face, tiles, and `z0` to `z1` up it, half steps. */
function glassOf(fa: Facade, len: number, z0: number, z1: number): [number, number, number, number][] {
  if (fa.kind === "windows") return bays(len, fa.w, fa.gap, fa.edge ?? 0.12).map(([a, b]) => [a, b, z0 + fa.sill, z1 - fa.head]);
  // (A ribbon, a wall of glass: a room's width of it each, so each is lit by itself.)
  const rooms = (e: number, s0: number, s1: number): [number, number, number, number][] => {
    const n = Math.max(1, Math.round((len - e * 2) / 0.32)), w = (len - e * 2) / n;
    return Array.from({ length: n }, (_v, k) => [e + k * w + 0.012, e + (k + 1) * w - 0.012, s0, s1]);
  };
  if (fa.kind === "ribbon") return rooms(fa.edge ?? 0.1, z0 + fa.sill, z1 - fa.head);
  if (fa.kind === "curtain" || fa.kind === "fins") return rooms(0.03, z0 + (fa.kind === "curtain" && fa.spandrel !== undefined ? 0.3 : 0.08), z1 - 0.08);
  return [];
}

/**
 * Every window of a building as it stands, where it is on the map: tiles (a cell's middle at its whole number, as
 * the map's projection has it) and half steps over the building's ground.
 */
export function windowsOf(s: Structure): Win[] {
  const def = structureDef(s.def);
  if (!def || s.build) return [];
  const out: Win[] = [];
  if (def.render.kind === "tiles") {
    const kit = kitIdOf(def), k = kit ? kitWins(kit) : null, house = kit ? houseOf(kit) : undefined;
    if (!k || !house) return [];
    const floors = Math.max(1, floorsFor(def, s, true)), storey = house.storey * HALF_STEPS_PER_M;
    // (As the pieces are stacked: the ground floor, each floor over it a storey higher, the roof on the last. @see housePieces)
    const stack: [Win[], number, number][] = [[k.ground, 0, 0]];
    if (k.mids.length) for (let f = 1; f < floors; f++) stack.push([k.mids[(s.id + f) % k.mids.length], (f - 1) * storey, f]);
    stack.push([k.roof, ((k.mids.length ? floors : 1) - 1) * storey, k.mids.length ? floors : 1]);
    for (const c of footprintCells(s.x, s.y, s.w, s.h)) for (const [wins, lift, floor] of stack) {
      const cu = c.x, cv = c.y;
      for (const w of wins) out.push({ face: w.face, at: w.at + (w.face === 0 ? cu : cv), a0: w.a0 + (w.face === 0 ? cv : cu), a1: w.a1 + (w.face === 0 ? cv : cu), z0: w.z0 + lift, z1: w.z1 + lift, floor });
    }
    return out;
  }
  if (def.render.rendererId !== "project") return [];
  // (A landmark in its yard is its own three tiles of it, the yard beside. @see landmarks/models landmarkTris)
  const b = lookOf(s.def, hasYard(s) ? HOUSE_PLOT : { w: s.w, h: s.h }), ou = s.x - 0.5, ov = s.y - 0.5;
  let base = 0;
  for (const m of b.masses as readonly Mass[]) {
    const { n, h } = floorsOf(m);
    for (let k = 0; k < n; k++) {
      const fa = k === 0 && m.ground ? m.ground : m.facade, z0 = m.z0 + k * h, z1 = z0 + h;
      for (const [a, c, s0, s1] of glassOf(fa, m.u1 - m.u0, z0, z1)) out.push({ face: 1, at: ov + m.v1, a0: ou + m.u0 + a, a1: ou + m.u0 + c, z0: s0, z1: s1, floor: base + k });
      for (const [a, c, s0, s1] of glassOf(fa, m.v1 - m.v0, z0, z1)) out.push({ face: 0, at: ou + m.u1, a0: ov + m.v0 + a, a1: ov + m.v0 + c, z0: s0, z1: s1, floor: base + k });
    }
    base += n;
  }
  return out;
}

/** Whether a kind of building has windows to light at all: a quay, a yard, a shed have none, and are lit as they were. */
const windowed = new Map<string, boolean>();
export function hasWindows(s: Structure): boolean {
  const key = `${s.def}|${s.w}x${s.h}`;
  let has = windowed.get(key);
  if (has === undefined) windowed.set(key, (has = windowsOf(s).length > 0));
  return has;
}

/** A window's own number, 0–1: what its hours and its colour are worked out from. The same every time it is asked. */
export function seedOf(id: number, w: Win): number {
  let h = Math.imul(id + 1, 0x9e3779b1) ^ Math.imul(Math.round(w.a0 * 97) + w.face * 7919, 0x85ebca6b) ^ Math.imul(Math.round(w.z0 * 31) + 13, 0xc2b2ae35);
  h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d); h ^= h >>> 12;
  return ((h >>> 0) % 4096) / 4096;
}
/** How long a window keeps to being lit or dark before it may change, seconds; and how long the change takes. */
export const HOURS = 150, FADE = 1.5;
const fract = (x: number) => x - Math.floor(x);
const roll = (a: number, b: number) => fract(Math.sin(Math.fround(a * 127.1 + b * 311.7)) * 43758.5453);
/** Whether the window of `seed` is lit at `t` seconds, `share` of all windows being lit: the shader's own sum, here for the light that falls outside. */
export const litAt = (seed: number, t: number, share: number) => roll(seed, Math.floor(t / HOURS + seed * 13)) < share;
/** How many of a town's windows are lit, by how far through the night it is (0 dusk … 1 dawn): most in the evening, few by morning. */
export const litShare = (through: number) => 0.62 - 0.5 * Math.min(1, Math.max(0, through));

/** The bridges' decks, a tile: which tiles have one, and how high it runs, half steps. */
export type Decks = { on: Uint8Array; z: Int8Array };
/**
 * Whether a point `z` half steps up (from the map's zero) at `(u, v)` is hidden from the eye by what stands nearer:
 * along the line of sight — a tile along both axes for every four half steps up — over the ground and what is
 * built on it, a quarter-tile at a time.
 *
 * ERRING TOWARD HIDDEN. What is built is known here as boxes, and a box is a little smaller than the building
 * drawn — its eaves, its ridge, its cornice stand past it. So a building counts for a quarter-tile wider all round
 * and most of a storey taller than its box: a window lit through a roof is seen at once, and one put out a little
 * early behind an eave is not.
 */
export function hiddenAt(gm: Pick<GroundMesh, "heights" | "casts" | "w" | "h">, u: number, v: number, z: number, grow = 1, slack = 1.1, decks?: Decks): boolean {
  const S = SHADE_PER_TILE, W = gm.w * S, H = gm.h * S;
  // (From past the wall it is on and that wall's own quarter-tile of grace; as far as the tallest thing could reach.)
  for (let t = 0.55; t < 9; t += 1 / S) {
    const i = Math.floor((u + 0.5 + t) * S), j = Math.floor((v + 0.5 + t) * S);
    if (i < 1 || j < 1 || i >= W - 1 || j >= H - 1) return false;
    // (`grow` and `slack`: how many quarter-tiles wider, and how much taller, a building counts for. A window's are
    // the generous ones above; a thing out in the street, far from any wall, is asked more exactly.)
    const line = z + 4 * t - slack;
    // (A bridge's deck in the way: the line of sight through the slab of it, and its girders under.)
    if (decks) {
      const tile = Math.floor(v + 0.5 + t) * gm.w + Math.floor(u + 0.5 + t), up = z + 4 * t - decks.z[tile];
      if (decks.on[tile] !== 0 && up >= -1.5 && up <= 0.75) return true;
    }
    for (let dj = -grow; dj <= grow; dj++) for (let di = -grow; di <= grow; di++) {
      const o = (j + dj) * W + i + di;
      if (gm.casts[o] > 0 && gm.heights[o] + gm.casts[o] > line) return true;
    }
  }
  return false;
}
/** Whether any of a window is hidden: its middle, or either end of its head or its sill. A window half behind a roof is not drawn. */
export function windowHidden(gm: Pick<GroundMesh, "heights" | "casts" | "w" | "h">, w: Win, ground: number, decks?: Decks): boolean {
  const at = (a: number, z: number) => (w.face === 0 ? hiddenAt(gm, w.at, a, ground + z, 1, 1.1, decks) : hiddenAt(gm, a, w.at, ground + z, 1, 1.1, decks));
  return at((w.a0 + w.a1) / 2, (w.z0 + w.z1) / 2) || at(w.a0, w.z0) || at(w.a1, w.z0) || at(w.a0, w.z1) || at(w.a1, w.z1);
}

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
// How dark it is; the clock, s; how many windows are lit, 0–1; unused. And the buildings cut down to their ground floors, by their ids (-1: none).
struct Lit { uNight: vec4<f32>, uCutA: vec4<f32>, uCutB: vec4<f32>, uCutC: vec4<f32>, uCutD: vec4<f32> };
@group(2) @binding(0) var<uniform> lit : Lit;
struct VSOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) vUv: vec2<f32>,
  @location(1) vCore: vec2<f32>,
  @location(2) vColor: vec4<f32>,
};
fn roll(a: f32, b: f32) -> f32 { return fract(sin(a * 127.1 + b * 311.7) * 43758.5453); }
@vertex
fn mainVertex(@location(0) aPosition: vec2<f32>, @location(1) aUv: vec2<f32>, @location(2) aCore: vec2<f32>, @location(3) aSeed: vec2<f32>, @location(4) aColor: vec3<f32>, @location(5) aOwner: vec2<f32>) -> VSOutput {
  let mvp = globalUniforms.uProjectionMatrix * globalUniforms.uWorldTransformMatrix * localUniforms.uTransformMatrix;
  var out: VSOutput;
  out.position = vec4<f32>((mvp * vec3<f32>(aPosition, 1.0)).xy, 0.0, 1.0);
  out.vUv = aUv; out.vCore = aCore;
  // ITS HOURS: lit or dark a stretch at a time, its own stretches, turning over a second or two.
  let seed = aSeed.x;
  let ph = lit.uNight.y / ${150}.0 + seed * 13.0; let slot = floor(ph); let f = ph - slot;
  let share = clamp(lit.uNight.z + aSeed.y, 0.0, 1.0);
  let now = step(roll(seed, slot), share); let was = step(roll(seed, slot - 1.0), share);
  var on = mix(was, now, smoothstep(0.0, ${1.5} / ${150}.0, f));
  // A BUILDING CUT DOWN to see past it has no floors over its ground floor: nor their windows.
  let o = vec4<f32>(aOwner.x);
  if (aOwner.y > 0.5 && (any(lit.uCutA == o) || any(lit.uCutB == o) || any(lit.uCutC == o) || any(lit.uCutD == o))) { on = 0.0; }
  // THE ROOM BEHIND IT: most warm, some brighter than others; here and there a screen's cold light.
  let k = roll(seed, 3.7); let cold = step(0.88, roll(seed, 9.1));
  let tone = mix(aColor, vec3<f32>(0.55, 0.72, 1.0), cold) * (0.55 + 0.6 * k);
  out.vColor = vec4<f32>(tone, on * lit.uNight.x);
  return out;
}
@fragment
fn mainFragment(in: VSOutput) -> @location(0) vec4<f32> {
  let a = abs(in.vUv);
  // How far outside the pane, 0 at its edge to 1 at the glow's.
  let d = max((a.x - in.vCore.x) / (1.0 - in.vCore.x), (a.y - in.vCore.y) / (1.0 - in.vCore.y));
  // THE PANE: brighter low, where the lamp in the room is, than up under its head. THE GLOW round it: gone by its edge.
  let pane = 0.62 + 0.3 * clamp(0.5 + in.vUv.y * 0.5 / max(in.vCore.y, 0.001), 0.0, 1.0);
  let halo = (1.0 - clamp(d, 0.0, 1.0)); 
  let v = mix(pane, 0.3 * halo * halo, step(0.0, d));
  return vec4<f32>(in.vColor.rgb * v * in.vColor.a, 0.0);
}
`;
const GLSL_VERTEX = /* glsl */ `#version 300 es
in vec2 aPosition;
in vec2 aUv;
in vec2 aCore;
in vec2 aSeed;
in vec3 aColor;
in vec2 aOwner;
out vec2 vUv;
out vec2 vCore;
out vec4 vColor;
uniform mat3 uProjectionMatrix;
uniform mat3 uWorldTransformMatrix;
uniform mat3 uTransformMatrix;
uniform vec4 uNight;
uniform vec4 uCutA; uniform vec4 uCutB; uniform vec4 uCutC; uniform vec4 uCutD;
float roll(float a, float b) { return fract(sin(a * 127.1 + b * 311.7) * 43758.5453); }
void main() {
  mat3 mvp = uProjectionMatrix * uWorldTransformMatrix * uTransformMatrix;
  gl_Position = vec4((mvp * vec3(aPosition, 1.0)).xy, 0.0, 1.0);
  vUv = aUv; vCore = aCore;
  float seed = aSeed.x;
  float ph = uNight.y / ${150}.0 + seed * 13.0; float slot = floor(ph); float f = ph - slot;
  float share = clamp(uNight.z + aSeed.y, 0.0, 1.0);
  float now = step(roll(seed, slot), share); float was = step(roll(seed, slot - 1.0), share);
  float on = mix(was, now, smoothstep(0.0, ${1.5} / ${150}.0, f));
  vec4 o = vec4(aOwner.x);
  if (aOwner.y > 0.5 && (any(equal(uCutA, o)) || any(equal(uCutB, o)) || any(equal(uCutC, o)) || any(equal(uCutD, o)))) on = 0.0;
  float k = roll(seed, 3.7); float cold = step(0.88, roll(seed, 9.1));
  vec3 tone = mix(aColor, vec3(0.55, 0.72, 1.0), cold) * (0.55 + 0.6 * k);
  vColor = vec4(tone, on * uNight.x);
}
`;
const GLSL_FRAGMENT = /* glsl */ `#version 300 es
precision highp float;
in vec2 vUv;
in vec2 vCore;
in vec4 vColor;
out vec4 finalColor;
void main() {
  vec2 a = abs(vUv);
  float d = max((a.x - vCore.x) / (1.0 - vCore.x), (a.y - vCore.y) / (1.0 - vCore.y));
  float pane = 0.62 + 0.3 * clamp(0.5 + vUv.y * 0.5 / max(vCore.y, 0.001), 0.0, 1.0);
  float halo = 1.0 - clamp(d, 0.0, 1.0);
  float v = mix(pane, 0.3 * halo * halo, step(0.0, d));
  finalColor = vec4(vColor.rgb * v * vColor.a, 0.0);
}
`;

export type LitWindows = {
  /**
   * Put the windows where the map's buildings are now: `lit`, each lit building's colour by its id, and how much
   * likelier than a house's its windows are to be lit (an office at work). Gone over only when `key` — whatever
   * says the buildings, what stands in front of them or their lights have changed — has.
   */
  sync: (g: Grid, gm: GroundMesh, lit: ReadonlyMap<number, { colour: number; bias: number }>, scale: number, key: string) => void;
  /** This frame: how dark it is (0–1), the clock (s), how many windows are lit (0–1), and the buildings cut down to their ground floors now. */
  tick: (night: number, t: number, share: number, cut?: ReadonlySet<number>) => void;
  /** Every window as a light for the map's own — seen or not, it shines — each just outside its wall at its own height, `k` strong; and a count that moves when they do. @see gi windowLight */
  emitters: (k: number) => { data: Float32Array; n: number; rev: number };
  /** How many windows are drawn, and how many were hidden behind something. */
  count: () => { shown: number; hidden: number };
  destroy: () => void;
};

let program: { gpu: GpuProgram; gl: GlProgram } | null = null;
/** Floats a corner: where, where in its glow, how much of the glow is pane, its number and its odds, its colour, whose it is and which floor's. */
const F = 13;
/** How far a window's glow reaches past its pane: of its own size, and at least so much, tiles and half steps. */
const HALO = 0.55, HALO_MIN = 0.035, HALO_MIN_Z = 0.16;

/** The lit windows, as `world`'s child — the map's own container — so they sit on their windows through every pan and zoom, in the frame the map moves. */
export function createLitWindows(world: Container, zIndex: number): LitWindows {
  const none = () => ({ value: new Float32Array([-1, -1, -1, -1]), type: "vec4<f32>" as const });
  const uniforms = new UniformGroup({ uNight: { value: new Float32Array([0, 0, 0, 0]), type: "vec4<f32>" }, uCutA: none(), uCutB: none(), uCutC: none(), uCutD: none() });
  program ??= {
    gpu: GpuProgram.from({
      vertex: { source: WGSL, entryPoint: "mainVertex" }, fragment: { source: WGSL, entryPoint: "mainFragment" }, name: "lit-windows",
      layout: [{ globalUniforms: 0 }, { localUniforms: 0 }, { lit: 0 }],
      gpuLayout: [[{ binding: 0, visibility: 3, buffer: { type: "uniform" } }], [{ binding: 0, visibility: 3, buffer: { type: "uniform" } }], [{ binding: 0, visibility: 3, buffer: { type: "uniform" } }]],
    }),
    gl: GlProgram.from({ vertex: GLSL_VERTEX, fragment: GLSL_FRAGMENT, name: "lit-windows" }),
  };
  const vb = new Buffer({ data: new Float32Array(F * 4), usage: BufferUsage.VERTEX | BufferUsage.COPY_DST });
  const ib = new Buffer({ data: new Uint32Array(6), usage: BufferUsage.INDEX | BufferUsage.COPY_DST });
  const at = (o: number, format: "float32x2" | "float32x3") => ({ buffer: vb, format, stride: F * 4, offset: o * 4 });
  const geometry = new Geometry({
    attributes: { aPosition: at(0, "float32x2"), aUv: at(2, "float32x2"), aCore: at(4, "float32x2"), aSeed: at(6, "float32x2"), aColor: at(8, "float32x3"), aOwner: at(11, "float32x2") },
    indexBuffer: ib,
  });
  const mesh = new Mesh<Geometry, Shader>({ geometry, shader: new Shader({ gpuProgram: program.gpu, glProgram: program.gl, resources: { lit: uniforms } }) });
  mesh.eventMode = "none";
  mesh.blendMode = "add";
  mesh.zIndex = zIndex;
  mesh.visible = false;
  world.addChild(mesh);
  let seen = "", shown = 0, hidden = 0;
  let lights: number[] = [], rev = 0;
  let packed: { k: number; rev: number; data: Float32Array; n: number } | null = null;
  return {
    sync(g, gm, lit, scale, key) {
      if (key === seen) return;
      seen = key; rev++;
      const v: number[] = [];
      shown = 0; hidden = 0; lights = [];
      const S = SHADE_PER_TILE;
      for (const [id, { colour, bias }] of lit) {
        const s = g.structures.get(id);
        if (!s || !inBounds(g, s.x, s.y)) continue;
        const ground = g.height[idx(g, s.x, s.y)];
        const r = ((colour >> 16) & 255) / 255, gr = ((colour >> 8) & 255) / 255, b = (colour & 255) / 255;
        for (const w of windowsOf(s)) {
          const seed = seedOf(id, w);
          const am = (w.a0 + w.a1) / 2;
          // ITS LIGHT, whether the eye sees it or not: just outside the wall it is in, as long as it is wide, at
          // its own height over the building's ground. Quarter-tiles, a cell's corner at its whole number.
          {
            // (No smaller than the light's own grid can see: a light finer than that is found by some of its probes
            // and missed by the rest, and a row of windows was a row of scallops on the pavement.)
            const out = (w.at + 0.5 + 0.3) * S, mid = (am + 0.5) * S, half = Math.max(1.1, ((w.a1 - w.a0) / 2) * S * 1.4);
            if (w.face === 0) lights.push(out, mid, 1.1, half, r, gr, b, (w.z0 + w.z1) / 2, seed, bias);
            else lights.push(mid, out, half, 1.1, r, gr, b, (w.z0 + w.z1) / 2, seed, bias);
          }
          if (windowHidden(gm, w, ground, { on: g.deck, z: g.deckZ })) { hidden++; continue; }
          shown++;
          // The pane and its glow round it: a quad on the wall's own plane, past the pane's edges.
          const ha = (w.a1 - w.a0) / 2, hz = (w.z1 - w.z0) / 2, pa = Math.max(HALO_MIN, ha * HALO), pz = Math.max(HALO_MIN_Z, hz * HALO);
          const core = [ha / (ha + pa), hz / (hz + pz)];
          for (const [ua, uz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
            const a = am + ua * (ha + pa), z = ground + (w.z0 + w.z1) / 2 + uz * (hz + pz), pu = w.face === 0 ? w.at : a, pv = w.face === 0 ? a : w.at;
            v.push((pu - pv) * HW * scale, ((pu + pv) * HH - z * HEIGHT_UNIT) * scale, ua, uz, core[0], core[1], seed, bias, r, gr, b, id, w.floor);
          }
        }
      }
      const n = v.length / (F * 4);
      // (Never empty: a buffer of nothing is not a buffer. One window of no size, where there are none.)
      vb.data = n ? new Float32Array(v) : new Float32Array(F * 4);
      const ix = new Uint32Array(Math.max(1, n) * 6);
      for (let q = 0; q < n; q++) ix.set([q * 4, q * 4 + 1, q * 4 + 2, q * 4, q * 4 + 2, q * 4 + 3], q * 6);
      ib.data = ix;
    },
    tick(night, t, share, cut) {
      mesh.visible = night > 0.02 && shown > 0;
      if (!mesh.visible) return;
      const u = uniforms.uniforms.uNight as Float32Array;
      u[0] = Math.min(1, night * 1.2); u[1] = t; u[2] = share;
      // (Sixteen at once: more than a hand's reach cuts down.)
      const ids = cut ? [...cut] : [];
      (["uCutA", "uCutB", "uCutC", "uCutD"] as const).forEach((name, k) => { const c = uniforms.uniforms[name] as Float32Array; for (let i = 0; i < 4; i++) c[i] = ids[k * 4 + i] ?? -1; });
      uniforms.update();
    },
    emitters(k) {
      if (packed && packed.k === k && packed.rev === rev) return packed;
      const n = lights.length / 10, data = new Float32Array(n * WINDOW_FLOATS);
      for (let i = 0; i < n; i++) { const o = i * 10; windowLight(data, i * WINDOW_FLOATS, lights[o], lights[o + 1], lights[o + 2], lights[o + 3], lights[o + 4] * k, lights[o + 5] * k, lights[o + 6] * k, lights[o + 7], lights[o + 8], lights[o + 9]); }
      return (packed = { k, rev, data, n });
    },
    count: () => ({ shown, hidden }),
    destroy() { mesh.parent?.removeChild(mesh); mesh.destroy(); geometry.destroy(true); },
  };
}
