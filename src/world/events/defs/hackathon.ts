/**
 * A HACKATHON the vibe coders want: host it — all of them off work for a
 * minute, and the studio's slop tank the fuller for it — and they come back
 * with ideas: a culture card offer, one of three hustle or chaos cards, or a
 * rank on one in force once there are none left to deal. Turn it down and
 * they notice. @see hackathonDeal
 */
import { card, type HackathonGain } from "../../../game/culture";
import { addMorale } from "../../../game/morale";
import { CREW_SHARE, type EventDef } from "../events";

/** What a hackathon gives the vibe coders with the culture deck not open yet, and what turning one down costs. */
export const HACKATHON_MORALE = 6;
export const HACKATHON_SNUB = 4;
/** How long the vibe coders are off, ms. */
export const HACKATHON_MS = 60_000;
/** How much of the studio's slop tank a hackathon fills, once it is over. */
export const HACKATHON_SLOP = 0.5;
/** Vibe coders a studio needs before they ask for a hackathon. */
export const HACKATHON_CODERS = 10;

/** What they came back with, in a line. */
function cameBack(gain: HackathonGain): string {
  if (gain?.kind === "offer") return "They are back with ideas: a culture card offer is waiting on the deck.";
  if (gain?.kind === "rank") return `They are back with ideas: ${card(gain.card).name} is a rank up.`;
  return `They are back, and happier for it: +${HACKATHON_MORALE} vibe coder morale for a day.`;
}

export const HACKATHON: EventDef = {
  kind: "hackathon",
  where: (v) => v.studio && { x: v.studio.x + 1, y: v.studio.y + 1 },
  warnMs: 45_000,
  activeMs: HACKATHON_MS,
  warning: { title: "The vibe coders want a hackathon", text: () => "A minute off work, all of them, and they come back with ideas." },
  active: { title: "Hackathon!", text: "The vibe coders are off work, building something nobody asked for." },
  choices: [
    {
      id: "host", label: "Host it", crew: { who: "vibe_coder", share: CREW_SHARE.hackathon, during: "active" },
      note: () => `the studio's slop tank fills by half · then a culture card offer, 1 of 3 hustle or chaos cards`,
    },
    { id: "decline", label: "Not now", note: () => `−${HACKATHON_SNUB} vibe coder morale for a day` },
  ],
  default: "decline",
  ai: () => "host",
  goesAhead: (e) => e.chosen === "host",
  outcome: (e, v) => {
    if (e.chosen !== "host") {
      return { text: `No hackathon this time, and they noticed: −${HACKATHON_SNUB} vibe coder morale for a day.`, then: () => addMorale("vibe_coder", -HACKATHON_SNUB) };
    }
    // THE MESS they leave in the studio, and the ideas they bring back. @see slopSpike
    v.studio?.spike(HACKATHON_SLOP);
    const gain = v.studio?.ideas() ?? null;
    return { text: cameBack(gain), then: gain ? undefined : () => addMorale("vibe_coder", HACKATHON_MORALE) };
  },
};
