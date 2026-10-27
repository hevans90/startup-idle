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
import { useFounderStore } from "../state/founder.store";
import { founderIs } from "./founder-rules";
import { BLUEPRINT_CACHE, moduleLevel } from "./modules";
import { BOOTSTRAP_BUILD, HACKER_LABS, VISIONARY_DATACENTRE } from "./founders.catalog";

export type ProjectId =
  | "garage" | "studio" | "hq" | "boardroom" | "campus" | "agency" | "townhall" | "harbour"
  | "datacentre" | "conference" | "hackerspace" | "ipo";

/** What a WONDER multiplies, for as long as it stands. @see wonderBonus */
export type Bonus = { money?: number; innovation?: number; valuation?: number };

/** Features of the game a project can open, beyond hiring. @see featureGateOpen */
export type FeatureId = "managers" | "mandates" | "services" | "ports" | "leaders";

/**
 * A PROJECT'S GATE. Every project after the garage waits on an EMPLOYEE
 * UPGRADE — the milestone the player is already chasing on the Employees tab,
 * so buying it is a choice between the gate and more hires — and every wonder
 * on HEADCOUNTS of several kinds at once, a target the panel can show
 * progress toward. @see PROJECTS
 */
export type Gate = {
  /** An upgrade that must have been bought. @see upgrades.store */
  upgrade?: string;
  /** So many of each kind employed. */
  staff?: Partial<Record<GeneratorId, number>>;
};

/** One part of a gate, for whoever shows it. */
export type GatePart =
  | { kind: "upgrade"; id: string; met: boolean }
  | { kind: "staff"; who: GeneratorId; need: number; have: number; met: boolean };

/**
 * A gate as this company faces it:
 *  - THE VISIONARY's Data Centre wants a share of the headcount;
 *  - a founder HELD TO ONE KIND is gated on that kind alone — no upgrade of
 *    another kind's, no headcount of people they cannot hire.
 * @see VISIONARY_DATACENTRE, FounderModifiers.onlyGenerator
 */
function gateNow(gate: Gate): Gate {
  const only = useFounderStore.getState().onlyGenerator;
  // The Visionary, and the Blueprint Cache module. @see BLUEPRINT_CACHE
  const share = gate === DATACENTRE_GATE ? (founderIs("visionary") ? VISIONARY_DATACENTRE : 1) * BLUEPRINT_CACHE[moduleLevel("blueprint-cache")] : 1;
  if (!only && share === 1) return gate;
  const out: Gate = { ...gate };
  if (only && gate.upgrade && !gate.upgrade.startsWith(`${only}_`)) delete out.upgrade;
  if (gate.staff) {
    const staff: Partial<Record<GeneratorId, number>> = {};
    for (const [who, n] of Object.entries(gate.staff) as [GeneratorId, number][]) {
      if (!only || who === only) staff[who] = Math.ceil(n * share);
    }
    out.staff = staff;
  }
  return out;
}

/** Every part of a gate, and whether it is met. */
export function gateParts(
  given: Gate, owned: Partial<Record<GeneratorId, number>>, unlocked: ReadonlySet<string>,
): GatePart[] {
  const gate = gateNow(given);
  const parts: GatePart[] = [];
  if (gate.upgrade) parts.push({ kind: "upgrade", id: gate.upgrade, met: unlocked.has(gate.upgrade) });
  for (const [who, need] of Object.entries(gate.staff ?? {}) as [GeneratorId, number][]) {
    const have = owned[who] ?? 0;
    parts.push({ kind: "staff", who, need, have, met: have >= need });
  }
  return parts;
}

