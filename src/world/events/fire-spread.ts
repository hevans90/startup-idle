/**
 * World v2 — WHERE A FIRE LET BURN SPREADS: to the buildings next to it —
 * a tile or less between their footprints — that are left without water,
 * the nearest first, up to `n`. A drinker whose tank is keeping up is
 * watered, and does not catch. Pure. @see FIRE, FIRE_SPREAD
 */
import type { Grid, Structure } from "../grid";

/** Tiles between two footprints, the nearer way: 0 when they touch. */
const gapOf = (a: Structure, b: Structure) =>
  Math.max(0, a.x - (b.x + b.w), b.x - (a.x + a.w), a.y - (b.y + b.h), b.y - (a.y + a.h));

export function spreadTargets(g: Grid, from: number, watered: (id: number) => boolean, n: number): number[] {
  const src = g.structures.get(from);
  if (!src || n <= 0) return [];
  const near: { id: number; gap: number }[] = [];
  for (const s of g.structures.values()) {
    if (s.id === from || s.build || watered(s.id)) continue;
    const gap = gapOf(src, s);
    if (gap <= 1) near.push({ id: s.id, gap });
  }
  near.sort((a, b) => a.gap - b.gap || a.id - b.id);
  return near.slice(0, n).map((x) => x.id);
}
