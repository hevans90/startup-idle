/**
 * WOODS AS WOODS, on the continuous surface: not one, two or three trees stood on set spots in every wooded tile,
 * but trees scattered from a smooth DENSITY over the map — thick in a wood's heart with crowns overlapping, thinning
 * raggedly toward its edge and spilling a little past it onto the grass, opened here and there by a clearing; in
 * STANDS by the BIOME — pines on the heights, willow and poplar by the water, oak and lime in the valleys, mixed
 * between; of every size, saplings where a wood is young. And what is not a wood: shrubs in the scrub a wood comes
 * back through, reeds at the shore, heather on the heath. All read from the vegetation fields (@see
 * vegetation/fields). Pure: the same fields, the same trees. @see tree-mesh, ground-mesh canopy
 */
import { inBounds, type Grid } from "../grid";
import { COVER, MATURE, covered, growable, heathOf, heightShare, vegAt, waterNear } from "../vegetation/fields";
import { ageStep } from "../vegetation/step";

/** One tree: what it is, where its foot is (tiles), which way round, how big. */
export type ForestTree = { kind: string; u: number; v: number; turn: number; size: number; seed: number };

type Palette = readonly (string | null)[];

/** Lattice points a side of a tile, each a tree or not: at the densest, about two in three are. */
const LATTICE = 3;
/** The most of the lattice that is trees, in a wood's heart. */
const FULL = 0.68;

const hash = (x: number, y: number, salt: number) =>
  ((Math.imul(Math.imul(x, 0x27d4eb2d) ^ Math.imul(y, 0x165667b1) ^ salt, 0x85ebca6b) >>> 8) & 0xffff) / 0x10000;
function noise(x: number, y: number, salt: number) {
  const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  const a = hash(ix, iy, salt), b = hash(ix + 1, iy, salt), c = hash(ix, iy + 1, salt), d = hash(ix + 1, iy + 1, salt);
  return (a + (b - a) * sx) * (1 - sy) + (c + (d - c) * sx) * sy;
}

/** Whether a tree may stand in a cell at all: ground things grow on, nothing built on it, no water on it. */
function standable(g: Grid, palette: Palette, x: number, y: number): boolean {
  if (!inBounds(g, x, y)) return false;
  const i = vegAt(g, palette, x, y);
  // (Under water now, only reeds.)
  return growable(g, palette, i) && !covered(g, x, y) && (!g.veg.wet[i] || g.veg.cover[i] === COVER.reeds);
}
/** A cell's own canopy, 0–1: a wood by how many trees, scrub a little; none where none may stand. */
export function woodOf(g: Grid, palette: Palette, x: number, y: number): number {
  if (!standable(g, palette, x, y)) return 0;
  const i = vegAt(g, palette, x, y), V = g.veg;
  // (Scrub's own shrubs are clumps of their own, below; it shades the ground a little.)
  if (V.cover[i] === COVER.scrub) return 0.15;
  const n = V.cover[i] === COVER.wood ? V.density[i] : 0;
  // (Any wood is a wood: its one, two or three trees only say how thick, from half on.)
  return n ? 0.55 + 0.225 * (n - 1) : 0;
}
/** THE CANOPY of a cell, 0–1: its wood and its neighbours', weighed 1-2-1, so a wood's heart is thick and its rim thin. */
export function canopyOf(g: Grid, palette: Palette, x: number, y: number): number {
  let s = 0, w = 0;
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    const k = (dx ? 1 : 2) * (dy ? 1 : 2);
    s += woodOf(g, palette, x + dx, y + dy) * k; w += k;
  }
  return s / w;
}

type Mix = readonly [string, number][];
/** THE BIOMES, each with its own share of every kind. */
const BIOME: Readonly<Record<"shore" | "bank" | "high" | "valley" | "mixed", Mix>> = {
  shore: [["willow", 4], ["poplar", 2], ["birch", 2]],
  bank: [["willow", 2], ["poplar", 2], ["birch", 2], ["oak", 2], ["lime", 1]],
  high: [["pine", 7], ["birch", 3]],
  valley: [["oak", 4], ["lime", 3], ["hornbeam", 2], ["apple", 1], ["cherry", 1]],
  mixed: [["pine", 3], ["oak", 2], ["birch", 2], ["lime", 1], ["hornbeam", 1]],
};
/** Scrub: shrubs, and the first trees of the wood to come. */
const SCRUB: Mix = [["shrub", 7], ["birch", 2], ["apple", 1]];
const pick = (list: Mix, r: number) => {
  const all = list.reduce((s, [, n]) => s + n, 0);
  let t = r * all;
  for (const [k, n] of list) { if ((t -= n) < 0) return k; }
  return list[list.length - 1][0];
};
/** A cell's biome: by the water, by how high, the line between them blurred by a slow noise so stands mingle. */
function biomeOf(g: Grid, x: number, y: number, i: number): Mix {
  const wet = waterNear(g, x, y, 2);
  if (wet <= 1) return BIOME.shore;
  if (wet === 2) return BIOME.bank;
  const h = heightShare(g, i) + (noise(x * 0.16 + 7, y * 0.16 + 3, 0x66) - 0.5) * 0.35;
  return h > 0.74 ? BIOME.high : h < 0.36 ? BIOME.valley : BIOME.mixed;
}
/** How big a cell's trees are by how grown: a sapling a third of a mature tree. In eighths, as the fields change. */
const grownBy = (age: number) => 0.35 + 0.65 * Math.min(1, (ageStep(age) + 1) / (ageStep(MATURE) + 1));

