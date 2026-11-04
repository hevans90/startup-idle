/**
 * INVESTORS LOOKING ROUND: they judge the company by how happy its people are
 * at home, and pay for what they see. Tidying up first (every vibe coder, till
 * they come) makes the town look better; a poor showing tells the next
 * acquirer. @see SNUB
 */
import { useSessionStore } from "../../../state/session.store";
import { CREW_SHARE, money, type EventDef } from "../events";

/** Mood points tidying up is worth, to the investors. */
export const TIDY_MOOD = 10;

/** What investors shown round pay, in seconds of income, by how happy the town's homes are: 30, and 1.5 a point. */
export function tourReward(income: number, mood: number, tidied: boolean): number {
  const seconds = Math.max(0, Math.min(90, 30 + 1.5 * (mood + (tidied ? TIDY_MOOD : 0))));
  return Math.round(Math.max(0, income) * seconds);
}
/** Whether a tour left the investors unimpressed: they paid less than the base 30 s of income. @see SNUB */
export const tourFailed = (income: number, reward: number) => reward < Math.max(0, income) * 30;

export const INVESTOR_TOUR: EventDef = {
  kind: "investor-tour",
  where: (v) => v.door && { x: v.door.x + 1, y: v.door.y },
  warnMs: 45_000,
  activeMs: 30_000,
  warning: { title: "Investors are coming to look round", text: () => "They will judge the company by how happy its people are at home." },
  active: { title: "The investors are touring the town", text: "Every unhappy house is being noticed." },
  choices: [
    { id: "tidy", label: "Tidy up first", crew: { who: "vibe_coder", share: CREW_SHARE.tidy, during: "warning" }, note: () => `the town's morale looks ${TIDY_MOOD} better` },
    { id: "as-is", label: "Show it as it is", note: (v) => `they would pay ${money(tourReward(v.income, v.mood, false))} now` },
  ],
  default: "as-is",
  outcome: (e, v) => {
    const r = tourReward(v.income, v.mood, e.chosen === "tidy");
    const failed = tourFailed(v.income, r);
    // INVESTORS UNIMPRESSED tell the next acquirer. @see SNUB
    const then = () => useSessionStore.getState().setSnubbed(failed);
    if (r <= 0) return { text: "The investors were not impressed, and they talk: the next acquirer will offer less.", then };
    return {
      text: failed ? `The investors paid ${money(r)}, unimpressed — the next acquirer will offer less.` : `The investors liked what they saw: ${money(r)}.`,
      money: r, then,
    };
  },
};
