/**
 * World v2 — A ROAD IS BUILT, NOT BOUGHT. Dragging a road in the game orders
 * it: a JOB along the line, worked from one end to the other by four trades
 * that follow one another — earthworks, sub-base, surfacing, lining — and
 * opened to traffic a length at a time. @see plans/road-building.md
 *
 * A CELL UNDER CONSTRUCTION IS NOT ROAD. Nothing that reads the grid — the
 * network, the lanes, the markings, a bridge's art — sees any of a job until
 * a length of it opens, and then sees ordinary road. So nothing else has to
 * know that roads take time.
 *
 * A JOB IS GRADED AS A STROKE IS, by {@link gradeRoad} and with every one of
 * its refusals — but against the map AS IT WILL BE once every job under way
 * is done ({@link plannedGrid}), so a road can be ordered to join one not yet
 * built and no two jobs can ask different things of the same ground.
 *
 * Pure: what it would write is handed to its caller. @see world.store
 */
import { idx, inBounds, type Grid } from "../grid";
import { gradeRoad, type Grade, type GradeCell } from "./grade";
import { derivedRamp } from "./ramp-derive";

/**
 * THE COMPANY'S ROAD CREWS, each a trade and its machines, kept at the yard and sent to a job only when its phase is
 * about to begin — and on to the next job that wants that trade when it is done, or home. Each works one job at a
 * time. The SURVEYORS set the line out (their pickup); EARTHWORKS dig it (a digger on a low-loader, a tipper for the
 * spoil); the BASE crew lays the stone and pours the concrete (a packing roller on a low-loader, the stone's tipper, a
 * mixer); the TARRING crew surfaces it (the paver and its screed on a low-loader, the finishing roller on another);
 * the LINERS mark it (their pickup). @see fleet/crews, render/road-plant ROAD_UNITS
 */
export type RoadCrew = "survey" | "earth" | "base" | "tar" | "line";
export const ROAD_CREWS: readonly RoadCrew[] = ["survey", "earth", "base", "tar", "line"];
export const CREW_PLANT: Readonly<Record<RoadCrew, readonly import("../fleet/plant").PlantKind[]>> = {
  survey: ["pickup"], earth: ["loader", "tipper"], base: ["loader", "tipper", "mixer"], tar: ["loader", "loader"], line: ["pickup"],
};
/** The trade each crew works: the surveyors none of the four — theirs is the setting out. */
export const CREW_TRADE: Readonly<Record<RoadCrew, number>> = { survey: -1, earth: 0, base: 1, tar: 2, line: 3 };
export const TRADE_CREW: readonly RoadCrew[] = ["earth", "base", "tar", "line"];
/** A crew on a job: its machines (`false`: none come by road — no yard, no way — and the trade is simply worked), and that they have gone from it. @see fleet/crews */
export type Gang = { plant?: false | import("../fleet/plant").Plant; gone?: boolean; /** Sent on from here to that job, not home, when done. */ onward?: number };

/** A cell of a job: where, the level its road will stand at, whether that is a bridge's deck, the ground it was ordered on, and whether there is a road to build there at all. */
export type JobCell = { x: number; y: number; z: number; deck: boolean; from: number; fresh: boolean };
/** A road beside a job whose ramp is levelled for the junction: where, to what, from what, and the cell of the job it is levelled with. */
export type JobLevel = { x: number; y: number; to: number; from: number; at: number };
export type RoadJob = {
  id: number;
  /** ITS CREWS, each sent when its phase is about to begin: a trade is not worked till its crew is there, and the job not over till every crew has gone. Not there with no town to drive them (every trade then simply worked). @see fleet/crews */
  gangs?: Partial<Record<RoadCrew, Gang>>;
  cells: JobCell[];
  levelled: JobLevel[];
  /** Seconds the setting out has been worked: the surveyors' clock. */
  t: number;
  /** (Saved before each trade had its own clock: what the trades that lay something had worked. Read only to bring an old job's trades on. @see workOf) */
  tm?: number;
  /**
   * SECONDS EACH TRADE HAS WORKED, earthworks to lining: each on its own, only while its crew is there, never nearer
   * than {@link GAP} tiles to the one ahead, the sub-base no further than its loads. −1: not begun. @see stepRoadJobs
   */
  work?: number[];
  /** How many of its cells the earthworks have passed, and how many are open road. */
  dug: number;
  opened: number;
  /** Where a length may end: cell counts, rising, the last its whole length. @see lengthsOf */
  lengths: number[];
  /**
   * ITS MATERIALS, as a project's: loads arrived and loads needed, and what
   * they cost in all — each paid for as it is sent, none of it at the order.
   * The work runs only as far as the loads on site allow. @see TILES_PER_LOAD
   */
  delivered: number;
  deliveries: number;
  cost: number;
  /** Loads on their way that no lorry carries: seconds each has left. A job no road reaches is supplied so. @see OVERLAND */
  overland: number[];
  /** Seconds it has stood for want of a load it could not pay for; nought while it works. */
  stalled: number;
  /** When it was last worked, ms since the epoch — for the time away. */
  at: number;
  /** Whether its standing has been said: once a stall, not every frame of it. */
  told?: boolean;
};

