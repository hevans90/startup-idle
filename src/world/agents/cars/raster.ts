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
import { HALF_STEPS_PER_M, TILES_PER_M, type Disc, type Hull, type Mat, type Model, type Section, type Slab } from "./models";

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
  liveryWhite: [0.93, 0.93, 0.92], liveryBlack: [0.09, 0.09, 0.1], liveryRed: [0.72, 0.08, 0.07], liveryGreen: [0.2, 0.62, 0.26],
  load: [0.6, 0.45, 0.28], brick: [0.64, 0.32, 0.23], gravel: [0.56, 0.53, 0.49], aiLoad: [0.16, 0.15, 0.22],
  sign: [0.98, 0.82, 0.22], violet: [0.66, 0.38, 1.0],
  seam: [0.3, 0.3, 0.32], arch: [0.05, 0.05, 0.06], rim: [0.7, 0.72, 0.75], spoke: [0.08, 0.08, 0.09],
};
/** How glossy: the highlight's strength and tightness. Paint and glass shine; tyres and plastic don't. */
const GLOSS: Partial<Record<Mat, [number, number]>> = {
  paint: [0.38, 36], roofBlack: [0.3, 36], roofWhite: [0.3, 36], glass: [0.7, 70], chrome: [0.65, 24], rim: [0.45, 20],
  liveryWhite: [0.32, 36], liveryBlack: [0.38, 36], liveryRed: [0.32, 36], liveryGreen: [0.3, 36], livery: [0.25, 30], liveryAlt: [0.25, 30],
  lamp: [0.4, 40], tail: [0.4, 40],
};
const PAINTED: ReadonlySet<Mat> = new Set(["paint"]);
/** Lit from within: they barely take the light. */
const GLOWS: ReadonlySet<Mat> = new Set(["lamp", "tail", "indicator", "light", "sign", "violet"]);

/** The light, in the ground's own frame (u, v, up), true lengths. */
const LIGHT = (() => { const v = [-0.3, 0.6, 1.0]; const n = Math.hypot(...v); return v.map((c) => c / n); })();

type V3 = [number, number, number];
/** A triangle: its points in the model's metres, its material, its face's normal, and, if smooth, a normal at each point. */
type Tri = { p: [V3, V3, V3]; mat: Mat; n: V3; ns?: [V3, V3, V3]; paint?: (p: V3) => Mat };
/** Toward the camera, true lengths: the line of sight (1, 1, 4) in tiles and half steps. */
const VIEW = norm3([1, 1, 4 * 0.2041]);
/** Halfway between the light and the eye, for the highlight. */
const HALF = norm3([LIGHT[0] + VIEW[0], LIGHT[1] + VIEW[1], LIGHT[2] + VIEW[2]]);
function norm3(a: number[]): V3 { const n = Math.hypot(...a) || 1; return [a[0] / n, a[1] / n, a[2] / n]; }

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

/**
 * A wheel each side: a tread shaded round, a sidewall bulging a touch, and a
 * rim — five spokes, or a steel wheel's plain dish — with a cap in the middle.
 */
function wheelTris(l: number, w: number, r: number, width: number, rim: "spokes" | "steel", out: Tri[]) {
  const N = 24;
  const ring = (wy: number, rr: number, n = N, a0 = 0): V3[] => Array.from({ length: n }, (_, k) => {
    const a = a0 + (k / n) * Math.PI * 2;
    return [l + rr * Math.cos(a), wy, r + rr * Math.sin(a)];
  });
  for (const side of [1, -1]) {
    const wo = side * (w + width / 2), wi = side * (w - width / 2), wall = side * (w + width / 2 + 0.012);
    const centre: V3 = [l, side * w, r];
    // The tread, its normals pointing straight out from the axle.
    const outer = ring(wo, r * 0.97), inner = ring(wi, r * 0.97), mid = ring(side * w, r);
    for (let k = 0; k < N; k++) {
      const k1 = (k + 1) % N;
      const rad = (q: V3): V3 => norm3([q[0] - l, 0, q[2] - r]);
      for (const [a, b] of [[outer, mid], [mid, inner]]) {
        const quad: V3[] = [a[k], a[k1], b[k1], b[k]];
        const tris: [V3, V3, V3][] = [[quad[0], quad[1], quad[2]], [quad[0], quad[2], quad[3]]];
        for (const t of tris) out.push({ p: t, mat: "tyre", n: rad(t[0]), ns: [rad(t[0]), rad(t[1]), rad(t[2])] });
      }
    }
    // The sidewall, the rim inside it, then spokes or holes, and the cap.
    face(ring(wall, r * 0.97), "tyre", centre, out);
    face(ring(wall + side * 0.004, r * 0.66), "rim", centre, out);
    if (rim === "spokes") {
      face(ring(wall + side * 0.006, r * 0.6), "spoke", centre, out);
      for (let k = 0; k < 5; k++) {
        const a = (k / 5) * Math.PI * 2, da = 0.2;
        const at = (rr: number, aa: number): V3 => [l + rr * Math.cos(aa), wall + side * 0.008, r + rr * Math.sin(aa)];
        face([at(r * 0.12, a - da * 1.6), at(r * 0.12, a + da * 1.6), at(r * 0.6, a + da), at(r * 0.6, a - da)], "rim", centre, out);
      }
    } else {
      for (let k = 0; k < 6; k++) {
        const a = (k / 6) * Math.PI * 2;
        face(ring(wall + side * 0.006, r * 0.07, 8).map((q) => [q[0] + r * 0.42 * Math.cos(a), q[1], q[2] + r * 0.42 * Math.sin(a)] as V3), "spoke", centre, out);
      }
    }
    face(ring(wall + side * 0.01, r * 0.16, 10), "hub", centre, out);
  }
}

