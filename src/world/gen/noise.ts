/**
 * Value noise, and the octaves that turn it into terrain.
 *
 * WRITTEN OUT RATHER THAN DEPENDED ON. This is thirty lines; a noise library is
 * a package, a bundle entry and a version to keep. What the map needs is smooth
 * pseudo-random height that is the same every time for the same seed, and value
 * noise gives that. Simplex would be faster and slightly less grid-aligned, and
 * neither matters at sixty-four tiles.
 *
 * DETERMINISTIC BY CONSTRUCTION. There is no state and no `Math.random` — the
 * value at a lattice point is a pure hash of its integer coordinates and the
 * seed, so the same seed gives the same landscape on any machine, and a map can
 * be stored as a number.
 */

/** A lattice point's value in `[0, 1)`, hashed from its coordinates. */
function at(seed: number, ix: number, iy: number): number {
  let h = (Math.imul(ix, 0x27d4eb2d) ^ Math.imul(iy, 0x165667b1) ^ seed) | 0;
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
  return ((h ^ (h >>> 15)) >>> 0) / 4294967296;
}

/**
 * Smoothstep, so the lattice does not show.
 *
 * Linear interpolation between lattice points leaves visible creases along
 * every integer line — the derivative jumps there. This one's first derivative
 * is zero at both ends, so the joins disappear.
 */
const ease = (t: number) => t * t * (3 - 2 * t);

/** Smooth noise in `[0, 1)` at any real coordinate. */
export function valueNoise(seed: number, x: number, y: number): number {
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = ease(x - ix), fy = ease(y - iy);
  const a = at(seed, ix, iy), b = at(seed, ix + 1, iy);
  const c = at(seed, ix, iy + 1), d = at(seed, ix + 1, iy + 1);
  const top = a + (b - a) * fx;
  const bot = c + (d - c) * fx;
  return top + (bot - top) * fy;
}

/**
 * Several octaves of it, which is what makes a landscape rather than blobs.
 *
 * Each octave is twice the frequency and half the amplitude of the last: the
 * first gives the broad shape of the land, the last gives the texture on it.
 * Normalised by the total amplitude so the result stays in `[0, 1)` however
 * many octaves are asked for — otherwise adding one would quietly change the
 * scale of every map.
 */
export function fbm(
  seed: number, x: number, y: number, octaves = 4, gain = 0.5,
): number {
  let sum = 0, amp = 1, total = 0, fx = x, fy = y;
  for (let o = 0; o < octaves; o++) {
    // A different seed per octave, or every octave would repeat the same
    // pattern at a different size and the result would look self-similar in
    // an obviously artificial way.
    sum += valueNoise(seed + o * 0x9e3779b9, fx, fy) * amp;
    total += amp;
    amp *= gain;
    fx *= 2;
    fy *= 2;
  }
  return sum / total;
}