/** A project's gate and the readiness made from it. */
const needs = (gate: Gate): Pick<ProjectDef, "gate" | "ready"> => ({
  gate,
  ready: (owned, unlocked) => gateParts(gate, owned, unlocked).every((p) => p.met),
});

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
  /**
   * What its materials cost, IN SECONDS OF THE COMPANY'S INCOME — priced when
   * the site is chosen and fixed from then on. @see projectCost
   */
  incomeSeconds: number;
  /** The least its materials cost, whatever the income. */
  floor: number;
  /** In how many deliveries the materials come, each paid for as it is sent. */
  deliveries: number;
  /** The generator it unlocks, if any. */
  unlocks?: GeneratorId;
  /** A feature of the game it opens, if any. */
  grants?: FeatureId;
  /** Where clicking the finished building takes the player: a sidebar tab. */
  opens?: "employees" | "innovation" | "valuation" | "ai";
  /**
   * WHAT IT WAITS FOR, as data: an employee upgrade bought, a feature of the
   * game unlocked, and so many of each kind employed — all of them. Data rather
   * than a function and a sentence, so the projects log and the wonders panel
   * can show how far along each part of it is. @see gateParts
   */
  gate: Gate;
  /**
   * Whether the company is ready for it: every part of its gate met. Made from
   * the gate. `unlocked` holds the ids of the upgrades bought.
   */
  ready: (owned: Partial<Record<GeneratorId, number>>, unlocked: ReadonlySet<string>) => boolean;
  /**
   * What the MAP must have for this project to be offered at all: a river,
   * for a harbour. Asked by whoever shows the projects. @see hasRiver
   */
  needsMap?: "river";
  /**
   * A WONDER's permanent bonus: what it multiplies while it stands, rather
   * than anything it opens. @see wonderBonus
   */
  bonus?: Bonus;
  /**
   * A FORK: the project this one is instead of. Building either rules out the
   * other for the run, so a company commits to a direction. @see ruledOut
   */
  rival?: ProjectId;
};

