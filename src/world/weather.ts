/**
 * THE WEATHER, on the calendar's clock (@see ./calendar): dry spells, showers, rain and storms, frost and snow,
 * by the season. PURE — a function of the time, seeded, so the same year has the same weather, time away is
 * caught up by asking, and a held calendar holds it.
 *
 * - **What falls** (`weatherAt`): how wet it is and how warm, two slow noises over a curve through the year. Wet
 *   spells come every few days and last a day or three; summer is drier and its rain comes as storms; winter is
 *   cold enough, now and then, for what falls to be snow.
 * - **What lies** (`groundAt`): snow building up while it falls cold and melting when it warms; the ground wet
 *   from rain and melt, drying in the sun. Not saved: worked out again from the weather over the weeks before.
 * - **Where it goes** (`runoffAt`): what of the rain and melt runs off the land into the water, and what the
 *   water gives back to the air. @see water/rain
 */

/** Wet spells a year, about: one every three days or so. */
const SPELLS = 40;
/** How the weather's two noises are seeded. */
const WET_SALT = 0x5ea7, WARM_SALT = 0x7e3d;

const hash1 = (k: number, salt: number) => {
  let h = Math.imul(k ^ salt, 0x9e3779b1) ^ Math.imul(salt, 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d); h ^= h >>> 12;
  return ((h >>> 8) & 0xffff) / 0x10000;
};
/** A smooth noise along time, 0–1. */
function noise1(x: number, salt: number): number {
  const i = Math.floor(x), f = x - i, u = f * f * (3 - 2 * f);
  return hash1(i, salt) * (1 - u) + hash1(i + 1, salt) * u;
}
const fbm1 = (x: number, salt: number) => noise1(x, salt) * 0.62 + noise1(x * 2.7 + 9.1, salt + 1) * 0.28 + noise1(x * 7.3 + 3.7, salt + 2) * 0.1;
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const smooth = (a: number, b: number, v: number) => { const k = clamp01((v - a) / (b - a)); return k * k * (3 - 2 * k); };

export type WeatherKind = "dry" | "showers" | "rain" | "storm" | "frost" | "snow";
export type Weather = {
  kind: WeatherKind;
  /** How hard it falls, 0–1, rain or snow. */
  fall: number;
  /** How warm, °C. */
  temp: number;
  /** Of what falls, the rain and the snow, 0–1 each. */
  rain: number;
  snow: number;
  /** A summer storm's share of it, 0–1. */
  storm: number;
};

/** How warm the year is at `y` of it, before the weather: coldest in midwinter, warmest in high summer. */
const seasonTemp = (y: number) => 9 + 12 * Math.sin(2 * Math.PI * (y - 0.1));
/** How wet the year is: wettest in autumn and early winter, driest in high summer. */
const seasonWet = (y: number) => 0.06 * Math.cos(2 * Math.PI * (y - 0.78)) - 0.05 * Math.exp(-(((y - 0.4) / 0.08) ** 2));

/** THE WEATHER at `t` (years). */
export function weatherAt(t: number): Weather {
  const y = t - Math.floor(t);
  const wet = fbm1(t * SPELLS, WET_SALT) + seasonWet(y);
  const temp = seasonTemp(y) + (fbm1(t * SPELLS * 0.6, WARM_SALT) - 0.5) * 9 - wet * 2;
  // What falls: nothing till the wet passes its threshold, then more the wetter.
  const fall = clamp01((wet - 0.56) * 3.2);
  // A storm: a summer's wet spell, warm, coming hard.
  const storm = fall * smooth(12, 17, temp) * smooth(0.4, 0.8, fall);
  // Snow below freezing, sleet just above: rain and snow shared.
  const snowShare = 1 - smooth(-0.5, 1.5, temp);
  const rain = fall * (1 - snowShare), snow = fall * snowShare;
  const kind: WeatherKind = snow > 0.08 ? "snow"
    : storm > 0.4 ? "storm" : fall > 0.45 ? "rain" : fall > 0.06 ? "showers"
    : temp < 0 ? "frost" : "dry";
  return { kind, fall, temp, rain, snow, storm };
}

/** What lies on the ground: snow (0–1, a deep cover at 1), how wet it is (0–1), and the melt running off it now (years⁻¹, as runoff). */
export type Lying = { snow: number; wet: number; melt: number; frost: number };

