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
  id: string; x: number; y: number; title: string; kind: "root" | "minor"; cluster: typeof MACHINE;
  effect: string; ring: number; module?: ModuleId; cost: number;
};

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
  if (useGenerationStore.getState().weights < n.cost) return "weights";
  return null;
}

/** Buy a node with Weights. Whether it was bought. */
export function buyMachine(id: string): boolean {
  if (machineBlocked(id)) return false;
  const g = useGenerationStore.getState();
  useGenerationStore.setState({ weights: g.weights - machineNode(id)!.cost, machine: [...g.machine, id] });
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