/**
 * THE TREES WHOSE FOOT IS IN CELL (x, y), back to front. Read from the density at each lattice point of the cell:
 * the canopy of the cells round it blended to the point, opened by a slow noise into clearings and glades.
 * `canopy` is `canopyOf`, passed in so a caller can keep it. Then reeds or heather, where the cell is those.
 */
export function forestTrees(g: Grid, palette: Palette, x: number, y: number, canopy = (cx: number, cy: number) => canopyOf(g, palette, cx, cy)): ForestTree[] {
  if (!standable(g, palette, x, y)) return [];
  const out: ForestTree[] = [];
  const i = vegAt(g, palette, x, y), V = g.veg, cover = V.cover[i];
  // (Nothing near any wood: no trees, and no lattice walked for them.)
  let near = 0;
  for (let dy = -1; dy <= 1 && !near; dy++) for (let dx = -1; dx <= 1; dx++) if (woodOf(g, palette, x + dx, y + dy) > 0) { near = 1; break; }
  if (near) {
    const mix = biomeOf(g, x, y, i), grown = cover === COVER.wood ? grownBy(V.age[i]) : 1;
    for (let j = 0; j < LATTICE; j++) for (let k = 0; k < LATTICE; k++) {
      const lx = x * LATTICE + k, ly = y * LATTICE + j;
      // Jittered from the lattice: no rows.
      const u = (lx + 0.5 + (hash(lx, ly, 0x11) - 0.5) * 0.85) / LATTICE, v = (ly + 0.5 + (hash(lx, ly, 0x22) - 0.5) * 0.85) / LATTICE;
      // The canopy blended between the middles of the four cells round the point.
      const qx = u - 0.5, qy = v - 0.5, cx = Math.floor(qx), cy = Math.floor(qy), fx = qx - cx, fy = qy - cy;
      const c = (canopy(cx, cy) * (1 - fx) + canopy(cx + 1, cy) * fx) * (1 - fy) + (canopy(cx, cy + 1) * (1 - fx) + canopy(cx + 1, cy + 1) * fx) * fy;
      if (c <= 0) continue;
      // Ragged at the rim and open in glades: a slow noise and a slower one.
      const d = c + (noise(u * 0.55, v * 0.55, 0x33) - 0.5) * 0.5 + (noise(u * 0.17, v * 0.17, 0x44) - 0.5) * 0.35;
      const keep = Math.max(0, Math.min(1, (d - 0.2) / 0.45));
      if (hash(lx, ly, 0x55) >= keep * keep * (3 - 2 * keep) * FULL) continue;
      const kind = pick(mix, hash(lx, ly, 0x77));
      // Biggest in the heart; smaller toward the rim; a sapling now and then; all as grown as the cell.
      const sapling = hash(lx, ly, 0x88) < 0.08;
      const size = (sapling ? 0.45 + 0.15 * hash(lx, ly, 0x99) : 0.68 + 0.32 * hash(lx, ly, 0x99) + 0.18 * Math.min(1, c)) * grown;
      out.push({ kind, u: u - 0.5, v: v - 0.5, turn: Math.floor(hash(lx, ly, 0xaa) * 4), size, seed: hash(lx, ly, 0xbb) });
    }
  }
  // SCRUB, REEDS at the shore and HEATHER on the heath: clumps of their own, not under the canopy.
  const heath = cover === COVER.meadow && heightShare(g, i) > 0.55, scrub = cover === COVER.scrub;
  if (cover === COVER.reeds || heath || scrub) {
    // (Heather as thick as its patch: cushions run together in its heart, none at its edge.)
    const n = heath ? Math.round(heathOf(x, y) * 9 * (0.8 + 0.4 * hash(x, y, 0xc1))) : (scrub ? 2 : 6) + Math.floor(hash(x, y, 0xc1) * 3);
    // (Scrub grows up with the cell: its first trees among the shrubs.)
    const grown = scrub ? grownBy(V.age[i]) : 1;
    for (let k = 0; k < n; k++) {
      const u = x + (hash(x * 7 + k, y, 0xc2) - 0.5) * 0.9, v = y + (hash(x, y * 7 + k, 0xc3) - 0.5) * 0.9;
      const kind = scrub ? pick(SCRUB, hash(x + k, y, 0xc7)) : heath ? "heather" : "reeds";
      const size = (heath ? 1.1 + 0.6 * hash(x, y + k, 0xc5) : cover === COVER.reeds ? 1 + 0.5 * hash(x, y + k, 0xc5) : 0.75 + 0.5 * hash(x, y + k, 0xc5)) * (kind === "shrub" || !scrub ? 1 : 0.5 * grown);
      out.push({ kind, u, v, turn: Math.floor(hash(x + k, y, 0xc4) * 4), size, seed: hash(x + k, y + k, 0xc6) });
    }
  }
  return out.sort((a, b) => a.u + a.v - (b.u + b.v));
}
