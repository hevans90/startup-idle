/**
 * World v2 — AI MODE: The Model's autopilot. Switched on, the town plans and
 * builds itself: a MASTERPLAN of its streets worked out off the main thread,
 * and every couple of seconds the next step for the town as it stands — an
 * office, a service, a lot, the next piece of street — built through the
 * player's own actions, within the budget, a drone flying each out. It hires
 * into empty beds, buys the employee upgrade the next project waits on, starts
 * the projects as they open, buys land when the plan runs out of room, and
 * clears derelicts in its way. @see nextStep, planTown, plans/singularity.md §4b
 */
import { buildCost, roadCost } from "../../game/build-cost";
import { roomFor } from "../../game/housing";
import { PROJECTS, featureGateOpen, gateParts } from "../../game/projects";
import { nextPerSet, upgradeSet } from "../../game/upgrade-sets";
import { useUpgradeStore } from "../../state/upgrades.store";
import { getGeneratorCost } from "../../utils/generator-utils";
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
import { buyParcelAt, demolishAt, liftRoad, paveRoad, placeStructure, reshape, startProject } from "../play/build-actions";
import { getAiRunner } from "./ai-runner";
import type { Masterplan, PlanStep } from "./masterplan/plan";
import { inBox, planTown, sectionOf, wholeMap, type Box } from "./masterplan/plan";
import { nextStep, roadTiles } from "./masterplan/schedule";
import { layRoute, neededPipe } from "./cooling-ai";
import type { PipeRoute } from "./pipe-route";
import { styleOf } from "./masterplan/style";
import { fusedInto } from "../../game/fusion";
import type { PlanRequest } from "./masterplan/masterplan.worker";

/** Seconds between the autopilot's steps; seconds before a plan is planned again regardless. */
export const AUTOPILOT_EVERY = 2;
export const REPLAN_EVERY = 180;
/** Tiles round the town a section's plan reaches, and how much further each one it can do nothing with. @see sectionOf */
export const SECTION = 8;

type State = { plan: Masterplan | null; plannedAt: number; landKey: string; asked: number | null; clock: number; worker: Worker | null; done: number; last: string | null; failed: Set<string>; margin: number; doneAtPlan: number; box: Box | null; pipe: PipeRoute | null };
const state: State = { plan: null, plannedAt: 0, landKey: "", asked: null, clock: 0, worker: null, done: 0, last: null, failed: new Set(), margin: SECTION, doneAtPlan: 0, box: null, pipe: null };

/** The plan now, for the overlay and the panel; null until one is made. */
export const currentPlan = () => state.plan;
/** How The Model leans: the traits the generations before it ended with. @see styleOf */
export const modelStyle = () => styleOf(fusedInto("model"));

/** The pipe it means to lay and cannot yet pay for, for the ghost. @see neededPipe */
export const pendingPipe = () => state.pipe;

/** Steps the autopilot has taken this company. */
export const stepsTaken = () => state.done;
/** What it built last, in words; null before its first step. */
export const lastStep = () => state.last;

/** A step, in words. */
const named = (s: PlanStep) =>
  s.kind === "road" ? "a piece of street"
    : s.kind === "level" ? "ground levelled for a street"
      : s.kind === "lift" ? "a spur that went nowhere, lifted"
        : s.kind === "clear" ? "a house cleared for a street"
          : s.def.startsWith("kit:") ? "a lot" : (structureDef(s.def) ? saleName(structureDef(s.def)!) : s.def).toLowerCase();

/** A step, as a key: to remember the ones that failed. */
const keyOf = (s: PlanStep) => JSON.stringify(s.kind === "build" ? { k: s.def, at: s.at } : s);

/** Where a step happens, for its drone. */
const whereOf = (s: PlanStep) => (s.kind === "road" || s.kind === "level" ? s.to : s.at);

