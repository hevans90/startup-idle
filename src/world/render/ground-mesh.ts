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
 * It draws every cell with ground on it but the pit under a building that
 * clears it. @see groundDraws
 */
import { BufferImageSource, Buffer, BufferUsage, Geometry, GlProgram, GpuProgram, Mesh, Shader, UniformGroup } from "pixi.js";

import { HEIGHT_UNIT, HH, HW, bandOf } from "../iso";
import { RAMP, VOID, idx, inBounds, rampDir, rampRise, structureOf, type Grid } from "../grid";
import { structureDef } from "../structures/def";
import type { BandLayer } from "./bands";
import { terrainName } from "../terrain-names";
import { cornerZ, drawnCentre, drawnCorner, drawnFlat, pinned, shelfOf } from "./drawn";

export { cornerZ };

/** What the shader draws a material as. 0 is nothing it knows. */
export const GROUND = { none: 0, grass: 1, dirt: 2, sand: 3 } as const;

/** What the shader draws each material as. Woods are grass under trees. @see terrainName */
const CLASS_OF: Record<string, number> = {
  grass: GROUND.grass, dirt: GROUND.dirt, sand: GROUND.sand,
  wood1: GROUND.grass, wood2: GROUND.grass, wood3: GROUND.grass,
};
const classOf = (name: string | null | undefined) => (name ? CLASS_OF[terrainName(name) ?? ""] ?? GROUND.none : GROUND.none);

export type Palette = readonly (string | null)[];

/** What a cell's material is to the shader, drawn by it or not: its neighbours blend toward it either way. */
export const groundClassOf = (palette: Palette, mat: number): number =>
  mat === VOID ? GROUND.none : classOf(palette[mat]);

/** Whether a `clearsTerrain` structure stands on this cell. */
const hidden = (grid: Grid, x: number, y: number) => {
  const s = structureOf(grid, x, y);
  return s ? structureDef(s.def)?.clearsTerrain === true : false;
};

/** Whether the mesh draws this cell, top and walls. */
export function groundDraws(grid: Grid, palette: Palette, x: number, y: number): boolean {
  if (!inBounds(grid, x, y)) return false;
  const i = idx(grid, x, y);
  return grid.terrain[i] !== VOID && !!classOf(palette[grid.terrain[i]]) && !hidden(grid, x, y);
}

/**
 * How far down a cell's face shows at one of its corners: to the DRAWN surface
 * of the neighbour `(nx, ny)` in front, at that neighbour's own corner `(u, v)`.
 * Off the map, or over a void, at least one step below the cell's foot: the
 * plateau's own edge, as a tile's skirt showed it. Never above the top `z`.
 */
export function wallFoot(grid: Grid, x: number, y: number, nx: number, ny: number, u = 0, v = 0, z = grid.height[idx(grid, x, y)]): number {
  const h = grid.height[idx(grid, x, y)];
  if (!inBounds(grid, nx, ny)) return Math.min(0, h - 2, z);
  const j = idx(grid, nx, ny);
  if (grid.terrain[j] === VOID) return Math.min(grid.height[j], h - 2, z);
  return Math.min(drawnCorner(grid, nx, ny, u, v), z);
}

/**
 * The light on a ramp's top, as a fraction brighter. The light comes from the
 * screen's left, as on the walls: a slope facing up-left (rising toward +x,
 * S) or down-left (rising toward −y, E) catches it; the other two are in shade.
 */
export function slopeLight(packed: number): number {
  const rise = rampRise(packed);
  if (!rise) return 0;
  const d = rampDir(packed);
  return (d === RAMP.S || d === RAMP.E ? 0.05 : -0.06) * rise;
}

/** Which way the light comes from along the ground, as the shader has it (`SUN`), and how much a half step a tile of slope toward it brightens. */
const SUN_X = -0.94, SUN_Y = 0.34, SLOPE_LIT = 0.2;
const litOf = (gx: number, gy: number) => Math.max(-0.42, Math.min(0.3, -(gx * SUN_X + gy * SUN_Y) * SLOPE_LIT));
/**
 * The light on a free cell's drawn top at its corner `(u, v)`: from the fall of its own two edges there, and of the
 * edges that carry on from them in the cells it joins — so the cells round a corner say the same, and no facet shows.
 */
function cornerLight(grid: Grid, palette: Palette, x: number, y: number, u: number, v: number): number {
  const at = drawnCorner(grid, x, y, u, v);
  let gx = drawnCorner(grid, x, y, 1, v) - drawnCorner(grid, x, y, 0, v), gy = drawnCorner(grid, x, y, u, 1) - drawnCorner(grid, x, y, u, 0);
  const nx = u ? x + 1 : x - 1, ny = v ? y + 1 : y - 1;
  if (groundDraws(grid, palette, nx, y) && drawnCorner(grid, nx, y, 1 - u, v) === at) gx = (gx + drawnCorner(grid, nx, y, 1, v) - drawnCorner(grid, nx, y, 0, v)) / 2;
  if (groundDraws(grid, palette, x, ny) && drawnCorner(grid, x, ny, u, 1 - v) === at) gy = (gy + drawnCorner(grid, x, ny, u, 1) - drawnCorner(grid, x, ny, u, 0)) / 2;
  return litOf(gx, gy);
}

/** How far blade tips can stand over a back edge, in screen-shaped units (a cell's diamond is 2 across). */
const FRINGE = 0.05;

/** Whether this cell's grass can stand over what is behind it: level grass, bare. */
function fringes(grid: Grid, palette: Palette, x: number, y: number): boolean {
  const i = idx(grid, x, y);
  return groundClassOf(palette, grid.terrain[i]) === GROUND.grass && !rampRise(grid.ramp[i])
    && !grid.paved[i] && !structureOf(grid, x, y) && drawnFlat(grid, x, y);
}

/**
 * Whether the cell behind a back edge is something grass stands in front of:
 * a road or pavement, a structure, ground the mesh doesn't draw, or ground at
 * another height. Not more of the same level ground, whose own top already
 * draws the blades leaning into it.
 */
function fringeBehind(grid: Grid, palette: Palette, nx: number, ny: number, z: number): boolean {
  if (!inBounds(grid, nx, ny)) return false;
  const j = idx(grid, nx, ny);
  return !!grid.paved[j] || !!structureOf(grid, nx, ny) || !groundDraws(grid, palette, nx, ny)
    || !!rampRise(grid.ramp[j]) || grid.height[j] !== z;
}

// ─── THE MESH ────────────────────────────────────────────────────────────────

/**
 * Floats a vertex: world x, y; ground u, v (cells); kind (0 top, 1 face +x,
 * 2 face +y, 3 fringe); then for a top its slope's light, for a face its depth
 * below the top in half steps, for a fringe its height. A fringe's ground is
 * its cell's corner (x, y), the same at every vertex.
 */
