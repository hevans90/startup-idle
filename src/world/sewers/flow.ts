/**
 * World v2 — SLOP THROUGH THE SEWERS UNDER THE GROUND, a frame at a time.
 *
 * A workplace's tank drains along its LATERAL — the short brown tube above
 * ground from its slop port to a manhole — as much as the lateral carries,
 * if the manhole's network has an exit. From each manhole the slop runs
 * down the trunk toward its exit, every tile passing on no more than it
 * carries (`SewerSolve.capacity`). What a tile can't pass comes up at the
 * nearest manhole above it: the node SURCHARGES and spills in the street. At
 * the exits it feeds the processors first, as much as each takes, then pours
 * out of the outfalls; with nowhere left to go it comes up at the manhole
 * nearest the exit.
 *
 * Lift stations run, and are paid for, a second at a time while slop comes
 * down to them; unpaid, they stop, and what reaches them comes up behind.
 * A backed-up manhole (the event) passes nothing on. Live state; not saved.
 * @see solveSewers, stepSlop, plans/underground-sewers.md §7
 */
import { sewerFlow } from "../../game/mains";
import { MAIN_BORE, SEWER_FIT, type Grid } from "../grid";
import { findMains, sewerSources, type MainNet } from "../water/mains";
import { portsAt } from "../water/ports";
import { SEWER_KIND, solveSewers } from "./solve";

/** A lateral: an above-ground sewer from workplaces' slop ports to a manhole. */
export type Lateral = { net: MainNet; sources: number[]; node: number | null; capacity: number };

/** What a network did in the last frame. */
export type SewerState = "flowing" | "idle" | "no-exit" | "surcharged" | "backed-up" | "unpaid";
export type SewerReport = {
  state: SewerState;
  /** Slop a second it took in, put somewhere, and brought up in the street. */
  inflow: number;
  delivered: number;
  spilled: number;
  /** Its lift stations, by cell. */
  lifts: number[];
};

/** The laterals on a map: each above-ground sewer that reaches a manhole, or none. */
export function lateralsOf(g: Grid): Lateral[] {
  const out: Lateral[] = [];
  for (const net of findMains(g).list) {
    if (!net.sewer) continue;
    const node = net.cells.find((i) => g.sewerFit[i] === SEWER_FIT.node) ?? null;
    out.push({ net, sources: sewerSources(g, net), node, capacity: sewerFlow(net.cells.some((i) => g.main[i] & MAIN_BORE) ? 2 : 1) });
  }
  return out;
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

/**
 * ONE FRAME OF THE SEWERS: the tanks drained along their laterals into the
 * manholes, the slop run down each trunk to its exits, and what can't get
 * there spilled at a manhole. `tanks` are the workplaces', by id.
 */
export function stepSewers(g: Grid, tanks: ReadonlyMap<number, { level: number }>, dt: number, hooks: SewerHooks): void {
  const s = solveSewers(g);
  const out = new Map<number, SewerReport>();
  const into = new Map<number, number>();
  for (const net of s.nets) out.set(net.id, { state: net.exits.length ? "idle" : "no-exit", inflow: 0, delivered: 0, spilled: 0, lifts: net.cells.filter((i) => s.kind[i] === SEWER_KIND.lift) });
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
  }

  for (const net of s.nets) {
    const r = out.get(net.id)!;
    let inflow = 0;
    for (const i of net.nodes) inflow += into.get(i) ?? 0;
    r.inflow = inflow / dt;
    if (!net.exits.length || inflow <= 0) continue;
    // ITS LIFTS, paid for while slop comes to them; one unpaid stops them all.
    let lifting = true;
    for (let k = 0; k < r.lifts.length && lifting; k++) lifting = hooks.pay(dt);
    // FROM THE TOP DOWN: each tile what comes into it and from above, passing
    // on what it carries, the rest up at the nearest manhole above it.
    const dist = new Map<number, number>();
    const far = (i: number): number => {
      let d = dist.get(i);
      if (d !== undefined) return d;
      d = s.down[i] >= 0 ? far(s.down[i]) + 1 : 0;
      dist.set(i, d);
      return d;
    };
    const cells = net.cells.filter((i) => s.drains[i]).sort((a, b) => far(b) - far(a));
    const carry = new Map<number, number>();
    /** The manhole nearest above each tile, by what comes down to it most. */
    const above = new Map<number, { node: number; amount: number }>();
    const spill = new Map<number, number>();
    const arrive = new Map<number, number>();
    for (const i of cells) {
      let c = (carry.get(i) ?? 0) + (into.get(i) ?? 0);
      const isNode = g.sewerFit[i] === SEWER_FIT.node;
      const up = isNode ? { node: i, amount: c } : above.get(i);
      const cap = i === hooks.backedUp ? 0
        : s.kind[i] === SEWER_KIND.lift && !lifting ? 0
        : s.down[i] < 0 ? Infinity
        : s.capacity[i] * dt;
      if (c > cap) {
        const at = up?.node ?? i;
        spill.set(at, (spill.get(at) ?? 0) + c - cap);
        c = cap;
      }
      const d = s.down[i];
      if (d < 0) { arrive.set(i, (arrive.get(i) ?? 0) + c); continue; }
      carry.set(d, (carry.get(d) ?? 0) + c);
      const was = above.get(d);
      if (up && (!was || c > was.amount)) above.set(d, { node: up.node, amount: c });
    }
    // AT THE EXITS: the processors first, then the outfalls; the rest up behind.
    let left = 0;
    const outfalls = net.exits.filter((e) => g.sewerFit[e] === SEWER_FIT.outfall);
    for (const [e, amount] of arrive) {
      let a = amount;
      if (g.sewerFit[e] === SEWER_FIT.inlet) {
        const p = portsAt(g, e, "slop", "in")[0];
        if (p) { const t = Math.min(a, hooks.room(p.building)); hooks.take(p.building, t); a -= t; r.delivered += t / dt; }
      }
      left += a;
    }
    if (left > 0 && outfalls.length) {
      for (const e of outfalls) hooks.release(e % g.w, (e / g.w) | 0, left / outfalls.length);
      r.delivered += left / dt;
      left = 0;
    }
    if (left > 0) {
      // Nowhere to put it: up at the manhole nearest an exit.
      const e = [...arrive.keys()][0];
      const at = above.get(e)?.node ?? e;
      spill.set(at, (spill.get(at) ?? 0) + left);
    }
    let spilt = 0;
    for (const [i, amount] of spill) { hooks.release(i % g.w, (i / g.w) | 0, amount); spilt += amount; }
    r.spilled = spilt / dt;
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
