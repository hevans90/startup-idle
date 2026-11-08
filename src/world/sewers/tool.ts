/**
 * World v2 — THE SEWER TOOL'S PLAN for the stroke in hand, at today's prices:
 * worked out once a move of the drag and shared by its ghost, its card and
 * the stroke that lays it. @see planSewer
 */
import { buildCost, pipeCost } from "../../game/build-cost";
import type { Stroke } from "../edit/tools";
import type { Grid } from "../grid";
import { routeMain } from "../water/mains";
import { planLateral, planSewer, routeSewer, type LateralPlan, type SewerPlan } from "./lay";

type Cell = { x: number; y: number };

export type SewerStrokePlan = SewerPlan | { refused: string };

let last: { g: Grid; rev: number; key: string; plan: SewerStrokePlan } | null = null;

/** What the Sewer tool's stroke would lay, or why not; null for a click (a node, or nothing). */
export function sewerStrokePlan(g: Grid, s: Stroke, wet: (x: number, y: number) => boolean, ai = false): SewerStrokePlan | null {
  if (s.anchor.x === s.head.x && s.anchor.y === s.head.y && !s.path) return null;
  const unit = pipeCost(1).toNumber(), liftPrice = buildCost("pump")?.toNumber() ?? 0;
  const key = `${s.anchor.x},${s.anchor.y},${s.head.x},${s.head.y},${unit},${liftPrice},${ai}`;
  if (last && last.g === g && last.rev === g.rev && last.key === key && !s.path) return last.plan;
  const route = s.path ? [...s.path] : routeSewer(g, s.anchor, s.head, wet);
  const plan: SewerStrokePlan = route
    ? planSewer(g, route, wet, { unit, liftPrice, ai })
    : { refused: "No way through for a sewer: round buildings" };
  last = { g, rev: g.rev, key, plan };
  return plan;
}

let lastLateral: { g: Grid; rev: number; key: string; route: Cell[] | null; plan: LateralPlan | { refused: string } } | null = null;

/** What a Lateral stroke would lay — its route, and the plan or why not; null for a click. */
export function lateralStrokePlan(g: Grid, s: Stroke, wet: (x: number, y: number) => boolean): { route: Cell[] | null; plan: LateralPlan | { refused: string } } | null {
  if (s.anchor.x === s.head.x && s.anchor.y === s.head.y && !s.path) return null;
  const key = `${s.anchor.x},${s.anchor.y},${s.head.x},${s.head.y}`;
  if (lastLateral && lastLateral.g === g && lastLateral.rev === g.rev && lastLateral.key === key && !s.path) return lastLateral;
  const route = s.path ? [...s.path] : routeMain(g, s.anchor, s.head, wet, true);
  const plan = route ? planLateral(g, route, wet) : { refused: "No way through for a lateral: round buildings, off the water" };
  lastLateral = { g, rev: g.rev, key, route, plan };
  return lastLateral;
}
