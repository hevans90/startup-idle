/**
 * A RIVER FLOOD: heavy rain upstream, and the river over its banks for a
 * minute. Sandbag the riverside (interns, until it passes), evacuate (the
 * flooded homes' people off work and put out for a day), raise a levee
 * (flood walls along the low bank near the head, paid for, there for good),
 * or brace for it (whatever the water reaches is damaged). The water itself
 * is the map's. @see world/events/flood, world/events/levee
 */
import { addMorale } from "../../../game/morale";
import { questFloodMult } from "../../../game/quests/effects";
import { CREW_SHARE, type EventDef } from "../events";
import { FLOOD_SECONDS } from "../flood";

/** Warning before a flood, and how long it runs once it strikes, ms. */
export const FLOOD_WARN_MS = 60_000;
export const FLOOD_MS = FLOOD_SECONDS * 1000;
/** What being evacuated puts a flooded home's people out, in morale for a day. */
export const EVACUEE_MORALE = 2;

export const FLOOD: EventDef = {
  kind: "river-flood",
  where: (v) => v.river,
  // More or less often by the arc. @see questFloodMult
  weight: () => questFloodMult(),
  warnMs: FLOOD_WARN_MS,
  activeMs: FLOOD_MS,
  warning: {
    title: "The river is going to flood",
    text: () => "Heavy rain upstream. The river will rise over its banks for a minute; anything low beside it will be under water.",
  },
  active: { title: "The river is in flood", text: "The water is over the banks. It goes down on its own." },
  choices: [
    { id: "sandbags", label: "Sandbag the riverside", crew: { who: "intern", share: CREW_SHARE.sandbags, during: "both" }, note: () => "keeps the water out" },
    {
      id: "levee", label: "Raise a levee", price: (v) => v.levee?.price ?? 0,
      unavailable: (v) => (!v.levee ? "No river to wall" : v.levee.walls ? undefined : "The bank is walled already"),
      note: (v) => `${v.levee?.walls ?? 0} flood walls along the low bank, there for good · past them, what the water reaches is damaged`,
      act: (v) => v.levee?.build(),
    },
    { id: "evacuate", label: "Evacuate", note: () => `flooded homes stop work until it passes, and are put out: −${EVACUEE_MORALE} morale for a day` },
    { id: "brace", label: "Brace for it", note: () => "whatever the water reaches is damaged: idle until repaired, one at a time" },
  ],
  default: "evacuate",
  ai: () => "levee",
  during: (e, v) => ({ hit: Math.max(e.hit ?? 0, v.flooded) }),
  calledOff: "The river is gone.",
  outcome: (e, v) => {
    const n = e.hit ?? 0;
    const evacuated = [...v.evacuated];
    const then = e.chosen === "evacuate" ? () => { for (const who of evacuated) addMorale(who, -EVACUEE_MORALE); } : undefined;
    if (!n) return { text: e.chosen === "levee" ? "The levee held: the river stayed in its banks." : "The river stayed in its banks.", then };
    const what = `${n} building${n === 1 ? "" : "s"}`;
    if (e.chosen === "sandbags") return { text: `The sandbags held: ${what} kept dry.` };
    if (e.chosen === "levee") return { text: `The water got past the levee to ${what}. They are idle until the repair crew has been round each.` };
    if (e.chosen === "evacuate") return { text: `${what} cleared in time; everyone is back.`, then };
    return { text: `The water reached ${what}. They are idle until the repair crew has been round each.` };
  },
};
