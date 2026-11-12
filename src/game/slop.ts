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
/** Half steps a unit of slop stands as, over one tile: on the street, or mixed into the water. */
export const SPILL_DEPTH = 0.5;

/**
 * Slop a vibe coder AT A DESK makes a second, with `coders` of them employed
 * at `score` morale, under the culture deck's `policy` multiplier: none till
 * there are `SLOP_FROM`. Those with no desk, at home or off the map make none.
 */
export function slopPerCoder(coders: number, score: number, policy = 1): number {
  if (coders < SLOP_FROM) return 0;
  return SLOP_PER_CODER * vibeSlopMultiplier(score) * policy;
}
/** Slop made a second by `coders` vibe coders, every one at a desk. */
export const slopMade = (coders: number, score: number, policy = 1): number => coders * slopPerCoder(coders, score, policy);

/** A tank's size for a workplace making `rate` a second, and as Move Fast shrinks it. @see CARDS */
export const tankFor = (rate: number) => Math.max(TANK_LEAST, rate * TANK_SECONDS * cultureNow().tank);

/**
 * SLOP A SEATED VIBE CODER MAKES A SECOND, as the economy last worked it out:
 * what each tank fills by, for each of its workplace's desks taken. Live
 * state; not saved. @see generators.store tick, stepSlop
 */
let rate = 0;
export const setSlopRate = (perCoder: number) => { rate = Number.isFinite(perCoder) ? Math.max(0, perCoder) : 0; };
export const slopRate = () => rate;

/**
 * SLOP MADE A SECOND on the map, as the tanks were last stepped: every
 * workplace's, by who sits at its desks. Live state; not saved. @see stepSlop
 */
let making = 0;
export const setSlopMaking = (rate: number) => { making = Number.isFinite(rate) ? Math.max(0, rate) : 0; };
export const slopMaking = () => making;

/** WHETHER ANY TANK SPILLS, as the map last stepped them: what Hackathon Culture's and Vibes Only's rules read. Live state. @see Rules */
let spilling = false;
export const setSlopSpilling = (on: boolean) => { spilling = on; };
export const slopSpilling = () => spilling;
