/**
 * World v2 — A BUILDING COMES DOWN, drawn. How it falls is worked out in
 * three dimensions (@see collapse-sim): its masses broken into wall panels
 * and floor plates, each let go as its plan or its lost footing says, each
 * falling, breaking, lying. This draws that:
 *
 *  - THE BUILDING'S OWN PICTURE is taken once, as it stands — whatever draws
 *    it: baked tiles, a pen's drawing, a house's stacked floors, a port — and
 *    WRAPPED ONTO THE PIECES from where the camera is, so that with nothing
 *    moved yet the pieces ARE the picture, to the pixel; a piece that falls
 *    takes its part of the picture with it, and the faces nobody could see —
 *    the inside of a wall, a broken edge, a floor — are bare material.
 *  - What of the picture is no mass of the building (its yard, its lawn, a
 *    lorry parked on it) stays where it is, as it was.
 *  - The pieces are drawn far to near, each with the band of the tile it is
 *    over, so a digger at the plot's edge is in front of what is behind it.
 *  - Dust where things land and where charges go, glass in a shower.
 *
 * The building's own display objects are only hidden, never moved or taken
 * out of their layers; a job called off shows them again.
 */
import { Container, Graphics, Mesh, MeshGeometry, Rectangle, Sprite, type Renderer, type Texture } from "pixi.js";

import { HALF_STEPS_PER_M, TILES_PER_M } from "../agents/cars/models";
import { idx, type Grid } from "../grid";
import { HEIGHT_UNIT, HH, HW, bandOf } from "../iso";
import { PIECE_TILE, type RazeMass } from "../structures/render";
import type { BandLayer } from "./bands";
import { axisOf, createCollapse, type Chunk, type Collapse, type MassIn, type Skin } from "./collapse-sim";

/** Of a demolition's time: when the first of it goes, when the last is down, and when the clearing — which follows — is done. */
export const RAZE = { first: 0.1, down: 0.72, cleared: 0.97 } as const;
/** Half steps a tile of height. */
const ZT = HALF_STEPS_PER_M / TILES_PER_M;
/** The way to the camera, in tiles: what lies along it is one point of the picture. */
const VIEW: [number, number, number] = [1, 1, (2 * HH) / (ZT * HEIGHT_UNIT)];
const DUST = 0xcfc5b3, GLASS = 0xbfe0ee;
/** Bare material, by what a piece is of; and how each of its faces is lit: up, toward +u, toward +v, away. */
const BARE: Record<Skin, number> = { masonry: 0x8d6b57, concrete: 0x9b9891, glass: 0x9fc3d6, sheet: 0x7d858c };
const SHADES = [1, 0.8, 0.92, 0.62], SKINS: Skin[] = ["masonry", "concrete", "glass", "sheet"], FOUNDATION = 0x77736c;
const QUADS = 3600, SWATCH = 6, CELLPX = 9;

type Puff = { x: number; y: number; vx: number; vy: number; r: number; grow: number; age: number; life: number; colour: number };
type Bit = { x: number; y: number; vx: number; vy: number; ground: number; age: number; size: number };
type BandMesh = { mesh: Mesh; pos: Float32Array; uv: Float32Array; list: number[] };
type Job = {
  kept: Map<Container, number>; sim: Collapse | null; t: number; tex: Texture | null;
  frame: { x: number; y: number; w: number; h: number }; flat: Map<number, [number, number]>;
  bandsOf: Map<number, BandMesh>; back: Mesh | null; air: Graphics; puffs: Puff[]; bits: Bit[]; keys: Float32Array;
  ox: number; oy: number; h0: number; lo: number; hi: number;
};

export type RazeView = {
  /** Which tile the digger is at — where a piece last went, or was last taken from the heap — and what it is doing; and how much of the rubble is on the lorry. */
  target: { x: number; y: number } | null; phase: "knock" | "clear" | "done"; loaded: number;
};
export type RazeFx = {
  /**
   * A frame of a building coming down: `p` of its time gone, `dt` on from the last; its pieces as they are drawn,
   * and its masses where its renderer knows them (else worked out from its picture, a tile at a time); the plot;
   * where the digger stands. Says what the digger is at.
   */
  sync(id: number, g: Grid, plot: { x: number; y: number; w: number; h: number }, nodes: readonly Container[], masses: readonly RazeMass[] | null, p: number, from: { x: number; y: number }, scale: number, dt: number, seconds: number): RazeView;
  /** Jobs not in `live` are over: their pieces and dust gone — and, the building still standing (called off), shown again. */
  keep(live: ReadonlySet<number>): void;
  destroy(): void;
};

