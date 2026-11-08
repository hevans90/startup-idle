/**
 * World v2 — MARKS ON THE GROUND a disaster leaves: a SCORCH under and round
 * a building burnt out, and CRACKS under and round one an earthquake
 * damaged. Each stays while the building is damaged by it, and fades out
 * over minutes once it is rebuilt.
 *
 * PAINTED, NOT DRAWN. A mark is a field over the ground in tile coordinates
 * — how burnt, how cracked, at any point — worked out from the building's
 * footprint and a seed. Each tile it covers gets a canvas of its own diamond,
 * painted a pixel at a time from that field, so neighbouring tiles join
 * without a seam however the field runs across them.
 *
 * A sprite a tile, in the tile's band's paved tier: over the ground and the
 * roads, under every building — so the ring round the building shows, and
 * what stands in front still hides it. Added when the mark starts and taken
 * out when it has faded; in between only its alpha changes, once a second.
 * @see plans/disaster-rendering.md
 */
import { Sprite, Texture } from "pixi.js";

import { idx, inBounds, structureAt, type Grid, type Structure } from "../grid";
import { bandOf, cellToWorld, HH, HW } from "../iso";
import type { DamageCause } from "../events/damage";
import type { RenderCtx } from "../structures/render";

export type DecalKind = "scorch" | "crack";
/** How long a mark takes to fade once its building is rebuilt. */
export const DECAL_FADE_MS: Record<DecalKind, number> = { scorch: 180_000, crack: 120_000 };
const OF_CAUSE: Partial<Record<DamageCause, DecalKind>> = { fire: "scorch", quake: "crack" };
/** How far out from the footprint a mark reaches, tiles: the ring it is painted on. */
const REACH = 2;
/** Canvas pixels to a scene pixel at scale 1: crisp when zoomed in. */
const RES = 2;

// ---------------------------------------------------------------------------
// NOISE: value noise, smooth, the same for the same seed.

const hash = (x: number, y: number, seed: number) => {
  let h = (x * 374761393 + y * 668265263 + seed * 2246822519) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};
const smooth = (t: number) => t * t * (3 - 2 * t);
function valueNoise(x: number, y: number, seed: number) {
  const x0 = Math.floor(x), y0 = Math.floor(y), fx = smooth(x - x0), fy = smooth(y - y0);
  const a = hash(x0, y0, seed), b = hash(x0 + 1, y0, seed), c = hash(x0, y0 + 1, seed), d = hash(x0 + 1, y0 + 1, seed);
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}
/** Fractal noise, 0 to 1 about a half: `octaves` of value noise, each finer and fainter. */
export function fbm(x: number, y: number, seed: number, octaves = 4) {
  let sum = 0, amp = 0.5, norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += valueNoise(x, y, seed + o * 101) * amp;
    norm += amp;
    x *= 2.03; y *= 2.03; amp *= 0.5;
  }
  return sum / norm;
}
const clamp01 = (t: number) => (t < 0 ? 0 : t > 1 ? 1 : t);
const step = (a: number, b: number, t: number) => smooth(clamp01((t - a) / (b - a)));

/** How far a point is outside a footprint, tiles; 0 on or in it. */
function outside(s: Pick<Structure, "x" | "y" | "w" | "h">, X: number, Y: number) {
  const dx = Math.max(s.x - 0.5 - X, 0, X - (s.x + s.w - 0.5));
  const dy = Math.max(s.y - 0.5 - Y, 0, Y - (s.y + s.h - 0.5));
  return Math.hypot(dx, dy);
}

/** A colour and how much of it, for one point of a mark. */
export type Ink = { r: number; g: number; b: number; a: number };
const NONE: Ink = { r: 0, g: 0, b: 0, a: 0 };
/** `top` laid over `under`, as paint is. */
function over(under: Ink, top: Ink): Ink {
  const a = top.a + under.a * (1 - top.a);
  if (a <= 0) return NONE;
  const k = (c: "r" | "g" | "b") => (top[c] * top.a + under[c] * under.a * (1 - top.a)) / a;
  return { r: k("r"), g: k("g"), b: k("b"), a };
}

