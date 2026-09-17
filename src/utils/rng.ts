/**
 * Deterministic pseudo-randomness.
 *
 * Every "random" thing the game generates has to come back the same way on the
 * next load — a skill tree that rearranged itself on reload would be a bug, and
 * so would a map. So nothing here uses `Math.random`: a generator is a pure
 * function of its seed, and the seed is what gets stored.
 *
 * `game/skill-tree` carries its own copy of the same function, deliberately.
 * That file has NO imports at all — it is a self-contained model — and the two
 * generators never interact: they seed separately, produce separately, and
 * nothing compares them. A shared constant that must AGREE is worth an import;
 * a published algorithm used twice independently is not worth making a
 * dependency-free file depend on something.
 */

/**
 * Mulberry32 — small, fast, and good enough for layout.
 *
 * Not for anything that needs to resist prediction; this is scenery. What it
 * does guarantee is that the same seed gives the same sequence, on every engine
 * and every reload, which is the whole requirement.
 */
export const mulberry32 = (a: number) => () => {
  a |= 0;
  a = (a + 0x6d2b79f5) | 0;
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

/** A stream of numbers in `[0, 1)`. @see mulberry32 */
export type Rng = () => number;

/**
 * A seed from a string, so a name can drive a layout.
 *
 * FNV-1a, 32 bit. Any spread will do — the PRNG does the mixing; this only has
 * to turn text into a number that differs when the text does.
 */
export function seedFrom(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}
