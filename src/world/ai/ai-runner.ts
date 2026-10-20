/**
 * World v2 — THE AI AT WORK: its clock, its drones and what it has done.
 *
 * The clock runs at the share of agents running — throttled to none, it stops
 * — and faster for every drone hangar it has put up. When it comes round the
 * AI picks a job; one on the map goes to a DRONE, which flies out from the
 * Data Centre, hovers over the spot scanning, and only then does the job: the
 * player watches it happen and cannot stop it. At most `MAX_DRONES` aloft.
 *
 * WHILE YOU WERE AWAY it kept working: on the first look after time away it
 * does what it would have, up to `CATCH_UP` jobs, at once, and says what.
 * @see planner, plans/singularity.md
 */
import { DRONE_SWARM, moduleLevel } from "../../game/modules";
import type { Stage } from "../../state/ai-singularity.store";
import type { Grid, Structure } from "../grid";
import { INTERVAL, chooseAction, perform, targetOf, type AiAction } from "./planner";
import { ARRIVALS, nextMemoIn, pickMemo } from "./memos";

/** Drones aloft at once; tiles a second a drone flies; seconds it scans before the job is done. */
export const MAX_DRONES = 6;
export const DRONE_SPEED = 5;
export const SCAN_SECONDS = 2.5;
/** Jobs done at once for time away, at most. */
export const CATCH_UP = 10;
/** What each drone hangar takes off the AI's interval, and the most that count. */
export const HANGAR_SPEED = 0.25;
export const MAX_HANGARS = 2;

type Cell = { x: number; y: number };
export type DroneJob = { action: AiAction; from: Cell; to: Cell; t: number; fly: number };
export type AiMemo = { text: string; at: number };

/** `landed`: where drones finished a job since the scene last looked, for the flash. @see Juice.landed */
export type AiRunner = { clock: number; jobs: DroneJob[]; log: AiMemo[]; lastAt: number | null; memoIn: number | null; landed: Cell[] };
export const createAiRunner = (): AiRunner => ({ clock: 0, jobs: [], log: [], lastAt: null, memoIn: null, landed: [] });
/** The most landings kept for a scene that is not looking. */
const LANDED_KEPT = 16;

/**
 * THE AI'S MEMOS, moved on: a stage arrived at is announced, once a company;
 * otherwise, every few minutes, a memo — and what it says, done. Returns
 * what it said, or null. @see world/ai/memos
 */
export function stepMemos(r: AiRunner, stage: Stage, dt: number, said: readonly string[], rand: () => number = Math.random): { text: string; arrived?: Stage } | null {
  if (stage === "tool") { r.memoIn = null; return null; }
  const arrival = ARRIVALS[stage];
  if (arrival && !said.includes(stage)) return { text: arrival, arrived: stage };
  if (r.memoIn === null) r.memoIn = nextMemoIn(rand);
  r.memoIn -= dt;
  if (r.memoIn > 0) return null;
  r.memoIn = nextMemoIn(rand);
  const m = pickMemo(stage, rand);
  if (!m) return null;
  const text = m.text();
  m.apply?.();
  return { text };
}

/** What the runner needs to know of the company, this frame. */
export type AiNow = { stage: Stage; running: number; agents: number };

const centreOf = (s: Structure): Cell => ({ x: s.x + s.w / 2, y: s.y + s.h / 2 });

/** How many seconds of its clock pass in `dt`. */
export function aiPace(g: Grid, now: AiNow, dt: number): number {
  if (now.running <= 0 || now.agents <= 0) return 0;
  let hangars = 0;
  for (const s of g.structures.values()) if (s.def === "drone-hangar" && !s.build) hangars++;
  return dt * (now.running / now.agents) * (1 + HANGAR_SPEED * Math.min(MAX_HANGARS, hangars));
}

/** Do a job and note it. */
function done(r: AiRunner, a: AiAction, at: number): boolean {
  const ok = perform(a);
  if (ok) {
    r.log.push({ text: a.why, at });
    if (r.log.length > 30) r.log.shift();
  }
  return ok;
}

/**
 * One frame of the AI's work: drones moved on and their jobs done when they
 * have scanned, and, when its clock comes round, the next job chosen.
 * `now` is the wall clock, ms. Returns the jobs done this frame.
 */
export function stepAi(r: AiRunner, g: Grid, ai: AiNow, dt: number, now: number, rand: () => number = Math.random): AiAction[] {
  const did: AiAction[] = [];
  const speed = DRONE_SPEED * DRONE_SWARM[moduleLevel("drone-swarm")];
  for (const job of [...r.jobs]) {
    job.t += dt;
    if (job.t < job.fly + SCAN_SECONDS) continue;
    r.jobs = r.jobs.filter((j) => j !== job);
    if (r.landed.length < LANDED_KEPT) r.landed.push(job.to);
    if (done(r, job.action, now)) did.push(job.action);
  }
  const interval = INTERVAL[ai.stage];
  if (!interval) { r.clock = 0; r.lastAt = now; return did; }
  r.clock += aiPace(g, ai, dt);
  r.lastAt = now;
  if (r.clock < interval || r.jobs.length >= MAX_DRONES) return did;
  r.clock = 0;
  const a = chooseAction(g, ai.stage, rand);
  if (!a) return did;
  const to = targetOf(a);
  const dc = [...g.structures.values()].find((s) => s.def === "datacentre" && !s.build);
  if (!to || !dc) {
    if (done(r, a, now)) did.push(a);
    return did;
  }
  const from = centreOf(dc);
  r.jobs.push({ action: a, from, to, t: 0, fly: Math.hypot(to.x - from.x, to.y - from.y) / speed });
  return did;
}

/**
 * TIME AWAY: the jobs it would have done since `since`, done now, up to
 * `CATCH_UP`, and what they were. Its pace is taken as it stands now.
 */
export function catchUpAi(r: AiRunner, g: Grid, ai: AiNow, since: number, now: number, rand: () => number = Math.random): AiMemo[] {
  const interval = INTERVAL[ai.stage];
  if (!interval || now <= since) return [];
  const seconds = aiPace(g, ai, (now - since) / 1000);
  const n = Math.min(CATCH_UP, Math.floor(seconds / interval));
  const memos: AiMemo[] = [];
  for (let k = 0; k < n; k++) {
    const a = chooseAction(g, ai.stage, rand);
    if (a && done(r, a, now)) memos.push({ text: a.why, at: now });
  }
  return memos;
}

/** Where a drone is, and whether it is scanning, `t` seconds out. */
export function droneAt(job: DroneJob): { x: number; y: number; scanning: boolean } {
  const k = job.fly > 0 ? Math.min(1, job.t / job.fly) : 1;
  return { x: job.from.x + (job.to.x - job.from.x) * k, y: job.from.y + (job.to.y - job.from.y) * k, scanning: job.t >= job.fly };
}

/** The company's AI at work: one, for whoever needs to ask. */
const runner = createAiRunner();
export const getAiRunner = () => runner;
