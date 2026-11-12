/**
 * World v2 — THE WATER MAINS on the map: the game's pipes. A main is a run of
 * cells joined only where a stroke joined them (`grid.main`, `DIR` bits on
 * both sides of a face), with a fitting at each end (`grid.mainEnd`): an
 * INTAKE at water, a PUMP intake, an OUTLET into a building that drinks, or a
 * CAP. Each network is SOLVED AS FLOW over the pipe graph: water held at its
 * nodes, a discharge in each link, drawn at the intakes by the head over
 * each building's floor and given to the tanks — so a trunk's water is
 * shared among its outlets, and a main just laid takes a second or two to
 * fill. A dry intake stops the flow and nothing is ever poured out.
 * Each network's state is kept, so the game can always say what a main is
 * doing and why. @see pipes/hydraulics, game/mains, plans/pipe-network.md
 */
import { surfaceAt, wantDepth, addWater } from "../../fluid/columns";
import { isDrinker } from "../../game/cooling";
import { PUMP_MOST, pumpLift, sewerFlow } from "../../game/mains";
import {
  H_GEN, H_INTAKES, H_LINKS, H_NODES, H_OUTLETS, INTAKE_WORDS, LINK_WORDS, NODE_WORDS, OUTLET_FRAME, OUTLET_WORDS,
  pipeOffsets, type PipePort,
} from "../../fluid/gpu/pipes";
import { coolingKept } from "../../game/pollution";
import { DIR, NEIGHBOUR } from "../../iso/dir";
import { MAIN_AI, MAIN_BORE, MAIN_END, MAIN_SEWER, MAIN_STUB, SEWER_FIT, VOID, edited, idx, inBounds, structureAt, type Grid, type Structure } from "../grid";
import { solveSewers } from "../sewers/solve";
import { fillTank, tankRoom } from "../projects/cooling";
import { structureDef } from "../structures/def";
import { COLUMNS_PER_TILE, columnOf, tileOf, type WaterField } from "./field";
import { pollutionAt } from "./pollution";
import { nearestPort, portsAt, portsOf, wallAt } from "./ports";
import type { Port } from "../structures/def";
import { pipeGraph, type MainNet } from "../pipes/graph";
import type { MainReport, MainState } from "../pipes/report";
import { runsOf, type PipeProfile } from "../pipes/profile";
import {
  SLOT, emptyWater, fillOf, floorOf, settledWater, steadyFlow, stepWater as stepPipes, waterHeld, waterModel,
  type Steady, type WaterEnv, type WaterModel, type WaterState,
} from "../pipes/hydraulics";

const SIDES = ["N", "E", "S", "W"] as const;
const OPPOSITE = { N: "S", S: "N", E: "W", W: "E" } as const;
/** Half steps of water an intake needs to draw: less, and it is dry. */
export const INTAKE_WET = 0.5;

/** Whether a cell's main joins its neighbour on a side: both carry the shared face. */
export function joined(g: Grid, x: number, y: number, side: (typeof SIDES)[number]): boolean {
  const [dx, dy] = NEIGHBOUR[side];
  if (!inBounds(g, x + dx, y + dy)) return false;
  return (g.main[idx(g, x, y)] & DIR[side]) !== 0 && (g.main[idx(g, x + dx, y + dy)] & DIR[OPPOSITE[side]]) !== 0;
}

/** Whether a cell carries a main: joined somewhere, or a lone fitting. */
export const hasMain = (g: Grid, i: number) => g.main[i] !== 0 || g.mainEnd[i] !== 0;
/** Whether the main on a cell is a sewer. */
export const isSewer = (g: Grid, i: number) => (g.main[i] & MAIN_SEWER) !== 0;

export type { MainNet } from "../pipes/graph";

/** Every network on the map, and which each cell is in (−1 for none): read off the one pipe graph, kept till the map changes. @see pipeGraph */
export function findMains(g: Grid): { list: MainNet[]; of: Int32Array } {
  const graph = pipeGraph(g);
  return { list: graph.mains, of: graph.mainOf };
}

/** The water an intake draws from: the deepest of its own tile and the four beside it, as a column; or −1 with none. */
export function intakeWater(g: Grid, field: WaterField, i: number): { column: number; surface: number; depth: number } | null {
  const { columns } = field;
  const mid = Math.floor(COLUMNS_PER_TILE / 2);
  const x = i % g.w, y = (i / g.w) | 0;
  let best: { column: number; surface: number; depth: number } | null = null;
  for (const [dx, dy] of [[0, 0], ...SIDES.map((s) => NEIGHBOUR[s])]) {
    if (!inBounds(g, x + dx, y + dy)) continue;
    const c = (columnOf(y + dy) + mid) * columns.nx + columnOf(x + dx) + mid;
    wantDepth(columns, c);
    const depth = columns.depth[c];
    if (depth < INTAKE_WET || (best && depth <= best.depth)) continue;
    best = { column: c, surface: surfaceAt(columns, c), depth };
  }
  return best;
}

/**
 * The building that drinks an outlet feeds — through the water inlet the
 * outlet stands in front of, and only that — by id; −1 with none. In front
 * of two, the one with the most room in its tank: a main ending between a
 * full building and a thirsty one waters the thirsty one. @see portsAt
 */
export function outletBuilding(g: Grid, i: number): number {
  let best = -1, room = -1;
  for (const p of portsAt(g, i)) {
    const s = g.structures.get(p.building);
    if (!s || !isDrinker(s.def) || p.building === best) continue;
    const r = tankRoom(p.building);
    if (r > room) { best = p.building; room = r; }
  }
  return best;
}

/** A building that drinks, standing. */
const drinker = (s: { def: string; build?: unknown }) => !s.build && isDrinker(s.def);

export type { MainReport, MainState } from "../pipes/report";

/**
 * A MAIN BURST AT A JOINT, and a SEWER BACKED UP AT A MANHOLE: by cell, the
 * events' to set. The burst network still draws what it would carry, but
 * pours it out at the joint instead of into its buildings; the backed-up
 * sewer still takes from its tanks, but brings it up at the manhole. Live
 * state; not saved. @see BURST_MAIN, SEWER_BACKUP
 */
let burstAt: number | null = null, backedUpAt: number | null = null;
export const setBurst = (cell: number | null) => { burstAt = cell; };
export const setBackedUp = (cell: number | null) => { backedUpAt = cell; };
export const backedUpCell = () => backedUpAt;

/**
 * A JOINT OR A MANHOLE to break: the middle cell of the longest water main
 * that feeds anything (`sewer` false), or of the longest sewer that takes
 * from anything — a cell joined on two sides, not an end. Null with none.
 */
export function breakableCell(g: Grid, sewer: boolean): number | null {
  let best: MainNet | null = null;
  for (const net of findMains(g).list) {
    if (net.sewer !== sewer || net.cells.length < 3) continue;
    if (sewer ? !sewerSources(g, net).length : !net.outlets.length) continue;
    if (!best || net.cells.length > best.cells.length) best = net;
  }
  if (!best) return null;
  const mid = best.cells.filter((i) => !g.mainEnd[i]);
  return mid.length ? mid[Math.floor(mid.length / 2)] : null;
}
/** The workplaces a sewer takes slop from, by id: those whose slop port is one of its cells, a stub's or the trunk's own. */
export function sewerSources(g: Grid, net: MainNet): number[] {
  const out: number[] = [];
  for (const i of net.cells) for (const p of portsAt(g, i, "slop", "out")) if (!out.includes(p.building)) out.push(p.building);
  return out;
}

/**
 * A SEWER SOLVED: what it takes slop from and where it can put it — a
 * processor's inlet (an outlet on a slop port) or an outfall — and what it
 * carries a second, by its bore alone. What it does carry, `flow`, the
 * slop tanks fill in each frame. @see sewerFlow, stepSlop
 */
