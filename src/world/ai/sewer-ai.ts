/**
 * World v2 — THE AI SEES TO ITS SLOP, under the ground as the player must:
 *
 *  - a vibe workplace with a live manhole in reach gets a LATERAL to it;
 *  - one with none gets a TRUNK from beside its port to the network — onto a
 *    live sewer, else to a processor's inlet, else to water downstream of the
 *    town — the route falling with the ground where it can, so the solve has
 *    as few lift stations to put in as may be; the lateral follows next step;
 *  - the block it means to build on gets a trunk into it first, so its vibe
 *    offices have a manhole to be placed by (`needsSewer`);
 *  - and another refinery when there is more slop than the refineries
 *    standing can take.
 *
 * Laid and bought through the player's own actions. AI mode.
 * @see game/slop, game/processors, plans/underground-sewers.md §9
 */
import { boreCost, buildCost, pipeCost } from "../../game/build-cost";
import { PROCESS_RATE, processorKind } from "../../game/processors";
import { slopMaking } from "../../game/slop";
import { featureGateOpen } from "../../game/projects";
import { getWater, mainWet } from "../../state/world.store";
import { upstreamOfTown } from "../water/pollution";
import { WORKPLACES } from "../agents/commute";
import { MAIN_BORE, SEWER_BORE, VOID, idx, inBounds, structureAt, type Grid, type Structure } from "../grid";
import { hasMain, routeMain } from "../water/mains";
import { portTileSet, portsOf } from "../water/ports";
import { planLateral, planSewer } from "../sewers/lay";
import { LATERAL_REACH, hasSewer, solveSewers } from "../sewers/solve";
import { lateralsOf, sewerReportsFor } from "../sewers/flow";
import { lateralGround, lateralReach } from "../sewers/reach";

type Cell = { x: number; y: number };

/** The furthest, in tiles, it will lay a trunk. */
export const SEWER_REACH = 60;
/** What a step uphill, toward the exit, costs the route in tiles: slop has to be lifted over it. */
const CLIMB = 3;
const STEPS = [[1, 0], [-1, 0], [0, 1], [0, -1]] as const;
/** The most places a trunk is tried from for one tank: each try routes across the map. */
const TRUNK_STARTS = 8;

/** A sewer the AI wants: a lateral or a trunk, its tiles in order, its price, and what to remember it failed by. */
export type SewerJob = { kind: "lateral" | "trunk"; cells: Cell[]; price: number; key: string };

/** Each vibe workplace with its slop port free and no lateral at it. */
function unsewered(g: Grid): { s: Structure; port: Cell }[] {
  const out: { s: Structure; port: Cell }[] = [];
  for (const s of g.structures.values()) {
    if (s.build || !WORKPLACES.vibe_coder.includes(s.def)) continue;
    const p = portsOf(g, s).find((q) => q.port.fluid === "slop" && q.port.dir === "out");
    if (!p || structureAt(g, p.x, p.y) >= 0 || hasMain(g, p.i)) continue;
    out.push({ s, port: { x: p.x, y: p.y } });
  }
  return out;
}

/** The live manholes a connection can come down into — on networks with an exit, and not set in a road — by cell. @see lateralReach */
function liveNodes(g: Grid): number[] {
  const s = solveSewers(g);
  return s.nets.filter((n) => n.exits.length).flatMap((n) => n.nodes).filter((i) => g.paved[i] === VOID);
}

/**
 * A TRUNK'S ROUTE from a tile to where its slop can go: onto a live sewer
 * (joining it), else to a processor's inlet, else beside water none of the
 * town is `upstream` of — or, with none such in reach, beside any. Round
 * buildings, never into the water, never through another sewer but the one
 * it joins; each step up toward the exit dearer, so it follows the ground's
 * fall. Null with none. Pure.
 */
