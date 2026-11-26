/**
 * WOODS AS WOODS, on the continuous surface: not one, two or three trees stood on set spots in every wooded tile,
 * but trees scattered from a smooth DENSITY over the map — thick in a wood's heart with crowns overlapping, thinning
 * raggedly toward its edge and spilling a little past it onto the grass, opened here and there by a clearing; in
 * STANDS by the BIOME — pines on the heights, willow and poplar by the water, oak and lime in the valleys, mixed
 * between; of every size, saplings where a wood is young. And what is not a wood: shrubs in the scrub a wood comes
 * back through, reeds at the shore. All read from the vegetation fields (@see
 * vegetation/fields). Pure: the same fields, the same trees. @see tree-mesh, ground-mesh canopy
 */
import { inBounds, type Grid } from "../grid";
import { COVER, MATURE, covered, growable, heathOf, heightShare, vegAt, waterNear } from "../vegetation/fields";
import { ageStep } from "../vegetation/step";

/** One tree: what it is, where its foot is (tiles), which way round, how big. */
/** `char`: burnt, a snag (@see vegetation/wildfire). */
export type ForestTree = { kind: string; u: number; v: number; turn: number; size: number; seed: number; char?: number };

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
 * `canopy` is `canopyOf`, passed in so a caller can keep it. Then scrub or reeds, where the cell is those.
 */