export function solveSewer(g: Grid, net: MainNet): MainReport {
  const sources = sewerSources(g, net);
  // A LATERAL: into a manhole, flowing if its network has an exit. @see stepSewers
  const node = net.cells.find((i) => g.sewerFit[i] === SEWER_FIT.node);
  if (node !== undefined) {
    const state: MainState = !sources.length ? "no-source" : !solveSewers(g).drains[node] ? "no-outlet" : "flowing";
    return { state, head: 0, capacity: sewerFlow(net.bore), flow: 0, length: net.cells.length, bore: net.bore, outlets: [], intakes: [], sewer: { sources, outfalls: [], node } };
  }
  const processors = net.outlets.filter((i) => portsAt(g, i, "slop", "in").length > 0);
  const state: MainState = !sources.length ? "no-source" : !processors.length && !net.outfalls.length ? "no-outlet" : "flowing";
  return {
    state, head: 0, capacity: sewerFlow(net.bore), flow: 0, length: net.cells.length, bore: net.bore,
    outlets: processors.map((cell) => ({ cell, building: portsAt(g, cell, "slop", "in")[0].building, capacity: sewerFlow(net.bore), pumped: false })),
    intakes: [], sewer: { sources, outfalls: net.outfalls },
  };
}

/** A water network as the solver holds it: its model, the water in it (null till first run), and its steady flow as last worked out. */
type Solved = {
  model: WaterModel; state: WaterState | null; steady: { sig: string; flow: Steady; age: number } | null;
  /**
   * What each link has been carrying, evened out over a second or two. A shut
   * main's water rocks back and forth in it for ever, a tenth of a unit each
   * way, and that is not a main carrying anything: this is what is shown. @see mainLiveAt
   */
  mean?: Float64Array;
};
/** Seconds a link's flow is evened out over, for what is shown. */
const MEAN_OVER = 1.5;
/** A frame's flows folded into each link's mean. */
function fold(s: Solved, dt: number) {
  if (!s.state || !(dt > 0)) return;
  if (!s.mean || s.mean.length !== s.state.flow.length) { s.mean = Float64Array.from(s.state.flow); return; }
  const k = Math.min(1, dt / MEAN_OVER);
  for (let i = 0; i < s.mean.length; i++) s.mean[i] += (s.state.flow[i] - s.mean[i]) * k;
}
/** Where a graph node or link is held: which network's model, and its place in it. */
type Where = { node: Map<number, [Solved, number]>; link: Map<number, [Solved, number]> };
/**
 * THE NETWORKS AS PACKED FOR THE DEVICE, while it owns the water: which
 * upload this is, where each network's nodes, links, intakes and outlets
 * start in the packed whole, and — an outlet at a time — what the device has
 * been GRANTED to deliver and what it was last seen to have delivered.
 * @see fluid/gpu/pipes, packMains
 */
type Packed = {
  port: PipePort;
  gen: number;
  at: Map<number, { n: number; l: number; i: number; o: number }>;
  off: ReturnType<typeof pipeOffsets>;
  granted: Float64Array;
  seen: Float64Array;
  frame: Float32Array;
  /** Intakes in all: the frame's block has a word for each, then its outlets'. */
  intakes: number;
  /** What each network is carrying, smoothed: answers come back a frame or three apart. */
  shown: Map<number, number>;
};
const solvedFor = new WeakMap<Grid, { rev: number; nets: Map<number, Solved>; packed?: Packed | null; where?: Where }>();
let packs = 0;

/**
 * Every water network's model, by the cell it starts at: kept till the map
 * changes, and then made again with the water each tile's pipe held carried
 * over — so a main just laid starts empty and fills, one untouched keeps its
 * pressure, and what stood in a run just lifted goes on the ground under it.
 * A map seen for the first time has no water to carry: its mains start full
 * and settled. @see settledWater
 */
function solvedNets(g: Grid, field: WaterField): Map<number, Solved> {
  const was = solvedFor.get(g);
  if (was && was.rev === g.rev) return was.nets;
  const graph = pipeGraph(g);
  const carried = new Map<number, number>();
  if (was) for (const s of was.nets.values()) s.state?.held.forEach((v, k) => { if (v > 0) carried.set(s.model.cells[k], (carried.get(s.model.cells[k]) ?? 0) + v); });
  const nets = new Map<number, Solved>();
  for (const net of graph.mains) {
    if (net.sewer) continue;
    const at = net.cells.find((c) => graph.nodeAt.main[c] >= 0);
    if (at === undefined) continue;
    const model = waterModel(graph, graph.nodes[graph.nodeAt.main[at]].system);
    let state: WaterState | null = null;
    if (was) {
      state = emptyWater(model);
      model.cells.forEach((c, k) => {
        const v = carried.get(c);
        if (v === undefined || model.intakeAt[k] >= 0) return;
        // No more than its pipe holds under a fair pressure: the rest is spilt with what was lifted.
        const keep = Math.min(v, model.full[k] + 10 * SLOT);
        state!.held[k] = keep;
        if (v - keep > 1e-9) carried.set(c, v - keep); else carried.delete(c);
      });
    }
    nets.set(net.cells[0], { model, state, steady: null });
  }
  const mid = Math.floor(COLUMNS_PER_TILE / 2);
  for (const [c, v] of carried) addWater(field.columns, columnOf(c % g.w) + mid, columnOf((c / g.w) | 0) + mid, v);
  solvedFor.set(g, { rev: g.rev, nets });
  return nets;
}

/**
 * EVERY WATER NETWORK PACKED INTO ONE BUFFER for the device: the header, the
 * block the host rewrites a frame, the device's own block as it should start
 * — each node's water and each link's flow as the host last had them, a map
 * first seen full and settled — and the networks end to end. Null where they
 * are more than the buffer holds: then the host goes on solving them.
 */
function packMains(g: Grid, field: WaterField, nets: Map<number, Solved>, port: PipePort): Packed | null {
  let N = 0, L = 0, I = 0, O = 0;
  for (const s of nets.values()) { N += s.model.nodes.length; L += s.model.links.length; I += s.model.intakes.length; O += s.model.outlets.length; }
  const off = pipeOffsets(N, L, I, O);
  if (off.words > port.words) return null;
  const all = new Float32Array(off.scratch), at: Packed["at"] = new Map();
  const gen = ++packs;
  all[H_NODES] = N; all[H_LINKS] = L; all[H_INTAKES] = I; all[H_OUTLETS] = O; all[H_GEN] = gen;
  all[off.dyn] = gen;
  const nx = field.columns.nx, mid = Math.floor(COLUMNS_PER_TILE / 2);
  let n = 0, l = 0, i = 0, o = 0;
  for (const [key, s] of nets) {
    const m = s.model;
    at.set(key, { n, l, i, o });
    const sur = surroundings(g, field, m), envNow = sur.env(true, sur.outs.map((x) => x.building >= 0));
    if (!s.state) s.state = settledWater(m, envNow);
    if (Number.isNaN(s.state.floor)) s.state.floor = floorOf(envNow);
    m.nodes.forEach((_, k) => {
      all[off.held + n + k] = s.state!.held[k];
      const w = off.nodes + (n + k) * NODE_WORDS;
      all[w] = m.full[k]; all[w + 1] = s.state!.floor; all[w + 2] = m.intakeAt[k] >= 0 ? i + m.intakeAt[k] : -1;
    });
    m.links.forEach((link, k) => {
      all[off.flow + l + k] = s.state!.flow[k];
      const w = off.links + (l + k) * LINK_WORDS;
      all[w] = n + link.a; all[w + 1] = n + link.b; all[w + 2] = link.loss;
    });
    m.intakes.forEach((t, k) => {
      const w = off.intakes + (i + k) * INTAKE_WORDS;
      all[w] = n + t.node;
      // A pump moves only so much and lifts so far; a plain intake, all the head gives.
      all[w + 1] = t.pump ? PUMP_MOST * t.bore : 1e30;
      all[w + 2] = t.pump ? pumpLift() : 0;
      // The columns it may draw from: its own tile's and the four beside it. @see intakeWater
      const x = t.cell % g.w, y = (t.cell / g.w) | 0;
      [[0, 0], ...SIDES.map((side) => NEIGHBOUR[side])].forEach(([dx, dy], c) => {
        all[w + 3 + c] = inBounds(g, x + dx, y + dy) ? (columnOf(y + dy) + mid) * nx + columnOf(x + dx) + mid : -1;
      });
    });
    m.outlets.forEach((out, k) => {
      const w = off.outlets + (o + k) * OUTLET_WORDS;
      all[w] = n + out.node; all[w + 1] = Number.isFinite(sur.outs[k].sill) ? sur.outs[k].sill : 1e30; all[w + 2] = out.loss; all[w + 3] = out.most;
    });
    n += m.nodes.length; l += m.links.length; i += m.intakes.length; o += m.outlets.length;
  }
  port.load(all);
  return { port, gen, at, off, granted: new Float64Array(O), seen: new Float64Array(O), frame: new Float32Array(I + OUTLET_FRAME * O), intakes: I, shown: new Map() };
}