/**
 * A ROAD IS SET OUT BEFORE IT IS DUG: a crew walks its line from the end it
 * starts at, in three steps that follow one another — pegs driven at every
 * corner, tape strung peg to peg, the centre sprayed on the ground. Seconds
 * before the first of them is on the line; seconds a tile; and tiles each
 * step follows the one ahead by.
 */
export const SET_IN = 2, SET_PACE = 3, SET_GAP = 2, SET_STEPS = 3;
/** Seconds of setting out before the earthworks may begin: the setting out well ahead of it by then, and faster than it ever after. */
export const ARRIVE = SET_IN + ((SET_STEPS - 1) * SET_GAP + 2) * SET_PACE;
/** How far along a job a step of its setting out has got, in cells from its first one's near edge: `step` 0 the pegs, 1 the tape, 2 the marks. */
export const setOutAt = (j: Pick<RoadJob, "t" | "cells">, step: number) => Math.max(0, Math.min(j.cells.length, (j.t - SET_IN) / SET_PACE - step * SET_GAP));
/** Seconds from its order until a job is set out from end to end. */
export const setOutSeconds = (j: Pick<RoadJob, "cells">) => SET_IN + (j.cells.length + (SET_STEPS - 1) * SET_GAP) * SET_PACE;
/**
 * Seconds a tile, each trade: the train of them moves this fast along a level
 * road. Slow enough to watch the work done — a bucket filled and tipped, a
 * lorry emptied, a mat raked — not a road unrolled like a carpet.
 */
export const PACE = 10;
/** A tile of bridge takes this many times a tile of road; and each half step of ground cut or filled adds this share. */
export const DECK_PACE = 2, DIG_PACE = 0.3;
/** Tiles the concrete follows the stone by: poured over it by a mixer, part of the sub-base's trade and on its clock. */
export const CONCRETE_LAG = 1.7;
/** Tiles each trade follows the one ahead by. */
export const GAP = 3;
/** How many tiles of a job open at once, about. */
export const LENGTH = 4;
/** Tiles of road a load of materials makes. */
export const TILES_PER_LOAD = 4;
/** Seconds a load takes to a job no road reaches: brought across country, unseen. */
export const OVERLAND = 25;
/** How many jobs are worked at once: the rest wait their turn, staked out. */
export const GANGS = 3;
/** The trades, in the order they pass. A cell's stage is how many have: 0 staked, 4 lined and ready to open. */
export const TRADES = 4;

const PAVED = 1;

/** Seconds of work each cell takes one trade, by what is done there. */
const cellTime = (c: JobCell) => (!c.fresh ? 0 : PACE * (c.deck ? DECK_PACE : 1 + DIG_PACE * Math.abs(c.z - c.from)));

/**
 * Seconds a trade has worked on a job; −1 not begun. (A job saved before each trade had its own clock: worked out
 * from the one clock it had, each trade a fixed time behind the one ahead, as it was then.)
 */
