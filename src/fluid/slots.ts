/**
 * Where water is ALLOWED to be, and therefore where it can go.
 *
 * A heightfield says one thing about a cell: how high the ground is. Water
 * sits on top of it and there is nowhere else to be. That is true of a
 * hillside and false of a bridge, and every attempt to make it true of a
 * bridge is the same attempt — a second field stacked on the first, with a
 * hand-written rule for each way the two can meet. There were four of those
 * rules in the end (a ghost, a hole, an abutment, a parapet), each one added
 * after the last one was caught being wrong, and they were wrong because they
 * were CLASSIFICATIONS. Somebody had to look at a pair of cells and decide
 * which of four cases they were.
 *
 * A SLOT is the other way round. A column is a stack of solids — the ground,
 * and a deck if there is one — and between and above them are the gaps water
 * can occupy. Each gap has a FLOOR, the top of the solid under it, and a ROOF,
 * the underside of the solid over it, or the open sky. That is all a slot is:
 * a vertical interval with water in it.
 *
 * And then there are no cases. Two slots in neighbouring columns exchange
 * water if, and exactly if, their intervals OVERLAP — see {@link overlapLo}
 * and {@link overlapHi}. Every one of the four rules comes back out of that as
 * a consequence rather than as a branch:
 *
 *   - a road meeting a deck at the same level overlaps, so water crosses;
 *   - the same road against the channel UNDER that deck does not overlap,
 *     because the deck's underside is below the road, so nothing pours in —
 *     which is what an abutment was;
 *   - off the side of a span the neighbour's only slot has its floor far
 *     below and no roof, so the intervals do overlap and water leaves — over
 *     a drop, which is a waterfall and is what the falls already do;
 *   - and a deck cannot leak into the channel beneath it, because the two
 *     slots are separated by the deck they are named after.
 *
 * The solver does not know which of those it is doing. It takes two intervals
 * and intersects them.
 *
 * ABSENT SLOTS. Most columns have one slot; only a bridge has two. An absent
 * slot is one with no room in it — floor and roof equal — and it is skipped by
 * the same test that skips a non-overlap, so "this column has no upper storey"
 * needs no flag either.
 *
 * THE SILL AND THE LID. An overlap has a bottom and a top, and both matter.
 * The bottom is the sill the water has to get over, which the solver was
 * already computing as the higher of two grounds — hydrostatic reconstruction,
 * and unchanged. The top is new: it is how much of a head the gap can actually
 * carry. Water four steps deep against a gap one step tall pushes through one
 * step of gap, not four.
 */

/**
 * A roof so high nothing reaches it: the open sky.
 *
 * Heights are clamped to a hundred and twenty six half steps, so this is not
 * merely large, it is unreachable — which is what lets "this slot is open
 * above" be an ordinary number rather than a flag, exactly as {@link
 * NO_INFLOW} does for the rim. Every comparison against it is a comparison it
 * loses, so the uncovered case costs a `min` and no branch.
 */
export const OPEN_SKY = 1e9;

/**
 * How much a slot is pressurised past its roof, as a fraction.
 *
 * WATER THAT FILLS ITS GAP DOES NOT STOP. A culvert running full is not a
 * culvert that has stopped flowing — it is one flowing under pressure, driven
 * by the head at either END rather than by the slope of a free surface. A
 * shallow-water scheme has no pressure term and cannot say that, so the
 * standard answer is Preissmann's: pretend the conduit continues upward as a
 * narrow slot. The water level keeps rising, but in something narrow, so a
 * little volume buys a lot of head — and a head gradient is the only thing
 * this solver knows how to be driven by.
 *
 * The width ratio is the slot's to the conduit's. Small enough and the
 * pressurised wave runs at about the right speed; too small and it runs so
 * fast the substep cannot keep up with it. A twenty-fourth is the usual
 * compromise and is what this uses.
 *
 * It matters for exactly one thing here, and that thing is a flood: water
 * under a bridge deep enough to touch the soffit. Without it the water simply
 * stops noticing it is full and sits there with a surface drawn through the
 * deck. With it, it backs up and goes round, which is what it does.
 */
export const PRESSURE_SLOT = 1 / 24;

/**
 * The HYDRAULIC surface of a slot: what the head is measured to.
 *
 * Below the roof this is the plain `floor + depth` it has always been. Above
 * it the extra depth is in the narrow slot and buys `PRESSURE_SLOT` of its
 * height, so the surface keeps climbing and keeps driving flow, but the water
 * is no longer where the surface says it is. That is the whole of the
 * approximation and it is why the RENDERER must not use this — see
 * {@link wetTop}.
 */
export function head(floor: number, roof: number, depth: number): number {
  const room = roof - floor;
  return depth <= room ? floor + depth : roof + (depth - room) * PRESSURE_SLOT;
}

/**
 * The top of the actual WATER in a slot: what to draw, and what to stand on.
 *
 * The same thing as {@link head} until the slot is full, and then it stops,
 * because past that the water is against a soffit and there is nothing above
 * it to see. Drawing the hydraulic surface instead puts a sheet of water
 * inside the bridge.
 */
export function wetTop(floor: number, roof: number, depth: number): number {
  const top = floor + depth;
  return top < roof ? top : roof;
}

/** The bottom of the gap two slots share: the sill between them. */
export const overlapLo = (floorA: number, floorB: number) =>
  floorA > floorB ? floorA : floorB;

/** The top of the gap two slots share: the lid over them. */
export const overlapHi = (roofA: number, roofB: number) =>
  roofA < roofB ? roofA : roofB;

/**
 * Whether two slots are connected at all — the one rule this file exists for.
 *
 * STRICTLY GREATER, so two slots that merely touch (the underside of a deck
 * exactly at the level of the road beside it) are not connected. A gap of no
 * height carries no water, and an edge that carries no water should not be
 * accelerating: left as `>=` it is a permanent zero-carry edge doing the
 * arithmetic anyway.
 */
export const connected = (
  floorA: number, roofA: number, floorB: number, roofB: number,
) => overlapHi(roofA, roofB) > overlapLo(floorA, floorB);

/** Whether a slot exists at all: an absent one is a gap of no height. */
export const present = (floor: number, roof: number) => roof > floor;
