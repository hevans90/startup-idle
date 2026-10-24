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
import { MAIN_AI, MAIN_BORE, MAIN_END, edited, idx, inBounds, structureAt, type Grid } from "../grid";
import { fillTank, tankRoom } from "../projects/cooling";
import { structureDef } from "../structures/def";
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

/**
 * One network of mains: its cells, its intakes and outlets by cell; its BORE
 * — 2 once every tile of it is widened, else 1 — and whether the AI laid it.
 */
export type MainNet = { id: number; cells: number[]; intakes: number[]; outlets: number[]; bore: number; ai: boolean };

const nets = new WeakMap<Grid, { rev: number; list: MainNet[]; of: Int32Array }>();

/** Every network on the map, and which each cell is in (−1 for none): flooded over the joins, kept till the map changes. */
export function findMains(g: Grid): { list: MainNet[]; of: Int32Array } {
  const seen = nets.get(g);
  if (seen && seen.rev === g.rev) return seen;
  const of = new Int32Array(g.w * g.h).fill(-1);
  const list: MainNet[] = [];
  for (let start = 0; start < of.length; start++) {
    if (!hasMain(g, start) || of[start] >= 0) continue;
    const id = list.length, net: MainNet = { id, cells: [], intakes: [], outlets: [], bore: 2, ai: false };
    const queue = [start];
    of[start] = id;
    for (let q = 0; q < queue.length; q++) {
      const i = queue[q], x = i % g.w, y = (i / g.w) | 0;
      net.cells.push(i);
      if (!(g.main[i] & MAIN_BORE)) net.bore = 1;
      if (g.main[i] & MAIN_AI) net.ai = true;
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
  /** Tiles long; its bore, 1 or 2. */
  length: number;
  bore: number;
  /** Each outlet's building, what it could take a second, and whether a pump is doing the lifting. */
  outlets: { cell: number; building: number; capacity: number; pumped: boolean }[];
  /** Each intake's water surface, or null if dry, and how deep it stands there; whether it is a pump. */
  intakes: { cell: number; surface: number | null; depth: number; pump: boolean }[];
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
    return { cell, surface: w ? w.surface : null, depth: w ? w.depth : 0, pump: g.mainEnd[cell] === MAIN_END.pump };
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
    let capacity = building >= 0 ? mainFlow(head, length, net.bore) : 0;
    // A pump moves as much again through a widened bore.
    if (pumped) capacity = Math.min(capacity, (PUMP_MOST * pumps * net.bore) / Math.max(1, net.outlets.length));
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

/**
 * A MAIN'S ROUTE from one tile to another, as the Pipe tool drags it: tile to
 * tile, round buildings, off water but for its ends, never across another
 * main but at its ends — and as straight as it can be, a turn costing half a
 * tile. Null where there is no way. Pure.
 */
export function routeMain(
  g: Grid, from: { x: number; y: number }, to: { x: number; y: number },
  wet: (x: number, y: number) => boolean,
): { x: number; y: number }[] | null {
  if (!inBounds(g, from.x, from.y) || !inBounds(g, to.x, to.y)) return null;
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
  const problem = ends.includes("Goes nowhere") ? "This end goes nowhere: end it at water, a building that drinks, or another main"
    : sill === null ? "Feeds nothing: end it beside the Data Centre or one of the AI's buildings"
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
