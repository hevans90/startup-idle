/**
 * World v2 — mask → sprite, DERIVED from the hand-authored label files.
 *
 * Not hand-written. v1's table is, and it omits all four outer corners even
 * though the art exists and is labelled — so every bend in a v1 road falls back
 * to plain asphalt. Deriving from `road-labels.json` / `city-tile-labels.json`
 * picks those up for free and cannot drift from the labeller.
 *
 * The label files are READ ONLY here; they are authored in `dev/roadlabel.html`.
 */
import roadLabels from "../../../road-labels.json";
import cityLabels from "../../../city-tile-labels.json";

import { DIR } from "../../iso/dir";
import { DIAG, FLANK, ORTH_MASK, OPPOSITE } from "./mask";
import { notchVariantFrame, notchesFor, type Vertex } from "./notch";

/**
 * The baked variant's frame when corners need notching, else the base.
 *
 * The variants are composited at BUILD time into `derived/roadCorners_sheet`
 * (see dev/bake-road-corners.ts), so from here on they are ordinary frames.
 */
const baked = (frame: string | null, notches: readonly Vertex[]) =>
  frame && notches.length ? notchVariantFrame(frame, notches) : frame;

/** A road entry as authored. `open` names the edges the road exits through. */
export type RoadLabel = {
  road?: boolean;
  open?: Partial<Record<"N" | "E" | "S" | "W", boolean>>;
  width?: string;
  role?: string;
};

export type RoadSet = "landscape" | "city";

const SHEET: Record<RoadSet, { data: Record<string, RoadLabel>; frame: (k: string) => string }> = {
  landscape: {
    data: roadLabels as Record<string, RoadLabel>,
    frame: (k) => `landscapeTiles_${k}.png`,
  },
  city: {
    data: cityLabels as Record<string, RoadLabel>,
    frame: (k) => `cityTiles_${k}.png`,
  },
};

/**
 * Roles the resolver asks for, in the vocabulary the labeller uses.
 *
 * The `thin-` prefixes are the labeller's names for junction SHAPES, not a
 * width claim — 090 is `role: "thin-cross"` with `width: "thick"`. Renaming
 * them here would mean this file and the tool disagreed about the same tile.
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
 *    corner of a BLOCK and the road fills it. That is the square-edged
 *    `thick-outer-corner` art (114 / 118 / 119 / 122).
 *
 *  - diagonal GRASS → this is a single-width road turning, and the artset has
 *    no square-edged corner for that. The bend is drawn as a CURVE, and
 *    assembled the curves form a continuous rounded road with unbroken kerbs:
 *    123 (SW), 125 (ES), 126 (NW), 127 (NE).
 *
 * Using the square corner for the second case is what broke cornering: its
 * kerbs run the full length of both closed edges, so where two turns meet —
 * a zigzag, a staircase, a loop — they do not join across the turn.
 *
 * `thick-curve` is not labelled yet, so the square corner stands in and the
 * pick reports `exact: false`. The `gaps` overlay marks those cells.
 *
 * Constants because the label strings are authored in dev/roadlabel.html, and
 * this is the only place the engine names them.
 */
export const CORNER_DIAGONAL_PAVED: RoadRole = "thick-outer-corner";
export const CORNER_DIAGONAL_GRASS: RoadRole = "thick-curve";

export const openMaskOf = (l: RoadLabel): number => {
  const o = l.open ?? {};
  return (o.N ? DIR.N : 0) | (o.E ? DIR.E : 0) | (o.S ? DIR.S : 0) | (o.W ? DIR.W : 0);
};

export type RoadTable = {
  set: RoadSet;
  /** `role` → open mask → frame. Filtered to the requested width. */
  byRole: Map<string, Map<number, string>>;
  /**
   * Frame → its labelled open mask.
   *
   * For every role EXCEPT fill, a pick's open mask is the cell's by
   * construction (the role tables are keyed by it). Kept for assertions and
   * for tooling that wants to check a frame without re-reading the labels.
   */
  openOf: Map<string, number>;
  /**
   * Open mask → every road frame with it, of ANY width.
   *
   * The fallback pool, deliberately unfiltered: shape matters more than family.
   * A road with no thick N–S straight should still draw a N–S straight and say
   * it substituted, not leave a hole in the middle of the network.
   */
  byOpen: Map<number, string[]>;
  /**
   * The fill tile, resolved by ROLE alone.
   *
   * Full pavement has no open edges to match a mask against — its label says
   * `open: NESW` because every side continues — so both the interior of a plaza
   * and an isolated paved square want it regardless of their own mask.
   */
  fill: string | null;
};

