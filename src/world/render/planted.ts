/**
 * TREES SOMETHING ELSE PLANTED: a street's trees in their pits, a park's — stood by whatever planted them (@see
 * street-props, structures/project-renderer placeProps) and drawn by the woods' mesh with everything that grows,
 * through the year, swaying, under snow (@see tree-mesh). On the continuous surface only: the stepped ground draws
 * them from the props sheet as before.
 */
import { groundMode } from "./ground-mode";

/** A tree where something planted it: its kind, its foot (tiles, the middle of a tile whole), the ground under it. */
export type PlantedTree = { kind: string; u: number; v: number; z: number; turn: number; size: number };

const sources = new Map<string, readonly PlantedTree[]>();
let rev = 0;

/** Whether planted trees go to the woods' mesh rather than the props sheet. */
export const plantsTrees = () => groundMode() === "smooth";

/** Set (or with none, clear) the trees one source planted. */
export function setPlanted(source: string, trees: readonly PlantedTree[]): void {
  const had = sources.get(source);
  if (!trees.length) { if (had) { sources.delete(source); rev++; } return; }
  if (had && had.length === trees.length && had.every((t, k) => same(t, trees[k]))) return;
  sources.set(source, trees);
  rev++;
}
const same = (a: PlantedTree, b: PlantedTree) => a.kind === b.kind && a.u === b.u && a.v === b.v && a.z === b.z && a.turn === b.turn && a.size === b.size;

/** Every planted tree, and a count that changes when any do. */
export function planted(): { rev: number; trees: PlantedTree[] } {
  if (seen.rev !== rev) seen = { rev, trees: [...sources.values()].flat() };
  return seen;
}
let seen: { rev: number; trees: PlantedTree[] } = { rev: -1, trees: [] };
