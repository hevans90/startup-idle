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
import { built, cornerShift, cornerZ, drawnCentre, drawnCorner, drawnFlat, drawnHeight, pinned, shelfOf, smoothAt } from "./drawn";
import { groundMode } from "./ground-mode";
import { canopyOf } from "./forest";

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

const bases = new WeakMap<Grid, { rev: number; base: number }>();
/** How thick the map may be drawn at its edge, half steps: a deep river's bed may hang below that. */
const EDGE_THICK = 24;
/**
 * THE MAP'S UNDERSIDE AT ITS EDGE, half steps: one level every wall on the edge goes down to, so the cut through
 * the map has one bottom line and not a step at every change of ground — a little under the lowest ground on the
 * edge, but no more than `EDGE_THICK` under the highest.
 */
export function edgeBase(grid: Grid): number {
  const got = bases.get(grid);
  if (got && got.rev === grid.rev) return got.base;
  let lo = Infinity, hi = -Infinity;
  const see = (x: number, y: number) => { const i = idx(grid, x, y); if (grid.terrain[i] !== VOID) { lo = Math.min(lo, grid.height[i]); hi = Math.max(hi, grid.height[i]); } };
  for (let x = 0; x < grid.w; x++) { see(x, 0); see(x, grid.h - 1); }
  for (let y = 0; y < grid.h; y++) { see(0, y); see(grid.w - 1, y); }
  const base = lo === Infinity ? 0 : Math.max(lo - 3, hi - EDGE_THICK);
  bases.set(grid, { rev: grid.rev, base });
  return base;
}

/**
 * How far down a cell's face shows at one of its corners: to the DRAWN surface
 * of the neighbour `(nx, ny)` in front, at that neighbour's own corner `(u, v)`.
 * Off the map, down to the map's one underside (@see edgeBase); over a void,
 * at least one step below the cell's foot. Never above the top `z`.
 */
