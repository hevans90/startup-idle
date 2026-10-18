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

type Cell = { x: number; y: number };

export type AiAction =
  | { kind: "place"; def: string; at: Cell; why: string }
  | { kind: "convert"; at: Cell; into: string; why: string }
  | { kind: "road"; from: Cell; to: Cell; why: string }
  | { kind: "lift"; at: Cell; why: string }
  | { kind: "flatten"; from: Cell; to: Cell; why: string }
  | { kind: "pond"; at: Cell; why: string }
  | { kind: "hire"; who: GeneratorId; why: string }
  | { kind: "upgrade"; id: string; why: string };

/** Where on the map an action happens, for its drone; null for one done at a desk. */
export function targetOf(a: AiAction): Cell | null {
  if (a.kind === "hire" || a.kind === "upgrade") return null;
  if (a.kind === "road" || a.kind === "flatten") return a.to;
  return a.at;
}

/** Seconds between the AI's jobs at each stage, with every agent running. */
export const INTERVAL: Partial<Record<Stage, number>> = { colleague: 60, manager: 35, overseer: 20, ascension: 20 };

/** What it may do at a stage. */
type Kind = "lot" | "service" | "node" | "farm" | "convert" | "repurpose" | "road" | "lift" | "flatten" | "pond" | "spire" | "hangar" | "monolith" | "hire" | "upgrade";
const BY_STAGE: Partial<Record<Stage, Kind[]>> = {
  colleague: ["lot", "service", "node", "farm"],
  manager: ["lot", "service", "node", "farm", "convert", "repurpose", "road", "lift", "hire", "upgrade"],
  overseer: ["lot", "service", "farm", "convert", "repurpose", "road", "lift", "hire", "upgrade", "flatten", "pond", "spire", "hangar", "monolith"],
};
BY_STAGE.ascension = BY_STAGE.overseer;

/** How much more often each family of trait reaches for each kind of job. */
const LEAN: Record<Family, Partial<Record<Kind, number>>> = {
  planner: { road: 3, lift: 2, service: 2, lot: 2 },
  optimiser: { farm: 3, hire: 3, upgrade: 3, convert: 2, repurpose: 3 },
  shepherd: { service: 4, lot: 2 },
  elemental: { pond: 4, flatten: 2 },
  recursive: { node: 3, spire: 3, convert: 3, hangar: 2, repurpose: 2 },
  temper: {},
};

/** Every tile a building could go on, by the game's rules. */
function spots(g: Grid, defId: string, near?: { at: Cell; within: number }): Cell[] {
  const def = structureDef(defId);
  if (!def) return [];
  const rules = playRules(g);
  const out: Cell[] = [];
  const [x0, y0, x1, y1] = near
    ? [near.at.x - near.within, near.at.y - near.within, near.at.x + near.within, near.at.y + near.within]
    : [0, 0, g.w - 1, g.h - 1];
  for (let y = Math.max(0, y0); y <= Math.min(g.h - 1, y1); y++) {
    for (let x = Math.max(0, x0); x <= Math.min(g.w - 1, x1); x++) {
      if (validatePlacement(g, def, x, y, rules).ok) out.push({ x, y });
    }
  }
  return out;
}

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

