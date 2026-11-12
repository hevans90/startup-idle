/**
 * World v2 — SLOP THROUGH THE SEWERS UNDER THE GROUND, a frame at a time.
 *
 * A workplace's tank drains along its LATERAL — the short brown tube above
 * ground from its slop port to a manhole — as much as the lateral carries,
 * if the manhole's network has an exit. From each manhole the slop runs
 * down the trunk toward its exit through the pipe graph's nodes, EACH OF
 * WHICH HOLDS SLOP: a run passes on what it carries (`SewerSolve.capacity`)
 * and no more than the node below has room for. So a sewer takes a moment
 * to carry, stands as full as it is loaded, and a choke is felt up the pipe
 * — the nodes above fill one after the next until a manhole's shaft is full
 * and it SURCHARGES, spilling in the street. At the exits it feeds the
 * processors first, as much as each takes, then pours out of the outfalls.
 *
 * Lift stations run, and are paid for, while there is slop in the network;
 * unpaid, they stop, and what reaches them backs up behind. A backed-up
 * manhole (the event) passes nothing on. Live state; not saved.
 * @see solveSewers, pipeGraph, stepSlop, plans/pipe-network.md §2
 */
import { sewerFlow } from "../../game/mains";
import { SEWER_BORE, SEWER_FIT, type Grid } from "../grid";
import { pipeGraph, type SewerNet } from "../pipes/graph";
import type { SewerReport } from "../pipes/report";
import { sewerSources, type MainNet } from "../water/mains";
import { portsAt } from "../water/ports";
import { SEWER_KIND, solveSewers } from "./solve";

/** A lateral: an above-ground sewer from workplaces' slop ports to a manhole. */
export type Lateral = { net: MainNet; sources: number[]; node: number | null; capacity: number };

export type { SewerReport, SewerState } from "../pipes/report";

/** The laterals on a map: each above-ground sewer that reaches a manhole, or none. */
export function lateralsOf(g: Grid): Lateral[] {
  // Which they are and where each comes down is the graph's; what feeds each is asked of the buildings as they stand.
  return pipeGraph(g).laterals.map((l) => ({ net: l.net, sources: sewerSources(g, l.net), node: l.node, capacity: sewerFlow(l.bore) }));
}

/** What the frame needs from the world round it. */
export type SewerHooks = {
  /** Pay for a lift station's `seconds` of running; whether it was. */
  pay: (seconds: number) => boolean;
  /** Room a processor has left this frame, and what it takes of it. */
  room: (building: number) => number;
  take: (building: number, amount: number) => void;
  /** Put slop out at a tile: into the water, or onto the street. */
  release: (x: number, y: number, amount: number) => void;
  /** A manhole backed up, passing nothing on: the event's. */
  backedUp: number | null;
};

let reports = new Map<number, SewerReport>();
let reportGrid: Grid | null = null;
/** Each network's report from the last frame, by its id in the solve. */
export const sewerReportsFor = (g: Grid): ReadonlyMap<number, SewerReport> => (g === reportGrid ? reports : new Map());
/** Slop a second each manhole took in last frame, by cell: what the backup event chokes the busiest of. */
let intake = new Map<number, number>();
export const nodeIntake = (g: Grid): ReadonlyMap<number, number> => (g === reportGrid ? intake : new Map());

/** Slop a tile of trunk holds, a bore, full. Sets how long slop takes to come down a sewer and how soon a choked one backs up. */
export const SEWER_HOLDS = 0.25;
/** Slop a manhole's shaft holds over its pipe before it comes up in the street. */
export const SHAFT_HOLDS = 0.5;

/** One trunk network made ready to run: its nodes from the top down, each with the one way down it has. */
type Trunk = {
  net: SewerNet;
  /** Each node's tile, what its pipe holds full, whether it is a manhole, and its exit fitting (0 for none). */
  cells: number[];
  full: Float64Array;
  manhole: Uint8Array;
  exit: Uint8Array;
  /** The node each drains into (−1 for an exit, or one that drains nowhere), what that run carries a second, and whether a lift station is on it. */
  down: Int32Array;
  carries: Float64Array;
  lifted: Uint8Array;
  /** Its nodes from the furthest up to the exits. */
  order: number[];
  lifts: number[];
  /** What it could carry at its narrowest; whether every tile of it is widened. */
  least: number;
  wide: boolean;
};

const trunksFor = new WeakMap<Grid, { rev: number; trunks: Trunk[]; held: Map<number, number> }>();