export function wallFoot(grid: Grid, x: number, y: number, nx: number, ny: number, u = 0, v = 0, z = grid.height[idx(grid, x, y)]): number {
  const h = grid.height[idx(grid, x, y)];
  if (!inBounds(grid, nx, ny)) return Math.min(edgeBase(grid), h - 2, z);
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
 * And how steep it is there, half steps a tile.
 */
function cornerLight(grid: Grid, palette: Palette, x: number, y: number, u: number, v: number): [number, number] {
  const at = drawnCorner(grid, x, y, u, v);
  let gx = drawnCorner(grid, x, y, 1, v) - drawnCorner(grid, x, y, 0, v), gy = drawnCorner(grid, x, y, u, 1) - drawnCorner(grid, x, y, u, 0);
  const nx = u ? x + 1 : x - 1, ny = v ? y + 1 : y - 1;
  if (groundDraws(grid, palette, nx, y) && drawnCorner(grid, nx, y, 1 - u, v) === at) gx = (gx + drawnCorner(grid, nx, y, 1, v) - drawnCorner(grid, nx, y, 0, v)) / 2;
  if (groundDraws(grid, palette, x, ny) && drawnCorner(grid, x, ny, u, 1 - v) === at) gy = (gy + drawnCorner(grid, x, ny, u, 1) - drawnCorner(grid, x, ny, u, 0)) / 2;
  return [litOf(gx, gy), Math.hypot(gx, gy)];
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
const WORDS = 7;
const STRIDE = WORDS * 4;

export type GroundMesh = {
  /** A texel a cell: class, height + 128, flags (1 drawn, ramp direction × 2, rise in half steps × 16), 255. */
  cells: Uint8Array;
  source: BufferImageSource;
  /** The drawn surface, two texels a cell. @see surfaceOf */
  edges: Float32Array;
  grid: Grid;
  /** The drawn ground's height at the middle of every quarter of a tile, half steps; and the shadow the ground throws there, 0–255. @see bakeShade */
  heights: Float32Array;
  shade: Uint8Array;
  shadeSource: BufferImageSource;
  /** The grass's own green, field by field. @see bakeTint */
  tintSource: BufferImageSource;
  /** The tiles whose heights are out of date, as a box (x0 > x1: none). */
  stale: [number, number, number, number];
  edgeSource: BufferImageSource;
  uniforms: UniformGroup;
  meshes: Mesh<Geometry, Shader>[];
  /** Bands whose quads are out of date. */
  dirty: Set<number>;
  scale: number;
  w: number;
  h: number;
};

/** How finely a tile of the continuous surface is meshed, a side: the grid the water's solver works on. */
const FINE = 4;
const lattice = new Float64Array((FINE + 3) * (FINE + 3));
/**
 * A TILE OF THE CONTINUOUS SURFACE (@see drawn.ts smoothAt): `FINE` by `FINE` quads over it, each vertex at the
 * surface's own height there, lit by its fall toward the sun and saying how steep it is — both from the surface
 * either side of it, so neither turns at a quad's edge or a tile's. One quad where it is all level. No wall but at
 * the map's edge or over a void: bare ground meets what is beside it of itself.
 */
/** A drop smaller than this, half steps, is no face. */
const GAP = 0.01;
/** A built tile's own height at `(u, v)` on it: level, or a ramp's plane. */
const edgeZ = (grid: Grid, x: number, y: number, u: number, v: number): number =>
  (drawnCorner(grid, x, y, 0, 0) * (1 - u) + drawnCorner(grid, x, y, 1, 0) * u) * (1 - v) + (drawnCorner(grid, x, y, 0, 1) * (1 - u) + drawnCorner(grid, x, y, 1, 1) * u) * v;
function smoothCell(grid: Grid, x: number, y: number, at: (gu: number, gv: number, z: number, kind: number, depth: number, steep?: number) => void) {
  const N = FINE + 3, L = lattice, q = 1 / FINE;
  let flat = true;
  for (let b = 0; b < N; b++) for (let a = 0; a < N; a++) {
    const z = L[b * N + a] = smoothAt(grid, x + (a - 1) * q, y + (b - 1) * q);
    if (z !== L[0]) flat = false;
  }
  const zAt = (a: number, b: number) => L[(b + 1) * N + a + 1];
  if (flat) { const z = zAt(0, 0); at(x, y, z, 0, z); at(x + 1, y, z, 0, z); at(x + 1, y + 1, z, 0, z); at(x, y + 1, z, 0, z); }
  else {
    const put = (a: number, b: number) => {
      // The fall across this vertex, half steps a tile, from the surface a quad's width either side.
      const gx = (zAt(a + 1, b) - zAt(a - 1, b)) / (2 * q), gy = (zAt(a, b + 1) - zAt(a, b - 1)) / (2 * q), z = zAt(a, b);
      at(x + a * q, y + b * q, z, litOf(gx, gy), z, Math.hypot(gx, gy));
    };
    // (A quad turned away from the eye is not sent: on one continuous surface what faces away is behind what
    // faces toward, always — and it was being shaded a pixel at a time only to be drawn over.)
    const sy = (a: number, b: number) => (a + b) * q * HH - zAt(a, b) * HEIGHT_UNIT, sx = (a: number, b: number) => (a - b) * q * HW;
    for (let b = 0; b < FINE; b++) for (let a = 0; a < FINE; a++) {
      const ax = sx(a + 1, b + 1) - sx(a, b), ay = sy(a + 1, b + 1) - sy(a, b), bx = sx(a, b + 1) - sx(a + 1, b), by = sy(a, b + 1) - sy(a + 1, b);
      if (ax * by - ay * bx <= 0) continue;
      put(a, b); put(a + 1, b); put(a + 1, b + 1); put(a, b + 1);
    }
  }
  // THE MAP'S EDGE, and a void: a wall down to the map's underside, a quad a stretch of the edge.
  const open = (nx: number, ny: number) => !inBounds(grid, nx, ny) || grid.terrain[idx(grid, nx, ny)] === VOID;
  const foot = (nx: number, ny: number, z: number) => Math.min(inBounds(grid, nx, ny) ? grid.height[idx(grid, nx, ny)] : edgeBase(grid), z - 2);
  // AND BUILT GROUND IN FRONT THAT IT STANDS OVER. Bare ground comes to a built tile's edge at its height — but where
  // two built tiles of different heights meet at a corner it can be at only one height, and stands over the lower
  // (a ramp's foot beside a road). A face down to that tile's edge, a quad a stretch, where there is any drop.
  const onto = (nx: number, ny: number) => inBounds(grid, nx, ny) && grid.terrain[idx(grid, nx, ny)] !== VOID && built(grid, nx, ny);
  const bx = onto(x + 1, y), by = onto(x, y + 1);
  for (let k = 0; k < FINE; k++) {
    if (bx) {
      const za = zAt(FINE, k), zb = zAt(FINE, k + 1);
      const fa = Math.min(za, edgeZ(grid, x + 1, y, 0, k * q)), fb = Math.min(zb, edgeZ(grid, x + 1, y, 0, (k + 1) * q));
      if (za - fa > GAP || zb - fb > GAP) { at(x + 1, y + k * q, za, 1, 0); at(x + 1, y + (k + 1) * q, zb, 1, 0); at(x + 1, y + (k + 1) * q, fb, 1, zb - fb); at(x + 1, y + k * q, fa, 1, za - fa); }
    }
    if (by) {
      const za = zAt(k, FINE), zb = zAt(k + 1, FINE);
      const fa = Math.min(za, edgeZ(grid, x, y + 1, k * q, 0)), fb = Math.min(zb, edgeZ(grid, x, y + 1, (k + 1) * q, 0));
      if (za - fa > GAP || zb - fb > GAP) { at(x + k * q, y + 1, za, 2, 0); at(x + (k + 1) * q, y + 1, zb, 2, 0); at(x + (k + 1) * q, y + 1, fb, 2, zb - fb); at(x + k * q, y + 1, fa, 2, za - fa); }
    }
  }
  for (let k = 0; k < FINE; k++) {
    if (open(x + 1, y)) {
      const za = zAt(FINE, k), zb = zAt(FINE, k + 1), fa = foot(x + 1, y, za), fb = foot(x + 1, y, zb);
      at(x + 1, y + k * q, za, 1, 0); at(x + 1, y + (k + 1) * q, zb, 1, 0); at(x + 1, y + (k + 1) * q, fb, 1, zb - fb); at(x + 1, y + k * q, fa, 1, za - fa);
    }
    if (open(x, y + 1)) {
      const za = zAt(k, FINE), zb = zAt(k + 1, FINE), fa = foot(x, y + 1, za), fb = foot(x, y + 1, zb);
      at(x + k * q, y + 1, za, 2, 0); at(x + (k + 1) * q, y + 1, zb, 2, 0); at(x + (k + 1) * q, y + 1, fb, 2, zb - fb); at(x + k * q, y + 1, fa, 2, za - fa);
    }
  }
}

/** The quads of one band, as vertex floats and indices. Pure: for the mesh and for tests. */
export function bandQuads(grid: Grid, palette: Palette, b: number, scale = 1): { verts: Float32Array; idx: Uint32Array; quads: number } {
  const v: number[] = [];
  // (The last word of a vertex is HOW STEEP the ground is there, half steps a tile — worked out a corner at a time
  // and carried across the face, so what the shader lays by steepness does not change at every triangle's edge.)
  const at = (gu: number, gv: number, z: number, kind: number, depth: number, steep = 0) => {
    // A ground point (cells) at height z, where cellToWorld puts cell centres at +0.5. A corner of the grid on a
    // stepped cliff is DRAWN a little off where it is, to straighten the cliff's line (@see cornerShift) — but says
    // where it IS to the shader, which finds its cell by that.
    let cx = gu - 0.5, cy = gv - 0.5;
    if (Number.isInteger(gu) && Number.isInteger(gv)) { const s = cornerShift(grid, gu, gv); cx += s[0]; cy += s[1]; }
    v.push((cx - cy) * HW * scale, ((cx + cy) * HH - z * HEIGHT_UNIT) * scale, gu, gv, kind, depth, steep);
  };
  const x0 = Math.max(0, b - (grid.h - 1)), x1 = Math.min(grid.w - 1, b);
  for (let x = x0; x <= x1; x++) {
    const y = b - x;
    if (!groundDraws(grid, palette, x, y)) continue;
    if (groundMode() === "smooth" && !built(grid, x, y)) { smoothCell(grid, x, y, at); continue; }
    // THE TOP, corners round its edge: (x, y), (x+1, y), (x+1, y+1), (x, y+1), each at its DRAWN height. A vertex of
    // a top says the light on it where a wall says its kind (under a half either way), and its height. @see drawn.ts
    const z00 = drawnCorner(grid, x, y, 0, 0), z10 = drawnCorner(grid, x, y, 1, 0);
    const z11 = drawnCorner(grid, x, y, 1, 1), z01 = drawnCorner(grid, x, y, 0, 1);
    const zm = drawnCentre(grid, x, y);
    if (pinned(grid, x, y) || (z00 === zm && z10 === zm && z11 === zm && z01 === zm)) {
      // Level, or a ramp: a plane tilted toward its high edge.
      // (A road on the continuous surface is lit by its own fall, corner to corner. @see roadCorner)
      const lit = groundMode() === "smooth" ? litOf((z10 + z11 - z00 - z01) / 2, (z01 + z11 - z00 - z10) / 2) : slopeLight(grid.ramp[idx(grid, x, y)]);
      at(x, y, z00, lit, z00); at(x + 1, y, z10, lit, z10); at(x + 1, y + 1, z11, lit, z11); at(x, y + 1, z01, lit, z01);
    } else {
      // A BANK: a fan from its middle, at the cell's own height, to its corners — four triangles, each a quad with an end doubled.
      const mx = (z10 + z11 - z00 - z01) / 2, my = (z01 + z11 - z00 - z10) / 2;
      const lm = litOf(mx, my);
      const l00 = cornerLight(grid, palette, x, y, 0, 0), l10 = cornerLight(grid, palette, x, y, 1, 0);
      const l11 = cornerLight(grid, palette, x, y, 1, 1), l01 = cornerLight(grid, palette, x, y, 0, 1);
      // (The middle is as steep as its corners are, taken together: a fan's own point is no measure of the bank.)
      const sm = Math.max(Math.hypot(mx, my), (l00[1] + l10[1] + l11[1] + l01[1]) / 4);
      const c: [number, number, number, number, number][] = [
        [x, y, z00, l00[0], l00[1]], [x + 1, y, z10, l10[0], l10[1]], [x + 1, y + 1, z11, l11[0], l11[1]], [x, y + 1, z01, l01[0], l01[1]],
      ];
      for (let k = 0; k < 4; k++) {
        const p = c[k], q = c[(k + 1) % 4];
        at(x + 0.5, y + 0.5, zm, lm, zm, sm); at(p[0], p[1], p[2], p[3], p[2], p[4]); at(q[0], q[1], q[2], q[3], q[2], q[4]); at(q[0], q[1], q[2], q[3], q[2], q[4]);
      }
    }
    // THE FACE ALONG x+1, each end down to what is in front of it there: a
    // trapezoid where either side slopes.
    // (Toward bare ground on the continuous surface the foot is that ground's own line along the edge, a stretch at
    // a time: it comes to this tile's edge all the way along but at a corner another built tile pulls it from —
    // a face ruled corner to corner would be a wedge the length of the tile.)
    const soft = groundMode() === "smooth";
    const bare = (nx: number, ny: number) => soft && inBounds(grid, nx, ny) && grid.terrain[idx(grid, nx, ny)] !== VOID && !built(grid, nx, ny);
    if (bare(x + 1, y)) {
      for (let k = 0; k < FINE; k++) {
        const ta = z10 + (z11 - z10) * k / FINE, tb = z10 + (z11 - z10) * (k + 1) / FINE;
        const pa = Math.min(ta, smoothAt(grid, x + 1, y + k / FINE)), pb = Math.min(tb, smoothAt(grid, x + 1, y + (k + 1) / FINE));
        if (ta - pa > GAP || tb - pb > GAP) { at(x + 1, y + k / FINE, ta, 1, 0); at(x + 1, y + (k + 1) / FINE, tb, 1, 0); at(x + 1, y + (k + 1) / FINE, pb, 1, tb - pb); at(x + 1, y + k / FINE, pa, 1, ta - pa); }
      }
    }
    const fa = wallFoot(grid, x, y, x + 1, y, 0, 0, z10), fb = wallFoot(grid, x, y, x + 1, y, 0, 1, z11);
    if (!bare(x + 1, y) && (fa < z10 || fb < z11)) { at(x + 1, y, z10, 1, 0); at(x + 1, y + 1, z11, 1, 0); at(x + 1, y + 1, fb, 1, z11 - fb); at(x + 1, y, fa, 1, z10 - fa); }
    // AND ALONG y+1.
    if (bare(x, y + 1)) {
      for (let k = 0; k < FINE; k++) {
        const ta = z01 + (z11 - z01) * k / FINE, tb = z01 + (z11 - z01) * (k + 1) / FINE;
        const pa = Math.min(ta, smoothAt(grid, x + k / FINE, y + 1)), pb = Math.min(tb, smoothAt(grid, x + (k + 1) / FINE, y + 1));
        if (ta - pa > GAP || tb - pb > GAP) { at(x + k / FINE, y + 1, ta, 2, 0); at(x + (k + 1) / FINE, y + 1, tb, 2, 0); at(x + (k + 1) / FINE, y + 1, pb, 2, tb - pb); at(x + k / FINE, y + 1, pa, 2, ta - pa); }
      }
    }
    const ga = wallFoot(grid, x, y, x, y + 1, 0, 0, z01), gb = wallFoot(grid, x, y, x, y + 1, 1, 0, z11);
    if (!bare(x, y + 1) && (ga < z01 || gb < z11)) { at(x, y + 1, z01, 2, 0); at(x + 1, y + 1, z11, 2, 0); at(x + 1, y + 1, gb, 2, z11 - gb); at(x, y + 1, ga, 2, z01 - ga); }
    // AT THE MAP'S EDGE A SHORE IS CUT THROUGH: over the wall, which is the bank's own profile, the water's cut
    // face — from its level down to the drawn ground along that edge, and no further along it than the ground is
    // under the water. (Elsewhere the water's own mesh draws its sides; a shelf has none. @see water-gpu.ts)
    if (shelfOf(grid, x, y) !== null) {
      const level = grid.height[idx(grid, x, y)] + grid.pool[idx(grid, x, y)];
      const cut = (ax: number, ay: number, az: number, bx: number, by: number, bz: number) => {
        if (az >= level && bz >= level) return;
        // The stretch of the edge under water: all of it, or from the low end to where the ground comes up through.
        let x0 = ax, y0 = ay, z0 = az, x1 = bx, y1 = by, z1 = bz;
        if (az >= level) { const t = (az - level) / (az - bz); x0 = ax + (bx - ax) * t; y0 = ay + (by - ay) * t; z0 = level; }
        if (bz >= level) { const t = (level - az) / (bz - az); x1 = ax + (bx - ax) * t; y1 = ay + (by - ay) * t; z1 = level; }
        at(x0, y0, level, 5, 0); at(x1, y1, level, 5, 0); at(x1, y1, z1, 5, level - z1); at(x0, y0, z0, 5, level - z0);
      };
      if (!inBounds(grid, x + 1, y)) cut(x + 1, y, z10, x + 1, y + 1, z11);
      if (!inBounds(grid, x, y + 1)) cut(x, y + 1, z01, x + 1, y + 1, z11);
    }
    // THE FRINGE over each back edge where something else is behind it, for
    // the tips of this cell's blades to stand over. Ground (x, y) is the cell,
    // the second word its height. @see fringeColour
    if (fringes(grid, palette, x, y)) {
      const fr = (gu: number, gv: number, lift: number) => {
        const s = cornerShift(grid, gu, gv), cx = gu + s[0] - 0.5, cy = gv + s[1] - 0.5;
        v.push((cx - cy) * HW * scale, ((cx + cy) * HH - z00 * HEIGHT_UNIT - lift * HW) * scale, x, y, 3, z00, 0);
      };
      if (fringeBehind(grid, palette, x, y - 1, z00)) { fr(x, y, 0); fr(x + 1, y, 0); fr(x + 1, y, FRINGE); fr(x, y, FRINGE); }
      if (fringeBehind(grid, palette, x - 1, y, z00)) { fr(x, y + 1, 0); fr(x, y, 0); fr(x, y, FRINGE); fr(x, y + 1, FRINGE); }
    }
  }
  // Never empty: a buffer of nothing is no buffer at all to some drivers. One quad at a point draws nothing.
  if (!v.length) for (let k = 0; k < 4; k++) v.push(0, 0, 0, 0, 0, 0, 0);
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
  // And 128 where it is PLAIN: every cell round it is the same stuff (or nothing the shader knows), so there is no
  // border within reach and the shader need not look for one — nine cells a pixel, on most of the map.
  let plain = 128;
  const own = gm.cells[o];
  for (let dy = -1; dy <= 1 && plain; dy++) for (let dx = -1; dx <= 1; dx++) {
    if (!inBounds(grid, x + dx, y + dy)) continue;
    const k = groundClassOf(palette, grid.terrain[idx(grid, x + dx, y + dy)]);
    if (k !== GROUND.none && k !== own) { plain = 0; break; }
  }
  gm.cells[o + 2] = (groundDraws(grid, palette, x, y) ? 1 : 0) | (rampDir(grid.ramp[i]) << 1) | (rampRise(grid.ramp[i]) << 4) | plain;
  gm.cells[o + 3] = 255;
  writeEdges(gm, grid, x, y, palette);
}
/**
 * THE DRAWN SURFACE AS A TEXTURE, two texels a cell, floats: its four corners (0,0), (1,0), (1,1), (0,1), half
 * steps; then its middle, what it is to water (1 a shelf, 2 sloped), the level of the standing water on it or beside it (−999 with
 * none), and 2 where it has standing water of its own. The ground's shader reads it for shadows and the beach; the water's for where the shore cuts it.
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
/** How many cells from standing water the ground is still told its level, for the beach; and how much lower it is told it for each cell past the first, half steps. */
const BEACH_REACH = 4, BEACH_FADE = 0.35;
function writeEdges(gm: GroundMesh, grid: Grid, x: number, y: number, palette: Palette) {
  const o = idx(grid, x, y) * 8, e = gm.edges;
  e[o] = drawnCorner(grid, x, y, 0, 0); e[o + 1] = drawnCorner(grid, x, y, 1, 0); e[o + 2] = drawnCorner(grid, x, y, 1, 1); e[o + 3] = drawnCorner(grid, x, y, 0, 1);
  e[o + 4] = drawnCentre(grid, x, y);
  // 1 a shelf; 2 bare ground that is not level, which thin water lies on as drawn. @see water-gpu.ts groundKind
  e[o + 5] = shelfOf(grid, x, y) !== null ? 1 : !pinned(grid, x, y) && !drawnFlat(grid, x, y) ? 2 : 0;
  // THE WATER'S LEVEL, FOR THE BEACH: of the standing water nearest, out to `BEACH_REACH` cells — and told a little
  // lower for each cell further off, so the sand gives out by height as it gets away from the water and does not
  // stop dead at the edge of the last cell that was told. (−999: no water near.)
  let level = -999;
  for (let dy = -BEACH_REACH; dy <= BEACH_REACH; dy++) for (let dx = -BEACH_REACH; dx <= BEACH_REACH; dx++) {
    if (!inBounds(grid, x + dx, y + dy)) continue;
    const j = idx(grid, x + dx, y + dy);
    if (grid.pool[j] > 0) level = Math.max(level, grid.height[j] + grid.pool[j] - BEACH_FADE * Math.max(0, Math.max(Math.abs(dx), Math.abs(dy)) - 1));
  }
  // The last: 1, or 2 with standing water of its own; and 4 and 8 more where its drawn edge toward +x and +y is the
  // next cell's own — they are ONE PIECE of ground there, no cliff or wall between; and 16 more where it is BUILT
  // on (paving, a building: flat, whatever is beside it). @see water-gpu.ts pieceOf
  const same = (a: number, b: number) => Math.abs(a - b) < 1e-3;
  const jx = inBounds(grid, x + 1, y) && same(e[o + 1], drawnCorner(grid, x + 1, y, 0, 0)) && same(e[o + 2], drawnCorner(grid, x + 1, y, 0, 1));
  const jy = inBounds(grid, x, y + 1) && same(e[o + 3], drawnCorner(grid, x, y + 1, 0, 0)) && same(e[o + 2], drawnCorner(grid, x, y + 1, 1, 0));
  // And on the continuous surface, 32 × how thick the wood's canopy is over it, in eighths: its forest floor. @see forest.ts
  const canopy = groundMode() === "smooth" ? Math.round(canopyOf(grid, palette, x, y) * 7) : 0;
  e[o + 6] = level; e[o + 7] = (grid.pool[idx(grid, x, y)] > 0 ? 2 : 1) + (jx ? 4 : 0) + (jy ? 8 : 0) + (built(grid, x, y) ? 16 : 0) + canopy * 32;
}

export function createGroundMesh(grid: Grid, bl: BandLayer, palette: Palette, scale = 1): GroundMesh {
  const cells = new Uint8Array(grid.w * grid.h * 4);
  const source = new BufferImageSource({ resource: cells, width: grid.w, height: grid.h, format: "rgba8unorm", scaleMode: "nearest" });
  const uniforms = new UniformGroup({
    // The map's size; world px to screen-shaped units, where a cell's diamond is 2 across; and the highest ground
    // there is, half steps: nothing higher can throw a shadow. @see shadowAt
    uMap: { value: new Float32Array([grid.w, grid.h, 1 / (HW * scale), grid.maxHeight + 2]), type: "vec4<f32>" },
    // Whether the ground is one continuous surface (@see ground-mode.ts): it has no walls for shade to gather at the foot of.
    uMode: { value: new Float32Array([groundMode() === "smooth" ? 1 : 0, 0, 0, 0]), type: "vec4<f32>" },
    // THE YEAR on the ground: spring's flowers, summer's straw, the grass gone over, the snow. @see seasonGround
    uSeason: { value: new Float32Array([0, 0, 0, 0]), type: "vec4<f32>" },
  });
  const { data: edges, source: edgeSource } = surfaceOf(grid);
  const shade = new Uint8Array(grid.w * SHADE * grid.h * SHADE);
  const shadeSource = new BufferImageSource({ resource: shade, width: grid.w * SHADE, height: grid.h * SHADE, format: "r8unorm", scaleMode: "nearest" });
  const tintSource = new BufferImageSource({ resource: bakeTint(grid.w, grid.h), width: grid.w * SHADE, height: grid.h * SHADE, format: "rgba8unorm", scaleMode: "nearest" });
  const gm: GroundMesh = { cells, source, edges, edgeSource, grid, heights: new Float32Array(shade.length), shade, shadeSource, tintSource, stale: [0, 0, grid.w - 1, grid.h - 1], uniforms, meshes: [], dirty: new Set(), scale, w: grid.w, h: grid.h };
  for (let y = 0; y < grid.h; y++) for (let x = 0; x < grid.w; x++) writeCell(gm, grid, palette, x, y);
  source.update();
  edgeSource.update();
  bakeShade(gm, grid);
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
        aSteep: { buffer: vb, format: "float32", stride: STRIDE, offset: 24 },
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

// The shader's own noise, here: for what of the ground's look is too broad to need working out a pixel at a time.
const hashOf = (x: number, y: number) => {
  let h = (Math.imul(x, 1664525) + Math.imul(y, 1013904223)) | 0;
  h ^= h >>> 16; h = Math.imul(h, 0x7feb352d); h ^= h >>> 15; h = Math.imul(h, 0x846ca68b); h ^= h >>> 16;
  return (h >>> 0) / 4294967295;
};
const noiseOf = (x: number, y: number) => {
  const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
  const ux = fx * fx * fx * (fx * (fx * 6 - 15) + 10), uy = fy * fy * fy * (fy * (fy * 6 - 15) + 10);
  const a = hashOf(ix, iy), b = hashOf(ix + 1, iy), c = hashOf(ix, iy + 1), d = hashOf(ix + 1, iy + 1);
  return (a + (b - a) * ux) * (1 - uy) + (c + (d - c) * ux) * uy;
};
const fbmOf = (x: number, y: number) =>
  noiseOf(x, y) * 0.5 + noiseOf((x * 0.8 - y * 0.6) * 2.03 + 17, (x * 0.6 + y * 0.8) * 2.03 + 17) * 0.3 + noiseOf((x * 0.28 + y * 0.96) * 4.1 + 41, (y * 0.28 - x * 0.96) * 4.1 + 41) * 0.2;
const stepOf = (a: number, b: number, v: number) => { const t = Math.max(0, Math.min(1, (v - a) / (b - a))); return t * t * (3 - 2 * t); };
/**
 * THE GRASS'S OWN GREEN, FIELD BY FIELD, as a texture: worn and dry here, damp and dark there, lusher in patches —
 * all of it far broader than a pixel, and it was worked out afresh at every one. Once a map, `SHADE` texels a tile
 * a side; the shader blends the four round a point.
 */
function bakeTint(w: number, h: number): Uint8Array {
  const W = w * SHADE, H = h * SHADE, out = new Uint8Array(W * H * 4);
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    const x = (i + 0.5) / SHADE, y = (j + 0.5) / SHADE;
    let r = 112 / 255, g = 156 / 255, b = 68 / 255;
    const mixTo = (tr: number, tg: number, tb: number, k: number) => { r += (tr - r) * k; g += (tg - g) * k; b += (tb - b) * k; };
    mixTo(0.55, 0.62, 0.30, stepOf(0.45, 0.8, noiseOf((x * 0.8 - y * 0.6) * 0.17 + 3, (x * 0.6 + y * 0.8) * 0.17 + 3)) * 0.5);
    mixTo(0.31, 0.49, 0.24, stepOf(0.45, 0.8, noiseOf(x * 0.11 + 61, y * 0.11 + 61)) * 0.5);
    mixTo(0.60, 0.70, 0.30, stepOf(0.55, 0.85, fbmOf(x * 0.45, y * 0.45)) * 0.25);
    const k = 0.96 + 0.08 * noiseOf(x * 0.9 + 5, y * 0.9 + 5), o = (j * W + i) * 4;
    out[o] = Math.round(Math.min(1, r * k) * 255); out[o + 1] = Math.round(Math.min(1, g * k) * 255); out[o + 2] = Math.round(Math.min(1, b * k) * 255); out[o + 3] = 255;
  }
  return out;
}

/** How finely the ground's shadow is kept, a side of a tile: the grid the continuous surface is meshed on. */
const SHADE = 4;
/** Toward the light along the ground, and the tiles of shadow a half step of height throws: the shader's own (`SUN`, `SHADOW_RUN`). */
const SHADOW_RUN = 0.55;
/**
 * THE SHADOW THE GROUND THROWS ON ITSELF, worked out here and not a pixel at a time: the drawn ground's height at
 * the middle of every quarter of a tile (only where it has changed), then from each a walk toward the sun, a
 * quarter of a tile a step, asking whether what stands there stands over the ray — soft, softer the further it
 * falls, and only from ground well over the point (a bank's own fall is lit by its slope). The shader reads the
 * answer, four texels a pixel, where it walked ten cells of the map for it. @see shadowAt
 */
/** How far behind a crest its shade reaches, tiles toward the back of the map; and how dark it is at its deepest, of a full shadow. */
const BEHIND = 1.5, BEHIND_DARK = 0.6;
function bakeShade(gm: GroundMesh, grid: Grid) {
  const W = grid.w * SHADE, H = grid.h * SHADE, hs = gm.heights, st = gm.stale;
  if (st[0] <= st[2]) {
    // (A cell's height shapes the ground two cells out, and one more for good measure.)
    const x0 = Math.max(0, st[0] - 3) * SHADE, y0 = Math.max(0, st[1] - 3) * SHADE, x1 = Math.min(grid.w, st[2] + 4) * SHADE, y1 = Math.min(grid.h, st[3] + 4) * SHADE;
    for (let j = y0; j < y1; j++) for (let i = x0; i < x1; i++) hs[j * W + i] = drawnHeight(grid, (i + 0.5) / SHADE, (j + 0.5) / SHADE);
    st[0] = 1; st[2] = 0;
  }
  shadeOf(hs, W, H, grid.maxHeight + 2, gm.shade);
  gm.shadeSource.update();
}
/** The shade of every quarter of a tile (0 lit … 255 a full shadow) from the heights at their middles, `W` by `H` of them; `top` over the highest ground. @see bakeShade */
export function shadeOf(hs: ArrayLike<number>, W: number, H: number, top: number, out: Uint8Array) {
  const step = 1 / SHADE;
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    const h = hs[j * W + i], far = (top - h) * SHADOW_RUN;
    let s = 0;
    for (let k = 1, t = step; t <= far && k <= 48; k++, t += step) {
      const qi = Math.round(i + SUN_X * k), qj = Math.round(j + SUN_Y * k);
      if (qi < 0 || qj < 0 || qi >= W || qj >= H) break;
      const up = hs[qj * W + qi] - h, over = up * SHADOW_RUN - t;
      if (over <= 0 || up <= 0.7) continue;
      const a = Math.min(1, over / (0.06 + t * 0.22)), b = Math.min(1, (up - 0.7) / 1.5);
      const v = a * a * (3 - 2 * a) * (b * b * (3 - 2 * b));
      if (v > s) { s = v; if (s >= 1) break; }
    }
    // AND THE FOOT OF A DROP THAT FACES AWAY: ground that stands over this point on the eye's side of it — the
    // crest that hides its own face — shades what lies behind it, deepest right under the crest and gone within
    // `BEHIND` tiles. Without it the crest is a line ruled between two lit fields.
    let o = 0;
    for (let k = 1; k <= BEHIND * SHADE; k++) {
      const qi = i + k, qj = j + k;
      if (qi >= W || qj >= H) break;
      const t = k * step, a = Math.min(1, Math.max(0, (hs[qj * W + qi] - h - 1.5 - 2 * t) / 2)), v = a * a * (3 - 2 * a) * (1 - (t - step) / BEHIND);
      if (v > o) o = v;
    }
    out[j * W + i] = Math.round(Math.max(s, o * BEHIND_DARK) * 255);
  }
}

/** A cell changed: its texel now, and the bands whose quads it can touch at the next flush. */
export function markGround(gm: GroundMesh, grid: Grid, palette: Palette, x: number, y: number) {
  if (!inBounds(grid, x, y)) return;
  // (Itself and the cells round it: whether each is plain is by its neighbours.)
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (inBounds(grid, x + dx, y + dy)) writeCell(gm, grid, palette, x + dx, y + dy);
  const st = gm.stale;
  if (st[0] > st[2]) { st[0] = st[2] = x; st[1] = st[3] = y; } else { st[0] = Math.min(st[0], x); st[1] = Math.min(st[1], y); st[2] = Math.max(st[2], x); st[3] = Math.max(st[3], y); }
  // Every cell that shares a corner with it is drawn by its height too (@see drawn.ts), and the walls and fringes of
  // the cells beside those: two bands either way.
  // (As one continuous surface a cell's height shapes the ground two cells out: further each way.)
  const far = groundMode() === "smooth" ? 2 : 1;
  // (The edges out as far as a cell is told the water's level for the beach — the level is the ground's height and its water's.)
  for (let dy = -BEACH_REACH; dy <= BEACH_REACH; dy++) for (let dx = -BEACH_REACH; dx <= BEACH_REACH; dx++) if ((dx || dy) && inBounds(grid, x + dx, y + dy)) writeEdges(gm, grid, x + dx, y + dy, palette);
  const b = bandOf(x, y);
  for (let k = b - 3 - far; k <= b + 3 + far; k++) if (k >= 0 && k < gm.meshes.length) gm.dirty.add(k);
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
  bakeShade(gm, grid);
  const map = gm.uniforms.uniforms.uMap as Float32Array;
  if (map[3] !== grid.maxHeight + 2) { map[3] = grid.maxHeight + 2; gm.uniforms.update(); }
}

/** THE YEAR on the ground, each frame: on the continuous surface only. @see world/calendar groundSeason */
export function seasonGround(gm: GroundMesh, s: { bloom: number; dry: number; brown: number; snow: number } | null) {
  const u = gm.uniforms.uniforms.uSeason as Float32Array;
  const b = s ? s.bloom : 0, d = s ? s.dry : 0, r = s ? s.brown : 0, w = s ? s.snow : 0;
  if (u[0] === b && u[1] === d && u[2] === r && u[3] === w) return;
  u[0] = b; u[1] = d; u[2] = r; u[3] = w;
  gm.uniforms.update();
}

export function destroyGroundMesh(gm: GroundMesh) {
  if (surfaces.get(gm.grid)?.source === gm.edgeSource) surfaces.delete(gm.grid);
  for (const m of gm.meshes) { m.parent?.removeChild(m); m.geometry.destroy(true); m.destroy(); }
  gm.meshes.length = 0;
  gm.source.destroy();
  gm.shadeSource.destroy();
  gm.tintSource.destroy();
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
      layout: [{ globalUniforms: 0 }, { localUniforms: 0 }, { ground: 0, uCells: 1, uEdges: 2, uShade: 3, uTint: 4 }],
      gpuLayout: [
        [{ binding: 0, visibility: 3, buffer: { type: "uniform" } }],
        [{ binding: 0, visibility: 3, buffer: { type: "uniform" } }],
        [
          { binding: 0, visibility: 2, buffer: { type: "uniform" } },
          { binding: 1, visibility: 2, texture: { sampleType: "float", viewDimension: "2d", multisampled: false } },
          { binding: 2, visibility: 2, texture: { sampleType: "unfilterable-float", viewDimension: "2d", multisampled: false } },
          { binding: 3, visibility: 2, texture: { sampleType: "float", viewDimension: "2d", multisampled: false } },
          { binding: 4, visibility: 2, texture: { sampleType: "float", viewDimension: "2d", multisampled: false } },
        ],
      ],
    }),
    gl: GlProgram.from({ vertex: GLSL_VERTEX, fragment: GLSL_FRAGMENT, name: "ground" }),
  };
  return new Shader({ gpuProgram: program.gpu, glProgram: program.gl, resources: { ground: gm.uniforms, uCells: gm.source, uEdges: gm.edgeSource, uShade: gm.shadeSource, uTint: gm.tintSource } });
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
struct Ground { uMap: vec4<f32>, uMode: vec4<f32>, uSeason: vec4<f32> };
@group(2) @binding(0) var<uniform> ground : Ground;
@group(2) @binding(1) var uCells : texture_2d<f32>;
@group(2) @binding(2) var uEdges : texture_2d<f32>;
@group(2) @binding(3) var uShade : texture_2d<f32>;
@group(2) @binding(4) var uTint : texture_2d<f32>;