export function trunkRoute(g: Grid, from: Cell, wet: (x: number, y: number) => boolean, upstream: ReadonlySet<number> = new Set()): Cell[] | null {
  if (!inBounds(g, from.x, from.y)) return null;
  const s = solveSewers(g);
  const inlets = new Set<number>();
  for (const b of g.structures.values()) {
    if (!processorKind(b.def) || b.build) continue;
    for (const p of portsOf(g, b)) if (p.port.fluid === "slop" && p.port.dir === "in" && structureAt(g, p.x, p.y) < 0 && !hasSewer(g, p.i)) inlets.add(p.i);
  }
  const n = g.w * g.h, start = idx(g, from.x, from.y);
  const cost = new Float64Array(n).fill(Infinity), steps = new Int32Array(n), prev = new Int32Array(n).fill(-1);
  const heap: { c: number; i: number }[] = [];
  const push = (e: { c: number; i: number }) => {
    heap.push(e);
    for (let k = heap.length - 1; k > 0;) { const p = (k - 1) >> 1; if (heap[p].c <= heap[k].c) break; [heap[p], heap[k]] = [heap[k], heap[p]]; k = p; }
  };
  const pop = () => {
    const top = heap[0], last = heap.pop()!;
    if (heap.length) {
      heap[0] = last;
      for (let k = 0; ;) {
        const l = 2 * k + 1, r = l + 1;
        let m = k;
        if (l < heap.length && heap[l].c < heap[m].c) m = l;
        if (r < heap.length && heap[r].c < heap[m].c) m = r;
        if (m === k) break;
        [heap[m], heap[k]] = [heap[k], heap[m]]; k = m;
      }
    }
    return top;
  };
  cost[start] = 0;
  push({ c: 0, i: start });
  // The best of each kind of end, by what it costs to reach.
  let joined = -1, inlet = -1, clean = -1, water = -1;
  while (heap.length) {
    const { c, i } = pop();
    if (c > cost[i] || steps[i] > SEWER_REACH) continue;
    if (joined >= 0) break;
    const x = i % g.w, y = (i / g.w) | 0;
    if (i !== start) {
      if (hasSewer(g, i)) { if (s.drains[i]) joined = i; continue; }
      if (inlet < 0 && inlets.has(i)) inlet = i;
      const by = STEPS.filter(([dx, dy]) => inBounds(g, x + dx, y + dy) && wet(x + dx, y + dy));
      if (by.length && water < 0) water = i;
      if (by.length && clean < 0 && by.every(([dx, dy]) => !upstream.has(idx(g, x + dx, y + dy)))) clean = i;
    }
    for (const [dx, dy] of STEPS) {
      const nx = x + dx, ny = y + dy;
      if (!inBounds(g, nx, ny) || structureAt(g, nx, ny) >= 0 || wet(nx, ny)) continue;
      const j = idx(g, nx, ny);
      const nc = c + 1 + CLIMB * Math.max(0, g.height[j] - g.height[i]);
      if (nc < cost[j]) { cost[j] = nc; steps[j] = steps[i] + 1; prev[j] = i; push({ c: nc, i: j }); }
    }
  }
  const end = joined >= 0 ? joined : inlet >= 0 ? inlet : clean >= 0 ? clean : water;
  if (end < 0 || end === start) return null;
  const path: Cell[] = [];
  for (let k = end; k !== -1; k = prev[k]) path.push({ x: k % g.w, y: (k / g.w) | 0 });
  return path.reverse();
}

/** A trunk from a tile, planned and priced as the Sewer tool would; null if it can't go or the ground won't have it. */
function trunkFrom(g: Grid, from: Cell, key: string): SewerJob | null {
  const water = getWater(), wet = mainWet(g), upstream = water ? upstreamOfTown(water, g) : new Set<number>();
  const cells = trunkRoute(g, from, wet, upstream);
  if (!cells || cells.length < 2) return null;
  const plan = planSewer(g, cells, wet, { unit: pipeCost(1).toNumber(), liftPrice: buildCost("pump")?.toNumber() ?? 0, ai: true });
  if ("refused" in plan || plan.problem || !plan.exit) return null;
  return { kind: "trunk", cells, price: plan.price, key };
}

