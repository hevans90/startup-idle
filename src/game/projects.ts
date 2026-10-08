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

export type ProjectId = "garage" | "studio" | "hq";

/** Features of the game a project can open, beyond hiring. @see featureGateOpen */
export type FeatureId = "managers";

export type ProjectDef = {
  id: ProjectId;
  name: string;
  /** What it opens, as a player reads it. */
  pitch: string;
  /** The structure it builds. @see structures/def */
  structure: string;
  /** Who builds it. */
  builders: readonly GeneratorId[];
  /**
   * Built by THE FOUNDER, alone — for the first project, before there is
   * anybody to build with. One builder, who drives in from the edge of the
   * map, and is nobody's desk. @see buildersFor
   */
  founderBuilds?: true;
  /** Builder-seconds of work. */
  work: number;
  /** What its materials cost in all, and in how many deliveries they come. */
  cost: number;
  deliveries: number;
  /** The generator it unlocks, if any. */
  unlocks?: GeneratorId;
  /** A feature of the game it opens, if any. */
  grants?: FeatureId;
  /** Where clicking the finished building takes the player: a sidebar tab. */
  opens?: "employees" | "innovation";
  /** Whether the company is ready for it, from what it employs. */
  ready: (owned: Partial<Record<GeneratorId, number>>) => boolean;
  /** Why not yet, for the card. */
  readyWhen: string;
};

export const PROJECTS: readonly ProjectDef[] = [
  {
    id: "garage",
    name: "Founder's Garage",
    pitch: "Every startup starts in a garage. Drive in, knock it into shape, and you can hire your first intern.",
    structure: "garage",
    builders: [],
    founderBuilds: true,
    work: 30,
    // Free: salvaged, and a company with five dollars to its name can found.
    cost: 0,
    deliveries: 1,
    unlocks: "intern",
    opens: "employees",
    ready: () => true,
    readyWhen: "nothing",
  },
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
    opens: "employees",
    ready: (owned) => (owned.intern ?? 0) >= 10,
    readyWhen: "10 interns",
  },
  {
    id: "hq",
    name: "Company HQ",
    pitch: "A headquarters tower. When it opens you can hire managers, and clicking it takes you to innovation.",
    structure: "hq",
    builders: ["intern", "vibe_coder"],
    work: 2400,
    cost: 5000,
    deliveries: 12,
    grants: "managers",
    opens: "innovation",
    ready: (owned) => (owned.vibe_coder ?? 0) >= 10,
    readyWhen: "10 vibe coders",
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
  if (def.founderBuilds) return priority === 0 ? 0 : 1;
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
 * Whether a feature's project gate is open: no project grants it, or the one
 * that does is built. Open whenever no map is registered.
 */
export function featureGateOpen(id: FeatureId): boolean {
  if (!reader) return true;
  const gate = PROJECTS.find((p) => p.grants === id);
  return !gate || reader().built.has(gate.id);
}

/**
 * Whether a company has already earned what a project opens — employs what
 * it unlocks, or has the feature it grants — so it is given the building
 * finished rather than asked to build it again. @see foundEarnedProjects
 */
export function alreadyEarned(
  p: ProjectDef, owned: Partial<Record<GeneratorId, number>>, features: ReadonlySet<FeatureId>,
): boolean {
  return (p.unlocks !== undefined && (owned[p.unlocks] ?? 0) > 0)
    || (p.grants !== undefined && features.has(p.grants));
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
