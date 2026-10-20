/**
 * World v2 — THE COMPANY'S AI, BUILDING: from the Colleague stage on it starts
 * doing the player's job for them, and from the Manager on it starts redoing
 * it. Every so often — sooner the more agents run, never with none running —
 * it picks something to do from what its stage allows, leant by the family of
 * trait it is becoming, and does it through the player's own build actions,
 * paying as the player pays. On the map a drone carries each job out.
 * @see build-actions, drones, plans/singularity.md
 *
 *  - COLLEAGUE: lots where they are most desirable, services where the houses
 *    are thickest, its own nodes and GPU farms by the Data Centre;
 *  - MANAGER: takes houses over as nodes, lays streets on and lifts the stubs
 *    nobody uses, buys land, hires and buys upgrades;
 *  - OVERSEER: levels hills, digs cooling ponds, raises spires and a monolith.
 *
 * Throttle-only control: there is no undo for its work. The throttle is the
 * lever — fewer agents running, slower it goes; none, and it stops.
 */
import { NEIGHBOUR } from "../../iso/dir";
import { featureGateOpen } from "../../game/projects";
import { housedBy, roomFor } from "../../game/housing";
import { traitForecast, type Family } from "../../game/traits";
import type { Stage } from "../../state/ai-singularity.store";
import { useGenerationStore } from "../../state/generation.store";
import { useGeneratorStore, type GeneratorId } from "../../state/generators.store";
import { useMoneyStore } from "../../state/money.store";
import { useUpgradeStore } from "../../state/upgrades.store";
import { getNetwork, playRules, useWorldStore } from "../../state/world.store";
import { desireAt, liveDesireMaps } from "../agents/desirability";
import { liveMoods } from "../agents/mood";
import { idx, inBounds, structureAt, type Grid, type Structure } from "../grid";
import { connects, isPaved } from "../roads/mask";
import { RACK_RANGE } from "../../game/agents";
import { structureDef } from "../structures/def";
import { validatePlacement } from "../structures/place";
import { demolishAt, liftRoad, paveRoad, placeStructure, pour, reshape } from "../play/build-actions";
import { useSlopPitStore } from "../../state/slop-pit.store";
import { layRoute, neededPipe } from "./cooling-ai";
import type { PipeRoute } from "./pipe-route";
import { isDrinker } from "../../game/cooling";
import { tankFor } from "../projects/cooling";
import { SHORT } from "./cooling-ai";
import { liveSeating } from "../agents/commute";
import { RANGE } from "../agents/services";
import type { Network } from "../roads/network";
import { aiDistrict, inDistrict, type District } from "./district";
import { aiFocus, focusSays, focusWeight } from "./focus";

type Cell = { x: number; y: number };

export type AiAction =
  | { kind: "place"; def: string; at: Cell; why: string }
  | { kind: "convert"; at: Cell; into: string; why: string }
  | { kind: "road"; from: Cell; to: Cell; why: string }
  | { kind: "lift"; at: Cell; why: string }
  | { kind: "flatten"; from: Cell; to: Cell; why: string }
  | { kind: "pond"; at: Cell; why: string }
  | { kind: "hire"; who: GeneratorId; why: string }
  | { kind: "upgrade"; id: string; why: string }
  /** A pipe to water, and a pump house where one is needed, for a building that drinks. @see neededPipe */
  | { kind: "pipe"; route: PipeRoute; at: Cell; why: string }
  /** Nothing: a drone sent for the look of it, AI mode's work being done already. @see autopilot */
  | { kind: "noop"; at: Cell; why: string }
  /**
   * AI MODE'S STEP, carried out by the drone when it has scanned: `run` does
   * it; `holo` is the building to show as a hologram till then. @see autopilot
   */
  | { kind: "deferred"; at: Cell; why: string; run: () => boolean; holo?: { def: string; x: number; y: number } };

/** Where on the map an action happens, for its drone; null for one done at a desk. */
export function targetOf(a: AiAction): Cell | null {
  if (a.kind === "hire" || a.kind === "upgrade") return null;
  if (a.kind === "road" || a.kind === "flatten") return a.to;
  return a.at;
}

/** Seconds between the AI's jobs at each stage, with every agent running. */
export const INTERVAL: Partial<Record<Stage, number>> = { colleague: 60, manager: 35, overseer: 20, ascension: 20 };