export function workOf(j: Pick<RoadJob, "t" | "tm" | "work">, trade: number): number {
  if (j.work) return j.work[trade] ?? -1;
  const clock = trade === 0 ? j.t : Math.min(j.t, j.tm ?? j.t), v = clock - ARRIVE - trade * GAP * PACE;
  return v >= 0 ? v : -1;
}
/** Whether a trade has begun on a job. */
export const tradeBegun = (j: Pick<RoadJob, "t" | "tm" | "work">, trade: number) => workOf(j, trade) >= 0;
/** How many of a job's cells a trade has passed: `trade` 0 the earthworks … 3 the lining. */
export function frontOf(j: RoadJob, trade: number): number {
  let left = workOf(j, trade), k = 0;
  if (left < 0) return 0;
  // (A hair under is there: a trade worked to the end exactly is summed in another order than it is taken off here.)
  for (; k < j.cells.length; k++) { left -= cellTime(j.cells[k]); if (left < -1e-6) break; }
  return k;
}
/** Where a trade is along a job, to a part of a cell: for whatever is drawn working there. */
export function frontAt(j: RoadJob, trade: number, behind = 0): number {
  // (`behind`, seconds after the trade itself: for what follows it at a set distance — the concrete poured over the stone.)
  let left = workOf(j, trade) - behind;
  // (Not begun; begun, it passes at once what there is nothing to do on.)
  if (left < 0) return 0;
  for (let k = 0; k < j.cells.length; k++) { const need = cellTime(j.cells[k]); if (left < need - 1e-6) return k + (need ? left / need : 0); left -= need; }
  return j.cells.length;
}
/** Seconds of a trade's work to bring it to `p` cells along a job. */
function workTo(j: RoadJob, p: number): number {
  let w = 0;
  for (let k = 0; k < j.cells.length && k < p; k++) w += cellTime(j.cells[k]) * Math.min(1, p - k);
  return w;
}
/** The cell the sub-base may come to on the loads on site: the first new tile there is no load for; the end once every load is in. */
export function materialCells(j: RoadJob): number {
  if (j.delivered >= j.deliveries) return j.cells.length;
  let have = j.delivered * TILES_PER_LOAD;
  for (let k = 0; k < j.cells.length; k++) if (j.cells[k].fresh && have-- <= 0) return k;
  return j.cells.length;
}
/** Whether the sub-base has come to the last tile its loads will lay. */
export const starved = (j: RoadJob) => {
  const m = materialCells(j);
  // (Its own front at the last of its loads — or, not begun for want of the first, the earthworks far enough on for it.)
  return m < j.cells.length && (tradeBegun(j, 1) ? frontAt(j, 1) >= m - 1e-6 : m === 0 && tradeBegun(j, 0) && frontAt(j, 0) >= Math.min(j.cells.length, GAP));
};
/**
 * HOW FAR A TRADE MAY GO NOW, cells: the earthworks no further than the setting out (and not before it has had
 * {@link ARRIVE} seconds' start); each after it no nearer than {@link GAP} tiles to the one ahead till that one is
 * done; the sub-base no further than its loads.
 */
export function tradeLimit(j: RoadJob, trade: number): number {
  const n = j.cells.length;
  if (trade === 0) { if (j.t < ARRIVE) return 0; const so = setOutAt(j, SET_STEPS - 1); return so >= n ? n : Math.max(0, so - 1); }
  const ahead = tradeBegun(j, trade - 1) ? frontAt(j, trade - 1) : 0;
  const lim = ahead >= n ? n : Math.max(0, ahead - GAP);
  return trade === 1 ? Math.min(lim, materialCells(j)) : lim;
}
/** How many trades have passed a cell of a job. */
export const stageOf = (j: RoadJob, k: number) => { let s = 0; while (s < TRADES && frontOf(j, s) > k) s++; return s; };
/** New tiles in a job, of its first `upTo` cells. */
export const freshIn = (j: Pick<RoadJob, "cells">, upTo = j.cells.length) => { let n = 0; for (let k = 0; k < upTo; k++) if (j.cells[k].fresh) n++; return n; };
/** How many loads a job of so many new tiles needs. */
export const loadsFor = (tiles: number) => Math.ceil(tiles / TILES_PER_LOAD);
/** What one of a job's loads costs. */
export const loadPrice = (j: Pick<RoadJob, "cost" | "deliveries">) => (j.deliveries ? j.cost / j.deliveries : 0);
/** Tiles' worth of materials on site that the sub-base has not come to yet. */
export const onHand = (j: RoadJob) => j.delivered * TILES_PER_LOAD - freshIn(j, frontOf(j, 1));
/** How many loads a job keeps on their way at once, and how many loads' worth it keeps on hand and coming: a lorry takes longer to come than a load takes to lay. */
export const LORRIES = 3, STOCK = 3;
/** Whether a job should send for its next load: one not yet in or on its way — `onWay`, by road or across country — and less than its stock on hand and coming. */
export const wantsLoad = (j: RoadJob, onWay: number) => j.delivered + onWay < j.deliveries && onWay < LORRIES && onHand(j) + onWay * TILES_PER_LOAD < STOCK * TILES_PER_LOAD;
/** How long a job takes in all, seconds. */
export const jobSeconds = (j: Pick<RoadJob, "cells">) => ARRIVE + (TRADES - 1) * GAP * PACE + j.cells.reduce((n, c) => n + cellTime(c), 0);

