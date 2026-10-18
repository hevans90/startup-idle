/**
 * World v2 — AI MODE: The Model's autopilot. Switched on, the town plans and
 * builds itself: a MASTERPLAN of its streets worked out off the main thread,
 * and every couple of seconds the next step for the town as it stands — an
 * office, a service, a lot, the next piece of street — built through the
 * player's own actions, within the budget, a drone flying each out. It starts
 * the projects as they open and buys land when the plan runs out of room, and
 * clears derelicts in its way. @see nextStep, planTown, plans/singularity.md §4b
 */
import { buildCost, roadCost } from "../../game/build-cost";
import { roomFor } from "../../game/housing";
import { PROJECTS, featureGateOpen } from "../../game/projects";
import { useGeneratorStore, type GeneratorId } from "../../state/generators.store";
import { useMoneyStore } from "../../state/money.store";
import { useSessionStore } from "../../state/session.store";
import { clearingPrice, companyLand, parcelPrice, playRules } from "../../state/world.store";
import { serializeWorld } from "../io/serialize";
import { PARCELS, buyable, ownsTile, parcelRect } from "../land";
import { builtProjects, nearestSpot, projectUnderWay } from "../projects/works";
import { structureDef } from "../structures/def";
import { saleName } from "../play/building-info";
import type { Grid } from "../grid";
import { buyParcelAt, demolishAt, paveRoad, placeStructure, startProject } from "../play/build-actions";
import { getAiRunner } from "./ai-runner";
import type { Masterplan, PlanStep } from "./masterplan/plan";
import { planTown } from "./masterplan/plan";
import { nextStep, roadTiles } from "./masterplan/schedule";
import type { PlanRequest } from "./masterplan/masterplan.worker";

/** Seconds between the autopilot's steps; seconds before a plan is planned again regardless. */
export const AUTOPILOT_EVERY = 2;
export const REPLAN_EVERY = 180;

type State = { plan: Masterplan | null; plannedAt: number; landKey: string; asked: number | null; clock: number; worker: Worker | null; done: number; last: string | null };
const state: State = { plan: null, plannedAt: 0, landKey: "", asked: null, clock: 0, worker: null, done: 0, last: null };

/** The plan now, for the overlay and the panel; null until one is made. */
export const currentPlan = () => state.plan;
/** Steps the autopilot has taken this company. */
export const stepsTaken = () => state.done;
/** What it built last, in words; null before its first step. */
export const lastStep = () => state.last;

/** A step, in words. */
const named = (s: PlanStep) =>
  s.kind === "road" ? "a piece of street" : s.def.startsWith("kit:") ? "a lot" : (structureDef(s.def) ? saleName(structureDef(s.def)!) : s.def).toLowerCase();

/** The kinds it can house, the one most short of beds first. */
function kindsByNeed(): GeneratorId[] {
  return useGeneratorStore.getState().generators
    .map((g) => ({ id: g.id as GeneratorId, room: roomFor(g.id as GeneratorId, g.amount) }))
    .sort((a, b) => a.room - b.room)
    .map((k) => k.id);
}

/** Whether plans are made here rather than in a worker: where there is none, and in tests. */
let inline = typeof Worker === "undefined";
export const planInline = () => { inline = true; };

/** Ask for a plan: in a worker, or here. */
function requestPlan(g: Grid) {
  const land = companyLand();
  const kinds = kindsByNeed();
  const services = featureGateOpen("services"), offices = true;
  state.asked = Date.now();
  if (inline) {
    state.plan = planTown(g, { owned: (x, y) => ownsTile(g, land, x, y), kinds, services, offices });
    state.plannedAt = Date.now();
    return;
  }
  state.worker ??= new Worker(new URL("./masterplan/masterplan.worker.ts", import.meta.url), { type: "module" });
  state.worker.onmessage = (e: MessageEvent<{ id: number; plan: Masterplan }>) => {
    if (e.data.id !== state.asked) return;
    state.plan = e.data.plan;
    state.plannedAt = Date.now();
  };
  const req: PlanRequest = { id: state.asked, file: serializeWorld(g, { terrain: [], paved: [null] }), land, kinds, services, offices };
  state.worker.postMessage(req);
}

