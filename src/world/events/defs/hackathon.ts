/**
 * A HACKATHON the vibe coders want: host it (the pizza, and all of them off
 * work a minute) and they come back happier; turn it down and they notice.
 */
import { addMorale } from "../../../game/morale";
import { CREW_SHARE, type EventDef } from "../events";

/** Satisfaction a hackathon gives the vibe coders, and what turning one down costs. */
export const HACKATHON_MORALE = 6;
export const HACKATHON_SNUB = 4;
/** The pizza for a hackathon, in seconds of income. @see pizzaPrice */
export const HACKATHON_PIZZA = 20;
/** Vibe coders a studio needs before they ask for a hackathon. */
export const HACKATHON_CODERS = 10;

export const HACKATHON: EventDef = {
  kind: "hackathon",
  where: (v) => v.studio && { x: v.studio.x + 1, y: v.studio.y + 1 },
  warnMs: 45_000,
  activeMs: 60_000,
  warning: { title: "The vibe coders want a hackathon", text: () => "A minute off work, all of them, and they come back happier." },
  active: { title: "Hackathon!", text: "The vibe coders are off work, building something nobody asked for." },
  choices: [
    {
      id: "host", label: "Host it", price: (v) => v.pizza, crew: { who: "vibe_coder", share: CREW_SHARE.hackathon, during: "active" },
      note: () => `then +${HACKATHON_MORALE} vibe coder morale for a day`,
    },
    { id: "decline", label: "Not now", note: () => `−${HACKATHON_SNUB} vibe coder morale for a day` },
  ],
  default: "decline",
  goesAhead: (e) => e.chosen === "host",
  outcome: (e) => e.chosen === "host"
    ? { text: `They are back, and happier for it: +${HACKATHON_MORALE} vibe coder morale for a day.`, then: () => addMorale("vibe_coder", HACKATHON_MORALE) }
    : { text: `No hackathon this time, and they noticed: −${HACKATHON_SNUB} vibe coder morale for a day.`, then: () => addMorale("vibe_coder", -HACKATHON_SNUB) },
};
