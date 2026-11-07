/**
 * World v2 — SLUDGE on the map, in the real water: what a vibe workplace's
 * full slop tank spills at its port, running downhill, thick and slow, into
 * whatever is near — houses with it on their doorstep, and drying up in time.
 * @see world/slop/tanks, cleanup
 */
import { housedBy } from "../../game/housing";
import type { Grid, Structure } from "../grid";
import { inBounds, structureAt } from "../grid";
import { fluidIndexOf } from "../water/materials";
import { structureDef } from "../structures/def";
import { COLUMNS_PER_TILE, drainAt, type WaterField } from "../water/field";

/** How fast it dries, half steps a second, and how near a workplace it is looked for. */
export const DRY_RATE = 0.04;
export const DRY_REACH = 16;
/** Deeper than this, in half steps, and a tile counts as under sludge. */
export const SLUDGED = 0.25;

const SLOP = () => fluidIndexOf("slop");

/** The tiles round a structure's footprint, just outside it. */
export function ring(g: Grid, s: Structure): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  for (let y = s.y - 1; y <= s.y + s.h; y++) {
    for (let x = s.x - 1; x <= s.x + s.w; x++) {
      const inside = x >= s.x && x < s.x + s.w && y >= s.y && y < s.y + s.h;
      if (!inside && inBounds(g, x, y)) out.push({ x, y });
    }
  }
  return out;
}

/** How deep the sludge on a tile is, half steps, on the ground storey: its deepest column. */
export const sludgeAt = (field: WaterField, x: number, y: number): number => fluidAt(field, x, y, SLOP());

/** How deep one fluid on a tile is, half steps, on the ground storey: its deepest column. */
export function fluidAt(field: WaterField, x: number, y: number, material: number): number {
  const c = field.columns;
  let most = 0;
  for (let dy = 0; dy < COLUMNS_PER_TILE; dy++) {
    for (let dx = 0; dx < COLUMNS_PER_TILE; dx++) {
      const cx = x * COLUMNS_PER_TILE + dx, cy = y * COLUMNS_PER_TILE + dy;
      if (cx >= c.nx || cy >= c.ny) continue;
      const i = cy * c.nx + cx;
      if (c.material[i] === material && c.depth[i] > most) most = c.depth[i];
    }
  }
  return most;
}

/** Whether a tile is in a basin — a reservoir — whose fluid belongs there. */
export const inPit = (g: Grid, x: number, y: number) => {
  const s = g.structures.get(structureAt(g, x, y));
  return !!s && (structureDef(s.def)?.basin ?? 0) > 0;
};

/** Houses with sludge on them or right against them. */
export function sludgedHouses(field: WaterField, g: Grid): Set<number> {
  const out = new Set<number>();
  for (const s of g.structures.values()) {
    if (!housedBy(s.def)) continue;
    for (const t of [...ring(g, s), { x: s.x, y: s.y }]) {
      if (!inPit(g, t.x, t.y) && sludgeAt(field, t.x, t.y) > SLUDGED) { out.add(s.id); break; }
    }
  }
  return out;
}

/** The tiles within `DRY_REACH` of any of `around`, once each: where spilled sludge is looked for. */
export function nearAny(g: Grid, around: readonly Structure[]): { x: number; y: number }[] {
  const seen = new Uint8Array(g.w * g.h), out: { x: number; y: number }[] = [];
  for (const s of around) {
    for (let y = Math.max(0, s.y - DRY_REACH); y < Math.min(g.h, s.y + s.h + DRY_REACH); y++) {
      for (let x = Math.max(0, s.x - DRY_REACH); x < Math.min(g.w, s.x + s.w + DRY_REACH); x++) {
        if (seen[y * g.w + x]) continue;
        seen[y * g.w + x] = 1;
        out.push({ x, y });
      }
    }
  }
  return out;
}

/** Sludge near the vibe workplaces drying up a little, for `dt` seconds. */
export function dryUp(field: WaterField, g: Grid, around: readonly Structure[], dt: number) {
  for (const t of nearAny(g, around)) {
    if (!inPit(g, t.x, t.y) && sludgeAt(field, t.x, t.y) > 0) drainAt(field, t.x, t.y, DRY_RATE * dt);
  }
}

/** EVERY SPILL MOPPED UP, at once, but what lies in a pit (the slop pit's own). @see DILIGENCE "mop" */
export function mopAll(field: WaterField, g: Grid): void {
  for (let y = 0; y < g.h; y++) {
    for (let x = 0; x < g.w; x++) {
      const d = sludgeAt(field, x, y);
      if (d > 0 && !inPit(g, x, y)) drainAt(field, x, y, d);
    }
  }
}
