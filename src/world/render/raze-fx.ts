/**
 * World v2 — A BUILDING COMES DOWN. Whatever it is and whoever draws it — a
 * landmark's baked tiles, a house's stacked floors, a port's quay and cranes
 * — it is pieces, each over a tile of its plot (@see structures/render
 * `pieces`, `PIECE_TILE`), and it is pulled down A SECTION AT A TIME from
 * the side the digger works at:
 *
 *  - a section SHUDDERS as the bucket takes hold of it;
 *  - it GOES — its floors pancaking onto its footing, leaning away from the
 *    machine as it does — throwing masonry out over the ground and a bank of
 *    dust up over itself;
 *  - what is left of it is a HEAP OF RUBBLE where it stood, with its steel
 *    sticking out of it;
 *  - and when the last section is down the heaps are CLEARED, nearest first,
 *    into the lorry stood by the digger.
 *
 * The pieces are the building's own display objects, moved BY TRANSFORM —
 * squashed about their tile's footing — never taken out of their layers, so
 * nothing structural changes in a band while it happens; a job called off
 * puts every one of them back as it was.
 */
import { Graphics, Matrix, type Container } from "pixi.js";

import { idx, type Grid } from "../grid";
import { HEIGHT_UNIT, HH, HW, bandOf } from "../iso";
import { PIECE_TILE } from "../structures/render";
import type { BandLayer } from "./bands";

/** Of a demolition's time: when the first section goes, when the last is down, and when the clearing — which follows — is done. */
export const RAZE = { first: 0.1, down: 0.7, cleared: 0.97 } as const;
/** Masonry, brick, glass, steel: what flies off a building and lies in its heap. */
const BITS = [0x9a968f, 0x7d7972, 0xb5afa4, 0x8a5a44, 0xa0674e, 0x5f6b78, 0x4a4d52, 0xc9c2b4];
const DUST = 0xcfc5b3, HEAP = [0x6f6a63, 0x8c8780, 0xa39d93], STEEL = 0x3b3f45;
const GRAVITY = 520;
/** The longest a section is in going, seconds. */
const FALL_SECONDS = 3.2;

type Kept = { m0: Matrix; alpha: number; wrote: number[]; bx: number; by: number; top: number; tile: number };
type Bit = { x: number; y: number; vx: number; vy: number; ground: number; rot: number; spin: number; size: number; colour: number; age: number; rest: number };
type Puff = { x: number; y: number; vx: number; vy: number; r: number; grow: number; age: number; life: number };
type Tile = { x: number; y: number; bx: number; by: number; top: number; seed: number; heap: Graphics; band: number; was: number };
type Job = {
  kept: Map<Container, Kept>; tiles: Tile[]; order: number[]; bits: Bit[]; puffs: Puff[];
  air: Graphics; airBand: number; owed: number[]; puffOwed: number[];
};

export type RazeView = {
  /** Which section the digger is at — the one going, or the heap being cleared — and what it is doing; and how much of the rubble is on the lorry. */
  target: { x: number; y: number } | null; phase: "knock" | "clear" | "done"; loaded: number;
};
export type RazeFx = {
  /**
   * A frame of a building coming down: `p` of its time gone, `dt` on from the last; the pieces of it; the plot;
   * where the digger stands. Says what the digger is at.
   */
  sync(id: number, g: Grid, plot: { x: number; y: number; w: number; h: number }, nodes: readonly Container[], p: number, from: { x: number; y: number }, scale: number, dt: number, seconds: number): RazeView;
  /** Jobs not in `live` are over: their dust and heaps gone — and, the building still standing (called off), its pieces put back. */
  keep(live: ReadonlySet<number>): void;
  destroy(): void;
};

const ease = (t: number) => { const e = Math.max(0, Math.min(1, t)); return e * e * (3 - 2 * e); };
const hash = (n: number) => { const s = Math.sin(n * 12.9898) * 43758.5453; return s - Math.floor(s); };
const TMP = new Matrix(), C = new Matrix();
const written = (n: Container) => [n.position.x, n.position.y, n.scale.x, n.scale.y, n.skew.x, n.skew.y, n.rotation];
const same = (a: number[], b: number[]) => a.every((v, k) => Math.abs(v - b[k]) < 1e-5);

