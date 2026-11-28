/**
 * World v2 — DAY AND NIGHT on the map, and the weather: a day every ten minutes, the town a
 * little darker at night and busier at the rush hours. Read off the clock,
 * so every view of the town agrees on the time of day. Only the look of it
 * and the traffic: the economy keeps no hours. @see world-scene, stepTown
 */

/** Seconds a day lasts. */
export const DAY_SECONDS = 600;
/** How dark the map gets at midnight: the alpha of the night over it. */
export const NIGHT_DARK = 0.35;
/** The colour of the night. */
export const NIGHT_COLOUR = 0x0b1030;
/**
 * What midnight MULTIPLIES the map by: a grade, not a sheet laid over it —
 * darker and bluer, with the town's lights over it bright. @see createLights
 */
export const NIGHT_GRADE = 0x6a74b0;

/** What a heatwave or a drought MULTIPLIES the map by, at its height: warm and dry. */
export const HEAT_GRADE = 0xffdcae;

/** `a` toward `b` by `t`, channel by channel. */
export function mixColour(a: number, b: number, t: number): number {
  const k = Math.max(0, Math.min(1, t));
  const ch = (s: number) => Math.round(((a >> s) & 255) + ((((b >> s) & 255) - ((a >> s) & 255)) * k));
  return (ch(16) << 16) | (ch(8) << 8) | ch(0);
}

/** Where in the day it is, 0 to 1: midnight at 0, noon at a half. */
export const dayPhase = (nowMs: number) => ((nowMs / 1000) % DAY_SECONDS) / DAY_SECONDS;
/**
 * THE SEASON'S DAY: the hour as the light takes it at `y` of the year — dawn later and dusk earlier in midwinter,
 * the other way in midsummer, noon and midnight where they always are. So winter's nights are long and summer's
 * short, and everything that asks how dark it is follows.
 */
export const DAY_SWING = 0.045;
export function seasonPhase(phase: number, y: number): number {
  const dawn = 0.25 + DAY_SWING * Math.cos(2 * Math.PI * (y - 0.875));
  const half = phase < 0.5 ? phase : 1 - phase;
  const e = half < dawn ? (half * 0.25) / dawn : 0.25 + ((half - dawn) * 0.25) / (0.5 - dawn);
  return phase < 0.5 ? e : 1 - e;
}
/** Whether it is light: six in the morning to six at night. */
export const isDaytime = (nowMs: number) => { const p = dayPhase(nowMs); return p >= 0.25 && p < 0.75; };

/** How dark the map is, 0 at noon up to NIGHT_DARK at midnight, eased so the day is long. */
export function darkness(phase: number): number {
  const light = 0.5 - 0.5 * Math.cos(phase * Math.PI * 2);
  return NIGHT_DARK * (1 - light) ** 1.5;
}

/** A bump centred on `at`, `width` wide, in day-phase. */
const bump = (phase: number, at: number, width: number) => {
  const d = Math.min(Math.abs(phase - at), 1 - Math.abs(phase - at));
  return Math.exp(-((d / width) ** 2));
};

/** How far into the night it is, 0 at noon to 1 at midnight: what the lamps, the windows and the night's grade go by. */
export const nightAt = (phase: number) => darkness(phase) / NIGHT_DARK;

/** What the low sun MULTIPLIES the map by, at sunrise and sunset: gold. */
export const LOW_SUN_GRADE = 0xffc890;
/** The sky the water mirrors at noon, overhead and at the horizon, and the sun's glint on it. @see waterLook */
const SKY_TOP = [0.3, 0.5, 0.78], SKY_LOW = [0.62, 0.74, 0.86], SUN = [1, 0.97, 0.9];
/** The same with the sun low: the horizon flushed, overhead deeper, the glint gold. */
const DUSK_TOP = [0.26, 0.36, 0.62], DUSK_LOW = [0.9, 0.62, 0.48], DUSK_SUN = [1, 0.7, 0.42];
/** How much of the sky's light is left at midnight, before the grade. */
const NIGHT_SKY = 0.45;

/** THE LIGHT AT AN HOUR, the one place it is decided: everything that is lit by the time of day reads it here. */
export type Light = {
  /** How far into the night, 0–1. @see nightAt */
  night: number;
  /** How low the sun is, 0–1: most at sunrise and sunset, none at noon or in the dark. */
  low: number;
  /** What the whole map is multiplied by: white at noon, gold with the sun low, the night's blue in the dark. */
  grade: number;
  /** The sky the water mirrors, overhead and at the horizon, 0–1 a channel. */
  skyTop: [number, number, number]; skyLow: [number, number, number];
  /** The sun's glint on the water: its colour, and how strong (gone at night). */
  sun: [number, number, number, number];
};

const lerp3 = (a: number[], b: number[], t: number, k = 1): [number, number, number] =>
  [(a[0] + (b[0] - a[0]) * t) * k, (a[1] + (b[1] - a[1]) * t) * k, (a[2] + (b[2] - a[2]) * t) * k];

/**
 * The light at `phase` (0–1 from midnight): one turn of the day, so dawn and dusk come between noon and midnight as
 * the colour they are, never one look faded into another. Noon and midnight are as they always were.
 */
export function lightAt(phase: number): Light {
  const night = nightAt(phase);
  // (The sun low: at six in the morning and six at night, an hour and a half either side — and less of it the darker.)
  const low = Math.max(bump(phase, 0.25, 0.06), bump(phase, 0.75, 0.06)) * (1 - night);
  return {
    night, low,
    grade: mixColour(mixColour(0xffffff, LOW_SUN_GRADE, low), NIGHT_GRADE, night),
    skyTop: lerp3(SKY_TOP, DUSK_TOP, low, 1 - (1 - NIGHT_SKY) * night),
    skyLow: lerp3(SKY_LOW, DUSK_LOW, low, 1 - (1 - NIGHT_SKY) * night),
    sun: [...lerp3(SUN, DUSK_SUN, low), 1 - night],
  };
}
/** Noon's light: the map with the night off. */
export const NOON: Light = lightAt(0.5);

/** One colour multiplied by another, channel by channel. */
export function multiplyColour(a: number, b: number): number {
  const ch = (s: number) => Math.round((((a >> s) & 255) * ((b >> s) & 255)) / 255);
  return (ch(16) << 16) | (ch(8) << 8) | ch(0);
}

/**
 * How busy the streets are, against an ordinary hour: half in the dead of
 * night, more at the morning and evening rush. And at the rush, more of the
 * trips are people going to work and home.
 */
export function busyness(phase: number): { traffic: number; commute: number } {
  const rush = Math.max(bump(phase, 8 / 24, 0.05), bump(phase, 18 / 24, 0.05));
  const night = bump(phase, 0, 0.12);
  return { traffic: 1 + 0.6 * rush - 0.5 * night, commute: 0.6 + 0.3 * rush };
}

