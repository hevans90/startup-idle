/**
 * THE STILL'S GLASSWARE: the flask, the hub under it, a pipe to each branch's first vessel and on down from vessel to
 * vessel — as one distance field, how far each point is inside the glass (negative) or out of it. The liquid is held by
 * it and the glass is drawn from it, so the two cannot disagree. In cells: the liquid's grid, y downwards. @see still-gpu
 */
import { JUICE_BRANCHES, JUICE_TREE } from "../../game/achievements.juice-shop";

export type Pt = readonly [number, number];
export const ROWS = 5, COLS = JUICE_BRANCHES.length;
const TOP = 129, PITCH = 40;
export const W = 160, H = TOP + (ROWS - 1) * PITCH + 18;

export const FLASK = { at: [80, 35] as Pt, r: 30 };
/** How far out the field is known; beyond, this. */
export const FAR = 12;
const PIPE = 2.5;
/** The cells in a pipe between a vessel's foot and the gate under it. */
const STUB = 24;

/**
 * A PLACE JUICE STANDS: the flask with its hub (nought), and each vessel with the pipe into it. Everything between one
 * gate and the next.
 */
export type Vessel = {
  id: string; cost: number; col: number; row: number;
  at: Pt; r: number;
  /** The gate that lets juice in. */
  gate: Pt;
  /** The cells of liquid that fill it. */
  cells: number;
};
/** A vessel's cells: more for a dearer one, but never too small to see. */
export const cellsFor = (cost: number) => 150 + 0.22 * cost;

const colX = (col: number) => 16 + col * 32;
const hubX = (col: number) => 80 + (col - (COLS - 1) / 2) * 12;
const HUB_Y = 75, HUB_GATE = 82;

type Shape = (x: number, y: number) => number;
const hypot = Math.hypot;
function pipe(x: number, y: number, a: Pt, b: Pt, r: number): number {
  const bx = b[0] - a[0], by = b[1] - a[1], px = x - a[0], py = y - a[1];
  const t = Math.max(0, Math.min(1, (px * bx + py * by) / Math.max(1e-6, bx * bx + by * by)));
  return hypot(px - bx * t, py - by * t) - r;
}
/** To a convex shape, its corners clockwise on the screen: rounded by `r`. */
function poly(x: number, y: number, pts: readonly Pt[], r: number): number {
  let near = Infinity, inside = true;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    near = Math.min(near, pipe(x, y, a, b, 0));
    if ((b[0] - a[0]) * (y - a[1]) - (b[1] - a[1]) * (x - a[0]) < 0) inside = false;
  }
  return (inside ? -near : near) - r;
}
/** Two shapes as one, the corner between them softened over `k`. */
const join = (a: number, b: number, k: number) => { const h = Math.max(k - Math.abs(a - b), 0) / k; return Math.min(a, b) - h * h * k * 0.25; };

/** Each branch's glass: its corners, about its middle, to a size of one. Null is a round one. */
const FORMS: readonly (readonly Pt[] | null)[] = [
  null,
  [[-0.3, -0.85], [0.3, -0.85], [0.95, 0.6], [0, 0.85], [-0.95, 0.6]],
  [[-0.5, -0.8], [0.5, -0.8], [0.95, 0], [0.5, 0.8], [-0.5, 0.8], [-0.95, 0]],
  [[-0.8, -0.7], [0.8, -0.7], [0.9, -0.2], [0, 0.95], [-0.9, -0.2]],
  [[-0.72, -0.8], [0.72, -0.8], [0.72, 0.6], [0, 0.85], [-0.72, 0.6]],
];
const CORNER = 2;
/** How big a form is to be to hold so many cells. */
function sizeFor(form: readonly Pt[] | null, cells: number): number {
  if (!form) return Math.sqrt(cells / Math.PI);
  const n = form.length, len = (k: number) => hypot(form[k][0] - form[(k + 1) % n][0], form[k][1] - form[(k + 1) % n][1]);
  let area = 0, round = 0;
  for (let k = 0; k < n; k++) { const a = form[k], b = form[(k + 1) % n]; area += (a[0] * b[1] - b[0] * a[1]) / 2; round += len(k); }
  // area s² + round·corner·s + π·corner² = cells
  const c = Math.PI * CORNER * CORNER - cells, b = round * CORNER;
  return (-b + Math.sqrt(b * b - 4 * area * c)) / (2 * area);
}

