/**
 * WHICH WATER IS ONE SHEET, which is not the same question as which water is
 * one simulation.
 *
 * The mesh is built from CORNERS: four columns meet at one, and what is drawn
 * there is their average. That works while every corner touches one body of
 * water and falls apart the moment it touches two — a sheet on a plateau and
 * the lake at the foot of its cliff have no single height, no single colour
 * and no single opacity between them.
 *
 * The old answer was to split a corner's contributors by the BED they stand
 * on, keep two groups, and merge them back if the lower one's surface came out
 * above the higher one's bed. It is a reasonable guess and it survived a long
 * time, because on a heightfield the bed IS the identity of a body. Two things
 * broke it at once:
 *
 *   - A BRIDGE. The deck and the channel under it are two bodies in the same
 *     column, and only the HIGH group ever carried depth, foam, flow or
 *     opacity — so the river under a span was drawn at the right height with
 *     the deck's appearance. Measured on a culvert: alpha 235 and shown depth
 *     9.57 in the open channel, alpha 23 and 0.04 under the span, snapping
 *     back on the far side. That is the hard break at the mouth of every span.
 *
 *   - A PARAPET. A deck's kerb stands two half steps over its own deck, so it
 *     is a different bed, so it became its own group — and being one column it
 *     demoted the whole deck's water into the low bucket along with the river
 *     twenty half steps below. Contributor counts along one span ran 4 4 4 4,
 *     1, 3, 4 4, 2, 4 4 4, 1, 4 4: the averaging wobbling column by column
 *     exactly where the eye is.
 *
 * So the grouping is not a guess any more. Two wet slots are the same sheet
 * if, and exactly if, BOTH of the rules the solver already owns say so:
 *
 *   1. they are CONNECTED — their vertical intervals overlap, so there is no
 *      solid between them. This is what keeps a deck out of the channel it
 *      spans. @see fluid/slots
 *   2. there is no FALL between them — their surfaces are within {@link
 *      FALL_MIN}, the engine's own "a drop you would hesitate to step off".
 *      This is what keeps a plateau out of the lake below it, and it is the
 *      same number `markCliffs` spawns waterfalls on.
 *
 * Neither is new and neither is a rendering opinion. One rule, two consumers.
 *
 * AND IT CANNOT TEAR, which is the property the bed rule was chosen for and
 * the thing any replacement has to keep. A column asks a corner for ITS OWN
 * body's value, and it contributed to that corner under that body — so the
 * value is always there and always the one it helped make. Two columns of one
 * sheet cannot disagree about which group they are in, because they are not
 * deciding: the fill decided once, for the edge between them.
 */
import { surfaceAt, type ColumnField } from "../../fluid/columns";
import { FALL_MIN } from "../../fluid/falls";
import { connected } from "../../fluid/slots";

/** A slot with no water in it belongs to no sheet. */
export const NO_BODY = -1;

export type Bodies = {
  /**
   * Which sheet each SLOT belongs to, or {@link NO_BODY}.
   *
   * Indexed like every other per-slot array — `a * cells + column` — so the
   * ground's sheet and the deck's are the same array at different offsets.
   */
  readonly at: Int32Array;
  /** Union-find scratch, reused across frames so a rebuild allocates nothing. */
  readonly parent: Int32Array;
  /** How many sheets the last rebuild found. */
  n: number;
  /**
   * THE REGION THE LAST REBUILD COVERED, so this one can clear it.
   *
   * A rebuild only walks the water's own active box, which is the whole point
   * — a dry map should cost nothing. But a box that SHRINKS leaves last
   * frame's ids standing outside the new one, and a stale id is worse than no
   * id: it is a number that can equal a live sheet's, so two puddles that
   * have nothing to do with each other come out as one.
   *
   * It never mattered while the only reader was the mesh builder, which reads
   * exactly where it writes. It matters the moment the whole array is handed
   * to a device. @see findBodies
   */
  readonly was: { x0: number; y0: number; x1: number; y1: number };
};

export function createBodies(f: ColumnField): Bodies {
  const n = f.cells * f.layers;
  return {
    at: new Int32Array(n).fill(NO_BODY),
    parent: new Int32Array(n),
    n: 0,
    was: { x0: 0, y0: 0, x1: -1, y1: -1 },
  };
}

/** Union-find root, with path halving — flat enough, and no recursion. */
function root(parent: Int32Array, i: number): number {
  let r = i;
  while (parent[r] !== r) {
    parent[r] = parent[parent[r]];
    r = parent[r];
  }
  return r;
}

/**
 * Whether two wet slots are the same sheet. The whole rule, in one place.
 *
 * `ia` and `jb` are slot indices, and the two columns are neighbours.
 */