// ---------------------------------------------------------------------------
// THE SCORCH: char against the building, broken up and running out in soot
// tongues; a singed brown fringe beyond it; grey ash where it burnt hardest.

/** The scorch at a point, tile coordinates. Pure. */
export function scorchAt(s: Pick<Structure, "x" | "y" | "w" | "h">, seed: number, X: number, Y: number): Ink {
  const d = outside(s, X, Y);
  if (d > REACH) return NONE;
  const cx = s.x + (s.w - 1) / 2, cy = s.y + (s.h - 1) / 2;
  // Tongues: further out in some directions than others, as the wind had it.
  const ang = Math.atan2(Y - cy, X - cx);
  const tongue = fbm(Math.cos(ang) * 1.6 + 7, Math.sin(ang) * 1.6 + 7, seed + 11, 3);
  const n = fbm(X * 2.4, Y * 2.4, seed, 5);
  const reach = 0.55 + 1.1 * tongue * tongue;
  const e = d / reach + (n - 0.5) * 0.9;
  // The char: near black, warmer at its thin edge.
  const char = 1 - step(0.4, 1.05, e);
  let ink: Ink = NONE;
  // The singe beyond it: grass browned, a band fading out.
  const singe = step(0.5, 0.9, e) * (1 - step(1, 1.6, e));
  if (singe > 0) ink = over(ink, { r: 96, g: 62, b: 28, a: 0.42 * singe * (0.6 + 0.8 * n) });
  if (char > 0) {
    const grain = fbm(X * 9, Y * 9, seed + 3, 3);
    const warm = clamp01((e - 0.3) * 1.6);
    ink = over(ink, {
      r: 12 + 46 * warm + 14 * grain, g: 9 + 26 * warm + 10 * grain, b: 7 + 12 * warm + 6 * grain,
      a: Math.min(0.97, char * (0.86 + 0.25 * grain)),
    });
  }
  // Ash: pale grey, patchy, only where it burnt hardest.
  const ash = step(0.62, 0.78, fbm(X * 7 + 3, Y * 7 + 9, seed + 5, 3)) * (1 - step(0.2, 0.6, e));
  if (ash > 0) ink = over(ink, { r: 150, g: 146, b: 140, a: 0.55 * ash });
  return ink;
}

// ---------------------------------------------------------------------------
// THE CRACKS: fissures out of the footprint, wandering, tapering, branching;
// each a dark core, a lit lip on one side and a shadow on the other, with
// dust kicked up round it and broken ground at its root.

/** A fissure's piece: from a to b, half as wide at each end as given. */
export type Seg = { ax: number; ay: number; bx: number; by: number; wa: number; wb: number };