/**
 * One frame of a water network SOLVED ON THE DEVICE: the host says what each
 * outlet may be given and whether the pumps run, takes what the device was
 * last seen to have delivered into the tanks, and reports. The water itself
 * moves over there, on the depth the device holds. @see runSolved, its twin
 */
function runOnDevice(g: Grid, field: WaterField, net: MainNet, s: Solved, p: Packed, dt: number, pumps: MainPumps, burst: boolean): MainReport {
  const m = s.model, place = p.at.get(net.cells[0])!;
  const sur = surroundings(g, field, m), { outs, env } = sur;
  const fed = outs.map((o) => o.building >= 0);
  const wants = outs.some((o) => o.building >= 0 && tankRoom(o.building) > 0);
  let pumping = true, unpaid = false;
  let all = steadyOf(s, env(true, fed), dt);
  if (all.pumped.some(Boolean) && wants && !burst && !pumps.pay(dt)) { pumping = false; unpaid = true; all = steadyOf(s, env(false, fed), dt); }
  const { report, kept } = describeMain(field, net, m, sur, all, pumping, unpaid);
  // WHAT CAME BACK: only an answer to this upload. One in the air when the map changed is another network's.
  const back = p.port.latest(), fresh = back !== null && back[0] === p.gen ? back : null;
  let arrived = 0;
  if (fresh) {
    const base = p.off.dyn;
    m.nodes.forEach((_, k) => { s.state!.held[k] = fresh[p.off.held - base + place.n + k]; });
    m.links.forEach((_, k) => { s.state!.flow[k] = fresh[p.off.flow - base + place.l + k]; });
  }
  m.outlets.forEach((_, k) => {
    const j = place.o + k;
    if (fresh) {
      // The count is kept whole and part: read as one number here, where doubles have the room.
      const at = p.off.delivered - p.off.dyn + 2 * j, seen = fresh[at] + fresh[at + 1];
      const more = seen - p.seen[j];
      // Fouled water cools less: a tank is given so much the less of what left the pipe.
      if (more > 0 && outs[k].building >= 0) fillTank(outs[k].building, more * kept);
      if (more > 0) arrived += more;
      p.seen[j] = seen;
    }
    // GRANT what its tank has room for that is not already on its way: never more than fits.
    const room = outs[k].building >= 0 && !burst && kept > 0 ? tankRoom(outs[k].building) / kept : 0;
    const coming = p.granted[j] - p.seen[j];
    if (room > coming) p.granted[j] += room - coming;
    // Its words in the frame's block, after every intake's.
    const f = p.intakes + OUTLET_FRAME * j;
    p.frame[f] = fed[k] && !burst ? 1 : 0;
    p.frame[f + 1] = Math.floor(p.granted[j]);
    p.frame[f + 2] = p.granted[j] - Math.floor(p.granted[j]);
  });
  m.intakes.forEach((_, k) => { p.frame[place.i + k] = pumping ? 1 : 0; });
  if (burst) {
    // BURST: what it would carry drawn as ever, and poured out at the joint — by the host's hand, as arrivals. @see setBurst
    const { columns } = field;
    let left = report.capacity * dt, poured = 0;
    const order = sur.waters.filter((w): w is NonNullable<typeof w> => !!w).sort((a, b) => b.surface - a.surface);
    for (const w of order) {
      if (left <= 0) break;
      const got = Math.min(left, columns.depth[w.column]);
      if (got > 0) { addWater(columns, w.column % columns.nx, (w.column / columns.nx) | 0, -got); left -= got; poured += got; }
    }
    const mid = Math.floor(COLUMNS_PER_TILE / 2), bx = burstAt! % g.w, by = (burstAt! / g.w) | 0;
    if (poured > 0) addWater(columns, columnOf(bx) + mid, columnOf(by) + mid, poured);
    return { ...report, state: "burst", outlets: report.outlets.map((o) => ({ ...o, capacity: 0 })) };
  }
  // What it is carrying, evened out over a quarter of a second: an answer does not come back every frame.
  const was = p.shown.get(net.cells[0]) ?? 0;
  const now = fresh && dt > 0 ? was + ((arrived * kept) / dt - was) * Math.min(1, dt / 0.25) : was;
  p.shown.set(net.cells[0], now);
  report.flow = now;
  if (report.state === "flowing" && !wants) report.state = "full";
  return report;
}

/** All the water standing in a map's mains, for sums that must not lose any. */
export function waterInMains(g: Grid): number {
  let n = 0;
  for (const s of solvedFor.get(g)?.nets.values() ?? []) if (s.state) n += waterHeld(s.state);
  return n;
}

/** How full the main's pipe stands at a cell that is one of the graph's nodes, nought to one; null where the solver holds none. For the tubes. */
export function mainFillAt(g: Grid, cell: number): number | null {
  for (const s of solvedFor.get(g)?.nets.values() ?? []) {
    const k = s.model.cells.indexOf(cell);
    if (k >= 0 && s.state) return s.model.intakeAt[k] >= 0 ? 1 : fillOf(s.model, s.state, k);
  }
  return null;
}

/**
 * THE WATER IN A MAIN AT A TILE, as the solver holds it: how full the pipe
 * stands there, nought to one — between two nodes, by how far along the run
 * it is — what the run carries a second, and which way that is going, a
 * step to the next tile (nought, nought where it stands still). Null where
 * no water main has been solved. FOR THE TUBES: what a window shows is what
 * is in the pipe behind it. @see plans/pipe-network.md §5
 */
export type MainLive = { fill: number; flow: number; dir: readonly [number, number] };
export function mainLiveAt(g: Grid, cell: number): MainLive | null {
  const entry = solvedFor.get(g);
  if (!entry || entry.rev !== g.rev) return null;
  const graph = pipeGraph(g);
  if (!entry.where) {
    const where: Where = { node: new Map(), link: new Map() };
    for (const s of entry.nets.values()) {
      s.model.nodes.forEach((id, k) => where.node.set(id, [s, k]));
      s.model.links.forEach((l, k) => where.link.set(l.graph, [s, k]));
    }
    entry.where = where;
  }
  const step = (from: number, to: number): [number, number] => [(to % g.w) - (from % g.w), ((to / g.w) | 0) - ((from / g.w) | 0)];
  /** A node's fill: an intake holds none of its own, so it is as full as the pipe it feeds. */
  const fillAt = (s: Solved, k: number): number => {
    if (!s.state) return 0;
    if (s.model.intakeAt[k] < 0) return fillOf(s.model, s.state, k);
    let most = 0;
    for (const l of s.model.links) if (l.a === k || l.b === k) most = Math.max(most, fillOf(s.model, s.state, l.a === k ? l.b : l.a));
    return most;
  };
  const n = graph.nodeAt.main[cell];
  if (n >= 0) {
    const at = entry.where.node.get(n);
    if (!at || !at[0].state) return null;
    const [s, k] = at;
    // WHICH WAY: out along the run that takes most from it; at an end, on the way it came.
    let flow = 0, dir: [number, number] = [0, 0], out = false;
    s.model.links.forEach((l, li) => {
      if (l.a !== k && l.b !== k) return;
      const q = (s.mean ?? s.state!.flow)[li] * (l.a === k ? 1 : -1), cells = graph.links[l.graph].cells;
      if (cells.length < 2 || q === 0) return;
      const beside = l.a === k ? cells[1] : cells[cells.length - 2];
      if (q > 0 && (!out || q > flow)) { flow = q; dir = step(cell, beside); out = true; }
      else if (q < 0 && !out && -q > flow) { flow = -q; dir = step(beside, cell); }
    });
    return { fill: fillAt(s, k), flow, dir };
  }
  const li = graph.linkAt.main[cell], at = li >= 0 ? entry.where.link.get(li) : undefined;
  if (!at || !at[0].state) return null;
  const [s, k] = at, l = s.model.links[k], cells = graph.links[li].cells, p = cells.indexOf(cell);
  const q = (s.mean ?? s.state!.flow)[k], t = p / (cells.length - 1);
  return {
    fill: fillAt(s, l.a) * (1 - t) + fillAt(s, l.b) * t,
    flow: Math.abs(q),
    dir: q > 0 ? step(cell, cells[p + 1]) : q < 0 ? step(cell, cells[p - 1]) : [0, 0],
  };
}

