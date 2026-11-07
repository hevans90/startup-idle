/**
 * THE HEALTH INSPECTOR, come because an office has spilled. A clean-up sprint
 * (vibe coders off until they come, every spill mopped now), pay the fine, or
 * let them close the worst office for two minutes. Found clean, the company
 * has a CLEAN RECORD — every kind a little happier, until the next spill.
 * Closed, they come back in five minutes; closed a second time, and fined.
 * @see CLEAN_RECORD, REINSPECT_MS
 */
import { addCondition } from "../../../game/conditions";
import type { GeneratorId } from "../../../state/generators.store";
import { useMoneyStore } from "../../../state/money.store";
import { CREW_SHARE, type EventDef } from "../events";

/** How long the office is closed, seconds. */
export const CLOSED_SECONDS = 120;
/** Seconds of income the fine is. */
export const FINE_SECONDS = 15;
/** What a clean record is worth, in morale, for the run — lost at the next spill. */
export const CLEAN_MOOD = 3;
export const CLEAN_RECORD = "clean-record";
/** How long after a closure they come back to look again, ms. */
export const REINSPECT_MS = 300_000;

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
  ai: () => "sprint",
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
    // A SECOND TIME, a fine as well as the closure; the first, they will be back. @see Outcome.next
    if (e.chained) {
      const fine = v.income * FINE_SECONDS;
      return { text: `Closed again for ${CLOSED_SECONDS / 60} minutes, and fined.`, then: () => { o?.close(o.id, CLOSED_SECONDS); const m = useMoneyStore.getState(); m.spendMoney(Math.min(fine, Math.max(0, m.money.toNumber()))); } };
    }
    return {
      text: `The worst office is closed for ${CLOSED_SECONDS / 60} minutes. They will be back.`,
      then: () => o?.close(o.id, CLOSED_SECONDS),
      next: { kind: "inspector", inMs: REINSPECT_MS },
    };
  },
};