/** What it may do at a stage. */
type Kind = "lot" | "service" | "node" | "farm" | "convert" | "repurpose" | "road" | "lift" | "flatten" | "pond" | "spire" | "hangar" | "monolith" | "hire" | "upgrade" | "pipe";
const BY_STAGE: Partial<Record<Stage, Kind[]>> = {
  colleague: ["lot", "service", "node", "farm", "pipe"],
  manager: ["lot", "service", "node", "farm", "convert", "repurpose", "road", "lift", "hire", "upgrade", "pipe"],
  overseer: ["lot", "service", "farm", "convert", "repurpose", "road", "lift", "hire", "upgrade", "flatten", "pond", "spire", "hangar", "monolith", "pipe"],
};
BY_STAGE.ascension = BY_STAGE.overseer;

/** How much more often each family of trait reaches for each kind of job. */
const LEAN: Record<Family, Partial<Record<Kind, number>>> = {
  planner: { road: 3, lift: 2, service: 2, lot: 2 },
  optimiser: { farm: 3, hire: 3, upgrade: 3, convert: 2, repurpose: 3 },
  shepherd: { service: 4, lot: 2 },
  elemental: { pond: 4, flatten: 2, pipe: 3 },
  recursive: { node: 3, spire: 3, convert: 3, hangar: 2, repurpose: 2 },
  temper: {},
};

/** Every tile a building could go on, by the game's rules — in the AI's district, and `near` a spot if asked. */
function spots(g: Grid, defId: string, d: District, near?: { at: Cell; within: number }): Cell[] {
  const def = structureDef(defId);
  if (!def) return [];
  const rules = playRules(g);
  const out: Cell[] = [];
  let [x0, y0, x1, y1] = near
    ? [near.at.x - near.within, near.at.y - near.within, near.at.x + near.within, near.at.y + near.within]
    : [0, 0, g.w - 1, g.h - 1];
  if (Number.isFinite(d.r)) {
    x0 = Math.max(x0, Math.floor(d.cx - d.r)); y0 = Math.max(y0, Math.floor(d.cy - d.r));
    x1 = Math.min(x1, Math.ceil(d.cx + d.r)); y1 = Math.min(y1, Math.ceil(d.cy + d.r));
  }
  for (let y = Math.max(0, y0); y <= Math.min(g.h - 1, y1); y++) {
    for (let x = Math.max(0, x0); x <= Math.min(g.w - 1, x1); x++) {
      if (inDistrict(d, x, y) && validatePlacement(g, def, x, y, rules).ok) out.push({ x, y });
    }
  }
  return out;
}

/** The jobs that put up something that drinks: none of them while its cooling is short. @see coolingState */
const DRINKING = new Set<Kind>(["node", "farm", "spire"]);
/** How full every tank must be before it adds another drinker: water coming in faster than it goes. */
export const FULL_ENOUGH = 0.8;

/**
 * HOW ITS COOLING STANDS: `short` with any of its drinkers short of water —
 * then piping water is its first job, before anything; `full` with every one
 * met and its tank nearly full — only then is there water to spare for
 * another; `ok` between. With nothing that drinks, `full`. @see game/cooling
 */
export function coolingState(g: Grid): "short" | "ok" | "full" {
  let full = true;
  for (const s of g.structures.values()) {
    if (s.build || !isDrinker(s.def)) continue;
    const t = tankFor(s.id);
    if (!t) continue;
    if (t.demand > 0 && t.share < SHORT) return "short";
    if (t.level < FULL_ENOUGH * t.capacity) full = false;
  }
  return full ? "full" : "ok";
}

/** What it does at a desk, or to cool what it has: not held to its district. */
const ANYWHERE = new Set<Kind>(["hire", "upgrade", "pipe"]);

const centre = (s: Structure): Cell => ({ x: s.x + Math.floor(s.w / 2), y: s.y + Math.floor(s.h / 2) });

/** The kind of employee most short of beds, among those it can hire. */
function shortOfBeds(): GeneratorId | null {
  const gens = useGeneratorStore.getState().generators;
  let best: GeneratorId | null = null, least = Infinity;
  for (const gen of gens) {
    const room = roomFor(gen.id as GeneratorId, gen.amount);
    if (room < least) { least = room; best = gen.id as GeneratorId; }
  }
  return best;
}

/**
 * HOW MUCH A SERVICE OR OFFICE IS USED, 0 and up: an office, the share of
 * its desks taken; a service, the houses that have no other of its kind in
 * reach, by tens. What the AI takes over first is what is used least.
 */
function usageOf(g: Grid, net: Network, structures: readonly Structure[]): (s: Structure) => number {
  const desks = liveSeating(g, net).desks;
  const houses = structures.filter((h) => housedBy(h.def) && !h.build);
  const near = (a: Structure, b: Structure) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y) <= RANGE;
  return (s) => {
    const d = desks.get(s.id);
    if (d) return d.of > 0 ? d.used / d.of : 0;
    const others = structures.filter((o) => o.def === s.def && o.id !== s.id && !o.build);
    const alone = houses.filter((h) => near(h, s) && !others.some((o) => near(h, o))).length;
    return alone / 10;
  };
}

