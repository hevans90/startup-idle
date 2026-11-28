/**
 * THE YEAR, on the game's own clock: a year an hour of play, a season every quarter of it, and what each part of
 * it does to what grows — the grass's green, the flowers, the snow, and each tree's leaves. Pure: the time is a
 * count of years since the calendar began (`t`, a float that only grows), and everything here is read from it.
 * @see state/calendar.store, plans/vegetation.md
 */

/** Seconds of play to a year. */
export const YEAR_SECONDS = 3600;
/** Days to a season, as the date is told. */
export const DAYS_PER_SEASON = 30;

export const SEASONS = ["spring", "summer", "autumn", "winter"] as const;
export type Season = (typeof SEASONS)[number];

/** How far through its year `t` is, [0, 1): 0 the first of spring. */
export const yearPart = (t: number) => t - Math.floor(t);
export const seasonOf = (t: number): Season => SEASONS[Math.min(3, Math.floor(yearPart(t) * 4))];
/** The day of its season, from 1. */
export const dayOf = (t: number) => Math.min(DAYS_PER_SEASON, Math.floor(((yearPart(t) * 4) % 1) * DAYS_PER_SEASON) + 1);
/** Which year it is, from 1. */
export const yearOf = (t: number) => Math.floor(t) + 1;

const smooth = (a: number, b: number, v: number) => { const k = Math.max(0, Math.min(1, (v - a) / (b - a))); return k * k * (3 - 2 * k); };

/**
 * WHAT THE YEAR DOES TO THE GROUND at `t`, each 0–1: `bloom` the spring's flowers and fresh green, `dry` the
 * summer's straw, `brown` the grass gone over from autumn till it greens again, `snow` how much lies.
 */
export type GroundSeason = { bloom: number; dry: number; brown: number; snow: number };
export function groundSeason(t: number): GroundSeason {
  const y = yearPart(t);
  return {
    bloom: smooth(0.03, 0.09, y) * (1 - smooth(0.18, 0.26, y)),
    dry: smooth(0.3, 0.42, y) * (1 - smooth(0.52, 0.6, y)),
    // (Across the turn of the year: still brown on the first of spring, green a week or so in.)
    brown: y >= 0.5 ? smooth(0.55, 0.72, y) : 1 - smooth(0.0, 0.08, y),
    snow: snowOf(y),
  };
}
/** How much snow lies at a point `y` of the year: it comes a little into winter, and is gone by its end. */
export const snowOf = (y: number) => smooth(0.78, 0.83, y) * (1 - smooth(0.93, 0.98, y));

// ─── TREES ───────────────────────────────────────────────────────────────────

/** A tree's look, as baked: buds breaking, in full leaf, thinning as they fall, bare, and snow on its branches. */
export const TREE_STATES = ["bud", "full", "thin", "bare", "snow"] as const;
export type TreeState = (typeof TREE_STATES)[number];

/** Whether a kind keeps its leaves the year round. */
export const EVERGREEN: ReadonlySet<string> = new Set(["pine", "reeds", "stump", "rock", "log", "tuft"]);

/** One change in a tree's year: from one look to another over [`t0`, `t1`] of the year. */
type Turn = { from: TreeState; to: TreeState; t0: number; t1: number };
const DECIDUOUS: readonly Turn[] = [
  { from: "bare", to: "bud", t0: 0.03, t1: 0.08 },
  { from: "bud", to: "full", t0: 0.1, t1: 0.16 },
  { from: "full", to: "thin", t0: 0.62, t1: 0.68 },
  { from: "thin", to: "bare", t0: 0.69, t1: 0.75 },
];
// (Snow is the weather's, laid over whatever look a tree has: no turn of its own. @see world/weather)
const EVER: readonly Turn[] = [{ from: "full", to: "full", t0: 0.5, t1: 0.55 }];
/**
 * THE CROPS' YEAR, sown and cut: grain and rape sown in autumn, shoots all winter, grown in spring, ripe in summer,
 * cut, stubble till the plough; maize sown in spring, cut in autumn; kale planted out in summer and picked in winter.
 * The cuts are the harvests' (@see vegetation/crops HARVEST_AT). @see props/crop-models
 */
