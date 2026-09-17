/**
 * World v2 — isometric projection core.
 *
 * Conventions that differ deliberately from v1 (`src/office/`):
 *
 *  1. A cell's canonical position is its **diamond CENTRE**, never the sprite
 *     anchor. v1 stores anchors and applies frame geometry at every call site,
 *     which is how it ended up correcting picking by 66px where the art needs
 *     99. Here {@link spriteY} is the only function that knows about frames.
 *
 *  2. Closed-form scalar maths, no `mathjs`. v1 allocates a matrix per call,
 *     which is fine for one-shot builds but not for per-cell work.
 *
 *  3. Height is measured in **half steps**, so it stays an integer.
 *
 * Measured against the art (see `dev/roadlabel.html` and slope-labels.json):
 * ground frames are 132×99 whose diamond top face spans rows 0–66 (centred at
 * row 33) with a 33px skirt below, and the tileset contains exactly two rise
 * heights — ~16px and ~33px.
 */

/** Full width of a tile's diamond. */
/**
 * Ramp direction, stored per cell. 0 = level.
 *
 * EXPLICIT rather than inferred from neighbouring heights: a ramp is a
 * deliberate placement, and inferring it would mean every height edit silently
 * reshaped the terrain around it. The value names the edge the cell rises
 * TOWARD, matching the labeller's N/E/S/W (see src/iso/dir.ts).
 */
export const RAMP = { NONE: 0, N: 1, E: 2, S: 3, W: 4 } as const;
export type RampDir = (typeof RAMP)[keyof typeof RAMP];

/** Ramp direction as the labeller names it, for reading slope-labels.json. */
export const RAMP_NAME = ["", "N", "E", "S", "W"] as const;

/**
 * Rise is packed into the SAME byte as the direction, in the high bit.
 *
 * The artset has exactly two rises — ×0.5 (1 half step) and ×1 (2 half steps)
 * — so one bit covers it, and a single `Uint8Array` stays the whole ramp layer.
 * The bit CLEAR means a full step, so the common case is the plain direction
 * value and a pre-rise file decodes as full-step ramps rather than zero-rise
 * ones (a zero rise would be a ramp that is silently flat).
 */
export const RAMP_HALF = 8;

export const packRamp = (dir: RampDir, riseUnits: 1 | 2): number =>
  dir === RAMP.NONE ? RAMP.NONE : dir | (riseUnits === 1 ? RAMP_HALF : 0);

export const rampDir = (packed: number): RampDir => (packed & 7) as RampDir;

/** Rise in HALF steps: 0 for a level cell, else 1 (×0.5) or 2 (×1). */
export const rampRise = (packed: number): number =>
  (packed & 7) === RAMP.NONE ? 0 : (packed & RAMP_HALF ? 1 : 2);

export const TILE_W = 132;
/** Height of the diamond top face (2:1 isometric). */
export const TILE_DIAMOND_H = 66;
/** Half-width: one step in `x` moves this far horizontally. */
export const HW = TILE_W / 2; // 66
/** Half-height: one step in `x` moves this far vertically. */
export const HH = TILE_DIAMOND_H / 2; // 33

/**
 * One elevation unit — a HALF step.
 *
 * The artset has exactly two rises and the engine matches it:
 *   half step  ~16px = 1 unit
 *   full step  ~33px = 2 units, which is also a ground slab's own skirt
 *
 * Using the half as the unit keeps heights integral, so the height field is a
 * plain `Int8Array` with no fractions anywhere.
 */
export const HEIGHT_UNIT = HH / 2; // 16.5
/** A full step: two units, and exactly one slab skirt. */
export const HEIGHT_STEP = HH; // 33

/**
 * Height of a standard ground frame: the 66px diamond plus one 33px skirt.
 *
 * SLOPE frames are taller — the paved ramps rising up-screen are 131 — but the
 * extra is drawn at the BOTTOM, a deeper skirt beneath the low side, with the
 * low side itself at the same frame rows as a flat tile's. So a slope tile is
 * anchored by THIS height, not its own: measured on landscapeTiles_115, its
 * low-side vertex sits 68 rows from the frame bottom against a flat tile's 67,
 * whereas anchoring by the real 131 drops it ~30px — a visible step down.
 */
export const GROUND_FRAME_H = TILE_DIAMOND_H + HEIGHT_STEP;

export type Cell = { x: number; y: number };

/**
 * Cell + height → world position of its diamond **centre**.
 *
 * Note `wx` does not depend on `h` at all. That single property is what keeps
 * both depth sorting and picking cheap: height slides a tile straight up the
 * screen and never sideways.
 */
