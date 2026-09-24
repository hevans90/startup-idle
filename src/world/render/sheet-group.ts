/**
 * WHICH WATER IS ONE SHEET, decided AT THE CORNER, from the corner's own four
 * columns.
 *
 * This replaces `render/bodies`, which answered the same question by labelling
 * every wet slot on the map with a union-find id once a frame. The rule it used
 * was right and is kept here word for word — two wet slots are one sheet if
 * they are CONNECTED (their vertical intervals overlap, so there is no solid
 * between them) and there is no FALL between them (neither bed stands
 * {@link FALL_MIN} clear of what is beside it). What was wrong was not the
 * rule but WHERE it was evaluated.
 *
 * THE IDS WERE A FOURTH SOURCE OF TRUTH. They were computed on the host, from
 * the host's copy of the depths, and uploaded as a texture for a shader that
 * reads the DEVICE's depths. On the device path that copy is a band or a
 * sparse list behind — up to `CARRY_EVERY` readbacks behind while anything is
 * moving. So at a front moving onto or off a bridge a column was wet on the
 * device and unlabelled on the host, and the shader, which has no skip for an
 * unlabelled column, drew it as pseudo-sheet -1 gathered with every other
 * unlabelled column at that corner: the wrong height, the wrong colour, the
 * wrong opacity, flickering as the labels caught up. Measured with
 * `__deviceIds` on a span with a pour running over it: thirteen columns wet on
 * the device and unlabelled, and thirteen more labelled for water the device
 * no longer had, on one frame.
 *
 * A CORNER HAS EVERYTHING IT NEEDS. Four columns meet at one, every storey of
 * each, so at most `4 * layers` contributors — twelve — and four edges between
 * the orthogonally adjacent ones. The predicate reads depth, ground and roof,
 * all of which the device has FRESH. So the partition can be made on the spot,
 * by whoever is asking, out of data that is never stale. No texture, no
 * upload, no union-find over the map, no fourth source.
 *
 * AND IT STILL CANNOT TEAR, which is the property the whole scheme exists for.
 * A partition computed here is a pure function of the corner's own inputs, so
 * two columns asking the same corner get the same partition — not the same
 * answer by agreement, the same answer by construction. Two columns that share
 * a corner and are in one sheet share an EDGE of the corner's little graph, so
 * they land in one component and read one height. Two that do not are two
 * bodies of water and should not.
 *
 * A COMPONENT IS NAMED BY ITS MEMBERSHIP, as a bitmask over the twelve. That
 * is canonical — every member computes the identical mask — so it serves as
 * the key a corner's tiers are filed under on the CPU path exactly as a sheet
 * id used to, and as the membership test the shader needs, with no lowest-set-
 * bit search in between.
 *
 * TWO COPIES AND NO MORE, in one file, the way `corner-rule` carries its own:
 * the TypeScript the mesh builder calls and the tests pin, and a shader twin
 * generated once and emitted in whichever dialect asks.
 */
import type { ColumnField } from "../../fluid/columns";
import { surfaceAt } from "../../fluid/columns";
import { FALL_MIN } from "../../fluid/falls";
import { connected } from "../../fluid/slots";
import type { Dialect } from "./corner-rule";

/** The columns that meet at a corner. Four, and it is never anything else. */
export const CORNER_COLUMNS = 4;

/**
 * The most storeys a column can have. @see fluid/field's TIERS
 *
 * Only the scratch below needs it — the rule itself reads `f.layers` — and it
 * is stated rather than imported because `fluid` must not depend on `world`
 * and this file would then be the only edge the other way.
 */
const TIERS_MAX = 3;

