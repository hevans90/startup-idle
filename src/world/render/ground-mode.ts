/**
 * World v2 — HOW BARE GROUND IS DRAWN. `?ground=`:
 *
 *  - `steps` (as it is with nothing asked): the grid as it is — a level top a
 *    tile, a wall down every step;
 *  - `banks`: the first smoothing — a corner of the grid at the mean of the
 *    cells that meet there, a small step a bank and a big one a cliff, a fan a
 *    tile. Kept to look back at; it makes wedges of wall where a cliff dies
 *    out, and a point of every tile that stands alone;
 *  - `smooth`: ONE CONTINUOUS SURFACE through every tile's own height, with no
 *    choice anywhere between joining and parting — a big step is a steep face,
 *    not a wall — meshed four by four a tile, the grid the water's solver
 *    works on. The water goes with it as one smooth field. @see drawn.ts
 *    smoothAt, water-mode.ts
 *
 * One switch, read by the ground's mesh, by what stands on the ground, and by
 * the water's floor, so none of them can disagree.
 */
export type GroundMode = "steps" | "banks" | "smooth";
const asked = (): GroundMode => {
  const v = typeof location !== "undefined" ? new URLSearchParams(location.search).get("ground") : null;
  return v === "banks" || v === "smooth" ? v : "steps";
};
let mode: GroundMode = asked();
export const groundMode = (): GroundMode => mode;
/** For a test that wants one. */
export const setGroundMode = (m: GroundMode): void => { mode = m; };
