/**
 * THE MACHINE: the skill tree's AI cluster, bought with WEIGHTS, not Equity,
 * and kept through everything but a new game. A constellation of its own
 * below the business tree, with its own root — INHERITANCE, granted at the
 * first Ascension — so Equity can never reach it, and the business tree's
 * layout is untouched. Revealed a ring an Ascension; a node is bought next to
 * one already bought. Its minors are the old modules, a level a node.
 * @see plans/ai-takeover.md §4.2, game/modules
 */
import { DEV_OPEN } from "../state/dev-bank";
import { hasMachine, useGenerationStore } from "../state/generation.store";
import { questMachineReveal } from "./quests/effects";
import { MODULES, type ModuleId } from "./modules";

export const MACHINE = "machine";
export const INHERITANCE = "machine_root";

/** The modules its minors are, a spoke each, a level a ring. */
const SPOKES: readonly ModuleId[] = ["quiet-model", "rack-density", "blueprint-cache", "pre-trained", "seed-round", "drone-swarm", "memo-filter"];
/** Rings of minors; what a node of each ring costs in Weights; how far apart they are. */
export const MACHINE_RINGS = 3;
export const RING_COST = [0, 3, 9, 20] as const;
const RING_GAP = 115;
/** Where it sits: below the business tree, clear of it. @see skill-tree.test */
export const MACHINE_CENTRE = { x: 0, y: 2420 };

export type MachineNode = {
  id: string; x: number; y: number; title: string; kind: "root" | "minor" | "notable" | "keystone" | "headstart"; cluster: typeof MACHINE;
  /** Its effect line: what it does, short. @see game/wording */
  effect: string;
  /** How it works, a sentence or more, for its popover: notables, keystones and the root. */
  detail?: string;
  ring: number; module?: ModuleId; cost: number;
};

/**
 * ITS NOTABLES: features, not percentages — each changes how something on the
 * map works, and how it looks. Each in a gap between two spokes, beside their
 * second-ring nodes (or third, for `ring: 3`), revealed with them. The first costs `NOTABLE_COST`, and
 * each bought makes the next dearer by `NOTABLE_STEP`. @see plans/ai-takeover.md §4.2
 */
export type NotableId = "freight" | "airlift" | "prefab" | "zoning" | "coolant" | "concierge" | "nightshift" | "market" | "selffund" | "drones";
export const NOTABLES: readonly { id: NotableId; title: string; effect: string; detail: string; gap: number; ring?: 3 }[] = [
  { id: "freight", gap: 0, title: "Autonomous Freight", effect: "Project loads come by self-driving convoy", detail: "Project materials arrive in convoys of 3 self-driving lorries, sent from the Data Centre as well as the garage. A 16-load project takes 6 runs." },
  { id: "airlift", gap: 2, title: "Drone Airlift", effect: "Small sites' loads ×3 faster · each load +25%", detail: "Sites of 4 tiles or fewer get their materials by drone from the Data Centre: deliveries are 3× faster, and each load costs 25% more." },
  { id: "prefab", gap: 4, title: "Prefab Printing", effect: "Project work −40%", detail: "Every new project needs 40% less work. Material loads are unchanged." },
  { id: "zoning", gap: 5, title: "Generative Zoning", effect: "AI lots start at the tier their spot sustains", detail: "Lots the AI zones in its district start at the highest tier their spot can sustain, instead of as starter lots." },
  { id: "coolant", gap: 1, title: "Coolant Loop", effect: "The AI's buildings share their water", detail: "The AI's buildings pool their water: a surplus at one covers a shortage at another." },
  { id: "concierge", gap: 3, title: "Holo-Concierge", effect: "AI district services reach 4 tiles further", detail: "Services in the AI's district reach houses 4 road tiles further away." },
  { id: "nightshift", gap: 6, title: "Night Shift", effect: "Deskless employees work nights at 70%, not 35%", detail: "Employees without a desk work nights at the empty desks, at 70% output instead of 35%." },
  { id: "market", gap: 2, ring: 3, title: "Market Maker", effect: "AI district ports +50% faster · convoys ×2", detail: "Ports in the AI's district turn ships round 50% faster, and convoys arrive twice as often." },
  { id: "drones", gap: 0, ring: 3, title: "Drone Farming", effect: "Farms tended by drone · harvests +50% · fields feed training", detail: "Drones tend every farm: harvests pay 50% more, farms reach 4 tiles instead of 3, and lost fields replant at once. Each harvest banks ground-truth data that makes training runs faster and land harder." },
  { id: "selffund", gap: 5, ring: 3, title: "Self-Funding", effect: "AI wallet gets a tenth of the agents' income", detail: "The AI's wallet also gets 10% of the income the agents add." },
];
export const NOTABLE_COST = 30;
export const NOTABLE_STEP = 15;
const notableId = (id: NotableId) => `machine_n_${id}`;
/** The notables that work on the map: none of them under Air Gap. Self-Funding is the wallet's. @see keystone "airgap" */
const OFF_MAP: ReadonlySet<NotableId> = new Set(["selffund"]);
/** Whether a notable is bought, and working. */
export const notable = (id: NotableId): boolean => hasMachine(notableId(id)) && (OFF_MAP.has(id) || !keystone("airgap"));