/**
 * Index one label set.
 *
 * Where several tiles share a role AND an open mask the lowest key wins, so the
 * table is deterministic across runs rather than dependent on object order.
 *
 * NOTE there is no width filter, deliberately. "Thick roads only" is enforced
 * by which ROLES {@link resolveRole} asks for — it never asks for
 * `thin-corner`, and fill/lane/corner is the thick vocabulary. The label file's
 * `width` field cannot do that job:
 *
 *  - the labeller does not author it (its cards expose `road`, the four edges
 *    and `role`, and nothing else), so it is legacy data that no longer moves
 *  - the `thin-` role names are SHAPE names shared by both families — 090 is
 *    `role: "thin-cross"` with `width: "thick"`
 *  - filtering on it excluded exactly one tile: 074, the N–S straight, whose
 *    E–W twin 082 is identical to within a percentage point of asphalt, grass
 *    and kerb, carries the same role, and is marked `thick`. So the filter's
 *    only effect was to leave every N–S run without a straight.
 */
export function buildRoadTable(set: RoadSet): RoadTable {
  const { data, frame } = SHEET[set];
  const byRole = new Map<string, Map<number, string>>();
  const byOpen = new Map<number, string[]>();
  const openOf = new Map<string, number>();

  let fill: string | null = null;

  for (const key of Object.keys(data).sort()) {
    const l = data[key];
    if (!l.road) continue;
    const open = openMaskOf(l);
    const f = frame(key);
    openOf.set(f, open);

    // the fallback pool takes every width — see the note on `byOpen`
    const pool = byOpen.get(open) ?? [];
    pool.push(f);
    byOpen.set(open, pool);

    const role = l.role ?? "";
    if (!role) continue;
    if (role === "thick-fill" && !fill) fill = f;
    const byMask = byRole.get(role) ?? new Map<number, string>();
    if (!byMask.has(open)) byMask.set(open, f);
    byRole.set(role, byMask);
  }
  return { set, byRole, byOpen, openOf, fill };
}

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

export type RoadPick = {
  /** The frame to DRAW — the baked variant when corners need notching. */
  frame: string | null;
  /**
   * The frame before compositing.
   *
   * Same as `frame` unless `notches` is non-empty. Kept so the baker can find
   * what to composite, and so the inspector can say which tile a variant came
   * from.
   */
  base: string | null;
  role: RoadRole;
  /**
   * Inner corners the base frame does not draw.
   *
   * Non-empty only for `thick-fill` and `thick-lane`, the two roles that leave
   * corners paved. When non-empty, `frame` is the BAKED variant rather than the
   * base — see roads/notch.
   */
  notches: Vertex[];
  /**
   * False when the art cannot express this cell.
   *
   * Two separate ways that happens, and both are reported here:
   *
   *  1. no tile carries the resolved role at this open mask, so another stands
   *     in — see the fallback in {@link roadSpriteFor}
   *  2. the role's CORNER treatment does not match the cell's diagonals — see
   *     {@link cornersExpressible}. Every role is all-or-nothing on its inner
   *     corners, and the artset has no piece with a mixture.
   */
  exact: boolean;
};

