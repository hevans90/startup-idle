/**
 * A HEATWAVE: for three minutes what cools the agents drinks twice as much.
 * Pay for emergency pumps (every tank kept full), throttle the agents (none
 * running for it: their boost and the meter stop), or ride it out — and
 * whatever runs short of water overheats, idle until the repair crew has been.
 * The weather is the scene's. @see setHeat, setThrottled
 */
import type { EventDef } from "../events";

/** How long it lasts, and the warning, ms. */
export const HEAT_MS = 180_000;
export const HEAT_WARN_MS = 45_000;
/** What it multiplies the drinkers' demand by. */
export const HEAT_THIRST = 2;
/** Seconds of income the emergency pumps cost. */
export const PUMP_SECONDS = 60;
/** The share of its demand a drinker can fall to, riding it out, before it overheats. */
export const OVERHEAT_SHARE = 0.5;

export const HEATWAVE: EventDef = {
  kind: "heatwave",
  where: (v) => v.drinkers && { x: v.drinkers.x, y: v.drinkers.y },
  warnMs: HEAT_WARN_MS,
  activeMs: HEAT_MS,
  warning: { title: "A heatwave is coming", text: () => `For three minutes, what cools the agents will drink ${HEAT_THIRST} times as much.` },
  active: { title: "Heatwave", text: "Everything that cools the agents is drinking twice as much." },
  choices: [
    { id: "pumps", label: "Emergency pumps", price: (v) => v.income * PUMP_SECONDS, note: () => "every tank kept full while it lasts" },
    { id: "throttle", label: "Throttle the agents", note: () => "no agents running while it lasts: their boost and the meter stop" },
    { id: "ride", label: "Ride it out", note: () => "whatever runs short of water overheats: idle until repaired" },
  ],
  default: "throttle",
  ai: () => "pumps",
  during: (e, v) => ({ hit: Math.max(e.hit ?? 0, v.overheated) }),
  outcome: (e) => {
    if (e.chosen === "pumps") return { text: "The pumps kept every tank full. It is over." };
    if (e.chosen === "throttle") return { text: "The agents are back on. It is over." };
    const n = e.hit ?? 0;
    return { text: n ? `${n} overheated. They are idle until the repair crew has been round each.` : "Nothing ran short. It is over." };
  },
};
