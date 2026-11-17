/**
 * World v2 — A LINE IS LAID, NOT BOUGHT. A water main, a sewer, a dredged
 * channel ordered in the game is a JOB along its cells: worked from its first
 * to its last by trades that follow one another — the trench cut, the pipe
 * laid, the ground made good — its materials brought a load at a time and
 * paid for as each is sent. A PIPE IS REAL AS IT GOES IN: each length of it
 * on the map as it is laid, the run capped where it has got to. A sewer's
 * trunk and a channel are on the map when the last of them is done. @see plans/built-not-bought.md, roads/jobs (a road is the same
 * idea, opened a length at a time)
 *
 * Pure: what paying means and what "laid" means are its caller's.
 * @see world.store stepLineWorks
 */

export type LineKind = "main" | "sewer" | "dredge";
export type LineJob = {
  id: number;
  kind: LineKind;
  /** Its cells, in the order they are worked. */
  cells: { x: number; y: number }[];
  /** The stroke that ordered it, to be laid again when it is done. Plain data: it is saved with the map. */
  stroke: unknown;
  /** What it costs in all, and in how many loads: each paid as it is sent. */
  cost: number;
  deliveries: number;
  delivered: number;
  /** Loads on their way, seconds each has left. */
  coming: number[];
  /** Seconds it has been worked. */
  t: number;
  /** How many of its cells are ON THE MAP already: a pipe is real as each length of it goes in, capped where it has got to. (A sewer's trunk and a channel are all or nothing: nought till they are done.) */
  laid?: number;
  /** Seconds it has stood for want of a load it could not pay for; nought while it works. */
  stalled: number;
  /** When it was last worked, ms since the epoch — for the time away. */
  at: number;
  told?: boolean;
};

/** Seconds a tile, the leading trade: a main laid on the ground is quick; a sewer is dug for; a dredger is slow. */
export const LINE_PACE: Readonly<Record<LineKind, number>> = { main: 3, sewer: 5, dredge: 4 };
/**
 * THE TRADES THAT PASS ALONG A LINE, one after another, each `LINE_GAPS` tiles behind the one ahead.
 *
 * A MAIN is six: its FOOTINGS dug, a pit a tile; the footings POURED, formwork and then a plinth; its lengths
 * STRUNG out along it on skids, off a lorry; each length SET on its plinths — the trade that puts the pipe itself
 * on the map; each joint WELDED; and the run INSPECTED behind.
 * A sewer and a channel are three: the cut, the pipe (or the dredging), the making good.
 */
export const MAIN = { foot: 0, pour: 1, string: 2, set: 3, weld: 4, inspect: 5 } as const;
export const LINE_STAGES: Readonly<Record<LineKind, number>> = { main: 6, sewer: 3, dredge: 3 };
export const LINE_GAPS: Readonly<Record<LineKind, number>> = { main: 1.6, sewer: 1.2, dredge: 1.2 };
/** Which trade lays the thing itself: the one its loads are for, and the one the map waits on. */
export const LINE_LAYS: Readonly<Record<LineKind, number>> = { main: MAIN.set, sewer: 1, dredge: 1 };
/** Tiles a load of pipe lays; seconds a load takes to come; how many may be on their way at once. */
export const LINE_LOAD = 6, LINE_HAUL = 6, LINE_COMING = 2;

/** How many loads a line of so many tiles takes. */
export const lineLoads = (tiles: number) => Math.max(1, Math.ceil(tiles / LINE_LOAD));
export const newLine = (id: number, kind: LineKind, cells: readonly { x: number; y: number }[], stroke: unknown, cost: number, now: number): LineJob =>
  ({ id, kind, cells: cells.map((c) => ({ x: c.x, y: c.y })), stroke, cost, deliveries: lineLoads(cells.length), delivered: 0, coming: [], t: 0, stalled: 0, at: now });

