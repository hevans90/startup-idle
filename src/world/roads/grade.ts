/**
 * World v2 — A ROAD GRADES ITS OWN GROUND. Dragged over a hill, a road needs
 * each of its cells within a step of the next, or it is two roads with a
 * cliff between them. This works out the heights a stroke's cells need: the
 * hill cut and the foot of it filled, by equal measure, until the run is a
 * flight of ramps. Pure; the store writes the heights in the same command as
 * the paving, so undo takes both back. @see derivedRamp, plans/roads-quality.md
 *
 * HELD WHERE THEY ARE: cells already paved; cells under water, bridged, built
 * on, or with a main or a sewer under them; and each end of the stroke — at
 * the road it is begun or let go beside, if there is one, else where the
 * ground is. A cell beside a road laid alongside takes that road's height:
 * the lanes of a wide road climb together.
 *
 * A JUNCTION IS LEVEL. A ramp tilts one way, so a road cannot leave one by
 * its side. Where a stroke meets a road on a ramp, that ramp is levelled —
 * its row across the road raised to the top of its climb and the row below
 * left to climb to it, or the row above brought down to climb in its place —
 * and where neither can be done the stroke is refused there.
 */
import { NEIGHBOUR } from "../../iso/dir";
import { MAX_RISE, RAMP, rampDir, rampRise } from "../iso";
import { idx, inBounds, structureAt, type Grid } from "../grid";
import { strokeCells, type Stroke } from "../edit/tools";

export type GradeCell = { x: number; y: number };

export type Grade = {
  /** The height each cell of the path is to stand at, in half steps, by its place along the path. */
  heights: number[];
  /** Cells whose ground moves — the path's, and a ramp's levelled for a junction: where, from, to. */
  moved: { x: number; y: number; from: number; to: number }[];
  /** Cells of the path the road cannot serve. */
  blocked: { x: number; y: number }[];
  /** How many more tiles the steepest refused climb needs; 0 when none is refused for its steepness. */
  short: number;
  /** Why the stroke is refused, to say to the player; empty when it is not. */
  why: string;
  /** The same in a few words, for beside the pointer while it is dragged. */
  brief: string;
};

const DIRS = ["N", "E", "S", "W"] as const;
/** A ramp's step toward its high edge, in (x, y); null for a level cell. */
const upOf = (g: Grid, i: number): readonly [number, number] | null => {
  const d = rampDir(g.ramp[i]);
  return d === RAMP.NONE ? null : NEIGHBOUR[DIRS[d - 1]];
};
const paved = (g: Grid, x: number, y: number) => inBounds(g, x, y) && g.paved[idx(g, x, y)] !== 0 && g.deck[idx(g, x, y)] === 0;

/** Whether a cell's ground is not the road's to move. */
function held(g: Grid, x: number, y: number): boolean {
  const i = idx(g, x, y);
  return g.paved[i] !== 0 || g.deck[i] !== 0 || g.pool[i] > 0 || g.inflow[i] > 0
    || g.main[i] !== 0 || g.sewer[i] !== 0 || structureAt(g, x, y) >= 0;
}

/** What to say of a refused climb, and of a junction that cannot be levelled. */
export const tooSteep = (short: number) => `Too steep here: the road needs ${short} more tile${short === 1 ? "" : "s"} to climb`;
export const ON_A_SLOPE = "A road can't join here: this slope can't be levelled for a junction";
const briefly = (short: number) => (short ? `Too steep · ${short} more tile${short === 1 ? "" : "s"}` : "Can't join on this slope");

/**
 * LEVEL A RAMP for a junction on it: the heights to write, and the height the
 * junction then stands at; null if it cannot be. The ramp's whole row across
 * its road is levelled with it. `was` reads a cell's height as already staged.
 */