/**
 * WHERE A JOB MAY OPEN: every LENGTH tiles or so — but a bridge opens whole,
 * its deck never half there, and a road it meets is opened onto, not up to —
 * and at its end.
 */
export function lengthsOf(cells: readonly JobCell[]): number[] {
  const out: number[] = [];
  for (let k = LENGTH; k < cells.length; k += LENGTH) {
    let at = k;
    // Not in the middle of a bridge; and not short of a road it comes to — it opens up to and over a road it meets,
    // which is levelled for it in the same breath, never left a step off it for a while.
    while (at < cells.length && ((cells[at - 1].deck && cells[at].deck) || !cells[at].fresh)) at++;
    if (at < cells.length && at > (out[out.length - 1] ?? 0)) out.push(at);
    k = Math.max(k, at);
  }
  out.push(cells.length);
  return out;
}

/**
 * THE MAP AS IT WILL BE: the grid with every job under way finished — its
 * road laid, its ground moved, its decks up, its ramps as they will be
 * derived. The grid itself with none. Shares every layer a road does not
 * write; never written to.
 */
export function plannedGrid(g: Grid, jobs: readonly RoadJob[] = g.roadJobs): Grid {
  if (!jobs.length) return g;
  const p: Grid = { ...g, height: g.height.slice(), paved: g.paved.slice(), deck: g.deck.slice(), deckZ: g.deckZ.slice(), ramp: g.ramp.slice() };
  const touched = new Set<number>();
  for (const j of jobs) {
    for (let k = j.opened; k < j.cells.length; k++) {
      const c = j.cells[k], i = idx(g, c.x, c.y);
      p.paved[i] = p.paved[i] || PAVED;
      if (c.deck) { p.deck[i] = 1; p.deckZ[i] = c.z; } else if (p.deck[i] === 0) p.height[i] = c.z;
      touched.add(i);
    }
    if (j.opened === 0) for (const l of j.levelled) { p.height[idx(g, l.x, l.y)] = l.to; touched.add(idx(g, l.x, l.y)); }
  }
  const read = {
    inBounds: (x: number, y: number) => inBounds(p, x, y),
    paved: (x: number, y: number) => inBounds(p, x, y) && p.paved[idx(p, x, y)] !== 0,
    height: (x: number, y: number) => (p.deck[idx(p, x, y)] !== 0 ? p.deckZ[idx(p, x, y)] : p.height[idx(p, x, y)]),
  };
  for (const i of touched) for (const [dx, dy] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const x = (i % g.w) + dx, y = ((i / g.w) | 0) + dy;
    if (read.paved(x, y)) p.ramp[idx(p, x, y)] = p.deck[idx(p, x, y)] !== 0 ? 0 : derivedRamp(read, x, y);
  }
  return p;
}

/** A job ordered: it, and the cells of jobs under way whose planned level its junctions change — to be set when it is taken on. */
export type Ordered = { job: RoadJob; retarget: { cell: JobCell; z: number }[] } | { refused: Grade } | { nothing: true };

/** Whether a cell is one of a job's still to open: a road being built there. */
export const onRoadJob = (g: Grid, x: number, y: number) => g.roadJobs.some((j) => j.cells.some((c, k) => k >= j.opened && c.x === x && c.y === y));

/** Take a job on: onto the list, and the plans it changes changed. */
export function takeOn(g: Grid, o: Extract<Ordered, { job: RoadJob }>): void {
  for (const r of o.retarget) r.cell.z = r.z;
  g.roadJobs.push(o.job);
  g.nextRoadJob = Math.max(g.nextRoadJob, o.job.id + 1);
}

