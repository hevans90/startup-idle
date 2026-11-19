/**
 * WOODS AS WOODS, on the continuous surface: not one, two or three trees stood on set spots in every wooded tile,
 * but trees scattered from a smooth DENSITY over the map — thick in a wood's heart with crowns overlapping, thinning
 * raggedly toward its edge and spilling a little past it onto the grass, opened here and there by a clearing; in
 * STANDS, a stretch of pines here and of oak and lime there, with birch among both; of every size, a sapling now
 * and then. Pure: the same map, the same trees. @see tree-mesh, ground-mesh canopy
 */
import { VOID, idx, inBounds, structureOf, type Grid } from "../grid";
import { treesIn } from "../terrain-names";

/** One tree: what it is, where its foot is (tiles), which way round, how big. */
export type ForestTree = { kind: string; u: number; v: number; turn: number; size: number; seed: number };

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

/** Whether a tree may stand in a cell at all: natural ground, nothing built on it, no water on it. */
function standable(g: Grid, palette: readonly (string | null)[], x: number, y: number): boolean {
  if (!inBounds(g, x, y)) return false;
  const i = idx(g, x, y), mat = g.terrain[i];
  if (mat === VOID || g.paved[i] || g.pool[i] > 0 || g.deck[i] || g.main[i] || structureOf(g, x, y)) return false;
  const name = palette[mat] ?? "";
  return name === "grass" || /^wood/.test(name);
}
/** A cell's own wood, 0–1, by how many trees its material says; none where none may stand. */
export function woodOf(g: Grid, palette: readonly (string | null)[], x: number, y: number): number {
  if (!standable(g, palette, x, y)) return 0;
  // (Any wood is a wood: its material's one, two or three trees only say how thick, from half on.)
  const n = treesIn(palette[g.terrain[idx(g, x, y)]]);
  return n ? 0.55 + 0.225 * (n - 1) : 0;
}
/** THE CANOPY of a cell, 0–1: its wood and its neighbours', weighed 1-2-1, so a wood's heart is thick and its rim thin. */
export function canopyOf(g: Grid, palette: readonly (string | null)[], x: number, y: number): number {
  let s = 0, w = 0;
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    const k = (dx ? 1 : 2) * (dy ? 1 : 2);
    s += woodOf(g, palette, x + dx, y + dy) * k; w += k;
  }
  return s / w;
}

/** The kinds a stand is of: conifers, a mixed wood, broadleaves — each with its own share of every kind. */
const STANDS: readonly (readonly [string, number][])[] = [
  [["pine", 8], ["birch", 2]],
  [["pine", 3], ["oak", 2], ["birch", 2], ["lime", 1], ["hornbeam", 1]],
  [["oak", 4], ["lime", 3], ["hornbeam", 2], ["birch", 1]],
];
const pick = (list: readonly [string, number][], r: number) => {
  const all = list.reduce((s, [, n]) => s + n, 0);
  let t = r * all;
  for (const [k, n] of list) { if ((t -= n) < 0) return k; }
  return list[list.length - 1][0];
};

/**
 * THE TREES WHOSE FOOT IS IN CELL (x, y), back to front. Read from the density at each lattice point of the cell:
 * the canopy of the cells round it blended to the point, opened by a slow noise into clearings and glades.
 * `canopy` is `canopyOf`, passed in so a caller can keep it.
 */
export function forestTrees(g: Grid, palette: readonly (string | null)[], x: number, y: number, canopy = (cx: number, cy: number) => canopyOf(g, palette, cx, cy)): ForestTree[] {
  if (!standable(g, palette, x, y)) return [];
  // (Nothing near any wood: no trees, and no lattice walked for them.)
  let near = 0;
  for (let dy = -1; dy <= 1 && !near; dy++) for (let dx = -1; dx <= 1; dx++) if (woodOf(g, palette, x + dx, y + dy) > 0) { near = 1; break; }
  if (!near) return [];
  const out: ForestTree[] = [];
  for (let j = 0; j < LATTICE; j++) for (let i = 0; i < LATTICE; i++) {
    const lx = x * LATTICE + i, ly = y * LATTICE + j;
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
    const stand = noise(u * 0.16 + 7, v * 0.16 + 3, 0x66);
    const kind = pick(STANDS[stand < 0.4 ? 0 : stand < 0.58 ? 1 : 2], hash(lx, ly, 0x77));
    // Biggest in the heart; smaller toward the rim; a sapling now and then.
    const sapling = hash(lx, ly, 0x88) < 0.08;
    const size = sapling ? 0.45 + 0.15 * hash(lx, ly, 0x99) : 0.68 + 0.32 * hash(lx, ly, 0x99) + 0.18 * Math.min(1, c);
    out.push({ kind, u: u - 0.5, v: v - 0.5, turn: Math.floor(hash(lx, ly, 0xaa) * 4), size, seed: hash(lx, ly, 0xbb) });
  }
  return out.sort((a, b) => a.u + a.v - (b.u + b.v));
}