export function cellToWorld(x: number, y: number, h = 0, s = 1) {
  return {
    wx: (x - y) * HW * s,
    wy: (x + y) * HH * s - h * HEIGHT_UNIT * s,
  };
}

/** Inverse of {@link cellToWorld} for a KNOWN height. Fractional cell coords. */
export function worldToCellF(wx: number, wy: number, h = 0, s = 1) {
  const a = wx / (HW * s);
  const b = (wy + h * HEIGHT_UNIT * s) / (HH * s);
  return { x: (a + b) / 2, y: (b - a) / 2 };
}

/**
 * World point → integer cell, for a KNOWN height.
 *
 * The `+HH` matters: flooring the inverse selects a diamond centred half a
 * cell **below** the visible one, so the query is shifted down to line the two
 * up. Without it every pick is one cell out along the y axis.
 *
 * CONFIRMED EMPIRICALLY, not just derived. The editor's calibration panel
 * perturbs this offset and reports whether the cursor lands inside the chosen
 * diamond; `+HH` with a zero nudge tracks correctly at every zoom, and any
 * other value breaks it. That check exists because v1's equivalent correction
 * is 33px wrong and survived unnoticed — nothing there ever exercised it.
 */
export function worldToCell(wx: number, wy: number, h = 0, s = 1): Cell {
  const f = worldToCellF(wx, wy + HH * s, h, s);
  return { x: Math.floor(f.x), y: Math.floor(f.y) };
}

/**
 * Screen Y for a bottom-anchored sprite whose diamond top face sits at the top
 * of its frame. `wy` is the cell's diamond centre.
 *
 * The skirt is per-frame because frame heights vary across the atlases
 * (99, 83, 127, 131…): `skirt = frameH - TILE_DIAMOND_H`.
 */
export function spriteY(wy: number, frameH: number, s = 1) {
  return wy + (HH + (frameH - TILE_DIAMOND_H)) * s;
}

/**
 * Painter's-algorithm band index. Larger = nearer the camera.
 *
 * Height is deliberately absent. For a heightmap (one surface per cell, no
 * overhangs) a cell with a larger `x + y` is always physically nearer whatever
 * either height is, so `x + y` remains a correct draw order and elevation
 * costs the renderer nothing.
 */
export function bandOf(x: number, y: number) {
  return x + y;
}

/** Total number of bands on a `w × h` map. */
export function bandCount(w: number, h: number) {
  return w + h - 1;
}

/** Largest rise any ramp frame has, in half steps (the artset has ×0.5 and ×1 only). */
export const MAX_RISE = 2;

/**
 * The surface of one cell: its BASE height plus, for a ramp, how much it rises
 * and toward which edge.
 *
 * `height` is the LOW edge. The named ramp edge sits at `height + rise`, so a
 * ramp joins a cell at `h` to a neighbour at `h + rise` across that edge —
 * which is the direction you think in when building a ramp up to a plateau.
 */
export type Surface = { height: number; ramp: number; rise: number };

/** Surface of a cell, or null off-map. */
export type SurfaceAt = (x: number, y: number) => Surface | null;

/**
 * Face coordinates are half-open, [0, 1), so a point exactly on the edge shared
 * by two cells belongs to precisely one of them. Solving in floating point puts
 * such a point at 0.9999999999999996 rather than 1, which would hand the cell
 * the edge it does not own — and, worse, would decide it by rounding noise, so
 * the same geometry could resolve differently at a different scale. Snapping
 * first makes the boundary deterministic and matches the `floor` convention
 * {@link worldToCell} already uses.
 */
const EDGE_EPS = 1e-9;
const snapEdge = (t: number) =>
  Math.abs(t) < EDGE_EPS ? 0 : Math.abs(t - 1) < EDGE_EPS ? 1 : t;

/**
 * Where a world point falls INSIDE a cell's top face, or null if it misses.
 *
 * Returns the face-local coordinates `u` (along +x) and `v` (along +y), each in
 * [0, 1). Exact for a tilted face as well as a flat one, which is the whole
 * reason this exists: a ramp's top face is a sheared parallelogram, and testing
 * it as a flat diamond mis-attributes points along its high and low edges.
 *
 * The solve. Under the shifted inversion (see {@link worldToCell}) a point maps
 * to continuous coordinates whose sum and difference are both known:
 *
 *     x̃ − ỹ = wx / (HW·s)                    ⇒ u − v = k − (X − Y) = m
 *     x̃ + ỹ = (wy + HH·s + h·HEIGHT_UNIT·s) / (HH·s)
 *
 * The cell's height under the point is linear in the face coordinates,
 * `h = height + rise·(a + b·v)`, so substituting leaves ONE linear equation in
 * `v`. The `(a, b)` pair is all that distinguishes the four ramp directions —
 * writing four separate formulas by hand is how sign errors get in.
 */