/** Take a step through the player's own actions. Whether it went. */
function take(s: PlanStep): boolean {
  switch (s.kind) {
    case "road": return paveRoad(s.from, s.to);
    case "level": return reshape("flatten", s.from, s.to);
    case "lift": return liftRoad(s.at, s.at);
    case "clear": return demolishAt(s.at);
    case "build": return placeStructure(s.def, s.at);
  }
}

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
  const style = modelStyle();
  // A SECTION AT A TIME: the town and a margin round it. @see sectionOf
  const box = sectionOf(g, state.margin);
  const owned = (x: number, y: number) => ownsTile(g, land, x, y) && inBox(box, x, y);
  state.asked = Date.now();
  state.box = box;
  const arrived = (plan: Masterplan) => { state.plan = plan; state.plannedAt = Date.now(); state.doneAtPlan = state.done; };
  if (inline) { arrived(planTown(g, { owned, kinds, services, offices, style })); return; }
  state.worker ??= new Worker(new URL("./masterplan/masterplan.worker.ts", import.meta.url), { type: "module" });
  state.worker.onmessage = (e: MessageEvent<{ id: number; plan: Masterplan }>) => {
    if (e.data.id !== state.asked) return;
    arrived(e.data.plan);
  };
  // A WORKER THAT FAILS is not "Planning…" for ever: said, and planned here from now on.
  state.worker.onerror = (e) => {
    console.warn("AI mode: the planning worker failed; planning on the main thread", e.message);
    state.worker?.terminate();
    state.worker = null;
    inline = true;
    arrived(planTown(g, { owned, kinds, services, offices, style }));
  };
  const req: PlanRequest = { id: state.asked, file: serializeWorld(g, { terrain: [], paved: [null] }), land, kinds, services, offices, style, box };
  state.worker.postMessage(req);
}