/** What the solver needs told of a network this frame: its intakes' water, and what each outlet feeds. */
function surroundings(g: Grid, field: WaterField, m: WaterModel) {
  const waters = m.intakes.map((t) => intakeWater(g, field, t.cell));
  const outs = m.outlets.map((o) => {
    const building = outletBuilding(g, o.cell);
    const b = building >= 0 ? g.structures.get(building) : undefined;
    // The building's floor: the water has to stand as high as it to go in.
    return { building, sill: b ? g.height[idx(g, b.x, b.y)] : Infinity };
  });
  const env = (pumping: boolean, open: boolean[]): WaterEnv =>
    ({ surface: waters.map((w) => (w ? w.surface : null)), pumping: m.intakes.map(() => pumping), sill: outs.map((o) => o.sill), open });
  return { waters, outs, env };
}

/** Seconds a network's steady flow stands before it is worked out again from the water as it is now. */
const STEADY_EVERY = 0.25;

/**
 * A network's steady flow with every building it reaches taking all it is
 * given: what its card quotes. Worked out again when its pumps or what it
 * feeds change, and a few times a second as its water rises and falls —
 * not every frame, which a lake's ripples would otherwise ask for.
 */
function steadyOf(s: Solved, env: WaterEnv, dt: number): Steady {
  const sig = `${env.surface.map((v) => (v === null ? "-" : "w")).join("")}|${env.pumping[0] ? 1 : 0}|${env.sill.join(",")}|${env.open.map((o) => (o ? 1 : 0)).join("")}`;
  if (s.steady && s.steady.sig === sig && s.steady.age + dt < STEADY_EVERY) { s.steady.age += dt; return s.steady.flow; }
  s.steady = { sig, flow: steadyFlow(s.model, env, s.steady?.sig === sig ? s.steady.flow : undefined), age: 0 };
  return s.steady.flow;
}

/**
 * WHAT A NETWORK IS DOING, from its steady flow and the water as it stands:
 * its state and why, the head to its best-placed outlet, what it could carry
 * to each building and in all. And how much of what leaves the pipe a tank
 * keeps: fouled water cools less. @see coolingKept
 */
function describeMain(
  field: WaterField, net: MainNet, m: WaterModel, sur: ReturnType<typeof surroundings>, all: Steady, pumping: boolean, unpaid: boolean,
): { report: MainReport; kept: number } {
  const { columns } = field, { waters, outs } = sur;
  const intakes = m.intakes.map((t, k) => {
    const w = waters[k];
    // HOW FOULED the water it draws is, on the tile its water stands on.
    const fouled = w ? pollutionAt(field, tileOf(w.column % columns.nx), tileOf(Math.floor(w.column / columns.nx))) : 0;
    return { cell: t.cell, surface: w ? w.surface : null, depth: w ? w.depth : 0, pump: t.pump, fouled };
  });
  // Its water is the intake's that stands highest, a pump's lift counted.
  let best = -Infinity, fouled = 0;
  intakes.forEach((k) => {
    if (k.surface === null) return;
    const head = k.surface + (k.pump && pumping ? pumpLift() : 0);
    if (head > best) { best = head; fouled = k.fouled; }
  });
  const kept = coolingKept(fouled);
  const capacity = all.out.reduce((n, q) => n + q, 0) * kept;
  const head = outs.reduce((h, o) => (o.building >= 0 ? Math.max(h, best - o.sill) : h), -Infinity);
  const report: MainReport = {
    state: !m.intakes.length ? "no-source" : !outs.some((o) => o.building >= 0) ? "no-outlet" : best === -Infinity ? "dry" : capacity <= 0 ? (unpaid ? "unpaid" : "no-head") : "flowing",
    head: Number.isFinite(head) ? head : 0, capacity, flow: 0, length: net.cells.length, bore: net.bore,
    outlets: m.outlets.map((o, k) => ({ cell: o.cell, building: outs[k].building, capacity: all.out[k] * kept, pumped: all.pumped[k] })),
    intakes,
  };
  return { report, kept };
}

/**
 * A NETWORK SOLVED, from the water as it stands: what it would carry, settled,
 * with every building it reaches taking all it is given. Pure on the map and
 * the water; no water moves. `pumpsOn` false reads a pump as an intake.
 */
export function solveMain(g: Grid, field: WaterField, net: MainNet, pumpsOn = true): MainReport {
  const graph = pipeGraph(g);
  const at = net.cells.find((c) => graph.nodeAt.main[c] >= 0);
  if (at === undefined) return { state: "no-source", head: 0, capacity: 0, flow: 0, length: net.cells.length, bore: net.bore, outlets: [], intakes: [] };
  const m = waterModel(graph, graph.nodes[graph.nodeAt.main[at]].system);
  const sur = surroundings(g, field, m);
  const all = steadyFlow(m, sur.env(pumpsOn, sur.outs.map((o) => o.building >= 0)));
  return describeMain(field, net, m, sur, all, pumpsOn, false).report;
}

/** One frame of a water network: its water moved through it, drawn at its intakes and given to its tanks. @see runMains */
function runSolved(g: Grid, field: WaterField, net: MainNet, s: Solved, dt: number, pumps: MainPumps, burst: boolean): MainReport {
  const m = s.model, { columns } = field;
  const sur = surroundings(g, field, m), { waters, outs, env } = sur;
  const fed = outs.map((o) => o.building >= 0);
  const wants = outs.some((o) => o.building >= 0 && tankRoom(o.building) > 0);
  // A pump runs, and is paid for, only while a tank it feeds has room; unpaid, the network falls back on gravity.
  let pumping = true, unpaid = false;
  let all = steadyOf(s, env(true, fed), dt);
  if (all.pumped.some(Boolean) && wants && !burst && !pumps.pay(dt)) { pumping = false; unpaid = true; all = steadyOf(s, env(false, fed), dt); }
  const { report, kept } = describeMain(field, net, m, sur, all, pumping, unpaid);
  /** Draw at an intake: no more than stands there, counted down through the frame's steps. */
  const there = waters.map((w) => (w ? columns.depth[w.column] : 0));
  const take = (k: number, amount: number) => {
    const w = waters[k];
    if (!w) return 0;
    const got = Math.min(amount, there[k]);
    if (got > 0) { addWater(columns, w.column % columns.nx, (w.column / columns.nx) | 0, -got); there[k] -= got; }
    return got;
  };
  if (!s.state) s.state = settledWater(m, env(pumping, fed));
  if (burst) {
    // BURST: what it would carry drawn as ever, and poured out at the joint. @see setBurst
    let left = report.capacity * dt, poured = 0;
    const order = waters.map((w, k) => ({ w, k })).filter((x) => x.w).sort((a, b) => b.w!.surface - a.w!.surface);
    for (const { k } of order) { if (left <= 0) break; const got = take(k, left); left -= got; poured += got; }
    const mid = Math.floor(COLUMNS_PER_TILE / 2), bx = burstAt! % g.w, by = (burstAt! / g.w) | 0;
    if (poured > 0) addWater(columns, columnOf(bx) + mid, columnOf(by) + mid, poured);
    return { ...report, state: "burst", outlets: report.outlets.map((o) => ({ ...o, capacity: 0 })) };
  }
  const open = outs.map((o) => o.building >= 0 && tankRoom(o.building) > 0);
  // Fouled water cools less: a tank is given so much the less of what leaves the pipe.
  const r = stepPipes(m, s.state, env(pumping, open), dt, take, (k, amount) => (kept > 0 ? fillTank(outs[k].building, amount * kept) / kept : 0));
  report.flow = dt > 0 ? (r.out.reduce((n, q) => n + q, 0) * kept) / dt : 0;
  if (report.state === "flowing" && !wants) report.state = "full";
  return report;
}

