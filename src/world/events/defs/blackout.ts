/**
 * A BLACKOUT: the grid fails round the busiest junction, and every building
 * there shuts — dark, its people off work — until the power is back. Hire
 * generators (nothing shuts), shed the agents' load (none running while it
 * lasts, and the district holds), or sit it out. @see BLACKOUT_RADIUS
 */
import { minutes, type EventDef } from "../events";

export const BLACKOUT_WARN_MS = 45_000;
export const BLACKOUT_MS = 300_000;
/** Seconds of income the generators cost. */
export const GENERATOR_SECONDS = 100;
/** How far round the junction the district goes, in tiles. */
export const BLACKOUT_RADIUS = 7;

export const BLACKOUT: EventDef = {
  kind: "blackout",
  where: (v) => v.district && { x: v.district.x, y: v.district.y },
  warnMs: BLACKOUT_WARN_MS,
  activeMs: BLACKOUT_MS,
  warning: {
    title: "The grid is failing",
    text: (v) => {
      const n = v.district?.ids.length ?? 0;
      return `${n} ${n === 1 ? "building" : "buildings"} round the busiest junction will lose power for ${minutes(BLACKOUT_MS)}.`;
    },
  },
  active: { title: "Blackout", text: "A district has no power. Its buildings are shut." },
  calledOff: "Nothing left there to lose power.",
  choices: [
    { id: "generators", label: "Hire generators", price: (v) => v.income * GENERATOR_SECONDS, note: () => "nothing shuts" },
    {
      id: "shed", label: "Shed the agents' load", note: () => "no agents running while it lasts: the district holds",
      unavailable: (v) => (v.datacentre ? undefined : "No agents to shed"),
    },
    { id: "wait", label: "Sit it out", note: () => "its buildings shut till the power is back" },
  ],
  default: "wait",
  ai: () => "generators",
  outcome: (e) => ({ text: e.chosen === "wait" ? "The power is back. So are its people." : "The grid is back." }),
};
