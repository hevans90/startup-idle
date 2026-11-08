/**
 * World v2 — THE WATER MAINS on the map: the game's pipes. A main is a run of
 * cells joined only where a stroke joined them (`grid.main`, `DIR` bits on
 * both sides of a face), with a fitting at each end (`grid.mainEnd`): an
 * INTAKE at water, a PUMP intake, an OUTLET into a building that drinks, or a
 * CAP. Not simulated cell by cell, as the editor's spouts are: each network
 * is SOLVED — the head from its best intake to each outlet, and so what it
 * carries — and that much is taken out of the water and put into the tanks,
 * every frame. A dry intake stops the flow and nothing is ever poured out.
 * Each network's state is kept, so the game can always say what a main is
 * doing and why. @see game/mains, plans/pipes-overhaul.md
 */
import { surfaceAt, wantDepth, addWater } from "../../fluid/columns";
import { isDrinker } from "../../game/cooling";
import { PUMP_MOST, mainFlow, pumpLift, sewerFlow } from "../../game/mains";
import { coolingKept } from "../../game/pollution";
import { DIR, NEIGHBOUR } from "../../iso/dir";
import { MAIN_AI, MAIN_BORE, MAIN_END, MAIN_SEWER, MAIN_STUB, edited, idx, inBounds, structureAt, type Grid, type Structure } from "../grid";
import { fillTank, tankRoom } from "../projects/cooling";
import { structureDef } from "../structures/def";
import { COLUMNS_PER_TILE, columnOf, tileOf, type WaterField } from "./field";
import { pollutionAt } from "./pollution";
import { nearestPort, portsAt, portsOf, wallAt } from "./ports";
import type { Port } from "../structures/def";

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

/**
 * One network of mains: its cells, its intakes and outlets by cell; its BORE
 * — 2 once every tile of it is widened, else 1 — whether the AI laid it, and
 * whether it is a SEWER, with its outfalls into water by cell.
 */
export type MainNet = { id: number; cells: number[]; intakes: number[]; outlets: number[]; outfalls: number[]; bore: number; ai: boolean; sewer: boolean };

const nets = new WeakMap<Grid, { rev: number; list: MainNet[]; of: Int32Array }>();

