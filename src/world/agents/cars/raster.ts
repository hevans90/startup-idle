/**
 * World v2 — A SMALL SOFTWARE RASTERISER for baking vehicle models. Pure: the
 * bake script runs it under bun, the tests run it as they are. @see models.ts
 *
 * THE MAP'S OWN PROJECTION: a point `u, v` tiles across the ground and `up`
 * half steps over it lands at x = (u − v)·HW, y = (u + v)·HH − up·HU, as
 * everything else on the map does. Depth is u + v + up/4, which grows toward
 * the camera: along the line of sight (1, 1, 4) the screen point stands still.
 *
 * LIGHT FROM THE SCREEN'S LEFT, as the ground's walls are lit: the face toward
 * +y (down-left) bright, the one toward +x (down-right) in shade, the top
 * brightest. Faces are flat-lit, darkened low on the body for the shade under
 * it, and drawn at 4×4 samples a texel and averaged, so edges are smooth.
 *
 * TWO LAYERS, paint and the rest. Paint is baked white with its light and is
 * tinted in the game; the rest keeps its own colours. Where a texel is part
 * paint and part trim, the paint layer's alpha is set so that trim drawn over
 * paint gives the texel's true coverage: no seam shows between them.
 */
import { HEIGHT_UNIT, HH, HW } from "../../iso";
import { HALF_STEPS_PER_M, TILES_PER_M, type Mat, type Model, type Slab } from "./models";

export type Image = { w: number; h: number; px: Uint8Array };
/** A baked frame: its paint and trim layers, and where the vehicle's middle at road level is in them. */
export type Baked = { paint: Image; trim: Image; ox: number; oy: number };

const SS = 4;

/** A material's colour, linear 0..1, and whether it is the paint layer. */
const COLOUR: Record<Mat, [number, number, number]> = {
  paint: [1, 1, 1], roof: [0.95, 0.95, 0.95],
  glass: [0.12, 0.16, 0.21], tyre: [0.1, 0.1, 0.11], hub: [0.6, 0.62, 0.65],
  trim: [0.14, 0.14, 0.15], chrome: [0.82, 0.84, 0.87], grille: [0.1, 0.1, 0.11],
  lamp: [0.96, 0.95, 0.88], tail: [0.78, 0.1, 0.09], indicator: [0.95, 0.55, 0.1],
  plate: [0.94, 0.94, 0.9], rearPlate: [0.98, 0.8, 0.16],
  livery: [0.98, 0.84, 0.1], liveryAlt: [0.12, 0.35, 0.75], light: [0.25, 0.45, 0.95], bed: [0.36, 0.37, 0.4],
  roofBlack: [0.1, 0.1, 0.11], roofWhite: [0.92, 0.92, 0.9], seat: [0.5, 0.36, 0.25], interior: [0.12, 0.11, 0.11],
};
const PAINTED: ReadonlySet<Mat> = new Set(["paint"]);
/** Lit from within: they barely take the light. */
const GLOWS: ReadonlySet<Mat> = new Set(["lamp", "tail", "indicator", "light"]);

/** The light, in the ground's own frame (u, v, up), true lengths. */
const LIGHT = (() => { const v = [-0.3, 0.6, 1.0]; const n = Math.hypot(...v); return v.map((c) => c / n); })();

type V3 = [number, number, number];
/** A triangle: its points in the model's metres, its material, and its face's normal there. */
type Tri = { p: [V3, V3, V3]; mat: Mat; n: V3 };

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a: V3): V3 => { const n = Math.hypot(...a) || 1; return [a[0] / n, a[1] / n, a[2] / n]; };

/** A face (a convex polygon) as triangles, its normal turned outward from `inside`. */
function face(pts: V3[], mat: Mat, inside: V3, out: Tri[]) {
  let n = norm(cross(sub(pts[1], pts[0]), sub(pts[2], pts[0])));
  if (Math.hypot(...n) < 0.5) n = norm(cross(sub(pts[2], pts[0]), sub(pts[3] ?? pts[1], pts[0])));
  const c = pts.reduce((a, p) => [a[0] + p[0] / pts.length, a[1] + p[1] / pts.length, a[2] + p[2] / pts.length] as V3, [0, 0, 0] as V3);
  const toOut = sub(c, inside);
  if (n[0] * toOut[0] + n[1] * toOut[1] + n[2] * toOut[2] < 0) n = [-n[0], -n[1], -n[2]];
  for (let k = 1; k + 1 < pts.length; k++) out.push({ p: [pts[0], pts[k], pts[k + 1]], mat, n });
}

