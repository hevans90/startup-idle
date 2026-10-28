/**
 * POLLUTION, the rules: slop poured into water is so much MASS on a tile, and
 * the water there is fouled by its CONCENTRATION — mass over depth — so the
 * same slop browns a pond and barely tints a river. It is CARRIED down the
 * water's own slope, which is how a river runs; SHARED with the water beside
 * it, which is how it dilutes; LEAVES the map with a river at its edge; and
 * fades slowly everywhere — a still lake holds it for many minutes, a river
 * clears in a few. Pure numbers. @see world/water/pollution, plans/pipes-and-slop.md §5
 */

/** Seconds between steps of the pollution: it moves slowly, a few times a second is plenty. */
export const POLLUTION_STEP = 0.25;
/** Half steps of depth below which a tile is dry ground, not water. */
export const POLLUTION_WET = 0.1;
/** Share of a tile's mass carried a second, a half step of fall per tile of surface slope. */
export const ADVECT = 12;
/** The most of a tile's mass that leaves it in one step. */
export const MOST_OUT = 0.6;
/** How readily two wet tiles even out their concentrations, a second. */
export const DIFFUSE = 0.4;
/** Seconds for pollution to fall to a third in water (settling), and on dry ground (soaking in). */
export const SETTLE_SECONDS = 900;
export const DRY_SECONDS = 20;
/** The concentration — mass a half step of depth — that reads as fully fouled. */
export const FULL = 1;
/**
 * Below this mass a tile is clean. Tiny: the front of a spreading plume is
 * handed only a little each step, and zeroing that leaked the lot away.
 */
export const TRACE = 1e-6;

/** How fouled water is, nought to one, from its mass and depth. */
export const levelOf = (mass: number, depth: number) =>
  depth < POLLUTION_WET || mass <= TRACE ? 0 : Math.min(1, mass / depth / FULL);

/** Beyond this, water in view of a house spoils it. @see MOOD.polluted */
export const POLLUTED = 0.25;

/**
 * What a main's water still does as cooling, drawn from water fouled to
 * `level`: less the dirtier, never under a quarter. @see solveMain
 */
export const coolingKept = (level: number) => Math.max(0.25, 1 - Math.max(0, Math.min(1, level)));
