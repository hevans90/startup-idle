/**
 * A FIRE: a heatwave ridden out leaves a building overheated, and if the crew
 * has not got to it, it catches. Hose it from the hydrants (where the mains
 * reach it: the mains' water on it, every tank emptied and none filled till
 * it is out — what drinks runs short), call the fire
 * brigade (paid, out in a minute), or let it burn — burnt out, the crew's
 * longest job, and spreading halfway through to up to two buildings next to
 * it left without water. Only ever a heatwave's follow-up. @see HEATWAVE
 */
import { minutes, type EventDef } from "../events";

/** How long after a ridden-out heatwave the smoke starts, ms. @see Outcome.next */
export const FIRE_AFTER_MS = 20_000;
/** The warning, and how long it burns if let. */
export const FIRE_WARN_MS = 30_000;
export const FIRE_MS = 180_000;
/** How long it takes to put out, by the hydrants and by the brigade. */
export const HOSE_OUT_MS = 120_000;
export const BRIGADE_OUT_MS = 60_000;
/** Seconds of income the brigade costs. */
export const BRIGADE_SECONDS = 120;
/** The most buildings next to it a fire let burn spreads to. */
export const FIRE_SPREAD = 2;

export const FIRE: EventDef = {
  kind: "fire",
  where: (v) => v.smoking && { x: v.smoking.x, y: v.smoking.y },
  // NEVER DRAWN by the director: only a heatwave's follow-up. @see HEATWAVE
  weight: () => 0,
  warnMs: FIRE_WARN_MS,
  activeMs: FIRE_MS,
  activeFor: (e) => (e.chosen === "hose" ? HOSE_OUT_MS : e.chosen === "brigade" ? BRIGADE_OUT_MS : FIRE_MS),
  warning: { title: "Smoke", text: () => "A building the heatwave overheated is smoking. It will catch." },
  active: { title: "Fire", text: "A building is on fire." },
  calledOff: "The crew cooled it in time.",
  choices: [
    {
      id: "hose", label: "Hose it from the hydrants",
      note: () => `out in ${minutes(HOSE_OUT_MS)} · every tank emptied, and none filled till then`,
      unavailable: (v) => (v.smoking?.hydrant ? undefined : "No mains reach it"),
      act: (v) => v.smoking?.hose(),
    },
    { id: "brigade", label: "Call the fire brigade", price: (v) => v.income * BRIGADE_SECONDS, note: () => `out in ${minutes(BRIGADE_OUT_MS)}` },
    { id: "burn", label: "Let it burn", note: () => `burnt out, and it spreads to what is next to it without water` },
  ],
  default: "burn",
  ai: (v) => (v.smoking?.hydrant ? "hose" : "brigade"),
  outcome: (e, v) => {
    if (e.chosen !== "burn") return { text: "The fire is out. It is still overheated until the crew has been." };
    const n = v.smoking?.spread ?? 0;
    return {
      text: n ? `It burnt out, and ${n} next to it. The crew will rebuild each.` : "It burnt out. The crew will rebuild it.",
      then: () => v.smoking?.burnOut(),
    };
  },
};
