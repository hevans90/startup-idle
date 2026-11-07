/**
 * DUE DILIGENCE: the investors come to look the company over, and inspect
 * three things the town shows — how happy its people are at home, whether
 * anything has spilled, and whether what drinks is watered. Each passes or
 * fails, and the company is valued by how many passed until the next
 * diligence; all three, and the next company's investors hear of it.
 *
 * Getting ready costs people, not money: the vibe coders tidying the town
 * for the visit, or the interns mopping up every spill before it. Their
 * reading is the scene's. @see TownView.diligence, DILIGENCE_MULT, SWEETENER
 */
import { SWEETENER } from "../../../game/term-deal";
import { useExitsStore } from "../../../state/exits.store";
import { useSessionStore } from "../../../state/session.store";
import { CREW_SHARE, type EventDef, type TownView } from "../events";

/** Mood points tidying up is worth, to the investors. */
export const TIDY_MOOD = 10;
/** The town's mood the homes must show to pass. */
export const DILIGENCE_MOOD = 5;
/** The share of what drinks that must be watered to pass. */
export const DILIGENCE_WATERED = 0.8;
/** What the company is valued at, on a sale's Equity, by how many of the three passed. */
export const DILIGENCE_MULT = [0.8, 0.95, 1.1, 1.3] as const;

export type Check = "homes" | "spills" | "water";
export const CHECKS: readonly Check[] = ["homes", "spills", "water"];

/** Which of the three pass, as the town stands — the town tidied for them, or every spill mopped, if that was the choice. */
export function inspect(v: TownView, chosen?: string): Record<Check, boolean> {
  const d = v.diligence;
  return {
    homes: d.mood + (chosen === "tidy" ? TIDY_MOOD : 0) >= DILIGENCE_MOOD,
    spills: d.spills === 0,
    // Nothing that drinks, nothing to fail.
    water: d.watered === null || d.watered >= DILIGENCE_WATERED,
  };
}

const said = (r: Record<Check, boolean>) => CHECKS.map((c) => `${c} ${r[c] ? "pass" : "fail"}`).join(", ");
const Said = (r: Record<Check, boolean>) => { const t = said(r); return t[0].toUpperCase() + t.slice(1); };
const mult = (k: number) => `×${k.toFixed(2)}`;

export const DILIGENCE: EventDef = {
  kind: "diligence",
  where: (v) => v.door && { x: v.door.x + 1, y: v.door.y },
  warnMs: 45_000,
  activeMs: 30_000,
  warning: {
    title: "Investors are coming for due diligence",
    text: () => "They will inspect three things: how happy people are at home, whether anything has spilled, and whether what drinks is watered.",
  },
  active: { title: "Due diligence", text: "The investors are going over the town." },
  choices: [
    { id: "tidy", label: "Tidy the town", crew: { who: "vibe_coder", share: CREW_SHARE.tidy, during: "warning" }, note: () => `homes look ${TIDY_MOOD} happier to them` },
    {
      id: "mop", label: "Mop up every spill", crew: { who: "intern", share: CREW_SHARE.mop, during: "warning" },
      unavailable: (v) => (v.diligence.spills ? undefined : "Nothing has spilled"),
      note: () => "the sludge on the streets cleared now, and the full tanks emptied",
      act: (v) => v.diligence.mop(),
    },
    { id: "as-is", label: "Show it as it is", note: (v) => `they would find: ${said(inspect(v))}` },
  ],
  default: "as-is",
  ai: () => "mop",
  outcome: (e, v) => {
    const r = inspect(v, e.chosen);
    const passed = CHECKS.filter((c) => r[c]).length;
    const k = DILIGENCE_MULT[passed];
    const all = passed === CHECKS.length;
    return {
      text: `${Said(r)}: the company is valued ${mult(k)} until the next diligence.${all ? ` They will tell the next company's investors, who will ask ${SWEETENER} less.` : ""}`,
      then: () => {
        useSessionStore.getState().setDiligence(k);
        if (all) useExitsStore.getState().setSweetener(true);
      },
    };
  },
};
