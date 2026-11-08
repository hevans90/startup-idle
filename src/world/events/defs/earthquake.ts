/**
 * AN EARTHQUAKE: rare, and only once the HQ stands. Tremors, then a few
 * seconds of shaking, and the buildings nearest the HQ damaged — the repair
 * crew's, one at a time. Brace them (paid: none damaged), strap down the
 * racks (every vibe coder off work till it is over: the AI's buildings
 * spared), or carry on. @see QUAKE_DAMAGED
 */
import { CREW_SHARE, type EventDef } from "../events";

export const QUAKE_WARN_MS = 45_000;
export const QUAKE_MS = 8_000;
/** How many of the buildings nearest the HQ it damages, carried on. */
export const QUAKE_DAMAGED = 4;
/** Seconds of income bracing costs. */
export const BRACE_SECONDS = 260;
/** Rare: a fraction of the others' chance. */
export const QUAKE_WEIGHT = 0.35;

export const EARTHQUAKE: EventDef = {
  kind: "earthquake",
  where: (v) => v.hq,
  weight: () => QUAKE_WEIGHT,
  warnMs: QUAKE_WARN_MS,
  activeMs: QUAKE_MS,
  warning: { title: "Tremors", text: () => `The ground is shaking near the HQ. The ${QUAKE_DAMAGED} buildings nearest it will take the worst.` },
  active: { title: "Earthquake", text: "The ground is shaking." },
  choices: [
    { id: "brace", label: "Brace the buildings", price: (v) => v.income * BRACE_SECONDS, note: () => "none damaged" },
    { id: "strap", label: "Strap down the racks", crew: { who: "vibe_coder", share: CREW_SHARE.strap, during: "both" }, note: () => "the AI's buildings spared" },
    { id: "carry-on", label: "Carry on", note: () => `the ${QUAKE_DAMAGED} nearest damaged` },
  ],
  default: "carry-on",
  ai: () => "brace",
  outcome: (e) => ({ text: e.chosen === "brace" ? "It held." : `It is over. The crew will see to what it damaged.` }),
};
