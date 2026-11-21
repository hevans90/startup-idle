/**
 * World v2 — THE HOUSING KITS, by name: the three districts' homes, each in
 * three tiers and a landmark, and how many floors each grows to. Data only,
 * so what a structure IS can read it without the models. @see houses/models
 */
export const HOUSE_FLOORS: Readonly<Record<string, number>> = {
  "intern.t0": 2,
  "intern.t1": 3,
  "intern.t2": 4,
  "vibe_coder.t0": 2,
  "10x_dev.t0": 3,
  "10x_dev.t1": 4,
  "vibe_coder.t2": 4,
  "intern.landmark": 6,
  "vibe_coder.t1": 3,
  "vibe_coder.landmark": 6,
  "10x_dev.t2": 5,
  "10x_dev.landmark": 8,
};

/** Every kit, in the order they are registered. */
export const HOUSE_KITS: readonly string[] = Object.keys(HOUSE_FLOORS);
