/**
 * World v2 — REBUILDING, WHERE IT PAYS: a park, café or gym put up where
 * starter lots stand, they pulled down — the move a tall town makes when the
 * houses round it cannot grow for want of one. Only lots of I or II, never
 * one grown past, and only where the settled income it adds, over
 * `REBUILD_HORIZON` seconds, is worth more than what it costs; the beds lost
 * are in that reckoning, for the town model is run without them. One a block,
 * the best. Pure: a grid in, a step out; run in the worker. @see settledTown
 */
import { housedBy } from "../../../game/housing";
import { idx, inBounds, structureAt, type Grid } from "../../grid";
import { commit, createHistory } from "../../edit/commands";
import { isPaved } from "../../roads/mask";
import { structureDef } from "../../structures/def";
import { demolishCommand, placeCommand } from "../../structures/place";
import { createNetwork } from "../../roads/network";
import { desireAt, desireMapsOf } from "../../agents/desirability";
import { placesOf } from "../../agents/roads";
import { RANGE, tierOf } from "../../agents/services";
import type { Box, PlanStep } from "./plan";
import { UNIT_PRICES, type Prices } from "./lookahead";
import { PLAIN, type Style } from "./style";
import { cloneGrid, settledTown } from "./town-model";

type Cell = { x: number; y: number };
export type Replace = Extract<PlanStep, { kind: "replace" }>;

/** Seconds of the income it adds a rebuild must pay back within. */
export const REBUILD_HORIZON = 600;
/** Spots tried, of the most promising, each a run of the town model. */
const TRIES = 6;
const SERVICES = ["park", "cafe", "gym"] as const;
const WHY: Record<(typeof SERVICES)[number], string> = { park: "park", cafe: "café", gym: "gym" };

/** A lot that may be pulled down: built, a starter of I or II. */
export const rebuildable = (g: Grid, x: number, y: number): boolean => {
  const id = structureAt(g, x, y);
  const s = id >= 0 ? g.structures.get(id) : undefined;
  if (!s || s.build || !housedBy(s.def)) return false;
  const t = tierOf(s.def);
  return t === "t0" || t === "t1";
};

/**
 * The rebuild in or about `box` that pays back best, or null. `income`: the
 * company's money a second, to set the town model's figures against prices.
 */
export function replacementFor(
  g: Grid, box: Box, owned: (x: number, y: number) => boolean,
  o: { kinds: readonly string[]; services: boolean; style?: Style }, income: number, prices: Prices = UNIT_PRICES,
): Replace | null {
  const style = o.style ?? PLAIN;
  const who = o.kinds[0];
  if (!style.rebuild || !o.services || !who || !(income > 0)) return null;
  const base = settledTown(cloneGrid(g)).income;
  if (!(base > 0)) return null;
  const perUnit = income / base;
  const near = (x: number, y: number) => x >= box.x0 - RANGE && x <= box.x1 + RANGE && y >= box.y0 - RANGE && y <= box.y1 + RANGE;
  const maps = desireMapsOf(g, placesOf(g, createNetwork(g)));
  // THE HOUSES WANTING ONE: lots about the block whose mood lacks it.
  const lots = [...g.structures.values()].filter((s) => !s.build && housedBy(s.def) && near(s.x, s.y) && owned(s.x, s.y));
  const candidates: { def: string; at: Cell; clears: Cell[]; wanting: number }[] = [];
  for (const def of SERVICES) {
    const d = structureDef(def)!;
    const wanting = lots.filter((l) => !desireAt(g, maps, l.x, l.y, housedBy(l.def)!.id)?.parts.some((p) => p.why === WHY[def]));
    if (!wanting.length) continue;
    const seen = new Set<number>();
    for (const l of wanting) {
      if (!rebuildable(g, l.x, l.y)) continue;
      // Every way its footprint can take this lot in.
      for (let dy = 0; dy < d.footprint.h; dy++) for (let dx = 0; dx < d.footprint.w; dx++) {
        const at = { x: l.x - dx, y: l.y - dy };
        if (!inBounds(g, at.x, at.y) || seen.has(idx(g, at.x, at.y))) continue;
        seen.add(idx(g, at.x, at.y));
        const clears: Cell[] = [];
        let ok = true;
        for (let y = at.y; y < at.y + d.footprint.h && ok; y++) for (let x = at.x; x < at.x + d.footprint.w && ok; x++) {
          if (!inBounds(g, x, y) || !owned(x, y) || isPaved(g, x, y) || g.pool[idx(g, x, y)]) ok = false;
          else if (structureAt(g, x, y) >= 0) { if (rebuildable(g, x, y)) clears.push({ x, y }); else ok = false; }
        }
        if (!ok || !clears.length) continue;
        const reach = wanting.filter((w) => Math.abs(w.x - at.x) + Math.abs(w.y - at.y) <= RANGE).length;
        candidates.push({ def, at, clears, wanting: reach });
      }
    }
  }
  // The most promising, by how many wanting houses it would reach for the beds it takes.
  candidates.sort((a, b) => b.wanting / b.clears.length - a.wanting / a.clears.length);
  let best: Replace | null = null, most = 0;
  for (const c of candidates.slice(0, TRIES)) {
    const trial = cloneGrid(g);
    for (const at of c.clears) {
      const cmd = demolishCommand(trial, structureAt(trial, at.x, at.y));
      if (cmd) commit(trial, createHistory(), cmd);
    }
    const put = placeCommand(trial, structureDef(c.def)!, c.at.x, c.at.y, { needsRoad: true, owned });
    if (!put) continue;
    commit(trial, createHistory(), put);
    const gain = settledTown(trial).income - base;
    const pays = gain * perUnit * REBUILD_HORIZON - (prices.defs[c.def] ?? 3);
    if (pays > most) { most = pays; best = { kind: "replace", def: c.def, at: c.at, clears: c.clears, value: pays }; }
  }
  return best;
}

/** Whether a rebuild can still go ahead: its lots still there, still starters, and the rest of its ground clear. */
export function stillStands(g: Grid, r: Replace): boolean {
  const d = structureDef(r.def);
  if (!d) return false;
  const clears = new Set(r.clears.map((c) => `${c.x},${c.y}`));
  for (let y = r.at.y; y < r.at.y + d.footprint.h; y++) for (let x = r.at.x; x < r.at.x + d.footprint.w; x++) {
    if (!inBounds(g, x, y) || isPaved(g, x, y)) return false;
    if (clears.has(`${x},${y}`) ? !rebuildable(g, x, y) : structureAt(g, x, y) >= 0) return false;
  }
  return true;
}