/** The fissures for a footprint: the same for the same seed. Pure. */
export function cracksOf(s: Pick<Structure, "x" | "y" | "w" | "h">, seed: number): Seg[] {
  let k = seed >>> 0;
  const r = () => { k = (Math.imul(k, 1664525) + 1013904223) >>> 0; return k / 4294967296; };
  const out: Seg[] = [];
  const cx = s.x + (s.w - 1) / 2, cy = s.y + (s.h - 1) / 2;
  const walk = (x: number, y: number, ang: number, len: number, w: number, depth: number) => {
    // Straight runs and sharp kinks, as ground breaks: not a root's curve.
    let done = 0, i = 0;
    while (done < len) {
      ang += r() < 0.35 ? (r() - 0.5) * 1.5 : (r() - 0.5) * 0.25;
      const l = Math.min(len - done, 0.1 + 0.14 * r());
      const nx = x + Math.cos(ang) * l, ny = y + Math.sin(ang) * l;
      const wa = w * (1 - done / len), wb = w * (1 - (done + l) / len);
      out.push({ ax: x, ay: y, bx: nx, by: ny, wa, wb });
      if (depth < 1 && i > 0 && r() < 0.18) walk(nx, ny, ang + (r() < 0.5 ? 1 : -1) * (0.5 + 0.7 * r()), len * (0.2 + 0.25 * r()), wb * 0.6, depth + 1);
      x = nx; y = ny; done += l; i++;
    }
  };
  // Main fissures, from round the footprint's edge, outwards.
  const n = 5 + Math.floor(r() * 3);
  for (let f = 0; f < n; f++) {
    const a = ((f + r() * 0.7) / n) * Math.PI * 2;
    // Where a ray from the middle leaves the footprint.
    const ex = Math.cos(a), ey = Math.sin(a);
    const t = Math.min(Math.abs((s.w / 2) / (ex || 1e-6)), Math.abs((s.h / 2) / (ey || 1e-6)));
    walk(cx + ex * t * 0.85, cy + ey * t * 0.85, a, 0.9 + 0.8 * r(), 0.026 + 0.014 * r(), 0);
  }
  // Hairlines, here and there in the ring.
  for (let h = 0; h < 5; h++) {
    const a = r() * Math.PI * 2, dist = 0.7 + r() * 0.9;
    walk(cx + Math.cos(a) * (s.w / 2 + dist), cy + Math.sin(a) * (s.h / 2 + dist), r() * Math.PI * 2, 0.2 + 0.25 * r(), 0.009, 1);
  }
  return out;
}

/** The cracks at a point, tile coordinates, from its fissures (only those near it). Pure. */
export function crackAt(s: Pick<Structure, "x" | "y" | "w" | "h">, segs: readonly Seg[], seed: number, X: number, Y: number): Ink {
  const d = outside(s, X, Y);
  if (d > REACH) return NONE;
  // Nearest fissure: how far from its edge, and which side of it.
  // Lit from the top of the screen: the side of a fissure facing -x and -y.
  let best = Infinity, side = 0, width = 0;
  for (const g of segs) {
    const vx = g.bx - g.ax, vy = g.by - g.ay, len2 = vx * vx + vy * vy || 1e-9;
    const t = clamp01(((X - g.ax) * vx + (Y - g.ay) * vy) / len2);
    const px = g.ax + vx * t, py = g.ay + vy * t;
    const hw = g.wa + (g.wb - g.wa) * t;
    const dist = Math.hypot(X - px, Y - py) - hw;
    if (dist < best) { best = dist; side = -((X - px) + (Y - py)); width = hw; }
  }
  let ink: Ink = NONE;
  // Broken, dusty ground at the building's foot, fading out.
  const n = fbm(X * 3, Y * 3, seed, 4);
  const rubble = (1 - step(0.05, 0.7, d + (n - 0.5) * 0.4)) * 0.35;
  if (rubble > 0) ink = over(ink, { r: 120, g: 104, b: 84, a: rubble });
  // Dust along each fissure.
  const dust = (1 - step(0, 0.1, best)) * 0.22;
  if (dust > 0) ink = over(ink, { r: 108, g: 96, b: 80, a: dust });
  // The lip, lit on the side the light comes from; a shadow on the other.
  const aa = 0.006;
  // The far side has sunk: a broader shadow there, the near side's broken lip catching the light.
  const lit = side > 0;
  const rim = (1 - step(0, lit ? 0.012 + width * 0.3 : 0.03 + width * 0.9, best)) * step(-aa, aa, best);
  if (rim > 0) ink = over(ink, lit ? { r: 236, g: 226, b: 206, a: 0.55 * rim } : { r: 24, g: 20, b: 16, a: 0.3 * rim });
  // The core: dark, deepest where it is widest.
  const core = 1 - step(-aa, aa, best);
  if (core > 0) ink = over(ink, { r: 18, g: 14, b: 11, a: 0.92 * core });
  return ink;
}

// ---------------------------------------------------------------------------