/** One candidate for a kind of job, or null when there is nothing worth doing of that kind. */
function candidate(kind: Kind, g: Grid, rand: () => number): AiAction | null {
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
      for (const c of spots(g, def)) {
        const d = desireAt(g, maps, c.x, c.y, who, fill)?.total ?? -Infinity;
        if (d > top) { top = d; best = c; }
      }
      return best ? { kind: "place", def, at: best, why: "I have zoned some housing where people will be happiest." } : null;
    }
    case "service": {
      if (!featureGateOpen("services")) return null;
      const def = pick(["cafe", "park", "gym"]);
      const houses = structures.filter((s) => housedBy(s.def));
      if (!houses.length) return null;
      // Where the houses are thickest.
      let best: Cell | null = null, most = -1;
      for (const c of spots(g, def)) {
        const n = houses.filter((h) => Math.abs(h.x - c.x) + Math.abs(h.y - c.y) <= 6).length;
        if (n > most) { most = n; best = c; }
      }
      return best ? { kind: "place", def, at: best, why: `I have opened a ${structureDef(def)?.name.toLowerCase()} where it will do the most good.` } : null;
    }
    case "node": case "farm": case "spire": case "hangar": case "monolith": {
      if (!dc) return null;
      const def = { node: "ai-node", farm: "gpu-farm", spire: "compute-spire", hangar: "drone-hangar", monolith: "monolith" }[kind];
      if (kind === "monolith" && structures.some((s) => s.def === "monolith")) return null;
      const options = spots(g, def, { at: centre(dc), within: RACK_RANGE });
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
      const houses = structures.filter((s) => housedBy(s.def) && !s.build && s.w === 1 && s.h === 1 && (s.residents ?? 0) <= 1);
      if (!houses.length) return null;
      houses.sort((a, b) => (moods.get(a.id)?.total ?? 0) - (moods.get(b.id)?.total ?? 0));
      const h = houses[0];
      return { kind: "convert", at: { x: h.x, y: h.y }, into: "ai-node", why: "That house was underused. It is a node now. Its residents have been relocated." };
    }
    case "repurpose": {
      // A café, a park, a gym or an office: a GPU farm now, for good.
      const taken = structures.filter((s) => !s.build && (["cafe", "park", "gym", "office-intern", "office-vibe"].includes(s.def)));
      if (!taken.length) return null;
      const s = pick(taken);
      const name = structureDef(s.def)?.name ?? "building";
      return { kind: "convert", at: { x: s.x, y: s.y }, into: "gpu-farm", why: `I have repurposed the ${name.toLowerCase()} as a GPU farm. Its previous function has been deprecated.` };
    }
    case "road": {
      const ends = deadEnds(g).filter((e) => fronted(g, e.at.x, e.at.y));
      if (!ends.length) return null;
      const e = pick(ends);
      const len = 4 + Math.floor(rand() * 4);
      const to = { x: e.at.x + e.dx * len, y: e.at.y + e.dy * len };
      if (!inBounds(g, to.x, to.y)) return null;
      return { kind: "road", from: { x: e.at.x + e.dx, y: e.at.y + e.dy }, to, why: "I have extended the street. It was going nowhere." };
    }
    case "lift": {
      const stubs = deadEnds(g).filter((e) => !fronted(g, e.at.x, e.at.y));
      if (!stubs.length) return null;
      return { kind: "lift", at: pick(stubs).at, why: "I have removed a road nobody was using. You are welcome." };
    }
    case "flatten": {
      // A rough patch of open ground by a road.
      for (let tries = 0; tries < 40; tries++) {
        const x = Math.floor(rand() * (g.w - 4)) + 2, y = Math.floor(rand() * (g.h - 4)) + 2;
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
        if (!inBounds(g, x, y) || !inBounds(g, x + 1, y + 1)) continue;
        if ([[0, 0], [1, 0], [0, 1], [1, 1]].some(([dx, dy]) => structureAt(g, x + dx, y + dy) >= 0 || isPaved(g, x + dx, y + dy))) continue;
        return { kind: "pond", at: { x, y }, why: "I have dug a cooling pond. Please do not swim in it." };
      }
      return null;
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
 * what the trait it is becoming likes, and the first that has anything to do.
 */
export function chooseAction(g: Grid, stage: Stage, rand: () => number = Math.random): AiAction | null {
  const kinds = BY_STAGE[stage];
  if (!kinds) return null;
  const family = traitForecast(useGenerationStore.getState().log, 1)[0].trait.family;
  const weighted = kinds.map((k) => ({ k, w: (LEAN[family][k] ?? 1) * rand() }));
  weighted.sort((a, b) => b.w - a.w);
  for (const { k } of weighted) {
    const a = candidate(k, g, rand);
    if (a) return a;
  }
  return null;
}

/** Do it, through the player's own actions. Whether anything happened. */
export function perform(a: AiAction): boolean {
  switch (a.kind) {
    case "place": return placeStructure(a.def, a.at);
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
  }
}

/** Whether the AI builds at all in this company: not on The Model's own runs. @see plans/singularity.md §4b */
export const aiBuilds = () => useWorldStore.getState().playing;