export function faceCoords(
  wx: number,
  wy: number,
  X: number,
  Y: number,
  surf: Surface,
  s = 1,
): { u: number; v: number } | null {
  const hws = HW * s, hhs = HH * s, unit = HEIGHT_UNIT * s;
  const k = wx / hws;
  const m = k - (X - Y);
  if (m <= -1 || m >= 1) return null;      // wrong diagonal column entirely

  const rise = surf.ramp === RAMP.NONE ? 0 : surf.rise;
  // t = a + b·v, where t is 0 at the low edge and 1 at the named (high) edge
  let a = 0, b = 0;
  switch (rise === 0 ? RAMP.NONE : surf.ramp) {
    case RAMP.S: a = m; b = 1; break;        // high toward +x, and u = v + m
    case RAMP.N: a = 1 - m; b = -1; break;   // high toward −x
    case RAMP.W: a = 0; b = 1; break;        // high toward +y
    case RAMP.E: a = 1; b = -1; break;       // high toward −y
    default: break;                          // level: t is unused
  }

  const W = wy + hhs;                        // the shifted sample point
  const denom = 2 * hhs - rise * b * unit;   // never 0: |rise·unit| ≤ hhs < 2·hhs
  const v = snapEdge((W - (X + Y) * hhs - m * hhs + surf.height * unit + rise * a * unit) / denom);
  const u = snapEdge(v + m);
  if (v < 0 || v >= 1 || u < 0 || u >= 1) return null;
  return { u, v };
}

/** Height of a cell's surface at face coordinates, in half steps. */
export function surfaceHeight(surf: Surface, u: number, v: number): number {
  if (surf.ramp === RAMP.NONE || surf.rise === 0) return surf.height;
  const t =
    surf.ramp === RAMP.S ? u :
    surf.ramp === RAMP.N ? 1 - u :
    surf.ramp === RAMP.W ? v : 1 - v;
  return surf.height + surf.rise * t;
}

/**
 * Pick the visible cell under a world point when the height is UNKNOWN.
 *
 * With elevation a screen point is ambiguous — it could be the top of a near
 * hill, or lower ground further back. But the ambiguity is only ever along ONE
 * line, because `wx` fixes `x − y` whatever the height. So the candidates form
 * a single diagonal, and resolving is a short march along it.
 *
 * Marched FRONT TO BACK (descending `x + y`) and the first hit wins, which is
 * exactly right for a painter's-order scene: the nearest surface is the one you
 * can see. For a heightmap with no overhangs a larger `x + y` is always nearer
 * the camera regardless of either cell's height (§3.1), so "nearest" and
 * "largest band" are the same thing.
 *
 * One candidate per band, not two: `x − y` must be an integer within 1 of the
 * point's own `k`, which leaves two options, and they have opposite parity —
 * so the band's parity picks exactly one.
 *
 * Bounded by the height range plus one ramp's rise, so this is O(range), a
 * handful of iterations, not O(cells).
 *
 * TOP FACES ONLY. Clicking a cliff wall resolves to the cell behind it rather
 * than returning a side face, which is the right default for a builder.
 */
export function pickCell(
  wx: number,
  wy: number,
  surfaceAt: SurfaceAt,
  range: { min: number; max: number },
  s = 1,
): Cell | null {
  const hws = HW * s, hhs = HH * s, unit = HEIGHT_UNIT * s;
  const k = wx / hws;
  const W = wy + hhs;

  // A cell at height h whose face contains the point satisfies
  //   X + Y = (W + h·unit)/hhs − (u + v),  with u + v ∈ [0, 2)
  // so bound the band range from the extreme heights and add a little slack.
  const bandAt = (h: number) => (W + h * unit) / hhs;
  const hi = Math.floor(bandAt(range.max + MAX_RISE)) + 1;
  const lo = Math.ceil(bandAt(range.min)) - 3;

  for (let d = hi; d >= lo; d--) {
    // K ≡ d (mod 2) and |k − K| < 1 — exactly one of floor/ceil qualifies
    const kf = Math.floor(k);
    const K = ((kf % 2) + 2) % 2 === ((d % 2) + 2) % 2 ? kf : kf + 1;
    const x = (d + K) / 2, y = (d - K) / 2;
    if (!Number.isInteger(x) || !Number.isInteger(y)) continue;
    const surf = surfaceAt(x, y);
    if (!surf) continue;
    if (faceCoords(wx, wy, x, y, surf, s)) return { x, y };
  }
  return null;
}
