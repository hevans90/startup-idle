/**
 * SLOP, the rules: what the vibe coders ship that nobody asked for. Once
 * there are enough of them to notice, each one at a desk makes so much a
 * second — less when they are happy, more under Hackathon Culture — into a
 * TANK at their workplace that holds a couple of minutes of what it makes. A
 * sewer drains the tanks; a full one SPILLS at its port, as sludge on the
 * street, or into the water if it stands in it. What the economy works out
 * each tick the map reads each frame. @see world/slop/tanks, plans/pipes-and-slop.md §4
 */
import { cultureNow } from "./culture-now";
import { vibeSlopMultiplier } from "./satisfaction";

/** Vibe coders there have to be before any of them makes slop. */
export const SLOP_FROM = 50;
/** Slop a vibe coder makes a second, before morale and cards: a hundred of them, a sewer's worth. */
export const SLOP_PER_CODER = 0.01;
/** A workplace's tank holds this many seconds of what it makes, and never less than this much. */
export const TANK_SECONDS = 120;
export const TANK_LEAST = 2;
/** Half steps of sludge a unit of slop spills as, over one tile. */
export const SPILL_DEPTH = 0.5;
/** Pollution a unit of slop puts into the water. @see world/water/pollution */
export const POLLUTION_PER_SLOP = 1;

/** Slop made a second by `coders` vibe coders at `score` morale, under the culture deck's `policy` multiplier. */
export function slopMade(coders: number, score: number, policy = 1): number {
  if (coders < SLOP_FROM) return 0;
  return coders * SLOP_PER_CODER * vibeSlopMultiplier(score) * policy;
}

/** A tank's size for a workplace making `rate` a second, and as Move Fast shrinks it. @see CARDS */
export const tankFor = (rate: number) => Math.max(TANK_LEAST, rate * TANK_SECONDS * cultureNow().tank);

/**
 * SLOP MADE A SECOND, as the economy last worked it out: what the map's
 * tanks fill by. Live state; not saved. @see generators.store tick
 */
let making = 0;
export const setSlopMaking = (rate: number) => { making = Number.isFinite(rate) ? Math.max(0, rate) : 0; };
export const slopMaking = () => making;

/** WHETHER ANY TANK SPILLS, as the map last stepped them: what Hackathon Culture's and Vibes Only's rules read. Live state. @see Rules */
let spilling = false;
export const setSlopSpilling = (on: boolean) => { spilling = on; };
export const slopSpilling = () => spilling;