struct VSOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) vGround: vec2<f32>,
  @location(1) vWall: vec2<f32>,
  @location(2) vTint: vec4<f32>,
  @location(3) vWorld: vec2<f32>,
  @location(4) vSteep: f32,
};

@vertex
fn mainVertex(@location(0) aPosition: vec2<f32>, @location(1) aGround: vec2<f32>, @location(2) aWall: vec2<f32>, @location(3) aSteep: f32) -> VSOutput {
  let mvp = globalUniforms.uProjectionMatrix * globalUniforms.uWorldTransformMatrix * localUniforms.uTransformMatrix;
  var out: VSOutput;
  out.position = vec4<f32>((mvp * vec3<f32>(aPosition, 1.0)).xy, 0.0, 1.0);
  out.vGround = aGround;
  out.vWorld = aPosition;
  out.vWall = aWall;
  out.vSteep = aSteep;
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
fn riseOf(c: vec4<f32>) -> f32 { return floor((c.z - 128.0 * step(127.5, c.z) + 0.5) / 16.0); }

// THE SUN: which way the light comes from, along the ground — from the screen's left and a little above it, as
// every baked thing is lit — and how many tiles of shadow a half step of height throws.
const SUN = vec2<f32>(-0.94, 0.34);
const SHADOW_RUN = 0.55;
// A cell's height in half steps, a ramp's at its middle.
fn topOf(c: vec4<f32>) -> f32 { return c.y - 128.0 + riseOf(c) * 0.5; }
// A cell's drawn corners (0,0), (1,0), (1,1), (0,1), half steps. @see surfaceOf
fn edgesAt(c: vec2<i32>) -> vec4<f32> { return textureLoad(uEdges, vec2<i32>(c.x * 2, c.y), 0); }
// HOW MUCH OF THE SUN IS KEPT OFF a point at height h by the ground toward it: the ray walked a cell boundary at
// a time, each cell it enters asked whether it stands over the ray there. Soft, and softer the further it falls;
// and only from ground that stands well over the point — a bank's own fall is lit by its slope, not shadowed in wedges.
// The water's level a cell was told for the beach; one told none, a little under the asker's own. @see writeEdges
fn levelAt(c: vec2<i32>, own: f32) -> f32 {
  let n = vec2<i32>(i32(ground.uMap.x), i32(ground.uMap.y));
  let v = textureLoad(uEdges, vec2<i32>(clamp(c.x, 0, n.x - 1) * 2 + 1, clamp(c.y, 0, n.y - 1)), 0).z;
  return select(own - 0.35, v, v > -900.0);
}
fn shadeAt(c: vec2<i32>, n: vec2<i32>) -> f32 { return textureLoad(uShade, clamp(c, vec2<i32>(0), n - vec2<i32>(1)), 0).r; }
fn shadowAt(p: vec2<f32>, h: f32) -> f32 {
  // Worked out when the ground was (@see bakeShade): the four answers round the point, blended.
  let n = vec2<i32>(i32(ground.uMap.x), i32(ground.uMap.y)) * ${SHADE};
  let q = p * ${SHADE}.0 - 0.5;
  let c = vec2<i32>(floor(q)); let f = q - floor(q);
  return mix(mix(shadeAt(c, n), shadeAt(c + vec2<i32>(1, 0), n), f.x), mix(shadeAt(c + vec2<i32>(0, 1), n), shadeAt(c + vec2<i32>(1, 1), n), f.x), f.y);
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
  var c = mix(col, col * vec3<f32>(0.60, 0.64, 0.74), shadowAt(p, h) * mix(0.72, 0.5, ground.uMode.x));
  if (foot) { c = c * (1.0 - 0.34 * contactAt(p, h)); }
  return c;
}
fn tintAt(c: vec2<i32>, n: vec2<i32>) -> vec3<f32> { return textureLoad(uTint, clamp(c, vec2<i32>(0), n - vec2<i32>(1)), 0).rgb; }
// The grass's own green here, field by field: worked out once a map (@see bakeTint), the four answers round the point blended.
fn grassBase(p: vec2<f32>) -> vec3<f32> {
  let n = vec2<i32>(i32(ground.uMap.x), i32(ground.uMap.y)) * ${SHADE};
  let q = p * ${SHADE}.0 - 0.5;
  let c = vec2<i32>(floor(q)); let f = q - floor(q);
  return seasonGrass(mix(mix(tintAt(c, n), tintAt(c + vec2<i32>(1, 0), n), f.x), mix(tintAt(c + vec2<i32>(0, 1), n), tintAt(c + vec2<i32>(1, 1), n), f.x), f.y), p);
}
// THE GRASS THROUGH THE YEAR: fresher in spring, straw in patches in summer, gone over from autumn till it greens.
fn seasonGrass(c: vec3<f32>, p: vec2<f32>) -> vec3<f32> {
  let s = ground.uSeason;
  if (s.x + s.y + s.z <= 0.0) { return c; }
  let patchy = fbm(p * 0.3 + 91.0);
  var g = mix(c, c * vec3<f32>(1.02, 1.05, 0.95) + vec3<f32>(0.005, 0.012, 0.0), s.x * 0.5);
  // (Straw in patches, the rest still green: a dry summer, not a dead one.)
  g = mix(g, vec3<f32>(0.71, 0.67, 0.39) * (0.86 + 0.28 * patchy), s.y * smoothstep(0.38, 0.78, patchy) * 0.65);
  g = mix(g, vec3<f32>(0.5, 0.48, 0.31) * (0.9 + 0.2 * patchy), s.z * (0.35 + 0.35 * patchy));
  return g;
}
// SNOW, a little blue, a little uneven, a glint here and there close up.
fn snowAt(p: vec2<f32>, fp: f32) -> vec3<f32> {
  var c = vec3<f32>(0.9, 0.93, 0.97) * (0.95 + 0.07 * vnoise(p * 2.3 + 3.0));
  c = c * (1.0 + (vnoise(p * 14.0) - 0.5) * 0.05 * shows(14.0, fp));
  let gl = hash(vec2<i32>(floor(p * 70.0)));
  return mix(c, vec3<f32>(1.0), step(0.985, gl) * 0.6 * shows(70.0, fp));
}
// THE CANOPY over a point, 0–1: each cell's (@see writeEdges), blended between their middles.
fn canopyCell(c: vec2<i32>) -> f32 {
  let n = vec2<i32>(i32(ground.uMap.x), i32(ground.uMap.y));
  if (c.x < 0 || c.y < 0 || c.x >= n.x || c.y >= n.y) { return 0.0; }
  return floor((textureLoad(uEdges, vec2<i32>(c.x * 2 + 1, c.y), 0).w + 0.5) / 32.0) / 7.0;
}
fn canopyAt(p: vec2<f32>) -> f32 {
  let q = p - 0.5; let c = vec2<i32>(floor(q)); let f = q - floor(q);
  return mix(mix(canopyCell(c), canopyCell(c + vec2<i32>(1, 0)), f.x), mix(canopyCell(c + vec2<i32>(0, 1)), canopyCell(c + vec2<i32>(1, 1)), f.x), f.y);
}
// THE FOREST FLOOR: shaded, litter and moss over earth, more fallen leaves in autumn.
fn forestFloor(p: vec2<f32>, fp: f32) -> vec3<f32> {
  var c = mix(vec3<f32>(0.27, 0.33, 0.17), vec3<f32>(0.4, 0.33, 0.21), smoothstep(0.35, 0.7, fbm(p * 1.4 + 17.0)));
  c = mix(c, vec3<f32>(0.24, 0.38, 0.17), smoothstep(0.62, 0.8, vnoise(p * 3.1 + 5.0)) * 0.7);
  c = mix(c, vec3<f32>(0.56, 0.36, 0.16), ground.uSeason.z * smoothstep(0.35, 0.75, vnoise(p * 5.0 + 29.0)) * 0.6);
  return c * (1.0 + (vnoise(p * 16.0) - 0.5) * 0.16 * shows(16.0, fp));
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
  // Clumps: tufts, a ridge of noise rather than a blur of it. (Only as near as they can be seen: what cannot show
  // at this zoom is not worked out — most of what the ground costs to draw was detail too small for its pixels.)
  var t = 0.6;
  let tufts = shows(9.0, fp);
  if (tufts > 0.0 || shows(BLADE_F, gScreenFp) > 0.0) { t = 1.0 - abs(fbm(p * 6.0) * 2.0 - 1.0); }
  c = c * (1.0 + (t - 0.6) * 0.12 * tufts);
  // Far off, thinning grass is a speckled fade onto the soil; close up, sparser blades.
  var out = c;
  if (dens < 0.999) {
    let speck = vnoise(p * 18.0 + 7.0);
    out = mix(under, c, smoothstep(0.35, 0.7, dens + (speck - 0.5) * 0.7 * shows(18.0, fp)));
  }
  // Grain: the grass too fine to see blade by blade, streaked up the screen.
  let grain = shows(30.0, gScreenFp);
  if (grain > 0.0) { out = out * (1.0 + (vnoise(vec2<f32>(gScreen.x * 90.0, gScreen.y * 25.0)) - 0.5) * 0.18 * grain * dens); }
  let bf = shows(BLADE_F, gScreenFp);
  if (bf > 0.0) { out = mix(out, blades(c, t, dens, under, false, vec2<f32>(0.0), 0.0).rgb, bf); }
  c = out;
  // A daisy now and then.
  let g = p * 32.0; let gi = vec2<i32>(floor(g));
  let r = hash(gi + vec2<i32>(91, 7));
  // (In spring, many more, and of every colour; none under the snow.)
  let bloom = ground.uSeason.x;
  if (r > 0.993 - 0.035 * bloom * vnoise(p * 0.5 + 13.0) && dens > 0.85 && ground.uSeason.w < 0.5) {
    let ctr = vec2<f32>(gi) + vec2<f32>(hash(gi + vec2<i32>(3, 1)), hash(gi + vec2<i32>(5, 9))) * 0.6 + 0.2;
    let d = length(g - ctr);
    let petal = 1.0 - smoothstep(0.11, 0.16, d);
    let eye = 1.0 - smoothstep(0.04, 0.07, d);
    let hue = hash(gi + vec2<i32>(41, 3));
    var flower = select(vec3<f32>(0.97, 0.96, 0.92), vec3<f32>(0.98, 0.85, 0.35), r > 0.998);
    if (r <= 0.993) { flower = select(select(vec3<f32>(0.62, 0.5, 0.86), vec3<f32>(0.95, 0.6, 0.72), hue > 0.5), vec3<f32>(0.98, 0.86, 0.3), hue > 0.8); }
    c = mix(c, mix(flower, vec3<f32>(0.95, 0.75, 0.2), eye), petal * shows(70.0, fp));
  }
  return c;
}
fn dirtAt(p: vec2<f32>, fp: f32) -> vec3<f32> {
  var c = vec3<f32>(186.0, 140.0, 93.0) / 255.0;
  c = c * (0.93 + 0.14 * vnoise(p * 0.8 + 11.0));
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
  c = c * (0.95 + 0.08 * vnoise(p * 0.6 + 23.0));
  // Ripples, wandering — as near as they show.
  let ripple = shows(9.0, fp);
  if (ripple > 0.0) { c = c * (1.0 + sin((p.x * 0.8 + p.y * 0.35 + fbm(p * 1.5) * 1.2) * 9.0) * 0.035 * ripple); }
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
  let t = 1.0 - abs(fbm(p * 6.0) * 2.0 - 1.0);
  c = c * (1.0 + (t - 0.6) * 0.12);
  let r = blades(c, t, 1.0, c, true, lo, z);
  return vec4<f32>(r.rgb, r.a * bf);
}

fn topColour(p: vec2<f32>, fp: f32) -> vec3<f32> {
  let cell = vec2<i32>(floor(p));
  let here = cellAt(cell);
  // PLAIN GROUND, the same stuff all round: no border within reach to look for. @see writeCell
  if (here.z > 127.5) {
    let kind = i32(here.x + 0.5);
    if (kind == 1) { return grassAt(p, fp, 1.0, vec3<f32>(0.0)); }
    if (kind == 2) { return dirtAt(p, fp); }
    if (kind == 3) { return sandAt(p, fp); }
  }
  // How strongly each material claims this point: its nearest cell at the
  // same height, near is strong, ragged by noise of its own.
  var claim = vec3<f32>(-9.0);
  // ON THE CONTINUOUS SURFACE a border is not a tile's edge: how much of each material lies round the point, the
  // nine cells weighed by a smooth bell about it, and the border where two are even — a stair of tiles a line
  // that wanders, a lone tile a round patch.
  let soft = ground.uMode.x > 0.5;
  let bf = p - floor(p);
  var bx = vec3<f32>(0.5 * (1.0 - bf.x) * (1.0 - bf.x), 0.75 - (bf.x - 0.5) * (bf.x - 0.5), 0.5 * bf.x * bf.x);
  var by = vec3<f32>(0.5 * (1.0 - bf.y) * (1.0 - bf.y), 0.75 - (bf.y - 0.5) * (bf.y - 0.5), 0.5 * bf.y * bf.y);
  var cover = vec3<f32>(0.0);
  for (var dy = -1; dy <= 1; dy++) {
    for (var dx = -1; dx <= 1; dx++) {
      let n = cell + vec2<i32>(dx, dy);
      let c = cellAt(n);
      let k = i32(c.x + 0.5);
      if (soft) {
        let w = bx[dx + 1] * by[dy + 1];
        if (k == 1) { cover.x = cover.x + w; }
        if (k == 2) { cover.y = cover.y + w; }
        if (k == 3) { cover.z = cover.z + w; }
        continue;
      }
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
  if (soft) {
    let all = max(cover.x + cover.y + cover.z, 0.0001);
    claim = select(vec3<f32>(-9.0), (cover / all * 2.0 - 1.0) * 1.2, cover > vec3<f32>(0.0));
  }
  // (Ragged only where two of them meet: a field of one thing has no border to be ragged, and most ground is that.)
  let met = step(-8.0, claim.x) + step(-8.0, claim.y) + step(-8.0, claim.z);
  if (met > 1.5) {
    claim = claim + vec3<f32>(
      (fbm(p * 3.1) - 0.5) * 0.7 + 0.05,
      (fbm(p * 2.7 + 31.0) - 0.5) * 0.7,
      (fbm(p * 1.9 + 77.0) - 0.5) * 0.6
    );
  }
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

// ROCK, where the ground is too steep for earth and under the soil of a wall. Laid out ACROSS THE SCREEN AND UP IT
// (tiles) and not along the ground, so a cliff's face is as finely drawn as the level ground at its foot; and
// nothing in it regular: beds that wander and differ in thickness and tone, shaded under each ledge and not ruled
// with a line; blocks of no two shapes, cracked apart only here and there; stains run down it; grain close up.
fn rockAt(p: vec2<f32>, z: f32, fp: f32) -> vec3<f32> {
  let q = vec2<f32>(p.x - p.y, (p.x + p.y) * 0.5 - z * 0.25);
  var c = mix(vec3<f32>(0.37, 0.355, 0.335), vec3<f32>(0.57, 0.535, 0.475), fbm(q * 0.55 + 13.0));
  // BEDS, by height, their lie warped across the face.
  let s = z * 0.36 + (fbm(vec2<f32>(q.x * 0.28, q.y * 0.7) + 5.0) - 0.5) * 2.6 + vnoise(q * 0.9 + 31.0) * 0.5;
  let bed = floor(s); let bf = s - bed;
  c = c * (0.87 + 0.24 * hash(vec2<i32>(i32(bed), 31)));
  c = c * mix(1.0, 0.8, smoothstep(0.7, 1.0, bf) * shows(3.0, fp));
  c = c * (1.0 + 0.07 * (1.0 - smoothstep(0.0, 0.18, bf)) * shows(3.0, fp));
  // BLOCKS: the nearest of a scatter of points and the next nearest; a crack where the two are as near, some places.
  let g = q * vec2<f32>(1.5, 2.3) + (vec2<f32>(vnoise(q * 1.1 + 7.0), vnoise(q * 1.1 + 19.0)) - 0.5) * 1.3 + vec2<f32>(hash(vec2<i32>(i32(bed), 5)) * 7.0, bed * 0.37);
  let gi = vec2<i32>(floor(g)); let gf = fract(g);
  var f1 = 9.0; var f2 = 9.0; var id = 0.5;
  let near = shows(5.0, fp);
  if (near > 0.0) {
  for (var dy = -1; dy <= 1; dy++) {
    for (var dx = -1; dx <= 1; dx++) {
      let cell = gi + vec2<i32>(dx, dy);
      let pt = vec2<f32>(f32(dx), f32(dy)) + vec2<f32>(hash(cell), hash(cell + vec2<i32>(17, 3))) - gf;
      let d = dot(pt, pt);
      if (d < f1) { f2 = f1; f1 = d; id = hash(cell + vec2<i32>(5, 9)); } else if (d < f2) { f2 = d; }
    }
  }
  c = c * mix(1.0, 0.92 + 0.16 * id, near);
  let cracks = shows(7.0, fp);
  if (cracks > 0.0) { c = c * mix(1.0, 0.7, (1.0 - smoothstep(0.0, 0.06, sqrt(f2) - sqrt(f1))) * smoothstep(0.42, 0.62, fbm(q * 0.8 + 47.0)) * cracks); }
  }
  // STAINS run down it.
  c = c * (1.0 - 0.1 * smoothstep(0.6, 0.92, vnoise(vec2<f32>(q.x * 2.3 + vnoise(q * 0.6 + 71.0) * 1.7, q.y * 0.4) + 3.0)) * smoothstep(0.35, 0.7, fbm(q * 0.35 + 83.0)));
  let fine = shows(31.0, fp);
  if (fine > 0.0) { c = c * (1.0 + (vnoise(q * 31.0) - 0.5) * 0.09 * fine); }
  return c;
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
  // (Under standing water there is no turf to hang over the edge: its bed's wall is bare.)
  let under = i32(textureLoad(uEdges, vec2<i32>(i32(floor((p - back).x)) * 2 + 1, i32(floor((p - back).y))), 0).w + 0.5) % 4 == 2;
  var col = earth;
  // ROCK below the soil: beds of it, each its own tone, a dark joint between, cracked down here and there.
  let soil = select(2.6, 3.4, k == 3) + (vnoise(vec2<f32>(along * 1.3, 9.0)) - 0.5) * 1.6;
  if (depth > soil - 0.3) {
    // (A wall's is the same rock, by how far down it: lighter on the face toward the light.)
    let rock = rockAt(p, -depth, fp) * select(0.74, 1.0, lit) * (1.0 - min(depth, 14.0) * 0.01);
    col = mix(earth, rock, smoothstep(soil - 0.3, soil + 0.15, depth + (vnoise(vec2<f32>(along * 14.0, depth * 3.0)) - 0.5) * 0.5));
  }
  if (k == 1 && depth < lipDepth && !under) {
    col = select(vec3<f32>(80.0, 112.0, 48.0), vec3<f32>(102.0, 140.0, 60.0), lit) / 255.0;
    col = col * mix(1.08, 0.8, depth / lipDepth);
    col = col * (1.0 + (vnoise(vec2<f32>(along * 70.0, depth * 1.2)) - 0.5) * 0.35 * shows(70.0, fp));
  } else if (k == 3 && depth < lipDepth) {
    col = select(vec3<f32>(160.0, 154.0, 115.0), vec3<f32>(194.0, 188.0, 142.0), lit) / 255.0;
  } else if (k == 1 && depth < lipDepth + 0.25 && !under) {
    col = earth * 0.72;
  }
  return col;
}

@fragment
fn mainFragment(@location(0) vGround: vec2<f32>, @location(1) vWall: vec2<f32>, @location(2) vTint: vec4<f32>, @location(3) vWorld: vec2<f32>, @location(4) vSteep: f32) -> @location(0) vec4<f32> {
  gScreen = vWorld * ground.uMap.z;
  let fs = fwidth(gScreen);
  gScreenFp = max(fs.x, fs.y) * 1.5;
  // (A wall's second word is how far down it; a top's is its height, which is no measure of a pixel.)
  let fw = fwidth(vGround) + vec2<f32>(fwidth(vWall.y) * select(0.0, 0.5, vWall.x > 0.5));
  let fp = max(fw.x, fw.y);
  // How steep a top is here, half steps a tile: worked out a corner at a time and carried across the face, so
  // what is laid by it does not turn at every triangle's edge.
  let steep = vSteep;
  // THE WATER'S CUT FACE at the map's edge: its second word is how far under the surface.
  if (vWall.x > 4.5) {
    let a = 0.62 + 0.2 * smoothstep(0.0, 3.0, vWall.y);
    let c = mix(vec3<f32>(0.33, 0.53, 0.68), vec3<f32>(0.19, 0.37, 0.54), smoothstep(0.0, 5.0, vWall.y));
    return vec4<f32>(c * a, a) * vTint;
  }
  if (vWall.x > 2.5) {
    let f = fringeColour(vGround, vWall.y) * (1.0 - smoothstep(0.3, 0.7, ground.uSeason.w));
    if (f.a <= 0.003) { discard; }
    return vec4<f32>(f.rgb * f.a, f.a) * vTint;
  }
  var col: vec3<f32>;
  // A top's second word is the light on its slope, 0 on the level.
  if (vWall.x < 0.5) {
    col = topColour(vGround, fp);
    // A STEEP BANK IS BARE: the grass gives out to earth as the ground steepens, in patches.
    if (steep > 1.2) {
      let bare = smoothstep(1.7, 3.4, steep + (fbm(vGround * 2.2 + 3.0) - 0.5) * 2.2);
      if (bare > 0.0) { col = mix(col, dirtAt(vGround, fp) * 0.88, bare * 0.85); }
    }
    // A FACE TOO STEEP FOR EARTH IS ROCK — bedded by its height, so the beds run level across a cliff — coming
    // through the bare earth as the ground steepens. (The continuous surface has no walls: this is its cliff.)
    if (steep > 3.2) {
      col = mix(col, rockAt(vGround, vWall.y, fp), smoothstep(3.6, 6.0, steep + (fbm(vGround * 3.1 + 11.0) - 0.5) * 1.6));
    }
    // UNDER A WOOD, the forest floor, as thick as the canopy over it, ragged at its rim. @see forest.ts
    if (ground.uMode.x > 0.5) {
      let can = canopyAt(vGround);
      if (can > 0.02) { col = mix(col, forestFloor(vGround, fp), smoothstep(0.2, 0.68, can + (fbm(vGround * 1.9 + 21.0) - 0.5) * 0.4) * 0.88); }
    }
    // THE BEACH: by standing water, ground within a little of its level is sand, and wet where the water has it.
    var level = textureLoad(uEdges, vec2<i32>(i32(floor(vGround.x)) * 2 + 1, i32(floor(vGround.y))), 0).z;
    if (level > -900.0) {
      // (Blended between the cells round the point — one that was told none taken as a little lower than this one —
      // so the sand's line does not step at a cell's edge.)
      let lq = vGround - 0.5; let lc = vec2<i32>(floor(lq)); let lf = lq - floor(lq);
      let l00 = levelAt(lc, level); let l10 = levelAt(lc + vec2<i32>(1, 0), level);
      let l01 = levelAt(lc + vec2<i32>(0, 1), level); let l11 = levelAt(lc + vec2<i32>(1, 1), level);
      level = mix(mix(l00, l10, lf.x), mix(l01, l11, lf.x), lf.y);
      let over = vWall.y - level + (fbm(vGround * 2.3 + 9.0) - 0.5) * 0.5;
      // NOT EVERY SHORE IS A BEACH: by a slow noise over the map a stretch of shore is sand, broad; or a narrow rim
      // of wet earth; or grass down to the water with earth only under it.
      let shore = fbm(vGround * 0.11 + 40.0);
      let sandy = smoothstep(0.44, 0.56, shore);
      let rim = mix(mix(0.02, 0.22, smoothstep(0.26, 0.38, shore)), 0.6, sandy);
      let beach = 1.0 - smoothstep(mix(-0.08, 0.15, sandy), rim, over);
      if (beach > 0.0) {
        var stuff = vec3<f32>(0.0);
        if (sandy > 0.001) { stuff = sandAt(vGround, fp) * sandy; }
        if (sandy < 0.999) { stuff = stuff + dirtAt(vGround, fp) * 0.8 * (1.0 - sandy); }
        col = mix(col, stuff * mix(0.7, 1.0, smoothstep(-0.02, 0.16, over)), beach);
      }
    }
    // SNOW where it lies: patchy as it comes and as it goes, more the higher, none on a slope too steep to hold it.
    // (None on a bed under standing water: it would show through.)
    let wetHere = i32(textureLoad(uEdges, vec2<i32>(i32(floor(vGround.x)) * 2 + 1, i32(floor(vGround.y))), 0).w + 0.5) % 4 == 2;
    if (ground.uSeason.w > 0.0 && !wetHere) {
      let lie = ground.uSeason.w * 1.3 - 0.3 + (fbm(vGround * 1.3 + 5.0) - 0.5) * 0.7 + vWall.y * 0.008;
      let cover = smoothstep(0.0, 0.12, lie) * (1.0 - smoothstep(2.2, 4.8, steep));
      if (cover > 0.0) { col = mix(col, snowAt(vGround, fp), cover); }
    }
    col = relit(col * (1.0 + vWall.x), vGround, vWall.y, ground.uMode.x < 0.5);
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
in float aSteep;
out float vSteep;
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
  vSteep = aSteep;
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
in float vSteep;
out vec4 finalColor;
uniform vec4 uMap;
uniform vec4 uMode;
uniform vec4 uSeason;
uniform sampler2D uCells;
uniform highp sampler2D uEdges;
uniform sampler2D uShade;
uniform sampler2D uTint;

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
float riseOf(vec4 c) { return floor((c.z - 128.0 * step(127.5, c.z) + 0.5) / 16.0); }

const vec2 SUN = vec2(-0.94, 0.34);
const float SHADOW_RUN = 0.55;
float topOf(vec4 c) { return c.y - 128.0 + riseOf(c) * 0.5; }
vec4 edgesAt(ivec2 c) { return texelFetch(uEdges, ivec2(c.x * 2, c.y), 0); }
float levelAt(ivec2 c, float own) {
  ivec2 n = ivec2(int(uMap.x), int(uMap.y));
  float v = texelFetch(uEdges, ivec2(clamp(c.x, 0, n.x - 1) * 2 + 1, clamp(c.y, 0, n.y - 1)), 0).z;
  return v > -900.0 ? v : own - 0.35;
}
float shadeAt(ivec2 c, ivec2 n) { return texelFetch(uShade, clamp(c, ivec2(0), n - ivec2(1)), 0).r; }
float shadowAt(vec2 p, float h) {
  ivec2 n = ivec2(int(uMap.x), int(uMap.y)) * ${SHADE};
  vec2 q = p * ${SHADE}.0 - 0.5;
  ivec2 c = ivec2(floor(q)); vec2 f = q - floor(q);
  return mix(mix(shadeAt(c, n), shadeAt(c + ivec2(1, 0), n), f.x), mix(shadeAt(c + ivec2(0, 1), n), shadeAt(c + ivec2(1, 1), n), f.x), f.y);
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
  vec3 c = mix(col, col * vec3(0.60, 0.64, 0.74), shadowAt(p, h) * mix(0.72, 0.5, uMode.x));
  if (foot) c *= 1.0 - 0.34 * contactAt(p, h);
  return c;
}
vec3 tintAt(ivec2 c, ivec2 n) { return texelFetch(uTint, clamp(c, ivec2(0), n - ivec2(1)), 0).rgb; }
vec3 seasonGrass(vec3 c, vec2 p) {
  vec4 s = uSeason;
  if (s.x + s.y + s.z <= 0.0) return c;
  float patchy = fbm(p * 0.3 + 91.0);
  vec3 g = mix(c, c * vec3(1.02, 1.05, 0.95) + vec3(0.005, 0.012, 0.0), s.x * 0.5);
  g = mix(g, vec3(0.71, 0.67, 0.39) * (0.86 + 0.28 * patchy), s.y * smoothstep(0.38, 0.78, patchy) * 0.65);
  g = mix(g, vec3(0.5, 0.48, 0.31) * (0.9 + 0.2 * patchy), s.z * (0.35 + 0.35 * patchy));
  return g;
}
vec3 snowAt(vec2 p, float fp) {
  vec3 c = vec3(0.9, 0.93, 0.97) * (0.95 + 0.07 * vnoise(p * 2.3 + 3.0));
  c *= 1.0 + (vnoise(p * 14.0) - 0.5) * 0.05 * shows(14.0, fp);
  float gl = hash(ivec2(floor(p * 70.0)));
  return mix(c, vec3(1.0), step(0.985, gl) * 0.6 * shows(70.0, fp));
}
float canopyCell(ivec2 c) {
  ivec2 n = ivec2(int(uMap.x), int(uMap.y));
  if (c.x < 0 || c.y < 0 || c.x >= n.x || c.y >= n.y) return 0.0;
  return floor((texelFetch(uEdges, ivec2(c.x * 2 + 1, c.y), 0).w + 0.5) / 32.0) / 7.0;
}
float canopyAt(vec2 p) {
  vec2 q = p - 0.5; ivec2 c = ivec2(floor(q)); vec2 f = q - floor(q);
  return mix(mix(canopyCell(c), canopyCell(c + ivec2(1, 0)), f.x), mix(canopyCell(c + ivec2(0, 1)), canopyCell(c + ivec2(1, 1)), f.x), f.y);
}
vec3 forestFloor(vec2 p, float fp) {
  vec3 c = mix(vec3(0.27, 0.33, 0.17), vec3(0.4, 0.33, 0.21), smoothstep(0.35, 0.7, fbm(p * 1.4 + 17.0)));
  c = mix(c, vec3(0.24, 0.38, 0.17), smoothstep(0.62, 0.8, vnoise(p * 3.1 + 5.0)) * 0.7);
  c = mix(c, vec3(0.56, 0.36, 0.16), uSeason.z * smoothstep(0.35, 0.75, vnoise(p * 5.0 + 29.0)) * 0.6);
  return c * (1.0 + (vnoise(p * 16.0) - 0.5) * 0.16 * shows(16.0, fp));
}
vec3 grassBase(vec2 p) {
  ivec2 n = ivec2(int(uMap.x), int(uMap.y)) * ${SHADE};
  vec2 q = p * ${SHADE}.0 - 0.5;
  ivec2 c = ivec2(floor(q)); vec2 f = q - floor(q);
  return seasonGrass(mix(mix(tintAt(c, n), tintAt(c + ivec2(1, 0), n), f.x), mix(tintAt(c + ivec2(0, 1), n), tintAt(c + ivec2(1, 1), n), f.x), f.y), p);
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
  float t = 0.6;
  float tufts = shows(9.0, fp);
  if (tufts > 0.0 || shows(BLADE_F, gScreenFp) > 0.0) t = 1.0 - abs(fbm(p * 6.0) * 2.0 - 1.0);
  c *= 1.0 + (t - 0.6) * 0.12 * tufts;
  vec3 out_ = c;
  if (dens < 0.999) {
    float speck = vnoise(p * 18.0 + 7.0);
    out_ = mix(under, c, smoothstep(0.35, 0.7, dens + (speck - 0.5) * 0.7 * shows(18.0, fp)));
  }
  float grain = shows(30.0, gScreenFp);
  if (grain > 0.0) out_ *= 1.0 + (vnoise(vec2(gScreen.x * 90.0, gScreen.y * 25.0)) - 0.5) * 0.18 * grain * dens;
  float bf = shows(BLADE_F, gScreenFp);
  if (bf > 0.0) out_ = mix(out_, blades(c, t, dens, under, false, vec2(0.0), 0.0).rgb, bf);
  c = out_;
  vec2 g = p * 32.0; ivec2 gi = ivec2(floor(g));
  float r = hash(gi + ivec2(91, 7));
  float bloom = uSeason.x;
  if (r > 0.993 - 0.035 * bloom * vnoise(p * 0.5 + 13.0) && dens > 0.85 && uSeason.w < 0.5) {
    vec2 ctr = vec2(gi) + vec2(hash(gi + ivec2(3, 1)), hash(gi + ivec2(5, 9))) * 0.6 + 0.2;
    float d = length(g - ctr);
    float petal = 1.0 - smoothstep(0.11, 0.16, d);
    float eye = 1.0 - smoothstep(0.04, 0.07, d);
    float hue = hash(gi + ivec2(41, 3));
    vec3 flower = r > 0.998 ? vec3(0.98, 0.85, 0.35) : vec3(0.97, 0.96, 0.92);
    if (r <= 0.993) flower = hue > 0.8 ? vec3(0.98, 0.86, 0.3) : hue > 0.5 ? vec3(0.95, 0.6, 0.72) : vec3(0.62, 0.5, 0.86);
    c = mix(c, mix(flower, vec3(0.95, 0.75, 0.2), eye), petal * shows(70.0, fp));
  }
  return c;
}
vec3 dirtAt(vec2 p, float fp) {
  vec3 c = vec3(186.0, 140.0, 93.0) / 255.0;
  c *= 0.93 + 0.14 * vnoise(p * 0.8 + 11.0);
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
  c *= 0.95 + 0.08 * vnoise(p * 0.6 + 23.0);
  float ripple = shows(9.0, fp);
  if (ripple > 0.0) c *= 1.0 + sin((p.x * 0.8 + p.y * 0.35 + fbm(p * 1.5) * 1.2) * 9.0) * 0.035 * ripple;
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
  float t = 1.0 - abs(fbm(p * 6.0) * 2.0 - 1.0);
  c *= 1.0 + (t - 0.6) * 0.12;
  vec4 r = blades(c, t, 1.0, c, true, lo, z);
  return vec4(r.rgb, r.a * bf);
}

vec3 topColour(vec2 p, float fp) {
  ivec2 cell = ivec2(floor(p));
  vec4 here = cellAt(cell);
  if (here.z > 127.5) {
    int kind = int(here.x + 0.5);
    if (kind == 1) return grassAt(p, fp, 1.0, vec3(0.0));
    if (kind == 2) return dirtAt(p, fp);
    if (kind == 3) return sandAt(p, fp);
  }
  vec3 claim = vec3(-9.0);
  bool soft = uMode.x > 0.5;
  vec2 bf = p - floor(p);
  vec3 bx = vec3(0.5 * (1.0 - bf.x) * (1.0 - bf.x), 0.75 - (bf.x - 0.5) * (bf.x - 0.5), 0.5 * bf.x * bf.x);
  vec3 by = vec3(0.5 * (1.0 - bf.y) * (1.0 - bf.y), 0.75 - (bf.y - 0.5) * (bf.y - 0.5), 0.5 * bf.y * bf.y);
  vec3 cover = vec3(0.0);
  for (int dy = -1; dy <= 1; dy++) {
    for (int dx = -1; dx <= 1; dx++) {
      ivec2 n = cell + ivec2(dx, dy);
      vec4 c = cellAt(n);
      int k = int(c.x + 0.5);
      if (soft) {
        float w = bx[dx + 1] * by[dy + 1];
        if (k == 1) cover.x += w;
        if (k == 2) cover.y += w;
        if (k == 3) cover.z += w;
        continue;
      }
      if (k < 1 || k > 3 || c.y > here.y + riseOf(here) + 3.5 || c.y + riseOf(c) < here.y - 3.5) continue;
      vec2 lo = vec2(n);
      float d = length(p - clamp(p, lo, lo + 1.0));
      float s = 1.0 - d / 0.42;
      if (k == 1) claim.x = max(claim.x, s);
      if (k == 2) claim.y = max(claim.y, s);
      if (k == 3) claim.z = max(claim.z, s);
    }
  }
  if (soft) {
    vec3 share = (cover / max(cover.x + cover.y + cover.z, 0.0001) * 2.0 - 1.0) * 1.2;
    claim = vec3(cover.x > 0.0 ? share.x : -9.0, cover.y > 0.0 ? share.y : -9.0, cover.z > 0.0 ? share.z : -9.0);
  }
  float met = step(-8.0, claim.x) + step(-8.0, claim.y) + step(-8.0, claim.z);
  if (met > 1.5) {
    claim += vec3(
      (fbm(p * 3.1) - 0.5) * 0.7 + 0.05,
      (fbm(p * 2.7 + 31.0) - 0.5) * 0.7,
      (fbm(p * 1.9 + 77.0) - 0.5) * 0.6
    );
  }
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

vec3 rockAt(vec2 p, float z, float fp) {
  vec2 q = vec2(p.x - p.y, (p.x + p.y) * 0.5 - z * 0.25);
  vec3 c = mix(vec3(0.37, 0.355, 0.335), vec3(0.57, 0.535, 0.475), fbm(q * 0.55 + 13.0));
  float s = z * 0.36 + (fbm(vec2(q.x * 0.28, q.y * 0.7) + 5.0) - 0.5) * 2.6 + vnoise(q * 0.9 + 31.0) * 0.5;
  float bed = floor(s); float bf = s - bed;
  c *= 0.87 + 0.24 * hash(ivec2(int(bed), 31));
  c *= mix(1.0, 0.8, smoothstep(0.7, 1.0, bf) * shows(3.0, fp));
  c *= 1.0 + 0.07 * (1.0 - smoothstep(0.0, 0.18, bf)) * shows(3.0, fp);
  vec2 g = q * vec2(1.5, 2.3) + (vec2(vnoise(q * 1.1 + 7.0), vnoise(q * 1.1 + 19.0)) - 0.5) * 1.3 + vec2(hash(ivec2(int(bed), 5)) * 7.0, bed * 0.37);
  ivec2 gi = ivec2(floor(g)); vec2 gf = fract(g);
  float f1 = 9.0; float f2 = 9.0; float id = 0.5;
  float near = shows(5.0, fp);
  if (near > 0.0) {
  for (int dy = -1; dy <= 1; dy++) {
    for (int dx = -1; dx <= 1; dx++) {
      ivec2 cell = gi + ivec2(dx, dy);
      vec2 pt = vec2(float(dx), float(dy)) + vec2(hash(cell), hash(cell + ivec2(17, 3))) - gf;
      float d = dot(pt, pt);
      if (d < f1) { f2 = f1; f1 = d; id = hash(cell + ivec2(5, 9)); } else if (d < f2) { f2 = d; }
    }
  }
  c *= mix(1.0, 0.92 + 0.16 * id, near);
  float cracks = shows(7.0, fp);
  if (cracks > 0.0) c *= mix(1.0, 0.7, (1.0 - smoothstep(0.0, 0.06, sqrt(f2) - sqrt(f1))) * smoothstep(0.42, 0.62, fbm(q * 0.8 + 47.0)) * cracks);
  }
  c *= 1.0 - 0.1 * smoothstep(0.6, 0.92, vnoise(vec2(q.x * 2.3 + vnoise(q * 0.6 + 71.0) * 1.7, q.y * 0.4) + 3.0)) * smoothstep(0.35, 0.7, fbm(q * 0.35 + 83.0));
  float fine = shows(31.0, fp);
  if (fine > 0.0) c *= 1.0 + (vnoise(q * 31.0) - 0.5) * 0.09 * fine;
  return c;
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
  ivec2 uc = ivec2(floor(p - back));
  bool under = (int(texelFetch(uEdges, ivec2(uc.x * 2 + 1, uc.y), 0).w + 0.5) & 3) == 2;
  vec3 col = earth;
  float soil = (k == 3 ? 3.4 : 2.6) + (vnoise(vec2(along * 1.3, 9.0)) - 0.5) * 1.6;
  if (depth > soil - 0.3) {
    vec3 rock = rockAt(p, -depth, fp) * (lit ? 1.0 : 0.74) * (1.0 - min(depth, 14.0) * 0.01);
    col = mix(earth, rock, smoothstep(soil - 0.3, soil + 0.15, depth + (vnoise(vec2(along * 14.0, depth * 3.0)) - 0.5) * 0.5));
  }
  if (k == 1 && depth < lipDepth && !under) {
    col = (lit ? vec3(102.0, 140.0, 60.0) : vec3(80.0, 112.0, 48.0)) / 255.0;
    col *= mix(1.08, 0.8, depth / lipDepth);
    col *= 1.0 + (vnoise(vec2(along * 70.0, depth * 1.2)) - 0.5) * 0.35 * shows(70.0, fp);
  } else if (k == 3 && depth < lipDepth) {
    col = (lit ? vec3(194.0, 188.0, 142.0) : vec3(160.0, 154.0, 115.0)) / 255.0;
  } else if (k == 1 && depth < lipDepth + 0.25 && !under) {
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
  float steep = vSteep;
  if (vWall.x > 4.5) {
    float a = 0.62 + 0.2 * smoothstep(0.0, 3.0, vWall.y);
    vec3 c = mix(vec3(0.33, 0.53, 0.68), vec3(0.19, 0.37, 0.54), smoothstep(0.0, 5.0, vWall.y));
    finalColor = vec4(c * a, a) * vTint;
    return;
  }
  if (vWall.x > 2.5) {
    vec4 f = fringeColour(vGround, vWall.y) * (1.0 - smoothstep(0.3, 0.7, uSeason.w));
    if (f.a <= 0.003) discard;
    finalColor = vec4(f.rgb * f.a, f.a) * vTint;
    return;
  }
  vec3 col;
  if (vWall.x < 0.5) {
    col = topColour(vGround, fp);
    if (steep > 1.2) {
      float bare = smoothstep(1.7, 3.4, steep + (fbm(vGround * 2.2 + 3.0) - 0.5) * 2.2);
      if (bare > 0.0) col = mix(col, dirtAt(vGround, fp) * 0.88, bare * 0.85);
    }
    if (steep > 3.2) {
      col = mix(col, rockAt(vGround, vWall.y, fp), smoothstep(3.6, 6.0, steep + (fbm(vGround * 3.1 + 11.0) - 0.5) * 1.6));
    }
    if (uMode.x > 0.5) {
      float can = canopyAt(vGround);
      if (can > 0.02) col = mix(col, forestFloor(vGround, fp), smoothstep(0.2, 0.68, can + (fbm(vGround * 1.9 + 21.0) - 0.5) * 0.4) * 0.88);
    }
    float level = texelFetch(uEdges, ivec2(int(floor(vGround.x)) * 2 + 1, int(floor(vGround.y))), 0).z;
    if (level > -900.0) {
      vec2 lq = vGround - 0.5; ivec2 lc = ivec2(floor(lq)); vec2 lf = lq - floor(lq);
      level = mix(mix(levelAt(lc, level), levelAt(lc + ivec2(1, 0), level), lf.x), mix(levelAt(lc + ivec2(0, 1), level), levelAt(lc + ivec2(1, 1), level), lf.x), lf.y);
      float over = vWall.y - level + (fbm(vGround * 2.3 + 9.0) - 0.5) * 0.5;
      float shore = fbm(vGround * 0.11 + 40.0);
      float sandy = smoothstep(0.44, 0.56, shore);
      float rim = mix(mix(0.02, 0.22, smoothstep(0.26, 0.38, shore)), 0.6, sandy);
      float beach = 1.0 - smoothstep(mix(-0.08, 0.15, sandy), rim, over);
      if (beach > 0.0) {
        vec3 stuff = vec3(0.0);
        if (sandy > 0.001) stuff = sandAt(vGround, fp) * sandy;
        if (sandy < 0.999) stuff += dirtAt(vGround, fp) * 0.8 * (1.0 - sandy);
        col = mix(col, stuff * mix(0.7, 1.0, smoothstep(-0.02, 0.16, over)), beach);
      }
    }
    bool wetHere = int(texelFetch(uEdges, ivec2(int(floor(vGround.x)) * 2 + 1, int(floor(vGround.y))), 0).w + 0.5) % 4 == 2;
    if (uSeason.w > 0.0 && !wetHere) {
      float lie = uSeason.w * 1.3 - 0.3 + (fbm(vGround * 1.3 + 5.0) - 0.5) * 0.7 + vWall.y * 0.008;
      float cover = smoothstep(0.0, 0.12, lie) * (1.0 - smoothstep(2.2, 4.8, steep));
      if (cover > 0.0) col = mix(col, snowAt(vGround, fp), cover);
    }
    col = relit(col * (1.0 + vWall.x), vGround, vWall.y, uMode.x < 0.5);
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
