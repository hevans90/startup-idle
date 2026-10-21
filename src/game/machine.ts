/**
 * THE MACHINE: the skill tree's AI cluster, bought with WEIGHTS, not Equity,
 * and kept through everything but a new game. A constellation of its own
 * below the business tree, with its own root — INHERITANCE, granted at the
 * first Ascension — so Equity can never reach it, and the business tree's
 * layout is untouched. Revealed a ring an Ascension; a node is bought next to
 * one already bought. Its minors are the old modules, a level a node.
 * @see plans/ai-takeover.md §4.2, game/modules
 */
import { hasMachine, useGenerationStore } from "../state/generation.store";
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
  id: string; x: number; y: number; title: string; kind: "root" | "minor" | "notable"; cluster: typeof MACHINE;
  effect: string; ring: number; module?: ModuleId; cost: number;
};

/**
 * ITS NOTABLES: features, not percentages — each changes how something on the
 * map works, and how it looks. Each in a gap between two spokes, beside their
 * second-ring nodes, revealed with them. The first costs `NOTABLE_COST`, and
 * each bought makes the next dearer by `NOTABLE_STEP`. @see plans/ai-takeover.md §4.2
 */
export type NotableId = "freight" | "airlift" | "prefab" | "zoning";
export const NOTABLES: readonly { id: NotableId; title: string; effect: string; gap: number }[] = [
  { id: "freight", gap: 0, title: "Autonomous Freight", effect: "Project materials come in convoys of three self-driving lorries, from the Data Centre as well as the garage: a sixteen-load wonder in six runs." },
  { id: "airlift", gap: 2, title: "Drone Airlift", effect: "Sites of four tiles or fewer get their materials by heavy-lift drone, straight from the Data Centre over the town: three times as fast, a quarter dearer a load." },
  { id: "prefab", gap: 4, title: "Prefab Printing", effect: "The AI prints building segments off-site: every new project needs 40% less work. The loads stay." },
  { id: "zoning", gap: 5, title: "Generative Zoning", effect: "Lots the AI zones in its district are born at the tier the spot can sustain, not as starter lots." },
];
export const NOTABLE_COST = 30;
export const NOTABLE_STEP = 15;
const notableId = (id: NotableId) => `machine_n_${id}`;
/** Whether a notable is bought. */
export const notable = (id: NotableId): boolean => hasMachine(notableId(id));
/** What a node costs now: a notable dearer for each bought. */
export function machineCost(id: string): number {
  const n = machineNode(id);
  if (!n) return Infinity;
  if (n.kind !== "notable") return n.cost;
  const owned = NOTABLES.filter((x) => notable(x.id)).length;
  return NOTABLE_COST + NOTABLE_STEP * owned;
}

const minorId = (m: ModuleId, ring: number) => `machine_${m}_${ring}`;

/** Its nodes and edges, laid out round its root. */
export function machineGraph(): { nodes: MachineNode[]; edges: [string, string][] } {
  const nodes: MachineNode[] = [{
    id: INHERITANCE, ...MACHINE_CENTRE, title: "Inheritance", kind: "root", cluster: MACHINE, ring: 0, cost: 0,
    effect: "The AI you raised comes back as yours. Each company it starts at the Assistant stage; till the Overseer it takes nothing — no house converted, nothing repurposed — and works only to your focus, its drones in your teal.",
  }];
  const edges: [string, string][] = [];
  SPOKES.forEach((m, i) => {
    const a = -Math.PI / 2 + (i / SPOKES.length) * Math.PI * 2 + Math.PI / SPOKES.length;
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
  for (const n of NOTABLES) {
    const a = -Math.PI / 2 + ((n.gap + 1) / SPOKES.length) * Math.PI * 2;
    const id = notableId(n.id);
    nodes.push({
      id, x: MACHINE_CENTRE.x + Math.cos(a) * RING_GAP * 2, y: MACHINE_CENTRE.y + Math.sin(a) * RING_GAP * 2,
      title: n.title, kind: "notable", cluster: MACHINE, ring: 2, cost: NOTABLE_COST, effect: n.effect,
    });
    edges.push([minorId(SPOKES[n.gap], 2), id], [minorId(SPOKES[(n.gap + 1) % SPOKES.length], 2), id]);
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
/** Whether a node is still under the fog: "Ascend to reveal". */
export const fogged = (id: string): boolean => (machineNode(id)?.ring ?? 0) > revealedRing() || !hasMachine(INHERITANCE);

/** Why a node cannot be bought now, or null if it can. */
export function machineBlocked(id: string): "owned" | "fog" | "unreached" | "weights" | null {
  const n = machineNode(id);
  if (!n || hasMachine(id)) return "owned";
  if (fogged(id)) return "fog";
  if (!(NEIGHBOURS.get(id) ?? []).some(hasMachine)) return "unreached";
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
