/**
 * A VIRAL POST: something the culture deck is doing has gone viral. Lean in —
 * the card's rank-3 rule in force for five minutes, and everyone tired after
 * — or bank it: a culture point. Likelier the more cards are slotted.
 * @see conditions, bankPoint
 */
import { card } from "../../../game/culture";
import { addCondition } from "../../../game/conditions";
import { addMorale } from "../../../game/morale";
import { useGeneratorStore, type GeneratorId } from "../../../state/generators.store";
import type { EventDef } from "../events";

export const VIRAL_MS = 300_000;
const VIRAL_WARN_MS = 20_000;
/** What leaning in costs everyone, once it is over, in morale for a day. */
export const VIRAL_MORALE = 3;

export const VIRAL: EventDef = {
  kind: "viral",
  where: (v) => (v.viral && v.door ? { x: v.door.x + 1, y: v.door.y } : null),
  weight: (v) => (v.viral ? 1 + v.viral.slotted / 2 : 0),
  warnMs: VIRAL_WARN_MS,
  activeMs: VIRAL_MS,
  warning: { title: "A post has gone viral", text: (v) => `Everyone is talking about your ${v.viral?.name ?? "culture"}.` },
  active: { title: "Viral", text: "Leaning in." },
  calledOff: "It has blown over.",
  choices: [
    {
      id: "lean", label: "Lean in",
      note: (v) => (v.viral ? `${card(v.viral.card).keystone} for 5 minutes · then −${VIRAL_MORALE} morale for a day` : ""),
      act: (v) => { if (v.viral) addCondition({ source: "viral", effects: card(v.viral.card).rule, until: v.now + VIRAL_WARN_MS + VIRAL_MS }); },
    },
    { id: "bank", label: "Bank it", note: () => "a culture point" },
  ],
  default: "bank",
  ai: () => "lean",
  goesAhead: (e) => e.chosen === "lean",
  outcome: (e, v) => {
    if (e.chosen !== "lean") return { text: "Banked: a culture point to spend on the deck.", then: () => useGeneratorStore.getState().bankPoint() };
    const kinds = (Object.keys(v.owned) as GeneratorId[]).filter((k) => (v.owned[k] ?? 0) > 0);
    return { text: `It has blown over, and everyone is tired: −${VIRAL_MORALE} morale for a day.`, then: () => { for (const k of kinds) addMorale(k, -VIRAL_MORALE); } };
  },
};