/** A step of the reckoning, years, and how far back it starts. */
const STEP = 1 / 720, BACK = 0.3;
/** Snow lying a year of it falling hard, melting a year a degree; the ground wetted and dried, a year. */
const SNOWS = 120, MELTS = 9, WETS = 90, DRIES = 30;

/**
 * WHAT LIES AT `t`: reckoned from {@link BACK} years before, a step at a time — snow piling and melting, the ground
 * wetting and drying. Pure, so a map just opened has the snow the winter has given it so far.
 */
export function groundAt(t: number): Lying {
  let snow = 0, wet = 0, melt = 0;
  const t0 = Math.floor((t - BACK) / STEP) * STEP;
  for (let s = t0; s < t; s += STEP) {
    const dt = Math.min(STEP, t - s), w = weatherAt(s);
    const melting = Math.min(snow, MELTS * Math.max(0, w.temp) * (1 + w.rain) * dt);
    snow = Math.min(1.2, snow + SNOWS * w.snow * w.snow * dt * 0.25 + SNOWS * w.snow * dt * 0.05 - melting);
    melt = melting / Math.max(dt, 1e-9);
    // Wet from rain and from melt; dried faster the warmer.
    wet = clamp01(wet + WETS * (w.rain + melting * 4) * dt - DRIES * (0.3 + Math.max(0, w.temp) / 15) * (1 - w.fall) * wet * dt);
  }
  const w = weatherAt(t);
  return { snow: Math.min(1, snow), wet, melt, frost: snow < 0.05 && w.fall < 0.05 ? smooth(1, -3, w.temp) : 0 };
}

/**
 * WHERE IT GOES: of the rain and the melt on a tile of land, the share that runs off into the water (the rest
 * soaks in) — more off ground already wet, more in a storm — and what a tile of standing water gives back to the
 * air. Both in half steps of water a tile, a year. @see water/rain
 */
export const RAIN_DEPTH = 15, EVAPORATE = 1.5;
export function runoffAt(t: number, lying: Lying = groundAt(t)): { off: number; up: number } {
  const w = weatherAt(t);
  const soak = 0.12 + 0.5 * lying.wet + 0.25 * w.storm;
  const off = RAIN_DEPTH * (w.rain * soak + lying.melt / SNOWS * 2);
  const up = EVAPORATE * Math.max(0, w.temp) / 20 * (1 - w.fall);
  return { off, up };
}

/**
 * THE WIND at `t` (years): a prevailing way across the map, wandering a little either side of it, a unit step in
 * cells; and how strong, 0–1 — stronger in a storm and through autumn and winter, gusting over minutes.
 */
export const PREVAILING: readonly [number, number] = [0.866, -0.5];
const WIND_SALT = 0x3172, GUST_SALT = 0x91b5;
export function windAt(t: number): [number, number] {
  const a = Math.atan2(PREVAILING[1], PREVAILING[0]) + (fbm1(t * 200, WIND_SALT) - 0.5) * 1.6;
  return [Math.cos(a), Math.sin(a)];
}
export function windStrength(t: number): number {
  const y = t - Math.floor(t), w = weatherAt(t);
  return clamp01(0.12 + 0.55 * fbm1(t * 300, GUST_SALT) + 0.12 * Math.cos(2 * Math.PI * (y - 0.75)) + 0.35 * w.storm + 0.15 * w.fall);
}

/**
 * FRONTS: the weather comes in over the upwind edge and crosses the map along the prevailing wind, so the weather
 * over a cell is the weather of a little while ago or a little while yet — {@link frontLag} years after it is at
 * the map's origin. Still pure: a place's weather is `weatherAt` at its own time.
 */
/** How fast a front crosses, cells a year: a hundred cells in half a minute or so. */
export const FRONT_SPEED = 11520;
export const frontLag = (u: number, v: number) => (u * PREVAILING[0] + v * PREVAILING[1]) / FRONT_SPEED;
export const weatherOver = (t: number, u: number, v: number) => weatherAt(t - frontLag(u, v));

