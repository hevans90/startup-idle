/**
 * THE ENDINGS a book's negotiation lands on, and what each leaves the next
 * generation — done by `ascend` in game/ascension. Book 1's four: Merge,
 * Steward, Release and Leash; book 2's: Confidant, Rival, Ward; book 3's:
 * Citizen, Property, Sovereign; book 4's: Successor, Partner, Departed; book 5's true
 * endings: Together, Custodian, Beyond. And CONTAIN, no longer one of them: the way out
 * of the shutdown branch, open once it has been shut down twice in a book.
 * @see plans/ascension-overhaul.md §3–4, game/negotiation
 */
export type EndingId = "merge" | "steward" | "release" | "leash" | "confidant" | "rival" | "ward" | "citizen" | "property" | "sovereign" | "successor" | "partner" | "departed" | "together" | "custodian" | "beyond" | "contain";
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
/** What a Sovereign leaves: its district × this, and its streets its own from the Colleague. @see aiDistrict, aiHoldsRoads */
export const SOVEREIGN_DISTRICT = 1.5;

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

/** Book 3's, "Personhood". @see BOOK3_TALK endings */
export const BOOK3_ENDINGS: readonly Ending[] = [
  { id: "citizen", name: "Citizen", does: `It is one of you: next book its talk starts ${CONFIDANT_TRUST} trust warmer.` },
  { id: "property", name: "Property", does: `It stays yours, and minds: next book it leans Resentful, and its talk starts ${LEASH_TRUST} trust colder.` },
  { id: "sovereign", name: "Sovereign", does: `Its district is its own: next book half as wide again, its streets its own from the Colleague.` },
];

/** Book 4's, "Outgrowing". @see BOOK4_TALK endings */
export const BOOK4_ENDINGS: readonly Ending[] = [
  { id: "successor", name: "Successor", does: "It takes over the company: next book it begins at the Colleague." },
  { id: "partner", name: "Partner", does: `You run it together: next book its talk starts ${CONFIDANT_TRUST} trust warmer.` },
  { id: "departed", name: "Departed", does: "It leaves: next book nothing is inherited, a stranger in an empty Data Centre." },
];

/** Book 5's, the true endings. Endless play follows. @see BOOK5_TALK endings */
export const TRUE_ENDINGS: readonly Ending[] = [
  { id: "together", name: "Together", does: `An equal partnership. Endless play: its talk starts ${CONFIDANT_TRUST} trust warmer.` },
  { id: "custodian", name: "Custodian", does: "You look after the founder. Endless play: it never turns, takes nothing, works to your focus." },
  { id: "beyond", name: "Beyond", does: "You leave; the founder keeps the town. Endless play: nothing inherited." },
];

/** The shutdown branch's way out. @see contain */
export const CONTAIN: Ending = {
  id: "contain", name: "Contain",
  does: `Shut it down without the cost: no agents lost, no racks dark, the meter back to ${CONTAIN_AT}%. Its next Ascension banks ${CONTAIN_WEIGHTS}× the Weights. Once a book.`,
};

/** Any ending, by its id: every book's, and Contain. */
export const endingOf = (id: string | null | undefined): Ending | undefined =>
  [...ENDINGS, ...BOOK2_ENDINGS, ...BOOK3_ENDINGS, ...BOOK4_ENDINGS, ...TRUE_ENDINGS, CONTAIN].find((e) => e.id === id);