export const VESSELS: readonly Vessel[] = JUICE_BRANCHES.flatMap((branch, col) => {
  let above: Vessel | null = null;
  return JUICE_TREE[branch].map((u, row): Vessel => {
    const cells = cellsFor(u.cost), y = TOP + row * PITCH, x = colX(col);
    const size = sizeFor(FORMS[col], (cells - (row < ROWS - 1 ? STUB : 0)) * 1.14);
    const foot = FORMS[col] ? Math.max(...FORMS[col]!.map((p) => p[1])) * size + CORNER : size;
    const gate: Pt = above ? [x, above.at[1] + above.r + 3] : [hubX(col), HUB_GATE];
    return (above = { id: u.id, cost: u.cost, col, row, at: [x, y], r: foot, gate, cells });
  });
});
/** Each vessel's own size, for its form. */
const SIZES = VESSELS.map((v) => sizeFor(FORMS[v.col], (v.cells - (v.row < ROWS - 1 ? STUB : 0)) * 1.14));

/** A curve through some points, cut into short lengths. */
function curve(pts: readonly Pt[], cuts = 8): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[Math.max(0, i - 1)], b = pts[i], c = pts[i + 1], d = pts[Math.min(pts.length - 1, i + 2)];
    const on = (k: 0 | 1, t: number) => 0.5 * (2 * b[k] + (c[k] - a[k]) * t + (2 * a[k] - 5 * b[k] + 4 * c[k] - d[k]) * t * t + (3 * b[k] - a[k] - 3 * c[k] + d[k]) * t * t * t);
    for (let j = 0; j < cuts; j++) out.push([on(0, j / cuts), on(1, j / cuts)]);
  }
  return [...out, pts[pts.length - 1]];
}

/** A grid of the glass, so many samples to a cell: each shape laid down only where it reaches. */
export function glassField(fine = 1): Float32Array {
  const w = W * fine, h = H * fine, out = new Float32Array(w * h).fill(FAR);
  const lay = (x0: number, y0: number, x1: number, y1: number, k: number, d: Shape) => {
    const m = FAR + k;
    for (let y = Math.max(0, Math.floor((y0 - m) * fine)); y < Math.min(h, (y1 + m) * fine); y++)
      for (let x = Math.max(0, Math.floor((x0 - m) * fine)); x < Math.min(w, (x1 + m) * fine); x++) {
        const at = y * w + x;
        out[at] = Math.min(FAR, join(out[at], d((x + 0.5) / fine, (y + 0.5) / fine), k));
      }
  };
  const run = (pts: readonly Pt[], r: number, k: number) => {
    const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
    lay(Math.min(...xs) - r, Math.min(...ys) - r, Math.max(...xs) + r, Math.max(...ys) + r, k, (x, y) => {
      let d = Infinity;
      for (let i = 0; i + 1 < pts.length; i++) d = Math.min(d, pipe(x, y, pts[i], pts[i + 1], r));
      return d;
    });
  };
  const { at, r } = FLASK;
  lay(at[0] - r, at[1] - r, at[0] + r, at[1] + r, 0.01, (x, y) => hypot(x - at[0], y - at[1]) - r);
  run([[80, -6], [80, 10]], 5, 5);
  run([[80, 62], [80, HUB_Y]], 4.5, 4);
  run([[hubX(0), HUB_Y], [hubX(COLS - 1), HUB_Y]], 3.4, 2);
  VESSELS.forEach((v, k) => {
    const [x, y] = v.at, form = FORMS[v.col]?.map(([a, b]): Pt => [x + a * SIZES[k], y + b * SIZES[k]]);
    if (form) lay(x - v.r, y - v.r, x + v.r, y + v.r, 2, (px, py) => poly(px, py, form, CORNER));
    else lay(x - v.r, y - v.r, x + v.r, y + v.r, 2, (px, py) => hypot(px - x, py - y) - v.r);
    if (v.row === 0) {
      const gx = v.gate[0];
      run([[gx, HUB_Y], [gx, HUB_GATE + 5]], PIPE, 1);
      run(curve([[gx, HUB_GATE + 5], [gx + (x - gx) * 0.12, 91], [gx + (x - gx) * 0.85, 98], [x, 105], [x, y - v.r + 1]]), PIPE, 1);
    } else run([[x, v.gate[1] - 4], [x, y - v.r + 1]], PIPE, 1.5);
  });
  return out;
}

