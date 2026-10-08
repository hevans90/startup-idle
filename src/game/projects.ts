/**
 * PROJECTS — how the company grows into new things: not by a number being
 * reached, but by building the place it happens.
 *
 * When the company is ready for something new — ten interns, and it could take
 * on vibe coders — a PROJECT becomes available. The player chooses a site on
 * the map; a fenced plot appears; employees leave their desks and walk there;
 * materials arrive by truck, paid for as they come, so a company short of
 * money stalls; the building goes up in stages; and when it opens, the thing it
 * was for is unlocked. Caesar's way, not a skill tree's. @see world/projects
 *
 * THIS IS THE ECONOMY'S SIDE: what projects there are, which generators they
 * gate, and how many employees are away building rather than working. The map
 * tells it through a registered reader, the way it tells it beds — and with
 * no map registered (a simulation, a test, the phone layout) nothing is gated
 * and nobody is away, which is what the rest of the game expects.
 * @see setHousingReader, setProjectReader
 */
import type { GeneratorId } from "../state/generators.store";

export type ProjectId = "studio";

export type ProjectDef = {
  id: ProjectId;
  name: string;
  /** What it opens, as a player reads it. */
  pitch: string;
  /** The structure it builds. @see structures/def */
  structure: string;
  /** Who builds it. */
  builders: readonly GeneratorId[];
  /** Builder-seconds of work. */
  work: number;
  /** What its materials cost in all, and in how many deliveries they come. */
  cost: number;
  deliveries: number;
  /** The generator it unlocks, if any. */
  unlocks?: GeneratorId;
  /** Whether the company is ready for it, from what it employs. */
  ready: (owned: Partial<Record<GeneratorId, number>>) => boolean;
  /** Why not yet, for the card. */
  readyWhen: string;
};

export const PROJECTS: readonly ProjectDef[] = [
  {
    id: "studio",
    name: "Vibe Coder Studio",
    pitch: "A studio for vibe coders. Your interns build it; when it opens, you can hire vibe coders.",
    structure: "studio",
    builders: ["intern"],
    work: 600,
    cost: 400,
    deliveries: 8,
    unlocks: "vibe_coder",
    ready: (owned) => (owned.intern ?? 0) >= 10,
    readyWhen: "10 interns",
  },
];

export const projectDef = (id: string): ProjectDef | null => PROJECTS.find((p) => p.id === id) ?? null;

/** The project whose building is this structure, if any. */
export const projectForStructure = (defId: string): ProjectDef | null =>
  PROJECTS.find((p) => p.structure === defId) ?? null;

/**
 * HOW MANY BUILD, automatically, by the project's PRIORITY: a share of the
 * employees who can build it — paused, a quarter, half, or all of them — and
 * never more than the site has room for. So the choice is never "how many",
 * it is "how much of the company do I give this", and the price of that is
 * visible: every builder is a desk with nobody at it. @see attendance
 */
export const PRIORITY_SHARE = [0, 0.25, 0.5, 1] as const;
export type Priority = 0 | 1 | 2 | 3;
export const PRIORITY_NAMES = ["Paused", "Low", "Normal", "High"] as const;
/** Builders a site has room for, per tile of its footprint. */
export const BUILDERS_PER_TILE = 4;

export function buildersFor(
  def: ProjectDef, priority: Priority, owned: Partial<Record<GeneratorId, number>>, tiles: number,
): number {
  const eligible = def.builders.reduce((n, id) => n + (owned[id] ?? 0), 0);
  if (priority === 0 || eligible === 0) return 0;
  return Math.max(1, Math.min(tiles * BUILDERS_PER_TILE, Math.round(eligible * PRIORITY_SHARE[priority])));
}

/** What the map tells the economy. @see setProjectReader */
export type ProjectReading = {
  /** Projects whose building stands finished. */
  built: ReadonlySet<ProjectId>;
  /** Employees away from their desks, building, per kind. */
  away: Partial<Record<GeneratorId, number>>;
};

let reader: (() => ProjectReading) | null = null;

/**
 * Tell the economy how to ask the map about projects, and get back a function
 * that stops it. Registered while a company's map is mounted. @see useFoundWorld
 */
export function setProjectReader(read: () => ProjectReading): () => void {
  reader = read;
  return () => { if (reader === read) reader = null; };
}

/**
 * Whether a generator's project gate is open: no project unlocks it, or the
 * project that does is built. Open whenever no map is registered.
 */
export function projectGateOpen(id: GeneratorId): boolean {
  if (!reader) return true;
  const gate = PROJECTS.find((p) => p.unlocks === id);
  return !gate || reader().built.has(gate.id);
}

/**
 * The share of a kind of employee AT THEIR DESKS: those away building are not
 * producing. One when no map is registered, or nobody is away.
 */
export function attendance(id: GeneratorId, owned: number): number {
  if (!reader || owned <= 0) return 1;
  const away = reader().away[id] ?? 0;
  return Math.max(0, Math.min(1, (owned - away) / owned));
}