/**
 * Where a slot's water stands, or its bed where it is dry.
 *
 * The twin of the solver's `besideAt`. Both slots of a join are wet by the
 * time this matters, so only the wet branch is ever taken there — it keeps
 * the dry one because the rule is stated over any two slots.
 *
 * IN THE SHADER'S PRECISION, and that is not a detail. While the grouping was
 * a flood fill on the host, both paths read the ONE answer it uploaded, so it
 * did not matter what precision it was reached in. Decided here, each path
 * evaluates the rule for itself — the host in double, the device in float —
 * and the second half of the rule is a THRESHOLD. `floor + depth` differs in
 * its last bits between the two, so a surface sitting within an ulp of a fall
 * from its neighbour would join the component on one path and not on the
 * other: one whole column in or out of a corner's average. `Math.fround` puts
 * the host's arithmetic in the device's, so the two evaluate the same
 * comparison. `dryDepth` gets the same treatment because 0.02 is not
 * representable in a float at all, so "is this wet" is a second threshold the
 * two could straddle.
 *
 * TO BE CLEAR ABOUT WHAT THIS DID NOT FIX: it is not what the pixel
 * comparison is currently unhappy about. That divergence survives this
 * unchanged — see the note on the comparison in `water-compare`. This is a
 * precision hole closed on principle, not a measured repair.
 */
const beside = (f: ColumnField, j: number) =>
  f.depth[j] > Math.fround(f.params.dryDepth)
    ? Math.fround(surfaceAt(f, j))
    : f.ground[j];

/**
 * Whether two wet slots of NEIGHBOURING columns are the same sheet.
 *
 * The whole rule, in one place, and neither half of it is a rendering opinion:
 *
 *   1. CONNECTED — their vertical intervals overlap, so there is no solid
 *      between them. This is what keeps a deck out of the channel it spans,
 *      and it is `fluid/slots`' own predicate.
 *   2. NO FALL — neither bed stands {@link FALL_MIN} clear of what is beside
 *      it. This is what keeps a plateau's sheet out of the lake below it, and
 *      it is the same number `markCliffs` spawns waterfalls on.
 *
 * A FALL IS IN THE GROUND, not in the surface, and that distinction is the
 * whole of the second rule. Written as "their surfaces are more than a fall
 * apart" it also fired on WAVES: a closed basin with the weather on has crests
 * a fall clear of the troughs beside them, and 101 corners of one rippling
 * pool came out holding two sheets. A sheet that splits when a wave goes
 * through it is a sheet that changes colour when a wave goes through it.
 *
 * This is `dropAt`'s test, symmetrised — the same one `markCliffs` spawns
 * waterfalls on, which is what makes "there is a fall here" one fact rather
 * than two opinions. Either bed standing a fall clear of what is beside it is
 * a lip; a ripple cannot make one, because a ripple does not move the bed.
 */
export function sameSheet(f: ColumnField, ia: number, jb: number): boolean {
  const { ground, roof } = f;
  // The first half is safe in either precision: grounds and roofs are half
  // steps, which are exact in a float. Only the second compares a SUM.
  if (!connected(ground[ia], roof[ia], ground[jb], roof[jb])) return false;
  return !(Math.fround(ground[ia] - beside(f, jb)) >= FALL_MIN
    || Math.fround(ground[jb] - beside(f, ia)) >= FALL_MIN);
}

/**
 * The four EDGES of a corner's little graph, as pairs of quadrants.
 *
 * Quadrant `q` of corner `(vx, vy)` is the column at
 * `(vx - 1 + (q & 1), vy - 1 + (q >> 1))`, which is the enumeration
 * `cornerOf` has always walked. The orthogonally adjacent pairs are 0-1 and
 * 2-3 across, 0-2 and 1-3 along. THE DIAGONALS ARE NOT EDGES, because water
 * does not move diagonally in the solver either — two diagonal columns can
 * still land in one component, through a neighbour they both touch.
 */
export const quadA = (e: number) => (e < 2 ? e * 2 : e - 2);
export const quadB = (e: number) => (e < 2 ? e * 2 + 1 : e);

/** Contributor `k`'s column and slot at corner `(vx, vy)`. @see quadA */
export const contribX = (vx: number, k: number, layers: number) =>
  vx - 1 + (Math.floor(k / layers) & 1);
export const contribY = (vy: number, k: number, layers: number) =>
  vy - 1 + (Math.floor(k / layers) >> 1);

