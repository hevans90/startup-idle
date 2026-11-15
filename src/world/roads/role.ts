/**
 * World v2 — A ROAD CELL'S ROLE: what it is by which of its eight neighbours
 * are paved — a straight, a turn, a T, a crossroads, the lane of a wide road,
 * the fill of a plaza. Pure. The painter draws a look for each. @see looks.ts
 */
import { DIR } from "../../iso/dir";
import { DIAG, FLANK, OPPOSITE } from "./mask";

/**
 * What a paved cell is, by its neighbours. The `thin-` prefixes name junction
 * SHAPES, not a width.
 */
export type RoadRole =
  | "thick-fill"
  | "thin-cross"
  | "thick-lane"
  | "thin-T"
  | "thick-outer-corner"
  | "thick-curve"
  | "thin-straight"
  | "thin-end";

/**
 * The two corner roles, and which case each is for.
 *
 * A cell open on two ADJACENT sides is a turn, and what the turn looks like
 * depends on the DIAGONAL across the two open sides:
 *
 *  - diagonal PAVED → the paved region wraps round this cell, so the cell is a
 *    corner of a BLOCK and the road fills it: the square-edged
 *    `thick-outer-corner`.
 *
 *  - diagonal GRASS → this is a single-width road turning. The bend is drawn
 *    as a CURVE, and assembled the curves form a continuous rounded road with
 *    unbroken kerbs.
 *
 * Using the square corner for the second case is what broke cornering: its
 * kerbs run the full length of both closed edges, so where two turns meet —
 * a zigzag, a staircase, a loop — they do not join across the turn.
 */
export const CORNER_DIAGONAL_PAVED: RoadRole = "thick-outer-corner";
export const CORNER_DIAGONAL_GRASS: RoadRole = "thick-curve";

/** Adjacent orthogonal pair → the diagonal bit for the vertex between them. */
const CORNER_DIAGONAL = new Map<number, number>([
  [DIR.N | DIR.E, DIAG.NE],
  [DIR.E | DIR.S, DIAG.SE],
  [DIR.S | DIR.W, DIAG.SW],
  [DIR.W | DIR.N, DIAG.NW],
]);

/**
 * Which role a mask calls for (plan §5, resolution order).
 *
 * The interesting case is three connections. If both diagonals BEHIND the cell
 * are paved it is the edge lane of a wide road; if they are not it is a
 * T-junction. "Behind" is the side opposite the missing connection — so for a
 * 2-wide avenue both edge columns resolve to `thick-lane`, and a 1-wide road
 * with a branch resolves to `thin-T`.
 */
export function resolveRole(orth: number, diag: number): RoadRole {
  const bits = [DIR.N, DIR.E, DIR.S, DIR.W].filter((b) => orth & b).length;

  if (bits === 4) {
    // The crossroads tile has grass in all FOUR corners, so it is only right
    // when all four diagonals are grass. Any paved diagonal means at least one
    // corner is roadway, and asphalt over a corner that should be grass reads
    // far better than grass over a corner that should be roadway — a 2-wide
    // junction is the case that proves it: each of its four cells sees three
    // orthogonals-plus and exactly ONE paved diagonal, and the crossroads tile
    // put a grass patch in the middle of the intersection.
    //
    // There is no exact art for the in-between cases and labelling cannot
    // produce any: the sheet's three other NESW road tiles (091/092/093)
    // measure 0% asphalt — they are grass-and-kerb path tiles, not pavement.
    return diag === 0 ? "thin-cross" : "thick-fill";
  }
  if (bits === 3) {
    // Measured on the art: `thick-lane` (087) and `thin-T` (096) put grass on
    // the same closed edge and kerb the two corners flanking it. They differ
    // ONLY in the two FAR corners — the lane paves them, the T kerbs them.
    //
    // A far corner should be kerbed exactly when its own diagonal is grass, and
    // no tile covers one-of-each. So the T is used only when BOTH are grass;
    // anything else takes the lane. Same principle as the four-connection case:
    // a kerb drawn across solid pavement is a hard line in the middle of a
    // road, while a missing notch at the outside edge is barely visible.
    //
    // The mixed case is exactly "pave a 2x2 then pave one cell outwards": the
    // corner cell keeps one paved diagonal and loses the other.
    const missing = (["N", "E", "S", "W"] as const).find((d) => !(orth & DIR[d]))!;
    const far = FLANK[OPPOSITE[missing]];
    return (diag & far) === 0 ? "thin-T" : "thick-lane";
  }
  if (bits === 2) {
    const between = CORNER_DIAGONAL.get(orth);
    if (between === undefined) return "thin-straight";   // two OPPOSITE sides
    return (diag & between) !== 0 ? CORNER_DIAGONAL_PAVED : CORNER_DIAGONAL_GRASS;
  }
  if (bits === 1) return "thin-end";
  return "thick-fill";   // isolated cell: a lone paved square is a patch of pavement
}
