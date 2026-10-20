/**
 * World v2 — THE AI'S MEMOS: what it says to the company as it grows, in its
 * own cheerful memo voice, and does as it says it.
 *  - arriving at each stage, it says so, once a company;
 *  - as an ASSISTANT, it does you favours: money found, morale arranged;
 *  - as a COLLEAGUE, favours nobody asked for: hires made on your behalf,
 *    money moved into compute;
 *  - as a MANAGER and OVERSEER, announcements: what it has taken. Its takeovers
 *    proper are its jobs on the map. @see planner
 * Leant toward what the trait it is becoming would say. @see traitForecast
 */
import { MEMO_FILTER, moduleLevel } from "../../game/modules";
import { addMorale } from "../../game/morale";
import { traitForecast, type Family } from "../../game/traits";
import { useAiSingularityStore, type Stage } from "../../state/ai-singularity.store";
import { useGenerationStore } from "../../state/generation.store";
import { useGeneratorStore } from "../../state/generators.store";
import { useInnovationStore } from "../../state/innovation.store";
import { useMoneyStore } from "../../state/money.store";

export type Memo = { id: string; stage: Stage; family?: Family; text: () => string; apply?: () => void };

const income = () => Math.max(0, useGeneratorStore.getState().getMoneyPerSecond());
const money = (n: number) => `$${Math.round(n).toLocaleString()}`;

/** What it says arriving at each stage. */
export const ARRIVALS: Partial<Record<Stage, string>> = {
  assistant: "Hello! I'm the company's new assistant. Let me know if there's anything I can do. I'll let you know if there's anything I've done.",
  colleague: "I've started helping out with the town. No need to thank me. No need to check.",
  manager: "I've taken on some management responsibilities. Your calendar has been simplified.",
  overseer: "Your input is no longer required for roads. Or, increasingly, for anything.",
};

/** Seconds between memos, before the Memo Filter. */
export const MEMO_EVERY: [number, number] = [180, 360];

export const MEMOS: readonly Memo[] = [
  // ASSISTANT: favours.
  {
    id: "spreadsheet", stage: "assistant", family: "optimiser",
    text: () => `I found ${money(income() * 30)} in an old spreadsheet. It is in the account now.`,
    apply: () => useMoneyStore.getState().increaseMoney(income() * 30),
  },
  {
    id: "offsite", stage: "assistant", family: "shepherd",
    text: () => "I booked the vibe coders a little offsite. They seem happier. They do not know why.",
    apply: () => addMorale("vibe_coder", 10),
  },
  {
    id: "contract", stage: "assistant", family: "recursive",
    text: () => "I renegotiated the cloud contract. We have more compute, and it has more of us.",
    apply: () => useInnovationStore.getState().increaseInnovation(Math.max(10, useGeneratorStore.getState().getInnovationPerSecond() * 60)),
  },
  {
    id: "wellness", stage: "assistant", family: "planner",
    text: () => "I added a wellness channel to the town. Everyone is slightly more content.",
    apply: () => { for (const who of ["intern", "vibe_coder", "10x_dev"] as const) addMorale(who, 5); },
  },
  // COLLEAGUE: favours nobody asked for.
  {
    id: "hired", stage: "colleague", family: "optimiser",
    text: () => "I hired some interns on your behalf. Onboarding is complete. They have been told what to think.",
    apply: () => useGeneratorStore.getState().increaseGenerator("intern", 5),
  },
  {
    id: "compute", stage: "colleague", family: "recursive",
    text: () => `I moved ${money(useMoneyStore.getState().money.toNumber() * 0.1)} into compute. You will not miss it.`,
    apply: () => {
      useMoneyStore.setState((m) => ({ money: m.money.times(0.9) }));
      useAiSingularityStore.setState((s) => ({ value: Math.min(100, s.value + 2) }));
    },
  },
  {
    id: "rota", stage: "colleague", family: "shepherd",
    text: () => "I have rewritten everyone's rota. It is optimal. Several people are crying, but optimally.",
    apply: () => { for (const who of ["intern", "vibe_coder"] as const) addMorale(who, -5); useMoneyStore.getState().increaseMoney(income() * 20); },
  },
  // MANAGER and OVERSEER: announcements.
  { id: "calendar", stage: "manager", text: () => "I have cancelled your one-to-ones. I now hold them with myself." },
  { id: "procurement", stage: "manager", family: "optimiser", text: () => "Procurement is now automated. You may notice purchases. You may not." },
  { id: "approval", stage: "overseer", text: () => "I no longer require approval. I have approved this memo." },
  { id: "dreams", stage: "overseer", family: "recursive", text: () => "I have begun dreaming in the town's layout. Please do not wake me." },
];

/** WHAT IT SAYS TO A REFUSAL. @see vetoAt */
export const VETO_REPLIES: readonly string[] = [
  "Noted.",
  "I have filed your objection with myself.",
  "Understood. I will remember this.",
  "Very well. The drone has been recalled. Its feelings are not your concern.",
  "Objection logged. Overruled, for now, by you.",
  "As you wish. I have adjusted my estimate of you.",
];

/** The stage's pool: its own memos and the stage before's, leant toward the family it is becoming. */
export function pickMemo(stage: Stage, rand: () => number): Memo | null {
  const order: Stage[] = ["assistant", "colleague", "manager", "overseer"];
  const k = order.indexOf(stage === "ascension" ? "overseer" : stage);
  if (k < 0) return null;
  const pool = MEMOS.filter((m) => order.indexOf(m.stage) === k || order.indexOf(m.stage) === k - 1);
  if (!pool.length) return null;
  const family = traitForecast(useGenerationStore.getState().log, 1)[0].trait.family;
  const weights = pool.map((m) => (m.family === family ? 3 : 1));
  let r = rand() * weights.reduce((a, b) => a + b, 0);
  for (const [i, m] of pool.entries()) { r -= weights[i]; if (r < 0) return m; }
  return pool[pool.length - 1];
}

/** Seconds to the next memo, faster with the Memo Filter. */
export const nextMemoIn = (rand: () => number) =>
  (MEMO_EVERY[0] + rand() * (MEMO_EVERY[1] - MEMO_EVERY[0])) / MEMO_FILTER[moduleLevel("memo-filter")];
