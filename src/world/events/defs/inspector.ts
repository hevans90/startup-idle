/**
 * THE HEALTH INSPECTOR, come because an office has spilled. A clean-up sprint
 * (vibe coders off until they come, every spill mopped now), pay the fine, or
 * let them close the worst office for two minutes. Found clean, the company
 * has a CLEAN RECORD — every kind a little happier, until the next spill.
 * @see CLEAN_RECORD
 */
import { addCondition } from "../../../game/conditions";
import type { GeneratorId } from "../../../state/generators.store";
import { CREW_SHARE, type EventDef } from "../events";

/** How long the office is closed, seconds. */
export const CLOSED_SECONDS = 120;
/** Seconds of income the fine is. */
export const FINE_SECONDS = 15;
/** What a clean record is worth, in morale, for the run — lost at the next spill. */
export const CLEAN_MOOD = 3;
export const CLEAN_RECORD = "clean-record";

export const INSPECTOR: EventDef = {
  kind: "inspector",
  where: (v) => v.offices && { x: v.offices.x, y: v.offices.y },
  weight: (v) => (v.offices?.dirty ? 1 : 0),
  warnMs: 45_000,
  activeMs: 5_000,
  warning: { title: "The health inspector is coming", text: () => "An office has spilled, and someone told them." },
  active: { title: "The health inspector", text: "They are looking round." },
  choices: [
    {
      id: "sprint", label: "Clean-up sprint", crew: { who: "vibe_coder", share: CREW_SHARE.sprint, during: "warning" },
      note: () => "every spill mopped now", act: (v) => v.diligence.mop(),
    },
    { id: "fine", label: "Pay the fine", price: (v) => v.income * FINE_SECONDS },
    { id: "close", label: "Let them close it", note: () => `the worst office closed for ${CLOSED_SECONDS / 60} minutes` },
  ],
  default: "close",
  outcome: (e, v) => {
    const o = v.offices;
    if (o && !o.dirty && !v.diligence.spills) {
      const kinds = (Object.keys(v.owned) as GeneratorId[]).filter((k) => (v.owned[k] ?? 0) > 0);
      return {
        text: `Found clean: a clean record, +${CLEAN_MOOD} morale until the next spill.`,
        then: () => { for (const k of kinds) addCondition({ source: CLEAN_RECORD, only: k, lean: CLEAN_MOOD, until: null }); },
      };
    }
    if (e.chosen === "fine") return { text: "Fined, and gone." };
    return { text: `The worst office is closed for ${CLOSED_SECONDS / 60} minutes.`, then: () => o?.close(o.id, CLOSED_SECONDS) };
  },
};