const WORDS = 6;
const STRIDE = WORDS * 4;

export type GroundMesh = {
  /** A texel a cell: class, height + 128, flags (1 drawn, ramp direction × 2, rise in half steps × 16), 255. */
  cells: Uint8Array;
  source: BufferImageSource;
  /** The drawn surface, two texels a cell. @see surfaceOf */
  edges: Float32Array;
  grid: Grid;
  edgeSource: BufferImageSource;
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
    // THE TOP, corners round its edge: (x, y), (x+1, y), (x+1, y+1), (x, y+1), each at its DRAWN height. A vertex of
    // a top says the light on it where a wall says its kind (under a half either way), and its height. @see drawn.ts
    const z00 = drawnCorner(grid, x, y, 0, 0), z10 = drawnCorner(grid, x, y, 1, 0);
    const z11 = drawnCorner(grid, x, y, 1, 1), z01 = drawnCorner(grid, x, y, 0, 1);
    const zm = drawnCentre(grid, x, y);
    if (pinned(grid, x, y) || (z00 === zm && z10 === zm && z11 === zm && z01 === zm)) {
      // Level, or a ramp: a plane tilted toward its high edge.
      const lit = slopeLight(grid.ramp[idx(grid, x, y)]);
      at(x, y, z00, lit, z00); at(x + 1, y, z10, lit, z10); at(x + 1, y + 1, z11, lit, z11); at(x, y + 1, z01, lit, z01);
    } else {
      // A BANK: a fan from its middle, at the cell's own height, to its corners — four triangles, each a quad with an end doubled.
      const lm = litOf((z10 + z11 - z00 - z01) / 2, (z01 + z11 - z00 - z10) / 2);
      const c: [number, number, number, number][] = [
        [x, y, z00, cornerLight(grid, palette, x, y, 0, 0)], [x + 1, y, z10, cornerLight(grid, palette, x, y, 1, 0)],
        [x + 1, y + 1, z11, cornerLight(grid, palette, x, y, 1, 1)], [x, y + 1, z01, cornerLight(grid, palette, x, y, 0, 1)],
      ];
      for (let k = 0; k < 4; k++) {
        const p = c[k], q = c[(k + 1) % 4];
        at(x + 0.5, y + 0.5, zm, lm, zm); at(p[0], p[1], p[2], p[3], p[2]); at(q[0], q[1], q[2], q[3], q[2]); at(q[0], q[1], q[2], q[3], q[2]);
      }
    }
    // THE FACE ALONG x+1, each end down to what is in front of it there: a
    // trapezoid where either side slopes.
    const fa = wallFoot(grid, x, y, x + 1, y, 0, 0, z10), fb = wallFoot(grid, x, y, x + 1, y, 0, 1, z11);
    if (fa < z10 || fb < z11) { at(x + 1, y, z10, 1, 0); at(x + 1, y + 1, z11, 1, 0); at(x + 1, y + 1, fb, 1, z11 - fb); at(x + 1, y, fa, 1, z10 - fa); }
    // AND ALONG y+1.
    const ga = wallFoot(grid, x, y, x, y + 1, 0, 0, z01), gb = wallFoot(grid, x, y, x, y + 1, 1, 0, z11);
    if (ga < z01 || gb < z11) { at(x, y + 1, z01, 2, 0); at(x + 1, y + 1, z11, 2, 0); at(x + 1, y + 1, gb, 2, z11 - gb); at(x, y + 1, ga, 2, z01 - ga); }
    // THE FRINGE over each back edge where something else is behind it, for
    // the tips of this cell's blades to stand over. Ground (x, y) is the cell,
    // the second word its height. @see fringeColour
    if (fringes(grid, palette, x, y)) {
      const fr = (gu: number, gv: number, lift: number) => {
        const cx = gu - 0.5, cy = gv - 0.5;
        v.push((cx - cy) * HW * scale, ((cx + cy) * HH - z00 * HEIGHT_UNIT - lift * HW) * scale, x, y, 3, z00);
      };
      if (fringeBehind(grid, palette, x, y - 1, z00)) { fr(x, y, 0); fr(x + 1, y, 0); fr(x + 1, y, FRINGE); fr(x, y, FRINGE); }
      if (fringeBehind(grid, palette, x - 1, y, z00)) { fr(x, y + 1, 0); fr(x, y, 0); fr(x, y, FRINGE); fr(x, y + 1, FRINGE); }
    }
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
  // Flags: 1 drawn; the ramp's direction × 2; its rise × 16. Alpha stays
  // opaque: WebGL premultiplies on upload, and a texel of alpha 0 reads as nothing.
  gm.cells[o + 2] = (groundDraws(grid, palette, x, y) ? 1 : 0) | (rampDir(grid.ramp[i]) << 1) | (rampRise(grid.ramp[i]) << 4);
  gm.cells[o + 3] = 255;
  writeEdges(gm, grid, x, y);
}
/**
 * THE DRAWN SURFACE AS A TEXTURE, two texels a cell, floats: its four corners (0,0), (1,0), (1,1), (0,1), half
 * steps; then its middle, whether it is a shelf, and the level of the standing water on it or beside it (−999 with
 * none). The ground's shader reads it for shadows and the beach; the water's for where the shore cuts it.
 * One a grid, made by whichever asks first. @see drawn.ts, water-gpu.ts
 */
const surfaces = new WeakMap<Grid, { data: Float32Array; source: BufferImageSource }>();
export function surfaceOf(grid: Grid): { data: Float32Array; source: BufferImageSource } {
  let s = surfaces.get(grid);
  if (!s) {
    const data = new Float32Array(grid.w * 2 * grid.h * 4).fill(-999);
    s = { data, source: new BufferImageSource({ resource: data, width: grid.w * 2, height: grid.h, format: "rgba32float", scaleMode: "nearest" }) };
    surfaces.set(grid, s);
  }
  return s;
}
function writeEdges(gm: GroundMesh, grid: Grid, x: number, y: number) {
  const o = idx(grid, x, y) * 8, e = gm.edges;
  e[o] = drawnCorner(grid, x, y, 0, 0); e[o + 1] = drawnCorner(grid, x, y, 1, 0); e[o + 2] = drawnCorner(grid, x, y, 1, 1); e[o + 3] = drawnCorner(grid, x, y, 0, 1);
  e[o + 4] = drawnCentre(grid, x, y);
  e[o + 5] = shelfOf(grid, x, y) === null ? 0 : 1;
  let level = -999;
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    if (!inBounds(grid, x + dx, y + dy)) continue;
    const j = idx(grid, x + dx, y + dy);
    if (grid.pool[j] > 0) level = Math.max(level, grid.height[j] + grid.pool[j]);
  }
  e[o + 6] = level; e[o + 7] = 1;
}