/** Every network on the map, and which each cell is in (−1 for none): flooded over the joins, kept till the map changes. */
export function findMains(g: Grid): { list: MainNet[]; of: Int32Array } {
  const seen = nets.get(g);
  if (seen && seen.rev === g.rev) return seen;
  const of = new Int32Array(g.w * g.h).fill(-1);
  const list: MainNet[] = [];
  for (let start = 0; start < of.length; start++) {
    if (!hasMain(g, start) || of[start] >= 0) continue;
    const id = list.length, net: MainNet = { id, cells: [], intakes: [], outlets: [], outfalls: [], bore: 2, ai: false, sewer: false };
    const queue = [start];
    of[start] = id;
    for (let q = 0; q < queue.length; q++) {
      const i = queue[q], x = i % g.w, y = (i / g.w) | 0;
      net.cells.push(i);
      if (!(g.main[i] & MAIN_BORE)) net.bore = 1;
      if (g.main[i] & MAIN_AI) net.ai = true;
      if (g.main[i] & MAIN_SEWER) net.sewer = true;
      const end = g.mainEnd[i];
      if (end === MAIN_END.intake || end === MAIN_END.pump) net.intakes.push(i);
      else if (end === MAIN_END.outlet) net.outlets.push(i);
      else if (end === MAIN_END.outfall) net.outfalls.push(i);
      for (const side of SIDES) {
        if (!joined(g, x, y, side)) continue;
        const [dx, dy] = NEIGHBOUR[side];
        const j = idx(g, x + dx, y + dy);
        if (of[j] >= 0) continue;
        of[j] = id;
        queue.push(j);
      }
    }
    list.push(net);
  }
  const out = { rev: g.rev, list, of };
  nets.set(g, out);
  return out;
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

/**
 * WHAT A NETWORK IS DOING, and why, for the game to say:
 *  - `flowing`: carrying water into its buildings;
 *  - `full`: it could, and every tank it feeds is full;
 *  - `dry`: every intake's water has gone;
 *  - `no-head`: the water stands too low to reach the building — it needs a pump;
 *  - `unpaid`: its pump wants paying and the company cannot;
 *  - `no-source` / `no-outlet`: it has no intake, or feeds nothing.
 */
export type MainState = "flowing" | "full" | "dry" | "no-head" | "unpaid" | "no-source" | "no-outlet" | "burst" | "backed-up";

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
export type MainReport = {
  state: MainState;
  /** Half steps of head to its best-placed outlet; units a second it could carry, and carried this frame. */
  head: number;
  capacity: number;
  flow: number;
  /** Tiles long; its bore, 1 or 2. */
  length: number;
  bore: number;
  /** Each outlet's building, what it could take a second, and whether a pump is doing the lifting. */
  outlets: { cell: number; building: number; capacity: number; pumped: boolean }[];
  /** Each intake's water surface, or null if dry, how deep it stands there, and how fouled (nought to one); whether it is a pump. */
  intakes: { cell: number; surface: number | null; depth: number; pump: boolean; fouled: number }[];
  /** A SEWER's: the workplaces it takes slop from, by id, and its outfalls by cell. Empty for a water main. */
  sewer?: { sources: number[]; outfalls: number[] };
};

/**
 * A NETWORK SOLVED, from the water as it stands: for each outlet, the head
 * from the best intake — a pump's lifted by its lift — over the building's
 * floor, and what that carries over the run's length. Pure on the map and
 * the water; no water moves. `pumpsOn` false reads a pump as an intake.
 */
export function solveMain(g: Grid, field: WaterField, net: MainNet, pumpsOn = true): MainReport {
  const length = net.cells.length;
  const intakes = net.intakes.map((cell) => {
    const w = intakeWater(g, field, cell);
    // HOW FOULED the water it draws is, on the tile its water stands on. @see coolingKept
    const fouled = w ? pollutionAt(field, tileOf(w.column % field.columns.nx), tileOf(Math.floor(w.column / field.columns.nx))) : 0;
    return { cell, surface: w ? w.surface : null, depth: w ? w.depth : 0, pump: g.mainEnd[cell] === MAIN_END.pump, fouled };
  });
  const live = intakes.filter((k) => k.surface !== null);
  const pumps = live.filter((k) => k.pump).length;
  const outlets = net.outlets.map((cell) => {
    const building = outletBuilding(g, cell);
    // The building's floor: the water has to stand as high as it to go in.
    const b = building >= 0 ? g.structures.get(building) : undefined;
    const sill = b ? g.height[idx(g, b.x, b.y)] : Infinity;
    let head = -Infinity, pumped = false, from: (typeof live)[number] | null = null;
    for (const k of live) {
      const gravity = k.surface! - sill;
      if (gravity > head) { head = gravity; pumped = false; from = k; }
      if (k.pump && pumpsOn && gravity + pumpLift() > head) { head = gravity + pumpLift(); pumped = true; from = k; }
    }
    let capacity = building >= 0 ? mainFlow(head, length, net.bore) : 0;
    // A pump moves as much again through a widened bore.
    if (pumped) capacity = Math.min(capacity, (PUMP_MOST * pumps * net.bore) / Math.max(1, net.outlets.length));
    // Fouled water cools less: as good as so much less of it, pumped or not. @see coolingKept
    capacity *= coolingKept(from?.fouled ?? 0);
    return { cell, building, capacity, pumped, head };
  });
  const capacity = outlets.reduce((n, o) => n + o.capacity, 0);
  const head = outlets.reduce((m, o) => Math.max(m, o.head), -Infinity);
  const state: MainState = !net.intakes.length ? "no-source"
    : !outlets.some((o) => o.building >= 0) ? "no-outlet"
    : !live.length ? "dry"
    : capacity <= 0 ? "no-head"
    : "flowing";
  return { state, head: Number.isFinite(head) ? head : 0, capacity, flow: 0, length, bore: net.bore, outlets: outlets.map(({ cell, building, capacity, pumped }) => ({ cell, building, capacity, pumped })), intakes };
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
  const processors = net.outlets.filter((i) => portsAt(g, i, "slop", "in").length > 0);
  const state: MainState = !sources.length ? "no-source" : !processors.length && !net.outfalls.length ? "no-outlet" : "flowing";
  return {
    state, head: 0, capacity: sewerFlow(net.bore), flow: 0, length: net.cells.length, bore: net.bore,
    outlets: processors.map((cell) => ({ cell, building: portsAt(g, cell, "slop", "in")[0].building, capacity: sewerFlow(net.bore), pumped: false })),
    intakes: [], sewer: { sources, outfalls: net.outfalls },
  };
}

/** How pump intakes are paid: for `seconds` of running, whether it was. In the editor, free. */
export type MainPumps = { pay: (seconds: number) => boolean };
const FREE: MainPumps = { pay: () => true };

/** The map's revision its stubs were last laid for. */
const stubbed = new WeakMap<Grid, number>();

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
  // STUBS from workplaces to the sewers beside them, as the map now stands. @see sewerStubs
  if (stubbed.get(g) !== g.rev) { sewerStubs(g); stubbed.set(g, g.rev); }
  const { list, of } = findMains(g);
  const out = new Map<number, MainReport>();
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
    let r = solveMain(g, field, net);
    // BURST: what it would carry drawn as ever, and poured out at the joint. @see setBurst
    if (burstAt !== null && of[burstAt] === net.id) {
      const pour = r.capacity * dt;
      let left = pour;
      const from = r.intakes.filter((k) => k.surface !== null).map((k) => intakeWater(g, field, k.cell)!).sort((a, b) => b.surface - a.surface);
      for (const s of from) {
        if (left <= 0) break;
        const take = Math.min(left, field.columns.depth[s.column]);
        if (take > 0) addWater(field.columns, s.column % field.columns.nx, (s.column / field.columns.nx) | 0, -take);
        left -= take;
      }
      const mid = Math.floor(COLUMNS_PER_TILE / 2), bx = burstAt % g.w, by = (burstAt / g.w) | 0;
      if (pour - left > 0) addWater(field.columns, columnOf(bx) + mid, columnOf(by) + mid, pour - left);
      out.set(net.cells[0], { ...r, state: "burst", flow: 0, outlets: r.outlets.map((o) => ({ ...o, capacity: 0 })) });
      continue;
    }
    const wants = r.outlets.some((o) => o.building >= 0 && tankRoom(o.building) > 0);
    if (r.outlets.some((o) => o.pumped) && wants && !pumps.pay(dt)) {
      r = { ...solveMain(g, field, net, false), state: "unpaid" };
      if (r.capacity > 0) r.state = "flowing";
    }
    let took = 0;
    for (const o of r.outlets) if (o.building >= 0 && o.capacity > 0) took += fillTank(o.building, o.capacity * dt);
    // What went in comes out of the water: from the intakes that have it, the deepest first.
    let left = took;
    const sources = r.intakes.filter((k) => k.surface !== null).map((k) => intakeWater(g, field, k.cell)!).sort((a, b) => b.surface - a.surface);
    for (const s of sources) {
      if (left <= 0) break;
      const there = field.columns.depth[s.column];
      const take = Math.min(left, there);
      if (take > 0) addWater(field.columns, s.column % field.columns.nx, (s.column / field.columns.nx) | 0, -take);
      left -= take;
    }
    r.flow = dt > 0 ? took / dt : 0;
    if (r.state === "flowing" && took <= 0) r.state = "full";
    out.set(net.cells[0], r);
  }
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