/** How far along it a trade has got, tiles from its first cell's near edge. Never past its end. @see LINE_STAGES */
export const lineFront = (j: Pick<LineJob, "t" | "kind" | "cells">, trade: number) =>
  Math.max(0, Math.min(j.cells.length, j.t / LINE_PACE[j.kind] - trade * LINE_GAPS[j.kind]));
/** Seconds it takes with every load to hand. */
export const lineSeconds = (j: Pick<LineJob, "kind" | "cells">) => (j.cells.length + (LINE_STAGES[j.kind] - 1) * LINE_GAPS[j.kind]) * LINE_PACE[j.kind];
/** Whether the last of it is done. */
export const lineDone = (j: LineJob) => j.t >= lineSeconds(j) - 1e-9;
/** A load's price. */
export const lineLoadPrice = (j: Pick<LineJob, "cost" | "deliveries">) => j.cost / j.deliveries;
/** How long it may be worked on the loads it has had: until the pipe comes to the first tile there is none for. Without end once every load is in. */
export const lineAllowed = (j: LineJob) =>
  j.delivered >= j.deliveries ? Infinity : (Math.min(j.cells.length, j.delivered * LINE_LOAD) + LINE_LAYS[j.kind] * LINE_GAPS[j.kind]) * LINE_PACE[j.kind];

/**
 * A step of a job: loads sent for — `spend` pays for one and says whether it could — and arriving; the work as far
 * as the loads allow. Says whether anything that shows has changed.
 */
export function stepLine(j: LineJob, dt: number, spend: (amount: number) => boolean): boolean {
  let changed = false;
  for (let k = j.coming.length - 1; k >= 0; k--) {
    j.coming[k] -= dt;
    if (j.coming[k] <= 0) { j.coming.splice(k, 1); j.delivered = Math.min(j.deliveries, j.delivered + 1); changed = true; }
  }
  // THE NEXT LOAD sent for while what is on hand and coming is less than a load ahead of the pipe.
  const ahead = (j.delivered + j.coming.length) * LINE_LOAD - lineFront(j, LINE_LAYS[j.kind]);
  if (j.delivered + j.coming.length < j.deliveries && j.coming.length < LINE_COMING && ahead < LINE_LOAD) {
    if (spend(lineLoadPrice(j))) { j.coming.push(LINE_HAUL); j.stalled = 0; changed = true; }
  }
  const allowed = lineAllowed(j);
  if (j.t < allowed) { j.t = Math.min(allowed, j.t + dt, lineSeconds(j)); if (j.stalled) { j.stalled = 0; changed = true; } }
  // STOOD: the work has run out and nothing is coming, because nothing could be paid for.
  else if (!j.coming.length && !lineDone(j)) { if (!j.stalled) changed = true; j.stalled += dt; }
  return changed;
}

/** Where a place `p` tiles along a line is — a cell's middle a whole number and a half — and which way it runs there. */
export function alongLine(cells: readonly { x: number; y: number }[], p: number): { x: number; y: number; heading: number } {
  const n = cells.length, q = Math.max(0, Math.min(n - 1, p - 0.5)), i = Math.min(n - 1, Math.floor(q)), f = q - i;
  const a = cells[i], b = cells[Math.min(n - 1, i + 1)], back = cells[Math.max(0, i - 1)];
  const dx = b === a ? a.x - back.x : b.x - a.x, dy = b === a ? a.y - back.y : b.y - a.y;
  return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f, heading: Math.atan2(dy, dx) };
}

/**
 * A BUILDING BEING PULLED DOWN: ordered under Demolish, it stands — and goes on working — until the gang has had
 * its time at it; then it is gone, as Demolish took it. Which structure, the tile it was ordered at (for taking it
 * down the way the tool does), seconds worked and seconds it takes.
 */
export type RazeJob = { id: number; structure: number; x: number; y: number; t: number; need: number; at: number };
/** Seconds to pull down a building of so many tiles: a few bites a tile, and never long. */
export const razeSeconds = (tiles: number) => Math.min(30, 5 + 3 * tiles);
