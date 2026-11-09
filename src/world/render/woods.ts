/**
 * World v2 — THE WOODS, stood up: a wooded cell is shaded grass, drawn by the
 * ground mesh like any other, and its trees — one, two or three, by which of
 * the wood frames it is — are props from the baked sheet, stood on it in its
 * band. The trees used to be stamped into the tile's own sprite, so the grass
 * under them was the old flat art and stopped dead at the wood's edge.
 * @see ground-mesh SPRITE_STILL, props/props-sheet
 *
 * Kept a cell at a time: when the map changes, only cells whose wood or
 * height did are stood up again.
 */
import type { Container } from "pixi.js";

import { VOID, idx, structureOf, type Grid } from "../grid";
import { bandOf } from "../iso";
import { PROP_TINT } from "../props/props-format";
import { bakedProps, propSprite, propSprites, propsLoaded, type PropSprites } from "../props/props-sheet";
import { mix } from "../structures/projects/pen";
import type { BandLayer } from "./bands";

/** How many trees a wood frame carries: `…_trees<n>.png`. */
export const treesIn = (frame: string | null | undefined): number => {
  const m = frame ? /_trees(\d)\.png$/.exec(frame) : null;
  return m ? Number(m[1]) : 0;
};

/** What grows in a wood, and how often. */
const KINDS: readonly [string, number][] = [["oak", 3], ["pine", 3], ["lime", 2], ["birch", 2], ["hornbeam", 1]];
const PICKS = KINDS.flatMap(([k, w]) => Array<string>(w).fill(k));

/** A hash of a cell and a tree in it, 0–1. */
const hash = (x: number, y: number, k: number, salt: number) =>
  ((Math.imul(Math.imul(x, 0x27d4eb2d) ^ Math.imul(y, 0x165667b1) ^ Math.imul(k + 1, 0x9e3779b1) ^ salt, 0x85ebca6b) >>> 8) & 0xffff) / 0x10000;

/** Where in its cell each tree of one, two or three stands, tiles from the middle. */
const STANDS: readonly (readonly [number, number][])[] = [
  [],
  [[0, 0]],
  [[-0.2, -0.16], [0.2, 0.18]],
  [[-0.22, -0.2], [0.26, -0.06], [-0.06, 0.25]],
];

/** One tree: what it is, where, which way round, how big and what green. */
export type WoodTree = { kind: string; u: number; v: number; turn: number; size: number; tint: number };

/** The trees of a cell with `n` of them, the same every time. Back to front. */
export function treesOf(x: number, y: number, n: number): WoodTree[] {
  return (STANDS[n] ?? []).map(([du, dv], k) => {
    const kind = PICKS[Math.floor(hash(x, y, k, 0x11) * PICKS.length)];
    const leaf = PROP_TINT[kind] ?? 0x5f8f3e;
    return {
      kind,
      u: x + du + (hash(x, y, k, 0x22) - 0.5) * 0.1,
      v: y + dv + (hash(x, y, k, 0x33) - 0.5) * 0.1,
      turn: Math.floor(hash(x, y, k, 0x44) * 4),
      size: 0.8 + 0.3 * hash(x, y, k, 0x55),
      // Some greener, some yellower, some darker: no two the same.
      tint: mix(leaf, hash(x, y, k, 0x66) < 0.5 ? 0x9cb84a : 0x2f5a2a, 0.25 * hash(x, y, k, 0x77)),
    };
  }).sort((a, b) => a.u + a.v - (b.u + b.v));
}

export type Woods = {
  /** Stand up the trees of whatever cells have changed. Cheap when nothing has. */
  sync: (g: Grid, palette: readonly (string | null)[], rev: number, scale: number) => void;
  destroy: () => void;
};

export function createWoods(bands: BandLayer): Woods {
  /** Each wooded cell's trees, and what they were stood up for. */
  const cells = new Map<number, { key: string; trees: Container[] }>();
  let key = "";
  const drop = (i: number) => {
    const c = cells.get(i);
    if (!c) return;
    for (const t of c.trees) { t.parent?.removeChild(t); t.destroy({ children: true }); }
    cells.delete(i);
  };
  const stand = (P: PropSprites, g: Grid, x: number, y: number, n: number, scale: number): Container[] => {
    const z = g.height[idx(g, x, y)], layer = bands.structureOf[bandOf(x, y)];
    if (!layer) return [];
    const out: Container[] = [];
    for (const t of treesOf(x, y, n)) {
      const c = propSprite(P, t.kind, t.turn, t.u, t.v, z, scale, t.tint, t.size);
      if (!c) continue;
      layer.addChild(c);
      out.push(c);
    }
    return out;
  };
  return {
    sync(g, palette, rev, scale) {
      if (!bakedProps()) return;
      const P = propsLoaded();
      if (!P) { void propSprites(); return; }
      const k = `${rev}|${scale}|${palette.length}`;
      if (k === key) return;
      key = k;
      const seen = new Set<number>();
      for (let y = 0; y < g.h; y++) for (let x = 0; x < g.w; x++) {
        const i = idx(g, x, y), mat = g.terrain[i];
        const n = mat === VOID ? 0 : treesIn(palette[mat]);
        // Nothing grows under a building. @see hidesTerrain
        if (!n || structureOf(g, x, y)) continue;
        seen.add(i);
        const ck = `${n}|${g.height[i]}|${scale}`;
        if (cells.get(i)?.key === ck) continue;
        drop(i);
        cells.set(i, { key: ck, trees: stand(P, g, x, y, n, scale) });
      }
      for (const i of [...cells.keys()]) if (!seen.has(i)) drop(i);
    },
    destroy() { for (const i of [...cells.keys()]) drop(i); key = ""; },
  };
}