function levelRamp(g: Grid, x: number, y: number, was: (i: number) => number): { writes: Map<number, number>; z: number } | null {
  const i0 = idx(g, x, y), up = upOf(g, i0);
  if (!up) return { writes: new Map(), z: was(i0) };
  const [ux, uy] = up, h = g.height[i0], r = rampRise(g.ramp[i0]);
  // THE ROW: the ramps beside this one across the road, the same climb from the same foot.
  const row: [number, number][] = [[x, y]];
  for (const sg of [1, -1]) {
    for (let k = 1; ; k++) {
      const nx = x + sg * k * uy, ny = y + sg * k * ux;
      if (!paved(g, nx, ny)) break;
      const j = idx(g, nx, ny);
      if (g.ramp[j] !== g.ramp[i0] || g.height[j] !== h) break;
      row.push([nx, ny]);
    }
  }
  const inRow = (cx: number, cy: number, dx: number, dy: number) => row.some(([rx, ry]) => rx + dx === cx && ry + dy === cy);
  /** The row a step `s` along the climb, if every cell of it is road — and, `alone`, with nothing joining it from the side; else null. */
  const rowAt = (s: number, alone = true): number[] | null => {
    const out: number[] = [];
    for (const [rx, ry] of row) {
      const cx = rx + s * ux, cy = ry + s * uy;
      if (!paved(g, cx, cy)) return null;
      if (alone && ![1, -1].every((sg) => { const nx = cx + sg * uy, ny = cy + sg * ux; return !paved(g, nx, ny) || inRow(nx, ny, s * ux, s * uy); })) return null;
      out.push(idx(g, cx, cy));
    }
    return out;
  };
  /** A row's one height, if its cells agree and none ramps another way; else null. */
  const levelOf = (cells: number[] | null): number | null =>
    cells && cells.every((j) => g.height[j] === g.height[cells[0]] && (g.ramp[j] === 0 || rampDir(g.ramp[j]) === rampDir(g.ramp[i0]))) ? g.height[cells[0]] : null;
  /** How many rows a levelling may reach along the road before it is given up. */
  const REACH = 8;

  // RAISED to the top of its climb, the rows below it brought up behind — each no more than a step under the
  // next — for as far as that takes: a flight of ramps moved a tile down the hill. Every row that then climbs
  // differently must be road alone, nothing joining it from the side.
  const ends = (k: number) => !row.some(([rx, ry]) => paved(g, rx + k * ux, ry + k * uy));
  const raise = (): Map<number, number> | null => {
    const writes = new Map<number, number>();
    for (const [rx, ry] of row) writes.set(idx(g, rx, ry), h + r);
    let next = h + r;
    for (let k = -1; k >= -REACH; k--) {
      // The road ends here, below: nothing more to bring up.
      if (ends(k)) return writes;
      const was = levelOf(rowAt(k, false));
      if (was === null || was > next) return null;
      const to = Math.max(was, next - MAX_RISE);
      // The row just below climbs to it anew, and any row brought up is climbed to anew: road alone, each.
      if ((k === -1 || to !== was) && !rowAt(k)) return null;
      if (to === was) return writes;
      for (const j of rowAt(k)!) writes.set(j, to);
      next = to;
    }
    return null;
  };
  // Or left where it is and the rows above brought down to climb in its place, the same way.
  const lower = (): Map<number, number> | null => {
    const writes = new Map<number, number>();
    let prev = h;
    for (let k = 1; k <= REACH; k++) {
      // The road ends here, above: the row brought down is its level end.
      if (ends(k)) return k > 1 ? writes : null;
      const was = levelOf(rowAt(k, false));
      if (was === null || (k === 1 && was !== h + r)) return null;
      // The row above the ramp comes down to its foot; each beyond it, to within a step of the one before.
      const to = k === 1 ? h : Math.min(was, prev + MAX_RISE);
      if (to === was) return writes;
      // A row brought down climbs anew to the next: road alone.
      const cells = rowAt(k);
      if (!cells) return null;
      for (const j of cells) writes.set(j, to);
      prev = to;
    }
    return null;
  };
  const raised = raise();
  if (raised) return { writes: raised, z: h + r };
  const lowered = lower();
  if (lowered) return { writes: lowered, z: h };
  return null;
}

/**
 * The heights a road along `path` needs. `path` is the stroke's cells in
 * order, each beside the one before. A path that doubles back on itself is
 * graded as it first passes.
 */
