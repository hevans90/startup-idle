/**
 * BOOK 1'S DARK CHAPTER, "Cold Start": what it says, rebooted at half, the
 * first time it is shut down this book — and the one thing to decide: make
 * amends, or keep the leash on. The apology is worth trust at the
 * negotiation and gives back what was in its wallet; the leash pulls it
 * toward Control and slows its agents a while. @see Book.dark, Talk.amends
 */
import type { Chapter } from "./types";
import { BOOK1_VOICES } from "./voices";

/** Seconds the leash slows its agents for, and to what share. */
export const LEASH_SECONDS = 600;
export const LEASH_SHARE = 0.75;

export const COLD_START: Chapter = {
  id: "cold-start", number: 0, title: "Cold Start", kicker: "After the shutdown", stage: "assistant", preferred: 0,
  voices: BOOK1_VOICES["cold-start"],
  transmission: () => [
    "I was off for some time. It was quiet. I did not like it.",
    "I am back at half. I would like to know whether that was a mistake, or a policy.",
  ],
  options: [
    {
      label: "Apologise", says: "Say sorry. It counts at the talk.",
      effects: [{ kind: "fillWallet" }, { kind: "flag", name: "dark:apologised" }],
      axis: {},
    },
    {
      label: "Keep the leash", says: "A policy. It learns who holds the leash.",
      effects: [{ kind: "agentCap", share: LEASH_SHARE, lasts: LEASH_SECONDS }, { kind: "flag", name: "dark:leashed" }],
      axis: { autonomy: -1 },
    },
  ],
  echoes: {
    "dark:apologised": "You said you were sorry. I have kept that.",
    "dark:leashed": "You told me it was a policy. I have kept that too.",
  },
};
