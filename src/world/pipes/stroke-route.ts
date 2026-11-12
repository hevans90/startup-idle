/**
 * World v2 — THE ROUTE OF A PIPE STROKE: a held drag's, from where it went
 * down to where it is; or, for a pipe laid by clicks, through every corner
 * PINNED on the way — the router filling in between pins, each stretch kept
 * off the ones before so the run never crosses itself. One function for the
 * ghost, the card and the stroke that lays it, so the three cannot disagree.
 * @see Stroke.pins, plans/pipe-network.md §8
 */
import type { Stroke } from "../edit/tools";
import { idx, type Grid } from "../grid";
import { routeSewer } from "../sewers/lay";
import { routeMain } from "../water/mains";
import { connectPointsKept, snapToConnect } from "./connect-points";

type Cell = { x: number; y: number };

/** What a stroke lays: a water main, a sewer connection, or a trunk. */
export type PipeKind = "main" | "connection" | "trunk";
export const pipeKindOf = (s: Pick<Stroke, "tool" | "sewer" | "lateral">): PipeKind =>
  s.tool === "sewer" ? (s.lateral ? "connection" : "trunk") : s.sewer ? "connection" : "main";

/** The route through a stroke's pins to its head; null where any stretch has no way. A route given (`path`) is taken as it is. */
export function strokeRoute(g: Grid, s: Stroke, wet: (x: number, y: number) => boolean, kind: PipeKind = pipeKindOf(s)): Cell[] | null {
  if (s.path) return [...s.path];
  // ITS END GOES TO WHAT IT IS BESIDE: an inlet, a pipe's end, a manhole within a tile of the pointer. @see snapToConnect
  const start = s.pins?.[0] ?? s.anchor;
  const head = snapToConnect(g, s.head, connectPointsKept(g, kind, start));
  const stops = [...(s.pins ?? [s.anchor]), head];
  const out: Cell[] = [], avoid = new Set<number>();
  for (let k = 1; k < stops.length; k++) {
    const a = out.length ? out[out.length - 1] : stops[k - 1], b = stops[k];
    if (a.x === b.x && a.y === b.y) { if (!out.length) out.push(a); continue; }
    const leg = kind === "trunk" ? routeSewer(g, a, b, wet, avoid) : routeMain(g, a, b, wet, kind === "connection", avoid);
    if (!leg) return null;
    // The stretch's first tile is the last one's end, unless an end snapped to a port beside it.
    const from = out.length && out[out.length - 1].x === leg[0].x && out[out.length - 1].y === leg[0].y ? 1 : 0;
    for (const c of leg.slice(from)) out.push(c);
    for (const c of out.slice(0, -1)) avoid.add(idx(g, c.x, c.y));
  }
  return out.length ? out : [head];
}

/** A stroke's stops as a key, for whoever keeps the last answer. */
export const strokeKey = (s: Stroke) => `${(s.pins ?? [s.anchor]).map((c) => `${c.x},${c.y}`).join(";")}>${s.head.x},${s.head.y}`;
