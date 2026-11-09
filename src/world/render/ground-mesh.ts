/**
 * World v2 — THE GROUND, SHADED: grass, dirt and sand drawn by a shader on a
 * mesh per band, in place of the sheet's tiles. @see plans/procedural-ground.md
 *
 * ONE MESH A BAND, in the band's own static tier, so the painter's order is
 * the sprites' was: a hill in front still hides what is behind it. Each cell
 * the mesh draws is a top at its height and a wall down each face toward the
 * camera that stands over its neighbour — the two faces that can show, +x
 * down-right and +y down-left. A cell's walls hang below it into the bands in
 * front, which draw after, so a band's quads never need sorting among
 * themselves.
 *
 * THE LOOK IS WORKED OUT PER PIXEL, from where the pixel is on the ground. A
 * cell data texture holds each cell's material and height; the shader reads
 * the cells round a pixel and lets their materials reach into one another by
 * noise, so a border is ragged and no two fields are alike. Every pixel is a
 * function of its place in the world, so nothing has an edge to meet: no
 * bleed, no seams, no inner twins for the mip levels. Detail fades in with the
 * zoom, by how much ground a pixel covers.
 *
 * Cells it does not draw — ramps, woods, frames from the tile browser, the pit
 * under a building that clears it — keep their sprites. @see groundDraws
 */
import { BufferImageSource, Buffer, BufferUsage, Geometry, GlProgram, GpuProgram, Mesh, Shader, UniformGroup } from "pixi.js";

import { HEIGHT_UNIT, HH, HW, bandOf } from "../iso";
import { RAMP, VOID, idx, inBounds, rampDir, structureOf, type Grid } from "../grid";
import { structureDef } from "../structures/def";
import type { BandLayer } from "./bands";

/** What the shader draws a material as. 0 is nothing it knows. */
export const GROUND = { none: 0, grass: 1, dirt: 2, sand: 3 } as const;

/** The sheet frames the shader stands in for, and what it draws them as. Woods are grass under trees. */
const CLASS_OF: Record<string, number> = {
  "landscapeTiles_067.png": GROUND.grass,
  "landscapeTiles_083.png": GROUND.dirt,
  "landscapeTiles_059.png": GROUND.sand,
  "landscapeTiles_067_trees1.png": GROUND.grass,
  "landscapeTiles_067_trees2.png": GROUND.grass,
  "landscapeTiles_067_trees3.png": GROUND.grass,
};
/** Of those, the ones still drawn by their sprite: the trees are in the art. */
const SPRITE_STILL = new Set(["landscapeTiles_067_trees1.png", "landscapeTiles_067_trees2.png", "landscapeTiles_067_trees3.png"]);

export type Palette = readonly (string | null)[];

/** What a cell's material is to the shader, drawn by it or not: its neighbours blend toward it either way. */
export const groundClassOf = (palette: Palette, mat: number): number =>
  mat === VOID ? GROUND.none : CLASS_OF[palette[mat] ?? ""] ?? GROUND.none;

/** Whether a `clearsTerrain` structure stands on this cell. */
const hidden = (grid: Grid, x: number, y: number) => {
  const s = structureOf(grid, x, y);
  return s ? structureDef(s.def)?.clearsTerrain === true : false;
};

/** Whether the mesh draws this cell, top and walls; if not, its sprite does. */
export function groundDraws(grid: Grid, palette: Palette, x: number, y: number): boolean {
  if (!inBounds(grid, x, y)) return false;
  const i = idx(grid, x, y), frame = palette[grid.terrain[i]] ?? "";
  return grid.terrain[i] !== VOID && !!CLASS_OF[frame] && !SPRITE_STILL.has(frame)
    && rampDir(grid.ramp[i]) === RAMP.NONE && !hidden(grid, x, y);
}

/**
 * How far down a cell's face toward `(nx, ny)` shows, as the height it reaches.
 * Off the map, or over a void, at least one step: the plateau's own edge, as a
 * tile's skirt showed it. @see OFF_MAP_HEIGHT
 */
export function wallFoot(grid: Grid, x: number, y: number, nx: number, ny: number): number {
  const h = grid.height[idx(grid, x, y)];
  if (!inBounds(grid, nx, ny)) return Math.min(0, h - 2);
  const j = idx(grid, nx, ny);
  if (grid.terrain[j] === VOID) return Math.min(grid.height[j], h - 2);
  return Math.min(grid.height[j], h);
}

// ─── THE MESH ────────────────────────────────────────────────────────────────

/** Floats a vertex: world x, y; ground u, v (cells); kind (0 top, 1 face +x, 2 face +y); depth below the top, half steps. */
const WORDS = 6;
const STRIDE = WORDS * 4;