/**
 * WHICH END A ROAD IS BUILT FROM, 0 its first cell or 1 its last: NOT the way it was drawn, but the way the work
 * would come — from where it is nearest to getting on site. In order: an end on or beside a road that is OPEN,
 * which a lorry can drive to; failing that, one beside a road still being built, which will bring one; failing
 * that, whichever end is nearer an open road across country. All else equal, the way it was drawn.
 */
export function startOf(g: Grid, planned: Grid, path: readonly GradeCell[]): 0 | 1 {
  if (path.length < 2) return 0;
  const joins = (q: Grid, c: GradeCell) => q.paved[idx(q, c.x, c.y)] !== 0
    || [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => inBounds(q, c.x + dx, c.y + dy) && q.paved[idx(q, c.x + dx, c.y + dy)] !== 0);
  /** Tiles to the nearest open road, as the crow flies; none on the map, no nearer either way. */
  const far = (c: GradeCell) => {
    let best = Infinity;
    for (let i = 0; i < g.paved.length; i++) if (g.paved[i] !== 0) best = Math.min(best, Math.abs((i % g.w) - c.x) + Math.abs(((i / g.w) | 0) - c.y));
    return best;
  };
  const rank = (c: GradeCell) => (joins(g, c) ? 0 : joins(planned, c) ? 1 : 2);
  const a = path[0], b = path[path.length - 1], ra = rank(a), rb = rank(b);
  if (ra !== rb) return ra < rb ? 0 : 1;
  if (ra < 2) return 0;
  return far(b) < far(a) ? 1 : 0;
}

/**
 * ORDER A ROAD along `path` — a stroke's cells in order. The job, not yet on
 * the grid's list; or the grade that refused it; or nothing, for a path with
 * no road to build. Nothing is changed here. @see takeOn
 */
export function orderRoad(g: Grid, path: readonly GradeCell[]): Ordered {
  const P = plannedGrid(g);
  const way = startOf(g, P, path) === 0 ? path : [...path].reverse();
  const grade = gradeRoad(P, way);
  if (grade.blocked.length) return { refused: grade };
  const decks = new Map(grade.decks.map((d) => [idx(g, d.x, d.y), d.z]));
  const cells: JobCell[] = [], seen = new Map<number, number>(), retarget: { cell: JobCell; z: number }[] = [];
  way.forEach((c, k) => {
    const i = idx(g, c.x, c.y);
    if (seen.has(i)) return;
    seen.set(i, cells.length);
    cells.push({ x: c.x, y: c.y, z: decks.get(i) ?? grade.heights[k], deck: decks.has(i), from: g.height[i], fresh: P.paved[i] === 0 });
  });
  const levelled: JobLevel[] = [];
  for (const m of grade.moved) {
    const i = idx(g, m.x, m.y);
    if (seen.has(i)) continue;
    // A road beside it, levelled: one that stands, or another job's still to be built. Either way it is THIS job's
    // to change, with its first length and all at once — not that job's plan now, half of a levelling ahead of the rest.
    let at = 0;
    for (let k = 1; k < cells.length; k++) if (Math.abs(cells[k].x - m.x) + Math.abs(cells[k].y - m.y) < Math.abs(cells[at].x - m.x) + Math.abs(cells[at].y - m.y)) at = k;
    levelled.push({ x: m.x, y: m.y, to: m.to, from: g.height[i], at });
  }
  if (!cells.some((c) => c.fresh) && !levelled.length && !cells.some((c) => !c.deck && c.z !== g.height[idx(g, c.x, c.y)])) return { nothing: true };
  const job: RoadJob = { id: g.nextRoadJob, cells, levelled, t: 0, work: [-1, -1, -1, -1], dug: 0, opened: 0, lengths: lengthsOf(cells), delivered: 0, deliveries: 0, cost: 0, overland: [], stalled: 0, at: 0 };
  job.deliveries = loadsFor(freshIn(job));
  return { job, retarget };
}

