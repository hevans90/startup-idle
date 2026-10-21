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
import { PUMP_MOST, mainFlow, pumpLift } from "../../game/mains";
import { DIR, NEIGHBOUR } from "../../iso/dir";
import { MAIN_END, edited, idx, inBounds, structureAt, type Grid } from "../grid";
import { fillTank, tankRoom } from "../projects/cooling";
import { COLUMNS_PER_TILE, columnOf, type WaterField } from "./field";

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

/** One network of mains: its cells, its intakes and outlets by cell, its length in tiles. */
export type MainNet = { id: number; cells: number[]; intakes: number[]; outlets: number[] };

const nets = new WeakMap<Grid, { rev: number; list: MainNet[]; of: Int32Array }>();

/** Every network on the map, and which each cell is in (−1 for none): flooded over the joins, kept till the map changes. */
export function findMains(g: Grid): { list: MainNet[]; of: Int32Array } {
  const seen = nets.get(g);
  if (seen && seen.rev === g.rev) return seen;
  const of = new Int32Array(g.w * g.h).fill(-1);
  const list: MainNet[] = [];
  for (let start = 0; start < of.length; start++) {
    if (!hasMain(g, start) || of[start] >= 0) continue;
    const id = list.length, net: MainNet = { id, cells: [], intakes: [], outlets: [] };
    const queue = [start];
    of[start] = id;
    for (let q = 0; q < queue.length; q++) {
      const i = queue[q], x = i % g.w, y = (i / g.w) | 0;
      net.cells.push(i);
      const end = g.mainEnd[i];
      if (end === MAIN_END.intake || end === MAIN_END.pump) net.intakes.push(i);
      else if (end === MAIN_END.outlet) net.outlets.push(i);
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
export function intakeWater(g: Grid, field: WaterField, i: number): { column: number; surface: number } | null {
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
  return best && { column: best.column, surface: best.surface };
}

/** The building that drinks an outlet feeds — any side of it, any tile of the building — by id; −1 with none. */
export function outletBuilding(g: Grid, i: number): number {
  const x = i % g.w, y = (i / g.w) | 0;
  for (const side of SIDES) {
    const [dx, dy] = NEIGHBOUR[side];
    if (!inBounds(g, x + dx, y + dy)) continue;
    const id = structureAt(g, x + dx, y + dy);
    const s = id >= 0 ? g.structures.get(id) : undefined;
    if (s && !s.build && isDrinker(s.def)) return id;
  }
  return -1;
}

/**
 * WHAT A NETWORK IS DOING, and why, for the game to say:
 *  - `flowing`: carrying water into its buildings;
 *  - `full`: it could, and every tank it feeds is full;
 *  - `dry`: every intake's water has gone;
 *  - `no-head`: the water stands too low to reach the building — it needs a pump;
 *  - `unpaid`: its pump wants paying and the company cannot;
 *  - `no-source` / `no-outlet`: it has no intake, or feeds nothing.
 */
export type MainState = "flowing" | "full" | "dry" | "no-head" | "unpaid" | "no-source" | "no-outlet";
export type MainReport = {
  state: MainState;
  /** Half steps of head to its best-placed outlet; units a second it could carry, and carried this frame. */
  head: number;
  capacity: number;
  flow: number;
  /** Tiles long. */
  length: number;
  /** Each outlet's building, what it could take a second, and whether a pump is doing the lifting. */
  outlets: { cell: number; building: number; capacity: number; pumped: boolean }[];
  /** Each intake's water surface, or null if dry; whether it is a pump. */
  intakes: { cell: number; surface: number | null; pump: boolean }[];
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
    return { cell, surface: w ? w.surface : null, pump: g.mainEnd[cell] === MAIN_END.pump };
  });
  const live = intakes.filter((k) => k.surface !== null);
  const pumps = live.filter((k) => k.pump).length;
  const outlets = net.outlets.map((cell) => {
    const building = outletBuilding(g, cell);
    // The building's floor: the water has to stand as high as it to go in.
    const b = building >= 0 ? g.structures.get(building) : undefined;
    const sill = b ? g.height[idx(g, b.x, b.y)] : Infinity;
    let head = -Infinity, pumped = false;
    for (const k of live) {
      const gravity = k.surface! - sill;
      if (gravity > head) { head = gravity; pumped = false; }
      if (k.pump && pumpsOn && gravity + pumpLift() > head) { head = gravity + pumpLift(); pumped = true; }
    }
    let capacity = building >= 0 ? mainFlow(head, length) : 0;
    if (pumped) capacity = Math.min(capacity, (PUMP_MOST * pumps) / Math.max(1, net.outlets.length));
    return { cell, building, capacity, pumped, head };
  });
  const capacity = outlets.reduce((n, o) => n + o.capacity, 0);
  const head = outlets.reduce((m, o) => Math.max(m, o.head), -Infinity);
  const state: MainState = !net.intakes.length ? "no-source"
    : !outlets.some((o) => o.building >= 0) ? "no-outlet"
    : !live.length ? "dry"
    : capacity <= 0 ? "no-head"
    : "flowing";
  return { state, head: Number.isFinite(head) ? head : 0, capacity, flow: 0, length, outlets: outlets.map(({ cell, building, capacity, pumped }) => ({ cell, building, capacity, pumped })), intakes };
}

/** How pump intakes are paid: for `seconds` of running, whether it was. In the editor, free. */
export type MainPumps = { pay: (seconds: number) => boolean };
const FREE: MainPumps = { pay: () => true };

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
  for (const net of list) {
    let r = solveMain(g, field, net);
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

/** A cell of a main to lay: the sides it joins, added to what is there, and its end fitting if it is an end. */
export type MainCell = { x: number; y: number; join: number; end: number };

/**
 * A MAIN TO LAY along `cells`, in order: each cell joined to the next, and
 * each end — unless it lands on a main already laid, where it JOINS that one —
 * fitted to what it reaches: an OUTLET beside a building that drinks, an
 * INTAKE on or beside water (a PUMP intake with `pump`), or a CAP. Refused
 * through a building, across another main, or a single tile. Pure.
 */
export function planMain(
  g: Grid, cells: readonly { x: number; y: number }[],
  wet: (x: number, y: number) => boolean, pump = false,
): { cells: MainCell[]; joins: number } | { refused: string } {
  if (cells.length < 2) return { refused: "Drag from the water to a building to lay a main" };
  for (const [k, c] of cells.entries()) {
    if (!inBounds(g, c.x, c.y)) return { refused: "Off the map" };
    if (structureAt(g, c.x, c.y) >= 0) return { refused: "A main can't go through a building" };
    const end = k === 0 || k === cells.length - 1;
    if (!end && hasMain(g, idx(g, c.x, c.y))) return { refused: "End the run on the other main to join it" };
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
      const drinks = (x: number, y: number) => { const id = structureAt(g, x, y); const s = id >= 0 ? g.structures.get(id) : undefined; return !!s && !s.build && isDrinker(s.def); };
      end = beside(drinks) ? MAIN_END.outlet : wet(c.x, c.y) || beside(wet) ? (pump ? MAIN_END.pump : MAIN_END.intake) : MAIN_END.cap;
    }
    out.push({ x: c.x, y: c.y, join, end });
  }
  return { cells: out, joins };
}

/** Lay a planned main on the map: its joins added to what is there, its fittings set. Bumps the map. */
export function layMain(g: Grid, plan: readonly MainCell[]): void {
  for (const c of plan) {
    const i = idx(g, c.x, c.y);
    g.main[i] |= c.join;
    if (c.end) g.mainEnd[i] = c.end;
  }
  edited(g);
}
