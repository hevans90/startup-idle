/**
 * THE CULTURE DECK, AS THE MAP'S SYSTEMS READ IT: what the slotted cards do,
 * now, from wherever desks, beds, commutes, moods, leaders, builds and slop
 * are worked out — without those pure modules reaching for the store. The
 * store registers its deck; nothing registered, no cards. Each answer kept
 * till the deck changes; `cultureVersion` tells caches when it has.
 * @see game/culture, setDeckReader
 */
import type { GeneratorId } from "../state/generators.store";
import { cultureEffects, emptyDeck, type CardEffects, type CultureEffects, type Deck } from "./culture";
import { conditionEffects, conditionsVersion } from "./conditions";

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

/** THE ACQUISITION TREE'S TOWN NODES: what holds under the cards, whatever is slotted. */
const NO_TOWN: readonly CardEffects[] = [];
let readTown: () => readonly CardEffects[] = () => NO_TOWN;
let lastTown: readonly CardEffects[] = NO_TOWN;
/** The conditions events left, as they stood at the last look. @see game/conditions */
let lastConditions = -1;

/** The prestige store's town effects, for the rest to read. Returns the undo. @see PrestigeModifiers.town */
export function setTownReader(r: () => readonly CardEffects[]): () => void {
  const before = readTown;
  readTown = r;
  return () => { readTown = before; };
}

function sync(): void {
  const d = read(), town = readTown(), c = conditionsVersion();
  if (d === last && town === lastTown && c === lastConditions) return;
  last = d;
  lastTown = town;
  lastConditions = c;
  version++;
  kept.clear();
}

/** What the cards, and the tree's town nodes and events' conditions under them, do to a kind now — or, with none, to the whole company. */
export function cultureNow(kind?: GeneratorId): CultureEffects {
  sync();
  const key = kind ?? "all";
  let e = kept.get(key);
  if (!e) {
    const held = conditionEffects(kind);
    kept.set(key, (e = cultureEffects(last!, kind, held.length ? [...lastTown, ...held] : lastTown)));
  }
  return e;
}

/** A number that changes whenever the deck does: for what caches against it. */
export const cultureVersion = (): number => { sync(); return version; };
