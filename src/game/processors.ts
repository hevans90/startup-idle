/**
 * SLOP PROCESSORS, the rules: buildings a sewer feeds, each taking so much
 * slop a second and turning it into something the company wants. Each kind
 * is opened by a project of its own and then built as often as wanted; what
 * each does is in proportion to how busy it is — a processor with nothing
 * coming in does nothing. @see world/slop/tanks, plans/pipes-and-slop.md §6
 *  - the SLOP REFINERY: innovation ("Refactored into Best Practices");
 *  - the TRAINING DATA PLANT: training runs faster, and land a little harder;
 *  - the CONTENT FARM: valuation, and LinkedOut reputation while it runs.
 */
export type ProcessorKind = "refinery" | "dataplant" | "contentfarm";

export const PROCESSOR_KINDS: readonly ProcessorKind[] = ["refinery", "dataplant", "contentfarm"];

/** Slop one takes a second, at most. */
export const PROCESS_RATE = 0.5;

/** What each is called, and what it does at full use, as a player reads it. */
export const PROCESSORS: Record<ProcessorKind, { name: string; says: string }> = {
  refinery: { name: "Slop Refinery", says: "+15% innovation at full use" },
  dataplant: { name: "Training Data Plant", says: "Training runs 25% faster and land 10% harder at full use" },
  contentfarm: { name: "Content Farm", says: "+10% valuation at full use; a LinkedOut star while it runs" },
};

/** Which kind a structure is, or null for none. The structure's id is its kind. */
export const processorKind = (def: string): ProcessorKind | null =>
  (PROCESSOR_KINDS as readonly string[]).includes(def) ? (def as ProcessorKind) : null;

/** What each does a unit of use: a processor at full use is one. */
export const REFINERY_INNOVATION = 0.15;
export const DATAPLANT_SPEED = 0.25;
export const DATAPLANT_JUMP = 0.1;
export const CONTENTFARM_VALUATION = 0.1;
/** Use, summed over the farms, past which reputation gets its star. */
export const CONTENTFARM_STAR_AT = 0.25;

/**
 * HOW BUSY EACH KIND IS, summed over its buildings — two refineries at half
 * use are one — as the map last worked it out. Live state; not saved.
 */
let use: Record<ProcessorKind, number> = { refinery: 0, dataplant: 0, contentfarm: 0 };
export const setProcessorUse = (u: Record<ProcessorKind, number>) => { use = { ...u }; };
export const processorUse = (k: ProcessorKind) => use[k];

/** What the refineries multiply innovation by. */
export const refineryBonus = () => 1 + REFINERY_INNOVATION * use.refinery;
/** What the data plants divide a training run's length by, and multiply its jump by. */
export const dataPlantSpeed = () => 1 + DATAPLANT_SPEED * use.dataplant;
export const dataPlantJump = () => 1 + DATAPLANT_JUMP * use.dataplant;
/** What the content farms multiply valuation by, and add to reputation's stars. */
export const contentFarmBonus = () => 1 + CONTENTFARM_VALUATION * use.contentfarm;
export const contentFarmStars = () => (use.contentfarm >= CONTENTFARM_STAR_AT ? 1 : 0);
