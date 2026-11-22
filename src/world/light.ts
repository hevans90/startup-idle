/**
 * World v2 — THE LIGHT, in one place.
 *
 * Everything that throws or takes a shadow reads the sun from here: which way it stands along the ground, how
 * long a shadow a thing's height throws, and what a shadow does to the colour under it. The ground's own shadow,
 * the shadows of what is built on it, and whatever else is lit by the sun agree because they cannot do otherwise.
 * @see render/ground-mesh bakeShade, render/casters
 */

/** Toward the light along the ground, in tiles (x, y): from the screen's left and a little above it. */
export const SUN_X = -0.94, SUN_Y = 0.34;
/** The tiles of shadow a half step of height throws: the sun stands some thirty-six degrees up — lower, and a town's streets lay wholly in its houses' shade. */
export const SHADOW_RUN = 0.28;
/** What a full shadow multiplies the colour under it by: the sky's light is left, and it is blue. */
export const SHADOW_TINT = [0.6, 0.64, 0.74] as const;
/** As a shader writes them. */
const f = (n: number) => (Number.isInteger(n) ? n.toFixed(1) : String(n));
export const SUN_SRC = `${f(SUN_X)}, ${f(SUN_Y)}`, SHADOW_RUN_SRC = f(SHADOW_RUN), SHADOW_TINT_SRC = SHADOW_TINT.map(f).join(", ");