/** The Data Centre's gate, kept by name for the Visionary's rule. @see gateNow */
const DATACENTRE_GATE: Gate = { staff: { intern: 120, vibe_coder: 50, "10x_dev": 3 } };

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
    incomeSeconds: 0,
    floor: 0,
    deliveries: 1,
    unlocks: "intern",
    opens: "employees",
    ...needs({}),
  },
  {
    id: "townhall",
    name: "Town Hall",
    pitch: "Opens cafés, parks and gyms. Houses near them grow.",
    structure: "townhall",
    builders: ["intern"],
    work: 300,
    incomeSeconds: 30,
    floor: 120,
    deliveries: 6,
    grants: "services",
    ...needs({ upgrade: "intern_upgrade_2" }),
  },
  {
    id: "studio",
    name: "Vibe Coder Studio",
    pitch: "A studio for vibe coders. Your interns build it; when it opens, you can hire vibe coders.",
    structure: "studio",
    builders: ["intern"],
    work: 600,
    incomeSeconds: 45,
    floor: 400,
    deliveries: 8,
    unlocks: "vibe_coder",
    opens: "employees",
    ...needs({ upgrade: "intern_upgrade_1" }),
  },
  {
    id: "harbour",
    name: "Harbour Office",
    pitch: "Opens seaports on the river banks. Boats pay for every call.",
    structure: "harbour",
    builders: ["intern", "vibe_coder"],
    work: 900,
    incomeSeconds: 45,
    floor: 1500,
    deliveries: 8,
    grants: "ports",
    needsMap: "river",
    ...needs({ upgrade: "intern_upgrade_3" }),
  },
  {
    id: "hq",
    name: "Company HQ",
    pitch: "A headquarters tower. When it opens you can hire managers, and clicking it takes you to innovation.",
    structure: "hq",
    builders: ["intern", "vibe_coder"],
    work: 2400,
    incomeSeconds: 60,
    floor: 5000,
    deliveries: 12,
    grants: "managers",
    opens: "innovation",
    ...needs({ upgrade: "vibe_coder_upgrade_1" }),
  },
  {
    id: "boardroom",
    name: "Boardroom Tower",
    pitch: "Where the board meets. When it opens the board will pass mandates, and clicking it takes you to valuation.",
    structure: "boardroom",
    builders: ["intern", "vibe_coder"],
    work: 4000,
    incomeSeconds: 90,
    floor: 20_000,
    deliveries: 14,
    grants: "mandates",
    opens: "valuation",
    ...needs({ upgrade: "intern_hybrid_upgrade_1" }),
  },
  {
    id: "campus",
    name: "Campus",
    pitch: "A campus for the 10x devs, with room for them to think. When it opens you can hire 10x devs.",
    structure: "campus",
    builders: ["intern", "vibe_coder"],
    work: 6000,
    incomeSeconds: 120,
    floor: 40_000,
    deliveries: 16,
    unlocks: "10x_dev",
    opens: "employees",
    ...needs({ upgrade: "vibe_coder_upgrade_2" }),
  },
  {
    id: "agency",
    name: "Talent Agency",
    pitch: "Headhunters with a view. When it opens, each kind can have a leader, placed in a building where that kind works.",
    structure: "agency",
    builders: ["intern", "vibe_coder", "10x_dev"],
    work: 5000,
    incomeSeconds: 120,
    floor: 60_000,
    deliveries: 14,
    grants: "leaders",
    opens: "employees",
    ...needs({ upgrade: "10x_dev_10x_1" }),
  },
  // THE WONDERS: late, dear, and a bonus for good. @see wonderBonus
  {
    id: "datacentre",
    name: "Data Centre",
    pitch: "Racks of GPUs humming in the dark. Doubles the company's innovation, for good.",
    structure: "datacentre",
    builders: ["vibe_coder", "10x_dev"],
    work: 10_000,
    incomeSeconds: 180,
    floor: 200_000,
    deliveries: 16,
    bonus: { innovation: 2 },
    // Its control room is the AI tab. @see AiTab
    opens: "ai",
    ...needs(DATACENTRE_GATE),
  },
  {
    id: "conference",
    name: "Conference Centre",
    pitch: "Keynotes, lanyards and a stage. Valuation grows half as fast again, for good, and convoys pay treble at seaports near it.",
    structure: "conference",
    builders: ["vibe_coder", "10x_dev"],
    work: 14_000,
    incomeSeconds: 240,
    floor: 500_000,
    deliveries: 18,
    bonus: { valuation: 1.5 },
    rival: "hackerspace",
    ...needs({ staff: { intern: 250, vibe_coder: 100, "10x_dev": 6 } }),
  },
  {
    id: "hackerspace",
    name: "Hackerspace",
    pitch: "An old warehouse of soldering irons, beanbags and whiteboards. All income a third again, for good.",
    structure: "hackerspace",
    builders: ["vibe_coder", "10x_dev"],
    work: 14_000,
    incomeSeconds: 240,
    floor: 500_000,
    deliveries: 18,
    bonus: { money: 1.3 },
    rival: "conference",
    ...needs({ staff: { intern: 250, vibe_coder: 100, "10x_dev": 6 } }),
  },
  {
    id: "ipo",
    name: "IPO Tower",
    pitch: "A gold tower with your ticker on it. All income half as much again, and the company valued twice as fast: buyers start calling.",
    structure: "ipo",
    builders: ["vibe_coder", "10x_dev"],
    work: 20_000,
    incomeSeconds: 300,
    floor: 2_000_000,
    deliveries: 20,
    bonus: { money: 1.5, valuation: 2 },
    // 325 interns, not 350: a run that hires to its cost wall stops near 330. @see map-balance.test
    ...needs({ staff: { intern: 325, vibe_coder: 150, "10x_dev": 8 } }),
  },
];

/**
 * WHAT THE WONDERS STANDING MULTIPLY one kind of output by: the product of
 * every built wonder's bonus for it. One with no map, or none built.
 */
export function wonderBonus(kind: keyof Bonus): number {
  if (!reader) return 1;
  const built = reader().built;
  let m = 1;
  for (const p of PROJECTS) if (p.bonus?.[kind] && built.has(p.id)) m *= p.bonus[kind]!;
  return m;
}