/**
 * ITS KEYSTONES: what the takeover IS — one of three, each the end of a spoke,
 * past its third ring; one bought, the others are closed. @see plans/ai-takeover.md §4.2
 */
export type KeystoneId = "alignment" | "takeoff" | "airgap";
export const KEYSTONES: readonly { id: KeystoneId; title: string; effect: string; detail: string; spoke: number }[] = [
  { id: "alignment", spoke: 0, title: "Alignment", effect: "The AI stays a colleague · AI meter ×0.5 · sale floor ×0.5", detail: "Past the Manager stage the AI stays on your side: it never converts houses or repurposes buildings, never closes streets to you, and builds only what your focus asks for. The AI meter rises half as fast, and each sale's floor is halved." },
  { id: "takeoff", spoke: 5, title: "Hard Takeoff", effect: "Overseer at 60% · the AI builds free on the whole map", detail: "The Overseer stage comes at 60% on the AI meter instead of 80%. The AI's district covers the whole map, and everything it builds is free." },
  { id: "airgap", spoke: 3, title: "Air Gap", effect: "The AI stays off the map · agents' boost ×1.6", detail: "The AI never builds on the map: no district, no drones, no takeover, no Lattice. Every agent's boost is ×1.6. Machine notables that act on the map do nothing." },
];
/** Keystones are past the minors' last ring, revealed an Ascension after it; a keystone costs this many Weights. */
export const KEYSTONE_RING = MACHINE_RINGS + 1;
export const KEYSTONE_COST = 100;
const keystoneId = (id: KeystoneId) => `machine_k_${id}`;
/** Whether a keystone is bought. */
export const keystone = (id: KeystoneId): boolean => hasMachine(keystoneId(id));

/**
 * ITS HEAD STARTS: a whole district every new company is founded with, built
 * and lived in. Past the keystones' ring, revealed an Ascension after them, at
 * the end of a spoke with no keystone. @see world/districts/head-start
 */
export type HeadStartId = "suburb" | "studio" | "company";
export const HEAD_STARTS: readonly { id: HeadStartId; title: string; effect: string; detail: string; spoke: number; cost: number }[] = [
  { id: "suburb", spoke: 1, cost: 150, title: "Ready-made Suburb", effect: "Start with 30 houses · 150 interns · 4 offices", detail: "Every new company's map comes with this district near its middle: roads paved and joined to the town, every house finished and full, offices for everyone in them (a café, a gym and a park in some), and the residents already hired. Fewer if the ground there won't take it all." },
  { id: "studio", spoke: 4, cost: 200, title: "Studio District", effect: "Start with a Studio · 24 houses · 120 vibe coders", detail: "Every new company's map comes with this district near its middle: roads paved and joined to the town, every house finished and full, offices for everyone in them (a café, a gym and a park in some), and the residents already hired. Fewer if the ground there won't take it all." },
  { id: "company", spoke: 6, cost: 300, title: "Company Town", effect: "Start with 14 tall houses · 84 interns · 84 vibe coders", detail: "Every new company's map comes with this district near its middle: roads paved and joined to the town, every house finished and full, offices for everyone in them (a café, a gym and a park in some), and the residents already hired. Fewer if the ground there won't take it all." },
];
/** The ring head starts are on, an Ascension past the keystones. */
export const HEAD_RING = KEYSTONE_RING + 1;
const headStartId = (id: HeadStartId) => `machine_h_${id}`;
/** Whether a head start is bought. */
export const headStart = (id: HeadStartId): boolean => hasMachine(headStartId(id));

