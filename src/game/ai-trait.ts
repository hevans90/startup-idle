/**
 * WHO THE AI IS, this book: the trait the last generation drew, carried in —
 * it voices the book, builds its way and opens its own options. The first
 * generation's, or a Released one's, is a stranger: what it is becoming.
 * @see plans/ascension-overhaul.md §5, Chapter.voices, Option.family
 */
import { useGenerationStore } from "../state/generation.store";
import { trait, traitForecast, type Family, type Trait } from "./traits";

export function aiTraitNow(): Trait {
  const g = useGenerationStore.getState();
  const carried = g.legacy === "release" ? undefined : g.past[g.past.length - 1]?.trait;
  return carried ? trait(carried) : traitForecast(g.log, 1)[0].trait;
}

/** The lines and options of a chapter as this AI asks it. */
export const voiceOf = (voices: Record<Family, string> | undefined, family: Family | undefined): string | undefined =>
  voices && family ? voices[family] : undefined;

/** The options open to an AI of this family, each with its place among them all. */
export const openTo = <O extends { family?: Family }>(options: readonly O[], family: Family | undefined): { o: O; i: number }[] =>
  options.map((o, i) => ({ o, i })).filter(({ o }) => !o.family || o.family === family);