/** A mark's tiles: its footprint, and the ground round it out to `REACH` not under another building. */
export function decalTiles(g: Grid, s: Structure): { x: number; y: number; inner: boolean }[] {
  const out: { x: number; y: number; inner: boolean }[] = [];
  for (let y = s.y - REACH; y < s.y + s.h + REACH; y++) {
    for (let x = s.x - REACH; x < s.x + s.w + REACH; x++) {
      if (!inBounds(g, x, y)) continue;
      const inner = x >= s.x && x < s.x + s.w && y >= s.y && y < s.y + s.h;
      if (!inner && structureAt(g, x, y) >= 0) continue;
      out.push({ x, y, inner });
    }
  }
  return out;
}

/** A tile's pixels from a mark's field: its diamond only, RGBA, `w` by `h`. Null when there is nothing on it. */
export function paintTile(x: number, y: number, at: (X: number, Y: number) => Ink): { w: number; h: number; data: Uint8ClampedArray } | null {
  const w = Math.ceil(2 * HW * RES), h = Math.ceil(2 * HH * RES);
  const data = new Uint8ClampedArray(w * h * 4);
  let any = false;
  for (let py = 0; py < h; py++) {
    for (let px = 0; px < w; px++) {
      // The pixel's place on the tile: u along x, v along y, each -½ to ½.
      const sx = (px + 0.5 - w / 2) / RES / HW, sy = (py + 0.5 - h / 2) / RES / HH;
      const du = (sx + sy) / 2, dv = (sy - sx) / 2;
      // A hair over the diamond, so neighbours overlap rather than leave a gap.
      const edge = Math.max(Math.abs(du), Math.abs(dv));
      if (edge > 0.505) continue;
      const ink = at(x + du, y + dv);
      if (ink.a <= 0.004) continue;
      const fade = edge > 0.495 ? (0.505 - edge) / 0.01 : 1;
      const i = (py * w + px) * 4;
      data[i] = ink.r; data[i + 1] = ink.g; data[i + 2] = ink.b; data[i + 3] = Math.round(255 * ink.a * fade);
      any = true;
    }
  }
  return any ? { w, h, data } : null;
}

/** The mark's field for a building, a tile at a time: what paints each point of tile (x, y). */
export function fieldOf(kind: DecalKind, s: Pick<Structure, "x" | "y" | "w" | "h">, seed: number): (x: number, y: number) => (X: number, Y: number) => Ink {
  if (kind === "scorch") return () => (X, Y) => scorchAt(s, seed, X, Y);
  const segs = cracksOf(s, seed);
  return (x, y) => {
    // Only the fissures that come near this tile: past its edge by more than
    // the widest lip and dust, none can touch it.
    const near = segs.filter((g) => Math.min(g.ax, g.bx) < x + 0.7 && Math.max(g.ax, g.bx) > x - 0.7 && Math.min(g.ay, g.by) < y + 0.7 && Math.max(g.ay, g.by) > y - 0.7);
    return (X, Y) => crackAt(s, near, seed, X, Y);
  };
}

/** The marks wanted now: one a building damaged by fire or quake, by key. Pure. */
export function decalsWanted(damaged: Iterable<readonly [number, DamageCause]>): Map<string, { id: number; kind: DecalKind }> {
  const out = new Map<string, { id: number; kind: DecalKind }>();
  for (const [id, cause] of damaged) {
    const kind = OF_CAUSE[cause];
    if (kind) out.set(`${kind}:${id}`, { id, kind });
  }
  return out;
}

/** How solid a mark is, `since` ms after its building was rebuilt; null once gone. */
export function decalAlpha(kind: DecalKind, since: number | null): number | null {
  if (since === null) return 1;
  const a = 1 - since / DECAL_FADE_MS[kind];
  return a > 0 ? a : null;
}

export type Decals = {
  /** Put down, fade or take up the marks, for what is damaged now; once a second. */
  sync: (ctx: RenderCtx, damaged: readonly (readonly [number, DamageCause])[], now: number) => void;
  clear: () => void;
};

/** A canvas's texture from painted pixels. */
function textureOfPixels(p: { w: number; h: number; data: Uint8ClampedArray }): Texture {
  const c = document.createElement("canvas");
  c.width = p.w; c.height = p.h;
  c.getContext("2d")!.putImageData(new ImageData(p.data as Uint8ClampedArray<ArrayBuffer>, p.w, p.h), 0, 0);
  return Texture.from(c);
}

