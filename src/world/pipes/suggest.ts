/**
 * World v2 — CONNECT IT FOR ME: routes offered from a thirsty inlet or a slop
 * port with nothing on it, for the player to take or to ignore.
 *
 * NEVER ONE ANSWER, where there is more than one. Which water, gravity or a
 * pump, how much to spend: that choice is the puzzle and it stays the
 * player's — so up to three are offered, each best at something: the
 * CHEAPEST, the one that CARRIES MOST, and the one that needs NO PUMP (for a
 * sewer, no lift station); and where one way is best at all of those, the
 * SHORTEST of the others beside it. Where only one way exists it is shown as
 * the only way.
 *
 * NO PREMIUM AND NO SPECIAL POWERS. A suggestion is a route, and nothing
 * else: it is judged by the planner a hand-drawn stroke is judged by
 * (`mainStroke`, `planLateral`), at that planner's price, and laid by the
 * same stroke the tool lays. It cannot go anywhere a hand could not.
 *
 * OPENED BY DOING IT ONCE BY HAND, a kind at a time: water suggestions after
 * the player's first main is flowing, sewer ones after their first
 * connection is draining. Kept with the map. @see plans/pipe-network.md §8
 */
import { pipeCost } from "../../game/build-cost";
import type { Stroke } from "../edit/tools";
import { idx, type Grid } from "../grid";
import { planLateral } from "../sewers/lay";
import { nodeIntake } from "../sewers/flow";
import { SEWER_KIND, solveSewers } from "../sewers/solve";
import type { WaterField } from "../water/field";
import { mainStroke, type MainNeed } from "../water/main-stroke";
import { findMains, mainReportsFor, routeMain } from "../water/mains";
import { connectPoints, type ConnectPoint } from "./connect-points";

type Cell = { x: number; y: number };

/** What a suggestion is best at; `only` where there is just the one way. */
export type SuggestionWhy = "cheapest" | "most" | "no-pump" | "shortest" | "only";
export type Suggestion = {
  why: SuggestionWhy;
  kind: "main" | "connection";
  /** The stroke that lays it: its route given, to be ended as any stroke is. */
  stroke: Stroke;
  route: Cell[];
  fresh: number;
  price: number;
  /** A main's pump, or a connection's sewer having a lift station on its way down. */
  pump: boolean;
  /** What it carries a second: a main's flow as its preview quotes it, a connection's sewer's at its narrowest. */
  carries: number;
  /** A main's building, and what this brings it against what it needs. */
  need: MainNeed | null;
  /** Where it comes from: one water, one main's end, one manhole. Two routes from the same are one way. */
  from: string;
};

/** How many ways are looked at from each end: the nearest so many, and for a main the highest water in reach besides. */
const NEAREST = 5, REACH = 48;
const dist = (g: Grid, cell: number, c: Cell) => Math.abs((cell % g.w) - c.x) + Math.abs(((cell / g.w) | 0) - c.y);
const at = (g: Grid, cell: number): Cell => ({ x: cell % g.w, y: (cell / g.w) | 0 });

/** The three worth offering, of the ways found: each best at its own thing, none offered twice. */
function pick(found: Suggestion[]): Suggestion[] {
  const same = (a: Suggestion, b: Suggestion) => a.route.length === b.route.length && a.pump === b.pump && a.route.every((c, k) => c.x === b.route[k].x && c.y === b.route[k].y);
  // ONE WAY A SOURCE: of the routes from one water (with a pump, and without), the cheapest is that way.
  const distinct: Suggestion[] = [];
  for (const s of [...found].sort((a, b) => a.price - b.price)) if (!distinct.some((d) => same(d, s) || (d.from === s.from && d.pump === s.pump))) distinct.push(s);
  if (distinct.length <= 1) return distinct.map((s) => ({ ...s, why: "only" as const }));
  const by = (better: (a: Suggestion, b: Suggestion) => boolean, among = distinct) => among.reduce<Suggestion | null>((best, s) => (!best || better(s, best) ? s : best), null);
  const out: Suggestion[] = [];
  const add = (s: Suggestion | null, why: SuggestionWhy) => { if (s && !out.some((o) => same(o, s))) out.push({ ...s, why }); };
  add(by((a, b) => a.price < b.price), "cheapest");
  add(by((a, b) => a.carries > b.carries + 1e-9 || (Math.abs(a.carries - b.carries) <= 1e-9 && a.price < b.price)), "most");
  add(by((a, b) => a.price < b.price, distinct.filter((s) => !s.pump)), "no-pump");
  // ONE WAY BEST AT ALL THREE is still not the only way: the shortest of the rest is offered beside it.
  if (out.length < 3) add(by((a, b) => a.fresh < b.fresh, distinct.filter((s) => !out.some((o) => same(o, s)))), "shortest");
  return out.slice(0, 3);
}