export function createGroundMesh(grid: Grid, bl: BandLayer, palette: Palette, scale = 1): GroundMesh {
  const cells = new Uint8Array(grid.w * grid.h * 4);
  const source = new BufferImageSource({ resource: cells, width: grid.w, height: grid.h, format: "rgba8unorm", scaleMode: "nearest" });
  const uniforms = new UniformGroup({
    // The map's size; world px to screen-shaped units, where a cell's diamond is 2 across; and the highest ground
    // there is, half steps: nothing higher can throw a shadow. @see shadowAt
    uMap: { value: new Float32Array([grid.w, grid.h, 1 / (HW * scale), grid.maxHeight + 2]), type: "vec4<f32>" },
  });
  const { data: edges, source: edgeSource } = surfaceOf(grid);
  const gm: GroundMesh = { cells, source, edges, edgeSource, grid, uniforms, meshes: [], dirty: new Set(), scale, w: grid.w, h: grid.h };
  for (let y = 0; y < grid.h; y++) for (let x = 0; x < grid.w; x++) writeCell(gm, grid, palette, x, y);
  source.update();
  edgeSource.update();
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
  // Every cell that shares a corner with it is drawn by its height too (@see drawn.ts), and the walls and fringes of
  // the cells beside those: two bands either way.
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if ((dx || dy) && inBounds(grid, x + dx, y + dy)) writeEdges(gm, grid, x + dx, y + dy);
  const b = bandOf(x, y);
  for (let k = b - 2; k <= b + 2; k++) if (k >= 0 && k < gm.meshes.length) gm.dirty.add(k);
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
  gm.edgeSource.update();
  const map = gm.uniforms.uniforms.uMap as Float32Array;
  if (map[3] !== grid.maxHeight + 2) { map[3] = grid.maxHeight + 2; gm.uniforms.update(); }
}

export function destroyGroundMesh(gm: GroundMesh) {
  if (surfaces.get(gm.grid)?.source === gm.edgeSource) surfaces.delete(gm.grid);
  for (const m of gm.meshes) { m.parent?.removeChild(m); m.geometry.destroy(true); m.destroy(); }
  gm.meshes.length = 0;
  gm.source.destroy();
  // (The water's layer reads this too, and goes in the same teardown: destroyed once this frame is done with it.)
  const shared = gm.edgeSource;
  setTimeout(() => shared.destroy(), 500);
}

// ─── THE SHADER ──────────────────────────────────────────────────────────────

let program: { gpu: GpuProgram; gl: GlProgram } | null = null;

function groundShader(gm: GroundMesh): Shader {
  program ??= {
    gpu: GpuProgram.from({
      vertex: { source: WGSL, entryPoint: "mainVertex" },
      fragment: { source: WGSL, entryPoint: "mainFragment" },
      name: "ground",
      // Written out, not left to Pixi, which would have every texture filterable: the drawn surface is floats,
      // fetched and never filtered, and a filterable binding will not take it. @see water-gpu.ts gpuLayout
      layout: [{ globalUniforms: 0 }, { localUniforms: 0 }, { ground: 0, uCells: 1, uEdges: 2 }],
      gpuLayout: [
        [{ binding: 0, visibility: 3, buffer: { type: "uniform" } }],
        [{ binding: 0, visibility: 3, buffer: { type: "uniform" } }],
        [
          { binding: 0, visibility: 2, buffer: { type: "uniform" } },
          { binding: 1, visibility: 2, texture: { sampleType: "float", viewDimension: "2d", multisampled: false } },
          { binding: 2, visibility: 2, texture: { sampleType: "unfilterable-float", viewDimension: "2d", multisampled: false } },
        ],
      ],
    }),
    gl: GlProgram.from({ vertex: GLSL_VERTEX, fragment: GLSL_FRAGMENT, name: "ground" }),
  };
  return new Shader({ gpuProgram: program.gpu, glProgram: program.gl, resources: { ground: gm.uniforms, uCells: gm.source, uEdges: gm.edgeSource } });
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
@group(2) @binding(2) var uEdges : texture_2d<f32>;

struct VSOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) vGround: vec2<f32>,
  @location(1) vWall: vec2<f32>,
  @location(2) vTint: vec4<f32>,
  @location(3) vWorld: vec2<f32>,
};

