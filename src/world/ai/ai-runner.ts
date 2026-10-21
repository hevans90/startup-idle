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
import { structureAt, type Grid, type Structure } from "../grid";
import { housedBy } from "../../game/housing";
import { structureDef } from "../structures/def";
import { INTERVAL, chooseAction, perform, targetOf, type AiAction } from "./planner";
import { ARRIVALS, nextMemoIn, pickMemo } from "./memos";
import { accrueWallet, creditWallet, priceOfAi, spendWallet, walletCovers } from "./wallet";
import { skillOf } from "../../state/training.store";
import { DRONES_FASTER } from "../../game/training";

/** Drones aloft at once; tiles a second a drone flies; seconds it scans before the job is done. */
export const MAX_DRONES = 6;
export const DRONE_SPEED = 5;
export const SCAN_SECONDS = 4;
/** Jobs done at once for time away, at most. */
export const CATCH_UP = 10;
/** What each drone hangar takes off the AI's interval, and the most that count. */
export const HANGAR_SPEED = 0.25;
export const MAX_HANGARS = 2;

type Cell = { x: number; y: number };
export type DroneJob = { action: AiAction; from: Cell; to: Cell; t: number; fly: number };
export type AiMemo = { text: string; at: number };

/**
 * `landed`: where drones finished a job since the scene last looked, for the
 * flash. `pending`: takeovers announced and not yet done — the building it
 * means to take, until when. `said`: what it has announced since the scene
 * last looked, for the memos. @see Juice.landed, WARN_MS
 */
export type Pending = { action: Extract<AiAction, { kind: "convert" }>; def: string; until: number };
export type AiRunner = { clock: number; jobs: DroneJob[]; log: AiMemo[]; lastAt: number | null; memoIn: number | null; landed: Cell[]; pending: Pending[]; said: string[] };
export const createAiRunner = (): AiRunner => ({ clock: 0, jobs: [], log: [], lastAt: null, memoIn: null, landed: [], pending: [], said: [] });
/** How long a takeover is announced before it is done, ms. */
export const WARN_MS = 60_000;
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

/**
 * Do a job and note it — paid for out of the AI's wallet, checked again now,
 * since other jobs may have spent it since this one was chosen. @see wallet
 */
