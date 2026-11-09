/**
 * World v2 — the shapes lanes are made of: polylines in tile space, the
 * curves a junction's turns follow, and how far one is from another.
 */
export type Pt = { x: number; y: number };

export const add = (a: Pt, b: Pt, k = 1): Pt => ({ x: a.x + b.x * k, y: a.y + b.y * k });
export const sub = (a: Pt, b: Pt): Pt => ({ x: a.x - b.x, y: a.y - b.y });
export const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);
export const dot = (a: Pt, b: Pt) => a.x * b.x + a.y * b.y;
export const cross = (a: Pt, b: Pt) => a.x * b.y - a.y * b.x;
export const norm = (a: Pt): Pt => { const l = Math.hypot(a.x, a.y) || 1; return { x: a.x / l, y: a.y / l }; };
/** Right of a heading, as traffic keeps to it. @see rightOf in agents/roads */
export const right = (h: Pt): Pt => ({ x: -h.y, y: h.x });

/** Distance along a polyline at each of its points. */
export function lengths(pts: readonly Pt[]): Float32Array {
  const at = new Float32Array(pts.length);
  for (let k = 1; k < pts.length; k++) at[k] = at[k - 1] + dist(pts[k - 1], pts[k]);
  return at;
}

/** The point and heading `s` along a polyline. */
export function pointAt(pts: readonly Pt[], at: Float32Array, s: number): { p: Pt; h: Pt } {
  const n = pts.length;
  if (n === 1) return { p: pts[0], h: { x: 1, y: 0 } };
  if (s <= 0) return { p: pts[0], h: norm(sub(pts[1], pts[0])) };
  if (s >= at[n - 1]) return { p: pts[n - 1], h: norm(sub(pts[n - 1], pts[n - 2])) };
  let lo = 0, hi = n - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (at[m] <= s) lo = m; else hi = m; }
  const seg = at[hi] - at[lo] || 1, t = (s - at[lo]) / seg;
  const a = pts[lo], b = pts[hi];
  return { p: { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }, h: norm(sub(b, a)) };
}

/** A cubic from `a` to `d` by `b` and `c`, `n` segments. */
export function cubic(a: Pt, b: Pt, c: Pt, d: Pt, n: number): Pt[] {
  const out: Pt[] = [];
  for (let k = 0; k <= n; k++) {
    const t = k / n, u = 1 - t;
    const w0 = u * u * u, w1 = 3 * u * u * t, w2 = 3 * u * t * t, w3 = t * t * t;
    out.push({ x: a.x * w0 + b.x * w1 + c.x * w2 + d.x * w3, y: a.y * w0 + b.y * w1 + c.y * w2 + d.y * w3 });
  }
  return out;
}

/**
 * A TURN from `p0` heading `h0` to `p1` heading `h1`: a cubic that leaves and
 * arrives along both headings. Where the two rays meet, its handles reach
 * 0.55 of the way to that corner — near enough a circle's arc — and a U-turn
 * or a shift sideways (the rays never meet) gets handles a third of the gap.
 */
export function turnCurve(p0: Pt, h0: Pt, p1: Pt, h1: Pt, n = 10): Pt[] {
  const den = cross(h0, h1);
  const d = dist(p0, p1);
  if (Math.abs(den) > 1e-6) {
    const w = sub(p1, p0);
    const t = cross(w, h1) / den, s = cross(w, h0) / den;
    if (t > 0 && s > 0) return cubic(p0, add(p0, h0, 0.55 * t), add(p1, h1, -0.55 * s), p1, n);
  }
  const k = dot(h0, h1) < -0.5 ? Math.max(0.25, d * 0.9) : d / 3;
  return cubic(p0, add(p0, h0, k), add(p1, h1, -k), p1, n);
}

/** The tightest radius along a polyline, from each three points in a row; Infinity if straight. */
export function minRadius(pts: readonly Pt[]): number {
  let r = Infinity;
  for (let k = 1; k < pts.length - 1; k++) {
    const a = pts[k - 1], b = pts[k], c = pts[k + 1];
    const area2 = Math.abs(cross(sub(b, a), sub(c, a)));
    if (area2 < 1e-9) continue;
    r = Math.min(r, (dist(a, b) * dist(b, c) * dist(c, a)) / (2 * area2));
  }
  return r;
}

/** The distance from a point to a polyline. */
export function distToLine(p: Pt, pts: readonly Pt[]): number {
  let best = Infinity;
  for (let k = 1; k < pts.length; k++) {
    const a = pts[k - 1], b = pts[k], ab = sub(b, a);
    const l2 = dot(ab, ab);
    const t = l2 ? Math.max(0, Math.min(1, dot(sub(p, a), ab) / l2)) : 0;
    best = Math.min(best, dist(p, add(a, ab, t)));
  }
  return best;
}

/** Corner cutting, `rounds` times: a cell-by-cell path made smooth. Ends kept. */
export function chaikin(pts: readonly Pt[], rounds = 2): Pt[] {
  let p = pts.slice();
  for (let r = 0; r < rounds && p.length > 2; r++) {
    const q: Pt[] = [p[0]];
    for (let k = 0; k < p.length - 1; k++) {
      const a = p[k], b = p[k + 1];
      q.push({ x: a.x * 0.75 + b.x * 0.25, y: a.y * 0.75 + b.y * 0.25 }, { x: a.x * 0.25 + b.x * 0.75, y: a.y * 0.25 + b.y * 0.75 });
    }
    q.push(p[p.length - 1]);
    p = q;
  }
  return p;
}

/** An arc round `c`, radius `r`, from angle `a0` to `a1` (either way round), a point every `step` radians or so. */
export function arc(c: Pt, r: number, a0: number, a1: number, step = 0.2): Pt[] {
  const n = Math.max(2, Math.ceil(Math.abs(a1 - a0) / step));
  return Array.from({ length: n + 1 }, (_, k) => {
    const a = a0 + ((a1 - a0) * k) / n;
    return { x: c.x + Math.cos(a) * r, y: c.y + Math.sin(a) * r };
  });
}