const GRAIN: readonly Turn[] = [
  { from: "bud", to: "full", t0: 0.07, t1: 0.2 },
  { from: "full", to: "thin", t0: 0.24, t1: 0.33 },
  { from: "thin", to: "bare", t0: 0.415, t1: 0.427 },
  { from: "bare", to: "bud", t0: 0.62, t1: 0.68 },
];
const CROP_TURNS: Readonly<Record<string, readonly Turn[]>> = {
  wheat: GRAIN, barley: GRAIN,
  rape: [
    { from: "bud", to: "full", t0: 0.06, t1: 0.14 },
    { from: "full", to: "thin", t0: 0.3, t1: 0.36 },
    { from: "thin", to: "bare", t0: 0.415, t1: 0.427 },
    { from: "bare", to: "bud", t0: 0.6, t1: 0.66 },
  ],
  maize: [
    { from: "bare", to: "bud", t0: 0.2, t1: 0.26 },
    { from: "bud", to: "full", t0: 0.3, t1: 0.42 },
    { from: "full", to: "thin", t0: 0.55, t1: 0.63 },
    { from: "thin", to: "bare", t0: 0.674, t1: 0.687 },
  ],
  kale: [
    { from: "bare", to: "bud", t0: 0.45, t1: 0.5 },
    { from: "bud", to: "full", t0: 0.58, t1: 0.7 },
    { from: "full", to: "bare", t0: 0.918, t1: 0.932 },
  ],
};
/** Some kinds are early to leaf and late to fall, some the other way: a share of a year, added to every turn. */
const LEAD: Readonly<Record<string, number>> = { flowers: -0.03, birch: -0.015, cherry: -0.02, oak: 0.015, hornbeam: 0.005, willow: -0.025, apple: -0.01, shrub: -0.02, poplar: 0.005 };

/**
 * WHERE A TREE IS IN ITS YEAR at `t` (years): the look it has (`from`), the next it turns to (`to`), and when that
 * turn runs, as years on the same count (`t0` before `t1`; before `t0` it is all `from`, after `t1` all `to`).
 * `lag` is the tree's own, a share of a year either way, so a wood turns over weeks and not at once.
 */
export function treeTurn(kind: string, t: number, lag: number): Turn {
  const turns = CROP_TURNS[kind] ?? (EVERGREEN.has(kind) ? EVER : DECIDUOUS);
  const off = (LEAD[kind] ?? 0) + lag, year = Math.floor(t);
  // The first turn of this year or the next whose end is still to come.
  for (let k = 0; k < turns.length * 2 + 1; k++) {
    const tn = turns[k % turns.length], y = year + Math.floor(k / turns.length) - 1;
    if (y + tn.t1 + off > t) return { from: tn.from, to: tn.to, t0: y + tn.t0 + off, t1: y + tn.t1 + off };
  }
  /* c8 ignore next */
  return { ...turns[0], t0: year + 1 + turns[0].t0 + off, t1: year + 1 + turns[0].t1 + off };
}

/** The look a tree has at `t`, the nearer of the two in a turn. */
export function treeStateAt(kind: string, t: number, lag: number): TreeState {
  const r = treeTurn(kind, t, lag);
  return t < (r.t0 + r.t1) / 2 ? r.from : r.to;
}

/**
 * THE LEAVES' COLOUR through the year, each kind's keys: the share of the year and the colour from it on, blended
 * between. Fresh in spring, its own green all summer, turned in autumn — blossom on a cherry first.
 */
