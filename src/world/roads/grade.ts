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

/** Where a cell's road stands: its deck, where it is bridged; else its ground. */
const surface = (g: Grid, i: number) => (g.deck[i] !== 0 ? g.deckZ[i] : g.height[i]);
/** Whether the ground under a cell of road may be moved to level a junction: nothing piped under it, no water on it, no bridge. */
const movable = (g: Grid, i: number) => g.main[i] === 0 && g.sewer[i] === 0 && g.pool[i] === 0 && g.inflow[i] === 0 && g.deck[i] === 0;

/** Whether a cell's ground is not the road's to move. */
function held(g: Grid, x: number, y: number): boolean {
  const i = idx(g, x, y);
  return g.paved[i] !== 0 || g.deck[i] !== 0 || g.pool[i] > 0 || g.inflow[i] > 0
    || g.main[i] !== 0 || g.sewer[i] !== 0 || structureAt(g, x, y) >= 0;
}

/** What to say of a refused climb, and of a junction that cannot be levelled. */
export const tooSteep = (short: number) => `Too steep here: the road needs ${short} more tile${short === 1 ? "" : "s"} to climb`;
export const ON_A_SLOPE = "A road can't join here: this slope can't be levelled for a junction";
export const IN_THE_WAY = "Something stands in the road's way";
export const OPEN_WATER = "A road can't cross open water";
const BRIEF: Record<string, string> = { [ON_A_SLOPE]: "Can't join on this slope", [IN_THE_WAY]: "Something in the way", [OPEN_WATER]: "Can't cross water" };
const briefly = (short: number, why: string) => BRIEF[why] ?? (short ? `Too steep · ${short} more tile${short === 1 ? "" : "s"}` : "Can't join on this slope");

/**
 * LEVEL A RAMP for a junction on it: the heights to write, and the height the
 * junction then stands at; null if it cannot be. The ramp's whole row across
 * its road is levelled with it. `was` reads a cell's height as already staged.
 */
function levelRamp(g: Grid, x: number, y: number, was: (i: number) => number, only?: "raise" | "lower"): { writes: Map<number, number>; z: number } | null {
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
  /** A row's one height, if its cells agree; else null. */
  const levelOf = (cells: number[] | null): number | null =>
    cells && cells.every((j) => g.height[j] === g.height[cells[0]]) ? g.height[cells[0]] : null;
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
      // Left where it is, it climbs to the row brought up: not if it is the foot of a climb the other way too.
      if (to === was) { const under = ends(k - 1) ? null : levelOf(rowAt(k - 1, false)); return was < next && under !== null && under > was ? null : writes; }
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
  // Only ground that may be moved: nothing piped under it, no water, no bridge.
  const free = (w: Map<number, number> | null) => (w && [...w.keys()].every((j) => movable(g, j)) ? w : null);
  const raised = only === "lower" ? null : free(raise());
  if (raised) return { writes: raised, z: h + r };
  const lowered = only === "raise" ? null : free(lower());
  if (lowered) return { writes: lowered, z: h };
  return null;
}

/**
 * The heights a road along `path` needs. `path` is the stroke's cells in
 * order, each beside the one before. A path that doubles back on itself is
 * graded as it first passes.
 */
