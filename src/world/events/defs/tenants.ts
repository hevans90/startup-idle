/**
 * A TENANTS' STRIKE on a street of unhappy homes. Build them a café, at its
 * usual price; freeze the rent (their work cut for three days, and they are glad
 * of it); or ignore it (their work cut less for three days, and they are put
 * out). @see setHouseWork
 */
import { addMorale } from "../../../game/morale";
import { MORALE_SECONDS } from "../../../game/morale";
import { setHouseWork } from "../closures";
import type { EventDef } from "../events";

/** How unhappy a home must be to strike, and how many on a street. */
export const STRIKE_MOOD = -10;
export const STRIKE_HOMES = 3;
/** How long their work is cut, seconds: three days. */
export const TENANTS_SECONDS = 3 * MORALE_SECONDS;
/** Their work, rent frozen or ignored, for three days; and their morale for a day. */
export const FREEZE_WORK = 0.1;
export const IGNORE_WORK = 0.4;
export const FREEZE_MORALE = 8;
export const IGNORE_MORALE = 8;

export const TENANTS: EventDef = {
  kind: "tenants",
  where: (v) => v.unhappy && { x: v.unhappy.x, y: v.unhappy.y },
  warnMs: 45_000,
  activeMs: 1_000,
  warning: { title: "A tenants' strike", text: (v) => `${v.unhappy?.homes.length ?? 0} unhappy homes on this street have stopped paying.` },
  active: { title: "Tenants' strike", text: "They are waiting for an answer." },
  calledOff: "They have settled down.",
  choices: [
    { id: "cafe", label: "Build them a café", price: (v) => v.unhappy?.cafe ?? 0, note: () => "on their street, now" },
    { id: "freeze", label: "Freeze the rent", note: () => `their work ×${FREEZE_WORK} for three days · +${FREEZE_MORALE} morale for a day` },
    { id: "ignore", label: "Ignore it", note: () => `their work ×${IGNORE_WORK} for three days · −${IGNORE_MORALE} morale for a day` },
  ],
  default: "ignore",
  ai: () => "cafe",
  outcome: (e, v) => {
    const u = v.unhappy;
    if (!u) return { text: "They have settled down." };
    const until = v.now + TENANTS_SECONDS * 1000;
    if (e.chosen === "cafe") return { text: "A café on their street: they are back.", then: () => { if (!u.gift()) setHouseWork(u.homes, IGNORE_WORK, until); } };
    if (e.chosen === "freeze") return { text: "Rent frozen for three days.", then: () => { setHouseWork(u.homes, FREEZE_WORK, until); addMorale(u.who, FREEZE_MORALE); } };
    return { text: "Ignored: they are working to rule for three days.", then: () => { setHouseWork(u.homes, IGNORE_WORK, until); addMorale(u.who, -IGNORE_MORALE); } };
  },
};
