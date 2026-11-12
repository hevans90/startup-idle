/**
 * World v2 — THE SEWER TOOL'S PLAN for the stroke in hand, at today's prices:
 * worked out once a move of the drag and shared by its ghost, its card and
 * the stroke that lays it. @see planSewer
 */
import { buildCost, pipeCost } from "../../game/build-cost";
import type { Stroke } from "../edit/tools";
import { MAIN_SEWER, VOID, idx, inBounds, type Grid } from "../grid";
import { portsAt } from "../water/ports";
import { routeMain } from "../water/mains";
import { strokeKey, strokeRoute } from "../pipes/stroke-route";
import { planLateral, planSewer, type LateralPlan, type SewerPlan } from "./lay";

type Cell = { x: number; y: number };

/**
 * WHAT THE SEWER TOOL IS LAYING, worked out from where the stroke starts and
 * where it is: a CONNECTION — the tube above ground from a workplace to a
 * manhole — if either end is a workplace's slop port or a connection already
 * laid; else a TRUNK underground. There is no switch to set first.
 * @see planLateral, planSewer
 */
export function laysConnection(g: Grid, a: Cell, b: Cell): boolean {
  const at = (c: Cell) => {
    if (!inBounds(g, c.x, c.y)) return false;
    const i = idx(g, c.x, c.y);
    return (g.main[i] & MAIN_SEWER) !== 0 || portsAt(g, i, "slop", "out").length > 0;
  };
  return at(a) || at(b);
}

export type SewerStrokePlan = SewerPlan | { refused: string };

let last: { g: Grid; rev: number; key: string; plan: SewerStrokePlan } | null = null;

/** What the Sewer tool's stroke would lay, or why not; null for a click (a node, or nothing). */
export function sewerStrokePlan(g: Grid, s: Stroke, wet: (x: number, y: number) => boolean, ai = false): SewerStrokePlan | null {
  if (s.anchor.x === s.head.x && s.anchor.y === s.head.y && !s.path && !((s.pins?.length ?? 0) > 1)) return null;
  const unit = pipeCost(1).toNumber(), liftPrice = buildCost("pump")?.toNumber() ?? 0;
  const key = `${strokeKey(s)},${unit},${liftPrice},${ai}`;
  if (last && last.g === g && last.rev === g.rev && last.key === key && !s.path) return last.plan;
  // Through its pins, if it is being laid by clicks. @see strokeRoute
  const route = strokeRoute(g, s, wet, "trunk");
  const plan: SewerStrokePlan = route
    ? planSewer(g, route, wet, { unit, liftPrice, ai })
    : { refused: "No way through for a sewer: round buildings" };
  last = { g, rev: g.rev, key, plan };
  return plan;
}

let lastLateral: { g: Grid; rev: number; key: string; route: Cell[] | null; plan: LateralPlan | { refused: string } } | null = null;

/** What a Lateral stroke would lay — its route, and the plan or why not; null for a click. */
export function lateralStrokePlan(g: Grid, s: Stroke, wet: (x: number, y: number) => boolean): { route: Cell[] | null; plan: LateralPlan | { refused: string } } | null {
  if (s.anchor.x === s.head.x && s.anchor.y === s.head.y && !s.path && !((s.pins?.length ?? 0) > 1)) return null;
  const key = strokeKey(s);
  if (lastLateral && lastLateral.g === g && lastLateral.rev === g.rev && lastLateral.key === key && !s.path) return lastLateral;
  const route = strokeRoute(g, s, wet, "connection");
  // WHY THERE IS NO WAY: an end in a road, a street across it, or just buildings and water. @see planLateral
  const paved = (c: Cell) => inBounds(g, c.x, c.y) && g.paved[idx(g, c.x, c.y)] !== VOID;
  const blocked = paved(s.anchor) || paved(s.head) ? "A sewer connection can't end in a road: lay a trunk into the block"
    : routeMain(g, s.anchor, s.head, wet) ? "A sewer connection can't cross a road"
    : "No way through for a connection: round buildings, off the water";
  const plan = route ? planLateral(g, route, wet) : { refused: blocked };
  lastLateral = { g, rev: g.rev, key, route, plan };
  return lastLateral;
}
