/**
 * World v2 — WHAT A MAIN IS DOING, said plainly: for the card a main looked
 * at opens, and the warning sign over one that cannot deliver. @see MainInfo, warnSign
 */
import type { MainReport, MainState } from "./mains";

export type Say = { title: string; text: string; tone: "good" | "warn" | "bad" };

/** A water main's. */
export const SAYS: Record<MainState, Say> = {
  flowing: { title: "Flowing", text: "Carrying water", tone: "good" },
  full: { title: "Tanks full", text: "Every tank it feeds is full: it carries more as they drink", tone: "good" },
  dry: { title: "Dry intake", text: "Dry: the water at its intake has gone", tone: "bad" },
  "no-head": { title: "Needs a pump", text: "The water is too low to reach the building: it needs a pump", tone: "warn" },
  burst: { title: "Burst", text: "Burst at a joint: pouring into the street, nothing reaching its buildings", tone: "bad" },
  "backed-up": { title: "Backed up", text: "Backed up: its slop is coming up at a manhole", tone: "bad" },
  unpaid: { title: "Pump stopped", text: "Its pump has stopped: not enough money to run it", tone: "bad" },
  "no-source": { title: "No water source", text: "Draws from nothing: one end must be at water", tone: "bad" },
  "no-outlet": { title: "Feeds nothing", text: "Feeds nothing: one end must be at an inlet of a building that drinks", tone: "bad" },
};
/** And a sewer's. Nothing moves in one till workplaces fill with slop. @see solveSewer */
export const SEWER_SAYS: Partial<Record<MainState, Say>> = {
  flowing: { title: "Joined up", text: "Joined up: its workplaces drain into it", tone: "good" },
  "no-source": { title: "Drains nothing", text: "Drains nothing: one end must be at a workplace's slop port, or pass in front of one", tone: "bad" },
  "no-outlet": { title: "Goes nowhere", text: "Goes nowhere: one end must pour into water, or feed a processor", tone: "bad" },
};
/** And a lateral's: from a workplace into a manhole. @see solveSewer */
export const LATERAL_SAYS: Partial<Record<MainState, Say>> = {
  flowing: { title: "Draining", text: "Draining into the sewer", tone: "good" },
  "no-source": { title: "Drains nothing", text: "Drains nothing: start it at a workplace's slop port", tone: "bad" },
  "no-outlet": { title: "No exit", text: "Its sewer has no exit yet", tone: "warn" },
};

/** What a main, sewer or lateral is doing, as its report says. */
export function sayOf(r: MainReport): Say {
  if (!r.sewer) return SAYS[r.state];
  const own = r.sewer.node !== undefined ? LATERAL_SAYS : SEWER_SAYS;
  return own[r.state] ?? SAYS[r.state];
}