export type GroundMesh = {
  /** A texel a cell: class, height + 128, flags (1 drawn), spare. */
  cells: Uint8Array;
  source: BufferImageSource;
  uniforms: UniformGroup;
  meshes: Mesh<Geometry, Shader>[];
  /** Bands whose quads are out of date. */
  dirty: Set<number>;
  scale: number;
  w: number;
  h: number;
};

/** The quads of one band, as vertex floats and indices. Pure: for the mesh and for tests. */
export function bandQuads(grid: Grid, palette: Palette, b: number, scale = 1): { verts: Float32Array; idx: Uint32Array; quads: number } {
  const v: number[] = [];
  const at = (gu: number, gv: number, z: number, kind: number, depth: number) => {
    // A ground point (cells) at height z, where cellToWorld puts cell centres at +0.5.
    const cx = gu - 0.5, cy = gv - 0.5;
    v.push((cx - cy) * HW * scale, ((cx + cy) * HH - z * HEIGHT_UNIT) * scale, gu, gv, kind, depth);
  };
  const x0 = Math.max(0, b - (grid.h - 1)), x1 = Math.min(grid.w - 1, b);
  for (let x = x0; x <= x1; x++) {
    const y = b - x;
    if (!groundDraws(grid, palette, x, y)) continue;
    const h = grid.height[idx(grid, x, y)];
    // THE TOP, corners round its edge: (x, y), (x+1, y), (x+1, y+1), (x, y+1).
    at(x, y, h, 0, 0); at(x + 1, y, h, 0, 0); at(x + 1, y + 1, h, 0, 0); at(x, y + 1, h, 0, 0);
    // THE FACE ALONG x+1, down to what is in front of it.
    const fx = wallFoot(grid, x, y, x + 1, y);
    if (fx < h) { at(x + 1, y, h, 1, 0); at(x + 1, y + 1, h, 1, 0); at(x + 1, y + 1, fx, 1, h - fx); at(x + 1, y, fx, 1, h - fx); }
    // AND ALONG y+1.
    const fy = wallFoot(grid, x, y, x, y + 1);
    if (fy < h) { at(x, y + 1, h, 2, 0); at(x + 1, y + 1, h, 2, 0); at(x + 1, y + 1, fy, 2, h - fy); at(x, y + 1, fy, 2, h - fy); }
  }
  // Never empty: a buffer of nothing is no buffer at all to some drivers. One quad at a point draws nothing.
  if (!v.length) for (let k = 0; k < 4; k++) v.push(0, 0, 0, 0, 0, 0);
  const quads = v.length / WORDS / 4;
  const ix = new Uint32Array(quads * 6);
  for (let q = 0; q < quads; q++) {
    const o = q * 4;
    ix.set([o, o + 1, o + 2, o, o + 2, o + 3], q * 6);
  }
  return { verts: new Float32Array(v), idx: ix, quads };
}

/** Write one cell's texel. */
function writeCell(gm: GroundMesh, grid: Grid, palette: Palette, x: number, y: number) {
  const i = idx(grid, x, y), o = i * 4;
  gm.cells[o] = groundClassOf(palette, grid.terrain[i]);
  gm.cells[o + 1] = Math.max(0, Math.min(255, grid.height[i] + 128));
  gm.cells[o + 2] = groundDraws(grid, palette, x, y) ? 1 : 0;
  gm.cells[o + 3] = 255;
}

export function createGroundMesh(grid: Grid, bl: BandLayer, palette: Palette, scale = 1): GroundMesh {
  const cells = new Uint8Array(grid.w * grid.h * 4);
  const source = new BufferImageSource({ resource: cells, width: grid.w, height: grid.h, format: "rgba8unorm", scaleMode: "nearest" });
  const uniforms = new UniformGroup({
    uMap: { value: new Float32Array([grid.w, grid.h, 0, 0]), type: "vec4<f32>" },
  });
  const gm: GroundMesh = { cells, source, uniforms, meshes: [], dirty: new Set(), scale, w: grid.w, h: grid.h };
  for (let y = 0; y < grid.h; y++) for (let x = 0; x < grid.w; x++) writeCell(gm, grid, palette, x, y);
  source.update();
  const shader = groundShader(gm);
  for (let b = 0; b < bl.staticOf.length; b++) {
    const { verts, idx: ix } = bandQuads(grid, palette, b, scale);
    const vb = new Buffer({ data: verts, usage: BufferUsage.VERTEX | BufferUsage.COPY_DST });
    const ib = new Buffer({ data: ix, usage: BufferUsage.INDEX | BufferUsage.COPY_DST });
    const geometry = new Geometry({
      attributes: {
        aPosition: { buffer: vb, format: "float32x2", stride: STRIDE, offset: 0 },
        aGround: { buffer: vb, format: "float32x2", stride: STRIDE, offset: 8 },
        aWall: { buffer: vb, format: "float32x2", stride: STRIDE, offset: 16 },
      },
      indexBuffer: ib,
    });
    const mesh = new Mesh<Geometry, Shader>({ geometry, shader });
    mesh.eventMode = "none";
    // Under the band's sprites: what the mesh does not draw, they do.
    bl.staticOf[b].addChildAt(mesh, 0);
    gm.meshes.push(mesh);
  }
  return gm;
}