/**
 * Every trunk network as nodes with storage, off the pipe graph and the
 * solve: kept till the map changes, the slop each node's tile held carried
 * over. What stood in a tile that is no longer a node is handed back to be
 * put out there. @see pipeGraph, solveSewers
 */
function trunksOf(g: Grid, release: (x: number, y: number, amount: number) => void) {
  const was = trunksFor.get(g);
  if (was && was.rev === g.rev) return was;
  const graph = pipeGraph(g), s = solveSewers(g);
  const trunks: Trunk[] = [];
  const kept = new Map<number, number>();
  for (const net of s.nets) {
    const ids = graph.nodes.filter((n) => n.layer === "trunk" && s.of[n.cell] === net.id && s.drains[n.cell]).map((n) => n.id);
    const at = new Map(ids.map((id, k) => [id, k]));
    const n = ids.length;
    const t: Trunk = {
      net, cells: ids.map((id) => graph.nodes[id].cell), full: new Float64Array(n), manhole: new Uint8Array(n), exit: new Uint8Array(n),
      down: new Int32Array(n).fill(-1), carries: new Float64Array(n), lifted: new Uint8Array(n), order: [],
      lifts: net.cells.filter((i) => s.kind[i] === SEWER_KIND.lift), least: Infinity, wide: net.cells.every((i) => (g.sewer[i] & SEWER_BORE) !== 0),
    };
    for (const i of net.cells) if (s.drains[i] && s.down[i] >= 0) t.least = Math.min(t.least, s.capacity[i]);
    ids.forEach((id, k) => {
      const fit = g.sewerFit[t.cells[k]];
      t.manhole[k] = fit === SEWER_FIT.node ? 1 : 0;
      t.exit[k] = fit === SEWER_FIT.outfall || fit === SEWER_FIT.inlet ? fit : 0;
      for (const l of graph.nodes[id].links) {
        const link = graph.links[l];
        if (link.kind !== "trunk" || !at.has(link.a) || !at.has(link.b)) continue;
        t.full[k] += (SEWER_HOLDS * link.length * link.bore) / 2;
        // THE WAY DOWN is the solve's: this node's, if its tile falls into this run.
        const cells = link.a === id ? link.cells : [...link.cells].reverse();
        if (cells.length < 2 || s.down[cells[0]] !== cells[1]) continue;
        let carries = Infinity, lifted = 0;
        for (const c of cells.slice(0, -1)) { carries = Math.min(carries, s.capacity[c]); if (s.kind[c] === SEWER_KIND.lift) lifted = 1; }
        t.down[k] = at.get(link.a === id ? link.b : link.a)!;
        t.carries[k] = carries;
        t.lifted[k] = lifted;
      }
      t.full[k] = Math.max(t.full[k], SEWER_HOLDS / 2);
    });
    // From the furthest up to the exits: by how many runs lie between each and where it ends.
    const far = new Int32Array(n).fill(-1);
    const reach = (k: number): number => (far[k] >= 0 ? far[k] : (far[k] = t.down[k] >= 0 ? reach(t.down[k]) + 1 : 0));
    t.order = ids.map((_, k) => k).sort((a, b) => reach(b) - reach(a));
    for (const c of t.cells) if (was?.held.has(c)) kept.set(c, was.held.get(c)!);
    trunks.push(t);
  }
  if (was) for (const [c, v] of was.held) if (!kept.has(c) && v > 0) release(c % g.w, (c / g.w) | 0, v);
  const out = { rev: g.rev, trunks, held: kept };
  trunksFor.set(g, out);
  return out;
}

/** All the slop standing in a map's trunks, for sums that must not lose any. */
export function slopInSewers(g: Grid): number {
  let n = 0;
  for (const v of trunksFor.get(g)?.held.values() ?? []) n += v;
  return n;
}

/** How full the trunk stands under a tile that is one of its nodes, nought to one; null where there is none. For the tubes. */
export function sewerFillAt(g: Grid, cell: number): number | null {
  const all = trunksFor.get(g);
  if (!all) return null;
  for (const t of all.trunks) { const k = t.cells.indexOf(cell); if (k >= 0) return Math.min(1, (all.held.get(cell) ?? 0) / t.full[k]); }
  return null;
}