/** A section's outline, its right half from the sill up round the shoulder to the middle of the top: (across, up) pairs. */
function profile(s: Section): [number, number][] {
  const inS = s.inS ?? 0, h = s.z1 - s.z0, r = Math.min(s.r ?? 0.08, h * 0.45, (s.w - inS) * 0.9);
  const tuck = Math.min(0.04, h * 0.1), foot = Math.min(0.1, h * 0.2);
  const pts: [number, number][] = [[s.w - tuck, s.z0], [s.w, s.z0 + foot]];
  // The side, leaning in to the shoulder: a corner at (w − inS, z1), rounded off by a curve r either side of it.
  const cx = s.w - inS, cz = s.z1;
  const sideLen = Math.hypot(inS, h - foot);
  const ax = cx + (inS * r) / sideLen, az = cz - ((h - foot) * r) / sideLen;
  const bx = cx - r, bz = cz;
  const K = 5;
  for (let k = 0; k <= K; k++) {
    const t = k / K, u = 1 - t;
    pts.push([u * u * ax + 2 * u * t * cx + t * t * bx, u * u * az + 2 * u * t * cz + t * t * bz]);
  }
  pts.push([0, s.z1]);
  return pts;
}

/**
 * A hull, lofted: each section's outline, both halves, joined to the next
 * one's. Normals are smoothed along the outline and along the car, except
 * across a crease; the ends are capped flat.
 */
function hullTris(h: Hull, out: Tri[]) {
  const wc = h.wc ?? 0, S = h.sections;
  const rings: V3[][] = S.map((s) => {
    const half = profile(s);
    const right = half.map(([x, z]): V3 => [s.l, wc - x, z]);
    const left = half.slice(0, -1).reverse().map(([x, z]): V3 => [s.l, wc + x, z]);
    return [...right, ...left];
  });
  const R = rings[0].length;
  const outward = (p: V3, s: Section): V3 => [0, p[1] - wc, p[2] - s.z0 + 0.001];
  // A point's normal, from its neighbours round the ring and along the car (one side only at a crease or an end).
  const normalAt = (i: number, k: number, toward: number): V3 => {
    const ring = rings[i];
    const ka = Math.max(0, k - 1), kb = Math.min(R - 1, k + 1);
    const tr = sub(ring[kb], ring[ka]);
    const ia = S[i].crease || i === 0 ? i : i - 1, ib = S[i].crease || i === S.length - 1 ? i : i + 1;
    let tl = sub(rings[ib][k], rings[ia][k]);
    if (ia === ib) tl = sub(rings[Math.min(S.length - 1, Math.max(0, i + toward))][k], ring[k]);
    if (Math.hypot(...tl) < 1e-6) tl = [toward || 1, 0, 0];
    let n = norm(cross(tr, tl));
    const o = outward(ring[k], S[i]);
    if (n[0] * o[0] + n[1] * o[1] + n[2] * o[2] < 0) n = [-n[0], -n[1], -n[2]];
    return n;
  };
  const pick = (m: Mat | ((l: number) => Mat), l: number) => (typeof m === "function" ? m(l) : m);
  const decals = h.decals ?? [];
  for (let i = 0; i + 1 < S.length; i++) {
    const lm = (S[i].l + S[i + 1].l) / 2;
    for (let k = 0; k + 1 < R; k++) {
      const q: V3[] = [rings[i][k], rings[i][k + 1], rings[i + 1][k + 1], rings[i + 1][k]];
      const ns: V3[] = [normalAt(i, k, 1), normalAt(i, k + 1, 1), normalAt(i + 1, k + 1, -1), normalAt(i + 1, k, -1)];
      const avg = norm([0, 1, 2, 3].reduce((a, j) => [a[0] + ns[j][0], a[1] + ns[j][1], a[2] + ns[j][2]] as V3, [0, 0, 0] as V3));
      const mat = pick(avg[2] > 0.62 ? h.top : h.side, lm);
      const paint = decals.length ? (p: V3) => {
        let m = mat;
        for (const d of decals) if (d.at(p[0], p[1], p[2])) m = d.mat;
        return m;
      } : undefined;
      for (const [a, b, c] of [[0, 1, 2], [0, 2, 3]]) {
        if (Math.hypot(...cross(sub(q[b], q[a]), sub(q[c], q[a]))) < 1e-9) continue;
        out.push({ p: [q[a], q[b], q[c]], mat, n: avg, ns: [ns[a], ns[b], ns[c]], paint });
      }
    }
  }
  const cap = (i: number, mat: Mat, dir: number) => {
    const ring = rings[i], inside: V3 = [S[i].l - dir, wc, (S[i].z0 + S[i].z1) / 2];
    // Fanned from the middle of its foot, so a concave outline still caps.
    const foot: V3 = [S[i].l, wc, S[i].z0];
    const from = out.length;
    for (let k = 0; k + 1 < R; k++) face([foot, ring[k], ring[k + 1]], mat, inside, out);
    if (decals.length) for (let j = from; j < out.length; j++) out[j].paint = (p: V3) => {
      let m = mat;
      for (const d of decals) if (d.at(p[0], p[1], p[2])) m = d.mat;
      return m;
    };
  };
  cap(0, h.front ?? pick(h.side, S[0].l), 1);
  cap(S.length - 1, h.back ?? pick(h.side, S[S.length - 1].l), -1);
}