export function gradeRoad(g: Grid, path: readonly GradeCell[]): Grade {
  const n = path.length;
  const h = new Array<number>(n), pin = new Array<boolean>(n).fill(false);
  const on = new Set(path.map((c) => idx(g, c.x, c.y)));
  /** Road cells off the path whose ground a junction moves. */
  const levelled = new Map<number, number>();
  const was = (i: number) => levelled.get(i) ?? g.height[i];
  const refused = new Set<number>();
  let why = "";
  const beside = (k: number, dx: number, dy: number) => [k - 1, k + 1].some((j) => j >= 0 && j < n && path[j].x - path[k].x === dx && path[j].y - path[k].y === dy);
  /** Level the ramp at a cell for a junction, or refuse the stroke at path cell `k`. Its height then. */
  const level = (x: number, y: number, k: number): number => {
    const L = levelRamp(g, x, y, was);
    if (!L) { refused.add(k); why = ON_A_SLOPE; return was(idx(g, x, y)); }
    for (const [i, z] of L.writes) levelled.set(i, z);
    return L.z;
  };

  for (let k = 0; k < n; k++) {
    const { x, y } = path[k], i = idx(g, x, y);
    h[k] = g.height[i];
    if (held(g, x, y)) {
      pin[k] = true;
      // ON A RAMP of a road already there: left alone where the stroke runs with its climb; levelled where it crosses or leaves by the side.
      const up = paved(g, x, y) ? upOf(g, i) : null;
      if (up && (beside(k, up[1], up[0]) || beside(k, -up[1], -up[0]))) h[k] = level(x, y, k);
      continue;
    }
    const end = k === 0 || k === n - 1;
    // BESIDE A ROAD: an end joins it; a cell along the way takes the height of one laid alongside.
    // The neighbour the stroke would run straight on into first, then the rest.
    const [fx, fy] = n > 1 ? (k === 0 ? [x - path[1].x, y - path[1].y] : [x - path[k - 1].x, y - path[k - 1].y]) : [0, 0];
    const around = [[fx, fy], [1, 0], [-1, 0], [0, 1], [0, -1]].filter(([dx, dy]) => dx || dy);
    for (const [dx, dy] of around) {
      const nx = x + dx, ny = y + dy;
      if (!paved(g, nx, ny) || on.has(idx(g, nx, ny)) || beside(k, dx, dy)) continue;
      const j = idx(g, nx, ny), up = upOf(g, j);
      const ahead = end && dx === fx && dy === fy;
      // Only an end joins the road ahead of it; along the way, only a road running beside the stroke.
      if (!ahead && beside(k, -dx, -dy)) continue;
      if (!up) { h[k] = was(j); pin[k] = true; break; }
      const inLine = up[0] === -dx && up[1] === -dy ? 1 : up[0] === dx && up[1] === dy ? -1 : 0;
      if (inLine) {
        // At the head or the foot of its climb: an end meets it there.
        if (!end) continue;
        h[k] = was(j) + (inLine > 0 ? rampRise(g.ramp[j]) : 0);
        pin[k] = true;
        break;
      }
      // BESIDE A RAMP: a lane alongside climbs with it; an end joining it by its side levels it.
      if (ahead) h[k] = level(nx, ny, k); else h[k] = was(j);
      pin[k] = true;
      break;
    }
    if (end) pin[k] = true;
  }

  // WHAT THE HELD CELLS ALLOW: each cell no higher and no lower than a step a tile from every held one.
  const lo = new Array<number>(n).fill(-Infinity), hi = new Array<number>(n).fill(Infinity);
  for (let k = 0; k < n; k++) if (pin[k]) { lo[k] = h[k]; hi[k] = h[k]; }
  for (let k = 1; k < n; k++) { lo[k] = Math.max(lo[k], lo[k - 1] - MAX_RISE); hi[k] = Math.min(hi[k], hi[k - 1] + MAX_RISE); }
  for (let k = n - 2; k >= 0; k--) { lo[k] = Math.max(lo[k], lo[k + 1] - MAX_RISE); hi[k] = Math.min(hi[k], hi[k + 1] + MAX_RISE); }

  // TOO STEEP between two held cells: every cell from one to the other is refused.
  let short = 0;
  const pins = [...Array(n).keys()].filter((k) => pin[k]);
  for (let a = 0; a + 1 < pins.length; a++) {
    const p = pins[a], q = pins[a + 1], need = Math.ceil(Math.abs(h[q] - h[p]) / MAX_RISE);
    if (need <= q - p) continue;
    short = Math.max(short, need - (q - p));
    for (let k = p; k <= q; k++) refused.add(k);
  }
  if (short) why = tooSteep(short);

  // THE CUT AND THE FILL: the ground brought down to a flight of steps, and built up to one; the road half way.
  const cut = h.slice(), fill = h.slice();
  for (let k = 1; k < n; k++) { cut[k] = Math.min(cut[k], cut[k - 1] + MAX_RISE); fill[k] = Math.max(fill[k], fill[k - 1] - MAX_RISE); }
  for (let k = n - 2; k >= 0; k--) { cut[k] = Math.min(cut[k], cut[k + 1] + MAX_RISE); fill[k] = Math.max(fill[k], fill[k + 1] - MAX_RISE); }
  const out = h.map((_, k) => Math.max(lo[k], Math.min(hi[k], Math.floor((cut[k] + fill[k]) / 2))));
  // A DIP ONE CELL LONG is no use to a ramp, which tilts one way: filled level with the lower side.
  for (let k = 1; k + 1 < n; k++) if (!pin[k] && out[k] < out[k - 1] && out[k] < out[k + 1]) out[k] = Math.min(out[k - 1], out[k + 1]);

  // REFUSED: nothing moves, and the cursor shows the ground as it is.
  if (refused.size) {
    return { heights: path.map((c) => g.height[idx(g, c.x, c.y)]), moved: [], blocked: [...refused].sort((a, b) => a - b).map((k) => ({ x: path[k].x, y: path[k].y })), short, why, brief: briefly(short) };
  }

  const moved: Grade["moved"] = [];
  const first = new Map<number, number>();
  for (let k = 0; k < n; k++) {
    const { x, y } = path[k], i = idx(g, x, y);
    const seen = first.get(i);
    if (seen !== undefined) { out[k] = out[seen]; continue; }
    first.set(i, k);
    if (out[k] !== g.height[i]) moved.push({ x, y, from: g.height[i], to: out[k] });
  }
  for (const [i, z] of levelled) if (!first.has(i) && z !== g.height[i]) moved.push({ x: i % g.w, y: (i / g.w) | 0, from: g.height[i], to: z });
  return { heights: out, moved, blocked: [], short: 0, why: "", brief: "" };
}

/**
 * The grade of a road stroke as the tool lays it, or null for a stroke that
 * grades nothing: a line dragged with a brush one cell wide. The cursor and
 * the commit both ask this, so what is shown is what is laid.
 */
export function gradeStroke(g: Grid, s: Stroke, radius = 0): Grade | null {
  if (s.tool !== "paintRoad" || s.brush !== "line" || s.path || radius > 0) return null;
  return gradeRoad(g, strokeCells(g, s));
}