/**
 * WATER MAINS to a thirsty inlet: from the water nearest it, from the
 * highest water in reach, and from the open ends of mains already laid —
 * each with a pump where it needs one, and without where it can do without.
 */
export function suggestMains(g: Grid, field: WaterField | null, inlet: Cell, wet: (x: number, y: number) => boolean): Suggestion[] {
  const points = connectPoints(g, "main", wet, inlet);
  const near = (list: ConnectPoint[]) => list.filter((p) => dist(g, p.cell, inlet) <= REACH).sort((a, b) => dist(g, a.cell, inlet) - dist(g, b.cell, inlet));
  const banks = near(points.filter((p) => p.kind === "water")), ends = near(points.filter((p) => p.kind === "main-end")).slice(0, 2);
  // THE HIGHEST WATER: where a bank's own ground stands highest, the water beside it does too, near enough.
  const high = [...banks].sort((a, b) => g.height[b.cell] - g.height[a.cell]).slice(0, NEAREST);
  const from = [...new Map([...banks.slice(0, NEAREST), ...high, ...ends].map((p) => [p.cell, p])).values()];
  // WHICH WATER a bank is on: every wet tile joined to the one beside it is one water.
  const body = new Int32Array(g.w * g.h).fill(-1);
  const waterOf = (bank: number): number => {
    const b = at(g, bank), side = [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([dx, dy]) => ({ x: b.x + dx, y: b.y + dy })).find((c) => c.x >= 0 && c.y >= 0 && c.x < g.w && c.y < g.h && wet(c.x, c.y));
    if (!side) return -1;
    const start = idx(g, side.x, side.y);
    if (body[start] >= 0) return body[start];
    const queue = [start];
    body[start] = start;
    for (let q = 0; q < queue.length; q++) {
      const c = at(g, queue[q]);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const x = c.x + dx, y = c.y + dy;
        if (x < 0 || y < 0 || x >= g.w || y >= g.h || !wet(x, y) || body[idx(g, x, y)] >= 0) continue;
        body[idx(g, x, y)] = start;
        queue.push(idx(g, x, y));
      }
    }
    return start;
  };
  const found: Suggestion[] = [];
  for (const p of from) {
    const source = p.kind === "water" ? `water:${waterOf(p.cell)}` : `end:${p.cell}`;
    const route = routeMain(g, at(g, p.cell), inlet, wet);
    if (!route || route.length < 2) continue;
    // As it would be laid by hand: with a pump if it needs one; and, told not to, without.
    for (const noPump of [false, true]) {
      const stroke: Stroke = { tool: "pipe", brush: "line", anchor: route[0], head: route[route.length - 1], path: route, ...(noPump ? { noPump: true } : {}) };
      const m = mainStroke(g, field, stroke, wet);
      if (m.refused || !m.look || !m.complete || (noPump && m.pump)) continue;
      found.push({ why: "cheapest", kind: "main", stroke, route, fresh: m.fresh, price: m.price.total, pump: m.pump, carries: m.look.flow, need: m.need, from: source });
      // Gravity carried it: asking again without a pump is the same main.
      if (!m.pump) break;
    }
  }
  return pick(found);
}