/** A slab's five faces that can show (never its underside). */
function slabTris(s: Slab, out: Tri[]) {
  const wc = s.wc ?? 0, f = s.faces ?? {};
  const inF = s.inF ?? 0, inB = s.inB ?? 0, inS = s.inS ?? 0;
  const b = (l: number, side: number): V3 => [l, wc + side * s.w, s.z0];
  const t = (l: number, side: number): V3 => [l, wc + side * (s.w - inS), s.z1];
  const tf = s.l0 - inF, tb = s.l1 + inB;
  const inside: V3 = [(s.l0 + s.l1) / 2, wc, (s.z0 + s.z1) / 2];
  face([t(tf, 1), t(tb, 1), t(tb, -1), t(tf, -1)], f.top ?? s.mat, inside, out);
  face([b(s.l0, 1), b(s.l0, -1), t(tf, -1), t(tf, 1)], f.front ?? s.mat, inside, out);
  face([b(s.l1, -1), b(s.l1, 1), t(tb, 1), t(tb, -1)], f.back ?? s.mat, inside, out);
  face([b(s.l0, 1), t(tf, 1), t(tb, 1), b(s.l1, 1)], f.side ?? s.mat, inside, out);
  face([b(s.l0, -1), b(s.l1, -1), t(tb, -1), t(tf, -1)], f.side ?? s.mat, inside, out);
}

/** A wheel each side: a tyre's tread round it, its outer wall, and a hub in the middle. */
function wheelTris(l: number, w: number, r: number, width: number, out: Tri[]) {
  const N = 14;
  for (const side of [1, -1]) {
    const wo = side * (w + width / 2), wi = side * (w - width / 2);
    const ring = (wy: number, rr: number): V3[] => Array.from({ length: N }, (_, k) => {
      const a = (k / N) * Math.PI * 2;
      return [l + rr * Math.cos(a), wy, r + rr * Math.sin(a)];
    });
    const outer = ring(wo, r), inner = ring(wi, r);
    const centre: V3 = [l, side * w, r];
    for (let k = 0; k < N; k++) face([outer[k], outer[(k + 1) % N], inner[(k + 1) % N], inner[k]], "tyre", centre, out);
    face(outer, "tyre", centre, out);
    face(ring(wo + side * 0.004, r * 0.58), "hub", centre, out);
  }
}

/** Every triangle of a model. */
export function modelTris(m: Model): Tri[] {
  const out: Tri[] = [];
  for (const s of m.slabs) slabTris(s, out);
  for (const wh of m.wheels) wheelTris(wh.l, wh.w, wh.r, wh.width, out);
  return out;
}

/**
 * Bake one frame of a model at `heading` (radians, as a mover's), `res`
 * texels to a world px at scale 1.
 */