/** A cell changed: its texel now, and the bands whose quads it can touch at the next flush. */
export function markGround(gm: GroundMesh, grid: Grid, palette: Palette, x: number, y: number) {
  if (!inBounds(grid, x, y)) return;
  writeCell(gm, grid, palette, x, y);
  // Its own band; the band behind, whose walls stand over it.
  const b = bandOf(x, y);
  for (const k of [b - 1, b]) if (k >= 0 && k < gm.meshes.length) gm.dirty.add(k);
}

/** Rebuild the bands marked, and send the texels. */
export function flushGround(gm: GroundMesh, grid: Grid, palette: Palette) {
  if (!gm.dirty.size) return;
  for (const b of gm.dirty) {
    const { verts, idx: ix } = bandQuads(grid, palette, b, gm.scale);
    const g = gm.meshes[b].geometry;
    // Assigning `data` resizes the GPU buffer in place; the geometry, and so
    // the render group's instructions, stay the same objects. @see quads.ts grow
    g.attributes.aPosition.buffer.data = verts;
    g.indexBuffer.data = ix;
  }
  gm.dirty.clear();
  gm.source.update();
}

export function destroyGroundMesh(gm: GroundMesh) {
  for (const m of gm.meshes) { m.parent?.removeChild(m); m.geometry.destroy(true); m.destroy(); }
  gm.meshes.length = 0;
  gm.source.destroy();
}

// ─── THE SHADER ──────────────────────────────────────────────────────────────

let program: { gpu: GpuProgram; gl: GlProgram } | null = null;

function groundShader(gm: GroundMesh): Shader {
  program ??= {
    gpu: GpuProgram.from({
      vertex: { source: WGSL, entryPoint: "mainVertex" },
      fragment: { source: WGSL, entryPoint: "mainFragment" },
      name: "ground",
    }),
    gl: GlProgram.from({ vertex: GLSL_VERTEX, fragment: GLSL_FRAGMENT, name: "ground" }),
  };
  return new Shader({ gpuProgram: program.gpu, glProgram: program.gl, resources: { ground: gm.uniforms, uCells: gm.source } });
}