/** What a step would cost now. */
function priceOf(g: Grid, s: PlanStep): number {
  if (s.kind === "road") return roadCost(roadTiles(g, s)).toNumber();
  return buildCost(s.def)?.toNumber() ?? Infinity;
}

/** A drone, for the look of it: the job is done when it is sent. @see stepAi */
function fly(to: { x: number; y: number }, g: Grid) {
  const dc = [...g.structures.values()].find((s) => s.def === "datacentre" && !s.build)
    ?? [...g.structures.values()].find((s) => s.def === "garage");
  if (!dc) return;
  const from = { x: dc.x + dc.w / 2, y: dc.y + dc.h / 2 };
  getAiRunner().jobs.push({ action: { kind: "noop", at: to, why: "" }, from, to, t: 0, fly: Math.hypot(to.x - from.x, to.y - from.y) / 5 });
}

/** Take one step. Whether anything was built. */
function act(g: Grid, budget: number): boolean {
  const money = useMoneyStore.getState().money.toNumber();
  const spend = money * budget;
  // THE PROJECTS, as they open: the next one ready, at the nearest good spot. @see nearestSpot
  if (!projectUnderWay(g)) {
    const built = builtProjects(g);
    for (const p of PROJECTS) {
      if (built.has(p.id) || p.bonus) continue;
      const def = structureDef(p.structure);
      if (!def) continue;
      const at = nearestSpot(g, def, playRules(g), state.plan?.centre);
      if (at && startProject(p.id, at)) { fly(at, g); state.last = p.name; return true; }
    }
  }
  const s = state.plan && nextStep(g, state.plan, { rules: playRules(g), kinds: kindsByNeed(), services: featureGateOpen("services"), offices: true });
  if (s) {
    if (priceOf(g, s) > spend) return false;
    const ok = s.kind === "road" ? paveRoad(s.from, s.to) : placeStructure(s.def, s.at);
    if (ok) { fly(s.kind === "road" ? s.to : s.at, g); state.last = named(s); }
    return ok;
  }
  // NOTHING LEFT TO BUILD ON: clear a derelict, or buy the next parcel, and plan again.
  const land = companyLand();
  const derelict = [...g.structures.values()].find((d) => d.def === "derelict" && ownsTile(g, land, d.x, d.y));
  if (derelict && clearingPrice() <= spend && demolishAt({ x: derelict.x, y: derelict.y })) { state.plan = null; state.last = "a derelict cleared"; return true; }
  if (land && parcelPrice() <= spend) {
    for (let p = 0; p < PARCELS * PARCELS; p++) {
      if (!buyable(land, p)) continue;
      const r = parcelRect(g, p);
      if (buyParcelAt({ x: (r.x0 + r.x1) >> 1, y: (r.y0 + r.y1) >> 1 })) { state.plan = null; state.last = "a parcel of land"; return true; }
    }
  }
  return false;
}

/** One frame of AI mode: plan when the plan is stale, a step every `AUTOPILOT_EVERY` seconds. */
export function stepAutopilot(g: Grid, dt: number, now = Date.now()) {
  const s = useSessionStore.getState();
  if (!s.aiMode) return;
  const landKey = (companyLand() ?? []).join();
  const stale = !state.plan || landKey !== state.landKey || now - state.plannedAt > REPLAN_EVERY * 1000;
  if (stale && (state.asked === null || now - state.asked > 5_000)) { state.landKey = landKey; requestPlan(g); }
  state.clock += dt;
  if (state.clock < AUTOPILOT_EVERY) return;
  state.clock = 0;
  if (act(g, s.aiBudget)) state.done++;
}

/** A new company: a new plan. */
export function resetAutopilot() {
  state.plan = null; state.plannedAt = 0; state.landKey = ""; state.asked = null; state.clock = 0; state.done = 0; state.last = null;
}

/** Re-plan now: the map changed under it. */
export const replan = () => { state.plan = null; };

