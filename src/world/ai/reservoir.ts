/**
 * World v2 — THE AI'S RESERVOIRS: water it digs for itself, only as a last
 * resort — a building that drinks is short and no pipe can reach water — and
 * no more than `MAX_RESERVOIRS` a company. A 3×3 basin on level ground by the
 * building, lowered `DEPTH` half steps through the player's own height tool,
 * its ring left as a rim at the ground's height, and one pour filling it to
 * just under the rim. It holds water but makes none: its next job pipes from it, and
 * once it is drunk dry, a proper source. @see plans/ai-takeover.md §3
 */
import { POUR_AMOUNT, depthAt } from "../water/field";
import { idx, inBounds, structureAt, type Grid, type Structure } from "../grid";
import { isPaved } from "../roads/mask";
import { ownsTile } from "../land";
import { companyLand, useWorldStore } from "../../state/world.store";
import { useSessionStore } from "../../state/session.store";
import { HEIGHT_MIN } from "../edit/height-tools";
import { pour, reshape } from "../play/build-actions";
import { inDistrict, type District } from "./district";

type Cell = { x: number; y: number };

/**
 * Its side, in tiles; the step it is dug by; how deep, in half steps — a
 * step more than one pour fills, so the water stands below the rim and does
 * not film over it.
 */
export const RESERVOIR = 3;
const STEP = 2;
export const DEPTH = POUR_AMOUNT + STEP;
/** The most a company's AI digs. */
export const MAX_RESERVOIRS = 2;
/** How far from the building it looks for a site, tiles. */
const REACH = 8;

/** The reservoirs it has dug this company. */
export const reservoirs = (): readonly Cell[] => useSessionStore.getState().aiReservoirs ?? [];

/**
 * WHERE TO DIG for a building: a 3×3 in its district, with a ring round it,
 * all of it level (within a half step), owned, dry, and clear of road, pipe
 * and building — so the water stays in and nothing stands in it; the nearest
 * the building, for the shortest pipe. Null with nowhere fit.
 */
export function siteFor(g: Grid, s: Structure, d: District | null): Cell | null {
  const land = companyLand();
  const field = useWorldStore.getState().getWaterField();
  const clear = (x: number, y: number) => {
    if (!inBounds(g, x, y) || !ownsTile(g, land, x, y)) return false;
    const i = idx(g, x, y);
    return !g.pool[i] && !g.pipe[i] && !isPaved(g, x, y) && structureAt(g, x, y) < 0 && !(field && depthAt(field, x, y) > 0);
  };
  let best: Cell | null = null, nearest = Infinity;
  for (let y = s.y - REACH; y <= s.y + s.h + REACH; y++) {
    for (let x = s.x - REACH; x <= s.x + s.w + REACH; x++) {
      if (![[0, 0], [RESERVOIR - 1, 0], [0, RESERVOIR - 1], [RESERVOIR - 1, RESERVOIR - 1]].every(([dx, dy]) => inDistrict(d, x + dx, y + dy))) continue;
      let lo = Infinity, hi = -Infinity, ok = true;
      for (let v = y - 1; ok && v <= y + RESERVOIR; v++) {
        for (let u = x - 1; ok && u <= x + RESERVOIR; u++) {
          if (!clear(u, v)) { ok = false; break; }
          const h = g.height[idx(g, u, v)];
          lo = Math.min(lo, h); hi = Math.max(hi, h);
        }
      }
      if (!ok || hi - lo > 1 || lo - DEPTH < HEIGHT_MIN) continue;
      // From its middle to the building's nearest edge.
      const cx = x + 1, cy = y + 1;
      const gap = Math.max(0, s.x - cx, cx - (s.x + s.w - 1)) + Math.max(0, s.y - cy, cy - (s.y + s.h - 1));
      if (gap < nearest) { nearest = gap; best = { x, y }; }
    }
  }
  return best;
}

/** Dig the basin and fill it to the rim; whether it was dug. Noted as one of its reservoirs. */
export function digReservoir(at: Cell): boolean {
  const rows = [...Array(RESERVOIR).keys()].map((k) => [{ x: at.x, y: at.y + k }, { x: at.x + RESERVOIR - 1, y: at.y + k }] as const);
  for (let pass = 0; pass < DEPTH / STEP; pass++) {
    for (const [from, to] of rows) if (!reshape("lower", from, to, STEP)) return false;
  }
  for (const [from, to] of rows) pour(from, to);
  const st = useSessionStore.getState();
  st.setAiReservoirs([...reservoirs(), at]);
  return true;
}
