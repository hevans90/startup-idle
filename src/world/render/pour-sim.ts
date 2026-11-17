/**
 * World v2 — SOMETHING ACTUALLY POURED. Not a picture of a pour: grains let
 * go at a lip, each falling under gravity on its own arc, landing on
 * whatever has landed before it and adding to it — and the heap they make
 * slumping, grain by grain, until no side of it is steeper than the stuff
 * will stand.
 *
 *  - A GRAIN is a point with a velocity. It leaves the lip going the way the
 *    chute throws it, falls, and where it meets the heap's surface it stops
 *    and becomes heap — or, a hard one landing fast, skips off once first.
 *  - THE HEAP is a row of columns across where it lands, each as high as
 *    what has landed in it. After every step it AVALANCHES: wherever one
 *    column stands over its neighbour by more than the ANGLE OF REST, the
 *    difference runs down. Earth stands steep; stone a little less;
 *    blacktop hardly at all — it pools.
 *  - WALLS hold it where there are any: a lorry's body, a hopper. On open
 *    ground it spreads.
 *  - It is TAKEN AWAY as fast as its job says: a hopper feeds a screed, a
 *    blade spreads a windrow. A lorry's load just grows.
 *
 * In the screen's own plane — across and down — in pixels at the map's own
 * scale; pure, no drawing here. @see render/road-plant (who pours, and draws)
 */

/** Gravity, pixels a second a second at the map's scale: 9.8 m/s² at about seven pixels a metre. */
export const GRAVITY = 70;
/** How wide a column of the heap is, pixels. */
export const COLUMN = 1.5;

export type PourKind = {
  /** How steep it stands: rise over run. */
  rest: number;
  /** A grain's size, pixels across; and how much they differ. */
  grain: number;
  /** Grains a second while it pours. */
  rate: number;
  /** How often a grain landing skips off once, nought to one. */
  skip: number;
  /** How much each grain's start is scattered: across the lip, and in its speed. */
  scatter: number;
};
/** Earth: steep, cloddy. Stone: a little less steep, small and hard, skipping. Blacktop: thick, no skip, all but level. Concrete: wet, as near level. */
export const POURS = {
  earth: { rest: 0.85, grain: 1.7, rate: 150, skip: 0.12, scatter: 1 },
  stone: { rest: 0.7, grain: 1.25, rate: 210, skip: 0.35, scatter: 1 },
  tar: { rest: 0.06, grain: 2.3, rate: 110, skip: 0, scatter: 0.25 },
  concrete: { rest: 0.1, grain: 2.0, rate: 130, skip: 0, scatter: 0.3 },
} satisfies Record<string, PourKind>;

/** Floats a grain: x, y, vx, vy, its tone (nought to one), and whether it has skipped. */
const WORDS = 6;

export type PourSim = {
  kind: PourKind;
  /** The grains in the air, packed; and how many. */
  grains: Float32Array;
  n: number;
  /** The heap: how high each column stands over where it lands, pixels; the middle column under the landing. */
  heap: Float32Array;
  /** Where it lands from the lip: across, and how far down. */
  dx: number;
  drop: number;
  /** How far either side of the landing the heap may reach: a wall beyond it. Infinity, open ground. */
  wall: number;
  /**
   * How the ground under the heap runs on the screen: down, for each pixel across. A road seen from above and
   * aside runs aslant, and what is laid along it lies along that slant. Nought for what lands in something.
   */
  base: number;
  /** How far the heap's columns have been moved along under the lip, columns: so each keeps its own grain. @see carry */
  moved: number;
  /** A grain owed: the part of one not yet let go. */
  owed: number;
  seed: number;
};

export function createPourSim(kind: PourKind, wall = Infinity, columns = 41): PourSim {
  return { kind, grains: new Float32Array(600 * WORDS), n: 0, heap: new Float32Array(columns), dx: 0, drop: 10, wall, base: 0, moved: 0, owed: 0, seed: 0x9e3779b9 };
}
const rnd = (s: PourSim) => { s.seed = (Math.imul(s.seed, 1664525) + 1013904223) >>> 0; return s.seed / 4294967296; };
/** The column over a place across from the lip. */
const columnAt = (s: PourSim, x: number) => Math.max(0, Math.min(s.heap.length - 1, Math.round((x - s.dx) / COLUMN) + (s.heap.length >> 1)));
/**
 * THE LIP HAS MOVED ON by so many pixels across: what is heaped STAYS WHERE IT FELL. The heap's columns are a
 * window under the landing, and the window moves with it — so the heap is slid back through it the other way, and
 * what passes out of its end is left behind and gone from the count.
 */
export function carry(s: PourSim, across: number): void {
  const k = Math.round(across / COLUMN);
  if (!k) return;
  const n = s.heap.length, old = s.heap.slice();
  for (let i = 0; i < n; i++) { const from = i + k; s.heap[i] = from >= 0 && from < n ? old[from] : 0; }
  s.moved += k;
}
/** Where the ground is under a place across from the lip, pixels down from it. */
export const groundAt = (s: PourSim, x: number) => s.drop + (x - s.dx) * s.base;
/** How much is heaped, pixels squared. */
export const heaped = (s: PourSim) => s.heap.reduce((n, h) => n + h, 0) * COLUMN;

/** How a pour is run: how many grains a second (its kind's, unless said); how much of each grain stays as heap — a grain drawn stands for less than it looks; and the share of the heap taken away a second. */
export type PourRun = { rate?: number; gain?: number; drain?: number };