export function createRazeFx(bands: BandLayer): RazeFx {
  const jobs = new Map<number, Job>();
  const drop = (c: Container) => { c.parent?.removeChild(c); c.destroy(); };
  const layerOf = (band: number) => bands.dynamicOf[Math.max(0, Math.min(bands.dynamicOf.length - 1, band))];
  const end = (job: Job) => {
    // (Put back, each as it was — those still there: a building gone took its pieces with it.)
    for (const [n, k] of job.kept) if (!n.destroyed) { n.setFromMatrix(k.m0); n.alpha = k.alpha; }
    for (const t of job.tiles) drop(t.heap);
    drop(job.air);
  };
  return {
    sync(id, g, plot, nodes, p, from, scale, dt, seconds) {
      let job = jobs.get(id);
      const hOf = (x: number, y: number) => g.height[idx(g, Math.max(0, Math.min(g.w - 1, x)), Math.max(0, Math.min(g.h - 1, y)))];
      if (!job) {
        const tiles: Tile[] = [];
        for (let r = 0; r < plot.h; r++) for (let c = 0; c < plot.w; c++) {
          const x = plot.x + c, y = plot.y + r, h = hOf(x, y), heap = new Graphics();
          heap.eventMode = "none"; heap.context.batchMode = "batch"; heap.zIndex = 0.01;
          const band = bandOf(x, y);
          layerOf(band)?.addChild(heap);
          tiles.push({ x, y, bx: (x - y) * HW * scale, by: (x + y) * HH * scale - h * HEIGHT_UNIT * scale, top: 0, seed: hash(id * 7.3 + c * 3.1 + r * 5.7), heap, band, was: -1 });
        }
        // FROM THE DIGGER'S SIDE INWARD: the nearest section first.
        const order = tiles.map((_, k) => k).sort((a, b) => Math.hypot(tiles[a].x - from.x, tiles[a].y - from.y) - Math.hypot(tiles[b].x - from.x, tiles[b].y - from.y));
        const air = new Graphics();
        air.eventMode = "none"; air.context.batchMode = "batch"; air.zIndex = 3;
        const airBand = bandOf(plot.x + plot.w - 1, plot.y + plot.h - 1);
        layerOf(airBand)?.addChild(air);
        job = { kept: new Map(), tiles, order, bits: [], puffs: [], air, airBand, owed: tiles.map(() => 0), puffOwed: tiles.map(() => 0) };
        jobs.set(id, job);
      }
      // (A section is never longer going than a wall is falling: with few of them, the bucket worries at each first.)
      const J = job, N = J.tiles.length, span = (RAZE.down - RAZE.first) / N, long = Math.min(span * 1.25, FALL_SECONDS / Math.max(1, seconds));
      const goes = (i: number) => RAZE.first + span * i + Math.max(0, span - long);
      /** How far gone the `i`th section to go is, nought to one — below nought, not yet; and how long the bucket has had hold of it, nought to one, before it goes. */
      const goneOf = (i: number) => (p - goes(i)) / long;
      const heldOf = (i: number) => { const a = RAZE.first + span * i - Math.min(0.04, span * 0.5), b = goes(i); return p < a || p > b + long * 0.25 ? 0 : Math.min(1, (p - a) / Math.max(1e-4, b - a)); };
      const rank = new Map(J.order.map((t, i) => [t, i]));
      // ── ITS PIECES: each squashed about the footing of the tile it stands on ───────────────
      for (const n of nodes) {
        if (n.destroyed) continue;
        let k = J.kept.get(n);
        if (!k) {
          n.updateLocalTransform();
          const m0 = n.localTransform.clone(), b = n.getLocalBounds();
          // (Where it stands, in its layer's own space: the foot of its picture, and its top.)
          const xs = [b.minX, b.maxX], ys = [b.minY, b.maxY];
          let lo = Infinity, hi = -Infinity, cx = 0;
          for (const x of xs) for (const y of ys) { const py = m0.b * x + m0.d * y + m0.ty; lo = Math.min(lo, py); hi = Math.max(hi, py); cx += (m0.a * x + m0.c * y + m0.tx) / 4; }
          const told = PIECE_TILE.get(n);
          let tile = -1;
          if (told) tile = J.tiles.findIndex((t) => t.x === told.x && t.y === told.y);
          if (tile < 0) {
            // (Not told which tile: the one under the foot of its picture, or the nearest of the plot to that.)
            let best = Infinity;
            J.tiles.forEach((t, q) => { const d = Math.hypot(t.bx - cx, (t.by - hi) * 2); if (d < best) { best = d; tile = q; } });
          }
          const T = J.tiles[Math.max(0, tile)];
          if (Number.isFinite(lo)) T.top = Math.max(T.top, T.by - lo);
          k = { m0, alpha: n.alpha, wrote: [], bx: T.bx, by: T.by, top: Number.isFinite(lo) ? T.by - lo : 0, tile: Math.max(0, tile) };
          J.kept.set(n, k);
        } else if (k.wrote.length && !same(written(n), k.wrote)) {
          // (Moved by its own renderer since — a crane slewing, a gantry travelling: squashed from where it is now.)
          n.updateLocalTransform();
          k.m0 = n.localTransform.clone();
        }
        const i = rank.get(k.tile) ?? 0, q = goneOf(i), f = Math.max(0, Math.min(1, q));
        // (The bucket has hold of it: it shakes, more as it is about to go.)
        const shake = (0.35 + 0.9 * heldOf(i)) * (heldOf(i) > 0 ? 1 : 0) * scale;
        const jx = shake ? (hash(p * 9173 + i * 3.3) - 0.5) * 2 * shake : 0, jy = shake ? (hash(p * 7411 + i * 5.1) - 0.5) * shake : 0;
        const T = J.tiles[k.tile], away = Math.sign((T.x - T.y) - (from.x - from.y)) || (T.seed > 0.5 ? 1 : -1);
        // IT GOES: slowly at first, then all at once — its height onto its footing, leant away from the machine.
        const fall = f * f * (0.6 + 0.4 * f), sy = Math.max(0.001, 1 - fall), sh = away * 0.22 * Math.sin(Math.PI * Math.min(1, f * 1.15)) * (1 - fall * 0.5);
        C.set(1, 0, sh, sy, -sh * k.by + jx, k.by - sy * k.by + jy + fall * 2 * scale);
        TMP.copyFrom(k.m0).prepend(C);
        n.setFromMatrix(TMP);
        n.alpha = f >= 1 ? 0 : k.alpha * (f > 0.82 ? 1 - (f - 0.82) / 0.18 : 1);
        k.wrote = written(n);
      }
      // ── WHAT COMES OFF IT: masonry thrown out, dust thrown up, as each section goes ─────────
      J.tiles.forEach((T, t) => {
        const i = rank.get(t) ?? 0, q = goneOf(i), f = Math.max(0, Math.min(1, q)), H = Math.max(18 * scale, T.top);
        if (q > 0.02 && q < 1 && dt > 0) {
          const rate = 26 + 30 * Math.sin(Math.PI * f);
          for (J.owed[t] += rate * dt; J.owed[t] >= 1 && J.bits.length < 220; J.owed[t]--) {
            const a = hash(J.bits.length * 1.7 + p * 311 + t), b = hash(J.bits.length * 2.9 + p * 173 + t * 3), c = hash(J.bits.length * 4.3 + p * 97);
            J.bits.push({
              x: T.bx + (a - 0.5) * HW * scale * 0.9, y: T.by - H * (1 - f * 0.85) * (0.25 + 0.75 * b), vx: (a - 0.5) * 150 * scale * (0.4 + c), vy: -(20 + 90 * c) * scale,
              ground: T.by + (b - 0.35) * HH * scale * 0.9, rot: a * 6, spin: (c - 0.5) * 14, size: (1.3 + 2.6 * c * c) * scale, colour: BITS[Math.floor(b * BITS.length) % BITS.length], age: 0, rest: 0,
            });
          }
          for (J.puffOwed[t] += (7 + 16 * Math.sin(Math.PI * f)) * dt; J.puffOwed[t] >= 1 && J.puffs.length < 90; J.puffOwed[t]--) {
            const a = hash(J.puffs.length * 3.1 + p * 517 + t), b = hash(J.puffs.length * 5.3 + p * 233);
            J.puffs.push({ x: T.bx + (a - 0.5) * HW * scale * 1.1, y: T.by - H * (1 - fallen(f)) * b * 0.8, vx: (a - 0.5) * 26 * scale, vy: -(8 + 22 * b) * scale, r: (5 + 7 * b) * scale, grow: (9 + 12 * a) * scale, age: 0, life: 1.6 + 1.6 * b });
          }
        }
      });
      const air = J.air;
      air.clear();
      for (const b of J.bits) {
        if (b.rest > 0) { b.rest += dt; continue; }
        b.age += dt; b.vy += GRAVITY * scale * dt; b.x += b.vx * dt; b.y += b.vy * dt; b.rot += b.spin * dt;
        if (b.y >= b.ground && b.vy > 0) {
          // (It lands, skips once if it came in fast, and lies.)
          if (b.vy > 150 * scale && b.spin !== 0) { b.y = b.ground; b.vy *= -0.28; b.vx *= 0.5; b.spin = 0; }
          else { b.y = b.ground; b.rest = 1e-3; }
        }
      }
      // (What has lain a while is the heap's: gone from the air's drawing, the oldest first.)
      J.bits = J.bits.filter((b) => b.rest < 2.2 && b.age < 6);
      for (const b of J.bits) {
        const s = b.size, co = Math.cos(b.rot), si = Math.sin(b.rot) * 0.6, fade = b.rest > 1.4 ? 1 - (b.rest - 1.4) / 0.8 : 1;
        air.poly([b.x - s * co, b.y - s * si, b.x + s * si, b.y - s * co * 0.7, b.x + s * co, b.y + s * si, b.x - s * si, b.y + s * co * 0.7]).fill({ color: b.colour, alpha: fade });
      }
      J.puffs = J.puffs.filter((q) => q.age < q.life);
      for (const q of J.puffs) {
        q.age += dt; q.x += q.vx * dt; q.y += q.vy * dt; q.vx *= 1 - 0.8 * dt; q.vy *= 1 - 0.9 * dt;
        const u = q.age / q.life;
        air.circle(q.x, q.y, q.r + q.grow * Math.sqrt(u)).fill({ color: DUST, alpha: 0.5 * (1 - u) * Math.min(1, u * 6) });
      }
      // ── WHAT IS LEFT OF EACH: a heap where it stood, till it is cleared ────────────────────
      const clearing = (p - RAZE.down) / (RAZE.cleared - RAZE.down);
      let target: RazeView["target"] = null, phase: RazeView["phase"] = p >= RAZE.cleared ? "done" : p >= RAZE.down ? "clear" : "knock";
      J.tiles.forEach((T, t) => {
        const i = rank.get(t) ?? 0, f = Math.max(0, Math.min(1, goneOf(i)));
        // (Cleared nearest the digger first, a heap at a time.)
        const left = 1 - ease(clearing * N - i), size = ease(f * 1.4) * left;
        const q = Math.round(size * 40);
        if (phase === "knock" && (heldOf(i) > 0 || (goneOf(i) > 0 && goneOf(i) < 1))) target ??= { x: T.x, y: T.y };
        if (phase === "clear" && left > 0.02 && left < 1 - 1e-3) target = { x: T.x, y: T.y };
        if (phase === "clear" && !target && left >= 1 - 1e-3 && i === Math.min(N - 1, Math.floor(clearing * N))) target = { x: T.x, y: T.y };
        if (q === T.was) return;
        T.was = q;
        const G = T.heap;
        G.clear();
        if (size <= 0.01) return;
        // A MOUND of broken masonry — higher the more of a building stood on it — its skyline jagged, lit from one side.
        const W = HW * scale * 0.86 * (0.55 + 0.45 * size), Hh = Math.min(26 * scale, Math.max(7 * scale, T.top * 0.16)) * size, n = 9;
        const sky: number[] = [];
        for (let k = 0; k <= n; k++) {
          const u = k / n, arch = Math.sin(Math.PI * u) ** 0.7, jag = 0.72 + 0.5 * hash(T.seed * 91 + k * 7.7);
          sky.push(T.bx - W + 2 * W * u, T.by - Hh * arch * jag - (u > 0 && u < 1 ? 1.5 * scale : 0));
        }
        G.poly([T.bx - W, T.by + HH * scale * 0.18, ...sky, T.bx + W, T.by + HH * scale * 0.18, T.bx, T.by + HH * scale * 0.42 * size]).fill({ color: HEAP[0] });
        // Its lit face: the left half of it, lighter.
        G.poly([T.bx - W, T.by + HH * scale * 0.18, ...sky.slice(0, (Math.floor(n / 2) + 1) * 2), T.bx, T.by + HH * scale * 0.42 * size]).fill({ color: HEAP[1], alpha: 0.75 });
        // Lumps of it, and its steel sticking out.
        for (let k = 0; k < 11; k++) {
          const u = hash(T.seed * 31 + k * 3.3), v = hash(T.seed * 57 + k * 9.1), arch = Math.sin(Math.PI * (0.12 + 0.76 * u));
          const x = T.bx - W * 0.86 + 1.72 * W * u, y = T.by - Hh * arch * (0.15 + 0.6 * v) + HH * scale * 0.1, s = (1.6 + 2.8 * v) * scale * (0.6 + 0.4 * size);
          G.poly([x - s, y, x - s * 0.3, y - s * 0.9, x + s * 0.8, y - s * 0.5, x + s, y + s * 0.3, x - s * 0.2, y + s * 0.6]).fill({ color: k % 4 === 0 ? BITS[3 + (k % 2)] : k % 3 === 0 ? HEAP[2] : BITS[k % 3] });
        }
        for (let k = 0; k < 3; k++) {
          const u = 0.2 + 0.6 * hash(T.seed * 13 + k * 4.1), lean = (hash(T.seed * 17 + k) - 0.5) * 14 * scale, x = T.bx - W + 2 * W * u, y = T.by - Hh * Math.sin(Math.PI * u) * 0.7;
          G.moveTo(x, y).lineTo(x + lean, y - (6 + 7 * hash(T.seed * 23 + k)) * scale * size).stroke({ color: STEEL, width: Math.max(1, 1.1 * scale) });
        }
      });
      return { target, phase, loaded: Math.max(0, Math.min(1, clearing)) };

      function fallen(f: number) { return f * f * (0.6 + 0.4 * f); }
    },
    keep(live) {
      for (const [id, job] of jobs) if (!live.has(id)) { end(job); jobs.delete(id); }
    },
    destroy() {
      for (const job of jobs.values()) end(job);
      jobs.clear();
    },
  };
}