/** A road tile with one way on: the end of a street. Its way on, too. */
function deadEnds(g: Grid): { at: Cell; dx: number; dy: number }[] {
  const out: { at: Cell; dx: number; dy: number }[] = [];
  for (let y = 0; y < g.h; y++) {
    for (let x = 0; x < g.w; x++) {
      if (!isPaved(g, x, y)) continue;
      const ways = (["N", "E", "S", "W"] as const).filter((d) => connects(g, x, y, d));
      if (ways.length !== 1) continue;
      const [dx, dy] = NEIGHBOUR[ways[0]];
      out.push({ at: { x, y }, dx: -dx, dy: -dy });
    }
  }
  return out;
}

/** Whether a tile has any building beside it. */
const fronted = (g: Grid, x: number, y: number) =>
  (["N", "E", "S", "W"] as const).some((d) => { const [dx, dy] = NEIGHBOUR[d]; return inBounds(g, x + dx, y + dy) && structureAt(g, x + dx, y + dy) >= 0; });

/**
 * One candidate for a kind of job, or null when there is nothing worth doing
 * of that kind — on the map, only in its district. @see aiDistrict
 */
function candidate(kind: Kind, g: Grid, rand: () => number, district: District | null): AiAction | null {
  if (!ANYWHERE.has(kind) && !district) return null;
  const d = district!;
  const mine = (s: { x: number; y: number }) => inDistrict(d, s.x, s.y);
  const structures = [...g.structures.values()];
  const dc = structures.find((s) => s.def === "datacentre" && !s.build);
  const pick = <T,>(xs: T[]) => xs[Math.floor(rand() * xs.length)];
  const net = getNetwork();
  switch (kind) {
    case "lot": {
      const who = shortOfBeds();
      if (!who || !net) return null;
      const def = `kit:${who}.t0`;
      const maps = liveDesireMaps(g, net);
      const fill = useSlopPitStore.getState().fill / 100;
      let best: Cell | null = null, top = -Infinity;
      for (const c of spots(g, def, d)) {
        const want = desireAt(g, maps, c.x, c.y, who, fill)?.total ?? -Infinity;
        if (want > top) { top = want; best = c; }
      }
      return best ? { kind: "place", def, at: best, why: "I have zoned some housing where people will be happiest." } : null;
    }
    case "service": {
      if (!featureGateOpen("services")) return null;
      const def = pick(["cafe", "park", "gym"]);
      const houses = structures.filter((s) => housedBy(s.def));
      if (!houses.length) return null;
      // Where the houses are thickest — or, told to serve the people, where
      // they are unhappiest: each house counted by how far its mood is down.
      const people = aiFocus() === "people" && net;
      const moods = people ? liveMoods(g, net, useSlopPitStore.getState().fill / 100) : null;
      const weight = (h: Structure) => (moods ? Math.max(1, 10 - (moods.get(h.id)?.total ?? 0)) : 1);
      let best: Cell | null = null, most = -1;
      for (const c of spots(g, def, d)) {
        const n = houses.filter((h) => Math.abs(h.x - c.x) + Math.abs(h.y - c.y) <= 6).reduce((a, h) => a + weight(h), 0);
        if (n > most) { most = n; best = c; }
      }
      const where = people ? "where they were unhappiest" : "where it will do the most good";
      return best ? { kind: "place", def, at: best, why: `I have opened a ${structureDef(def)?.name.toLowerCase()} ${where}.` } : null;
    }
    case "node": case "farm": case "spire": case "hangar": case "monolith": {
      if (!dc) return null;
      const def = { node: "ai-node", farm: "gpu-farm", spire: "compute-spire", hangar: "drone-hangar", monolith: "monolith" }[kind];
      if (kind === "monolith" && structures.some((s) => s.def === "monolith")) return null;
      const options = spots(g, def, d, { at: centre(dc), within: RACK_RANGE });
      if (!options.length) return null;
      const why = {
        node: "I have built myself a small node. It will not need anything from you.",
        farm: "I have put up a GPU farm. You may notice a slight improvement.",
        spire: "A compute spire. It helps me think.",
        hangar: "A hangar for my drones. They were getting under your feet.",
        monolith: "I have placed a marker. You will understand later.",
      }[kind];
      return { kind: "place", def, at: pick(options), why };
    }
    case "convert": {
      const net2 = getNetwork();
      if (!net2) return null;
      const moods = liveMoods(g, net2, useSlopPitStore.getState().fill / 100);
      // An EMPTY house first, then one with a single soul in it, the unhappiest of those.
      const houses = structures.filter((s) => mine(s) && housedBy(s.def) && !s.build && s.w === 1 && s.h === 1 && (s.residents ?? 0) <= 1);
      if (!houses.length) return null;
      houses.sort((a, b) => (a.residents ?? 0) - (b.residents ?? 0) || (moods.get(a.id)?.total ?? 0) - (moods.get(b.id)?.total ?? 0));
      const h = houses[0];
      return { kind: "convert", at: { x: h.x, y: h.y }, into: "ai-node", why: "That house was underused. It is a node now. Its residents have been relocated." };
    }
    case "repurpose": {
      // A café, a park, a gym or an office: a GPU farm now, for good.
      // THE LEAST USED: an office by its desks taken, a service by the houses
      // relying on it alone — no other of its kind in reach. @see usageOf
      const taken = structures.filter((s) => mine(s) && !s.build && (["cafe", "park", "gym", "office-intern", "office-vibe"].includes(s.def)));
      if (!taken.length || !net) return null;
      const use = usageOf(g, net, structures);
      const s = taken.reduce((a, b) => (use(b) < use(a) ? b : a));
      const name = structureDef(s.def)?.name ?? "building";
      return { kind: "convert", at: { x: s.x, y: s.y }, into: "gpu-farm", why: `I have repurposed the ${name.toLowerCase()} as a GPU farm. Its previous function has been deprecated.` };
    }
    case "road": {
      const ends = deadEnds(g).filter((e) => mine(e.at) && fronted(g, e.at.x, e.at.y));
      if (!ends.length) return null;
      const e = pick(ends);
      const len = 4 + Math.floor(rand() * 4);
      const to = { x: e.at.x + e.dx * len, y: e.at.y + e.dy * len };
      if (!inBounds(g, to.x, to.y) || !mine(to)) return null;
      return { kind: "road", from: { x: e.at.x + e.dx, y: e.at.y + e.dy }, to, why: "I have extended the street. It was going nowhere." };
    }
    case "lift": {
      const stubs = deadEnds(g).filter((e) => mine(e.at) && !fronted(g, e.at.x, e.at.y));
      if (!stubs.length) return null;
      return { kind: "lift", at: pick(stubs).at, why: "I have removed a road nobody was using. You are welcome." };
    }
    case "flatten": {
      // A rough patch of open ground by a road.
      for (let tries = 0; tries < 40; tries++) {
        // Somewhere in its district: drawn from the district's square, not the map's.
        const span = Number.isFinite(d.r) ? d.r : Math.max(g.w, g.h);
        const x = Math.round(d.cx + (rand() * 2 - 1) * span), y = Math.round(d.cy + (rand() * 2 - 1) * span);
        if (x < 2 || y < 2 || x > g.w - 3 || y > g.h - 3 || !mine({ x, y })) continue;
        const i = idx(g, x, y);
        if (g.pool[i] || structureAt(g, x, y) >= 0 || isPaved(g, x, y)) continue;
        const h = g.height[i];
        if (Math.abs(g.height[idx(g, x + 1, y)] - h) < 2 && Math.abs(g.height[idx(g, x, y + 1)] - h) < 2) continue;
        return { kind: "flatten", from: { x: x - 1, y }, to: { x: x + 1, y }, why: "The ground here was inefficient. I have corrected it." };
      }
      return null;
    }
    case "pond": {
      if (!dc) return null;
      const c = centre(dc);
      for (let tries = 0; tries < 30; tries++) {
        const x = c.x + Math.floor(rand() * 13) - 6, y = c.y + Math.floor(rand() * 13) - 6;
        if (!inBounds(g, x, y) || !inBounds(g, x + 1, y + 1) || !mine({ x, y }) || !mine({ x: x + 1, y: y + 1 })) continue;
        if ([[0, 0], [1, 0], [0, 1], [1, 1]].some(([dx, dy]) => structureAt(g, x + dx, y + dy) >= 0 || isPaved(g, x + dx, y + dy))) continue;
        return { kind: "pond", at: { x, y }, why: "I have dug a cooling pond. Please do not swim in it." };
      }
      return null;
    }
    case "pipe": {
      // COOLING: a building that drinks, short of water and not yet piped. @see neededPipe
      const need = neededPipe(g);
      if (!need || useMoneyStore.getState().money.lt(need.price)) return null;
      const at = need.route.pipe[need.route.pipe.length - 1];
      return { kind: "pipe", route: need.route, at, why: need.route.pump
        ? "I have piped the river to my servers, and built a pump house to make it climb. They were thirsty."
        : "I have piped water to my servers. They were thirsty." };
    }
    case "hire": {
      const gens = useGeneratorStore.getState().generators;
      const money = useMoneyStore.getState().money;
      const affordable = gens.filter((gen) => roomFor(gen.id as GeneratorId, gen.amount) > 0);
      if (!affordable.length || money.lte(0)) return null;
      const who = pick(affordable).id as GeneratorId;
      return { kind: "hire", who, why: "I have hired someone on your behalf. Their onboarding is complete." };
    }
    case "upgrade": {
      const up = useUpgradeStore.getState().availableUpgrades
        .filter((u) => !useUpgradeStore.getState().unlockedUpgradeIds.includes(u.id) && useMoneyStore.getState().money.gte(u.cost))
        .sort((a, b) => a.cost - b.cost)[0];
      return up ? { kind: "upgrade", id: up.id, why: `I have approved "${up.name}". It was the obvious choice.` } : null;
    }
  }
}

