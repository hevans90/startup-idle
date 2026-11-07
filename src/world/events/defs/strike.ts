/**
 * A SUPPLIER STRIKE, while a site waits on loads: for four minutes the yard
 * sends nothing. Pay the strikers (a quarter of what the site's loads have left to
 * cost, and they are back at once), wait (the site stalls once its loads run
 * out), or truck from the map's edge (dearer, and a longer way).
 * @see setStrike
 */
import type { EventDef } from "../events";

export const STRIKE_MS = 240_000;
/** What paying the strikers costs, as a share of what the site's loads have left to cost. */
export const STRIKE_PAY = 0.25;
/** What a load from the map's edge costs, against the yard's. @see setStrike */
export const EDGE_LOADS = 1.5;

export const STRIKE: EventDef = {
  kind: "strike",
  where: (v) => v.site && { x: v.site.x, y: v.site.y },
  warnMs: 30_000,
  activeMs: STRIKE_MS,
  warning: { title: "The suppliers are going on strike", text: () => "For four minutes the yard will send no loads to the site." },
  active: { title: "Supplier strike", text: "The yard is sending nothing." },
  calledOff: "The site is supplied.",
  choices: [
    { id: "pay", label: "Pay the strikers", price: (v) => (v.site?.left ?? 0) * STRIKE_PAY, note: () => "loads as usual" },
    { id: "wait", label: "Wait it out", note: () => "no loads: the site stalls once its own run out" },
    { id: "edge", label: "Truck from the map's edge", note: () => `loads ×${EDGE_LOADS} the price, the long way round` },
  ],
  default: "edge",
  ai: () => "pay",
  goesAhead: (e) => e.chosen !== "pay",
  outcome: (e) => ({ text: e.chosen === "pay" ? "Paid: the yard is sending loads again." : "The strike is over." }),
};