@vertex
fn mainVertex(@location(0) aPosition: vec2<f32>, @location(1) aGround: vec2<f32>, @location(2) aWall: vec2<f32>) -> VSOutput {
  let mvp = globalUniforms.uProjectionMatrix * globalUniforms.uWorldTransformMatrix * localUniforms.uTransformMatrix;
  var out: VSOutput;
  out.position = vec4<f32>((mvp * vec3<f32>(aPosition, 1.0)).xy, 0.0, 1.0);
  out.vGround = aGround;
  out.vWorld = aPosition;
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
// A cell's ramp rise in half steps, from its flags.
fn riseOf(c: vec4<f32>) -> f32 { return floor((c.z + 0.5) / 16.0); }

// THE SUN: which way the light comes from, along the ground — from the screen's left and a little above it, as
// every baked thing is lit — and how many tiles of shadow a half step of height throws.
const SUN = vec2<f32>(-0.94, 0.34);
const SHADOW_RUN = 0.55;
// A cell's height in half steps, a ramp's at its middle.
fn topOf(c: vec4<f32>) -> f32 { return c.y - 128.0 + riseOf(c) * 0.5; }
// A cell's drawn corners (0,0), (1,0), (1,1), (0,1), half steps. @see surfaceOf
fn edgesAt(c: vec2<i32>) -> vec4<f32> { return textureLoad(uEdges, vec2<i32>(c.x * 2, c.y), 0); }
// HOW MUCH OF THE SUN IS KEPT OFF a point at height h by the ground toward it: the ray walked a cell boundary at
// a time, each cell it enters asked whether it stands over the ray there. Soft, and softer the further it falls.
fn shadowAt(p: vec2<f32>, h: f32) -> f32 {
  var s = 0.0;
  // (As far as the highest ground on the map could throw one, and no further.)
  let far = (ground.uMap.w - h) * SHADOW_RUN;
  let cx = floor(p.x);
  for (var i = 0; i < 8; i++) {
    let bx = cx - f32(i);
    let t = (p.x - bx) / -SUN.x;
    if (t > far) { break; }
    // The cell the ray goes into there, and how high the edge it goes in by stands where it does.
    let y = p.y + SUN.y * t;
    let at = vec2<i32>(i32(bx) - 1, i32(floor(y)));
    if (at.x < 0 || at.y < 0 || at.y >= i32(ground.uMap.y)) { break; }
    let e = edgesAt(at);
    s = max(s, smoothstep(0.0, 0.06 + t * 0.22, (mix(e.y, e.z, fract(y)) - h) * SHADOW_RUN - t));
  }
  let cy = floor(p.y);
  for (var j = 0; j < 2; j++) {
    let by = cy + 1.0 + f32(j);
    let t = (by - p.y) / SUN.y;
    if (t > far) { break; }
    let x = p.x + SUN.x * t;
    let at = vec2<i32>(i32(floor(x)), i32(by));
    if (at.x < 0 || at.y < 0 || at.y >= i32(ground.uMap.y)) { break; }
    let e = edgesAt(at);
    s = max(s, smoothstep(0.0, 0.06 + t * 0.22, (mix(e.x, e.y, fract(x)) - h) * SHADOW_RUN - t));
  }
  return s;
}
// THE SHADE AT THE FOOT OF HIGHER GROUND: darker close under it, and the more the higher it stands.
fn contactAt(p: vec2<f32>, h: f32) -> f32 {
  let cell = vec2<i32>(floor(p));
  var a = 0.0;
  // (Only the cells on the sides it is near: none reaches further than 0.46 of a tile.)
  let f = p - floor(p);
  let side = vec2<i32>(select(select(0, 1, f.x > 0.54), -1, f.x < 0.46), select(select(0, 1, f.y > 0.54), -1, f.y < 0.46));
  for (var j = 0; j < 3; j++) {
    {
      let dx = select(side.x, 0, j == 1); let dy = select(side.y, 0, j == 0);
      if (dx == 0 && dy == 0) { continue; }
      if (j == 2 && (dx == 0 || dy == 0)) { continue; }
      let n = cell + vec2<i32>(dx, dy);
      let c = cellAt(n);
      if (c.w < 0.5) { continue; }
      // (Only under a cliff: a bank comes down to meet it.)
      let up = c.y - 128.0 - h;
      if (up < 3.5) { continue; }
      let lo = vec2<f32>(n);
      let d = length(p - clamp(p, lo, lo + 1.0));
      let reach = 0.16 + 0.05 * min(up, 6.0);
      let k = 1.0 - smoothstep(0.0, reach, d);
      a = max(a, k * k * min(1.0, 0.45 + up * 0.14));
    }
  }
  return a;
}
// A colour as the sun and the ground round it leave it.
fn relit(col: vec3<f32>, p: vec2<f32>, h: f32, foot: bool) -> vec3<f32> {
  var c = mix(col, col * vec3<f32>(0.60, 0.64, 0.74), shadowAt(p, h) * 0.72);
  if (foot) { c = c * (1.0 - 0.34 * contactAt(p, h)); }
  return c;
}
fn grassBase(p: vec2<f32>) -> vec3<f32> {
  var c = vec3<f32>(112.0, 156.0, 68.0) / 255.0;
  // Whole fields differ: worn and dry here, damp and dark there.
  c = mix(c, vec3<f32>(0.55, 0.62, 0.30), smoothstep(0.45, 0.8, vnoise(vec2<f32>(p.x * 0.8 - p.y * 0.6, p.x * 0.6 + p.y * 0.8) * 0.17 + 3.0)) * 0.5);
  c = mix(c, vec3<f32>(0.31, 0.49, 0.24), smoothstep(0.45, 0.8, vnoise(p * 0.11 + 61.0)) * 0.5);
  return c;
}

// Blade lattice, in screen-shaped units (a cell's diamond is 2 across), and the frequency they fade in at.
const BLADE_W = 0.007;
const BLADE_H = 0.014;
const BLADE_F = 45.0;
/*
 * Blades of grass, standing up the screen. In screen-shaped space — x across,
 * y down, one unit the same length both ways — a lattice of cells each roots
 * one blade somewhere inside it: a tapered stroke rising from its root, its
 * own height, lean and shade, darker at the root than the tip and lit on its
 * left. Blades rooted lower on the screen stand in front, so the rows are
 * drawn back to front. Between them, the ground in their shadow.
 */
// Where the pixel is on the screen, in screen-shaped units, and how big a pixel
// is there, as fp would be on level ground. Blades stand on the screen, not
// the ground: a slope facing the camera is squashed on screen, and its blades
// must not be.
var<private> gScreen: vec2<f32>;
var<private> gScreenFp: f32;

// The ground point under a screen point, on level ground at height z (half steps).
fn groundAt(sp: vec2<f32>, z: f32) -> vec2<f32> {
  let sum = 2.0 * (sp.y + z * 0.25) + 1.0;
  return vec2<f32>((sum + sp.x) * 0.5, (sum - sp.x) * 0.5);
}

// Opaque over the ground between them; or, for a FRINGE, only the blades
// rooted in the cell at lo, at height z, over nothing (alpha is their cover).
fn blades(base: vec3<f32>, tuft: f32, dens: f32, under: vec3<f32>, fringe: bool, lo: vec2<f32>, z: f32) -> vec4<f32> {
  let fp = gScreenFp;
  let g = vec2<f32>(gScreen.x / BLADE_W, gScreen.y / BLADE_H);
  let gi = vec2<i32>(floor(g));
  let aa = max(fp * 0.9 / BLADE_W, 0.04);
  var col = vec4<f32>(mix(under, base * 0.8, smoothstep(0.55, 0.95, dens)), 1.0);
  if (fringe) { col = vec4<f32>(0.0); }
  for (var dy = 0; dy <= 3; dy++) {
    for (var dx = -1; dx <= 1; dx++) {
      let c = gi + vec2<i32>(dx, dy);
      let h1 = hash(c); let h2 = hash(c + vec2<i32>(17, 3)); let h3 = hash(c + vec2<i32>(5, 29));
      // Thinner toward the grass's edge: fewer blades, and shorter.
      if (hash(c + vec2<i32>(23, 11)) > dens * 1.15) { continue; }
      let root = vec2<f32>(f32(c.x) + 0.2 + 0.6 * h1, f32(c.y) + h2);
      if (fringe) {
        let rg = groundAt(root * vec2<f32>(BLADE_W, BLADE_H), z) - lo;
        if (rg.x < 0.0 || rg.y < 0.0 || rg.x >= 1.0 || rg.y >= 1.0) { continue; }
      }
      let len = (1.3 + 1.5 * h3) * (0.8 + 0.4 * tuft) * mix(0.55, 1.0, dens);
      let t = (root.y - g.y) / len;
      if (t < 0.0 || t > 1.0) { continue; }
      let lean = (hash(c + vec2<i32>(9, 1)) - 0.5) * 1.8;
      let off = g.x - (root.x + lean * t * t);
      let half = 0.34 * (1.0 - t * t);
      let cover = 1.0 - smoothstep(half - aa, half + aa, abs(off));
      if (cover <= 0.0) { continue; }
      let lit = clamp(-off / max(half, 0.05), -1.0, 1.0);
      var bc = base * mix(0.86, 1.2, t) * (0.92 + 0.16 * h1) * (1.0 + 0.1 * lit);
      bc = mix(bc, bc * vec3<f32>(1.08, 1.02, 0.8), step(0.8, h2) * 0.6);
      col = mix(col, vec4<f32>(bc, 1.0), cover);
    }
  }
  return col;
}
// Grass at density dens (1 a lawn, 0 none) over under, the ground it thins out onto.
fn grassAt(p: vec2<f32>, fp: f32, dens: f32, under: vec3<f32>) -> vec3<f32> {
  var c = grassBase(p);
  // Broad patches: lusher and drier.
  let m = fbm(p * 0.45);
  c = mix(c, vec3<f32>(0.60, 0.70, 0.30), smoothstep(0.55, 0.85, m) * 0.25);
  c = c * (0.96 + 0.08 * fbm(p * 0.9 + 5.0));
  // Clumps: tufts, a ridge of noise rather than a blur of it.
  let t = 1.0 - abs(fbm(p * 6.0) * 2.0 - 1.0);
  c = c * (1.0 + (t - 0.6) * 0.12 * shows(9.0, fp));
  // Far off, thinning grass is a speckled fade onto the soil; close up, sparser blades.
  let speck = vnoise(p * 18.0 + 7.0);
  var out = mix(under, c, smoothstep(0.35, 0.7, dens + (speck - 0.5) * 0.7 * shows(18.0, fp)));
  // Grain: the grass too fine to see blade by blade, streaked up the screen.
  out = out * (1.0 + (vnoise(vec2<f32>(gScreen.x * 90.0, gScreen.y * 25.0)) - 0.5) * 0.18 * shows(30.0, gScreenFp) * dens);
  let bf = shows(BLADE_F, gScreenFp);
  if (bf > 0.0) { out = mix(out, blades(c, t, dens, under, false, vec2<f32>(0.0), 0.0).rgb, bf); }
  c = out;
  // A daisy now and then.
  let g = p * 32.0; let gi = vec2<i32>(floor(g));
  let r = hash(gi + vec2<i32>(91, 7));
  if (r > 0.993 && dens > 0.85) {
    let ctr = vec2<f32>(gi) + vec2<f32>(hash(gi + vec2<i32>(3, 1)), hash(gi + vec2<i32>(5, 9))) * 0.6 + 0.2;
    let d = length(g - ctr);
    let petal = 1.0 - smoothstep(0.11, 0.16, d);
    let eye = 1.0 - smoothstep(0.04, 0.07, d);
    let flower = select(vec3<f32>(0.97, 0.96, 0.92), vec3<f32>(0.98, 0.85, 0.35), r > 0.998);
    c = mix(c, mix(flower, vec3<f32>(0.95, 0.75, 0.2), eye), petal * shows(70.0, fp));
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

// A FRINGE: the tips of a grass cell's blades, standing up over whatever is
// behind its back edges — a pavement, a road, a building's foot, a ledge.
fn fringeColour(lo: vec2<f32>, z: f32) -> vec4<f32> {
  let bf = shows(BLADE_F, gScreenFp);
  if (bf <= 0.0) { return vec4<f32>(0.0); }
  let p = groundAt(gScreen, z);
  var c = grassBase(p);
  c = mix(c, vec3<f32>(0.60, 0.70, 0.30), smoothstep(0.55, 0.85, fbm(p * 0.45)) * 0.25);
  c = c * (0.96 + 0.08 * fbm(p * 0.9 + 5.0));
  let t = 1.0 - abs(fbm(p * 6.0) * 2.0 - 1.0);
  c = c * (1.0 + (t - 0.6) * 0.12);
  let r = blades(c, t, 1.0, c, true, lo, z);
  return vec4<f32>(r.rgb, r.a * bf);
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
      // Only ground it meets: a neighbour within a bank of it, not one over a cliff.
      if (k < 1 || k > 3 || c.y > here.y + riseOf(here) + 3.5 || c.y + riseOf(c) < here.y - 3.5) { continue; }
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
  // Dirt and sand meet edge to edge. Grass does not: it thins out over
  // them, reaching a little past its border and letting the soil show
  // through a little inside it.
  let other = max(claim.y, claim.z);
  let dens = select(smoothstep(-0.35, 0.15, claim.x - other), 1.0, other < -1.0);
  var under = grassBase(p) * 0.8;
  if (dens < 0.999 || claim.x < -1.0) {
    let aa = max(fp * 2.4, 0.015);
    var wo = clamp((vec2<f32>(claim.y, claim.z) - other) / aa + 1.0, vec2<f32>(0.0), vec2<f32>(1.0));
    wo = wo / max(wo.x + wo.y, 0.0001);
    under = vec3<f32>(0.0);
    if (wo.x > 0.0) { under = under + dirtAt(p, fp) * wo.x; }
    if (wo.y > 0.0) { under = under + sandAt(p, fp) * wo.y; }
  }
  if (claim.x < -1.0 || dens <= 0.0) { return under; }
  return grassAt(p, fp, dens, under);
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
  // Strands hang over the edge: a jagged hem, one strand to a column.
  let strand = hash(vec2<i32>(i32(floor(along * 60.0)), 41));
  let lipDepth = 0.6 + (vnoise(vec2<f32>(along * 9.0, 3.0)) - 0.5) * 0.4 + (strand - 0.5) * 0.3 * shows(60.0, fp);
  var col = earth;
  // ROCK below the soil: beds of it, each its own tone, a dark joint between, cracked down here and there.
  let soil = select(2.6, 3.4, k == 3) + (vnoise(vec2<f32>(along * 1.3, 9.0)) - 0.5) * 1.6;
  if (depth > soil - 0.3) {
    let b = depth * 0.8 + (vnoise(vec2<f32>(along * 0.6, 4.0)) - 0.5) * 1.4;
    let bed = floor(b); let bf = b - bed; let bi = i32(bed);
    var rock = select(vec3<f32>(104.0, 97.0, 90.0), vec3<f32>(152.0, 142.0, 128.0), lit) / 255.0;
    rock = rock * (0.88 + 0.24 * hash(vec2<i32>(bi, 77))) * (0.93 + 0.14 * fbm(vec2<f32>(along * 2.0, depth * 1.1)));
    rock = rock * (1.0 - min(depth, 14.0) * 0.012);
    rock = rock * (1.0 - 0.3 * (1.0 - smoothstep(0.0, 0.1, bf)) * shows(6.0, fp));
    rock = rock * (1.0 + 0.1 * smoothstep(0.1, 0.22, bf) * (1.0 - smoothstep(0.22, 0.5, bf)) * shows(6.0, fp));
    let u = along * 2.6 + hash(vec2<i32>(bi, 5)) * 9.0 + (vnoise(vec2<f32>(depth * 2.0, along * 3.0)) - 0.5) * 0.25;
    let crack = hash(vec2<i32>(i32(floor(u)), bi)) > 0.45;
    if (crack) { rock = rock * (1.0 - 0.32 * (1.0 - smoothstep(0.0, 0.07, fract(u))) * shows(12.0, fp)); }
    col = mix(earth, rock, smoothstep(soil - 0.3, soil + 0.15, depth + (vnoise(vec2<f32>(along * 14.0, depth * 3.0)) - 0.5) * 0.5));
  }
  if (k == 1 && depth < lipDepth) {
    col = select(vec3<f32>(80.0, 112.0, 48.0), vec3<f32>(102.0, 140.0, 60.0), lit) / 255.0;
    col = col * mix(1.08, 0.8, depth / lipDepth);
    col = col * (1.0 + (vnoise(vec2<f32>(along * 70.0, depth * 1.2)) - 0.5) * 0.35 * shows(70.0, fp));
  } else if (k == 3 && depth < lipDepth) {
    col = select(vec3<f32>(160.0, 154.0, 115.0), vec3<f32>(194.0, 188.0, 142.0), lit) / 255.0;
  } else if (k == 1 && depth < lipDepth + 0.25) {
    col = earth * 0.72;
  }
  return col;
}

@fragment
fn mainFragment(@location(0) vGround: vec2<f32>, @location(1) vWall: vec2<f32>, @location(2) vTint: vec4<f32>, @location(3) vWorld: vec2<f32>) -> @location(0) vec4<f32> {
  gScreen = vWorld * ground.uMap.z;
  let fs = fwidth(gScreen);
  gScreenFp = max(fs.x, fs.y) * 1.5;
  // (A wall's second word is how far down it; a top's is its height, which is no measure of a pixel.)
  let fw = fwidth(vGround) + vec2<f32>(fwidth(vWall.y) * select(0.0, 0.5, vWall.x > 0.5));
  let fp = max(fw.x, fw.y);
  // How steep a top is here, half steps a tile: its height's change over the ground's.
  let fg = fwidth(vGround);
  let steep = fwidth(vWall.y) / max(max(fg.x, fg.y), 0.00001);
  if (vWall.x > 2.5) {
    let f = fringeColour(vGround, vWall.y);
    if (f.a <= 0.003) { discard; }
    return vec4<f32>(f.rgb * f.a, f.a) * vTint;
  }
  var col: vec3<f32>;
  // A top's second word is the light on its slope, 0 on the level.
  if (vWall.x < 0.5) {
    col = topColour(vGround, fp);
    // A STEEP BANK IS BARE: the grass gives out to earth as the ground steepens, in patches.
    if (steep > 1.2) {
      let bare = smoothstep(1.9, 2.9, steep + (fbm(vGround * 4.0 + 3.0) - 0.5) * 1.4);
      if (bare > 0.0) { col = mix(col, dirtAt(vGround, fp) * 0.88, bare * 0.85); }
    }
    // THE BEACH: by standing water, ground within a little of its level is sand, and wet where the water has it.
    let level = textureLoad(uEdges, vec2<i32>(i32(floor(vGround.x)) * 2 + 1, i32(floor(vGround.y))), 0).z;
    if (level > -900.0) {
      let over = vWall.y - level + (fbm(vGround * 2.3 + 9.0) - 0.5) * 0.5;
      let beach = 1.0 - smoothstep(0.15, 0.6, over);
      if (beach > 0.0) { col = mix(col, sandAt(vGround, fp) * mix(0.7, 1.0, smoothstep(-0.02, 0.16, over)), beach); }
    }
    col = relit(col * (1.0 + vWall.x), vGround, vWall.y, true);
  } else {
    col = wallColour(vGround, vWall.x, vWall.y, fp);
    // A face toward the light can stand in the shadow of ground further toward it.
    if (vWall.x > 1.5) {
      // (Asked from just in front of the face: the cliff beside it along the same line is not in its way.)
      let own = cellAt(vec2<i32>(floor(vGround - vec2<f32>(0.0, 0.02))));
      col = relit(col, vGround + vec2<f32>(0.0, 0.002), own.y - 128.0 - vWall.y, false);
    }
  }
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
out vec2 vWorld;
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
  vWorld = aPosition;
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
in vec2 vWorld;
out vec4 finalColor;
uniform vec4 uMap;
uniform sampler2D uCells;
uniform highp sampler2D uEdges;

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
float riseOf(vec4 c) { return floor((c.z + 0.5) / 16.0); }

const vec2 SUN = vec2(-0.94, 0.34);
const float SHADOW_RUN = 0.55;
float topOf(vec4 c) { return c.y - 128.0 + riseOf(c) * 0.5; }
vec4 edgesAt(ivec2 c) { return texelFetch(uEdges, ivec2(c.x * 2, c.y), 0); }
float shadowAt(vec2 p, float h) {
  float s = 0.0;
  float far = (uMap.w - h) * SHADOW_RUN;
  float cx = floor(p.x);
  for (int i = 0; i < 8; i++) {
    float bx = cx - float(i);
    float t = (p.x - bx) / -SUN.x;
    if (t > far) break;
    float y = p.y + SUN.y * t;
    ivec2 at = ivec2(int(bx) - 1, int(floor(y)));
    if (at.x < 0 || at.y < 0 || at.y >= int(uMap.y)) break;
    vec4 e = edgesAt(at);
    s = max(s, smoothstep(0.0, 0.06 + t * 0.22, (mix(e.y, e.z, fract(y)) - h) * SHADOW_RUN - t));
  }
  float cy = floor(p.y);
  for (int j = 0; j < 2; j++) {
    float by = cy + 1.0 + float(j);
    float t = (by - p.y) / SUN.y;
    if (t > far) break;
    float x = p.x + SUN.x * t;
    ivec2 at = ivec2(int(floor(x)), int(by));
    if (at.x < 0 || at.y < 0 || at.y >= int(uMap.y)) break;
    vec4 e = edgesAt(at);
    s = max(s, smoothstep(0.0, 0.06 + t * 0.22, (mix(e.x, e.y, fract(x)) - h) * SHADOW_RUN - t));
  }
  return s;
}
float contactAt(vec2 p, float h) {
  ivec2 cell = ivec2(floor(p));
  float a = 0.0;
  vec2 f = p - floor(p);
  ivec2 side = ivec2(f.x < 0.46 ? -1 : (f.x > 0.54 ? 1 : 0), f.y < 0.46 ? -1 : (f.y > 0.54 ? 1 : 0));
  for (int j = 0; j < 3; j++) {
    {
      int dx = j == 1 ? 0 : side.x; int dy = j == 0 ? 0 : side.y;
      if (dx == 0 && dy == 0) continue;
      if (j == 2 && (dx == 0 || dy == 0)) continue;
      ivec2 n = cell + ivec2(dx, dy);
      vec4 c = cellAt(n);
      if (c.w < 0.5) continue;
      float up = c.y - 128.0 - h;
      if (up < 3.5) continue;
      vec2 lo = vec2(n);
      float d = length(p - clamp(p, lo, lo + 1.0));
      float reach = 0.16 + 0.05 * min(up, 6.0);
      float k = 1.0 - smoothstep(0.0, reach, d);
      a = max(a, k * k * min(1.0, 0.45 + up * 0.14));
    }
  }
  return a;
}
vec3 relit(vec3 col, vec2 p, float h, bool foot) {
  vec3 c = mix(col, col * vec3(0.60, 0.64, 0.74), shadowAt(p, h) * 0.72);
  if (foot) c *= 1.0 - 0.34 * contactAt(p, h);
  return c;
}
vec3 grassBase(vec2 p) {
  vec3 c = vec3(112.0, 156.0, 68.0) / 255.0;
  c = mix(c, vec3(0.55, 0.62, 0.30), smoothstep(0.45, 0.8, vnoise(vec2(p.x * 0.8 - p.y * 0.6, p.x * 0.6 + p.y * 0.8) * 0.17 + 3.0)) * 0.5);
  c = mix(c, vec3(0.31, 0.49, 0.24), smoothstep(0.45, 0.8, vnoise(p * 0.11 + 61.0)) * 0.5);
  return c;
}

const float BLADE_W = 0.007;
const float BLADE_H = 0.014;
const float BLADE_F = 45.0;
vec2 gScreen;
float gScreenFp;
vec2 groundAt(vec2 sp, float z) {
  float sum = 2.0 * (sp.y + z * 0.25) + 1.0;
  return vec2((sum + sp.x) * 0.5, (sum - sp.x) * 0.5);
}
vec4 blades(vec3 base, float tuft, float dens, vec3 under, bool fringe, vec2 lo, float z) {
  float fp = gScreenFp;
  vec2 g = vec2(gScreen.x / BLADE_W, gScreen.y / BLADE_H);
  ivec2 gi = ivec2(floor(g));
  float aa = max(fp * 0.9 / BLADE_W, 0.04);
  vec4 col = fringe ? vec4(0.0) : vec4(mix(under, base * 0.8, smoothstep(0.55, 0.95, dens)), 1.0);
  for (int dy = 0; dy <= 3; dy++) {
    for (int dx = -1; dx <= 1; dx++) {
      ivec2 c = gi + ivec2(dx, dy);
      float h1 = hash(c), h2 = hash(c + ivec2(17, 3)), h3 = hash(c + ivec2(5, 29));
      if (hash(c + ivec2(23, 11)) > dens * 1.15) continue;
      vec2 root = vec2(float(c.x) + 0.2 + 0.6 * h1, float(c.y) + h2);
      if (fringe) {
        vec2 rg = groundAt(root * vec2(BLADE_W, BLADE_H), z) - lo;
        if (rg.x < 0.0 || rg.y < 0.0 || rg.x >= 1.0 || rg.y >= 1.0) continue;
      }
      float len = (1.3 + 1.5 * h3) * (0.8 + 0.4 * tuft) * mix(0.55, 1.0, dens);
      float t = (root.y - g.y) / len;
      if (t < 0.0 || t > 1.0) continue;
      float lean = (hash(c + ivec2(9, 1)) - 0.5) * 1.8;
      float off = g.x - (root.x + lean * t * t);
      float half_ = 0.34 * (1.0 - t * t);
      float cover = 1.0 - smoothstep(half_ - aa, half_ + aa, abs(off));
      if (cover <= 0.0) continue;
      float lit = clamp(-off / max(half_, 0.05), -1.0, 1.0);
      vec3 bc = base * mix(0.86, 1.2, t) * (0.92 + 0.16 * h1) * (1.0 + 0.1 * lit);
      bc = mix(bc, bc * vec3(1.08, 1.02, 0.8), step(0.8, h2) * 0.6);
      col = mix(col, vec4(bc, 1.0), cover);
    }
  }
  return col;
}
vec3 grassAt(vec2 p, float fp, float dens, vec3 under) {
  vec3 c = grassBase(p);
  float m = fbm(p * 0.45);
  c = mix(c, vec3(0.60, 0.70, 0.30), smoothstep(0.55, 0.85, m) * 0.25);
  c *= 0.96 + 0.08 * fbm(p * 0.9 + 5.0);
  float t = 1.0 - abs(fbm(p * 6.0) * 2.0 - 1.0);
  c *= 1.0 + (t - 0.6) * 0.12 * shows(9.0, fp);
  float speck = vnoise(p * 18.0 + 7.0);
  vec3 out_ = mix(under, c, smoothstep(0.35, 0.7, dens + (speck - 0.5) * 0.7 * shows(18.0, fp)));
  out_ *= 1.0 + (vnoise(vec2(gScreen.x * 90.0, gScreen.y * 25.0)) - 0.5) * 0.18 * shows(30.0, gScreenFp) * dens;
  float bf = shows(BLADE_F, gScreenFp);
  if (bf > 0.0) out_ = mix(out_, blades(c, t, dens, under, false, vec2(0.0), 0.0).rgb, bf);
  c = out_;
  vec2 g = p * 32.0; ivec2 gi = ivec2(floor(g));
  float r = hash(gi + ivec2(91, 7));
  if (r > 0.993 && dens > 0.85) {
    vec2 ctr = vec2(gi) + vec2(hash(gi + ivec2(3, 1)), hash(gi + ivec2(5, 9))) * 0.6 + 0.2;
    float d = length(g - ctr);
    float petal = 1.0 - smoothstep(0.11, 0.16, d);
    float eye = 1.0 - smoothstep(0.04, 0.07, d);
    vec3 flower = r > 0.998 ? vec3(0.98, 0.85, 0.35) : vec3(0.97, 0.96, 0.92);
    c = mix(c, mix(flower, vec3(0.95, 0.75, 0.2), eye), petal * shows(70.0, fp));
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

vec4 fringeColour(vec2 lo, float z) {
  float bf = shows(BLADE_F, gScreenFp);
  if (bf <= 0.0) return vec4(0.0);
  vec2 p = groundAt(gScreen, z);
  vec3 c = grassBase(p);
  c = mix(c, vec3(0.60, 0.70, 0.30), smoothstep(0.55, 0.85, fbm(p * 0.45)) * 0.25);
  c *= 0.96 + 0.08 * fbm(p * 0.9 + 5.0);
  float t = 1.0 - abs(fbm(p * 6.0) * 2.0 - 1.0);
  c *= 1.0 + (t - 0.6) * 0.12;
  vec4 r = blades(c, t, 1.0, c, true, lo, z);
  return vec4(r.rgb, r.a * bf);
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
      if (k < 1 || k > 3 || c.y > here.y + riseOf(here) + 3.5 || c.y + riseOf(c) < here.y - 3.5) continue;
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
  float other = max(claim.y, claim.z);
  float dens = other < -1.0 ? 1.0 : smoothstep(-0.35, 0.15, claim.x - other);
  vec3 under = grassBase(p) * 0.8;
  if (dens < 0.999 || claim.x < -1.0) {
    float aa = max(fp * 2.4, 0.015);
    vec2 wo = clamp((vec2(claim.y, claim.z) - other) / aa + 1.0, vec2(0.0), vec2(1.0));
    wo /= max(wo.x + wo.y, 0.0001);
    under = vec3(0.0);
    if (wo.x > 0.0) under += dirtAt(p, fp) * wo.x;
    if (wo.y > 0.0) under += sandAt(p, fp) * wo.y;
  }
  if (claim.x < -1.0 || dens <= 0.0) return under;
  return grassAt(p, fp, dens, under);
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
  float strand = hash(ivec2(int(floor(along * 60.0)), 41));
  float lipDepth = 0.6 + (vnoise(vec2(along * 9.0, 3.0)) - 0.5) * 0.4 + (strand - 0.5) * 0.3 * shows(60.0, fp);
  vec3 col = earth;
  float soil = (k == 3 ? 3.4 : 2.6) + (vnoise(vec2(along * 1.3, 9.0)) - 0.5) * 1.6;
  if (depth > soil - 0.3) {
    float b = depth * 0.8 + (vnoise(vec2(along * 0.6, 4.0)) - 0.5) * 1.4;
    float bed = floor(b); float bf = b - bed; int bi = int(bed);
    vec3 rock = (lit ? vec3(152.0, 142.0, 128.0) : vec3(104.0, 97.0, 90.0)) / 255.0;
    rock *= (0.88 + 0.24 * hash(ivec2(bi, 77))) * (0.93 + 0.14 * fbm(vec2(along * 2.0, depth * 1.1)));
    rock *= 1.0 - min(depth, 14.0) * 0.012;
    rock *= 1.0 - 0.3 * (1.0 - smoothstep(0.0, 0.1, bf)) * shows(6.0, fp);
    rock *= 1.0 + 0.1 * smoothstep(0.1, 0.22, bf) * (1.0 - smoothstep(0.22, 0.5, bf)) * shows(6.0, fp);
    float u = along * 2.6 + hash(ivec2(bi, 5)) * 9.0 + (vnoise(vec2(depth * 2.0, along * 3.0)) - 0.5) * 0.25;
    bool crack = hash(ivec2(int(floor(u)), bi)) > 0.45;
    if (crack) rock *= 1.0 - 0.32 * (1.0 - smoothstep(0.0, 0.07, fract(u))) * shows(12.0, fp);
    col = mix(earth, rock, smoothstep(soil - 0.3, soil + 0.15, depth + (vnoise(vec2(along * 14.0, depth * 3.0)) - 0.5) * 0.5));
  }
  if (k == 1 && depth < lipDepth) {
    col = (lit ? vec3(102.0, 140.0, 60.0) : vec3(80.0, 112.0, 48.0)) / 255.0;
    col *= mix(1.08, 0.8, depth / lipDepth);
    col *= 1.0 + (vnoise(vec2(along * 70.0, depth * 1.2)) - 0.5) * 0.35 * shows(70.0, fp);
  } else if (k == 3 && depth < lipDepth) {
    col = (lit ? vec3(194.0, 188.0, 142.0) : vec3(160.0, 154.0, 115.0)) / 255.0;
  } else if (k == 1 && depth < lipDepth + 0.25) {
    col = earth * 0.72;
  }
  return col;
}

void main() {
  gScreen = vWorld * uMap.z;
  vec2 fs = fwidth(gScreen);
  gScreenFp = max(fs.x, fs.y) * 1.5;
  vec2 fw = fwidth(vGround) + vec2(fwidth(vWall.y) * (vWall.x > 0.5 ? 0.5 : 0.0));
  float fp = max(fw.x, fw.y);
  vec2 fg = fwidth(vGround);
  float steep = fwidth(vWall.y) / max(max(fg.x, fg.y), 0.00001);
  if (vWall.x > 2.5) {
    vec4 f = fringeColour(vGround, vWall.y);
    if (f.a <= 0.003) discard;
    finalColor = vec4(f.rgb * f.a, f.a) * vTint;
    return;
  }
  vec3 col;
  if (vWall.x < 0.5) {
    col = topColour(vGround, fp);
    if (steep > 1.2) {
      float bare = smoothstep(1.9, 2.9, steep + (fbm(vGround * 4.0 + 3.0) - 0.5) * 1.4);
      if (bare > 0.0) col = mix(col, dirtAt(vGround, fp) * 0.88, bare * 0.85);
    }
    float level = texelFetch(uEdges, ivec2(int(floor(vGround.x)) * 2 + 1, int(floor(vGround.y))), 0).z;
    if (level > -900.0) {
      float over = vWall.y - level + (fbm(vGround * 2.3 + 9.0) - 0.5) * 0.5;
      float beach = 1.0 - smoothstep(0.15, 0.6, over);
      if (beach > 0.0) col = mix(col, sandAt(vGround, fp) * mix(0.7, 1.0, smoothstep(-0.02, 0.16, over)), beach);
    }
    col = relit(col * (1.0 + vWall.x), vGround, vWall.y, true);
  } else {
    col = wallColour(vGround, vWall.x, vWall.y, fp);
    if (vWall.x > 1.5) {
      vec4 own = cellAt(ivec2(floor(vGround - vec2(0.0, 0.02))));
      col = relit(col, vGround + vec2(0.0, 0.002), own.y - 128.0 - vWall.y, false);
    }
  }
  finalColor = vec4(col, 1.0) * vTint;
}
`;
