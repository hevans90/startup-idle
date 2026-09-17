/**
 * World v2 — inner-corner notches (plan §5.4).
 *
 * Where three paved cells meet a grass cell at one vertex, the kerb has to turn
 * through 90° around that point. The kerb has WIDTH, so the turn needs artwork,
 * and the natural owner is the paved cell diagonally opposite the grass. Without
 * it the kerb stops dead wherever a road meets a paved area.
 *
 * No tile carries a MIXTURE of interior and notched corners — every road tile is
 * all-or-nothing across its four — so the missing combinations are composited
 * instead: the base tile, plus one small overlay per notched corner.
 *
 * THE OVERLAY IS A SUB-RECT OF AN EXISTING TILE, not new art. 090 is fully paved
 * with a raised kerb nub at each of its four vertices, which is exactly the
 * piece needed. Diffing 090 against 081 (the plain fill) above a tolerance of 12
 * — everything below that is sub-perceptual dithering between two hand-drawn
 * tiles — leaves exactly four connected components, one per vertex, with
 * non-overlapping bounding boxes. Those boxes are {@link NOTCH_RECTS}.
 *
 * Because the rects contain only the nub and pixels already identical to the
 * base, drawing them is seamless BY CONSTRUCTION. That is the point: an earlier
 * attempt clipped to the diamond's quadrants instead and left visible nicks,
 * because the nubs are RAISED — they extend above the top face and have front
 * faces down in the skirt, so no quadrant test can contain them.
 *
 * To re-derive if the artwork changes: diff the two frames, take components
 * above a tolerance of ~12, and read off their bounding boxes.
 */
import { DIR } from "../../iso/dir";
import { DIAG } from "./mask";

/** The tile the nubs are cut from. Fully paved, with a nub at every vertex. */
export const NOTCH_SOURCE = "landscapeTiles_090.png";

/** The plain fully-paved tile the nubs are diffed against. */
export const NOTCH_BASE = "landscapeTiles_081.png";

export type Vertex = "NE" | "SE" | "SW" | "NW";
export const VERTICES: readonly Vertex[] = ["NE", "SE", "SW", "NW"];

/** The two orthogonals either side of each vertex. */
export const VERTEX_FLANKS: Record<Vertex, number> = {
  NE: DIR.N | DIR.E,
  SE: DIR.S | DIR.E,
  SW: DIR.S | DIR.W,
  NW: DIR.N | DIR.W,
};

export type NotchRect = { x: number; y: number; w: number; h: number };

/**
 * Where each nub sits inside the source frame, in frame-local pixels.
 *
 * Measured, not derived — see the note above. A frame is 132×99 with the top
 * face spanning rows 0–66, so the SE/SW/NW rects reaching past row 66 are the
 * nubs' front faces in the skirt, and NE starting at row 0 is its top being
 * clipped by the frame edge.
 */
export const NOTCH_RECTS: Record<Vertex, NotchRect> = {
  NE: { x: 48, y: 0, w: 35, h: 17 },
  SE: { x: 98, y: 23, w: 34, h: 44 },
  SW: { x: 49, y: 47, w: 34, h: 36 },
  NW: { x: 0, y: 23, w: 33, h: 43 },
};

/**
 * Vertices that need a notch: both flanking orthogonals paved, own diagonal not.
 *
 * A vertex with a grass ORTHOGONAL is on the outer boundary and is handled by
 * the base tile's kerb along that edge, so it is not a notch.
 */
export function notchesFor(orth: number, diag: number): Vertex[] {
  return VERTICES.filter(
    (v) => (orth & VERTEX_FLANKS[v]) === VERTEX_FLANKS[v] && !(diag & DIAG[v]),
  );
}

/**
 * Frame name of the BAKED variant for a base frame and a set of notched corners.
 *
 * These tiles are composited at build time by `dev/bake-road-corners.ts` into
 * `derived/roadCorners_sheet.png`, so at runtime they are ordinary atlas frames
 * with the same sampling and batching as every other tile. Nothing composites
 * while the game is running.
 *
 * Corners in {@link VERTICES} order, so the same set always names the same
 * frame however it was built.
 */
export function notchVariantFrame(base: string, notches: readonly Vertex[]): string {
  const id = base.replace(/^\D+/, "").replace(/\.png$/, "");
  const ordered = VERTICES.filter((v) => notches.includes(v));
  return `roadCorner_${id}_${ordered.join("")}.png`;
}