export const LEAF_YEAR: Readonly<Record<string, readonly [number, number][]>> = {
  oak: [[0.04, 0xa6c45a], [0.16, 0x5f8f3e], [0.52, 0x5f8f3e], [0.6, 0x9a8a3a], [0.66, 0xa8642a], [0.74, 0x8a5426]],
  lime: [[0.04, 0xb2d466], [0.16, 0x6f9d45], [0.5, 0x6f9d45], [0.58, 0xb8b043], [0.65, 0xd9b23a], [0.74, 0xc79a34]],
  hornbeam: [[0.04, 0xa4c95e], [0.16, 0x4f8a3e], [0.52, 0x4f8a3e], [0.6, 0x9b9a3c], [0.67, 0xc28e36], [0.75, 0xa77a35]],
  cherry: [[0.02, 0xf6c3d6], [0.1, 0xf2b3cb], [0.15, 0x7aa34a], [0.5, 0x5f8f3e], [0.57, 0xb87a35], [0.64, 0xc4452e], [0.72, 0xa83a2a]],
  birch: [[0.03, 0xbcd96c], [0.15, 0x8fb552], [0.5, 0x8fb552], [0.57, 0xc9c64a], [0.63, 0xe8c83c], [0.72, 0xd8b33a]],
  willow: [[0.03, 0xc8dc78], [0.14, 0x9fbd5e], [0.5, 0x9fbd5e], [0.6, 0xc4c25a], [0.68, 0xd8c048], [0.75, 0xbfa640]],
  poplar: [[0.04, 0xa8c860], [0.16, 0x5e9244], [0.52, 0x5e9244], [0.6, 0xc4b83c], [0.66, 0xe6c432], [0.73, 0xd0a832]],
  apple: [[0.03, 0xf4ecec], [0.11, 0xf0dde2], [0.16, 0x7aa34a], [0.52, 0x628f40], [0.6, 0xa89a3c], [0.67, 0xb07a34], [0.74, 0x8f6430]],
  shrub: [[0.03, 0xb0d064], [0.14, 0x5c8a3c], [0.52, 0x5c8a3c], [0.6, 0x9a7a34], [0.66, 0xa4462c], [0.74, 0x7e3a26]],
  reeds: [[0.0, 0xb8a46a], [0.12, 0x9fb060], [0.22, 0x6f9a44], [0.52, 0x7c9a46], [0.6, 0xb4a85c], [0.7, 0xc4ad70], [0.85, 0xb8a46a]],
  // (A bed's heads: spring's yellow, summer's pinks, gone over to brown.)
  flowers: [[0.06, 0xf2cf3e], [0.16, 0xf0b83a], [0.24, 0xe4607a], [0.46, 0xd2487a], [0.56, 0xb05a60], [0.66, 0x8a6a4a]],
  stump: [[0, 0xffffff]],
  // (What lies about: moss on a rock and a log; a tuft of rough grass, green, straw in summer, dun in winter.)
  rock: [[0, 0x6f8a44]], log: [[0, 0x6f8a44]],
  tuft: [[0.04, 0x8a8a52], [0.16, 0x7fae4a], [0.36, 0x8fa64e], [0.48, 0xb0a85a], [0.62, 0x9a9050], [0.8, 0x857f52]],
  pine: [[0.0, 0x2c5636], [0.2, 0x2f5e3a], [0.7, 0x2f5e3a], [0.85, 0x2a5234]],
  // (The crops: green, then gold as they ripen; rape yellow in flower, then its pods brown; maize to straw.)
  wheat: [[0.0, 0x6a9446], [0.12, 0x5f9a3e], [0.22, 0x6f9c40], [0.27, 0xa8a848], [0.32, 0xd6b356], [0.42, 0xdcb85c], [0.6, 0x86ae4e], [0.85, 0x6a9446]],
  barley: [[0.0, 0x6e9a4c], [0.12, 0x6aa246], [0.22, 0x7aa64a], [0.27, 0xb8b25c], [0.32, 0xe2cd84], [0.42, 0xe6d08a], [0.6, 0x8cb456], [0.85, 0x6e9a4c]],
  rape: [[0.0, 0x4f7e3c], [0.12, 0x6a9440], [0.15, 0xe8cf2a], [0.27, 0xf2d834], [0.31, 0x7c9440], [0.36, 0x8e8a4c], [0.42, 0x8a7c4a], [0.6, 0x4f7e3c]],
  maize: [[0.2, 0x82ae4e], [0.32, 0x4e8c3a], [0.5, 0x4e8c3a], [0.58, 0x949a4e], [0.64, 0xc2ac6c], [0.7, 0xb8a46a]],
  kale: [[0.0, 0x3c6a5e], [0.5, 0x4e7e62], [0.7, 0x467862], [0.85, 0x3a6458]],
};

/** A kind's leaf colour at a share `y` of the year, 0xrrggbb: its keys blended, round the turn of the year. */
export function leafColour(kind: string, y: number): number {
  const keys = LEAF_YEAR[kind] ?? LEAF_YEAR.oak;
  y = yearPart(y);
  let k = keys.findIndex(([at]) => at > y);
  if (k < 0) k = keys.length;
  const a = keys[(k - 1 + keys.length) % keys.length], b = keys[k % keys.length];
  const span = yearPart(b[0] - a[0]) || 1, f = yearPart(y - a[0]) / span;
  const ch = (c: number, s: number) => (c >> s) & 255;
  const m = (s: number) => Math.round(ch(a[1], s) + (ch(b[1], s) - ch(a[1], s)) * f);
  return (m(16) << 16) | (m(8) << 8) | m(0);
}