export function sameSheet(f: ColumnField, ia: number, jb: number): boolean {
  const { ground, roof } = f;
  if (!connected(ground[ia], roof[ia], ground[jb], roof[jb])) return false;
  // A FALL IS IN THE GROUND, not in the surface, and that distinction is the
  // whole of the second rule. Written as "their surfaces are more than a
  // fall apart" it also fired on WAVES: a closed basin with the weather on
  // has crests a fall clear of the troughs beside them, and 101 corners of
  // one rippling pool came out holding two sheets. A sheet that splits when
  // a wave goes through it is a sheet that changes colour when a wave goes
  // through it.
  //
  // This is `dropAt`'s test, symmetrised — the same one `markCliffs` spawns
  // waterfalls on, which is what makes "there is a fall here" one fact
  // rather than two opinions. Either bed standing a fall clear of what is
  // beside it is a lip; a ripple cannot make one, because a ripple does not
  // move the bed.
  return !(ground[ia] - beside(f, jb) >= FALL_MIN
    || ground[jb] - beside(f, ia) >= FALL_MIN);
}

/** Where a slot's water stands, or its bed where it is dry. @see besideAt */
const beside = (f: ColumnField, j: number) =>
  f.depth[j] > f.params.dryDepth ? surfaceAt(f, j) : f.ground[j];

/**
 * Label every wet slot in the region with the sheet it belongs to.
 *
 * Two passes: union every joined pair walking west-then-north, then walk
 * again turning roots into dense ids. Only the WEST and NORTH neighbours are
 * looked at, because the east and south ones will look back — each edge is
 * considered exactly once, which is what makes this cheap.
 *
 * The region is the water's own active box grown by one, since the mesh draws
 * a ring of corners round it.
 */
export function findBodies(
  f: ColumnField,
  region: { x0: number; y0: number; x1: number; y1: number },
  out: Bodies,
): void {
  const { nx, cells, layers, depth } = f;
  const { at, parent, was } = out;
  const x0 = Math.max(0, region.x0), x1 = Math.min(nx - 1, region.x1);
  const y0 = Math.max(0, region.y0), y1 = Math.min(f.ny - 1, region.y1);

  // 0. WHATEVER THE LAST REBUILD LABELLED, wiped before this one starts. The
  //    box moves and shrinks as the water does, and an id left outside the
  //    new one is a number that can collide with a live sheet's. @see was
  for (let a = 0; a < layers; a++) {
    const A = a * cells;
    for (let y = was.y0; y <= was.y1; y++) {
      at.fill(NO_BODY, A + y * nx + was.x0, A + y * nx + was.x1 + 1);
    }
  }
  was.x0 = x0; was.y0 = y0; was.x1 = x1; was.y1 = y1;

  // 1. EVERY SLOT WITH ANY WATER IN IT ITS OWN SHEET, and every dry one
  //    cleared. The clear is what stops last frame's labels being read where
  //    the water has gone.
  //
  //    ANY WATER, not `dryDepth` of it, and that is load-bearing. A sheet id
  //    is what lets a column read the corners it helped make: without one the
  //    builder skips it outright and the shader gathers no contributor for
  //    it, which is an alpha of nought. So membership decides what is drawn
  //    just as much as `showsWater` does, and if the two disagree the looser
  //    of them achieves nothing — which is exactly what happened when the
  //    cutoff came off the one and stayed on the other.
  for (let a = 0; a < layers; a++) {
    const A = a * cells;
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const ia = A + y * nx + x;
        at[ia] = NO_BODY;
        parent[ia] = depth[ia] > 0 ? ia : NO_BODY;
      }
    }
  }

  // 2. JOIN. Every slot of this column against every slot of the two
  //    neighbours behind it — a road's single slot has to be able to reach a
  //    bridge's upper one, which is a pairing and not a match of indices.
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const i = y * nx + x;
      for (let a = 0; a < layers; a++) {
        const ia = a * cells + i;
        if (parent[ia] === NO_BODY) continue;
        for (let b = 0; b < layers; b++) {
          if (x > x0) {
            const jb = b * cells + i - 1;
            if (parent[jb] !== NO_BODY && sameSheet(f, ia, jb)) {
              const ra = root(parent, ia), rb = root(parent, jb);
              if (ra !== rb) parent[ra] = rb;
            }
          }
          if (y > y0) {
            const jb = b * cells + i - nx;
            if (parent[jb] !== NO_BODY && sameSheet(f, ia, jb)) {
              const ra = root(parent, ia), rb = root(parent, jb);
              if (ra !== rb) parent[ra] = rb;
            }
          }
        }
      }
    }
  }

  // 3. DENSE IDS, so a caller can key a small table on one. A root labels
  //    itself the first time it is reached and everything under it follows.
  let n = 0;
  for (let a = 0; a < layers; a++) {
    const A = a * cells;
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const ia = A + y * nx + x;
        if (parent[ia] === NO_BODY) continue;
        const r = root(parent, ia);
        if (at[r] === NO_BODY) at[r] = n++;
        at[ia] = at[r];
      }
    }
  }
  out.n = n;
}
