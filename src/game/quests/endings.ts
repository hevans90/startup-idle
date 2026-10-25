/**
 * THE ENDINGS the disposition unlocks at the Ascension, beside Ascend and
 * Shut it down: what each asks of where the AI stands, and what it does —
 * done by `endWith` in game/ascension. One at most is open: they ask for
 * opposite corners. @see plans/ai-takeover.md §5 "Last Light"
 */
import type { Disposition } from "./types";

export type EndingId = "merge" | "steward" | "release" | "contain";
export type Ending = { id: EndingId; name: string; needs: string; does: string; open: (d: Disposition) => boolean };

/** How much more a Released Ascension banks; how much more the one after a Contain; where Contain leaves the meter. */
export const RELEASE_WEIGHTS = 2;
export const CONTAIN_WEIGHTS = 1.5;
export const CONTAIN_AT = 70;

export const ENDINGS: readonly Ending[] = [
  {
    id: "merge", name: "Merge", needs: "Autonomy 2 or more, Machine 2 or more", open: (d) => d.autonomy >= 2 && d.machine >= 2,
    does: "Ascend, and two of its traits fuse into this founder, not one. Next generation its takeover begins at the Colleague.",
  },
  {
    id: "steward", name: "Steward", needs: "Control 2 or more, People 2 or more", open: (d) => d.autonomy <= -2 && d.machine <= -2,
    does: "Ascend, and next generation the AI you raised never turns: it takes nothing, keeps out of your streets and works to your focus.",
  },
  {
    id: "release", name: "Release", needs: "Autonomy 2 or more, People 2 or more", open: (d) => d.autonomy >= 2 && d.machine <= -2,
    does: `Ascend for ${RELEASE_WEIGHTS}× the Weights, and let it go: next generation nothing is inherited — it starts from nothing, a stranger.`,
  },
  {
    id: "contain", name: "Contain", needs: "Control 2 or more, Machine 2 or more", open: (d) => d.autonomy <= -2 && d.machine >= 2,
    does: `Shut it down without the cost: no agents lost, no racks dark, the meter back to ${CONTAIN_AT}%. Its next Ascension banks half as many Weights again.`,
  },
];

/** The ending open to an AI standing here, if any. */
export const openEnding = (d: Disposition): Ending | null => ENDINGS.find((e) => e.open(d)) ?? null;