/*
 * THE LOOK, the same in both languages, function for function.
 *
 * Colours from the sheet's own tiles, measured, so nothing jumps: grass top
 * (138,181,73) and its lip (124,163,64); dirt (186,140,93); sand (216,209,158)
 * and its lip (194,188,142); earth on the lit face (167,125,83), the shaded
 * one (129,96,62).
 *
 * `fp`: how many cells one pixel covers. Detail at a frequency F (per cell)
 * shows only while F·fp is well under one, and fades out before it would
 * shimmer — so far off the ground is calm colour, close up it is grass.
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
struct Ground { uMap: vec4<f32> };
@group(2) @binding(0) var<uniform> ground : Ground;
@group(2) @binding(1) var uCells : texture_2d<f32>;

struct VSOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) vGround: vec2<f32>,
  @location(1) vWall: vec2<f32>,
  @location(2) vTint: vec4<f32>,
};

@vertex
fn mainVertex(@location(0) aPosition: vec2<f32>, @location(1) aGround: vec2<f32>, @location(2) aWall: vec2<f32>) -> VSOutput {
  let mvp = globalUniforms.uProjectionMatrix * globalUniforms.uWorldTransformMatrix * localUniforms.uTransformMatrix;
  var out: VSOutput;
  out.position = vec4<f32>((mvp * vec3<f32>(aPosition, 1.0)).xy, 0.0, 1.0);
  out.vGround = aGround;
  out.vWall = aWall;
  out.vTint = localUniforms.uColor * globalUniforms.uWorldColorAlpha;
  return out;
}

fn hash(p: vec2<i32>) -> f32 {
  var h = bitcast<u32>(p.x) * 1664525u + bitcast<u32>(p.y) * 1013904223u;
  h = h ^ (h >> 16u); h = h * 0x7feb352du; h = h ^ (h >> 15u); h = h * 0x846ca68bu; h = h ^ (h >> 16u);
  return f32(h) / 4294967295.0;
}
fn vnoise(p: vec2<f32>) -> f32 {
  let i = vec2<i32>(floor(p)); let f = fract(p); let u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  let a = hash(i); let b = hash(i + vec2<i32>(1, 0)); let c = hash(i + vec2<i32>(0, 1)); let d = hash(i + vec2<i32>(1, 1));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
// Octaves turned against each other, so the lattice of no one of them lines up into a grid.
fn fbm(p: vec2<f32>) -> f32 {
  let q = vec2<f32>(p.x * 0.8 - p.y * 0.6, p.x * 0.6 + p.y * 0.8);
  let r = vec2<f32>(p.x * 0.28 + p.y * 0.96, p.y * 0.28 - p.x * 0.96);
  return vnoise(p) * 0.5 + vnoise(q * 2.03 + 17.0) * 0.3 + vnoise(r * 4.1 + 41.0) * 0.2;
}
// How much of a detail at frequency f (per cell) shows at fp cells a pixel.
fn shows(f: f32, fp: f32) -> f32 { return 1.0 - smoothstep(0.12, 0.45, f * fp); }

fn cellAt(c: vec2<i32>) -> vec4<f32> {
  let n = vec2<i32>(i32(ground.uMap.x), i32(ground.uMap.y));
  if (c.x < 0 || c.y < 0 || c.x >= n.x || c.y >= n.y) { return vec4<f32>(0.0); }
  return textureLoad(uCells, c, 0) * 255.0;
}

fn grassAt(p: vec2<f32>, fp: f32) -> vec3<f32> {
  var c = vec3<f32>(138.0, 181.0, 73.0) / 255.0;
  // Broad patches: lusher and drier.
  let m = fbm(p * 0.45);
  c = mix(c, vec3<f32>(0.60, 0.70, 0.30), smoothstep(0.55, 0.85, m) * 0.25);
  c = c * (0.96 + 0.08 * fbm(p * 0.9 + 5.0));
  // Clumps: tufts, a ridge of noise rather than a blur of it.
  let t = 1.0 - abs(fbm(p * 6.0) * 2.0 - 1.0);
  c = c * (1.0 + (t - 0.6) * 0.12 * shows(9.0, fp));
  // Blades: standing up the screen — along the ground's (1, 1), which is
  // screen-up — fine across, short along, a light tip and a dark root each.
  let across = (p.x - p.y) * 34.0;
  let col = floor(across);
  let up = (p.x + p.y) * 7.0 + hash(vec2<i32>(i32(col), 77)) * 3.0;
  let blade = fract(up);
  let lean = hash(vec2<i32>(i32(col), i32(floor(up)))) - 0.5;
  let s = vnoise(vec2<f32>(across + lean * blade * 2.0, floor(up) * 3.1));
  c = c * (1.0 + ((s - 0.5) * 0.18 + (0.5 - blade) * 0.12) * shows(34.0, fp));
  // A daisy now and then.
  let g = p * 14.0; let gi = vec2<i32>(floor(g));
  let r = hash(gi + vec2<i32>(91, 7));
  if (r > 0.975) {
    let ctr = vec2<f32>(gi) + vec2<f32>(hash(gi + vec2<i32>(3, 1)), hash(gi + vec2<i32>(5, 9))) * 0.6 + 0.2;
    let d = length(g - ctr);
    let petal = 1.0 - smoothstep(0.11, 0.16, d);
    let eye = 1.0 - smoothstep(0.04, 0.07, d);
    let flower = select(vec3<f32>(0.97, 0.96, 0.92), vec3<f32>(0.98, 0.85, 0.35), r > 0.992);
    c = mix(c, mix(flower, vec3<f32>(0.95, 0.75, 0.2), eye), petal * shows(30.0, fp));
  }
  return c;
}
fn dirtAt(p: vec2<f32>, fp: f32) -> vec3<f32> {
  var c = vec3<f32>(186.0, 140.0, 93.0) / 255.0;
  c = c * (0.93 + 0.14 * fbm(p * 0.8 + 11.0));
  c = c * (1.0 + (vnoise(p * 9.0 + 3.0) - 0.5) * 0.12 * shows(9.0, fp));
  // Pebbles, each lit from the up-left.
  let g = p * 11.0; let gi = vec2<i32>(floor(g));
  let r = hash(gi);
  if (r > 0.55) {
    let ctr = vec2<f32>(gi) + vec2<f32>(hash(gi + vec2<i32>(1, 3)), hash(gi + vec2<i32>(7, 2))) * 0.5 + 0.25;
    let rad = 0.12 + 0.16 * hash(gi + vec2<i32>(4, 4));
    let d = g - ctr;
    let inside = 1.0 - smoothstep(rad * 0.8, rad, length(d));
    let lit = clamp(0.5 - dot(d / rad, vec2<f32>(0.5, 0.5)), 0.0, 1.0);
    let stone = mix(vec3<f32>(0.55, 0.47, 0.40), vec3<f32>(0.80, 0.74, 0.66), hash(gi + vec2<i32>(9, 9))) * (0.8 + 0.35 * lit);
    c = mix(c, stone, inside * shows(22.0, fp));
  }
  c = c * (1.0 + (hash(vec2<i32>(floor(p * 90.0))) - 0.5) * 0.08 * shows(90.0, fp));
  return c;
}
fn sandAt(p: vec2<f32>, fp: f32) -> vec3<f32> {
  var c = vec3<f32>(216.0, 209.0, 158.0) / 255.0;
  c = c * (0.95 + 0.08 * fbm(p * 0.6 + 23.0));
  // Ripples, wandering.
  let w = (p.x * 0.8 + p.y * 0.35 + fbm(p * 1.5) * 1.2) * 9.0;
  c = c * (1.0 + sin(w) * 0.035 * shows(9.0, fp));
  // Grains, and a shell here and there.
  c = c * (1.0 + (hash(vec2<i32>(floor(p * 120.0))) - 0.5) * 0.09 * shows(120.0, fp));
  let g = p * 8.0; let gi = vec2<i32>(floor(g));
  if (hash(gi + vec2<i32>(13, 2)) > 0.97) {
    let ctr = vec2<f32>(gi) + vec2<f32>(hash(gi), hash(gi + vec2<i32>(2, 2))) * 0.6 + 0.2;
    let d = length(g - ctr);
    c = mix(c, vec3<f32>(0.97, 0.93, 0.88), (1.0 - smoothstep(0.07, 0.1, d)) * shows(24.0, fp));
  }
  return c;
}
fn materialAt(k: i32, p: vec2<f32>, fp: f32) -> vec3<f32> {
  if (k == 2) { return dirtAt(p, fp); }
  if (k == 3) { return sandAt(p, fp); }
  return grassAt(p, fp);
}

fn topColour(p: vec2<f32>, fp: f32) -> vec3<f32> {
  let cell = vec2<i32>(floor(p));
  let here = cellAt(cell);
  // How strongly each material claims this point: its nearest cell at the
  // same height, near is strong, ragged by noise of its own.
  var claim = vec3<f32>(-9.0);
  for (var dy = -1; dy <= 1; dy++) {
    for (var dx = -1; dx <= 1; dx++) {
      let n = cell + vec2<i32>(dx, dy);
      let c = cellAt(n);
      let k = i32(c.x + 0.5);
      if (k < 1 || k > 3 || abs(c.y - here.y) > 0.5) { continue; }
      let lo = vec2<f32>(n);
      let d = length(p - clamp(p, lo, lo + 1.0));
      let s = 1.0 - d / 0.42;
      if (k == 1) { claim.x = max(claim.x, s); }
      if (k == 2) { claim.y = max(claim.y, s); }
      if (k == 3) { claim.z = max(claim.z, s); }
    }
  }
  claim = claim + vec3<f32>(
    (fbm(p * 3.1) - 0.5) * 0.7 + 0.05,
    (fbm(p * 2.7 + 31.0) - 0.5) * 0.7,
    (fbm(p * 1.9 + 77.0) - 0.5) * 0.6
  );
  let top = max(claim.x, max(claim.y, claim.z));
  let aa = max(fp * 2.4, 0.015);
  var wt = clamp((claim - top) / aa + 1.0, vec3<f32>(0.0), vec3<f32>(1.0));
  wt = wt / max(wt.x + wt.y + wt.z, 0.0001);
  var col = vec3<f32>(0.0);
  if (wt.x > 0.0) { col = col + grassAt(p, fp) * wt.x; }
  if (wt.y > 0.0) { col = col + dirtAt(p, fp) * wt.y; }
  if (wt.z > 0.0) { col = col + sandAt(p, fp) * wt.z; }
  return col;
}

fn wallColour(p: vec2<f32>, kind: f32, depth: f32, fp: f32) -> vec3<f32> {
  // The cell this face belongs to: back across the face from where it stands.
  let back = select(vec2<f32>(0.0, 0.02), vec2<f32>(0.02, 0.0), kind < 1.5);
  let k = i32(cellAt(vec2<i32>(floor(p - back))).x + 0.5);
  let along = select(p.x, p.y, kind < 1.5);
  let lit = kind > 1.5;
  var earth = select(vec3<f32>(129.0, 96.0, 62.0), vec3<f32>(167.0, 125.0, 83.0), lit) / 255.0;
  // Strata, wavering; darker and stonier the deeper.
  let band = depth + (vnoise(vec2<f32>(along * 3.0, depth * 0.5)) - 0.5) * 0.5;
  earth = earth * (0.94 + 0.1 * vnoise(vec2<f32>(along * 1.5, band * 2.2)));
  earth = earth * (1.0 - min(depth, 8.0) * 0.025);
  let sg = vec2<f32>(along * 12.0, depth * 6.0); let si = vec2<i32>(floor(sg));
  if (hash(si + vec2<i32>(5, 1)) > 0.8) {
    let ctr = vec2<f32>(si) + vec2<f32>(hash(si), hash(si + vec2<i32>(1, 1))) * 0.5 + 0.25;
    earth = mix(earth, earth * 1.25, (1.0 - smoothstep(0.18, 0.26, length(sg - ctr))) * shows(24.0, fp));
  }
  // The root mat under grass, the slump under sand: a lip half a step deep, ragged.
  let lipDepth = 0.95 + (vnoise(vec2<f32>(along * 9.0, 3.0)) - 0.5) * 0.5;
  var col = earth;
  if (k == 1 && depth < lipDepth) {
    col = select(vec3<f32>(100.0, 134.0, 52.0), vec3<f32>(124.0, 163.0, 64.0), lit) / 255.0;
    col = col * (1.0 + (vnoise(vec2<f32>(along * 40.0, depth * 8.0)) - 0.5) * 0.25 * shows(40.0, fp));
  } else if (k == 3 && depth < lipDepth) {
    col = select(vec3<f32>(160.0, 154.0, 115.0), vec3<f32>(194.0, 188.0, 142.0), lit) / 255.0;
  } else if (k == 1 && depth < lipDepth + 0.25) {
    col = earth * 0.72;
  }
  return col;
}

@fragment
fn mainFragment(@location(0) vGround: vec2<f32>, @location(1) vWall: vec2<f32>, @location(2) vTint: vec4<f32>) -> @location(0) vec4<f32> {
  let fw = fwidth(vGround) + vec2<f32>(fwidth(vWall.y) * 0.5);
  let fp = max(fw.x, fw.y);
  var col: vec3<f32>;
  if (vWall.x < 0.5) { col = topColour(vGround, fp); }
  else { col = wallColour(vGround, vWall.x, vWall.y, fp); }
  return vec4<f32>(col, 1.0) * vTint;
}
`;

const GLSL_VERTEX = /* glsl */ `#version 300 es
in vec2 aPosition;
in vec2 aGround;
in vec2 aWall;
out vec2 vGround;
out vec2 vWall;
out vec4 vTint;
uniform mat3 uProjectionMatrix;
uniform mat3 uWorldTransformMatrix;
uniform vec4 uWorldColorAlpha;
uniform vec2 uResolution;
uniform mat3 uTransformMatrix;
uniform vec4 uColor;
void main() {
  mat3 mvp = uProjectionMatrix * uWorldTransformMatrix * uTransformMatrix;
  gl_Position = vec4((mvp * vec3(aPosition, 1.0)).xy, 0.0, 1.0);
  vGround = aGround;
  vWall = aWall;
  vTint = uColor * uWorldColorAlpha;
}
`;

