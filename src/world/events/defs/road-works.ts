/**
 * ROAD WORKS: the council closes the busiest junction for five minutes, and
 * no commute may cross it — those who went that way go round, or cannot get
 * to work. Pay overtime (a minute, not five), build a bypass (road free while
 * the works are on: what is laid stays), or put up with it. @see setClosed
 */
import type { EventDef } from "../events";

export const WORKS_MS = 300_000;
export const OVERTIME_MS = 60_000;
/** Seconds of income overtime costs. */
export const OVERTIME_SECONDS = 20;

export const ROAD_WORKS: EventDef = {
  kind: "road-works",
  where: (v) => v.junction,
  warnMs: 45_000,
  activeMs: WORKS_MS,
  activeFor: (e) => (e.chosen === "overtime" ? OVERTIME_MS : WORKS_MS),
  warning: { title: "Road works are coming", text: () => "The council will close the busiest junction for five minutes. Nobody gets through it." },
  active: { title: "Road works", text: "The junction is closed." },
  calledOff: "The junction is gone.",
  choices: [
    { id: "overtime", label: "Pay for overtime", price: (v) => v.income * OVERTIME_SECONDS, note: () => "closed a minute, not five" },
    { id: "bypass", label: "Build a bypass", note: () => "road free while the works are on" },
    { id: "put-up", label: "Put up with it" },
  ],
  default: "put-up",
  ai: () => "overtime",
  outcome: () => ({ text: "The junction is open again." }),
};