/**
 * A STEP: grains let go while it `pours`, `width` across at the lip, to land `dx` across and `drop` down; every
 * grain moved; those that meet the heap made part of it; the heap slumped; a share of it taken away. What landed
 * this step, pixels squared.
 */
export function stepPour(s: PourSim, dt: number, pours: boolean, width: number, run: PourRun = {}): number {
  const K = s.kind, g = s.grains, mid = s.heap.length >> 1, gain = run.gain ?? 1, drain = run.drain ?? 0;
  // LET GO: thrown so as to land where it is aimed — across at a steady rate, the time the fall takes.
  if (pours) {
    const fall = Math.sqrt((2 * Math.max(1, s.drop)) / GRAVITY), vx = s.dx / fall;
    for (s.owed += (run.rate ?? K.rate) * dt; s.owed >= 1 && s.n < g.length / WORDS; s.owed--) {
      const o = s.n++ * WORDS;
      g[o] = (rnd(s) - 0.5) * width; g[o + 1] = -rnd(s) * 1.5;
      g[o + 2] = vx + (rnd(s) - 0.5) * 9 * K.scatter; g[o + 3] = (rnd(s) - 0.3) * 8 * K.scatter;
      g[o + 4] = rnd(s); g[o + 5] = 0;
    }
    if (s.owed > 1) s.owed = 1;
  }
  let landed = 0;
  const area = K.grain * K.grain * 0.8 * gain;
  for (let k = 0; k < s.n; k++) {
    const o = k * WORDS;
    g[o + 3] += GRAVITY * dt;
    g[o] += g[o + 2] * dt; g[o + 1] += g[o + 3] * dt;
    // A wall turns it back.
    if (Math.abs(g[o] - s.dx) > s.wall) { g[o] = s.dx + Math.sign(g[o] - s.dx) * s.wall; g[o + 2] *= -0.3; }
    const c = columnAt(s, g[o]), top = groundAt(s, g[o]) - s.heap[c];
    if (g[o + 1] < top) continue;
    // IT HAS MET THE HEAP. A hard grain landing fast skips off, once, the way the slope under it throws it.
    if (!g[o + 5] && rnd(s) < K.skip) {
      const slope = (s.heap[Math.min(s.heap.length - 1, c + 1)] - s.heap[Math.max(0, c - 1)]) / (2 * COLUMN);
      g[o + 1] = top - 0.2; g[o + 3] = -Math.abs(g[o + 3]) * (0.25 + 0.2 * rnd(s));
      g[o + 2] = g[o + 2] * 0.4 - slope * 14 + (rnd(s) - 0.5) * 26;
      g[o + 5] = 1;
      continue;
    }
    s.heap[c] += area / COLUMN;
    landed += area;
    // Gone from the air: the last grain takes its place.
    const last = --s.n * WORDS;
    if (last !== o) for (let q = 0; q < WORDS; q++) g[o + q] = g[last + q];
    k--;
  }
  // THE HEAP SLUMPS: wherever it is steeper than it will stand, the excess runs down — a few passes, each way.
  const most = K.rest * COLUMN, edge = Number.isFinite(s.wall) ? Math.max(1, Math.min(mid, Math.round(s.wall / COLUMN))) : mid;
  for (let pass = 0; pass < 12; pass++) {
    for (let step = 0; step < 2; step++) {
      for (let q = 0; q < s.heap.length - 1; q++) {
        const i = step ? s.heap.length - 2 - q : q, d = s.heap[i] - s.heap[i + 1];
        if (Math.abs(d) <= most) continue;
        const move = (Math.abs(d) - most) * 0.5 * Math.sign(d);
        s.heap[i] -= move; s.heap[i + 1] += move;
      }
    }
  }
  // Beyond a wall there is nothing: what slumped there comes back in against it. On open ground the far ends let it go.
  if (Number.isFinite(s.wall)) {
    for (let i = 0; i < mid - edge; i++) { s.heap[mid - edge] += s.heap[i]; s.heap[i] = 0; }
    for (let i = s.heap.length - 1; i > mid + edge; i--) { s.heap[mid + edge] += s.heap[i]; s.heap[i] = 0; }
  } else { s.heap[0] *= 0.5; s.heap[s.heap.length - 1] *= 0.5; }
  // TAKEN AWAY: a share of the whole of it, so the high parts most.
  if (drain > 0) { const keep = Math.max(0, 1 - drain * dt); for (let i = 0; i < s.heap.length; i++) s.heap[i] *= keep; }
  return landed;
}

/** Empty it: a lorry gone with its load. */
export function clearPour(s: PourSim): void { s.heap.fill(0); s.n = 0; }

/** Each column of the heap that has anything in it: where it is across from the lip, the ground under it, how high it stands, and which column of the ground it is — the same number wherever the lip has got to. */
export function eachColumn(s: PourSim, f: (x: number, ground: number, high: number, id: number) => void): void {
  const mid = s.heap.length >> 1;
  for (let i = 0; i < s.heap.length; i++) if (s.heap[i] > 0.2) { const x = s.dx + (i - mid) * COLUMN; f(x, groundAt(s, x), s.heap[i], i + s.moved); }
}

/** Each grain in the air: where it is from the lip, and its tone. */
export function eachGrain(s: PourSim, f: (x: number, y: number, tone: number) => void): void {
  for (let k = 0; k < s.n; k++) f(s.grains[k * WORDS], s.grains[k * WORDS + 1], s.grains[k * WORDS + 4]);
}