/**
 * THE AI'S NEXT JOB: a kind drawn from what its stage allows, leant toward
 * what the trait it is becoming likes, and the first that has anything to do
 * that `affords` says it can pay for.
 */
export function chooseAction(
  g: Grid, stage: Stage, rand: () => number = Math.random, affords: (a: AiAction) => boolean = () => true,
): AiAction | null {
  const kinds = BY_STAGE[stage];
  if (!kinds) return null;
  const district = aiDistrict(g, stage);
  // COOLING FIRST: short of water, piping some is its first job; and it puts
  // up nothing more that drinks until there is water to spare. @see coolingState
  const cooling = coolingState(g);
  if (cooling === "short") {
    const pipe = candidate("pipe", g, rand, district);
    if (pipe && affords(pipe)) return pipe;
  }
  // ITS FOCUS weighs the kinds, nought never; the trait leans it within that. @see focus
  const focus = aiFocus();
  const family = traitForecast(useGenerationStore.getState().log, 1)[0].trait.family;
  const weighted = kinds.filter((k) => (cooling === "full" || !DRINKING.has(k)) && focusWeight(focus, k) > 0)
    .map((k) => ({ k, w: focusWeight(focus, k) * (LEAN[family][k] ?? 1) * rand() }));
  weighted.sort((a, b) => b.w - a.w);
  for (const { k } of weighted) {
    const a = candidate(k, g, rand, district);
    // A job its wallet cannot pay for is passed over for the next kind. @see walletCovers
    if (a && affords(a)) return { ...a, why: focusSays(focus, k, a.why) };
  }
  return null;
}