/** Time a slice of painting may take before it lets a frame through, ms. */
const SLICE_MS = 6;

/**
 * `texture`: what a tile's pixels become, for a test with no canvas to paint
 * on; `later`: how the next slice of painting is put off — a test runs it now.
 */
export function createDecals(opts: { texture?: (p: { w: number; h: number; data: Uint8ClampedArray }) => Texture; later?: (fn: () => void) => void } = {}): Decals {
  const toTexture = opts.texture ?? textureOfPixels;
  const later = opts.later ?? ((fn: () => void) => { setTimeout(fn, 0); });
  type Mark = { kind: DecalKind; tiles: Sprite[]; rebuilt: number | null; alpha: number };
  /** Each mark: its tiles' sprites, when its building was rebuilt if it has been, and how solid it is. */
  const marks = new Map<string, Mark>();
  /** Tiles still to paint, a few a slice: a mark's dozen tiles at once would hold up a frame. */
  const queue: { mark: Mark; paint: () => Sprite | null }[] = [];
  let draining = false;
  const drain = () => {
    const t0 = performance.now();
    while (queue.length && performance.now() - t0 < SLICE_MS) {
      const job = queue.shift()!;
      // Its mark taken up meanwhile: nothing to paint.
      if (![...marks.values()].includes(job.mark)) continue;
      const sp = job.paint();
      if (sp) { sp.alpha = job.mark.alpha; job.mark.tiles.push(sp); }
    }
    if (queue.length) later(drain);
    else draining = false;
  };
  const drop = (key: string) => {
    for (const t of marks.get(key)?.tiles ?? []) {
      if (t.destroyed) continue;
      t.parent?.removeChild(t);
      const tex = t.texture;
      t.destroy();
      if (tex !== Texture.WHITE && tex !== Texture.EMPTY) tex.destroy(true);
    }
    marks.delete(key);
  };
  return {
    sync(ctx, damaged, now) {
      const g = ctx.grid;
      const want = decalsWanted(damaged);
      for (const [key, m] of marks) {
        // Its band went with a rebuilt map: put down again, below.
        if (m.tiles.some((t) => t.destroyed || !t.parent || t.parent.destroyed)) { drop(key); continue; }
        if (want.has(key)) { m.rebuilt = null; m.alpha = 1; continue; }
        m.rebuilt ??= now;
        const a = decalAlpha(m.kind, now - m.rebuilt);
        if (a === null) { drop(key); continue; }
        m.alpha = a;
        for (const t of m.tiles) t.alpha = a;
      }
      for (const [key, w] of want) {
        if (marks.has(key)) continue;
        const s = g.structures.get(w.id);
        if (!s) continue;
        const field = fieldOf(w.kind, s, (w.id * 7919) >>> 0);
        const mark: Mark = { kind: w.kind, tiles: [], rebuilt: null, alpha: 1 };
        marks.set(key, mark);
        for (const t of decalTiles(g, s)) {
          const layer = ctx.bands.pavedOf[bandOf(t.x, t.y)];
          if (!layer) continue;
          const { wx, wy } = cellToWorld(t.x, t.y, g.height[idx(g, t.x, t.y)], ctx.scale);
          queue.push({
            mark,
            paint: () => {
              if (layer.destroyed) return null;
              const px = paintTile(t.x, t.y, field(t.x, t.y));
              if (!px) return null;
              const sp = new Sprite(toTexture(px));
              sp.label = "decal";
              sp.anchor.set(0.5);
              sp.position.set(wx, wy);
              sp.scale.set(ctx.scale / RES);
              sp.eventMode = "none";
              layer.addChild(sp);
              return sp;
            },
          });
        }
      }
      if (queue.length && !draining) { draining = true; later(drain); }
    },
    clear() {
      for (const key of [...marks.keys()]) drop(key);
      queue.length = 0;
    },
  };
}