/** How deep in a gate's plate a point is: shut, and drawn aside as it opens. (As the shaders have it.) */
export const GATE_HALF: Pt = [3.4, 1.2], GATE_SLIDE = 7;

/** No place. */
export const NOWHERE = 255;
/**
 * WHICH PLACE EACH CELL IS: nought the flask's, then one and up each vessel's (low byte; `NOWHERE` outside the glass);
 * the gate at hand, its place's number (second byte, nought none); and the place whose glow it is in (third byte).
 */
export function placeMap(field: Float32Array): Uint32Array {
  const place = new Uint8Array(W * H).fill(NOWHERE), gate = new Uint8Array(W * H);
  VESSELS.forEach((v, k) => {
    for (let y = Math.floor(v.gate[1] - 6); y < v.gate[1] + 6; y++) for (let x = Math.ceil(v.gate[0] - 6); x < v.gate[0] + 6; x++) gate[y * W + x] = k + 1;
  });
  const shut = (c: number) => { const k = gate[c]; return k > 0 && Math.abs((c % W) + 0.5 - VESSELS[k - 1].gate[0]) < GATE_HALF[0] && Math.abs(Math.floor(c / W) + 0.5 - VESSELS[k - 1].gate[1]) < GATE_HALF[1] - 0.2; };
  const starts: Pt[] = [FLASK.at, ...VESSELS.map((v) => v.at)];
  starts.forEach(([sx, sy], p) => {
    const todo = [Math.floor(sy) * W + Math.floor(sx)];
    while (todo.length) {
      const c = todo.pop()!, x = c % W;
      if (c < 0 || c >= place.length || place[c] !== NOWHERE || field[c] > -0.1 || shut(c)) continue;
      place[c] = p;
      if (x > 0) todo.push(c - 1);
      if (x < W - 1) todo.push(c + 1);
      todo.push(c - W, c + W);
    }
  });
  // A gate's own cells go with what is below it; the glass's own with what is beside them.
  for (let c = 0; c < place.length; c++) if (place[c] === NOWHERE && field[c] <= -0.1 && gate[c]) place[c] = gate[c];
  for (let n = 0; n < 2; n++) {
    const was = Uint8Array.from(place);
    for (let c = W; c < was.length - W; c++) if (was[c] === NOWHERE) place[c] = Math.min(was[c - 1], was[c + 1], was[c - W], was[c + W]);
  }
  // The glow: the nearest vessel's.
  const glow = Uint8Array.from(place, (_, c) => {
    let best = 0, far = Infinity;
    VESSELS.forEach((v, k) => { const d = hypot((c % W) - v.at[0], Math.floor(c / W) - v.at[1]) - v.r; if (d < far) { far = d; best = k + 1; } });
    return best;
  });
  return Uint32Array.from(place, (p, c) => p | (gate[c] << 8) | (glow[c] << 16));
}

/** Where a place's liquid stands at rest: its cells from its foot up, four spots to each. */
export function restingIn(map: Uint32Array, field: Float32Array, place: number, spots: number): Pt[] {
  const cells: number[] = [];
  for (let c = map.length - 1; c >= 0; c--) if ((map[c] & 255) === place && field[c] < -0.7) cells.push(c);
  const out: Pt[] = [];
  for (const c of cells) for (const [dx, dy] of [[0.25, 0.25], [0.75, 0.25], [0.25, 0.75], [0.75, 0.75]]) {
    if (out.length >= spots) return out;
    out.push([(c % W) + dx, Math.floor(c / W) + dy]);
  }
  return out;
}

/** The flask's cells of liquid for so much juice: a little shows, and the most there is fits. */
export const flaskCells = (juice: number) => (juice <= 0 ? 0 : Math.min(1, juice / 60) * 480 + 2150 * (1 - Math.exp(-juice / 1600)));