/** What a step would cost now. */
function priceOf(g: Grid, s: PlanStep): number {
  // Levelling, lifting road and pulling a house down are free, to a player too.
  if (s.kind === "road") return roadCost(roadTiles(g, s)).toNumber();
  if (s.kind !== "build") return 0;
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

/** The most it hires in one step. */
const MAX_HIRE = 1000;

/**
 * HIRING, as the Employees tab hires: into beds standing empty, of the kind
 * whose next hire earns the most for what it costs, as many as the beds take
 * and `spend` pays for. What was done, in words, or null. @see purchaseGenerator
 */
function hire(spend: number): string | null {
  const gens = useGeneratorStore.getState();
  let best: { id: GeneratorId; name: string; worth: number; room: number } | null = null;
  for (const gen of gens.generators) {
    const id = gen.id as GeneratorId;
    // Beds can be unlimited where no map counts them: a hire at a time is still bounded. @see roomFor
    const room = Math.min(MAX_HIRE, Math.floor(roomFor(id, gen.amount)));
    const one = getGeneratorCost(id, 1).toNumber();
    if (room <= 0 || !(one > 0) || one > spend) continue;
    const worth = gens.getGeneratorMoneyPerSecond(id, 1) / one;
    if (!best || worth > best.worth) best = { id, name: gen.name, worth, room };
  }
  if (!best) return null;
  // As many as the budget pays for: the price of n rises with n.
  let lo = 1, hi = best.room;
  while (lo < hi) {
    const mid = Math.floor((lo + hi + 1) / 2);
    if (getGeneratorCost(best.id, mid).toNumber() <= spend) lo = mid; else hi = mid - 1;
  }
  const before = gens.generators.find((x) => x.id === best.id)?.amount ?? 0;
  gens.purchaseGenerator(best.id, lo);
  const n = (useGeneratorStore.getState().generators.find((x) => x.id === best.id)?.amount ?? 0) - before;
  return n > 0 ? `${n} ${best.name.toLowerCase()}${n === 1 ? "" : "s"} hired` : null;
}

/** Take one step. Whether anything was built. */
function act(g: Grid, budget: number): boolean {
  const money = useMoneyStore.getState().money.toNumber();
  const spend = money * budget;
  // THE UPGRADE THE NEXT PROJECT WAITS ON, bought as the Employees tab offers
  // it: the next of its set, which may be one on the way to it. Not
  // affordable yet, and the rest of the work goes on. @see gateParts, nextPerSet
  if (!projectUnderWay(g)) {
    const built = builtProjects(g);
    const ups = useUpgradeStore.getState();
    const unlocked = new Set(ups.unlockedUpgradeIds);
    const owned = Object.fromEntries(useGeneratorStore.getState().generators.map((x) => [x.id, x.amount])) as Partial<Record<GeneratorId, number>>;
    for (const p of PROJECTS) {
      if (built.has(p.id) || p.bonus) continue;
      const want = gateParts(p.gate, owned, unlocked).find((x): x is Extract<typeof x, { kind: "upgrade" }> => x.kind === "upgrade" && !x.met);
      if (!want) continue;
      const buy = nextPerSet(ups.availableUpgrades).find((u) => upgradeSet(u) === upgradeSet({ id: want.id }));
      if (buy && buy.cost <= spend) {
        ups.unlockUpgrade(buy.id);
        if (useUpgradeStore.getState().unlockedUpgradeIds.includes(buy.id)) { state.last = `${buy.name}, for the ${p.name}`; return true; }
      }
      break;
    }
  }
  // HIRING, into the beds standing empty. @see hire
  const hired = hire(spend);
  if (hired) { state.last = hired; return true; }
  // COOLING: a pipe to water for a building that drinks and runs short —
  // ahead of any lot. Shown as a ghost while it cannot be paid for.
  // @see neededPipe
  const pipe = neededPipe(g);
  state.pipe = pipe?.route ?? null;
  if (pipe && !state.failed.has(`pipe:${pipe.s.id}`)) {
    if (pipe.price > spend) return false;
    if (layRoute(pipe.route)) {
      fly(pipe.route.pipe[pipe.route.pipe.length - 1], g);
      state.last = pipe.route.pump ? "a pump house and a pipe, for cooling" : "a pipe, for cooling";
      state.pipe = null;
      return true;
    }
    state.failed.add(`pipe:${pipe.s.id}`);
  }
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
  const s = state.plan && nextStep(g, state.plan, {
    rules: playRules(g), kinds: kindsByNeed(), services: featureGateOpen("services"), offices: true,
    skip: (p) => state.failed.has(keyOf(p)),
    style: modelStyle(),
  });
  if (s) {
    if (priceOf(g, s) > spend) return false;
    const ok = take(s);
    if (ok) { fly(whereOf(s), g); state.last = named(s); }
    // REFUSED with the money there: not tried again this plan.
    else state.failed.add(keyOf(s));
    return ok;
  }
  // THE SECTION DONE: the next, round the town as it now stands — further out
  // if this one gave it nothing to do — till a section is the whole map.
  if (state.plan && state.box && !wholeMap(g, state.box)) {
    state.margin = state.done > state.doneAtPlan ? SECTION : state.margin + SECTION;
    state.plan = null;
    return false;
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
  if (stale && (state.asked === null || now - state.asked > 5_000)) { state.landKey = landKey; state.failed.clear(); requestPlan(g); }
  state.clock += dt;
  if (state.clock < AUTOPILOT_EVERY) return;
  state.clock = 0;
  if (act(g, s.aiBudget)) state.done++;
}

/** A new company: a new plan. */
export function resetAutopilot() {
  state.plan = null; state.plannedAt = 0; state.landKey = ""; state.asked = null; state.clock = 0; state.done = 0; state.last = null; state.failed.clear(); state.margin = SECTION; state.doneAtPlan = 0; state.box = null; state.pipe = null;
}

/** Re-plan now: the map changed under it. */
export const replan = () => { state.plan = null; };