export function bakeFrame(m: Model, heading: number, res: number): Baked {
  const ch = Math.cos(heading), sh = Math.sin(heading);
  // Model metres → ground (u, v tiles; up half steps), as town-render's `at`.
  const ground = (p: V3) => {
    const l = p[0] * TILES_PER_M, w = p[1] * TILES_PER_M;
    return { u: l * ch - w * sh, v: l * sh + w * ch, up: p[2] * HALF_STEPS_PER_M };
  };
  const screen = (u: number, v: number, up: number) => ({ x: (u - v) * HW * res, y: ((u + v) * HH - up * HEIGHT_UNIT) * res });

  const tris = modelTris(m);
  // THE FRAME: every point of the model, and the shadow's reach round it.
  const sl = m.length / 2 + 0.35, sw = m.width / 2 + 0.3;
  const pts: { x: number; y: number }[] = [];
  for (const t of tris) for (const p of t.p) { const g = ground(p); pts.push(screen(g.u, g.v, g.up)); }
  for (const [l, w] of [[sl, sw], [sl, -sw], [-sl, sw], [-sl, -sw]]) { const g = ground([l, w, 0]); pts.push(screen(g.u, g.v, 0)); }
  const PAD = 2;
  const x0 = Math.floor(Math.min(...pts.map((p) => p.x))) - PAD, y0 = Math.floor(Math.min(...pts.map((p) => p.y))) - PAD;
  const W = Math.ceil(Math.max(...pts.map((p) => p.x))) + PAD - x0, H = Math.ceil(Math.max(...pts.map((p) => p.y))) + PAD - y0;

  // THE SAMPLES: depth, colour, and which layer (0 none, 1 paint, 2 trim).
  const SW = W * SS, SH = H * SS, n = SW * SH;
  const depth = new Float32Array(n).fill(-Infinity);
  const col = new Float32Array(n * 3);
  const layer = new Uint8Array(n);

  for (const t of tris) {
    const g = t.p.map(ground);
    const s = g.map((q) => screen(q.u, q.v, q.up));
    const ax = (s[0].x - x0) * SS, ay = (s[0].y - y0) * SS;
    const bx = (s[1].x - x0) * SS, by = (s[1].y - y0) * SS;
    const cx = (s[2].x - x0) * SS, cy = (s[2].y - y0) * SS;
    const area = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
    if (Math.abs(area) < 1e-9) continue;
    const d = g.map((q) => q.u + q.v + q.up / 4);
    const zm = t.p.map((p) => p[2]);
    // The face's light, its normal turned into the ground's frame.
    const nu = t.n[0] * ch - t.n[1] * sh, nv = t.n[0] * sh + t.n[1] * ch, nz = t.n[2];
    const lam = Math.max(0, nu * LIGHT[0] + nv * LIGHT[1] + nz * LIGHT[2]);
    const base = COLOUR[t.mat];
    let lit = GLOWS.has(t.mat) ? 0.88 + 0.12 * lam : 0.55 + 0.45 * lam;
    let c: V3 = [base[0] * lit, base[1] * lit, base[2] * lit];
    if (t.mat === "glass") {
      // Glass shows the sky as it turns up to it.
      const sky = Math.max(0, nz) * 0.55 + Math.max(0, nv) * 0.12;
      c = [c[0] + 0.42 * sky, c[1] + 0.5 * sky, c[2] + 0.6 * sky];
      lit = 1;
    }
    const lo = (v: number, hi: number) => Math.max(0, Math.min(hi, v));
    const mx0 = Math.floor(lo(Math.min(ax, bx, cx), SW)), mx1 = Math.ceil(lo(Math.max(ax, bx, cx), SW));
    const my0 = Math.floor(lo(Math.min(ay, by, cy), SH)), my1 = Math.ceil(lo(Math.max(ay, by, cy), SH));
    const layerOf = PAINTED.has(t.mat) ? 1 : 2;
    const shadeLow = t.mat !== "glass" && !GLOWS.has(t.mat);
    for (let y = my0; y < my1; y++) {
      const py = y + 0.5;
      for (let x = mx0; x < mx1; x++) {
        const px = x + 0.5;
        const w0 = ((bx - px) * (cy - py) - (by - py) * (cx - px)) / area;
        const w1 = ((cx - px) * (ay - py) - (cy - py) * (ax - px)) / area;
        const w2 = 1 - w0 - w1;
        if (w0 < 0 || w1 < 0 || w2 < 0) continue;
        const z = w0 * d[0] + w1 * d[1] + w2 * d[2];
        const i = y * SW + x;
        if (z <= depth[i]) continue;
        depth[i] = z;
        // Darker low down, toward the shade under the car.
        const ao = shadeLow ? 0.78 + 0.22 * Math.min(1, (w0 * zm[0] + w1 * zm[1] + w2 * zm[2]) / 0.9) : 1;
        col[i * 3] = c[0] * ao; col[i * 3 + 1] = c[1] * ao; col[i * 3 + 2] = c[2] * ao;
        layer[i] = layerOf;
      }
    }
  }

  // THE SHADOW on the road: a soft rounded rectangle under the car, where nothing of it is drawn.
  const shadowAt = (sx: number, sy: number) => {
    const a = (sx / SS + x0) / (HW * res), b = (sy / SS + y0) / (HH * res); // u − v, u + v
    const u = (a + b) / 2, v = (b - a) / 2;
    // Back into the car's frame, metres, a touch toward the shade (+x on the ground).
    const uu = u / TILES_PER_M - 0.12, vv = v / TILES_PER_M + 0.06;
    const l = uu * ch + vv * sh, w = -uu * sh + vv * ch;
    const ex = Math.max(Math.abs(l) - (m.length / 2 - 0.25), 0), ey = Math.max(Math.abs(w) - (m.width / 2 - 0.25), 0);
    const out = Math.hypot(ex, ey);
    return 0.42 * (1 - Math.min(1, Math.max(0, (out - 0.08) / 0.4)));
  };

  // DOWN TO TEXELS.
  const paint = { w: W, h: H, px: new Uint8Array(W * H * 4) };
  const trim = { w: W, h: H, px: new Uint8Array(W * H * 4) };
  const N = SS * SS;
  const to8 = (v: number) => Math.round(Math.max(0, Math.min(1, v)) * 255);
  for (let ty = 0; ty < H; ty++) for (let tx = 0; tx < W; tx++) {
    let np = 0, pr = 0, pg = 0, pb = 0;
    let at = 0, tr = 0, tg = 0, tb = 0;
    for (let sy = 0; sy < SS; sy++) for (let sx = 0; sx < SS; sx++) {
      const X = tx * SS + sx, Y = ty * SS + sy, i = Y * SW + X;
      if (layer[i] === 1) { np++; pr += col[i * 3]; pg += col[i * 3 + 1]; pb += col[i * 3 + 2]; }
      else if (layer[i] === 2) { at += 1; tr += col[i * 3]; tg += col[i * 3 + 1]; tb += col[i * 3 + 2]; }
      else { at += shadowAt(X + 0.5, Y + 0.5); }
    }
    const o = (ty * W + tx) * 4;
    if (at > 0) {
      // Shadow samples add alpha and no colour: black.
      trim.px[o] = to8(tr / at); trim.px[o + 1] = to8(tg / at); trim.px[o + 2] = to8(tb / at); trim.px[o + 3] = to8(at / N);
    }
    if (np > 0) {
      paint.px[o] = to8(pr / np); paint.px[o + 1] = to8(pg / np); paint.px[o + 2] = to8(pb / np);
      // Under the trim, so trim over it gives the texel's coverage.
      paint.px[o + 3] = to8(np / Math.max(1e-6, N - at));
    }
  }
  return { paint, trim, ox: -x0, oy: -y0 };
}
