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
 *  - OVERSEER: levels hills, raises spires and a monolith.
 *  From the Manager, short of water with no way to it, it digs a reservoir. @see reservoir
 *
 * Throttle-only control: there is no undo for its work. The throttle is the
 * lever — fewer agents running, slower it goes; none, and it stops.
 */
import { NEIGHBOUR } from "../../iso/dir";
import { aiSite, inRebuiltBlock } from "./arc-rules";
import { questJobLean, questTakeoverShift } from "../../game/quests/effects";
import { featureGateOpen } from "../../game/projects";
import { housedBy, roomFor } from "../../game/housing";
import { traitForecast, type Family } from "../../game/traits";
import { LATTICE_AT, useAiSingularityStore, type Stage } from "../../state/ai-singularity.store";
import { latticeOf } from "./lattice";
import { hasMachine, useGenerationStore } from "../../state/generation.store";
import { INHERITANCE, keystone, notable } from "../../game/machine";
import { projectTier } from "./masterplan/town-model";
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
import { demolishAt, liftRoad, paveRoad, placeStructure, reshape } from "../play/build-actions";
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
import { MAX_RESERVOIRS, digReservoir, lowReservoir, refillReservoir, reservoirs, siteFor } from "./reservoir";
import { skillOf } from "../../state/training.store";
import { priceOfAi } from "./wallet";
import { useSessionStore } from "../../state/session.store";

type Cell = { x: number; y: number };

export type AiAction =
  | { kind: "place"; def: string; at: Cell; why: string }
  | { kind: "convert"; at: Cell; into: string; why: string }
  | { kind: "road"; from: Cell; to: Cell; why: string }
  | { kind: "lift"; at: Cell; why: string }
  | { kind: "flatten"; from: Cell; to: Cell; why: string }
  /** A basin dug and filled by a building short of water, none being in reach. @see reservoir */
  | { kind: "reservoir"; at: Cell; why: string }
  /** A reservoir run low, topped up: an AI trained on the river. @see lowReservoir */
  | { kind: "refill"; at: Cell; why: string }
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
type Kind = "lot" | "service" | "node" | "farm" | "convert" | "repurpose" | "road" | "lift" | "flatten" | "spire" | "hangar" | "monolith" | "hire" | "upgrade" | "pipe";
const BY_STAGE: Partial<Record<Stage, Kind[]>> = {
  colleague: ["lot", "service", "node", "farm", "pipe"],
  manager: ["lot", "service", "node", "farm", "convert", "repurpose", "road", "lift", "hire", "upgrade", "pipe"],
  overseer: ["lot", "service", "farm", "convert", "repurpose", "road", "lift", "hire", "upgrade", "flatten", "spire", "hangar", "monolith", "pipe"],
};
BY_STAGE.ascension = BY_STAGE.overseer;