/** What a node costs now: a notable dearer for each bought. */
export function machineCost(id: string): number {
  const n = machineNode(id);
  if (!n) return Infinity;
  // Revealed early by the arc, perhaps at a discount. @see questMachineReveal
  const off = 1 - questMachineReveal(id).discount;
  if (n.kind !== "notable") return Math.round(n.cost * off);
  const owned = NOTABLES.filter((x) => notable(x.id)).length;
  return Math.round((NOTABLE_COST + NOTABLE_STEP * owned) * off);
}

const minorId = (m: ModuleId, ring: number) => `machine_${m}_${ring}`;

/** Its nodes and edges, laid out round its root. */
export function machineGraph(): { nodes: MachineNode[]; edges: [string, string][] } {
  const nodes: MachineNode[] = [{
    id: INHERITANCE, ...MACHINE_CENTRE, title: "Inheritance", kind: "root", cluster: MACHINE, ring: 0, cost: 0,
    effect: "AI meter starts at 20% · works for you till the Overseer",
    detail: "Each company, the AI meter starts at 20% (the Assistant stage). Until the Overseer stage the AI builds only what your focus asks for, and never converts houses or repurposes buildings.",
  }];
  const edges: [string, string][] = [];
  const spokeAngle = (i: number) => -Math.PI / 2 + (i / SPOKES.length) * Math.PI * 2 + Math.PI / SPOKES.length;
  SPOKES.forEach((m, i) => {
    const a = spokeAngle(i);
    const def = MODULES.find((d) => d.id === m)!;
    let prev = INHERITANCE;
    for (let ring = 1; ring <= MACHINE_RINGS; ring++) {
      const id = minorId(m, ring);
      nodes.push({
        id, x: MACHINE_CENTRE.x + Math.cos(a) * RING_GAP * ring, y: MACHINE_CENTRE.y + Math.sin(a) * RING_GAP * ring,
        title: def.name, kind: "minor", cluster: MACHINE, ring, module: m, cost: RING_COST[ring],
        effect: `${def.name} ${ring}: ${def.levels[ring - 1]}`,
      });
      edges.push([prev, id]);
      prev = id;
    }
  });
  // The notables, in the gaps, beside the second-ring nodes of the spokes either side.
  // Those at the third ring beside its third-ring nodes, revealed with them.
  for (const n of NOTABLES) {
    const a = -Math.PI / 2 + ((n.gap + 1) / SPOKES.length) * Math.PI * 2;
    const id = notableId(n.id), ring = n.ring ?? 2;
    nodes.push({
      id, x: MACHINE_CENTRE.x + Math.cos(a) * RING_GAP * ring, y: MACHINE_CENTRE.y + Math.sin(a) * RING_GAP * ring,
      title: n.title, kind: "notable", cluster: MACHINE, ring, cost: NOTABLE_COST, effect: n.effect, detail: n.detail,
    });
    edges.push([minorId(SPOKES[n.gap], ring), id], [minorId(SPOKES[(n.gap + 1) % SPOKES.length], ring), id]);
  }
  // The keystones, each at the end of its spoke.
  for (const k of KEYSTONES) {
    const a = spokeAngle(k.spoke), id = keystoneId(k.id);
    nodes.push({
      id, x: MACHINE_CENTRE.x + Math.cos(a) * RING_GAP * KEYSTONE_RING, y: MACHINE_CENTRE.y + Math.sin(a) * RING_GAP * KEYSTONE_RING,
      title: k.title, kind: "keystone", cluster: MACHINE, ring: KEYSTONE_RING, cost: KEYSTONE_COST, effect: k.effect, detail: k.detail,
    });
    edges.push([minorId(SPOKES[k.spoke], MACHINE_RINGS), id]);
  }
  // The head starts, each at the end of a spoke with no keystone, on the keystones' circle.
  for (const h of HEAD_STARTS) {
    const a = spokeAngle(h.spoke), id = headStartId(h.id);
    nodes.push({
      id, x: MACHINE_CENTRE.x + Math.cos(a) * RING_GAP * KEYSTONE_RING, y: MACHINE_CENTRE.y + Math.sin(a) * RING_GAP * KEYSTONE_RING,
      title: h.title, kind: "headstart", cluster: MACHINE, ring: HEAD_RING, cost: h.cost, effect: h.effect, detail: h.detail,
    });
    edges.push([minorId(SPOKES[h.spoke], MACHINE_RINGS), id]);
  }
  return { nodes, edges };
}

