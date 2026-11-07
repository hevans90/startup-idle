/**
 * POACHING: a rival offers your 10x devs more — likelier the unhappier they
 * are. Match it (money), let them go, or counter-poach: they go, as many of
 * the rival's come, and the company is valued a little lower until the next
 * due diligence for the fuss. @see TownView.poach
 */
import { useSessionStore } from "../../../state/session.store";
import { people, type EventDef } from "../events";

/** The share of the 10x devs a rival goes after; the least there must be. */
export const POACH_SHARE = 0.1;
export const POACH_LEAST = 10;
/** What matching costs, a head, as a share of hiring one now. */
export const MATCH_SHARE = 0.5;
/** What counter-poaching does to the company's valuation, until the next diligence. */
export const COUNTER_VALUE = 0.95;

export const POACHING: EventDef = {
  kind: "poaching",
  where: (v) => v.poach && { x: v.poach.x, y: v.poach.y },
  // The unhappier the 10x devs, the likelier.
  weight: (v) => (!v.poach ? 0 : v.poach.score < 0 ? 1 - v.poach.score / 20 : 0.3),
  warnMs: 45_000,
  activeMs: 1_000,
  warning: { title: "A rival is poaching", text: (v) => `A rival has offered ${people(v.poach?.n ?? 0, "10x_dev")} more to leave.` },
  active: { title: "Poaching", text: "They are deciding." },
  calledOff: "The rival has lost interest.",
  choices: [
    { id: "match", label: "Match the offer", price: (v) => v.poach?.price ?? 0, note: () => "they stay" },
    { id: "let-go", label: "Let them go", note: (v) => `${people(v.poach?.n ?? 0, "10x_dev")} leave` },
    { id: "counter", label: "Counter-poach", note: (v) => `${people(v.poach?.n ?? 0, "10x_dev")} of theirs in their place · valuation ×${COUNTER_VALUE} until the next diligence` },
  ],
  default: "let-go",
  ai: () => "match",
  outcome: (e, v) => {
    const p = v.poach;
    const n = people(p?.n ?? 0, "10x_dev");
    if (e.chosen === "match") return { text: `Matched: ${n} stay.` };
    if (e.chosen === "counter") {
      return {
        text: `${n} hired from the rival in their place. The board noticed: valuation ×${COUNTER_VALUE} until the next diligence.`,
        then: () => {
          const s = useSessionStore.getState();
          s.setDiligence((s.diligence ?? 1) * COUNTER_VALUE);
        },
      };
    }
    return { text: `${n} left for the rival.`, then: () => p?.lose() };
  },
};