/**
 * ONE FRAME OF THE SEWERS: the tanks drained along their laterals into the
 * manholes, the slop moved down each trunk a run at a time, and what cannot
 * get on spilled at a manhole. `tanks` are the workplaces', by id.
 *
 * EVERY NODE HOLDS SLOP, so a sewer takes time to carry and to fail. A run
 * passes on what it carries and no more than the node below has room for and
 * will itself pass on — so a choke is felt up the pipe: the nodes above it
 * fill, one after the next, until a manhole's shaft is full and it comes up
 * in the street there. A manhole takes all that is sent it and spills what
 * it cannot hold; a plain joint takes only what it has room for.
 */
export function stepSewers(g: Grid, tanks: ReadonlyMap<number, { level: number }>, dt: number, hooks: SewerHooks): void {
  // IN STEPS OF ITS OWN: a long frame's slop landing on a manhole all at once would be over its shaft before any of it moved on.
  const steps = Math.max(1, Math.ceil(dt / SEWER_STEP - 1e-9)), h = dt / steps;
  if (steps === 1) { frame(g, tanks, dt, hooks); return; }
  const sum = new Map<number, { inflow: number; delivered: number; spilled: number; worst: SewerReport["state"] }>();
  const taken = new Map<number, number>();
  const RANK: Record<SewerReport["state"], number> = { "no-exit": 0, idle: 1, flowing: 2, surcharged: 3, unpaid: 4, "backed-up": 5 };
  for (let k = 0; k < steps; k++) {
    frame(g, tanks, h, hooks);
    for (const [id, r] of reports) {
      const t = sum.get(id) ?? { inflow: 0, delivered: 0, spilled: 0, worst: r.state };
      t.inflow += r.trunk.inflow / steps; t.delivered += r.trunk.delivered / steps; t.spilled += r.trunk.spilled / steps;
      if (RANK[r.state] > RANK[t.worst]) t.worst = r.state;
      sum.set(id, t);
    }
    for (const [cell, q] of intake) taken.set(cell, (taken.get(cell) ?? 0) + q);
  }
  // What the frame did, over the whole of it.
  for (const [id, r] of reports) {
    const t = sum.get(id)!;
    r.trunk.inflow = t.inflow; r.trunk.delivered = t.delivered; r.trunk.spilled = t.spilled; r.flow = t.delivered; r.state = t.worst;
  }
  intake = taken;
}

/** The sewers' own step, seconds: a frame longer than this is cut into them. */
export const SEWER_STEP = 1 / 30;