/** How pump intakes are paid: for `seconds` of running, whether it was. In the editor, free. */
export type MainPumps = { pay: (seconds: number) => boolean };
const FREE: MainPumps = { pay: () => true };

/** The map's revision its stubs were last laid for. */

/** Each network's report from the last frame, by the cell it starts at. @see mainReportAt */
let reports = new Map<number, MainReport>();
let reportOf: Int32Array | null = null, reportGrid: Grid | null = null;

/**
 * ONE FRAME OF THE MAINS: every network solved, its outlets' share poured
 * into their tanks — as much as each has room for — and that much taken out
 * of the water at its intakes. A pump runs, and is paid for, only while a tank
 * it feeds has room; unpaid, the network falls back on gravity.
 */
export function runMains(field: WaterField, g: Grid, dt: number, pumps: MainPumps = FREE): void {
  const { list, of } = findMains(g);
  const out = new Map<number, MainReport>();
  // Made again for a map just edited even with no main left on it: what a lifted run held is put down. @see solvedNets
  const flows = solvedNets(g, field);
  // ON THE DEVICE, while it owns the water: packed for it when the map, or the device, is new. @see packMains
  const entry = solvedFor.get(g)!, port = field.columns.pipes;
  if (!port) entry.packed = null;
  else if (!entry.packed || entry.packed.port !== port) entry.packed = flows.size ? packMains(g, field, flows, port) : null;
  const packed = entry.packed ?? null;
  for (const net of list) {
    // A SEWER carries what the tanks last gave it, until they say again this frame. @see stepSlop
    if (net.sewer) {
      const r = solveSewer(g, net), was = reportGrid === g ? reports.get(net.cells[0]) : undefined;
      // BACKED UP: still taking from its tanks, but up at the manhole. @see setBackedUp, stepSlop
      if (backedUpAt !== null && of[backedUpAt] === net.id && r.state === "flowing") r.state = "backed-up";
      if (was?.sewer && (r.state === "flowing" || r.state === "backed-up")) r.flow = was.flow;
      out.set(net.cells[0], r);
      continue;
    }
    const solved = flows.get(net.cells[0]);
    const burst = burstAt !== null && of[burstAt] === net.id;
    if (solved) {
      out.set(net.cells[0], packed ? runOnDevice(g, field, net, solved, packed, dt, pumps, burst) : runSolved(g, field, net, solved, dt, pumps, burst));
      fold(solved, dt);
    }
  }
  // THE FRAME, to the device: what each outlet may be given and whether each pump runs. Its pass runs once for it.
  if (packed && dt > 0) packed.port.frame(packed.frame, dt);
  reports = out;
  reportOf = of;
  reportGrid = g;
}

/** The report of the network on a cell, from the last frame; null for none. */
export function mainReportAt(g: Grid, x: number, y: number): MainReport | null {
  if (!inBounds(g, x, y) || g !== reportGrid || !reportOf) return null;
  const { list } = findMains(g);
  const id = reportOf[idx(g, x, y)];
  return id >= 0 && list[id] ? reports.get(list[id].cells[0]) ?? null : null;
}

/** A network's report from the last frame; null before its first. */
export const mainReportOf = (g: Grid, net: MainNet): MainReport | null => (g === reportGrid ? reports.get(net.cells[0]) ?? null : null);
/** And only if they were for this map: none for another. */
export const mainReportsFor = (g: Grid): ReadonlyMap<number, MainReport> => (g === reportGrid ? reports : new Map());

/** A cell of a main to lay: the sides it joins, added to what is there, and its end fitting if it is an end. */
export type MainCell = { x: number; y: number; join: number; end: number };

/**
 * A MAIN TO LAY along `cells`, in order: each cell joined to the next, and
 * each end — unless it lands on a main already laid, where it JOINS that one —
 * fitted to what it reaches: an OUTLET in front of a drinking building's
 * inlet, an INTAKE on or beside water (a PUMP intake with `pump`), or a CAP.
 * Refused through a building, across another main, a single tile, or ending
 * against a drinking building's wall away from its inlets. Pure. @see ports
 */
export function planMain(
  g: Grid, cells: readonly { x: number; y: number }[],
  wet: (x: number, y: number) => boolean, pump = false, sewer = false,
): { cells: MainCell[]; joins: number } | { refused: string } {
  const what = sewer ? "sewer" : "main";
  if (cells.length < 2) return { refused: sewer ? "Drag from a workplace's slop port to water to lay a sewer" : "Drag from the water to a building to lay a main" };
  for (const [k, c] of cells.entries()) {
    if (!inBounds(g, c.x, c.y)) return { refused: "Off the map" };
    if (structureAt(g, c.x, c.y) >= 0) return { refused: `A ${what} can't go through a building` };
    const end = k === 0 || k === cells.length - 1;
    const i = idx(g, c.x, c.y);
    if (!end && hasMain(g, i)) return { refused: `End the run on the other ${what} to join it` };
    // A SEWER AND A WATER MAIN never join.
    if (end && hasMain(g, i) && isSewer(g, i) !== sewer) return { refused: "A sewer and a water main never join" };
  }
  const toward = (a: { x: number; y: number }, b: { x: number; y: number }) =>
    SIDES.find((s) => NEIGHBOUR[s][0] === b.x - a.x && NEIGHBOUR[s][1] === b.y - a.y);
  const out: MainCell[] = [];
  let joins = 0;
  for (const [k, c] of cells.entries()) {
    let join = 0;
    for (const n of [cells[k - 1], cells[k + 1]]) {
      if (!n) continue;
      const side = toward(c, n);
      if (!side) return { refused: "A main runs tile to tile" };
      join |= DIR[side];
    }
    const i = idx(g, c.x, c.y);
    const isEnd = k === 0 || k === cells.length - 1;
    let end = 0;
    if (isEnd && hasMain(g, i)) joins++;
    else if (isEnd) {
      const beside = (f: (x: number, y: number) => boolean) => SIDES.some((s) => { const [dx, dy] = NEIGHBOUR[s]; return inBounds(g, c.x + dx, c.y + dy) && f(c.x + dx, c.y + dy); });
      const atWater = wet(c.x, c.y) || beside(wet);
      end = sewer
        ? portsAt(g, i, "slop", "out").length ? MAIN_END.drain : portsAt(g, i, "slop", "in").length ? MAIN_END.outlet : atWater ? MAIN_END.outfall : MAIN_END.cap
        : outletBuilding(g, i) >= 0 ? MAIN_END.outlet : atWater ? (pump ? MAIN_END.pump : MAIN_END.intake) : MAIN_END.cap;
      // AGAINST A WALL with no port there: a pipe joins a building at its ports only.
      const wall = end === MAIN_END.cap ? (sewer ? wallAt(g, i, (b) => !b.build, "slop") : wallAt(g, i, drinker)) : null;
      if (wall) return { refused: `Join the ${wall.def === "lattice" ? "Lattice" : structureDef(wall.def)?.name ?? "building"} at ${sewer ? "its slop port" : "one of its inlets"}` };
    }
    out.push({ x: c.x, y: c.y, join, end });
  }
  return { cells: out, joins };
}