/** Which contributor of corner `(vx, vy)` slot `a` of column `(cx, cy)` is. */
export const contribOf = (
  vx: number, vy: number, cx: number, cy: number, a: number, layers: number,
) => ((cy - vy + 1) * 2 + (cx - vx + 1)) * layers + a;

/**
 * The COMPONENT of contributor `k` at corner `(vx, vy)`, as a bitmask.
 *
 * Bit `m` is set when contributor `m` is in the same sheet as `k`. A dry or
 * off-map `k` comes back as itself alone, which is what makes a caller that
 * is not really there gather nothing.
 *
 * Grown a round at a time and stopped the moment a round adds nobody. The
 * bound is the number of contributors because that is the longest a shortest
 * path between two of them can be; in practice a full corner of one sheet is
 * finished in the first round and confirmed in the second.
 */
export function cornerMask(
  f: ColumnField, vx: number, vy: number, k: number,
): number {
  const layers = f.layers, n = CORNER_COLUMNS * layers;
  let comp = 1 << k;
  for (let r = 0; r < n; r++) {
    let grew = false;
    for (let e = 0; e < CORNER_COLUMNS; e++) {
      const qa = quadA(e), qb = quadB(e);
      for (let a = 0; a < layers; a++) {
        for (let b = 0; b < layers; b++) {
          const ka = qa * layers + a, kb = qb * layers + b;
          const ina = (comp >> ka) & 1, inb = (comp >> kb) & 1;
          if (ina === inb) continue;
          if (!joinedAt(f, vx, vy, ka, kb)) continue;
          comp |= (1 << ka) | (1 << kb);
          grew = true;
        }
      }
    }
    if (!grew) break;
  }
  return comp;
}

/** Whether contributors `ka` and `kb` of a corner are one sheet. */
function joinedAt(
  f: ColumnField, vx: number, vy: number, ka: number, kb: number,
): boolean {
  const layers = f.layers;
  const ax = contribX(vx, ka, layers), ay = contribY(vy, ka, layers);
  const bx = contribX(vx, kb, layers), by = contribY(vy, kb, layers);
  if (ax < 0 || ay < 0 || ax >= f.nx || ay >= f.ny) return false;
  if (bx < 0 || by < 0 || bx >= f.nx || by >= f.ny) return false;
  const ia = (ka % layers) * f.cells + ay * f.nx + ax;
  const jb = (kb % layers) * f.cells + by * f.nx + bx;
  const dry = Math.fround(f.params.dryDepth);
  if (f.depth[ia] <= dry || f.depth[jb] <= dry) return false;
  return sameSheet(f, ia, jb);
}

/**
 * A contributor of `mask` that the corner one step away ALSO holds, or -1.
 *
 * The lighting asks a corner either side of the one it is drawing how high the
 * same water stands there — see `nearby` — and a component decided AT a corner
 * says nothing about a corner it does not touch. Two corners a step apart do
 * share two columns, though, so the bridge between them is a contributor that
 * lies in both: this picks the LOWEST-indexed member of the component on the
 * shared edge.
 *
 * LOWEST, and that is the whole point. Every column of a component computes
 * the identical mask, so every one of them picks the identical bridge and asks
 * the neighbouring corner the identical question. Picked per ASKER instead —
 * the obvious thing, clamping the asking column into the corner being asked —
 * four columns of one sheet get four different answers for the corner they
 * share, and since each quad draws its own copy of that vertex, the shading
 * comes apart along every seam between them.
 */
export function sharedContrib(
  mask: number, dx: number, dy: number, layers: number,
): number {
  for (let m = 0; m < CORNER_COLUMNS * layers; m++) {
    if (((mask >> m) & 1) === 0) continue;
    const q = Math.floor(m / layers);
    if (dx < 0 && (q & 1) !== 0) continue;
    if (dx > 0 && (q & 1) !== 1) continue;
    if (dy < 0 && (q >> 1) !== 0) continue;
    if (dy > 0 && (q >> 1) !== 1) continue;
    return m;
  }
  return -1;
}

