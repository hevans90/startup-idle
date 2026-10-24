/**
 * THE ARC'S DATA: a chapter is a transmission and two or three options; a
 * request is a smaller one between chapters. Each option moves the AI's
 * disposition, and may carry effects that last the generation and an
 * objective on the map, with what follows if it is met and if it is not.
 * Everything an option does is in these two vocabularies, so the stated
 * effect is the effect. @see effects, objectives, plans/ai-takeover.md §5
 */
import type { Stage } from "../../state/ai-singularity.store";
import type { Family, TraitId } from "../traits";

/** Where the AI stands: Control (−) to Autonomy (+), People (−) to Machine (+), each −3 to +3. */
export type Disposition = { autonomy: number; machine: number };
export const AXIS_MOST = 3;

/** A cell of the map. */
export type Cell = { x: number; y: number };

/**
 * WHAT AN OPTION DOES, for the rest of the generation. Each is read in
 * exactly one place in the game. @see effects
 */
export type Effect =
  /** Income × this. */
  | { kind: "incomeMult"; mult: number }
  /** The AI's wallet holds × this. */
  | { kind: "walletMax"; mult: number }
  /** Its wallet empty, it may draw on the company's money, up to this share of it. */
  | { kind: "walletDraws"; share: number }
  /** Its district reaches this many tiles further. */
  | { kind: "districtRadius"; tiles: number }
  /** Its district centred here, not on the Data Centre. */
  | { kind: "districtCentre"; at: Cell }
  /** It takes what is yours this many stages sooner (−) or later (+). */
  | { kind: "takeoverStage"; shift: number }
  /** The meter rises × this. */
  | { kind: "meterMult"; mult: number }
  /** A trait, or a family's traits, this much likelier at the Ascension. */
  | { kind: "leanTrait"; to: TraitId | Family; n: number }
  /** A node of the Machine out of the fog early, and this share off its price. */
  | { kind: "revealMachineNode"; id: string; discount: number }
  /** Floods come × this often. */
  | { kind: "floodMult"; mult: number }
  /** Agents run at most this share of themselves — unless the Data Centre is fully cooled, with `unlessCooled`. */
  | { kind: "agentCap"; share: number; unlessCooled?: boolean }
  /** The town's charter, and the rules of the takeover with it. @see Charter */
  | { kind: "charter"; charter: Charter }
  /** An echo: something a later chapter, request or the Ascension reads. */
  | { kind: "flag"; name: string };

/**
 * THE CHARTERS: the rules of the takeover. The Oversight Board keeps your
 * streets yours and the AI's warnings longer; the Partnership shares its
 * district's streets; the Mandate leaves them its own. What else each does is
 * in its option's other effects.
 */
export type Charter = "oversight" | "partnership" | "mandate";

/**
 * WHAT AN OBJECTIVE ASKS, on the map, within a window. Each measured from the
 * world once a second, 0 to 1; at 1 it is met. @see objectives
 */
export type ObjectiveSpec =
  /** Keep the agents at or below this share running, for so many seconds in all. */
  | { kind: "throttleAtMost"; share: number; seconds: number }
  /** Pick a block of the town. */
  | { kind: "selectBlock" }
  /** The Data Centre cooled to this share. */
  | { kind: "coolDataCentre"; share: number }
  /** The AI puts one of these up. */
  | { kind: "aiBuilds"; def: string }
  /** One more of these stands than when it was asked. */
  | { kind: "buildBy"; def: string }
  /** So many agents running. */
  | { kind: "agentsRunning"; n: number }
  /** Every building that drinks has its water. */
  | { kind: "waterBudgetCovered" }
  /** Give the AI a site of its own. */
  | { kind: "giveSite" };

export type Objective = ObjectiveSpec & {
  /** Seconds of play it has: time away does not count against it. */
  window: number;
  /** In a line, for the tracker. */
  says: string;
};

export type Option = {
  label: string;
  /** What it costs, said plainly; the cost itself is in its effects or objective. */
  cost?: string;
  /** What it does, said plainly, for the card. */
  says: string;
  effects: Effect[];
  objective?: Objective;
  /** What follows when its objective is met, and when it is not. */
  success?: Effect[];
  failure?: Effect[];
  /** What it says on each. */
  successSays?: string;
  failureSays?: string;
  axis: Partial<Disposition>;
};

/** A chapter: fired the first time the meter reaches its stage (or `at`), in any company of the first generation. */
export type Chapter = {
  id: string;
  title: string;
  stage: Stage;
  /** A meter value it fires at instead of its stage's start: the Lattice's 95. */
  at?: number;
  /** The AI's words; a line may change with an echo. */
  transmission: (flags: ReadonlySet<string>) => string[];
  options: Option[];
  /** The option it picks itself, ignored for `CHAPTER_WAIT` seconds. */
  preferred: number;
  /** What it remembers of each echo it sets, in its voice: the dossier's lines. */
  echoes?: Record<string, string>;
};

/** A request: a smaller ask between chapters, leant by the family of trait the AI is becoming. */
export type Request = {
  id: string;
  family: Family;
  text: string;
  options: [Option, Option];
  preferred: 0 | 1;
  echoes?: Record<string, string>;
};