/**
 * Whether a SINGLE TILE can draw this cell's corners.
 *
 * Retained because it names the limit the notch compositing exists to work
 * around — see roads/notch. It is no longer what `exact` reports: with notches
 * composited on top, every reachable mask is drawable.
 *
 * A cell's vertex is INTERIOR when both its flanking orthogonals and its own
 * diagonal are paved; it wants asphalt. When the flanking orthogonals are paved
 * and the diagonal is not, it wants a kerbed NOTCH. Every tile is all-or-nothing
 * across its inner corners — `thick-fill` paves all four, `thin-cross` kerbs all
 * four, `thick-lane` paves both far corners, `thin-T` kerbs both — so a cell
 * needing a MIXTURE has no tile.
 *
 * Derived from the mask, not from pixels, so it cannot drift from the labels.
 *
 * (A two-adjacent turn has only one inner corner and both variants exist —
 * `thick-outer-corner` paves it, `thick-curve` kerbs it — so turns are always
 * expressible.)
 */
export function cornersExpressible(orth: number, diag: number): boolean {
  const inner = (["NE", "SE", "SW", "NW"] as const).filter(
    (v) => (orth & VERTEX_FLANKS[v]) === VERTEX_FLANKS[v],
  );
  if (inner.length < 2) return true;            // 0 or 1 inner corner: covered
  const paved = inner.filter((v) => diag & DIAG[v]).length;
  return paved === 0 || paved === inner.length; // all or nothing
}

/** The two orthogonals either side of each vertex. */
const VERTEX_FLANKS = {
  NE: DIR.N | DIR.E,
  SE: DIR.S | DIR.E,
  SW: DIR.S | DIR.W,
  NW: DIR.N | DIR.W,
} as const;

/**
 * Frame for a mask.
 *
 * Returns `exact: false` rather than silently substituting, so the debug
 * overlay can show which cells the artwork does not actually cover. v1 papers
 * over the same situation with plain asphalt, which is why its corners are
 * invisible bugs rather than visible gaps.
 */
export function roadSpriteFor(t: RoadTable, mask: number): RoadPick {
  const orth = mask & ORTH_MASK;
  const diag = mask & ~ORTH_MASK;
  const role = resolveRole(orth, diag);

  // Only these two leave inner corners PAVED, so only they can need notches
  // composited on top. Cross and T already kerb every corner they have, and a
  // turn's single corner is covered by choosing between the block corner and
  // the curve.
  const notches = role === "thick-fill" || role === "thick-lane"
    ? notchesFor(orth, diag)
    : [];

  // Fill is by ROLE, not by mask — full pavement has no open edges to match a
  // mask against, which is exactly why it is indexed separately. So its
  // exactness is "does the fill tile exist", NOT whether its own open mask
  // equals the cell's. Comparing masks here reported a lone paved square as a
  // substitution when 081 is precisely the right tile for it.
  if (role === "thick-fill") {
    return { frame: baked(t.fill, notches), base: t.fill, role, notches, exact: t.fill !== null };
  }

  const hit = t.byRole.get(role)?.get(orth);
  if (hit) return { frame: baked(hit, notches), base: hit, role, notches, exact: true };

  // Same shape, different family — it still faces the right way, so the network
  // never gaps. Reported as inexact so the overlay and the inspector can show
  // where the artwork (or the labelling) does not reach. This is the path a
  // single-width bend takes today: the curve art exists in the sheet but is not
  // labelled, so the block-corner tile stands in and its kerbs do not meet
  // across the turn.
  const pool = t.byOpen.get(orth);
  const fallback = pool?.[0] ?? null;
  return { frame: fallback, base: fallback, role, notches, exact: false };
}

export type CoverageRow = {
  orth: number;
  open: string;
  role: RoadRole;
  frame: string | null;
  exact: boolean;
};

/**
 * Every orthogonal mask and what it resolves to.
 *
 * Both diagonal extremes are reported because the 3-connection masks resolve
 * differently depending on them, and a table can cover one and not the other.
 */
export function roadCoverage(t: RoadTable, diag = 0): CoverageRow[] {
  const name = (m: number) =>
    (["N", "E", "S", "W"] as const).filter((d) => m & DIR[d]).join("") || "-";
  const rows: CoverageRow[] = [];
  for (let orth = 0; orth <= ORTH_MASK; orth++) {
    const pick = roadSpriteFor(t, orth | diag);
    rows.push({ orth, open: name(orth), role: pick.role, frame: pick.frame, exact: pick.exact });
  }
  return rows;
}