const hash = (n: number) => { const s = Math.sin(n * 12.9898) * 43758.5453; return s - Math.floor(s); };
const shade = (c: number, k: number) => (Math.min(255, ((c >> 16) & 255) * k) << 16) | (Math.min(255, ((c >> 8) & 255) * k) << 8) | Math.min(255, (c & 255) * k);

/** A copy of a display object as it stands, for a picture of it: its texture or its drawing shared, not made again. */
function copyOf(n: Container): Container | null {
  if (n.destroyed || !n.visible) return null;
  n.updateLocalTransform();
  let c: Container;
  if (n instanceof Sprite) { const sp = new Sprite(n.texture); sp.anchor.copyFrom(n.anchor); sp.tint = n.tint; c = sp; }
  else if (n instanceof Graphics) c = new Graphics(n.context);
  else { c = new Container(); for (const ch of n.children) { const k = copyOf(ch as Container); if (k) c.addChild(k); } }
  c.setFromMatrix(n.localTransform);
  c.alpha = n.alpha;
  return c;
}

/** Whether a line through `p` along the way to the camera passes through a box: whether that box is in front of, or behind, that point of the picture. Only ahead of it, with `ahead`. */
function through(p: readonly number[], m: MassIn, ahead = false): boolean {
  let t0 = ahead ? 0.02 : -Infinity, t1 = Infinity;
  const lo = [m.u0, m.v0, m.w0], hi = [m.u1, m.v1, m.w1];
  for (let a = 0; a < 3; a++) {
    const a0 = (lo[a] - p[a]) / VIEW[a], a1 = (hi[a] - p[a]) / VIEW[a];
    t0 = Math.max(t0, Math.min(a0, a1)); t1 = Math.min(t1, Math.max(a0, a1));
  }
  return t1 - t0 > 1e-4;
}