/** Lay a planned main on the map: its joins added to what is there, its fittings set — a sewer's cells marked so. Bumps the map. */
export function layMain(g: Grid, plan: readonly MainCell[], sewer = false): void {
  for (const c of plan) {
    const i = idx(g, c.x, c.y);
    const had = g.main[i] !== 0 || g.mainEnd[i] !== 0;
    g.main[i] |= c.join | (sewer ? MAIN_SEWER : 0);
    if (c.end) g.mainEnd[i] = c.end;
    // Carried on from an open end: its cap comes off.
    else if (had && c.join && g.mainEnd[i] === MAIN_END.cap) g.mainEnd[i] = 0;
  }
  edited(g);
}

/**
 * Where an end of a drag goes: on or against a building that drinks, away
 * from its inlets, the nearest free inlet of it — or for a sewer, a
 * building's nearest slop port; else where it is. Water
 * and a main already there keep it. @see nearestPort
 */
export function snapToPort(g: Grid, c: { x: number; y: number }, wet: (x: number, y: number) => boolean, fluid: Port["fluid"] = "water"): { x: number; y: number } {
  if (!inBounds(g, c.x, c.y)) return c;
  const i = idx(g, c.x, c.y);
  // For water, a building that drinks; for slop, any with a slop port.
  const takes = (b: Structure) => (fluid === "water" ? drinker(b) : !b.build && portsOf(g, b).some((p) => p.port.fluid === "slop"));
  const on = g.structures.get(structureAt(g, c.x, c.y));
  const s = on ? (takes(on) ? on : null) : !wet(c.x, c.y) && !hasMain(g, i) ? wallAt(g, i, takes, fluid) : null;
  if (!s) return c;
  const p = nearestPort(g, s, c, (j) => hasMain(g, j), fluid);
  return p ? { x: p.x, y: p.y } : c;
}

/**
 * A MAIN'S ROUTE from one tile to another, as the Pipe tool drags it: tile to
 * tile, round buildings, off water but for its ends, never across another
 * main but at its ends — and as straight as it can be, a turn costing half a
 * tile. An end on or against a building that drinks SNAPS to its nearest
 * inlet. A sewer's (`sewer`) never touches a road. Null where there is no way. Pure.
 */
export function routeMain(
  g: Grid, from: { x: number; y: number }, to: { x: number; y: number },
  wet: (x: number, y: number) => boolean, sewer = false, avoid?: ReadonlySet<number>,
): { x: number; y: number }[] | null {
  if (!inBounds(g, from.x, from.y) || !inBounds(g, to.x, to.y)) return null;
  from = snapToPort(g, from, wet, sewer ? "slop" : "water");
  to = snapToPort(g, to, wet, sewer ? "slop" : "water");
  if (from.x === to.x && from.y === to.y) return [from];
  const n = g.w * g.h, start = idx(g, from.x, from.y), goal = idx(g, to.x, to.y);
  const free = (i: number) => {
    const x = i % g.w, y = (i / g.w) | 0;
    if (structureAt(g, x, y) >= 0) return false;
    // A SEWER CONNECTION keeps off the roads, its ends too: it goes round a street or finds no way. A water main crosses on a frame.
    if (sewer && g.paved[i] !== VOID) return false;
    if (i === start) return true;
    // The stretches of this run already pinned down: it does not cross itself. @see strokeRoute
    if (avoid?.has(i)) return false;
    if (i === goal) return true;
    return !wet(x, y) && !hasMain(g, i);
  };
  if (!free(start) || !free(goal)) return null;
  // Dijkstra over (cell, heading): a step 1, a turn half more.
  const cost = new Float64Array(n * 4).fill(Infinity);
  const prev = new Int32Array(n * 4).fill(-1);
  // A binary heap of (cost, state): the card asks for a route every move of a drag.
  const heap: { c: number; k: number }[] = [];
  const push = (e: { c: number; k: number }) => {
    heap.push(e);
    for (let i = heap.length - 1; i > 0;) { const p = (i - 1) >> 1; if (heap[p].c <= heap[i].c) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; }
  };
  const pop = () => {
    const top = heap[0], last = heap.pop()!;
    if (heap.length) {
      heap[0] = last;
      for (let i = 0; ;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < heap.length && heap[l].c < heap[m].c) m = l;
        if (r < heap.length && heap[r].c < heap[m].c) m = r;
        if (m === i) break;
        [heap[m], heap[i]] = [heap[i], heap[m]]; i = m;
      }
    }
    return top;
  };
  for (let d = 0; d < 4; d++) { cost[start * 4 + d] = 0; push({ c: 0, k: start * 4 + d }); }
  let found = -1;
  while (heap.length) {
    const { c, k } = pop();
    if (c > cost[k]) continue;
    const i = (k / 4) | 0, d = k % 4;
    if (i === goal) { found = k; break; }
    const x = i % g.w, y = (i / g.w) | 0;
    for (let nd = 0; nd < 4; nd++) {
      const [dx, dy] = NEIGHBOUR[SIDES[nd]];
      if (!inBounds(g, x + dx, y + dy)) continue;
      const j = idx(g, x + dx, y + dy);
      if (!free(j)) continue;
      const nc = c + 1 + (nd === d || i === start ? 0 : 0.5);
      const nk = j * 4 + nd;
      if (nc < cost[nk]) { cost[nk] = nc; prev[nk] = k; push({ c: nc, k: nk }); }
    }
  }
  if (found < 0) return null;
  const out: { x: number; y: number }[] = [];
  for (let k = found; k >= 0; k = prev[k]) {
    const i = (k / 4) | 0;
    if (!out.length || idx(g, out[out.length - 1].x, out[out.length - 1].y) !== i) out.push({ x: i % g.w, y: (i / g.w) | 0 });
  }
  return out.reverse();
}

/**
 * WHAT A MAIN WOULD DO, before it is laid, for the tool's card: what it
 * costs in new tiles, what each end is, and what it would carry — or why
 * not. Its own ends, or the network it joins, give its water. @see solveMain
 */
export function previewMain(g: Grid, field: WaterField | null, plan: readonly MainCell[], pump = false): {
  fresh: number; flow: number; head: number; ends: string[]; problem: string | null; needsPump: boolean;
  /** The building it would feed, by id; −1 for none. */
  building: number;
} {
  const fresh = plan.filter((c) => !hasMain(g, idx(g, c.x, c.y))).length;
  const nets = findMains(g);
  const endsOf = [plan[0], plan[plan.length - 1]];
  // Its water: its own intakes, and those of any network it joins.
  const sources: { surface: number; pump: boolean }[] = [];
  let building = -1;
  const ends: string[] = [];
  for (const c of endsOf) {
    const i = idx(g, c.x, c.y);
    const joinedNet = hasMain(g, i) ? nets.list[nets.of[i]] : undefined;
    if (joinedNet) {
      ends.push("Joins a main");
      if (field) for (const k of joinedNet.intakes) { const w = intakeWater(g, field, k); if (w) sources.push({ surface: w.surface, pump: g.mainEnd[k] === MAIN_END.pump }); }
      for (const o of joinedNet.outlets) if (building < 0) building = outletBuilding(g, o);
    } else if (c.end === MAIN_END.outlet) {
      building = outletBuilding(g, i);
      const s = g.structures.get(building);
      ends.push(`Feeds ${s?.def === "lattice" ? "the Lattice" : `the ${structureDef(s?.def ?? "")?.name ?? "building"}`}`);
    } else if (c.end === MAIN_END.intake || c.end === MAIN_END.pump) {
      const w = field ? intakeWater(g, field, i) : null;
      if (w) sources.push({ surface: w.surface, pump: c.end === MAIN_END.pump || pump });
      ends.push(c.end === MAIN_END.pump || pump ? "Pump at the water" : "Draws from the water");
    } else ends.push("Goes nowhere");
  }
  const sb = building >= 0 ? g.structures.get(building) : undefined;
  const sill = sb ? g.height[idx(g, sb.x, sb.y)] : null;
  const gravity = sill === null ? -Infinity : Math.max(-Infinity, ...sources.map((s) => s.surface - sill));
  const lifted = sill === null ? -Infinity : Math.max(-Infinity, ...sources.map((s) => s.surface - sill + (s.pump ? pumpLift() : 0)));
  const head = Math.max(gravity, lifted);
  // The same steady flow the laid main will report. @see plannedFlow
  const flow = field && sill !== null && sources.length ? plannedFlow(g, field, plan, pump) : 0;
  const needsPump = sill !== null && sources.length > 0 && !(gravity > 0) && !sources.some((s) => s.pump) && gravity + pumpLift() > 0;
  const problem = ends.includes("Goes nowhere") ? "This end goes nowhere: end it at water, an inlet of a building that drinks, or another main"
    : sill === null ? "Feeds nothing: end it at an inlet of the Data Centre or one of the AI's buildings"
    : !sources.length ? "Draws from nothing: start it at water"
    : flow > 0 ? null
    : needsPump ? `The water ${gravity < 0 ? `is ${Math.round(-gravity) / 2} slab${Math.round(-gravity) === 2 ? "" : "s"} below` : "is level with"} the building's floor: it needs a pump`
    : "The water is too far below the building, even for a pump";
  return { fresh, flow, head: Number.isFinite(head) ? head : 0, ends, problem, needsPump, building };
}