/**
 * The sewer most wanted for a workplace with slop: a lateral to a live manhole in reach, else a trunk to the network.
 * Null with no slop or no way. `skip` is the keys of those that would not go down: the next is offered in their place.
 */
export function neededSewer(g: Grid, skip?: ReadonlySet<string>): SewerJob | null {
  if (slopMaking() <= 0) return null;
  const wet = mainWet(g), nodes = liveNodes(g);
  // No manhole on the tile a building's slop comes out at: a neighbour's connection cannot end there, and it went without. @see portTileSet
  const ports = portTileSet(g);
  for (const { s, port } of unsewered(g)) {
    // A LATERAL, to the nearest live manhole it reaches.
    const near = nodes
      .map((i) => ({ i, d: Math.abs((i % g.w) - port.x) + Math.abs(((i / g.w) | 0) - port.y) }))
      .filter((n) => n.d <= LATERAL_REACH).sort((a, b) => a.d - b.d);
    for (const { i, d } of near) {
      // (A manhole beside the port is the two tiles themselves: routed, it came back as one, which is no connection,
      // and an office with a sewer at its door was never joined to it.)
      const node = { x: i % g.w, y: (i / g.w) | 0 };
      const route = d === 1 ? [port, node] : routeMain(g, port, node, wet, true);
      const plan = route && planLateral(g, route, wet);
      if (route && plan && !("refused" in plan) && !skip?.has(`lateral:${s.id}`)) return { kind: "lateral", cells: route, price: pipeCost(plan.fresh).toNumber(), key: `lateral:${s.id}` };
    }
    // Else A TRUNK from where a connection from its port could come down: beside the port first, then further over open
    // ground, as far as a connection reaches. (Beside it only, an office hemmed in by its neighbours had no sewer at all.)
    if (skip?.has(`trunk:${s.id}`) || !lateralGround(g, idx(g, port.x, port.y))) continue;
    const from = idx(g, port.x, port.y), steps = new Map<number, number>([[from, 0]]), queue = [from];
    let tried = 0;
    for (let q = 0; q < queue.length && tried < TRUNK_STARTS; q++) {
      const i = queue[q], d = steps.get(i)!;
      if (d >= LATERAL_REACH - 1) continue;
      for (const [dx, dy] of STEPS) {
        const c = { x: (i % g.w) + dx, y: ((i / g.w) | 0) + dy };
        // Its manhole is where the connection will come down: on open ground, never in the street.
        if (!inBounds(g, c.x, c.y) || steps.has(idx(g, c.x, c.y)) || !lateralGround(g, idx(g, c.x, c.y)) || hasSewer(g, idx(g, c.x, c.y))) continue;
        steps.set(idx(g, c.x, c.y), d + 1);
        queue.push(idx(g, c.x, c.y));
        if (ports.has(idx(g, c.x, c.y))) continue;
        if (tried++ >= TRUNK_STARTS) break;
        const job = trunkFrom(g, c, `trunk:${s.id}`);
        if (job) return job;
      }
    }
  }
  return null;
}

/**
 * A TRUNK INTO A BLOCK the AI means to build on, when nothing live reaches
 * it: from the open tile nearest its middle to the network. Null when one
 * reaches it already, or there is no way.
 */
export function trunkInto(g: Grid, box: { x0: number; y0: number; x1: number; y1: number }): SewerJob | null {
  const cx = Math.round((box.x0 + box.x1) / 2), cy = Math.round((box.y0 + box.y1) / 2);
  // Reached already, if a connection could be laid to a live manhole from some open tile of it. @see lateralReach
  const reach = lateralReach(g);
  for (let y = box.y0; y <= box.y1; y++) for (let x = box.x0; x <= box.x1; x++) if (inBounds(g, x, y) && reach[idx(g, x, y)] >= 0) return null;
  const wet = mainWet(g), ports = portTileSet(g);
  let best: Cell | null = null, bestD = Infinity;
  for (let y = box.y0; y <= box.y1; y++) {
    for (let x = box.x0; x <= box.x1; x++) {
      if (!inBounds(g, x, y) || structureAt(g, x, y) >= 0 || wet(x, y) || hasSewer(g, idx(g, x, y)) || g.paved[idx(g, x, y)] !== VOID || ports.has(idx(g, x, y))) continue;
      const d = Math.abs(x - cx) + Math.abs(y - cy);
      if (d < bestD) { bestD = d; best = { x, y }; }
    }
  }
  return best && trunkFrom(g, best, `block:${box.x0},${box.y0}`);
}