/**
 * EVERY contributor's component at one corner, in one pass.
 *
 * {@link cornerMask} answers for one contributor and is the rule; the shader
 * wants exactly that, because a vertex asks about itself and nothing else. The
 * mesh builder asks about all twelve — the scatter, the quad and both side
 * faces come back to the same corner a dozen times over — so it gets the
 * partition once and reads it, which is a union-find over at most twelve nodes
 * instead of twelve floods.
 *
 * Writes `4 * layers` masks into `out` at `at`. A test holds it to agreeing
 * with the rule on every corner of a map with a span, a cliff and a shore on
 * it, because a fast path that disagrees with the rule is worse than no fast
 * path.
 */
export function cornerMasksInto(
  f: ColumnField, vx: number, vy: number, out: Int32Array, at: number,
): void {
  const layers = f.layers, n = CORNER_COLUMNS * layers;
  // Union-find, on the stack. `n` is twelve at the very most, so a linear
  // find is cheaper than the bookkeeping that would avoid it.
  const parent = PARENT;
  for (let k = 0; k < n; k++) parent[k] = k;
  for (let e = 0; e < CORNER_COLUMNS; e++) {
    const qa = quadA(e), qb = quadB(e);
    for (let a = 0; a < layers; a++) {
      for (let b = 0; b < layers; b++) {
        const ka = qa * layers + a, kb = qb * layers + b;
        if (!joinedAt(f, vx, vy, ka, kb)) continue;
        let ra = ka; while (parent[ra] !== ra) ra = parent[ra];
        let rb = kb; while (parent[rb] !== rb) rb = parent[rb];
        if (ra !== rb) parent[ra] = rb;
      }
    }
  }
  // TWO SWEEPS, because a root's full membership is only known once every
  // member has found it.
  for (let k = 0; k < n; k++) ROOT[k] = 0;
  for (let k = 0; k < n; k++) {
    let r = k; while (parent[r] !== r) r = parent[r];
    ROOT[r] |= 1 << k;
  }
  for (let k = 0; k < n; k++) {
    let r = k; while (parent[r] !== r) r = parent[r];
    out[at + k] = ROOT[r];
  }
}

/** Scratch for {@link cornerMasksInto}. Twelve is the most there can be. */
const PARENT = new Int32Array(CORNER_COLUMNS * TIERS_MAX);
const ROOT = new Int32Array(CORNER_COLUMNS * TIERS_MAX);

/**
 * The same rule as shader source.
 *
 * On top of what `cornerRuleSource` already asks the host for — `inside`,
 * `slots`, `depthAt`, `groundAt`, `roofAt`, `dryDepth`, `fallMin` and GLSL's
 * `select` — this needs two one-line helpers, and needs them from the host for
 * the same reason `select` comes from there: WGSL wants a `u32` on the right
 * of a shift and GLSL has no `u32` at all, so the two cannot be spelled the
 * same way. `bitOf(k)` is the bit for contributor `k` and `bitAt(m, k)` is 1
 * when it is set.
 *
 * NO BACKTICKS IN HERE — see the note at the top of the shared header.
 */