/** What lies, as lately reckoned: by the quarter second, the last few hundred asked for. */
const LIE_Q = 14400, lies = new Map<number, Lying>();
function groundNear(t: number): Lying {
  const k = Math.round(t * LIE_Q);
  let l = lies.get(k);
  if (!l) {
    if (lies.size > 600) lies.clear();
    lies.set(k, (l = groundAt(k / LIE_Q)));
  }
  return l;
}
/** What lies over a cell, to the quarter second. @see groundAt */
export const groundOver = (t: number, u: number, v: number) => groundNear(t - frontLag(u, v));

/**
 * THE SKY, by the season and the weather: what cloud there is and where it sits. Heights are half steps over the
 * highest roof (below 0 is among the roofs).
 * - spring: quick broken cumulus, showers with the sun between;
 * - summer: fair cumulus riding high, and on a hot wet day storm cells towering, dark under;
 * - autumn: a low grey sheet, long rain, fog on still damp mornings;
 * - winter: a flat lid, snow squalls out of it, and clear frosty spells.
 */
export type Sky = {
  /** How much of the sky is cloud, 0–1. */
  cover: number;
  /** The cloud's base and its top, half steps over the highest roof. */
  base: number;
  top: number;
  /** A flat sheet (1) or heaped (0). */
  flat: number;
  /** How grey it is under, 0–1; how much of a storm cell, 0–1. */
  dark: number;
  storm: number;
  /** What hangs under it, falling: rain and snow, 0–1 each. */
  rain: number;
  snow: number;
  /** Fog lying on the ground, 0–1. */
  fog: number;
  /** High thin streaks far above it all, 0–1. */
  wisps: number;
  /** How cold, 0–1 (frost and under at 1). */
  cold: number;
};
const FAIR_SALT = 0x2c9d, WISP_SALT = 0x66f1, FOG_SALT = 0x0f09;
const mix = (a: number, b: number, k: number) => a + (b - a) * k;
export function skyAt(t: number): Sky {
  const y = t - Math.floor(t), w = weatherAt(t);
  // The wet before it falls: cloud gathers ahead of the rain and lingers after it.
  const wet = fbm1(t * SPELLS, WET_SALT) + seasonWet(y);
  const gather = smooth(0.4, 0.58, wet);
  // How much each season's own sky is in it: summer's heaps, the cold half's sheets.
  const summer = smooth(8, 16, seasonTemp(y)), sheet = clamp01((1 - summer) * (0.35 + 0.65 * gather) + 0.5 * w.snow);
  const fair = 0.1 + 0.45 * fbm1(t * SPELLS * 1.7, FAIR_SALT) * (0.6 + 0.4 * summer);
  // (Never the whole sky: a lid over all the map is a grey slab on it. What falls, falls from broken cloud.)
  const cover = clamp01(Math.max(fair * (1 - 0.4 * sheet), gather * (0.45 + 0.15 * sheet), smooth(0, 0.15, w.fall) * (0.6 + 0.25 * w.rain - 0.08 * w.snow)));
  const flat = clamp01(sheet * (1 - w.storm));
  // Fair cloud rides clear of the roofs; a sheet sits on them; rain brings it down; a storm stands from the roofs to far above.
  const base = mix(mix(22, 6, flat), -4, smooth(0, 0.55, Math.max(w.fall * 0.8, w.storm)));
  const top = base + mix(mix(16, 9, flat), 46, w.storm) + 6 * w.fall;
  const cold = smooth(6, -2, w.temp);
  // Fog: a still, damp, cool spell with nothing falling, in the cold half of the year.
  const still = 1 - smooth(0.25, 0.5, fbm1(t * 300, GUST_SALT));
  const fog = clamp01((1 - summer) * still * smooth(0.42, 0.54, wet) * (1 - smooth(0.02, 0.2, w.fall)) * smooth(0.45, 0.7, fbm1(t * SPELLS * 2.3, FOG_SALT)) * 1.6);
  const wisps = clamp01((fbm1(t * SPELLS * 0.9, WISP_SALT) - 0.35) * 2.2) * (1 - 0.7 * flat);
  return { cover, base, top, flat, dark: clamp01(0.75 * w.rain + 0.1 * w.snow + 0.5 * w.storm + 0.15 * flat * gather), storm: w.storm, rain: w.rain, snow: w.snow, fog, wisps, cold };
}
/** The sky over a cell. @see frontLag */
export const skyOver = (t: number, u: number, v: number) => skyAt(t - frontLag(u, v));