export function forestTrees(g: Grid, palette: Palette, x: number, y: number, canopy = (cx: number, cy: number) => canopyOf(g, palette, cx, cy)): ForestTree[] {
  if (!standable(g, palette, x, y)) return [];
  const out: ForestTree[] = [];
  const i = vegAt(g, palette, x, y), V = g.veg, cover = V.cover[i];
  // (Nothing near any wood: no trees, and no lattice walked for them.)
  let near = 0;
  for (let dy = -1; dy <= 1 && !near; dy++) for (let dx = -1; dx <= 1; dx++) if (woodOf(g, palette, x + dx, y + dy) > 0) { near = 1; break; }
  // (A wood spills onto open ground round it; not onto what was cleared, planted or farmed.)
  const wild = cover === COVER.wood || cover === COVER.scrub || cover === COVER.grass || cover === COVER.meadow || cover === COVER.burnt;
  if (near && wild) {
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
  // SCRUB and REEDS at the shore: clumps of their own, not under the canopy. (Heather is the ground's own carpet,
  // drawn by the ground: @see heathAt, render/ground-mesh heatherAt.)
  const scrub = cover === COVER.scrub;
  if (cover === COVER.reeds || scrub) {
    const n = (scrub ? 2 : 6) + Math.floor(hash(x, y, 0xc1) * 3);
    // (Scrub grows up with the cell: its first trees among the shrubs.)
    const grown = scrub ? grownBy(V.age[i]) : 1;
    for (let k = 0; k < n; k++) {
      const u = x + (hash(x * 7 + k, y, 0xc2) - 0.5) * 0.9, v = y + (hash(x, y * 7 + k, 0xc3) - 0.5) * 0.9;
      const kind = scrub ? pick(SCRUB, hash(x + k, y, 0xc7)) : "reeds";
      const size = (scrub ? 0.75 + 0.5 * hash(x, y + k, 0xc5) : 1 + 0.5 * hash(x, y + k, 0xc5)) * (kind === "shrub" || !scrub ? 1 : 0.5 * grown);
      out.push({ kind, u, v, turn: Math.floor(hash(x + k, y, 0xc4) * 4), size, seed: hash(x + k, y + k, 0xc6) });
    }
  }
  out.push(...madeOn(g, palette, x, y, i), ...scatterOn(g, palette, x, y, i));
  return out.sort((a, b) => a.u + a.v - (b.u + b.v));
}

/** How far a cell sits under the ground beside it, in height steps: under a steep face, more than one. */
function underFace(g: Grid, x: number, y: number, i: number): number {
  let most = 0;
  for (const [dx, dy] of [[1, 0], [0, 1], [-1, 0], [0, -1]] as const) {
    if (inBounds(g, x + dx, y + dy)) most = Math.max(most, g.height[i + dx + dy * g.w] - g.height[i]);
  }
  return most;
}

/**
 * WHAT LIES ABOUT on a cell, 0–2 things, by a cheap hash so most cells have none: boulders fallen under a steep face
 * and strewn on the heights, a fallen log in a grown wood, tufts of rough grass in a meadow, a bush where a wood
 * meets the grass. Only on open, dry, unbuilt ground (the caller's `standable`).
 */
export function scatterOn(g: Grid, palette: Palette, x: number, y: number, i = vegAt(g, palette, x, y)): ForestTree[] {
  const V = g.veg, cover = V.cover[i], out: ForestTree[] = [];
  if (V.wet[i] || g.pool[i] > 0 || cover === COVER.none || cover === COVER.reeds || cover === COVER.field || cover >= COVER.stumps) return out;
  const at = (kind: string, size: number, k: number) => out.push({
    kind, u: x + (hash(x * 11 + k, y, 0xf3) - 0.5) * 0.7, v: y + (hash(x, y * 11 + k, 0xf4) - 0.5) * 0.7,
    turn: Math.floor(hash(x + k, y * 3, 0xf5) * 4), size, seed: hash(x * 3 + k, y, 0xf6),
  });
  const r = hash(x, y, 0xf1), r2 = hash(x, y, 0xf2);
  // ROCKS: under a face, often; on the heath and the heights, now and then.
  const face = underFace(g, x, y, i), high = heightShare(g, i);
  const rocky = face >= 2 ? 0.55 : high > 0.55 && cover === COVER.meadow ? 0.1 : high > 0.8 ? 0.06 : 0;
  if (r < rocky) at("rock", 1.3 + 0.9 * r2, 0);
  if (cover === COVER.wood) {
    // A LOG where a wood is grown and thick.
    if (V.density[i] >= 2 && V.age[i] >= MATURE && r2 < 0.1) at("log", 0.9 + 0.3 * r, 1);
  } else if (cover === COVER.meadow || cover === COVER.scrub) {
    // TUFTS of rough grass.
    if (r2 < 0.4) at("tuft", 1 + 0.6 * r, 2);
    if (r2 < 0.12) at("tuft", 0.8 + 0.5 * r2, 3);
  } else if (cover === COVER.grass && r2 < 0.22) {
    // A BUSH where a wood meets the grass.
    let wood = false;
    for (let dy = -1; dy <= 1 && !wood; dy++) for (let dx = -1; dx <= 1; dx++) if (woodOf(g, palette, x + dx, y + dy) > 0.5) { wood = true; break; }
    if (wood) at("shrub", 0.8 + 0.4 * r, 4);
  }
  return out;
}
/** Whether anything lies about on a cell (cheaply, before the trees are reckoned). @see scatterOn */
export function scattered(g: Grid, palette: Palette, x: number, y: number): boolean {
  return standable(g, palette, x, y) && scatterOn(g, palette, x, y).length > 0;
}

/** How thick the heath is over a cell, 0–1: open ground high up, in patches. None elsewhere. */
export function heathAt(g: Grid, palette: Palette, x: number, y: number): number {
  const i = vegAt(g, palette, x, y);
  return g.veg.cover[i] === COVER.meadow && heightShare(g, i) > 0.55 ? heathOf(x, y) : 0;
}

/** The kind a row of trees is of, by its biome: a poplar by the water, a pine on the heights, a lime elsewhere. */
function rowKind(g: Grid, x: number, y: number, i: number): string {
  if (waterNear(g, x, y, 2) <= 2) return "poplar";
  return heightShare(g, i) > 0.74 ? "pine" : "lime";
}

/** WHAT THE PLAYER MADE on a cell: stumps where trees were felled, a row's tree, a hedge, a bed. */
function madeOn(g: Grid, palette: Palette, x: number, y: number, i: number): ForestTree[] {
  const V = g.veg, cover = V.cover[i], out: ForestTree[] = [];
  const at = (u: number, v: number, kind: string, size: number, salt: number) =>
    out.push({ kind, u, v, turn: Math.floor(hash(x * 13 + salt, y, 0xd1) * 4), size, seed: hash(x, y * 13 + salt, 0xd2) });
  switch (cover) {
    case COVER.burnt: {
      // SNAGS where a wood burnt: its trees bare and charred, as many as it had, of its own kinds.
      const mix = biomeOf(g, x, y, i);
      for (let k = 0; k < Math.min(6, V.density[i] * 2); k++) {
        const kind = pick(mix, hash(x * 3 + k, y, 0xe1));
        out.push({ kind, u: x + (hash(x * 5 + k, y, 0xe2) - 0.5) * 0.85, v: y + (hash(x, y * 5 + k, 0xe3) - 0.5) * 0.85, turn: Math.floor(hash(x + k, y, 0xe4) * 4), size: 0.6 + 0.35 * hash(x + k, y, 0xe5), seed: hash(x, y + k, 0xe6), char: 1 });
      }
      break;
    }
    case COVER.stumps:
      for (let k = 0; k < Math.min(6, V.density[i]); k++) at(x + (hash(x * 5 + k, y, 0xd3) - 0.5) * 0.8, y + (hash(x, y * 5 + k, 0xd4) - 0.5) * 0.8, "stump", 1.4 + 0.6 * hash(x + k, y, 0xd5), k);
      break;
    case COVER.row:
      at(x, y, rowKind(g, x, y, i), 0.9 * grownBy(V.age[i]), 0);
      break;
    case COVER.hedge: {
      // Shrubs close together, a fifth of a cell apart, out to each hedge beside it: one line, no gaps.
      const size = 1.3 * grownBy(V.age[i]) + 0.15;
      at(x, y, "shrub", size, 0);
      for (const [dx, dy] of [[1, 0], [0, 1], [-1, 0], [0, -1]] as const) {
        if (!inBounds(g, x + dx, y + dy) || V.cover[vegAt(g, palette, x + dx, y + dy)] !== COVER.hedge) continue;
        // (Out to the edge from each side: the neighbour brings it the rest of the way.)
        for (let k = 1; k <= 2; k++) at(x + dx * 0.2 * k + (hash(x * 7 + k, y, 0xd8) - 0.5) * 0.05, y + dy * 0.2 * k + (hash(x, y * 7 + k, 0xd9) - 0.5) * 0.05, "shrub", size * (0.85 + 0.2 * hash(x + k, y + dx, 0xda)), 4 + k + (dx + 1) * 3 + (dy + 1) * 9);
      }
      break;
    }
    case COVER.bed:
      for (let j = 0; j < 3; j++) for (let k = 0; k < 3; k++) at(x - 0.3 + k * 0.3 + (hash(x * 3 + k, y * 3 + j, 0xd6) - 0.5) * 0.08, y - 0.3 + j * 0.3, "flowers", 1.3 + 0.4 * hash(x * 3 + k, y * 3 + j, 0xd7), 3 * j + k);
      break;
  }
  return out;
}
