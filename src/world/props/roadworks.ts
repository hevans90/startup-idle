/**
 * World v2 — WHAT STANDS ROUND A ROAD BEING BUILT, as models: a cone, a
 * barrier across a road that stops. Metres, about the
 * origin on the ground. In the props' sheet. @see render/road-works
 */
import { face, type Tri, type V3 } from "../agents/cars/raster";
import type { Mat } from "../agents/cars/models";
import { box, type Prop, type PropShadow } from "./models";

const SMALL: PropShadow = { hl: 0.3, hw: 0.3, edge: 0.1, soft: 0.2, strength: 0.25, reach: 0.2 };

/** A tapered square post from `z0` to `z1`, `r0` half across at its foot and `r1` at its head. */
function taper(r0: number, r1: number, z0: number, z1: number, mat: Mat, out: Tri[]) {
  const c: V3 = [0, 0, (z0 + z1) / 2];
  for (const [a, b] of [[[1, 1], [1, -1]], [[1, -1], [-1, -1]], [[-1, -1], [-1, 1]], [[-1, 1], [1, 1]]])
    face([[a[0] * r0, a[1] * r0, z0], [b[0] * r0, b[1] * r0, z0], [b[0] * r1, b[1] * r1, z1], [a[0] * r1, a[1] * r1, z1]], mat, c, out);
}
/** A traffic cone, 0.75 m: a black foot, orange with a white sleeve. */
function coneTris(): Tri[] {
  const out: Tri[] = [];
  box(-0.2, 0.2, -0.2, 0.2, 0, 0.05, "tyre", out);
  taper(0.15, 0.11, 0.05, 0.32, "liveryRed", out);
  taper(0.11, 0.075, 0.32, 0.5, "liveryWhite", out);
  taper(0.075, 0.035, 0.5, 0.75, "liveryRed", out);
  box(-0.035, 0.035, -0.035, 0.035, 0.75, 0.76, "liveryRed", out);
  return out;
}
/** A barrier across the road, 3.4 m along x: two red-and-white planks between feet, a lamp on it. */
function barrierTris(): Tri[] {
  const out: Tri[] = [];
  for (const x of [-1.6, 1.6]) { box(x - 0.05, x + 0.05, -0.05, 0.05, 0, 1.05, "trim", out); box(x - 0.08, x + 0.08, -0.35, 0.35, 0, 0.08, "tyre", out); }
  for (const z of [0.45, 0.8]) for (let k = 0; k < 8; k++) box(-1.6 + k * 0.4, -1.2 + k * 0.4, -0.03, 0.03, z, z + 0.2, k % 2 ? "liveryWhite" : "liveryRed", out);
  box(-0.08, 0.08, -0.06, 0.06, 1.0, 1.18, "indicator", out);
  return out;
}
const P = (id: string, tris: () => Tri[]): Prop => ({ id, tris, shadow: SMALL });
export const ROADWORKS: readonly Prop[] = [
  P("cone", coneTris), P("barrier", barrierTris),
];
