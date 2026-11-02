/**
 * THE CULTURE DECK, AS THE MAP'S SYSTEMS READ IT: what the slotted cards do,
 * now, from wherever desks, beds, commutes, moods, leaders, builds and slop
 * are worked out — without those pure modules reaching for the store. The
 * store registers its deck; nothing registered, no cards. Each answer kept
 * till the deck changes; `cultureVersion` tells caches when it has.
 * @see game/culture, setDeckReader
 */
import type { GeneratorId } from "../state/generators.store";
import { cultureEffects, emptyDeck, type CultureEffects, type Deck } from "./culture";

/** No cards: the one empty deck, so it reads as unchanged. */
const NONE = emptyDeck();
let read: () => Deck = () => NONE;
let last: Deck | null = null;
let version = 0;
const kept = new Map<GeneratorId | "all", CultureEffects>();

/** The store's deck, for the rest to read. Returns the undo: the reader before it, back. */
export function setDeckReader(r: () => Deck): () => void {
  const before = read;
  read = r;
  return () => { read = before; };
}

function sync(): void {
  const d = read();
  if (d === last) return;
  last = d;
  version++;
  kept.clear();
}

/** What the cards do to a kind now — or, with none, to the whole company. */
export function cultureNow(kind?: GeneratorId): CultureEffects {
  sync();
  const key = kind ?? "all";
  let e = kept.get(key);
  if (!e) kept.set(key, (e = cultureEffects(last!, kind)));
  return e;
}

/** A number that changes whenever the deck does: for what caches against it. */
export const cultureVersion = (): number => { sync(); return version; };
