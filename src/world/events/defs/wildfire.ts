/**
 * A WILDFIRE: in a drought, a heatwave or a hot dry summer, the driest of the woods, scrub or heath smoulders and
 * catches, and runs with the wind through whatever will burn, leaving it charred — and burning out what is built
 * beside it. Call the fire brigade (paid: it spreads no further and is out in a minute) or let it burn till it
 * runs out of woods, the rain comes or it burns itself out. Only when something is dry enough to catch, and the
 * likelier the drier. @see vegetation/wildfire, vegetation/stress
 */
import { minutes, type EventDef, type EventKind, type TownView } from "../events";

/** The warning, and how long it burns if let. */
export const WILDFIRE_WARN_MS = 30_000;
export const WILDFIRE_MS = 240_000;
/** How long the brigade takes to put it out. */
export const WILDFIRE_BRIGADE_MS = 60_000;
/** Seconds of income the brigade costs. */
export const WILDFIRE_BRIGADE_SECONDS = 180;

/** How often a drought or heatwave that leaves a wood dry enough to catch is followed by a fire, and how soon. */
export const WILDFIRE_AFTER = 0.4;
export const WILDFIRE_AFTER_MS = 60_000;

/**
 * A FIRE AFTER THE DRY: what a drought or heatwave just over (`kind`) leaves to come, `roll` in [0, 1) — a wildfire,
 * {@link WILDFIRE_AFTER} of the time, if a wood is dry enough to catch now. The director draws nothing while either is
 * on, so without this a fire came only if it happened to be drawn the moment they were over. @see Outcome.next
 */
export function fireAfterDry(kind: EventKind, v: Pick<TownView, "wildfire">, roll: number): { kind: EventKind; inMs: number } | null {
  if (kind !== "drought" && kind !== "heatwave") return null;
  return v.wildfire && roll < WILDFIRE_AFTER ? { kind: "wildfire", inMs: WILDFIRE_AFTER_MS } : null;
}

export const WILDFIRE: EventDef = {
  kind: "wildfire",
  where: (v) => v.wildfire && { x: v.wildfire.x, y: v.wildfire.y },
  // The drier, the likelier.
  weight: (v) => (v.wildfire ? 0.3 + 2 * v.wildfire.dryness : 0),
  warnMs: WILDFIRE_WARN_MS,
  activeMs: WILDFIRE_MS,
  activeFor: (e) => (e.chosen === "brigade" ? WILDFIRE_BRIGADE_MS : WILDFIRE_MS),
  warning: { title: "Smoke over the woods", text: () => "A dry wood is smouldering. It will catch and spread with the wind." },
  active: { title: "Wildfire", text: "The woods are burning. What is built beside them burns out." },
  calledOff: "It rained. The smoke is gone.",
  choices: [
    { id: "brigade", label: "Call the fire brigade", price: (v) => v.income * WILDFIRE_BRIGADE_SECONDS, note: () => `it spreads no further · out in ${minutes(WILDFIRE_BRIGADE_MS)}` },
    { id: "burn", label: "Let it burn", note: () => "it runs through the woods till they or the rain stop it" },
  ],
  default: "burn",
  ai: () => "brigade",
  // Out on its own, it is over.
  during: (e, v) => ({ hit: Math.max(e.hit ?? 0, v.wildfire?.buildings ?? 0), ...(v.wildfire && !v.wildfire.burning ? { endsAt: v.now } : {}) }),
  outcome: (e, v) => {
    const cells = v.wildfire?.burnt ?? 0, built = e.hit ?? 0;
    const what = `${cells} ${cells === 1 ? "cell" : "cells"} of woods and fields burnt`;
    return { text: built ? `The fire is out: ${what}, and ${built} ${built === 1 ? "building" : "buildings"} burnt out. The crew will rebuild each.` : `The fire is out: ${what}. It grasses over in a year.` };
  },
};