export function sheetGroupSource(dialect: Dialect): string {
  const wgsl = dialect === "wgsl";
  const NUM = wgsl ? "let" : "float";
  const INT = wgsl ? "let" : "int";
  const MUT = wgsl ? "var" : "int";
  const LOOP = wgsl ? "var" : "int";
  return `
${wgsl
    ? "fn joinedAt(vx: i32, vy: i32, ka: i32, kb: i32) -> i32 {"
    : "int joinedAt(int vx, int vy, int ka, int kb) {"}
  // The two contributors, unpacked from the corner's own enumeration — see
  // the twin in sheet-group.ts, which is the same arithmetic.
  ${INT} qa = ka / slots();
  ${INT} qb = kb / slots();
  ${INT} ax = vx - 1 + (qa & 1);
  ${INT} ay = vy - 1 + (qa >> 1);
  ${INT} bx = vx - 1 + (qb & 1);
  ${INT} by = vy - 1 + (qb >> 1);
  if (!inside(ax, ay)) { return 0; }
  if (!inside(bx, by)) { return 0; }
  ${INT} sa = ka % slots();
  ${INT} sb = kb % slots();
  // DRY SLOTS JOIN NOTHING. The grouping is over the water, and a bed with no
  // water on it is not a member of any sheet.
  ${NUM} da = depthAt(ax, ay, sa);
  ${NUM} db = depthAt(bx, by, sb);
  if (da <= dryDepth()) { return 0; }
  if (db <= dryDepth()) { return 0; }
  ${NUM} ga = groundAt(ax, ay, sa);
  ${NUM} gb = groundAt(bx, by, sb);
  ${NUM} ra = roofAt(ax, ay, sa);
  ${NUM} rb = roofAt(bx, by, sb);
  // CONNECTED: their vertical intervals overlap, so there is nothing solid
  // between them. fluid/slots' own predicate, written out.
  if (min(ra, rb) <= max(ga, gb)) { return 0; }
  // AND NO FALL BETWEEN THEM, off the BED and not off the surface, so a wave
  // cannot split a pool. Both are wet, so where each stands is its wet top.
  ${NUM} wa = min(ga + da, ra);
  ${NUM} wb = min(gb + db, rb);
  if (ga - wb >= fallMin()) { return 0; }
  if (gb - wa >= fallMin()) { return 0; }
  return 1;
}

${wgsl
    ? "fn cornerMask(vx: i32, vy: i32, k: i32) -> i32 {"
    : "int cornerMask(int vx, int vy, int k) {"}
  // THE COMPONENT OF CONTRIBUTOR k, as a bitmask over the corner's at most
  // twelve. Grown a round at a time and stopped the moment a round adds
  // nobody — a full corner of one sheet is done in the first round and
  // confirmed in the second. @see the twin in sheet-group.ts
  ${INT} n = 4 * slots();
  ${MUT} comp = bitOf(k);
  for (${LOOP} r = 0; r < n; r = r + 1) {
    ${MUT} grew = 0;
    for (${LOOP} e = 0; e < 4; e = e + 1) {
      // 0-1 and 2-3 across, 0-2 and 1-3 along. The diagonals are not edges.
      ${INT} qa = select(e - 2, e * 2, e < 2);
      ${INT} qb = select(e, e * 2 + 1, e < 2);
      for (${LOOP} a = 0; a < slots(); a = a + 1) {
        for (${LOOP} b = 0; b < slots(); b = b + 1) {
          ${INT} ka = qa * slots() + a;
          ${INT} kb = qb * slots() + b;
          if (bitAt(comp, ka) == bitAt(comp, kb)) { continue; }
          if (joinedAt(vx, vy, ka, kb) == 0) { continue; }
          comp = comp | bitOf(ka) | bitOf(kb);
          grew = 1;
        }
      }
    }
    if (grew == 0) { break; }
  }
  return comp;
}

${wgsl
    ? "fn sharedOf(mask: i32, dx: i32, dy: i32) -> i32 {"
    : "int sharedOf(int mask, int dx, int dy) {"}
  // The lowest-indexed member of the component that the corner one step away
  // also holds — see the twin in sheet-group.ts, and why it must be the
  // lowest rather than the asker's own.
  for (${LOOP} m = 0; m < 4 * slots(); m = m + 1) {
    if (bitAt(mask, m) == 0) { continue; }
    ${INT} q = m / slots();
    if (dx < 0 && (q & 1) != 0) { continue; }
    if (dx > 0 && (q & 1) != 1) { continue; }
    if (dy < 0 && (q >> 1) != 0) { continue; }
    if (dy > 0 && (q >> 1) != 1) { continue; }
    return m;
  }
  return -1;
}

${wgsl
    ? "fn contribOf(vx: i32, vy: i32, cx: i32, cy: i32, a: i32) -> i32 {"
    : "int contribOf(int vx, int vy, int cx, int cy, int a) {"}
  // Which contributor of this corner slot a of column (cx, cy) is.
  return ((cy - vy + 1) * 2 + (cx - vx + 1)) * slots() + a;
}
`;
}