const GRAPH = machineGraph();
const BY_ID = new Map(GRAPH.nodes.map((n) => [n.id, n]));
const NEIGHBOURS = new Map<string, string[]>();
for (const [a, b] of GRAPH.edges) {
  NEIGHBOURS.set(a, [...(NEIGHBOURS.get(a) ?? []), b]);
  NEIGHBOURS.set(b, [...(NEIGHBOURS.get(b) ?? []), a]);
}

export const machineNode = (id: string): MachineNode | null => BY_ID.get(id) ?? null;
export const isMachine = (id: string): boolean => BY_ID.has(id);

/** Rings shown: one an Ascension. */
export const revealedRing = (): number => useGenerationStore.getState().generation - 1;
/** The ring an Ascension from this generation revealed, said; none past the keystones. @see AscensionRecap */
export function ringRevealed(generation: number): string | null {
  if (generation <= MACHINE_RINGS) return `Ring ${generation} of the Machine`;
  if (generation === KEYSTONE_RING) return "The Machine's keystones";
  return generation === HEAD_RING ? "The Machine's head starts" : null;
}
/** Whether a node is still under the fog: "Ascend to reveal". */
export const fogged = (id: string): boolean =>
  !DEV_OPEN && (((machineNode(id)?.ring ?? 0) > revealedRing() && !questMachineReveal(id).revealed) || !hasMachine(INHERITANCE));

/** Why a node cannot be bought now, or null if it can. */
export function machineBlocked(id: string): "owned" | "fog" | "unreached" | "exclusive" | "weights" | null {
  const n = machineNode(id);
  if (!n || hasMachine(id)) return "owned";
  // INHERITANCE is never bought: the first Ascension grants it (run locally, it counts as had). @see grantInheritance
  if (id === INHERITANCE) return DEV_OPEN ? "owned" : "fog";
  if (fogged(id)) return "fog";
  // One keystone: the others close. @see KEYSTONES
  if (n.kind === "keystone" && KEYSTONES.some((k) => keystone(k.id))) return "exclusive";
  if (!(NEIGHBOURS.get(id) ?? []).some((n) => hasMachine(n) || (DEV_OPEN && n === INHERITANCE))) return "unreached";
  if (useGenerationStore.getState().weights < machineCost(id)) return "weights";
  return null;
}

/** Buy a node with Weights. Whether it was bought. */
export function buyMachine(id: string): boolean {
  if (machineBlocked(id)) return false;
  const g = useGenerationStore.getState();
  useGenerationStore.setState({ weights: g.weights - machineCost(id), machine: [...g.machine, id] });
  return true;
}

/** Grant Inheritance: the first Ascension's gift. */
export function grantInheritance(): void {
  const g = useGenerationStore.getState();
  if (!g.machine.includes(INHERITANCE)) useGenerationStore.setState({ machine: [...g.machine, INHERITANCE] });
}

/** How many of a module's minors are bought: its level, 0–3. @see moduleLevel */
export function machineLevel(m: ModuleId): number {
  let n = 0;
  for (let ring = 1; ring <= MACHINE_RINGS; ring++) if (hasMachine(minorId(m, ring))) n++;
  return n;
}