/** Whether there is more slop made than the refineries standing can take, and another can be bought. */
export function wantsRefinery(g: Grid): { price: number } | null {
  if (!featureGateOpen("refinery")) return null;
  let n = 0;
  for (const s of g.structures.values()) if (s.def === "refinery") n++;
  if (slopMaking() <= n * PROCESS_RATE) return null;
  const price = buildCost("refinery")?.toNumber();
  return price === undefined ? null : { price };
}

/** What a spilling tank waits on when no sewer of the AI's would mend it, said as the thing awaited. */
export const NO_WAY = "a way to a sewer, and none was found";

/**
 * WHAT A SPILLING TANK WAITS ON, in words: its port built over, no way to a
 * sewer, or — connected, and spilling all the same — what is wrong with the
 * sewer it is on. `rate` is what it makes a second. A tank that spilled with
 * a connection had no job and no word in the queue, for half an hour of one
 * play-through.
 */
export function spillNeed(g: Grid, s: Structure, rate: number): string {
  const p = portsOf(g, s).find((q) => q.port.fluid === "slop" && q.port.dir === "out");
  if (!p || structureAt(g, p.x, p.y) >= 0) return "its slop port cleared";
  if (!hasMain(g, p.i)) return NO_WAY;
  const l = lateralsOf(g).find((x) => x.sources.includes(s.id));
  if (!l || l.node === null) return "a manhole for its connection";
  const sol = solveSewers(g), node = l.node;
  const net = sol.nets.find((n) => n.cells.includes(node));
  const state = net && sewerReportsFor(g).get(net.id)?.state;
  if (!net || !sol.drains[node] || state === "no-exit") return "an exit for its sewer";
  if (state === "unpaid") return "its lift station paid for";
  if (state === "backed-up") return "its sewer cleared";
  if (state === "surcharged") return net.cells.some((i) => !(g.sewer[i] & SEWER_BORE)) ? "a wider sewer" : "a second sewer";
  if (l.capacity < rate && l.net.cells.some((i) => !(g.main[i] & MAIN_BORE))) return "a wider connection";
  return "its sewer to catch up";
}

/** A widening that would mend a spilling tank: of its sewer, or of its connection; where, and the price. */
export type Widening = { what: "sewer" | "connection"; at: Cell; price: number };

/**
 * THE WIDENING A SPILLING TANK WANTS, if that is what it wants: the sewer it
 * is on over full with tiles of it still narrow, or its own connection
 * carrying less than it makes. Null for anything else. @see spillNeed
 */
export function spillMend(g: Grid, s: Structure, rate: number): Widening | null {
  const on = spillNeed(g, s, rate);
  if (on !== "a wider sewer" && on !== "a wider connection") return null;
  const l = lateralsOf(g).find((x) => x.sources.includes(s.id))!;
  const cells = on === "a wider sewer" ? solveSewers(g).nets.find((n) => n.cells.includes(l.node!))!.cells : l.net.cells;
  const narrow = cells.filter((i) => !((on === "a wider sewer" ? g.sewer[i] & SEWER_BORE : g.main[i] & MAIN_BORE))).length;
  const i = on === "a wider sewer" ? l.node! : l.net.cells[0];
  return { what: on === "a wider sewer" ? "sewer" : "connection", at: { x: i % g.w, y: (i / g.w) | 0 }, price: boreCost(narrow).toNumber() };
}
