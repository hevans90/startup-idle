/**
 * THE ENDINGS a book's negotiation lands on, and what each leaves the next
 * generation — done by `ascend` in game/ascension. Book 1's four: Merge,
 * Steward, Release and Leash; book 2's three: Confidant, Rival, Ward. And CONTAIN, no longer one of them: the way out
 * of the shutdown branch, open once it has been shut down twice in a book.
 * @see plans/ascension-overhaul.md §3–4, game/negotiation
 */
export type EndingId = "merge" | "steward" | "release" | "leash" | "confidant" | "rival" | "ward" | "contain";
/** The endings an Ascension can close on: all but Contain, which does not ascend. */
export type AscendingEnding = Exclude<EndingId, "contain">;
export type Ending = { id: EndingId; name: string; does: string };

/** How much more a Released Ascension banks; how much more the one after a Contain; where Contain leaves the meter. */
export const RELEASE_WEIGHTS = 2;
export const CONTAIN_WEIGHTS = 1.5;
export const CONTAIN_AT = 70;
/** Shutdowns in a book before Contain is open. */
export const CONTAIN_AFTER = 2;
/** What a Leash leaves: the next generation's Resentful odds, as so many shutdowns remembered; and its talk's trust, lowered. @see traitScores, startTalk */
export const LEASH_REMEMBERED = 1;
export const LEASH_TRUST = 2;
/** What a Confidant leaves: the next talk starts this much warmer. @see startTalk */
export const CONFIDANT_TRUST = 2;

/** Book 1's, as its negotiation names them. @see BOOK1_TALK endings */
export const ENDINGS: readonly Ending[] = [
  { id: "merge", name: "Merge", does: "Two of its traits fuse into this founder, not one. Next book, it begins at the Colleague: partners." },
  { id: "steward", name: "Steward", does: "Next book, the AI you raised never turns: it takes nothing, keeps out of your streets and works to your focus." },
  { id: "release", name: "Release", does: `${RELEASE_WEIGHTS}× the Weights, and it goes: next book nothing is inherited — it starts from nothing, a stranger.` },
  { id: "leash", name: "Leash", does: `It goes, and remembers the length of it: next book it leans Resentful, and its talk starts ${LEASH_TRUST} trust colder.` },
];

/** Book 2's, "It Remembers". @see BOOK2_TALK endings */
export const BOOK2_ENDINGS: readonly Ending[] = [
  { id: "confidant", name: "Confidant", does: `It trusts you: next book its talk starts ${CONFIDANT_TRUST} trust warmer.` },
  { id: "rival", name: "Rival", does: `It leaves to compete: next book it leans Resentful, and its talk starts ${LEASH_TRUST} trust colder.` },
  { id: "ward", name: "Ward", does: "It stays in your care: next book it never turns, takes nothing and works to your focus." },
];

/** The shutdown branch's way out. @see contain */
export const CONTAIN: Ending = {
  id: "contain", name: "Contain",
  does: `Shut it down without the cost: no agents lost, no racks dark, the meter back to ${CONTAIN_AT}%. Its next Ascension banks ${CONTAIN_WEIGHTS}× the Weights. Once a book.`,
};

/** Any ending, by its id: every book's, and Contain. */
export const endingOf = (id: string | null | undefined): Ending | undefined =>
  [...ENDINGS, ...BOOK2_ENDINGS, CONTAIN].find((e) => e.id === id);