/** Every network's report from the last frame. */
export const mainReports = (): ReadonlyMap<number, MainReport> => reports;
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
    g.main[i] |= c.join | (sewer ? MAIN_SEWER : 0);
    if (c.end) g.mainEnd[i] = c.end;
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
 * inlet. Null where there is no way. Pure.
 */
export function routeMain(
  g: Grid, from: { x: number; y: number }, to: { x: number; y: number },
  wet: (x: number, y: number) => boolean, sewer = false,
): { x: number; y: number }[] | null {
  if (!inBounds(g, from.x, from.y) || !inBounds(g, to.x, to.y)) return null;
  from = snapToPort(g, from, wet, sewer ? "slop" : "water");
  to = snapToPort(g, to, wet, sewer ? "slop" : "water");
  if (from.x === to.x && from.y === to.y) return [from];
  const n = g.w * g.h, start = idx(g, from.x, from.y), goal = idx(g, to.x, to.y);
  const free = (i: number) => {
    const x = i % g.w, y = (i / g.w) | 0;
    if (structureAt(g, x, y) >= 0) return false;
    if (i === start || i === goal) return true;
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
  const length = plan.length;
  const head = Math.max(gravity, lifted);
  let flow = mainFlow(head, length);
  if (lifted > gravity && lifted > 0) flow = Math.min(flow, PUMP_MOST);
  const needsPump = sill !== null && sources.length > 0 && !(gravity > 0) && !sources.some((s) => s.pump) && gravity + pumpLift() > 0;
  const problem = ends.includes("Goes nowhere") ? "This end goes nowhere: end it at water, an inlet of a building that drinks, or another main"
    : sill === null ? "Feeds nothing: end it at an inlet of the Data Centre or one of the AI's buildings"
    : !sources.length ? "Draws from nothing: start it at water"
    : flow > 0 ? null
    : needsPump ? `The water ${gravity < 0 ? `is ${Math.round(-gravity) / 2} slabs below` : "is level with"} the building's floor: it needs a pump`
    : "The water is too far below the building, even for a pump";
  return { fresh, flow, head: Number.isFinite(head) ? head : 0, ends, problem, needsPump };
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