export function gradeRoad(g: Grid, path: readonly GradeCell[], o: { dry?: boolean } = {}): Grade {
  const n = path.length;
  // NOT THROUGH A BUILDING, and in the game not into open water: nothing is laid, and nothing graded.
  const stopped = (why: string, at: GradeCell[]): Grade =>
    ({ heights: path.map((c) => surface(g, idx(g, c.x, c.y))), moved: [], blocked: at, short: 0, why, brief: briefly(0, why) });
  const fresh = path.filter((c) => g.paved[idx(g, c.x, c.y)] === 0);
  const built = fresh.filter((c) => structureAt(g, c.x, c.y) >= 0);
  if (built.length) return stopped(IN_THE_WAY, built);
  const wet = o.dry ? fresh.filter((c) => { const i = idx(g, c.x, c.y); return g.deck[i] === 0 && (g.pool[i] > 0 || g.inflow[i] > 0); }) : [];
  if (wet.length) return stopped(OPEN_WATER, wet);
  const h = new Array<number>(n), pin = new Array<boolean>(n).fill(false);
  const on = new Set(path.map((c) => idx(g, c.x, c.y)));
  /** Road cells off the path whose ground a junction moves. */
  const levelled = new Map<number, number>();
  const was = (i: number) => levelled.get(i) ?? g.height[i];
  const refused = new Set<number>();
  let why = "";
  /** Cells held to a range of heights and not to one: an end meeting the road ahead of it. */
  const range: ([number, number] | undefined)[] = new Array(n);
  const beside = (k: number, dx: number, dy: number) => [k - 1, k + 1].some((j) => j >= 0 && j < n && path[j].x - path[k].x === dx && path[j].y - path[k].y === dy);
  /** Whether the path turns at cell `k`. */
  const turns = (k: number) => k > 0 && k < n - 1 && (path[k + 1].x - path[k].x !== path[k].x - path[k - 1].x || path[k + 1].y - path[k].y !== path[k].y - path[k - 1].y);
  // A CORNER IS LEVEL: the cell the road turns on and the one either side of it stand at one height — a ramp
  // tilts one way, and a road cannot turn on one. `lim[e]`, how far cell e + 1 may stand from cell e.
  const lim = new Array<number>(Math.max(0, n - 1)).fill(MAX_RISE);
  for (let k = 1; k < n - 1; k++) if (turns(k)) { lim[k - 1] = 0; lim[k] = 0; }
  /** Level the ramp at a cell for a junction, or refuse the stroke at path cell `k`. Its height then. */
  const level = (x: number, y: number, k: number): number => {
    const L = levelRamp(g, x, y, was);
    if (!L) { refused.add(k); why = ON_A_SLOPE; return was(idx(g, x, y)); }
    for (const [i, z] of L.writes) levelled.set(i, z);
    return L.z;
  };

  for (let k = 0; k < n; k++) h[k] = surface(g, idx(g, path[k].x, path[k].y));
  /** The road cells beside path cell `k` that are off the path: where they are and their index. */
  const outside = (k: number) => {
    const { x, y } = path[k], out: { nx: number; ny: number; j: number; dx: number; dy: number }[] = [];
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (paved(g, nx, ny) && !on.has(idx(g, nx, ny)) && !beside(k, dx, dy)) out.push({ nx, ny, j: idx(g, nx, ny), dx, dy });
    }
    return out;
  };
  // ROUND THE OUTSIDE OF A TURN, the lane laid before runs both ways from this corner: the corner stands with
  // it — a ramp of it there levelled, nothing turns beside a ramp's side — and so do the cells either side of
  // the corner, the lane outside them brought level with it where it climbs.
  const cornered = new Set<number>();
  for (let k = 1; k < n - 1; k++) {
    if (!turns(k) || held(g, path[k].x, path[k].y)) continue;
    const by = outside(k);
    if (!by.length) continue;
    // Its height: the level road beside it, if there is any; and every ramp beside it levelled to that.
    const flat = by.find((q) => !upOf(g, q.j));
    let z = flat ? was(flat.j) : NaN;
    for (const { nx, ny, j } of by) {
      if (!upOf(g, j)) { if (was(j) !== z) { refused.add(k); why = ON_A_SLOPE; } continue; }
      const L = levelRamp(g, nx, ny, was);
      if (Number.isNaN(z) && L) z = L.z;
      if (!L || L.z !== z) {
        // Raised where it had to come down, or the other way: the way that meets the corner, if there is one.
        const other = L ? levelRamp(g, nx, ny, was, L.z > z ? "lower" : "raise") : null;
        if (!other || other.z !== z) { refused.add(k); why = ON_A_SLOPE; continue; }
        for (const [q, v] of other.writes) levelled.set(q, v);
        continue;
      }
      for (const [q, v] of L.writes) levelled.set(q, v);
    }
    h[k] = Number.isNaN(z) ? h[k] : z;
    pin[k] = true;
    cornered.add(k);
  }
  for (const c of cornered) for (const k of [c - 1, c + 1]) {
    if (pin[k] || held(g, path[k].x, path[k].y)) continue;
    h[k] = h[c];
    pin[k] = true;
    for (const { nx, ny, j } of outside(k)) {
      if (was(j) === h[c]) continue;
      const first = upOf(g, j) ? levelRamp(g, nx, ny, was) : null;
      const L = first && first.z !== h[c] ? levelRamp(g, nx, ny, was, first.z > h[c] ? "lower" : "raise") : first;
      if (!L || L.z !== h[c]) { refused.add(k); why = ON_A_SLOPE; continue; }
      for (const [q, z] of L.writes) levelled.set(q, z);
    }
  }

  for (let k = 0; k < n; k++) {
    const { x, y } = path[k], i = idx(g, x, y);
    if (pin[k]) continue;
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
      // AN END MEETING THE ROAD AHEAD OF IT stands no higher than it, and may be a step below, climbing to it:
      // where the ground already is within that, it stays — a stretch taken up is relaid as it lay.
      if (!up && ahead) { range[k] = [was(j) - MAX_RISE, was(j)]; break; }
      if (!up) { h[k] = was(j); pin[k] = true; break; }
      const inLine = up[0] === -dx && up[1] === -dy ? 1 : up[0] === dx && up[1] === dy ? -1 : 0;
      if (inLine) {
        // At the head or the foot of its climb: an end meets it there — at its head, level with it; at its foot, as any road ahead.
        if (!end) continue;
        if (inLine > 0) { h[k] = was(j) + rampRise(g.ramp[j]); pin[k] = true; } else range[k] = [was(j) - MAX_RISE, was(j)];
        break;
      }
      // BESIDE A RAMP: a lane alongside climbs with it; an end joining it by its side levels it.
      if (ahead) h[k] = level(nx, ny, k); else h[k] = was(j);
      pin[k] = true;
      break;
    }
    if (end && !range[k]) pin[k] = true;
  }

  // WHAT THE HELD CELLS ALLOW: each cell no higher and no lower than a step a tile from every held one.
  const lo = new Array<number>(n).fill(-Infinity), hi = new Array<number>(n).fill(Infinity);
  for (let k = 0; k < n; k++) if (pin[k]) { lo[k] = h[k]; hi[k] = h[k]; } else if (range[k]) { [lo[k], hi[k]] = range[k]!; }
  // A ROAD ALREADY THERE NEVER CLIMBS TO THE NEW ONE: the cells of the stroke next to it stand no higher than it
  // does, and do the climbing themselves. A junction cannot be the foot of a ramp.
  for (let k = 0; k < n; k++) {
    if (!paved(g, path[k].x, path[k].y)) continue;
    for (const m of [k - 1, k + 1]) if (m >= 0 && m < n && !pin[m]) hi[m] = Math.min(hi[m], h[k]);
  }
  for (let k = 1; k < n; k++) { lo[k] = Math.max(lo[k], lo[k - 1] - lim[k - 1]); hi[k] = Math.min(hi[k], hi[k - 1] + lim[k - 1]); }
  for (let k = n - 2; k >= 0; k--) { lo[k] = Math.max(lo[k], lo[k + 1] - lim[k]); hi[k] = Math.min(hi[k], hi[k + 1] + lim[k]); }

  // TOO STEEP between two held cells: every cell from one to the other is refused.
  let short = 0;
  const pins = [...Array(n).keys()].filter((k) => pin[k]);
  for (let a = 0; a + 1 < pins.length; a++) {
    const p = pins[a], q = pins[a + 1];
    // What the run between them can climb: a step a tile, and nothing round a corner.
    let room = 0;
    for (let e = p; e < q; e++) room += lim[e];
    const over = Math.abs(h[q] - h[p]) - room;
    if (over <= 0) continue;
    short = Math.max(short, Math.ceil(over / MAX_RISE));
    for (let k = p; k <= q; k++) refused.add(k);
  }
  // Or held from both sides at once: no height serves.
  for (let k = 0; k < n; k++) if (lo[k] > hi[k]) { refused.add(k); short = Math.max(short, Math.ceil((lo[k] - hi[k]) / MAX_RISE)); }
  if (short) why = tooSteep(short);

  // THE CUT AND THE FILL: the ground brought down to a flight of steps, and built up to one; the road half way.
  const cut = h.slice(), fill = h.slice();
  for (let k = 1; k < n; k++) { cut[k] = Math.min(cut[k], cut[k - 1] + lim[k - 1]); fill[k] = Math.max(fill[k], fill[k - 1] - lim[k - 1]); }
  for (let k = n - 2; k >= 0; k--) { cut[k] = Math.min(cut[k], cut[k + 1] + lim[k]); fill[k] = Math.max(fill[k], fill[k + 1] - lim[k]); }
  const out = h.map((_, k) => Math.max(lo[k], Math.min(hi[k], Math.floor((cut[k] + fill[k]) / 2))));
  // A DIP ONE CELL LONG is no use to a ramp, which tilts one way: filled level with the lower side.
  for (let k = 1; k + 1 < n; k++) if (!pin[k] && lim[k - 1] && lim[k] && out[k] < out[k - 1] && out[k] < out[k + 1]) out[k] = Math.min(out[k - 1], out[k + 1]);

  // REFUSED: nothing moves, and the cursor shows the ground as it is.
  if (refused.size) {
    return { heights: path.map((c) => surface(g, idx(g, c.x, c.y))), moved: [], blocked: [...refused].sort((a, b) => a - b).map((k) => ({ x: path[k].x, y: path[k].y })), short, why, brief: briefly(short, why) };
  }

  const moved: Grade["moved"] = [];
  const first = new Map<number, number>();
  for (let k = 0; k < n; k++) {
    const { x, y } = path[k], i = idx(g, x, y);
    const seen = first.get(i);
    if (seen !== undefined) { out[k] = out[seen]; continue; }
    first.set(i, k);
    if (g.deck[i] === 0 && out[k] !== g.height[i]) moved.push({ x, y, from: g.height[i], to: out[k] });
  }
  for (const [i, z] of levelled) if (!first.has(i) && z !== g.height[i]) moved.push({ x: i % g.w, y: (i / g.w) | 0, from: g.height[i], to: z });
  return { heights: out, moved, blocked: [], short: 0, why: "", brief: "" };
}

/**
 * The grade of a road stroke as the tool lays it, or null for a stroke that
 * grades nothing: a line dragged with a brush one cell wide. The cursor and
 * the commit both ask this, so what is shown is what is laid.
 */
export function gradeStroke(g: Grid, s: Stroke, radius = 0, o: { dry?: boolean } = {}): Grade | null {
  if (s.tool !== "paintRoad" || s.brush !== "line" || s.path || radius > 0) return null;
  return gradeRoad(g, strokeCells(g, s), o);
}
