/**
 * World v2 — THE CLOUDS' NOISE: one block of it, the same at every side so it repeats without a seam, made a row
 * at a time so no frame waits for it. @see ./clouds
 *
 * Four noises a point, a byte each:
 * - r: the cloud's SHAPE — a smooth noise heaped into billows (round lumps, by the nearest of scattered points);
 * - g: finer billows, to wear its edges away;
 * - b: a slow smooth noise, for where the sky is clear and where it is crowded;
 * - a: the finest billows, for wisps.
 */

/** Its side, points. */
export const NOISE_N = 64;

const hash3 = (x: number, y: number, z: number, salt: number) => {
  let h = Math.imul(x, 0x8da6b343) ^ Math.imul(y, 0xd8163841) ^ Math.imul(z, 0xcb1ab31f) ^ salt;
  h = Math.imul(h ^ (h >>> 13), 0x5bd1e995); h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
};
const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);

/** A smooth noise repeating every `period` cells, 0–1. */
function smoothNoise(x: number, y: number, z: number, period: number, salt: number): number {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z), fx = x - xi, fy = y - yi, fz = z - zi;
  const u = fade(fx), v = fade(fy), w = fade(fz);
  let sum = 0;
  for (let c = 0; c < 8; c++) {
    const dx = c & 1, dy = (c >> 1) & 1, dz = c >> 2;
    const px = (xi + dx) % period, py = (yi + dy) % period, pz = (zi + dz) % period;
    // A slope at each corner, by its hash.
    const a = hash3(px, py, pz, salt) * Math.PI * 2, b = hash3(px, py, pz, salt + 1) * 2 - 1, s = Math.sqrt(1 - b * b);
    const g = Math.cos(a) * s * (fx - dx) + Math.sin(a) * s * (fy - dy) + b * (fz - dz);
    sum += g * (dx ? u : 1 - u) * (dy ? v : 1 - v) * (dz ? w : 1 - w);
  }
  return Math.max(0, Math.min(1, 0.5 + sum * 0.9));
}

/** Scattered points, one a cell, for a block of `period` cells a side. */
const scatters = new Map<number, Float32Array>();
function scatter(period: number, salt: number): Float32Array {
  const key = period * 65536 + salt;
  let s = scatters.get(key);
  if (!s) {
    s = new Float32Array(period * period * period * 3);
    for (let z = 0, o = 0; z < period; z++) for (let y = 0; y < period; y++) for (let x = 0; x < period; x++, o += 3) {
      s[o] = hash3(x, y, z, salt); s[o + 1] = hash3(x, y, z, salt + 7); s[o + 2] = hash3(x, y, z, salt + 13);
    }
    scatters.set(key, s);
  }
  return s;
}
/** Billows repeating every `period` cells: 1 at a scattered point, falling to 0 a cell from the nearest. */
function billow(x: number, y: number, z: number, period: number, salt: number): number {
  const s = scatter(period, salt), xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  let best = 9;
  for (let dz = -1; dz <= 1; dz++) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    const cx = xi + dx, cy = yi + dy, cz = zi + dz;
    const o = ((((cz % period) + period) % period) * period + (((cy % period) + period) % period)) * period * 3 + (((cx % period) + period) % period) * 3;
    const ex = cx + s[o] - x, ey = cy + s[o + 1] - y, ez = cz + s[o + 2] - z, d = ex * ex + ey * ey + ez * ez;
    if (d < best) best = d;
  }
  return 1 - Math.min(1, Math.sqrt(best));
}

/** One row of the block (`y`, `z`), written to `out` at `o`: four bytes a point. */
export function noiseRow(y: number, z: number, out: Uint8Array, o: number): void {
  const N = NOISE_N;
  for (let x = 0; x < N; x++, o += 4) {
    const at = (period: number) => [(x + 0.5) / N * period, (y + 0.5) / N * period, (z + 0.5) / N * period] as const;
    const sm = (period: number, salt: number) => { const [a, b, c] = at(period); return smoothNoise(a, b, c, period, salt); };
    const bi = (period: number, salt: number) => { const [a, b, c] = at(period); return billow(a, b, c, period, salt); };
    const smooth = sm(4, 11) * 0.55 + sm(8, 23) * 0.3 + sm(16, 37) * 0.15;
    const lumps = bi(4, 41) * 0.6 + bi(8, 53) * 0.28 + bi(16, 67) * 0.12;
    const shape = Math.max(0, Math.min(1, smooth * 0.62 + lumps * 0.72 - 0.16));
    const fine = bi(8, 71) * 0.55 + bi(16, 83) * 0.3 + bi(32, 97) * 0.15;
    const slow = sm(2, 101) * 0.65 + sm(4, 113) * 0.35;
    const wisp = bi(16, 127) * 0.6 + bi(32, 131) * 0.4;
    out[o] = Math.round(shape * 255); out[o + 1] = Math.round(fine * 255); out[o + 2] = Math.round(slow * 255); out[o + 3] = Math.round(wisp * 255);
  }
}