/** What a step of the works writes to the map. */
export type RoadWrites = {
  /** Ground moved: earthworks, and a road levelled for a junction. */
  heights: { x: number; y: number; to: number }[];
  /** Cells that are road from now, and the decks under the ones that are bridge. */
  paved: { x: number; y: number }[];
  decks: { x: number; y: number; z: number }[];
};
const noWrites = (): RoadWrites => ({ heights: [], paved: [], decks: [] });

/** A job's trades' clocks, there to be worked: brought on from the one clock of a job saved before they had their own. */
export function ensureWork(j: RoadJob): number[] {
  if (!j.work) { j.work = [0, 1, 2, 3].map((k) => workOf(j, k)); delete j.tm; }
  return j.work;
}
/** The jobs being worked: with crews, those any crew has been sent to; without (no town to drive them), the first {@link GANGS}. */
export const liveRoadJobs = (g: Pick<Grid, "roadJobs">) => g.roadJobs.filter((j) => roadJobLive(g, j));
/** Whether a job is being worked. @see liveRoadJobs */
export const roadJobLive = (g: Pick<Grid, "roadJobs">, j: RoadJob) => (j.gangs ? Object.keys(j.gangs).length > 0 : g.roadJobs.indexOf(j) < GANGS);
/** Whether a job has been begun: its setting out, or any trade. */
export const begunRoadJob = (j: RoadJob) => j.t > 0 || [0, 1, 2, 3].some((k) => tradeBegun(j, k));

/**
 * A FRAME OF EVERY JOB. `crews.on(j, crew)` says whether a crew is on a job, at work: a trade is worked only then.
 * With no crews (no town to drive them — a map caught up on), the first {@link GANGS} jobs are worked, every trade
 * of them, oldest first. What it writes, and whether anything that shows has changed — a trade passed a cell, a
 * length opened, a job finished and came off the list (`crews.over`: once its crews have gone).
 */
export function stepRoadJobs(g: Grid, dt: number, crews?: { on: (j: RoadJob, crew: RoadCrew) => boolean; over: (j: RoadJob) => boolean }): { writes: RoadWrites; changed: boolean } {
  const writes = noWrites();
  let changed = false;
  for (const j of crews ? g.roadJobs : g.roadJobs.slice(0, GANGS)) {
    const on = (c: RoadCrew) => !crews || crews.on(j, c);
    const before = [0, 1, 2, 3].map((s) => frontOf(j, s));
    // LOADS ACROSS COUNTRY, arriving.
    for (let k = j.overland.length - 1; k >= 0; k--) if ((j.overland[k] -= dt) <= 0) { j.overland.splice(k, 1); j.delivered = Math.min(j.deliveries, j.delivered + 1); changed = true; }
    // THE SETTING OUT, while the surveyors are there (and on, once it is done: they walk off it).
    if (on("survey") || j.t >= setOutSeconds(j)) j.t += dt;
    // EACH TRADE, while its crew is there: begun when there is room for it, and on as far as it may go.
    const work = ensureWork(j);
    for (let k = 0; k < TRADES; k++) {
      if (!on(TRADE_CREW[k])) continue;
      const lim = tradeLimit(j, k);
      if (work[k] < 0) { if (lim <= 0) continue; work[k] = 0; changed = true; }
      work[k] = Math.max(work[k], Math.min(work[k] + dt, workTo(j, lim)));
    }
    const after = [0, 1, 2, 3].map((s) => frontOf(j, s));
    if (after.some((v, s) => v !== before[s])) changed = true;
    // EARTHWORKS: the ground under a cell goes to its level as they pass it.
    for (let k = j.dug; k < after[0]; k++) {
      const c = j.cells[k], i = idx(g, c.x, c.y);
      if (c.fresh && !c.deck && g.deck[i] === 0 && g.height[i] !== c.z) writes.heights.push({ x: c.x, y: c.y, to: c.z });
    }
    j.dug = Math.max(j.dug, after[0]);
    // OPENING: the furthest end of a length the lining has passed.
    let to = j.opened;
    for (const b of j.lengths) if (b <= after[3] && b > to) to = b;
    if (to > j.opened) {
      for (let k = j.opened; k < to; k++) {
        const c = j.cells[k], i = idx(g, c.x, c.y);
        if (c.deck) writes.decks.push({ x: c.x, y: c.y, z: c.z });
        else if (g.deck[i] === 0 && g.height[i] !== c.z) writes.heights.push({ x: c.x, y: c.y, to: c.z });
        if (g.paved[i] === 0) writes.paved.push({ x: c.x, y: c.y });
      }
      // WHAT IT CHANGES OF THE ROADS ALREADY THERE — a ramp levelled for a junction, and the rows that then climb
      // in its place, on its line or beside it — changes all at once, with its first length: each such change
      // leaves that road sound by itself, and half of one does not.
      if (j.opened === 0) {
        /** A cell's level changed: on the ground if its road stands; in the plan of the job that is still to build it, and under what that job has dug. */
        const level = (x: number, y: number, z: number) => {
          const i = idx(g, x, y);
          if (g.deck[i] !== 0) return;
          if (g.paved[i] !== 0) { if (g.height[i] !== z) writes.heights.push({ x, y, to: z }); return; }
          for (const o of g.roadJobs) {
            if (o === j) continue;
            const n = o.cells.findIndex((c) => c.x === x && c.y === y);
            if (n < o.opened || o.cells[n].deck) continue;
            o.cells[n].z = z;
            if (n < o.dug && g.height[i] !== z) writes.heights.push({ x, y, to: z });
          }
        };
        for (const l of j.levelled) level(l.x, l.y, l.to);
        for (let k = to; k < j.cells.length; k++) { const c = j.cells[k]; if (!c.fresh && !c.deck) level(c.x, c.y, c.z); }
      }
      j.opened = to;
      changed = true;
    }
  }
  // (Done, and off the list — once its crews have gone from it, where it has any.)
  const done = g.roadJobs.filter((j) => j.opened >= j.cells.length && (crews?.over(j) ?? true));
  if (done.length) { g.roadJobs = g.roadJobs.filter((j) => !done.includes(j)); changed = true; }
  return { writes, changed };
}