/** What the map's R&D labs multiply innovation by. One with no map. */
export const labBonus = () => {
  const mult = reader ? reader().labs?.mult ?? 1 : 1;
  // THE HACKER's labs count for more. @see HACKER_LABS
  return founderIs("hacker") ? 1 + (mult - 1) * HACKER_LABS : mult;
};
/**
 * What the map does for a kind's work AT ITS DESKS — team leaders leading
 * them, cafés next door — as a multiplier. One with no map. @see deskShare
 */
export const deskBonus = (id: GeneratorId) => 1 + (reader ? reader().desks?.[id] ?? 0 : 0);

/** The people a kind's leader leads in their building; nought with no map. @see leaderEffects */
export const leaderTeam = (id: GeneratorId) => (reader ? reader().teams?.[id] ?? 0 : 0);

/** How many R&D labs stand on the map. */
export const labsBuilt = () => (reader ? reader().labs?.count ?? 0 : 0);

/**
 * WHAT A PROJECT COSTS, given the company's income a second: so many seconds
 * of it, and never less than its floor.
 *
 * Not a fixed price, because income is not fixed: it grows by orders of
 * magnitude over a run, and with prestige a company can reach a project's
 * threshold earning a hundred times what a fresh one does. A fixed price is a
 * wall to one company and a rounding error to the next. Priced in income, a
 * project costs every company the same thing — a minute or two of what it
 * earns, spent on a building rather than on hires — and the floor keeps it a
 * real price for a company earning next to nothing.
 *
 * FIXED WHEN THE SITE IS CHOSEN (`Build.cost`), so the card can say what it
 * will cost in all, and a company that grows while it builds is not charged
 * more for the loads still to come.
 */
export function projectCost(p: ProjectDef, incomePerSecond: number): number {
  const live = Number.isFinite(incomePerSecond) ? Math.max(0, incomePerSecond) * p.incomeSeconds : 0;
  // THE BOOTSTRAPPER builds for less. @see BOOTSTRAP_BUILD
  const k = founderIs("bootstrapper") ? BOOTSTRAP_BUILD : 1;
  return Math.min(Number.MAX_VALUE, Math.round(Math.max(p.floor, Math.round(live)) * k));
}

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
  /**
   * The share of a full day's work each kind does for the time it spends
   * getting there. Absent, or a kind missing, is all of it. @see commuteFactor
   */
  commute?: Partial<Record<GeneratorId, number>>;
  /** The R&D labs standing, and what they multiply innovation by. @see world/projects/labs */
  labs?: { count: number; mult: number };
  /**
   * AI agents' racks standing: how many agents can run at full power — near
   * the Data Centre — and how many at half, further off. @see game/agents
   */
  racks?: { powered: number; unpowered: number };
  /** Compute spires the AI has put up. @see SPIRE_BOOST */
  spires?: number;
  /** What cafés add to each kind's work at its desks, as a share: 0.1 is +10%. @see deskShare */
  desks?: Partial<Record<GeneratorId, number>>;
  /** Each kind's leader's TEAM: the people at the desks of the building they lead. @see game/leaders */
  teams?: Partial<Record<GeneratorId, number>>;
};

let reader: (() => ProjectReading) | null = null;

/** What the map says, or null when no map is registered. */
export const projectReading = (): ProjectReading | null => (reader ? reader() : null);

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
 * The share of a kind of employee's work that gets done: those AT THEIR
 * DESKS — not away building, or still on their way to the map — and of their
 * day, what their commute leaves. One when no map is registered.
 */
export function attendance(id: GeneratorId, owned: number): number {
  if (!reader || owned <= 0) return 1;
  const r = reader();
  const away = r.away[id] ?? 0;
  const here = Math.max(0, Math.min(1, (owned - away) / owned));
  return here * Math.max(0, Math.min(1, r.commute?.[id] ?? 1));
}
