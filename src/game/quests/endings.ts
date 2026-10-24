/**
 * THE ENDINGS the disposition unlocks at the Ascension, beside Ascend and
 * Shut it down: what each asks of where the AI stands. What each does comes
 * with the finale (phase Q6); the dossier shows which are open, and what the
 * rest need. @see plans/ai-takeover.md §5 "Last Light"
 */
import type { Disposition } from "./types";

export type Ending = { id: "merge" | "steward" | "release" | "contain"; name: string; needs: string; open: (d: Disposition) => boolean };

export const ENDINGS: readonly Ending[] = [
  { id: "merge", name: "Merge", needs: "Autonomy 2 or more, Machine 2 or more", open: (d) => d.autonomy >= 2 && d.machine >= 2 },
  { id: "steward", name: "Steward", needs: "Control 2 or more, People 2 or more", open: (d) => d.autonomy <= -2 && d.machine <= -2 },
  { id: "release", name: "Release", needs: "Autonomy 2 or more, People 2 or more", open: (d) => d.autonomy >= 2 && d.machine <= -2 },
  { id: "contain", name: "Contain", needs: "Control 2 or more, Machine 2 or more", open: (d) => d.autonomy <= -2 && d.machine >= 2 },
];