/**
 * CANCEL every job with a cell not yet open among `hit`: what of it is open
 * stays road; what is not is taken up, its ground put back as it was. The
 * jobs ordered after it are graded again on the map without it, and one that
 * no longer can be built is cancelled with it. What to write, and how many
 * tiles were cancelled unbuilt, job by job. Loads already paid for are not given back.
 */
export function cancelRoadJobs(g: Grid, hit: ReadonlySet<number>): { writes: RoadWrites; cancelled: { job: RoadJob; tiles: number }[] } {
  const writes = noWrites(), cancelled: { job: RoadJob; tiles: number }[] = [];
  const drop = (j: RoadJob) => {
    g.roadJobs = g.roadJobs.filter((q) => q !== j);
    for (let k = j.opened; k < j.dug; k++) { const c = j.cells[k]; if (c.fresh && !c.deck && g.height[idx(g, c.x, c.y)] !== c.from) writes.heights.push({ x: c.x, y: c.y, to: c.from }); }
    cancelled.push({ job: j, tiles: j.cells.slice(j.opened).filter((c) => c.fresh).length });
  };
  const first = g.roadJobs.findIndex((j) => j.cells.some((c, k) => k >= j.opened && hit.has(idx(g, c.x, c.y))));
  if (first < 0) return { writes, cancelled };
  for (const j of g.roadJobs.filter((q) => q.cells.some((c, k) => k >= q.opened && hit.has(idx(g, c.x, c.y))))) drop(j);
  // THOSE ORDERED AFTER were planned with it there: planned again without it, each on the jobs before it.
  for (const j of g.roadJobs.slice(first)) {
    if (!g.roadJobs.includes(j)) continue;
    const before = g.roadJobs.slice(0, g.roadJobs.indexOf(j));
    // As the map stands for it: the ground this job has itself moved is its own, already where it wants it.
    const P = plannedGrid(g, before), from = Math.max(0, j.opened - 1), rest = j.cells.slice(from);
    const grade = gradeRoad(P, rest);
    if (grade.blocked.length) { drop(j); continue; }
    const decks = new Map(grade.decks.map((d) => [idx(g, d.x, d.y), d.z]));
    rest.forEach((c, k) => { if (from + k < j.opened) return; const i = idx(g, c.x, c.y); c.deck = decks.has(i); c.z = decks.get(i) ?? grade.heights[k]; });
    j.lengths = lengthsOf(j.cells).filter((b) => b > j.opened);
  }
  return { writes, cancelled };
}
