/**
 * World v2 — THE HOUSING KITS, by name: the three districts' homes, each in
 * three tiers and a landmark, and how many floors each grows to. Data only,
 * so what a structure IS can read it without the models. @see houses/models
 */
export const HOUSE_FLOORS: Readonly<Record<string, number>> = {
  "intern.t0": 1,
  "intern.t1": 2,
  "intern.t2": 3,
  "vibe_coder.t0": 1,
  "10x_dev.t0": 4,
  "10x_dev.t1": 6,
  "vibe_coder.t2": 3,
  "intern.landmark": 8,
  "vibe_coder.t1": 2,
  "vibe_coder.landmark": 8,
  "10x_dev.t2": 8,
  "10x_dev.landmark": 10,
};

/** Every kit, in the order they are registered. */
export const HOUSE_KITS: readonly string[] = Object.keys(HOUSE_FLOORS);