/** A flat disc, or a slice of one, on each side. */
function discTris(d: Disc, out: Tri[]) {
  const a0 = d.a0 ?? 0, a1 = d.a1 ?? Math.PI * 2, N = Math.max(6, Math.round(((a1 - a0) / (Math.PI * 2)) * 24));
  for (const side of [1, -1]) {
    const pts: V3[] = [];
    if (a1 - a0 < Math.PI * 2 - 1e-6) pts.push([d.l, side * d.w, d.z]);
    for (let k = 0; k <= N; k++) { const a = a0 + ((a1 - a0) * k) / N; pts.push([d.l + d.r * Math.cos(a), side * d.w, d.z + d.r * Math.sin(a)]); }
    face(pts, d.mat, [d.l, 0, d.z], out);
  }
}

/** Every triangle of a model. */
export function modelTris(m: Model): Tri[] {
  const out: Tri[] = [];
  for (const h of m.hulls ?? []) hullTris(h, out);
  for (const s of m.slabs) slabTris(s, out);
  for (const d of m.discs ?? []) discTris(d, out);
  for (const wh of m.wheels) wheelTris(wh.l, wh.w, wh.r, wh.width, wh.rim ?? "spokes", out);
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
    // The light at a normal, turned into the ground's frame: diffuse, the sky in glass, and a highlight.
    const shade = (n: V3, mat: Mat): V3 => {
      const base = COLOUR[mat], gloss = GLOSS[mat], glows = GLOWS.has(mat);
      const nu = n[0] * ch - n[1] * sh, nv = n[0] * sh + n[1] * ch, nz = n[2];
      const lam = Math.max(0, nu * LIGHT[0] + nv * LIGHT[1] + nz * LIGHT[2]);
      const lit = glows ? 0.88 + 0.12 * lam : 0.55 + 0.45 * lam;
      let c: V3 = [base[0] * lit, base[1] * lit, base[2] * lit];
      if (mat === "glass") {
        // Glass shows the sky as it turns up to it.
        const sky = Math.max(0, nz) * 0.55 + Math.max(0, nv) * 0.12;
        c = [c[0] + 0.42 * sky, c[1] + 0.5 * sky, c[2] + 0.6 * sky];
      }
      if (gloss) {
        const sp = gloss[0] * Math.pow(Math.max(0, nu * HALF[0] + nv * HALF[1] + nz * HALF[2]), gloss[1]);
        c = [c[0] + sp, c[1] + sp, c[2] + sp];
      }
      return c;
    };
    const flat = t.ns || t.paint ? null : shade(t.n, t.mat);
    const lo = (v: number, hi: number) => Math.max(0, Math.min(hi, v));
    const mx0 = Math.floor(lo(Math.min(ax, bx, cx), SW)), mx1 = Math.ceil(lo(Math.max(ax, bx, cx), SW));
    const my0 = Math.floor(lo(Math.min(ay, by, cy), SH)), my1 = Math.ceil(lo(Math.max(ay, by, cy), SH));
    const P = t.p;
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
        const zAt = w0 * zm[0] + w1 * zm[1] + w2 * zm[2];
        const mat = t.paint ? t.paint([w0 * P[0][0] + w1 * P[1][0] + w2 * P[2][0], w0 * P[0][1] + w1 * P[1][1] + w2 * P[2][1], zAt]) : t.mat;
        // Darker low down, toward the shade under the car.
        const ao = mat !== "glass" && !GLOWS.has(mat) ? 0.78 + 0.22 * Math.min(1, zAt / 0.9) : 1;
        const c = flat ?? shade(t.ns ? norm([
          w0 * t.ns[0][0] + w1 * t.ns[1][0] + w2 * t.ns[2][0],
          w0 * t.ns[0][1] + w1 * t.ns[1][1] + w2 * t.ns[2][1],
          w0 * t.ns[0][2] + w1 * t.ns[1][2] + w2 * t.ns[2][2],
        ]) : t.n, mat);
        col[i * 3] = c[0] * ao; col[i * 3 + 1] = c[1] * ao; col[i * 3 + 2] = c[2] * ao;
        layer[i] = PAINTED.has(mat) ? 1 : 2;
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
