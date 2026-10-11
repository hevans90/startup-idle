/**
 * HOW THE TOWN FEELS, as the economy hears it: how far each kind of
 * employee's satisfaction leans toward the mood of the houses they live in.
 * The map registers a reader while it is mounted; with none — a simulation, a
 * test, the phone layout — nothing leans. @see world/agents/mood
 */
import type { GeneratorId } from "../state/generators.store";

let reader: (() => Partial<Record<GeneratorId, number>>) | null = null;

/** Tell the economy how to ask the map about its mood; returns a function that stops it. */
export function setTownMoodReader(read: () => Partial<Record<GeneratorId, number>>): () => void {
  reader = read;
  return () => { if (reader === read) reader = null; };
}

/** Each kind's lean, in satisfaction points. Empty with no map. */
export const townMoodOffsets = (): Partial<Record<GeneratorId, number>> => reader?.() ?? {};