export function createRazeFx(bands: BandLayer, renderer: Renderer | null): RazeFx {
  const jobs = new Map<number, Job>();
  /** Pictures done with, kept a few frames: a batch may still hold one. */
  const trash: { tex: Texture; left: number }[] = [];
  const drop = (c: Container) => { c.parent?.removeChild(c); c.destroy(); };
  const end = (job: Job) => {
    for (const [n, a] of job.kept) if (!n.destroyed) n.alpha = a;
    for (const b of job.bandsOf.values()) drop(b.mesh);
    if (job.back) drop(job.back);
    drop(job.air);
    if (job.tex) trash.push({ tex: job.tex, left: 4 });
  };
  const layer = (band: number) => bands.structureOf[Math.max(0, Math.min(bands.structureOf.length - 1, band))];

  return {
    sync(id, g, plot, nodes, told, p, from, scale, dt, seconds) {
      let J = jobs.get(id);
      if (!J) {
        const air = new Graphics();
        air.eventMode = "none"; air.context.batchMode = "batch"; air.zIndex = 3;
        const hi = bandOf(plot.x + plot.w - 1, plot.y + plot.h - 1), lo = bandOf(plot.x, plot.y);
        bands.dynamicOf[Math.max(0, Math.min(bands.dynamicOf.length - 1, hi))]?.addChild(air);
        J = { kept: new Map(), sim: null, t: 0, tex: null, frame: { x: 0, y: 0, w: 1, h: 1 }, flat: new Map(), bandsOf: new Map(), back: null, air, puffs: [], bits: [], keys: new Float32Array(0), ox: plot.x - 0.5, oy: plot.y - 0.5, h0: g.height[idx(g, plot.x, plot.y)], lo, hi };
        jobs.set(id, J);
      }
      const job = J;
      /** A place of the plot — tiles from its back corner, tiles up — on the map's own picture. */
      const px = (u: number, v: number, w: number): [number, number] => [((job.ox + u) - (job.oy + v)) * HW * scale, ((job.ox + u) + (job.oy + v)) * HH * scale - (job.h0 + w * ZT) * HEIGHT_UNIT * scale];
      const fu = from.x - job.ox, fv = from.y - job.oy;

      // ── ITS START: its picture taken, its masses broken, the picture wrapped onto the pieces ──
      if (!job.sim && p >= RAZE.first && renderer) {
        const live = nodes.filter((n) => !n.destroyed);
        // ITS MASSES: its renderer's, or — a house, a port — a box a tile, as high as that tile's part of the picture.
        let masses: MassIn[] = (told ?? []).map((m) => ({ u0: m.u0, v0: m.v0, u1: m.u1, v1: m.v1, w0: m.z0 / ZT, w1: m.z1 / ZT, storey: m.storey / ZT, skin: m.skin }));
        if (!masses.length) {
          const tops = new Map<number, number>();
          for (const n of live) {
            n.updateLocalTransform();
            const m0 = n.localTransform, b = n.getLocalBounds();
            let lo = Infinity, hi = -Infinity, cx = 0;
            for (const x of [b.minX, b.maxX]) for (const y of [b.minY, b.maxY]) { const py = m0.b * x + m0.d * y + m0.ty; lo = Math.min(lo, py); hi = Math.max(hi, py); cx += (m0.a * x + m0.c * y + m0.tx) / 4; }
            if (!Number.isFinite(lo)) continue;
            const at = PIECE_TILE.get(n);
            let c = at ? at.x - plot.x : -1, r = at ? at.y - plot.y : -1;
            if (c < 0 || r < 0 || c >= plot.w || r >= plot.h) {
              // (Not told which tile: the one under the foot of its picture.)
              let best = Infinity;
              for (let rr = 0; rr < plot.h; rr++) for (let cc = 0; cc < plot.w; cc++) { const [bx, by] = px(cc + 0.5, rr + 0.5, 0), d = Math.hypot(bx - cx, (by - hi) * 2); if (d < best) { best = d; c = cc; r = rr; } }
            }
            const [, by] = px(c + 0.5, r + 0.5, 0), up = (by + HH * scale - lo) / (HEIGHT_UNIT * scale * ZT);
            tops.set(r * plot.w + c, Math.max(tops.get(r * plot.w + c) ?? 0, up));
          }
          for (const [k, up] of tops) if (up > 0.28) { const c = k % plot.w, r = Math.floor(k / plot.w); masses.push({ u0: c + 0.05, v0: r + 0.05, u1: c + 0.95, v1: r + 0.95, w0: 0, w1: Math.min(9, up * 0.86), storey: 0.63, skin: "masonry", hollow: true }); }
        }
        masses = masses.filter((m) => m.w1 - m.w0 > 0.06);
        // ITS PICTURE, once: copies of its pieces, drawn into a texture with a strip of bare colours under it.
        const stage = new Container();
        for (const n of live) { const c = copyOf(n); if (c) stage.addChild(c); }
        const b = stage.getLocalBounds();
        const fx0 = Math.floor(b.minX) - 1, fy0 = Math.floor(b.minY) - 1, fw = Math.ceil(b.maxX - b.minX) + 2, fh = Math.ceil(b.maxY - b.minY) + 2;
        if (!Number.isFinite(fw) || fw < 2 || fh < 2) { stage.destroy({ children: true, context: false, texture: false }); job.sim = createCollapse([], plot, { u: fu, v: fv }, 1); }
        else {
          const sw = new Graphics(), cols: number[] = [FOUNDATION];
          for (const s of SKINS) for (const k of SHADES) cols.push(shade(BARE[s], k));
          cols.forEach((c, k) => { sw.rect(fx0 + 1 + k * (SWATCH + 2), fy0 + fh + 2, SWATCH, SWATCH).fill({ color: c }); });
          stage.addChild(sw);
          const frame = new Rectangle(fx0, fy0, Math.max(fw, cols.length * (SWATCH + 2) + 2), fh + SWATCH + 4);
          const res = Math.max(0.5, Math.min(2, 2048 / Math.max(frame.width, frame.height)));
          job.tex = renderer.generateTexture({ target: stage, frame, resolution: res, antialias: false });
          stage.destroy({ children: true, context: false, texture: false });
          job.frame = { x: frame.x, y: frame.y, w: frame.width, h: frame.height };
          cols.forEach((c, k) => job.flat.set(c, [(1 + k * (SWATCH + 2) + SWATCH / 2) / frame.width, (fh + 2 + SWATCH / 2) / frame.height]));
          const uvOf = (x: number, y: number): [number, number] => [(x - job.frame.x) / job.frame.w, (y - job.frame.y) / job.frame.h];
          const K = Math.max(2.5, (RAZE.down - RAZE.first) * seconds - 2.2);
          job.sim = createCollapse(masses, plot, { u: fu, v: fv }, K, id);
          // EACH OUTSIDE FACE takes the part of the picture it is — unless another mass stood in front of it: bare.
          for (const c of job.sim.chunks) {
            for (let f = 0; f < 6; f++) {
              if (!(c.outer & (1 << f))) continue;
              const a = f >> 1, sg = f & 1 ? -1 : 1, bb = (a + 1) % 3, cc = (a + 2) % 3;
              const mid = [c.c[0], c.c[1], c.c[2]]; mid[a] += sg * (c.e[a] + 0.012);
              if (masses.some((m) => through(mid, m, true))) continue;
              const uv = new Float32Array(8);
              [[-1, -1], [1, -1], [1, 1], [-1, 1]].forEach(([sb, sc], k) => {
                const q = [c.c[0], c.c[1], c.c[2]]; q[a] += sg * c.e[a]; q[bb] += sb * c.e[bb]; q[cc] += sc * c.e[cc];
                const [x, y] = px(q[0], q[1], q[2]), [tu, tv] = uvOf(x, y);
                uv[k * 2] = tu; uv[k * 2 + 1] = tv;
              });
              c.tex[f] = uv;
            }
          }
          // WHAT IS NOT A MASS OF IT STAYS AS IT WAS: the picture, cut into squares, less those every part of which a
          // mass stood in — over a floor of bare foundation under each mass.
          const pos: number[] = [], uvs: number[] = [];
          const quad = (pts: [number, number][], uv?: [number, number]) => { for (const [x, y] of pts) { pos.push(x, y); const t = uv ?? uvOf(x, y); uvs.push(t[0], t[1]); } };
          const found = job.flat.get(FOUNDATION)!;
          for (const m of masses) if (m.w0 < 0.05 && !m.hollow) quad([px(m.u0, m.v0, 0), px(m.u1, m.v0, 0), px(m.u1, m.v1, 0), px(m.u0, m.v1, 0)], found);
          /** Where on the plot's ground a point of the picture is. */
          const groundOf = (x: number, y: number) => { const a = x / (HW * scale), s = (y + job.h0 * HEIGHT_UNIT * scale) / (HH * scale); return [(a + s) / 2 - job.ox, (s - a) / 2 - job.oy, 0]; };
          const inMass = (x: number, y: number) => { const q = groundOf(x, y); return masses.some((m) => through(q, m)); };
          const cell = CELLPX * scale;
          for (let y = fy0; y < fy0 + fh; y += cell) for (let x = fx0; x < fx0 + fw; x += cell) {
            const x1 = Math.min(fx0 + fw, x + cell), y1 = Math.min(fy0 + fh, y + cell);
            if (inMass(x, y) && inMass(x1, y) && inMass(x1, y1) && inMass(x, y1) && inMass((x + x1) / 2, (y + y1) / 2)) continue;
            quad([[x, y], [x1, y], [x1, y1], [x, y1]]);
          }
          const nq = pos.length / 8, ind = new Uint32Array(nq * 6);
          for (let q = 0; q < nq; q++) ind.set([q * 4, q * 4 + 1, q * 4 + 2, q * 4, q * 4 + 2, q * 4 + 3], q * 6);
          job.back = new Mesh({ geometry: new MeshGeometry({ positions: new Float32Array(pos), uvs: new Float32Array(uvs), indices: ind }), texture: job.tex });
          job.back.eventMode = "none";
          layer(job.lo)?.addChild(job.back);
          // A LAYER A BAND of the plot, for its pieces: each drawn with the tile it is over.
          const ind2 = new Uint32Array(QUADS * 6);
          for (let q = 0; q < QUADS; q++) ind2.set([q * 4, q * 4 + 1, q * 4 + 2, q * 4, q * 4 + 2, q * 4 + 3], q * 6);
          for (let band = job.lo; band <= job.hi; band++) {
            const bp = new Float32Array(QUADS * 8), bu = new Float32Array(QUADS * 8);
            const mesh = new Mesh({ geometry: new MeshGeometry({ positions: bp, uvs: bu, indices: ind2.slice() }), texture: job.tex });
            mesh.eventMode = "none";
            layer(band)?.addChild(mesh);
            job.bandsOf.set(band, { mesh, pos: bp, uv: bu, list: [] });
          }
        }
      }
      if (!job.sim) return { target: null, phase: "knock", loaded: 0 };
      // (Its own pieces are not shown while it comes down — nor any made since: the picture of it is the pieces now.)
      for (const n of nodes) {
        if (n.destroyed) continue;
        if (!job.kept.has(n)) job.kept.set(n, n.alpha);
        if (n.alpha !== 0) n.alpha = 0;
      }

      // ── A STEP OF ITS FALL, and what that throws up ───────────────────────────────────────
      const sim = job.sim, phase: RazeView["phase"] = p >= RAZE.cleared ? "done" : p >= RAZE.down ? "clear" : "knock";
      const clearing = Math.max(0, Math.min(1, (p - RAZE.down) / (RAZE.cleared - RAZE.down)));
      if (dt > 0) {
        job.t += dt;
        if (p >= RAZE.down - 2.6 / Math.max(1, seconds)) sim.finish(job.t);
        for (const h of sim.step(Math.min(dt, 0.05), job.t)) {
          const [x, y] = px(h.at[0], h.at[1], h.at[2]), big = Math.min(1.6, h.size);
          if (h.kind === "shatter") {
            for (let k = 0; k < 5 && job.bits.length < 260; k++) { const a = hash(job.bits.length * 3.3 + job.t), b = hash(job.bits.length * 7.1 + job.t * 3); job.bits.push({ x: x + (a - 0.5) * 16 * scale, y: y + (b - 0.5) * 20 * scale, vx: (a - 0.5) * 70 * scale, vy: -(10 + 50 * b) * scale, ground: px(h.at[0], h.at[1], 0)[1] + (a - 0.5) * 10 * scale, age: 0, size: (1 + 1.6 * b) * scale }); }
          } else if (job.puffs.length < 150) {
            const cnt = h.kind === "dust" ? 3 : 1 + (big > 0.5 ? 1 : 0);
            for (let k = 0; k < cnt; k++) { const a = hash(job.puffs.length * 3.1 + job.t * 5), b = hash(job.puffs.length * 5.3 + job.t); job.puffs.push({ x: x + (a - 0.5) * 22 * scale, y: y - b * 6 * scale, vx: (a - 0.5) * 34 * scale, vy: -(6 + 18 * b) * scale, r: (4 + 8 * big) * scale, grow: (10 + 16 * big) * scale, age: 0, life: 1.4 + 1.8 * b, colour: DUST }); }
          }
        }
        if (phase !== "knock") sim.clear(clearing);
      }

      // ── ITS PIECES, far to near, each with the band of the tile it is over ───────────────
      for (const b of job.bandsOf.values()) b.list.length = 0;
      const chunks = sim.chunks;
      if (job.keys.length < chunks.length) job.keys = new Float32Array(chunks.length + 512);
      for (let i = 0; i < chunks.length; i++) {
        const c = chunks[i];
        if (c.state === 3) continue;
        const band = Math.max(job.lo, Math.min(job.hi, Math.floor(plot.x + c.c[0]) + Math.floor(plot.y + c.c[1])));
        job.keys[i] = c.c[0] + c.c[1] + c.c[2] * VIEW[2];
        job.bandsOf.get(band)?.list.push(i);
      }
      for (const B of job.bandsOf.values()) {
        B.list.sort((a, b) => job.keys[a] - job.keys[b]);
        let q = 0;
        for (const i of B.list) {
          if (q >= QUADS - 3) break;
          q = writeChunk(chunks[i], B, q, px, job.flat);
        }
        // (What is left of the layer is nothing: every corner of it the one point.)
        B.pos.fill(0, q * 8);
        B.mesh.geometry.getBuffer("aPosition").update();
        B.mesh.geometry.getBuffer("aUV").update();
      }

      // ── DUST, AND GLASS ────────────────────────────────────────────────────────────────
      const air = job.air;
      air.clear();
      job.bits = job.bits.filter((b) => b.age < 1.6);
      for (const b of job.bits) {
        b.age += dt;
        if (b.y < b.ground || b.vy < 0) { b.vy += 520 * scale * dt; b.x += b.vx * dt; b.y += b.vy * dt; }
        air.rect(b.x - b.size / 2, b.y - b.size / 2, b.size, b.size).fill({ color: GLASS, alpha: 0.9 * (1 - b.age / 1.6) });
      }
      job.puffs = job.puffs.filter((q) => q.age < q.life);
      for (const q of job.puffs) {
        q.age += dt; q.x += q.vx * dt; q.y += q.vy * dt; q.vx *= 1 - 0.8 * dt; q.vy *= 1 - 0.9 * dt;
        const u = q.age / q.life;
        air.circle(q.x, q.y, q.r + q.grow * Math.sqrt(u)).fill({ color: q.colour, alpha: 0.46 * (1 - u) * Math.min(1, u * 6) });
      }
      return { target: { x: Math.round(job.ox + sim.at[0]), y: Math.round(job.oy + sim.at[1]) }, phase, loaded: clearing };
    },
    keep(live) {
      for (let k = trash.length - 1; k >= 0; k--) if (--trash[k].left <= 0) { trash[k].tex.destroy(true); trash.splice(k, 1); }
      for (const [id, job] of jobs) if (!live.has(id)) { end(job); jobs.delete(id); }
    },
    destroy() {
      for (const job of jobs.values()) end(job);
      jobs.clear();
    },
  };
}