function frame(g: Grid, tanks: ReadonlyMap<number, { level: number }>, dt: number, hooks: SewerHooks): void {
  const s = solveSewers(g);
  const all = trunksOf(g, hooks.release), held = all.held;
  const out = new Map<number, SewerReport>();
  const into = new Map<number, number>();
  for (const net of s.nets) {
    const t = all.trunks.find((x) => x.net === net);
    out.set(net.id, {
      state: net.exits.length ? "idle" : "no-exit", head: 0, capacity: t && Number.isFinite(t.least) ? t.least : 0, flow: 0,
      length: net.cells.length, bore: t?.wide ? 2 : 1, outlets: [], intakes: [],
      trunk: { inflow: 0, delivered: 0, spilled: 0, lifts: t?.lifts ?? [] },
    });
  }
  reports = out;
  reportGrid = g;
  intake = into;
  if (dt <= 0) return;

  // DOWN THE LATERALS, into the manholes of networks with somewhere to go.
  for (const l of lateralsOf(g)) {
    if (l.node === null || !s.drains[l.node]) continue;
    const from = l.sources.map((id) => tanks.get(id)).filter((t): t is { level: number } => !!t);
    const there = from.reduce((n, t) => n + t.level, 0);
    const take = Math.min(there, l.capacity * dt);
    if (take <= 0) continue;
    for (const t of from) t.level -= take * (t.level / there);
    into.set(l.node, (into.get(l.node) ?? 0) + take);
    held.set(l.node, (held.get(l.node) ?? 0) + take);
  }

  for (const t of all.trunks) {
    const net = t.net, r = out.get(net.id)!, n = t.cells.length;
    let inflow = 0, standing = 0;
    for (const i of net.nodes) inflow += into.get(i) ?? 0;
    for (const c of t.cells) standing += held.get(c) ?? 0;
    r.trunk.inflow = inflow / dt;
    if (!net.exits.length || standing <= 1e-12) continue;
    // ITS LIFTS, paid for while there is slop in it; one unpaid stops them all.
    let lifting = true;
    for (let k = 0; k < t.lifts.length && lifting; k++) lifting = hooks.pay(dt);
    const has = t.cells.map((c) => held.get(c) ?? 0);
    const outfalls = net.exits.filter((e) => g.sewerFit[e] === SEWER_FIT.outfall);
    // WHAT A RUN PASSES ON: what it carries when full, and less in proportion while its node is part full —
    // so a sewer stands as full as it is loaded, and slop takes a moment to come down it.
    const carries = (k: number) => (t.cells[k] === hooks.backedUp ? 0 : t.lifted[k] && !lifting ? 0
      : Math.min(has[k], t.carries[k] * dt * Math.min(1, has[k] / t.full[k])));
    // WHAT EACH CAN TAKE this frame, from the exits up: its room, and what it will pass on.
    const takes = new Float64Array(n), passes = new Float64Array(n);
    for (let j = n - 1; j >= 0; j--) {
      const k = t.order[j];
      if (t.exit[k] === SEWER_FIT.outfall) { takes[k] = Infinity; continue; }
      if (t.exit[k] === SEWER_FIT.inlet) {
        // A processor takes what it has room for; with an outfall on the network the rest goes out there.
        const p = portsAt(g, t.cells[k], "slop", "in")[0];
        takes[k] = outfalls.length ? Infinity : Math.max(0, t.full[k] - has[k]) + (p ? hooks.room(p.building) : 0);
        continue;
      }
      passes[k] = t.down[k] >= 0 ? Math.min(carries(k), takes[t.down[k]]) : 0;
      takes[k] = t.manhole[k] ? Infinity : Math.max(0, t.full[k] - has[k]) + passes[k];
    }
    // THEN EACH SENDS ON what it was reckoned to, of what it had when the frame began: a run at a time.
    const sends = new Float64Array(n);
    for (const k of t.order) {
      const d = t.down[k];
      if (d < 0) continue;
      sends[k] = Math.min(passes[k], takes[d]);
      takes[d] -= sends[k];
    }
    for (let k = 0; k < n; k++) if (sends[k] > 0) { has[k] -= sends[k]; has[t.down[k]] += sends[k]; }
    // AT THE EXITS: a processor first, as much as it takes; an outfall, all of it.
    let spilt = 0, over = 0;
    for (let k = 0; k < n; k++) {
      if (!t.exit[k] || has[k] <= 0) continue;
      const cell = t.cells[k];
      if (t.exit[k] === SEWER_FIT.inlet) {
        const p = portsAt(g, cell, "slop", "in")[0];
        const got = p ? Math.min(has[k], hooks.room(p.building)) : 0;
        if (got > 0) { hooks.take(p!.building, got); has[k] -= got; r.trunk.delivered += got / dt; }
        if (outfalls.length) { over += has[k]; has[k] = 0; }
      } else {
        hooks.release(cell % g.w, (cell / g.w) | 0, has[k]);
        r.trunk.delivered += has[k] / dt;
        has[k] = 0;
      }
    }
    if (over > 0) {
      for (const e of outfalls) hooks.release(e % g.w, (e / g.w) | 0, over / outfalls.length);
      r.trunk.delivered += over / dt;
    }
    // WHAT A NODE CANNOT HOLD comes up: a manhole's over its shaft, any other's over its pipe.
    for (let k = 0; k < n; k++) {
      const most = t.full[k] + (t.manhole[k] ? SHAFT_HOLDS : 0);
      if (has[k] > most + 1e-12) {
        const cell = t.cells[k];
        hooks.release(cell % g.w, (cell / g.w) | 0, has[k] - most);
        spilt += has[k] - most;
        has[k] = most;
      }
      if (has[k] > 0) held.set(t.cells[k], has[k]); else held.delete(t.cells[k]);
    }
    r.trunk.spilled = spilt / dt;
    r.flow = r.trunk.delivered;
    r.state = hooks.backedUp !== null && net.cells.includes(hooks.backedUp) ? "backed-up"
      : !lifting ? "unpaid"
      : spilt > 0 ? "surcharged"
      : "flowing";
  }
}

/** The busiest manhole on the map, by what came in last frame; else any with a lateral: where a backup chokes. Null with none. */
export function busiestNode(g: Grid): number | null {
  let best: number | null = null, most = 0;
  for (const [i, q] of nodeIntake(g)) if (q > most) { most = q; best = i; }
  if (best !== null) return best;
  const s = solveSewers(g);
  return lateralsOf(g).find((l) => l.node !== null && l.sources.length && s.drains[l.node])?.node ?? null;
}
