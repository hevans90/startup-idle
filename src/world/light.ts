/**
 * World v2 — THE LIGHT, in one place.
 *
 * Everything that throws or takes a shadow reads the sun from here: which way it stands along the ground, how
 * long a shadow a thing's height throws, and what a shadow does to the colour under it. The ground's own shadow,
 * the shadows of what is built on it, and whatever else is lit by the sun agree because they cannot do otherwise.
 * @see render/ground-mesh bakeShade, render/casters
 */

/** Toward the light along the ground, in tiles (x, y): from the screen's left and a little above it. */
export const SUN_HOME_X = -0.94, SUN_HOME_Y = 0.34;
/** The tiles of shadow a half step of height throws: the sun stands some thirty-six degrees up — lower, and a town's streets lay wholly in its houses' shade. */
export const SHADOW_RUN_HOME = 0.28;
export let SHADOW_RUN = SHADOW_RUN_HOME;
/** The sun's home height over the ground, degrees: what `SHADOW_RUN_HOME` throws. */
export const SUN_HOME_HEIGHT = 36;
/** A half step's shadow is this over the tangent of the sun's height, tiles. */
const RUN_K = SHADOW_RUN_HOME * Math.tan((SUN_HOME_HEIGHT * Math.PI) / 180);
/** Where the sun stands along the ground now: its home, unless the editor's slider has moved it. @see setSunAround */
export let SUN_X = SUN_HOME_X, SUN_Y = SUN_HOME_Y;
/** Counts each move of the sun: what is baked from it is baked again. */
export let sunRev = 0;
/** The sun's home bearing, radians, as `setSunAround` takes it. */
export const SUN_HOME_ANGLE = Math.atan2(SUN_HOME_Y, SUN_HOME_X);
/** THE SUN MOVED ROUND the map to `angle` (radians, its bearing along the ground) and `height` (degrees up); null, its home. The editor's sliders. @see TimeSlider */
export function setSunAround(angle: number | null, height: number | null = null) {
  const a = angle ?? SUN_HOME_ANGLE, x = angle === null ? SUN_HOME_X : Math.cos(a), y = angle === null ? SUN_HOME_Y : Math.sin(a);
  const run = (height === null ? SHADOW_RUN_HOME : RUN_K / Math.tan((Math.max(5, Math.min(85, height)) * Math.PI) / 180)) * seasonRun;
  if (x === SUN_X && y === SUN_Y && run === SHADOW_RUN) return;
  SUN_X = x; SUN_Y = y; SHADOW_RUN = run; SUN_HEIGHT = height ?? SUN_HOME_HEIGHT; sunRev++;
}
let SUN_HEIGHT = SUN_HOME_HEIGHT;
/**
 * THE SEASON'S SUN: lower in winter and higher in summer, so a shadow is thrown further or less far than at home —
 * by `shadowSeason` of the year, in sixteen steps of it. Only how far: the sun's bearing and the light on a wall
 * stay as everything baked was lit, and only the ground's shade is made again (`shadowRev`, not `sunRev`).
 */
let seasonRun = 1;
export let shadowRev = 0;
export function shadowSeason(y: number): number {
  const q = Math.round(y * 16) / 16, rad = Math.PI / 180;
  return Math.tan(SUN_HOME_HEIGHT * rad) / Math.tan((SUN_HOME_HEIGHT + 9 * Math.cos(2 * Math.PI * (q - 0.375))) * rad);
}
export function setSunSeason(k: number) {
  if (k === seasonRun) return;
  SHADOW_RUN = (SHADOW_RUN / seasonRun) * k; seasonRun = k; shadowRev++;
}
/** Whether the sun stands where everything baked was lit from. */
export const sunHome = () => SUN_X === SUN_HOME_X && SUN_Y === SUN_HOME_Y && SUN_HEIGHT === SUN_HOME_HEIGHT;
/**
 * HOW LIT A WALL IS facing (nx, ny) along the ground, against the face lit from the left: the baked sprites' own rule
 * — the face to the light the colour itself, the face away three quarters of it (@see pen RIGHT) — with the light
 * from wherever the sun stands, and a low sun lighting what faces it the more.
 */
function wallLight(nx: number, ny: number, sx: number, sy: number, height: number): number {
  const d = nx * sx + ny * sy, k = Math.max(0, Math.min(1, (d + 0.2) / 0.5)), lit = k * k * (3 - 2 * k);
  const low = Math.min(1.25, Math.cos((height * Math.PI) / 180) / Math.cos((SUN_HOME_HEIGHT * Math.PI) / 180));
  return 0.76 + 0.24 * lit * low;
}
/** What a wall facing (nx, ny) is multiplied by for the sun where it stands, against how it was baked: 1 at home. */
export function faceGain(nx: number, ny: number): number {
  if (sunHome()) return 1;
  const n = Math.hypot(nx, ny) || 1;
  return wallLight(nx / n, ny / n, SUN_X, SUN_Y, SUN_HEIGHT) / wallLight(nx / n, ny / n, SUN_HOME_X, SUN_HOME_Y, SUN_HOME_HEIGHT);
}
/** What a full shadow multiplies the colour under it by: the sky's light is left, and it is blue. */
export const SHADOW_TINT = [0.6, 0.64, 0.74] as const;
/** How much of the way to the shadow's tint a full shadow takes the ground under it: the same on grass and road. */
export const SHADOW_DEPTH = 0.72;
/** As a shader writes them. */
const f = (n: number) => (Number.isInteger(n) ? n.toFixed(1) : String(n));
export const SUN_SRC = `${f(SUN_HOME_X)}, ${f(SUN_HOME_Y)}`, SHADOW_RUN_SRC = f(SHADOW_RUN_HOME), SHADOW_TINT_SRC = SHADOW_TINT.map(f).join(", "), SHADOW_DEPTH_SRC = f(SHADOW_DEPTH);
