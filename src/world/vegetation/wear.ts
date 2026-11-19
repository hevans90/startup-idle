/**
 * WEAR: grass trampled to earth where the town goes — the verges beside a busy road worn by the wheels that run off
 * it, and a path across the grass where people walk off the paving, a desire path. Counted from where the movers
 * are (@see agents/town), a sample at a time; healing back to grass with nobody on it. Drawn by the ground, a cell's
 * wear in eighths (@see render/ground-mesh wornOver); kept in `veg.wear` (@see ./fields).
 */
import { inBounds, idx, type Grid } from "../grid";
import { built } from "../render/drawn";
import { vegAt } from "./fields";

type Palette = readonly (string | null)[];

/** Wear a sample gives, out of 255: to each verge beside a road a wheel is on, by how heavy; to unpaved ground a walker crosses. */
export const WEAR = { wheel: 1, heavy: 2, foot: 1, across: 5 } as const;
/** Wear healed a year, as a share of the most. */
export const HEAL = 3;

type Where = { x: number; y: number; kind: string };

/** Whether a cell wears: open ground, nothing built on it, no water on it. */
const wears = (g: Grid, x: number, y: number) => inBounds(g, x, y) && !built(g, x, y) && g.pool[idx(g, x, y)] === 0;

/**
 * A SAMPLE of where the movers are: each on a road wearing the verges beside it, each walker off the paving wearing
 * where it stands. Marks a cell whose wear shows differently (in eighths) in `veg.changed`; returns whether any did.
 */
export function wearFrom(g: Grid, palette: Palette, movers: Iterable<Where>): boolean {
  const V = g.veg;
  let shown = false;
  const add = (x: number, y: number, n: number) => {
    if (!wears(g, x, y)) return;
    const i = vegAt(g, palette, x, y), was = V.wear[i];
    V.wear[i] = Math.min(255, was + n);
    if (was >> 5 !== V.wear[i] >> 5) { V.changed.add(i); shown = true; }
  };
  for (const m of movers) {
    const x = Math.round(m.x), y = Math.round(m.y);
    if (!inBounds(g, x, y)) continue;
    const foot = m.kind === "person";
    if (!built(g, x, y)) { if (foot) add(x, y, WEAR.across); continue; }
    const n = foot ? WEAR.foot : m.kind === "truck" || m.kind === "bus" ? WEAR.heavy : WEAR.wheel;
    for (const [dx, dy] of [[1, 0], [0, 1], [-1, 0], [0, -1]] as const) add(x + dx, y + dy, n);
  }
  // (Not `veg.rev`: nothing that grows changed, only the ground drawn under it.)
  return shown;
}

/** `dt` years of healing: every worn cell growing back. Marks what shows differently. */
export function healWear(g: Grid, dt: number): boolean {
  const V = g.veg, by = HEAL * dt * 255;
  let shown = false;
  for (let i = 0; i < V.wear.length; i++) {
    const was = V.wear[i];
    if (!was) continue;
    // (Whole steps, the rest by where: a short step still heals.)
    const left = Math.max(0, was - by), whole = Math.floor(left);
    V.wear[i] = whole + ((i * 0x9e37 + Math.round(V.t * 3600)) % 97 < (left - whole) * 97 ? 1 : 0);
    if (was >> 5 !== V.wear[i] >> 5) { V.changed.add(i); shown = true; }
  }
  return shown;
}
