/**
 * World v2 — THE SURFACE ROAD WORKS ARE ON. On the continuous ground a road climbs as one slope, so what is planned,
 * set out, dug and driven on while it is built lies on the ground AS IT IS DRAWN, not on a level plate a tile: a
 * cell's tile is DRAPED on it, its corners where the ground's own mesh has them, so no row of ground shows over it.
 * @see drawn.ts drawnHeight
 */
import type { Texture } from "pixi.js";

import { idx, inBounds, type Grid } from "../grid";
import { HEIGHT_UNIT, HH, HW } from "../iso";
import { drawnHeight, roadCorner } from "./drawn";
import { groundMode } from "./ground-mode";

/** A level, half steps: one number, or one for every point. */
export type Level = number | ((x: number, y: number) => number);
export const levelOf = (h: Level, x: number, y: number) => (typeof h === "number" ? h : h(x, y));

/** A cell's four corners as its road will have them, on the map as it will be — (0,0), (1,0), (1,1), (0,1); undefined where it will be level. */
export const plannedCorners = (p: Grid, x: number, y: number): readonly [number, number, number, number] | undefined =>
  groundMode() === "smooth" && inBounds(p, x, y) && p.paved[idx(p, x, y)] !== 0 && p.deck[idx(p, x, y)] === 0
    ? [roadCorner(p, x, y), roadCorner(p, x + 1, y), roadCorner(p, x + 1, y + 1), roadCorner(p, x, y + 1)] : undefined;

/** The ground of a cell as it is drawn, at points of it: its edges its own, not its neighbour's. `flat` where the ground is stepped. */
export function worksLevel(g: Grid, cx: number, cy: number, flat: number): Level {
  if (groundMode() !== "smooth") return flat;
  const IN = 1e-5, at = (n: number, c: number) => Math.max(c + IN, Math.min(c + 1 - IN, n + 0.5));
  return (x, y) => drawnHeight(g, at(x, cx), at(y, cy));
}

/** A draped tile's points, `DRAPE + 1` a side: the ground's own quarters. */
export const DRAPE = 4;
/** How far over its edges a draped tile laps, tiles: no seam between two. */
const LAP = 0.02;
/**
 * A cell's tile laid on a level: each point's place on the map (tiles), on the screen, and in the tile's own texture
 * (a share of it across and down) — which was painted for the road the cell will have, `zc`, or level at `z`.
 */
export function drape(c: { x: number; y: number; scale: number; on: Level; tex: Texture; texX: number; texY: number; z: number; zc?: readonly [number, number, number, number] }) {
  const N = DRAPE + 1, out: { u: number; v: number; x: number; y: number; s: number; t: number }[] = [];
  const w = c.tex.orig.width * c.scale, h = c.tex.orig.height * c.scale;
  const x0 = c.texX - (c.tex.defaultAnchor?.x ?? 0.5) * w, y0 = c.texY - (c.tex.defaultAnchor?.y ?? 1) * h;
  const [z00, z10, z11, z01] = c.zc ?? [c.z, c.z, c.z, c.z];
  const px = (u: number, v: number, z: number): [number, number] => [(u - v) * HW * c.scale, (u + v) * HH * c.scale - z * HEIGHT_UNIT * c.scale];
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const a = i / DRAPE, b = j / DRAPE, lapped = (k: number) => k + (k === 0 ? -LAP : k === 1 ? LAP : 0);
    const u = c.x - 0.5 + lapped(a), v = c.y - 0.5 + lapped(b);
    // The road it will be, here: its two triangles' own. @see drawn.ts roadZ
    const la = lapped(a), lb = lapped(b);
    const will = la >= lb ? z00 + la * (z10 - z00) + lb * (z11 - z10) : z00 + la * (z11 - z01) + lb * (z01 - z00);
    const [sx, sy] = px(u, v, levelOf(c.on, u, v)), [tx, ty] = px(u, v, will);
    out.push({ u, v, x: sx, y: sy, s: (tx - x0) / w, t: (ty - y0) / h });
  }
  return out;
}
/** The triangles between them, each square cut the way the road's are. */
export const drapeIndices = (): Uint32Array => {
  const out: number[] = [], N = DRAPE + 1;
  for (let j = 0; j < DRAPE; j++) for (let i = 0; i < DRAPE; i++) { const o = j * N + i; out.push(o, o + 1, o + N + 1, o, o + N + 1, o + N); }
  return new Uint32Array(out);
};