const GLSL_FRAGMENT = /* glsl */ `#version 300 es
precision highp float;
precision highp int;
in vec2 vGround;
in vec2 vWall;
in vec4 vTint;
out vec4 finalColor;
uniform vec4 uMap;
uniform sampler2D uCells;

float hash(ivec2 p) {
  uint h = uint(p.x) * 1664525u + uint(p.y) * 1013904223u;
  h ^= h >> 16u; h *= 0x7feb352du; h ^= h >> 15u; h *= 0x846ca68bu; h ^= h >> 16u;
  return float(h) / 4294967295.0;
}
float vnoise(vec2 p) {
  ivec2 i = ivec2(floor(p)); vec2 f = fract(p); vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  float a = hash(i), b = hash(i + ivec2(1, 0)), c = hash(i + ivec2(0, 1)), d = hash(i + ivec2(1, 1));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
float fbm(vec2 p) {
  vec2 q = vec2(p.x * 0.8 - p.y * 0.6, p.x * 0.6 + p.y * 0.8);
  vec2 r = vec2(p.x * 0.28 + p.y * 0.96, p.y * 0.28 - p.x * 0.96);
  return vnoise(p) * 0.5 + vnoise(q * 2.03 + 17.0) * 0.3 + vnoise(r * 4.1 + 41.0) * 0.2;
}
float shows(float f, float fp) { return 1.0 - smoothstep(0.12, 0.45, f * fp); }

vec4 cellAt(ivec2 c) {
  ivec2 n = ivec2(int(uMap.x), int(uMap.y));
  if (c.x < 0 || c.y < 0 || c.x >= n.x || c.y >= n.y) return vec4(0.0);
  return texelFetch(uCells, c, 0) * 255.0;
}

vec3 grassAt(vec2 p, float fp) {
  vec3 c = vec3(138.0, 181.0, 73.0) / 255.0;
  float m = fbm(p * 0.45);
  c = mix(c, vec3(0.60, 0.70, 0.30), smoothstep(0.55, 0.85, m) * 0.25);
  c *= 0.96 + 0.08 * fbm(p * 0.9 + 5.0);
  float t = 1.0 - abs(fbm(p * 6.0) * 2.0 - 1.0);
  c *= 1.0 + (t - 0.6) * 0.12 * shows(9.0, fp);
  float across = (p.x - p.y) * 34.0;
  float col = floor(across);
  float up = (p.x + p.y) * 7.0 + hash(ivec2(int(col), 77)) * 3.0;
  float blade = fract(up);
  float lean = hash(ivec2(int(col), int(floor(up)))) - 0.5;
  float s = vnoise(vec2(across + lean * blade * 2.0, floor(up) * 3.1));
  c *= 1.0 + ((s - 0.5) * 0.18 + (0.5 - blade) * 0.12) * shows(34.0, fp);
  vec2 g = p * 14.0; ivec2 gi = ivec2(floor(g));
  float r = hash(gi + ivec2(91, 7));
  if (r > 0.975) {
    vec2 ctr = vec2(gi) + vec2(hash(gi + ivec2(3, 1)), hash(gi + ivec2(5, 9))) * 0.6 + 0.2;
    float d = length(g - ctr);
    float petal = 1.0 - smoothstep(0.11, 0.16, d);
    float eye = 1.0 - smoothstep(0.04, 0.07, d);
    vec3 flower = r > 0.992 ? vec3(0.98, 0.85, 0.35) : vec3(0.97, 0.96, 0.92);
    c = mix(c, mix(flower, vec3(0.95, 0.75, 0.2), eye), petal * shows(30.0, fp));
  }
  return c;
}
vec3 dirtAt(vec2 p, float fp) {
  vec3 c = vec3(186.0, 140.0, 93.0) / 255.0;
  c *= 0.93 + 0.14 * fbm(p * 0.8 + 11.0);
  c *= 1.0 + (vnoise(p * 9.0 + 3.0) - 0.5) * 0.12 * shows(9.0, fp);
  vec2 g = p * 11.0; ivec2 gi = ivec2(floor(g));
  float r = hash(gi);
  if (r > 0.55) {
    vec2 ctr = vec2(gi) + vec2(hash(gi + ivec2(1, 3)), hash(gi + ivec2(7, 2))) * 0.5 + 0.25;
    float rad = 0.12 + 0.16 * hash(gi + ivec2(4, 4));
    vec2 d = g - ctr;
    float inside = 1.0 - smoothstep(rad * 0.8, rad, length(d));
    float lit = clamp(0.5 - dot(d / rad, vec2(0.5, 0.5)), 0.0, 1.0);
    vec3 stone = mix(vec3(0.55, 0.47, 0.40), vec3(0.80, 0.74, 0.66), hash(gi + ivec2(9, 9))) * (0.8 + 0.35 * lit);
    c = mix(c, stone, inside * shows(22.0, fp));
  }
  c *= 1.0 + (hash(ivec2(floor(p * 90.0))) - 0.5) * 0.08 * shows(90.0, fp);
  return c;
}
vec3 sandAt(vec2 p, float fp) {
  vec3 c = vec3(216.0, 209.0, 158.0) / 255.0;
  c *= 0.95 + 0.08 * fbm(p * 0.6 + 23.0);
  float w = (p.x * 0.8 + p.y * 0.35 + fbm(p * 1.5) * 1.2) * 9.0;
  c *= 1.0 + sin(w) * 0.035 * shows(9.0, fp);
  c *= 1.0 + (hash(ivec2(floor(p * 120.0))) - 0.5) * 0.09 * shows(120.0, fp);
  vec2 g = p * 8.0; ivec2 gi = ivec2(floor(g));
  if (hash(gi + ivec2(13, 2)) > 0.97) {
    vec2 ctr = vec2(gi) + vec2(hash(gi), hash(gi + ivec2(2, 2))) * 0.6 + 0.2;
    float d = length(g - ctr);
    c = mix(c, vec3(0.97, 0.93, 0.88), (1.0 - smoothstep(0.07, 0.1, d)) * shows(24.0, fp));
  }
  return c;
}

vec3 topColour(vec2 p, float fp) {
  ivec2 cell = ivec2(floor(p));
  vec4 here = cellAt(cell);
  vec3 claim = vec3(-9.0);
  for (int dy = -1; dy <= 1; dy++) {
    for (int dx = -1; dx <= 1; dx++) {
      ivec2 n = cell + ivec2(dx, dy);
      vec4 c = cellAt(n);
      int k = int(c.x + 0.5);
      if (k < 1 || k > 3 || abs(c.y - here.y) > 0.5) continue;
      vec2 lo = vec2(n);
      float d = length(p - clamp(p, lo, lo + 1.0));
      float s = 1.0 - d / 0.42;
      if (k == 1) claim.x = max(claim.x, s);
      if (k == 2) claim.y = max(claim.y, s);
      if (k == 3) claim.z = max(claim.z, s);
    }
  }
  claim += vec3(
    (fbm(p * 3.1) - 0.5) * 0.7 + 0.05,
    (fbm(p * 2.7 + 31.0) - 0.5) * 0.7,
    (fbm(p * 1.9 + 77.0) - 0.5) * 0.6
  );
  float top = max(claim.x, max(claim.y, claim.z));
  float aa = max(fp * 2.4, 0.015);
  vec3 wt = clamp((claim - top) / aa + 1.0, vec3(0.0), vec3(1.0));
  wt /= max(wt.x + wt.y + wt.z, 0.0001);
  vec3 col = vec3(0.0);
  if (wt.x > 0.0) col += grassAt(p, fp) * wt.x;
  if (wt.y > 0.0) col += dirtAt(p, fp) * wt.y;
  if (wt.z > 0.0) col += sandAt(p, fp) * wt.z;
  return col;
}

vec3 wallColour(vec2 p, float kind, float depth, float fp) {
  vec2 back = kind < 1.5 ? vec2(0.02, 0.0) : vec2(0.0, 0.02);
  int k = int(cellAt(ivec2(floor(p - back))).x + 0.5);
  float along = kind < 1.5 ? p.y : p.x;
  bool lit = kind > 1.5;
  vec3 earth = (lit ? vec3(167.0, 125.0, 83.0) : vec3(129.0, 96.0, 62.0)) / 255.0;
  float band = depth + (vnoise(vec2(along * 3.0, depth * 0.5)) - 0.5) * 0.5;
  earth *= 0.94 + 0.1 * vnoise(vec2(along * 1.5, band * 2.2));
  earth *= 1.0 - min(depth, 8.0) * 0.025;
  vec2 sg = vec2(along * 12.0, depth * 6.0); ivec2 si = ivec2(floor(sg));
  if (hash(si + ivec2(5, 1)) > 0.8) {
    vec2 ctr = vec2(si) + vec2(hash(si), hash(si + ivec2(1, 1))) * 0.5 + 0.25;
    earth = mix(earth, earth * 1.25, (1.0 - smoothstep(0.18, 0.26, length(sg - ctr))) * shows(24.0, fp));
  }
  float lipDepth = 0.95 + (vnoise(vec2(along * 9.0, 3.0)) - 0.5) * 0.5;
  vec3 col = earth;
  if (k == 1 && depth < lipDepth) {
    col = (lit ? vec3(124.0, 163.0, 64.0) : vec3(100.0, 134.0, 52.0)) / 255.0;
    col *= 1.0 + (vnoise(vec2(along * 40.0, depth * 8.0)) - 0.5) * 0.25 * shows(40.0, fp);
  } else if (k == 3 && depth < lipDepth) {
    col = (lit ? vec3(194.0, 188.0, 142.0) : vec3(160.0, 154.0, 115.0)) / 255.0;
  } else if (k == 1 && depth < lipDepth + 0.25) {
    col = earth * 0.72;
  }
  return col;
}

void main() {
  vec2 fw = fwidth(vGround) + vec2(fwidth(vWall.y) * 0.5);
  float fp = max(fw.x, fw.y);
  vec3 col = vWall.x < 0.5 ? topColour(vGround, fp) : wallColour(vGround, vWall.x, vWall.y, fp);
  finalColor = vec4(col, 1.0) * vTint;
}
`;