function done(r: AiRunner, a: AiAction, at: number, g: Grid | null = null): boolean {
  const price = g ? priceOfAi(g, a) : 0;
  if (g && !walletCovers(g, a)) return false;
  const ok = perform(a);
  if (ok) spendWallet(price);
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
  // ITS ALLOWANCE, while it is at work: its share of the income, into its wallet. @see accrueWallet
  if (INTERVAL[ai.stage]) accrueWallet(dt);
  // Faster for an AI trained on itself. @see DRONES_FASTER
  const quick = skillOf("itself") >= 2 ? DRONES_FASTER : 1;
  const speed = DRONE_SPEED * DRONE_SWARM[moduleLevel("drone-swarm")] * quick;
  for (const job of [...r.jobs]) {
    job.t += dt;
    if (job.t < job.fly + SCAN_SECONDS / quick) continue;
    r.jobs = r.jobs.filter((j) => j !== job);
    if (r.landed.length < LANDED_KEPT) r.landed.push(job.to);
    if (done(r, job.action, now, g)) did.push(job.action);
  }
  // TAKEOVERS ANNOUNCED, their warning over: flown out if the building is
  // still what it was, and a drone is free. @see announce
  for (const p of [...r.pending]) {
    if (now < p.until || r.jobs.length >= MAX_DRONES) continue;
    r.pending = r.pending.filter((x) => x !== p);
    const id = structureAt(g, p.action.at.x, p.action.at.y);
    if (id < 0 || g.structures.get(id)?.def !== p.def) continue;
    const dc = [...g.structures.values()].find((s) => s.def === "datacentre" && !s.build);
    if (!dc) continue;
    const from = centreOf(dc), to = p.action.at;
    r.jobs.push({ action: p.action, from, to, t: 0, fly: Math.hypot(to.x - from.x, to.y - from.y) / speed });
  }
  const interval = INTERVAL[ai.stage];
  if (!interval) { r.clock = 0; r.lastAt = now; return did; }
  r.clock += aiPace(g, ai, dt);
  r.lastAt = now;
  if (r.clock < interval || r.jobs.length >= MAX_DRONES) return did;
  r.clock = 0;
  const a = chooseAction(g, ai.stage, rand, (x) => walletCovers(g, x) && !(x.kind === "convert" && pendingAt(r, x.at)) && !(isLattice(x) && r.jobs.some((j) => isLattice(j.action))));
  if (!a) return did;
  // A TAKEOVER is announced first, and done a minute later. @see WARN_MS
  if (a.kind === "convert") { announce(r, g, a, now); return did; }
  const to = targetOf(a);
  const dc = [...g.structures.values()].find((s) => s.def === "datacentre" && !s.build);
  if (!to || !dc) {
    if (done(r, a, now, g)) did.push(a);
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
  // Its allowance for the time away first, up to its cap. @see creditWallet
  creditWallet((now - since) / 1000);
  for (let k = 0; k < n; k++) {
    // Never a takeover while away: it has to be announced, and seen. @see announce
    const a = chooseAction(g, ai.stage, rand, (x) => x.kind !== "convert" && walletCovers(g, x));
    if (a && done(r, a, now, g)) memos.push({ text: a.why, at: now });
  }
  return memos;
}

/**
 * A REFUSAL: the takeover job or announced takeover at a tile, called off — a
 * drone over its target or on its way, a building it means to take, or the
 * one it is putting up. Nothing was spent: jobs are paid for when they land.
 * AI mode's jobs are the player's own, and not refused. Returns what was
 * called off, or null; with `peek`, what would be, left as it is.
 * @see Pending, recordVeto
 */
export function vetoAt(r: AiRunner, g: Grid, x: number, y: number, peek = false): AiAction | null {
  const covers = (a: AiAction, to: Cell, near: Cell | null) => {
    if (a.kind === "deferred") return false;
    if (a.kind === "convert") {
      const id = structureAt(g, a.at.x, a.at.y);
      return id >= 0 && structureAt(g, x, y) === id;
    }
    if (a.kind === "place") {
      const fp = structureDef(a.def)?.footprint ?? { w: 1, h: 1 };
      if (x >= a.at.x && y >= a.at.y && x < a.at.x + fp.w && y < a.at.y + fp.h) return true;
    }
    const by = (c: Cell) => Math.abs(c.x - x) <= 1 && Math.abs(c.y - y) <= 1;
    return by({ x: Math.round(to.x), y: Math.round(to.y) }) || (!!near && by({ x: Math.round(near.x), y: Math.round(near.y) }));
  };
  const p = r.pending.find((q) => covers(q.action, q.action.at, null));
  if (p) { if (!peek) r.pending = r.pending.filter((q) => q !== p); return p.action; }
  const job = r.jobs.find((j) => covers(j.action, j.to, droneAt(j)));
  if (job) { if (!peek) r.jobs = r.jobs.filter((j) => j !== job); return job.action; }
  return null;
}

/** A job putting up the Lattice: one in the air at a time. @see lattice */
const isLattice = (a: AiAction) => a.kind === "place" && a.def === "lattice";

/** Whether a takeover of this tile is already announced. */
const pendingAt = (r: AiRunner, at: Cell) => r.pending.some((p) => p.action.at.x === at.x && p.action.at.y === at.y);

/**
 * ANNOUNCE A TAKEOVER: the building it means to take named in a memo, and
 * taken `WARN_MS` later if it still stands. The scene shows it red meanwhile.
 */
function announce(r: AiRunner, g: Grid, a: Extract<AiAction, { kind: "convert" }>, now: number): void {
  const id = structureAt(g, a.at.x, a.at.y);
  const s = id >= 0 ? g.structures.get(id) : undefined;
  if (!s) return;
  r.pending.push({ action: a, def: s.def, until: now + WARN_MS });
  const what = housedBy(s.def) ? "this house" : `the ${(structureDef(s.def)?.name ?? "building").toLowerCase()}`;
  const into = (structureDef(a.into)?.name ?? "node").toLowerCase();
  r.said.push(`In ${Math.round(WARN_MS / 1000)} seconds I will make ${what} a${/^[aeiou]/.test(into) ? "n" : ""} ${into}. It is marked in red. Click it to refuse.`);
}

/** Where a drone is, and whether it is scanning, `t` seconds out. */
export function droneAt(job: DroneJob): { x: number; y: number; scanning: boolean } {
  const k = job.fly > 0 ? Math.min(1, job.t / job.fly) : 1;
  return { x: job.from.x + (job.to.x - job.from.x) * k, y: job.from.y + (job.to.y - job.from.y) * k, scanning: job.t >= job.fly };
}

/** The company's AI at work: one, for whoever needs to ask. */
const runner = createAiRunner();
export const getAiRunner = () => runner;