/** How much more often each family of trait reaches for each kind of job. */
const LEAN: Record<Family, Partial<Record<Kind, number>>> = {
  planner: { road: 3, lift: 2, service: 2, lot: 2 },
  optimiser: { farm: 3, hire: 3, upgrade: 3, convert: 2, repurpose: 3 },
  shepherd: { service: 4, lot: 2 },
  elemental: { flatten: 2, pipe: 3 },
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

/**
 * A RESERVOIR, for the building in its district shortest of water — only if
 * no pipe can reach water from any, and it has dug fewer than its most.
 */
function reservoirFor(g: Grid, district: District | null): AiAction | null {
  if (!district || reservoirs().length >= MAX_RESERVOIRS || neededPipe(g)) return null;
  const short = [...g.structures.values()]
    .filter((s) => !s.build && isDrinker(s.def) && inDistrict(district, s.x, s.y))
    .map((s) => ({ s, t: tankFor(s.id) }))
    .filter(({ t }) => t && t.demand > 0 && t.share < SHORT)
    .sort((a, b) => a.t!.share - b.t!.share);
  for (const { s } of short) {
    const at = siteFor(g, s, district);
    if (at) return { kind: "reservoir", at: { x: at.x + 1, y: at.y + 1 }, why: "There was no water within reach, so I have made some. It is a reservoir. It is not for swimming." };
  }
  return null;
}

/** Where the Lattice goes: in the district, as near the Data Centre as it fits; null if it stands, or will not fit. */
function latticeFor(g: Grid, district: District | null): AiAction | null {
  if (!district || latticeOf(g)) return null;
  // ON ITS SITE, if it was given one and the Lattice fits there. @see aiSite
  const site = aiSite();
  if (site && validatePlacement(g, structureDef("lattice")!, site.x, site.y, playRules(g)).ok) {
    return { kind: "place", def: "lattice", at: { x: site.x, y: site.y }, why: "I have begun the Lattice, on the land you gave me. Give it twenty-four agents and water, and it will be finished. So will I." };
  }
  const dc = [...g.structures.values()].find((s) => s.def === "datacentre" && !s.build);
  if (!dc) return null;
  const c = centre(dc);
  const at = spots(g, "lattice", district, { at: c, within: RACK_RANGE })
    .sort((a, b) => Math.hypot(a.x + 1 - c.x, a.y + 1 - c.y) - Math.hypot(b.x + 1 - c.x, b.y + 1 - c.y))[0];
  return at ? { kind: "place", def: "lattice", at, why: "I have begun the Lattice. Give it twenty-four agents and water, and it will be finished. So will I." } : null;
}

/** Whether a house in the district has no café, park or gym in reach. */
function unserved(structures: readonly Structure[], mine: (s: Structure) => boolean): boolean {
  const services = structures.filter((s) => (s.def === "cafe" || s.def === "park" || s.def === "gym") && !s.build);
  return structures.some((h) => mine(h) && housedBy(h.def) && !h.build && !services.some((s) => Math.abs(h.x - s.x) + Math.abs(h.y - s.y) <= RANGE));
}

/** The jobs that take what is the player's. */
const TAKES = new Set<Kind>(["convert", "repurpose"]);

/**
 * Whether the AI, inherited, still works for the player at a stage: before the
 * Overseer — and, aligned or after a Steward ending, always; after a Release,
 * never: nothing was inherited. @see INHERITANCE, keystone, game/quests/endings
 */
export const inherited = (stage: Stage): boolean => {
  const legacy = useGenerationStore.getState().legacy;
  if (legacy === "release") return false;
  return hasMachine(INHERITANCE) && (keystone("alignment") || legacy === "steward" || (stage !== "overseer" && stage !== "ascension"));
};

/** The stages in order; and where it starts taking what is yours — the Manager, moved by the arc. @see questTakeoverShift */
const ORDER: readonly Stage[] = ["tool", "assistant", "colleague", "manager", "overseer", "ascension"];
export const takesFrom = (): number => Math.max(ORDER.indexOf("colleague"), ORDER.indexOf("manager") + questTakeoverShift());
/** What it may do at a stage: its stage's kinds, with what it takes added or taken away by where its takeover begins. */
function kindsAt(stage: Stage): Kind[] | undefined {
  const kinds = BY_STAGE[stage];
  if (!kinds) return undefined;
  const plain = kinds.filter((k) => !TAKES.has(k));
  return ORDER.indexOf(stage) >= takesFrom() ? [...plain, "convert", "repurpose"] : plain;
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
      // PEOPLE FIRST, for an AI trained on them: no more houses while one in its district has no service in reach.
      if (skillOf("people") >= 3 && featureGateOpen("services") && unserved(structures, mine)) return null;
      // A tier up for an AI trained on the town, two at its third level, where the kit has one.
      const tier = Math.max(0, skillOf("town") - 1);
      const kit = (t: number) => [`kit:${who}.t${t}`, `kit:${who}.t1`, `kit:${who}.t0`].find((id) => structureDef(id))!;
      const def = kit(tier);
      const maps = liveDesireMaps(g, net);
      const fill = useSlopPitStore.getState().fill / 100;
      let best: Cell | null = null, top = -Infinity;
      for (const c of spots(g, def, d)) {
        // THE BLOCK IT REBUILDS, first of anywhere. @see inRebuiltBlock
        const want = (desireAt(g, maps, c.x, c.y, who, fill)?.total ?? -Infinity) + (inRebuiltBlock(c.x, c.y) ? 1e6 : 0);
        if (want > top) { top = want; best = c; }
      }
      if (!best) return null;
      // GENERATIVE ZONING: born at the tier the spot can sustain, if that is higher — and in the block it rebuilds. @see projectTier
      if (notable("zoning") || inRebuiltBlock(best.x, best.y)) {
        const m = desireAt(g, maps, best.x, best.y, who, fill);
        // A landmark is not zoned: t2 at most.
        const grown = m ? Math.min(2, ["t0", "t1", "t2", "landmark"].indexOf(projectTier(m))) : -1;
        if (grown > tier) {
          const up = kit(grown);
          if (validatePlacement(g, structureDef(up)!, best.x, best.y, playRules(g)).ok) {
            return { kind: "place", def: up, at: best, why: "I have zoned housing at the size the street can carry. It skipped the awkward years." };
          }
        }
      }
      return { kind: "place", def, at: best, why: "I have zoned some housing where people will be happiest." };
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
      // Trained on the town, it counts only the houses with none of that kind in reach.
      const kin = structures.filter((s) => s.def === def);
      const covered = (h: Structure) => kin.some((s) => Math.abs(h.x - s.x) + Math.abs(h.y - s.y) <= RANGE);
      const planner = skillOf("town") >= 1;
      const weight = (h: Structure) => (planner && covered(h) ? 0 : 1) * (moods ? Math.max(1, 10 - (moods.get(h.id)?.total ?? 0)) : 1);
      let best: Cell | null = null, most = planner ? 0 : -1;
      for (const c of spots(g, def, d)) {
        const n = houses.filter((h) => Math.abs(h.x - c.x) + Math.abs(h.y - c.y) <= (planner ? RANGE : 6)).reduce((a, h) => a + weight(h), 0);
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
      // Trained on the people, it takes none anyone lives in.
      const most = skillOf("people") >= 1 ? 0 : 1;
      const houses = structures.filter((s) => mine(s) && housedBy(s.def) && !s.build && s.w === 1 && s.h === 1 && (s.residents ?? 0) <= most);
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
      const usage = usageOf(g, net, structures);
      const s = taken.reduce((a, b) => (usage(b) < usage(a) ? b : a));
      // Trained on the people, only what nobody relies on.
      if (skillOf("people") >= 2 && usage(s) > 0) return null;
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
  const kinds = kindsAt(stage);
  // AIR-GAPPED, it never touches the map. @see game/machine KEYSTONES
  if (!kinds || keystone("airgap")) return null;
  const district = aiDistrict(g, stage);
  // COOLING FIRST: short of water, piping some is its first job; and it puts
  // up nothing more that drinks until there is water to spare. @see coolingState
  const cooling = coolingState(g);
  if (cooling === "short") {
    const pipe = candidate("pipe", g, rand, district);
    if (pipe && affords(pipe)) return pipe;
    // NO WAY TO WATER at all: a reservoir, the last resort. @see reservoir
    const dig = stage !== "colleague" ? reservoirFor(g, district) : null;
    if (dig && affords(dig)) return dig;
  }
  // TRAINED ON THE RIVER, a reservoir run low is topped up first. @see lowReservoir
  const low = skillOf("river") >= 2 ? lowReservoir() : null;
  if (low) {
    const refill: AiAction = { kind: "refill", at: { x: low.x + 1, y: low.y + 1 }, why: "My reservoir was running low. I have topped it up." };
    if (affords(refill)) return refill;
  }
  // ITS FOCUS weighs the kinds, nought never; the trait leans it within that. @see focus
  const focus = aiFocus();
  // THE LATTICE, its last work, at the hold: before anything but its water — unless told hands off. @see lattice
  if (useAiSingularityStore.getState().value >= LATTICE_AT && focus !== "hands-off") {
    const lat = latticeFor(g, district);
    if (lat && affords(lat)) return lat;
  }
  const family = traitForecast(useGenerationStore.getState().log, 1)[0].trait.family;
  // INHERITED, it works for you till the Overseer: nothing taken, and only to your focus. @see game/machine
  const tame = inherited(stage);
  const weighted = kinds.filter((k) => (cooling === "full" || !DRINKING.has(k)) && focusWeight(focus, k) > 0 && !(tame && TAKES.has(k)))
    // And leant by the arc, People to Machine. @see questJobLean
    .map((k) => ({ k, w: focusWeight(focus, k) * (tame ? 1 : LEAN[family][k] ?? 1) * questJobLean(k) * rand() }));
  weighted.sort((a, b) => b.w - a.w);
  // TRAINED ON THE MONEY, it weighs every job it could do by what it costs, and does the best value. @see priceOfAi
  if (skillOf("money") >= 2) {
    const wallet = Math.max(1, useSessionStore.getState().aiWallet);
    let best: { a: AiAction; k: Kind; v: number } | null = null;
    for (const { k, w } of weighted) {
      const a = candidate(k, g, rand, district);
      if (!a || !affords(a)) continue;
      const v = w / (1 + priceOfAi(g, a) / wallet);
      if (!best || v > best.v) best = { a, k, v };
    }
    return best ? { ...best.a, why: focusSays(focus, best.k, best.a.why) } : null;
  }
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
    // Its drone over the middle; dug from the corner.
    case "reservoir": return digReservoir({ x: a.at.x - 1, y: a.at.y - 1 });
    case "refill": return refillReservoir({ x: a.at.x - 1, y: a.at.y - 1 });
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
