/**
 * POLLUTION, the rules: slop let out into water mixes with it, and the water
 * is fouled by how much of it is slop — so the same slop browns a pond and
 * barely tints a river. The water's own solver carries it: down a river and
 * off the map with it, over a fall, round a lake as the lake moves; it
 * settles out slowly where the water is mostly clean. Pure numbers.
 * @see world/water/pollution, fluid/columns FOUL_SETTLE, plans/pipe-network.md §4
 */

/** Seconds between looks at the water for each tile's level: it moves slowly, a few times a second is plenty. */
export const POLLUTION_STEP = 0.25;
/** Half steps of depth below which a tile is dry ground, not water. */
export const POLLUTION_WET = 0.1;
/**
 * The share of the water that is slop that reads as fully fouled: a half
 * step of slop to a half step of water. A unit of slop is half a half step
 * over a tile (`SPILL_DEPTH`), so a unit let into water a half step deep
 * reads about as it always did.
 */
export const FULL = 0.5;

/** How fouled water is, nought to one, from how much of it is slop and how deep it stands. */
export const levelOf = (strength: number, depth: number) =>
  depth < POLLUTION_WET || !(strength > 0) ? 0 : Math.min(1, strength / FULL);

/** Beyond this, water in view of a house spoils it. @see MOOD.polluted */
export const POLLUTED = 0.25;

/**
 * What a main's water still does as cooling, drawn from water fouled to
 * `level`: less the dirtier, never under a quarter. @see solveMain
 */
export const coolingKept = (level: number) => Math.max(0.25, 1 - Math.max(0, Math.min(1, level)));
