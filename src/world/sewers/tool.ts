/**
 * World v2 — THE SEWER TOOL'S PLAN for the stroke in hand, at today's prices:
 * worked out once a move of the drag and shared by its ghost, its card and
 * the stroke that lays it. @see planSewer
 */
import { buildCost, pipeCost } from "../../game/build-cost";
import type { Stroke } from "../edit/tools";
import { MAIN_SEWER, SEWER_FIT, VOID, idx, inBounds, type Grid } from "../grid";
import { hasSewer } from "./solve";
import { portsAt } from "../water/ports";
import { routeMain } from "../water/mains";
import { strokeKey, strokeRoute } from "../pipes/stroke-route";
import { planLateral, planSewer, type LateralPlan, type SewerPlan } from "./lay";

type Cell = { x: number; y: number };

/**
 * WHAT THE SEWER TOOL IS LAYING, worked out from where the stroke starts and
 * where it is: a CONNECTION — the tube above ground from a workplace to a
 * manhole — if it runs between a workplace's slop port (or a connection
 * already laid) and a MANHOLE; else a TRUNK underground, even one dragged to
 * a workplace: it stops beside it, a manhole there to connect to. Begun on a
 * port, it is a connection until it has gone somewhere. There is no switch to
 * set first. @see planLateral, planSewer, slopPortAt
 */
export function laysConnection(g: Grid, a: Cell, b: Cell): boolean {
  const link = (c: Cell) => {
    if (!inBounds(g, c.x, c.y)) return false;
    const i = idx(g, c.x, c.y);
    return (g.main[i] & MAIN_SEWER) !== 0 || slopPortAt(g, c);
  };
  const node = (c: Cell) => inBounds(g, c.x, c.y) && g.sewerFit[idx(g, c.x, c.y)] === SEWER_FIT.node;
  if (a.x === b.x && a.y === b.y) return link(a);
  return (link(a) && (node(b) || link(b))) || (link(b) && node(a));
}

/** Whether a workplace's slop comes out at a tile. */
export const slopPortAt = (g: Grid, c: Cell) => inBounds(g, c.x, c.y) && portsAt(g, idx(g, c.x, c.y), "slop", "out").length > 0;

/**
 * A TRUNK'S ROUTE, its ends off any workplace's slop port: a trunk dragged to a workplace stops a tile short of
 * it, where its end's manhole is what the workplace connects to — a manhole on the port itself drains nothing.
 */
export function trunkOffPorts(g: Grid, route: Cell[]): Cell[] {
  let r = route;
  if (r.length > 2 && slopPortAt(g, r[r.length - 1]) && !hasSewer(g, idx(g, r[r.length - 1].x, r[r.length - 1].y))) r = r.slice(0, -1);
  if (r.length > 2 && slopPortAt(g, r[0]) && !hasSewer(g, idx(g, r[0].x, r[0].y))) r = r.slice(1);
  return r;
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
  const routed = strokeRoute(g, s, wet, "trunk"), route = routed && trunkOffPorts(g, routed);
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