/** The corners of a face, by its own two axes after its own: (−,−), (+,−), (+,+), (−,+). */
const CORNERS = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
/**
 * A piece into a band's layer from quad `q` on: each of its faces that is toward the camera, turned as it is — its
 * part of the picture on it, or bare, lit by which way it faced as built. Says the next quad.
 */
function writeChunk(c: Chunk, B: BandMesh, q: number, px: (u: number, v: number, w: number) => [number, number], flat: Map<number, [number, number]>): number {
  const ax = [axisOf(c.q, 0), axisOf(c.q, 1), axisOf(c.q, 2)];
  for (let f = 0; f < 6; f++) {
    const a = f >> 1, sg = f & 1 ? -1 : 1, n = ax[a];
    if ((n[0] * VIEW[0] + n[1] * VIEW[1] + n[2] * VIEW[2]) * sg <= 1e-4) continue;
    // (Of a box put round a picture, only the picture: a piece of it shows the same from behind, and what carried none of it is not there.)
    const b = (a + 1) % 3, cc = (a + 2) % 3, tex = c.tex[f] ?? (c.hollow && c.state !== 0 ? c.tex[f ^ 1] : null), o = q * 8;
    if (!tex && c.hollow) continue;
    const bare = tex ? null : flat.get(shade(BARE[c.skin], SHADES[f === 4 ? 0 : f === 0 ? 1 : f === 2 ? 2 : 3]));
    for (let k = 0; k < 4; k++) {
      const sb = CORNERS[k][0] * c.e[b], sc = CORNERS[k][1] * c.e[cc], sa = sg * c.e[a];
      const [x, y] = px(c.c[0] + ax[a][0] * sa + ax[b][0] * sb + ax[cc][0] * sc, c.c[1] + ax[a][1] * sa + ax[b][1] * sb + ax[cc][1] * sc, c.c[2] + ax[a][2] * sa + ax[b][2] * sb + ax[cc][2] * sc);
      B.pos[o + k * 2] = x; B.pos[o + k * 2 + 1] = y;
      B.uv[o + k * 2] = tex ? tex[k * 2] : bare ? bare[0] : 0; B.uv[o + k * 2 + 1] = tex ? tex[k * 2 + 1] : bare ? bare[1] : 0;
    }
    q++;
  }
  return q;
}