/**
 * What a planned main would carry once laid and settled, by the solver: the
 * plan laid on a copy of the map's mains, its network solved steady with
 * every building it reaches taking all it is given. Into the building at the
 * plan's own outlet, if it has one; else all the network would deliver.
 */
function plannedFlow(g: Grid, field: WaterField, plan: readonly MainCell[], pump: boolean): number {
  const laid = laidCopy(g, plan, pump);
  const graph = pipeGraph(laid);
  const at = plan.map((c) => graph.nodeAt.main[idx(g, c.x, c.y)]).find((k) => k >= 0);
  if (at === undefined) return 0;
  const m = waterModel(graph, graph.nodes[at].system);
  const { outs, env } = surroundings(laid, field, m);
  const steady = steadyFlow(m, env(true, outs.map((o) => o.building >= 0)));
  const ends = new Set([plan[0], plan[plan.length - 1]].map((c) => idx(g, c.x, c.y)));
  const own = m.outlets.findIndex((o) => ends.has(o.cell));
  // Fouled water cools less, as the laid main will say. @see coolingKept
  const live = m.intakes.map((t) => intakeWater(laid, field, t.cell)).filter((w): w is NonNullable<typeof w> => !!w).sort((a, b) => b.surface - a.surface)[0];
  const kept = coolingKept(live ? pollutionAt(field, tileOf(live.column % field.columns.nx), tileOf(Math.floor(live.column / field.columns.nx))) : 0);
  return (own >= 0 ? steady.out[own] : steady.out.reduce((n, q) => n + q, 0)) * kept;
}

/** The map with a planned main laid on a copy of its mains: for asking of a main what it would do, before it is there. */
export function laidCopy(g: Grid, plan: readonly MainCell[], pump = false): Grid {
  const laid: Grid = { ...g, main: g.main.slice(), mainEnd: g.mainEnd.slice() };
  for (const c of plan) {
    const i = idx(g, c.x, c.y);
    laid.main[i] |= c.join;
    if (c.end) laid.mainEnd[i] = c.end === MAIN_END.intake && pump ? MAIN_END.pump : c.end;
  }
  return laid;
}

/**
 * A WATER MAIN'S PROFILE through a tile of it: from the intake whose water
 * stands highest to the building it feeds — by way of that tile, where its
 * network has more than one outlet — with the level its water can rise to at
 * each tile, off the same steady solve its card quotes. `pumpsOn` false reads
 * a pump as an intake. Null where the tile has no water main. @see PipeProfile
 */
export function mainProfile(g: Grid, field: WaterField | null, at: number, pumpsOn = true): PipeProfile | null {
  const graph = pipeGraph(g), id = graph.mainOf[at];
  const net = id >= 0 ? graph.mains[id] : undefined;
  const node = net?.cells.find((c) => graph.nodeAt.main[c] >= 0);
  if (!net || net.sewer || node === undefined) return null;
  const m = waterModel(graph, graph.nodes[graph.nodeAt.main[node]].system);
  /** Tile by tile along the joins from one tile to another; empty with no way. */
  const way = (from: number, to: number): number[] => {
    const prev = new Map<number, number>([[from, -1]]), queue = [from];
    for (let q = 0; q < queue.length && !prev.has(to); q++) {
      const i = queue[q], x = i % g.w, y = (i / g.w) | 0;
      for (const side of SIDES) {
        if (!joined(g, x, y, side)) continue;
        const j = idx(g, x + NEIGHBOUR[side][0], y + NEIGHBOUR[side][1]);
        if (!prev.has(j)) { prev.set(j, i); queue.push(j); }
      }
    }
    const out: number[] = [];
    for (let c = prev.has(to) ? to : -1; c >= 0; c = prev.get(c)!) out.push(c);
    return out.reverse();
  };
  const sur = field ? surroundings(g, field, m) : null;
  const steady = sur ? steadyFlow(m, sur.env(pumpsOn, sur.outs.map((o) => o.building >= 0))) : null;
  // FROM its highest water — else any intake, else its first tile.
  let from = -1, top = -Infinity;
  m.intakes.forEach((t, k) => {
    const w = sur?.waters[k];
    const h = w ? w.surface + (t.pump && pumpsOn ? pumpLift() : 0) : -1e9 + k;
    if (h > top) { top = h; from = k; }
  });
  const start = from >= 0 ? m.intakes[from].cell : net.cells[0];
  // TO the building: the outlet the tile asked about lies on the way to, else the first that feeds one, else that tile.
  const fed = m.outlets.map((o, k) => ({ o, k })).filter(({ k }) => (sur ? sur.outs[k].building >= 0 : true));
  const through = fed.find(({ o }) => { const w = way(start, o.cell); return w.includes(at); }) ?? fed[0];
  const cells = way(start, through ? through.o.cell : at);
  if (cells.length < 2) return null;
  // THE HEAD at each tile: its node's, or between the two its run lies between.
  const headAt = new Map<number, number>();
  if (steady) {
    m.nodes.forEach((n, k) => headAt.set(graph.nodes[n].cell, steady.head[k]));
    for (const l of m.links) {
      const run = graph.links[l.graph].cells, ha = steady.head[l.a], hb = steady.head[l.b];
      run.forEach((c, k) => { if (!headAt.has(c)) headAt.set(c, ha + ((hb - ha) * k) / (run.length - 1)); });
    }
  }
  const water = from >= 0 ? sur?.waters[from] ?? null : null;
  const head = cells.map((c) => { const h = water ? headAt.get(c) : undefined; return h === undefined || Number.isNaN(h) ? null : h; });
  const floor = through && sur && Number.isFinite(sur.outs[through.k].sill) ? sur.outs[through.k].sill : null;
  // AT FAULT where the water cannot rise to the building's floor: all of it if it never does, else nothing — a main that flows has cleared it.
  const short = floor !== null && water !== null && !(steady && steady.out[through!.k] > 0);
  const bad = short ? runsOf(head.map((h) => h === null || h <= floor!)) : [];
  const lifted = from >= 0 && m.intakes[from].pump && pumpsOn && !!water;
  return {
    kind: "main", cells, ground: cells.map((c) => g.height[c]), pipe: cells.map((c) => g.height[c]),
    head: water ? head : null, source: water ? water.surface : null, floor, spans: null,
    marks: [...(lifted ? [{ at: 0, kind: "pump" as const }] : []), ...(through ? [{ at: cells.length - 1, kind: "exit" as const }] : [])],
    bad, reason: bad.length ? "The water cannot rise to the building's floor" : null,
  };
}

/**
 * THE OLD PIPES, MADE MAINS: a map laid with the game's old pipes — cells
 * with a facing, joined to whatever pipe touched them — gets mains in their
 * place, joined exactly as they were (every pair of touching cells), and each
 * old opening fitted as it behaved: into a building that drinks an outlet, at
 * a pump house a pump intake, at water an intake, else a cap. The old cells
 * are cleared. Whether anything changed. @see plans/pipes-overhaul.md §5
 */