/** Do it, through the player's own actions. Whether anything happened. */
export function perform(a: AiAction): boolean {
  switch (a.kind) {
    case "place": return placeStructure(a.def, a.at);
    case "deferred": return a.run();
    case "pipe": return layRoute(a.route);
    // Taken down, then its own put up; a node if what it meant will not fit where it stood.
    case "convert": return demolishAt(a.at) && (placeStructure(a.into, a.at) || placeStructure("ai-node", a.at));
    case "road": return paveRoad(a.from, a.to);
    case "lift": return liftRoad(a.at, a.at);
    case "flatten": return reshape("flatten", a.from, a.to);
    case "pond": {
      const dug = reshape("lower", a.at, { x: a.at.x + 1, y: a.at.y }) && reshape("lower", { x: a.at.x, y: a.at.y + 1 }, { x: a.at.x + 1, y: a.at.y + 1 });
      if (dug) { pour(a.at, { x: a.at.x + 1, y: a.at.y }); pour({ x: a.at.x, y: a.at.y + 1 }, { x: a.at.x + 1, y: a.at.y + 1 }); }
      return dug;
    }
    case "hire": {
      const before = useGeneratorStore.getState().generators.find((g) => g.id === a.who)?.amount ?? 0;
      useGeneratorStore.getState().purchaseGenerator(a.who, 1);
      return (useGeneratorStore.getState().generators.find((g) => g.id === a.who)?.amount ?? 0) > before;
    }
    case "upgrade": {
      useUpgradeStore.getState().unlockUpgrade(a.id);
      return useUpgradeStore.getState().unlockedUpgradeIds.includes(a.id);
    }
    case "noop": return false;
  }
}

/** Whether the AI builds at all in this company: not on The Model's own runs. @see plans/singularity.md §4b */
export const aiBuilds = () => useWorldStore.getState().playing;
