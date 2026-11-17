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

/** A cell of a job: where, the level its road will stand at, whether that is a bridge's deck, the ground it was ordered on, and whether there is a road to build there at all. */
export type JobCell = { x: number; y: number; z: number; deck: boolean; from: number; fresh: boolean };
/** A road beside a job whose ramp is levelled for the junction: where, to what, from what, and the cell of the job it is levelled with. */
export type JobLevel = { x: number; y: number; to: number; from: number; at: number };
export type RoadJob = {
  id: number;
  cells: JobCell[];
  levelled: JobLevel[];
  /** Seconds it has been worked. */
  t: number;
  /** How many of its cells the earthworks have passed, and how many are open road. */
  dug: number;
  opened: number;
  /** Where a length may end: cell counts, rising, the last its whole length. @see lengthsOf */
  lengths: number[];
  /** What was paid for it, a tile: given back for what is cancelled unbuilt. */
  paidATile: number;
};

/** Seconds before a gang is on a job it has been given. */
export const ARRIVE = 3;
/** Seconds a tile, each trade: the train of them moves this fast along a level road. */
export const PACE = 1.5;
/** A tile of bridge takes this many times a tile of road; and each half step of ground cut or filled adds this share. */
export const DECK_PACE = 3, DIG_PACE = 0.5;
/** Tiles each trade follows the one ahead by. */
export const GAP = 2;
/** How many tiles of a job open at once, about. */
export const LENGTH = 4;
/** How many jobs are worked at once: the rest wait their turn, staked out. */
export const GANGS = 3;
/** The trades, in the order they pass. A cell's stage is how many have: 0 staked, 4 lined and ready to open. */
export const TRADES = 4;

const PAVED = 1;
const cellOf = (j: RoadJob, i: number, g: Grid) => j.cells.find((c) => idx(g, c.x, c.y) === i);

/** Seconds of work each cell takes one trade, by what is done there. */
const cellTime = (c: JobCell) => (!c.fresh ? 0 : PACE * (c.deck ? DECK_PACE : 1 + DIG_PACE * Math.abs(c.z - c.from)));

/** How many of a job's cells a trade has passed: `trade` 0 the earthworks … 3 the lining. */
export function frontOf(j: RoadJob, trade: number): number {
  // Each follows the one ahead by GAP tiles' worth of time.
  let left = j.t - ARRIVE - trade * GAP * PACE, k = 0;
  for (; k < j.cells.length; k++) { left -= cellTime(j.cells[k]); if (left < 0) break; }
  return k;
}
/** How many trades have passed a cell of a job. */
export const stageOf = (j: RoadJob, k: number) => { let s = 0; while (s < TRADES && frontOf(j, s) > k) s++; return s; };
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
 * ORDER A ROAD along `path` — a stroke's cells in order. The job, not yet on
 * the grid's list; or the grade that refused it; or nothing, for a path with
 * no road to build. Nothing is changed here. @see takeOn
 */
export function orderRoad(g: Grid, path: readonly GradeCell[]): Ordered {
  const P = plannedGrid(g);
  const roadAt = (c: GradeCell) => [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => inBounds(P, c.x + dx, c.y + dy) && P.paved[idx(P, c.x + dx, c.y + dy)] !== 0);
  // FROM THE END THAT JOINS A ROAD: it is built toward open country, and opens from where traffic can reach it.
  const way = path.length > 1 && !roadAt(path[0]) && P.paved[idx(P, path[0].x, path[0].y)] === 0 && (roadAt(path[path.length - 1]) || P.paved[idx(P, path[path.length - 1].x, path[path.length - 1].y)] !== 0) ? [...path].reverse() : path;
  const grade = gradeRoad(P, way);
  if (grade.blocked.length) return { refused: grade };
  const decks = new Map(grade.decks.map((d) => [idx(g, d.x, d.y), d.z]));
  const cells: JobCell[] = [], seen = new Map<number, number>(), retarget: { cell: JobCell; z: number }[] = [];
  way.forEach((c, k) => {
    const i = idx(g, c.x, c.y);
    if (seen.has(i)) return;
    seen.set(i, cells.length);
    cells.push({ x: c.x, y: c.y, z: decks.get(i) ?? grade.heights[k], deck: decks.has(i), from: g.height[i], fresh: P.paved[i] === 0 });
    // A cell of another job's, still to be built, that this one's junction stands at another level: that job's plan changes with it.
    const theirs = g.paved[i] === 0 && P.paved[i] !== 0 && P.deck[i] === 0 ? g.roadJobs.map((j) => cellOf(j, i, g)).find((q) => q) : undefined;
    if (theirs && theirs.z !== grade.heights[k]) retarget.push({ cell: theirs, z: grade.heights[k] });
  });
  const levelled: JobLevel[] = [];
  for (const m of grade.moved) {
    const i = idx(g, m.x, m.y);
    if (seen.has(i)) continue;
    // A road beside it, levelled: another job's, still to be built — that job's plan is what changes — or one that stands.
    const theirs = g.roadJobs.map((j) => cellOf(j, i, g)).find((c) => c);
    if (theirs && g.paved[i] === 0) { retarget.push({ cell: theirs, z: m.to }); continue; }
    let at = 0;
    for (let k = 1; k < cells.length; k++) if (Math.abs(cells[k].x - m.x) + Math.abs(cells[k].y - m.y) < Math.abs(cells[at].x - m.x) + Math.abs(cells[at].y - m.y)) at = k;
    levelled.push({ x: m.x, y: m.y, to: m.to, from: g.height[i], at });
  }
  if (!cells.some((c) => c.fresh) && !levelled.length && !cells.some((c) => !c.deck && c.z !== g.height[idx(g, c.x, c.y)])) return { nothing: true };
  return { job: { id: g.nextRoadJob, cells, levelled, t: 0, dug: 0, opened: 0, lengths: lengthsOf(cells), paidATile: 0 }, retarget };
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

/**
 * A FRAME OF EVERY JOB: the first {@link GANGS} of them worked, oldest
 * first. What it writes, and whether anything that shows has changed — a
 * trade passed a cell, a length opened, a job finished and came off the list.
 */
export function stepRoadJobs(g: Grid, dt: number): { writes: RoadWrites; changed: boolean } {
  const writes = noWrites();
  let changed = false;
  for (const j of g.roadJobs.slice(0, GANGS)) {
    const before = [0, 1, 2, 3].map((s) => frontOf(j, s));
    j.t += dt;
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
        for (const l of j.levelled) writes.heights.push({ x: l.x, y: l.y, to: l.to });
        for (let k = to; k < j.cells.length; k++) { const c = j.cells[k], i = idx(g, c.x, c.y); if (!c.fresh && !c.deck && g.paved[i] !== 0 && g.deck[i] === 0 && g.height[i] !== c.z) writes.heights.push({ x: c.x, y: c.y, to: c.z }); }
      }
      j.opened = to;
      changed = true;
    }
  }
  const done = g.roadJobs.filter((j) => j.opened >= j.cells.length);
  if (done.length) { g.roadJobs = g.roadJobs.filter((j) => !done.includes(j)); changed = true; }
  return { writes, changed };
}

/**
 * CANCEL every job with a cell not yet open among `hit`: what of it is open
 * stays road; what is not is taken up, its ground put back as it was. The
 * jobs ordered after it are graded again on the map without it, and one that
 * no longer can be built is cancelled with it. What to write, and how many
 * tiles were cancelled unbuilt, job by job, for whoever paid for them.
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