export function pipesToMains(g: Grid, wet: (x: number, y: number) => boolean = (x, y) => g.pool[idx(g, x, y)] > 0): boolean {
  let changed = false;
  for (let i = 0; i < g.pipe.length; i++) {
    const facing = g.pipe[i];
    if (!facing) continue;
    const x = i % g.w, y = (i / g.w) | 0;
    let mask = 0;
    for (const side of SIDES) {
      const [dx, dy] = NEIGHBOUR[side];
      if (inBounds(g, x + dx, y + dy) && g.pipe[idx(g, x + dx, y + dy)]) mask |= DIR[side];
    }
    g.main[i] |= mask;
    // An opening: a facing with no pipe across it.
    if (!(mask & facing) && !g.mainEnd[i]) {
      const side = SIDES.find((s) => DIR[s] === facing)!;
      const [dx, dy] = NEIGHBOUR[side];
      const tx = x + dx, ty = y + dy;
      const id = inBounds(g, tx, ty) ? structureAt(g, tx, ty) : -1;
      const s = id >= 0 ? g.structures.get(id) : undefined;
      g.mainEnd[i] = s && isDrinker(s.def) ? MAIN_END.outlet
        : s?.def === "pump" ? MAIN_END.pump
        : inBounds(g, tx, ty) && wet(tx, ty) ? MAIN_END.intake
        : MAIN_END.cap;
    }
    changed = true;
  }
  // A PUMP HOUSE the old pipes drew through becomes the main's pump intake:
  // the house comes down, and the main runs on onto its tile, beside its water.
  if (changed) {
    for (let i = 0; i < g.mainEnd.length; i++) {
      if (g.mainEnd[i] !== MAIN_END.pump) continue;
      const x = i % g.w, y = (i / g.w) | 0;
      for (const side of SIDES) {
        const [dx, dy] = NEIGHBOUR[side];
        const id = inBounds(g, x + dx, y + dy) ? structureAt(g, x + dx, y + dy) : -1;
        if (id < 0 || g.structures.get(id)?.def !== "pump") continue;
        g.structures.delete(id);
        const pi = idx(g, x + dx, y + dy);
        g.structureAt[pi] = -1;
        g.main[i] |= DIR[side];
        g.main[pi] |= DIR[OPPOSITE[side]];
        g.mainEnd[i] = 0;
        g.mainEnd[pi] = MAIN_END.pump;
        break;
      }
    }
    g.pipe.fill(0);
    g.pipeZ.fill(0);
    edited(g);
  }
  return changed;
}

/**
 * OLD MAINS, ONTO PORTS: a main laid before buildings had inlets, its outlet
 * against a drinking building's wall away from them, is run on round the
 * wall to the nearest free inlet — the same bore, the AI's still the AI's —
 * and the old end becomes a length of run. One with no way round is left as
 * it was, feeding nothing, for the Water overlay to show. Whether anything
 * changed. @see plans/pipes-and-slop.md §2
 */
export function mainsToPorts(g: Grid, wet: (x: number, y: number) => boolean): boolean {
  let changed = false;
  for (let i = 0; i < g.mainEnd.length; i++) {
    if (g.mainEnd[i] !== MAIN_END.outlet || outletBuilding(g, i) >= 0) continue;
    const s = wallAt(g, i, drinker);
    if (!s) continue;
    const from = { x: i % g.w, y: (i / g.w) | 0 };
    const p = nearestPort(g, s, from, (j) => hasMain(g, j));
    const route = p && routeMain(g, from, { x: p.x, y: p.y }, wet);
    const plan = route && route.length > 1 ? planMain(g, route, wet) : null;
    if (!plan || "refused" in plan) continue;
    const flags = g.main[i] & (MAIN_BORE | MAIN_AI);
    g.mainEnd[i] = 0;
    for (const c of plan.cells) {
      const j = idx(g, c.x, c.y);
      g.main[j] |= c.join | (j === i ? 0 : flags);
      if (c.end) g.mainEnd[j] = c.end;
    }
    changed = true;
  }
  if (changed) edited(g);
  return changed;
}

/**
 * STUBS: a workplace whose slop port is free and has a sewer beside it is
 * joined to it, a tile of sewer from the port to the trunk, laid by itself;
 * and a stub whose trunk or workplace has gone is taken up. Whether anything
 * changed. @see plans/pipes-and-slop.md §3
 */
export function sewerStubs(g: Grid): boolean {
  let changed = false;
  // GONE: a stub no longer joined to a sewer, or in front of no port.
  for (let i = 0; i < g.main.length; i++) {
    if (!(g.main[i] & MAIN_STUB)) continue;
    const x = i % g.w, y = (i / g.w) | 0;
    if (portsAt(g, i, "slop", "out").length && SIDES.some((side) => joined(g, x, y, side))) continue;
    for (const side of SIDES) {
      if (!(g.main[i] & DIR[side])) continue;
      const [dx, dy] = NEIGHBOUR[side];
      if (inBounds(g, x + dx, y + dy)) g.main[idx(g, x + dx, y + dy)] &= ~DIR[OPPOSITE[side]];
    }
    g.main[i] = 0;
    g.mainEnd[i] = 0;
    changed = true;
  }
  // LAID: from each free slop port to a sewer beside it.
  for (const s of g.structures.values()) {
    for (const p of portsOf(g, s)) {
      if (p.port.fluid !== "slop" || p.port.dir !== "out" || hasMain(g, p.i) || structureAt(g, p.x, p.y) >= 0) continue;
      const side = SIDES.find((d) => {
        const [dx, dy] = NEIGHBOUR[d];
        return inBounds(g, p.x + dx, p.y + dy) && isSewer(g, idx(g, p.x + dx, p.y + dy));
      });
      if (!side) continue;
      const [dx, dy] = NEIGHBOUR[side], j = idx(g, p.x + dx, p.y + dy);
      g.main[p.i] = DIR[side] | MAIN_SEWER | MAIN_STUB;
      g.mainEnd[p.i] = MAIN_END.drain;
      g.main[j] |= DIR[OPPOSITE[side]];
      // A capped end it meets runs on into the stub.
      if (g.mainEnd[j] === MAIN_END.cap) g.mainEnd[j] = 0;
      changed = true;
    }
  }
  if (changed) edited(g);
  return changed;
}

/**
 * WHAT A SEWER WOULD DO, before it is laid, for the tool's card: what it
 * costs in new tiles, what each end is, what it would carry — or why not.
 * Its own ends, or the sewer it joins, give its workplaces and its sinks.
 */
export function previewSewer(g: Grid, plan: readonly MainCell[]): { fresh: number; capacity: number; ends: string[]; problem: string | null } {
  const fresh = plan.filter((c) => !hasMain(g, idx(g, c.x, c.y))).length;
  const nets = findMains(g);
  let sources = 0, sinks = 0;
  const ends: string[] = [];
  const nameOf = (id: number) => structureDef(g.structures.get(id)?.def ?? "")?.name ?? "building";
  for (const c of [plan[0], plan[plan.length - 1]]) {
    const i = idx(g, c.x, c.y);
    const joinedNet = hasMain(g, i) ? nets.list[nets.of[i]] : undefined;
    if (joinedNet) {
      ends.push("Joins a sewer");
      sources += sewerSources(g, joinedNet).length;
      sinks += joinedNet.outfalls.length + joinedNet.outlets.length;
    } else if (c.end === MAIN_END.drain) {
      sources++;
      ends.push(`Drains the ${nameOf(portsAt(g, i, "slop", "out")[0].building)}`);
    } else if (c.end === MAIN_END.outlet) {
      sinks++;
      ends.push(`Feeds the ${nameOf(portsAt(g, i, "slop", "in")[0].building)}`);
    } else if (c.end === MAIN_END.outfall) {
      sinks++;
      ends.push("Pours into the water");
    } else ends.push("Goes nowhere");
  }
  const problem = ends.includes("Goes nowhere") ? "This end goes nowhere: end it at a slop port, water, or another sewer"
    : !sources ? "Drains nothing: start it at a workplace's slop port"
    : !sinks ? "Goes nowhere: end it at water, or a processor's inlet"
    : null;
  return { fresh, capacity: sewerFlow(), ends, problem };
}
