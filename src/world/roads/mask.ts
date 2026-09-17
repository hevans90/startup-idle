/**
 * World v2 — road connection masks (plan §5).
 *
 * Roads are a PAVED-AREA layer, not a line network: you paint cells and the
 * region autotiles. That is forced by the artwork — the tileset has no thin
 * outer corner, so a 1px-line road model cannot draw a bend. Painting areas
 * also gets 2-wide avenues and plazas for free instead of special-casing them.
 *
 * Eight bits. The four ORTHOGONALS pick the shape; the four DIAGONALS
 * disambiguate the family — a 3-connection cell is the edge lane of a wide road
 * when the diagonals behind it are paved, and a T-junction when they are not.
 */
import { DIR, NEIGHBOUR } from "../../iso/dir";
import { idx, inBounds, rampDir, rampRise, VOID, type Grid } from "../grid";
import { RAMP } from "../iso";

export { DIR };

/**
 * Diagonal bits, continuing on from {@link DIR}'s 1/2/4/8.
 *
 * Each diagonal sits between the two orthogonals it is named for, which is
 * what makes {@link FLANK} below a lookup rather than a calculation.
 */
export const DIAG = { NE: 16, SE: 32, SW: 64, NW: 128 } as const;

/** Offsets, in the same convention as {@link NEIGHBOUR}: +x is S, +y is W. */
export const DIAG_NEIGHBOUR: Record<keyof typeof DIAG, [number, number]> = {
  NE: [-1, -1],
  SE: [1, -1],
  SW: [1, 1],
  NW: [-1, 1],
};

/** The two diagonals either side of each orthogonal direction. */
export const FLANK: Record<keyof typeof DIR, number> = {
  N: DIAG.NE | DIAG.NW,
  E: DIAG.NE | DIAG.SE,
  S: DIAG.SE | DIAG.SW,
  W: DIAG.SW | DIAG.NW,
};

export const ORTH_MASK = DIR.N | DIR.E | DIR.S | DIR.W;
export const DIAG_MASK = DIAG.NE | DIAG.SE | DIAG.SW | DIAG.NW;

export const orthOf = (mask: number) => mask & ORTH_MASK;
export const diagOf = (mask: number) => mask & DIAG_MASK;

export const isPaved = (g: Grid, x: number, y: number) =>
  inBounds(g, x, y) && g.paved[idx(g, x, y)] !== VOID;

/**
 * Height a cell's surface reaches toward one of its edges.
 *
 * A ramp's named edge is its HIGH one, so a ramp at `h` rising toward `d` meets
 * its `d`-neighbour at `h + rise` and its opposite neighbour at `h`. Level
 * cells reach their own height on every edge.
 */
export function edgeHeight(g: Grid, x: number, y: number, dir: keyof typeof DIR): number {
  const i = idx(g, x, y);
  const packed = g.ramp[i];
  const d = rampDir(packed);
  if (d === RAMP.NONE) return g.height[i];
  return g.height[i] + (d === RAMP[dir] ? rampRise(packed) : 0);
}

/**
 * Whether two ORTHOGONALLY adjacent paved cells are joined.
 *
 * Height participates: two paved cells at different heights are not connected,
 * neither visually nor topologically, so a road running off a plateau edge
 * resolves as a dead end rather than a straight. A ramp is what bridges a step
 * — and because the RENDER MASK and the CONNECTIVITY GRAPH both call this, a
 * road that looks joined is joined. Two predicates would drift.
 */
export function connects(
  g: Grid,
  x: number,
  y: number,
  dir: keyof typeof DIR,
): boolean {
  const [dx, dy] = NEIGHBOUR[dir];
  const nx = x + dx, ny = y + dy;
  if (!isPaved(g, x, y) || !isPaved(g, nx, ny)) return false;
  const here = edgeHeight(g, x, y, dir);
  const there = edgeHeight(g, nx, ny, OPPOSITE[dir]);
  return here === there;
}

export const OPPOSITE: Record<keyof typeof DIR, keyof typeof DIR> = {
  N: "S", E: "W", S: "N", W: "E",
};

/**
 * Eight-bit connection mask for a cell.
 *
 * A diagonal counts only when the cell itself is paved and level with it —
 * diagonals exist to tell a wide road's inside from a junction, and a diagonal
 * across a step is neither.
 */
export function maskAt(g: Grid, x: number, y: number): number {
  if (!isPaved(g, x, y)) return 0;
  let m = 0;
  for (const dir of ["N", "E", "S", "W"] as const) {
    if (connects(g, x, y, dir)) m |= DIR[dir];
  }
  const h = g.height[idx(g, x, y)];
  for (const dir of ["NE", "SE", "SW", "NW"] as const) {
    const [dx, dy] = DIAG_NEIGHBOUR[dir];
    const nx = x + dx, ny = y + dy;
    if (!isPaved(g, nx, ny)) continue;
    if (g.height[idx(g, nx, ny)] !== h) continue;
    m |= DIAG[dir];
  }
  return m;
}

/** Cells whose mask a change at `(x, y)` can alter: itself and all 8 neighbours. */
export function maskDirtyCells(g: Grid, x: number, y: number) {
  const out: { x: number; y: number }[] = [];
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (inBounds(g, x + dx, y + dy)) out.push({ x: x + dx, y: y + dy });
    }
  }
  return out;
}