/** SEWER CONNECTIONS from a slop port: into the live manholes it can reach, off the roads. */
export function suggestConnections(g: Grid, port: Cell, wet: (x: number, y: number) => boolean): Suggestion[] {
  const manholes = connectPoints(g, "connection", wet, port).filter((p) => p.kind === "manhole" && dist(g, p.cell, port) <= REACH)
    .sort((a, b) => dist(g, a.cell, port) - dist(g, b.cell, port)).slice(0, NEAREST);
  if (!manholes.length) return [];
  const s = solveSewers(g);
  /** Whether a lift station stands between a manhole and where its sewer ends. */
  const lifted = (cell: number) => { for (let c = cell, n = 0; c >= 0 && n < g.w * g.h; c = s.down[c], n++) if (s.kind[c] === SEWER_KIND.lift) return true; return false; };
  const found: Suggestion[] = [];
  for (const p of manholes) {
    const route = routeMain(g, port, at(g, p.cell), wet, true);
    if (!route) continue;
    const plan = planLateral(g, route, wet);
    if ("refused" in plan || !plan.exit) continue;
    const stroke: Stroke = { tool: "sewer", brush: "line", lateral: true, anchor: plan.cells[0], head: plan.cells[plan.cells.length - 1], path: plan.cells.map((c) => ({ x: c.x, y: c.y })) };
    found.push({
      why: "cheapest", kind: "connection", stroke, route: stroke.path!.map((c) => ({ ...c })), fresh: plan.fresh, price: pipeCost(plan.fresh).toNumber(),
      pump: lifted(p.cell), carries: s.capacity[p.cell] ?? 0, need: null, from: `manhole:${p.cell}`,
    });
  }
  return pick(found);
}

/** Which kinds of suggestion a map has opened. */
export type Opened = { water: boolean; sewer: boolean };
const opened = new WeakMap<Grid, Opened>();
export const suggestOpen = (g: Grid): Opened => opened.get(g) ?? { water: false, sewer: false };
/** A map's as a file had it. @see serializeWorld */
export const setSuggestOpen = (g: Grid, o: Partial<Opened>) => { opened.set(g, { water: !!o.water, sewer: !!o.sewer }); };

/**
 * LOOK FOR THE FIRST DONE BY HAND: a water main of the player's own that is
 * carrying, a connection of theirs that is draining. Once a kind is open it
 * stays open. Run with the pipes, after their reports are in. @see stepPipes
 */
export function noteLaidByHand(g: Grid): void {
  const was = suggestOpen(g);
  if (was.water && was.sewer) return;
  const reports = mainReportsFor(g);
  let { water, sewer } = was;
  for (const net of findMains(g).list) {
    if (net.ai) continue;
    const r = reports.get(net.cells[0]);
    if (!r || r.state !== "flowing") continue;
    // A connection into a manhole drains under the ground: what its manhole took in says it is.
    const node = r.sewer?.node;
    if (net.sewer) { if (r.flow > 0 || (node !== undefined && (nodeIntake(g).get(node) ?? 0) > 0)) sewer = true; }
    else if (r.flow > 0) water = true;
  }
  if (water !== was.water || sewer !== was.sewer) opened.set(g, { water, sewer });
}

/**
 * WHAT TO OFFER where a stroke has just been started: at a free inlet of a
 * building that drinks, mains; at a free slop port, connections — if that
 * kind is open on this map. None anywhere else.
 */
export function suggestionsAt(g: Grid, field: WaterField | null, start: Cell, wet: (x: number, y: number) => boolean): Suggestion[] {
  const open = suggestOpen(g);
  if (!open.water && !open.sewer) return [];
  const here = idx(g, start.x, start.y);
  if (open.water && connectPoints(g, "main", wet).some((p) => p.cell === here && p.kind === "inlet")) return suggestMains(g, field, start, wet);
  if (open.sewer && connectPoints(g, "connection", wet).some((p) => p.cell === here && p.kind === "slop-port")) return suggestConnections(g, start, wet);
  return [];
}

const kept = new WeakMap<Grid, { key: string; out: Suggestion[] }>();
/** `suggestionsAt`, kept till the map or what is open changes: for the card and the ghosts, which both ask. */
export function suggestionsKept(g: Grid, field: WaterField | null, start: Cell, wet: (x: number, y: number) => boolean): Suggestion[] {
  const o = suggestOpen(g), key = `${g.rev}|${start.x},${start.y}|${o.water ? 1 : 0}${o.sewer ? 1 : 0}`;
  const was = kept.get(g);
  if (was && was.key === key) return was.out;
  const out = suggestionsAt(g, field, start, wet);
  kept.set(g, { key, out });
  return out;
}
