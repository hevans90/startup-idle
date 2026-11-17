/**
 * World v2 — A LINE BEING LAID, on the map: a main, a sewer, a channel, as
 * far as each of its trades has got. @see lines/jobs
 *
 *  - A SEWER: a trench cut by a digger that backs along the line ahead of it,
 *    its spoil in a ridge beside; the pipe down in it; the ground made good
 *    behind, a scar of turned earth till the job is done.
 *  - A MAIN: the pipe itself, real, a length at a time (the mains' own layer
 *    draws it); here the work — its line pegged out ahead, a digger lowering
 *    the next length in slings, a lorry with the rest, welders at the joint.
 *  - A CHANNEL: a dredger working along it, the water muddied where it is.
 *  - A BUILDING BEING PULLED DOWN: taped off, a digger at its front, dust over it, rubble at its foot.
 *
 * What is on the ground is drawn again only as a trade moves on; the machines
 * are units of the vehicles' sheet, moved by transform. @see plant-kit
 */
import { Container, Graphics, Sprite } from "pixi.js";

import { bakedCars, loadCarSprites, type CarSprites } from "../agents/cars/car-sheet";
import { bakedPeople, peopleLoaded, peopleSprites, posePerson } from "../agents/people/people-sheet";
import { idx, type Grid } from "../grid";
import { HEIGHT_UNIT, HH, HW, bandOf } from "../iso";
import { LINE_TRADES, alongLine, lineFront, type LineJob } from "../lines/jobs";
import type { BandLayer } from "./bands";
import { bakedProps, propSprite, propSprites, propsLoaded } from "../props/props-sheet";
import { BLUE, DIG, DIG_ALL, M, T, YELLOW, makeUnit, poseUnit, type Unit } from "./plant-kit";
import { walkRound, type Walker } from "./road-plant";

/** How high a main's middle lies off the ground, half steps; and how thick it is, px at the map's own scale. @see mains-layer LIFT, TUBE_R */
const LIFT = 1.1, TUBE_PX = 5.6;
const SKIN = 0xd9a47a, LEGS = 0x3a4a63;

const TRENCH = 0x35271b, TRENCH_SIDE = 0x4a3625, SPOIL = 0x8b6a47, SPOIL_TOP = 0xa98660, SCAR = 0x7a5a3c;
const SEWER_PIPE = 0x9aa0a6, SEWER_LIT = 0xc6cbd0;
const MUD = 0x7a6a4a, HULL = 0x7c2f24, HULL_SIDE = 0x5d231b, DECK = 0x8f8f86, CABIN = 0xe6e2d6, JIB = 0xe9a71b;
/** How finely the ground is redrawn as a trade moves: steps a tile. */
const FINE = 10;

export type LineWorks = { sync(g: Grid, rev: number, scale: number, t: number, depth?: (x: number, y: number) => number): void; destroy(): void };

export function createLineWorks(bands: BandLayer): LineWorks {
  let ground: Graphics[] = [], key = "", cars: CarSprites | null = null, asked = false, last = -1;
  const of = new Map<number, Graphics>(), units = new Map<string, Unit>(), clocks = new Map<number, number>();
  const barges = new Map<number, { c: Container; g: Graphics; band: number }>();
  /** What is drawn round a building being pulled down: its fence, its dust, its rubble. */
  const razing = new Map<number, { g: Graphics; band: number }>();
  const drop = (c: Container) => { c.parent?.removeChild(c); c.destroy({ children: true }); };
  /** A main being laid: what is drawn over it — the length in the slings, the sparks — its two welders, and the pegs set out ahead of it. */
  type Laying = { g: Graphics; band: number; hands: (Walker & { c: Container; parts: Sprite[]; key: string; band: number })[]; pegs: Container[]; pegged: string };
  const mains = new Map<number, Laying>();
  const dropMain = (m: Laying) => { drop(m.g); for (const h of m.hands) drop(h.c); for (const q of m.pegs) drop(q); };
  /**
   * A MAIN GOING IN. The pipe itself is real — on the map a length at a time, drawn by the mains' own layer — so what
   * is drawn here is the WORK: its line pegged out ahead; a digger stood beside it lowering the next length in slings
   * onto its saddles; a lorry behind with the lengths still to go; two welders at the newest joint, sparks off it.
   */
  const layMain = (
    g: Grid, j: LineJob, w: number, dt: number, scale: number, P: ReturnType<typeof peopleLoaded>,
    place: (name: string, p: number, looks: { look: string; tint: number; heading?: number }[], turn?: number, across?: number) => Unit | null,
    seenM: Set<number>,
  ) => {
    const n = j.cells.length, f1 = lineFront(j, 1), k = Math.min(n - 1, Math.floor(f1)), fr = f1 - k, done = f1 >= n;
    let m = mains.get(j.id);
    if (!m) { const gr = new Graphics(); gr.eventMode = "none"; gr.context.batchMode = "batch"; m = { g: gr, band: -1, hands: [], pegs: [], pegged: "" }; mains.set(j.id, m); }
    seenM.add(j.id);
    // (The length going in runs from where the pipe is capped — the middle of the last cell laid — to the middle of the next.)
    const cell = j.cells[k], h = g.height[idx(g, cell.x, cell.y)], at = alongLine(j.cells, Math.max(0.5, k));
    // (Stood off the line by its boom's reach: the boom's tip is over the pipe.)
    const ch = Math.cos(at.heading), sh = Math.sin(at.heading), SIDE = 3.9 * T + 0.04;
    // ── ITS LINE, PEGGED OUT AHEAD of where the pipe has got to: a stake a tile, the builder's line between them ──
    const Pr = bakedProps() ? propsLoaded() : null;
    if (bakedProps() && !Pr) void propSprites();
    const pk = `${Pr ? 1 : 0}|${k}|${scale}|${done}`;
    if (pk !== m.pegged) {
      m.pegged = pk;
      for (const q of m.pegs) drop(q);
      m.pegs = [];
      if (Pr && !done) for (let c = k; c <= n; c++) {
        const a = alongLine(j.cells, Math.min(n, c)), cc = j.cells[Math.min(n - 1, c)], hh = g.height[idx(g, cc.x, cc.y)];
        const x = a.x + Math.sin(a.heading) * 0.34, y = a.y - Math.cos(a.heading) * 0.34, band = bandOf(Math.round(x), Math.round(y));
        const put = (id: string, turn: number, px: number, py: number) => { const sp = propSprite(Pr, id, turn, px, py, hh, scale), layer = bands.dynamicOf[band]; if (sp && layer) { sp.zIndex = px + py - band; layer.addChild(sp); m!.pegs.push(sp); } };
        put("stake", c & 3, x, y);
        if (c < n) { const b = alongLine(j.cells, c + 0.5), bx = b.x + Math.sin(b.heading) * 0.34, by = b.y - Math.cos(b.heading) * 0.34; for (const half of [-0.25, 0.25]) put("tape", Math.abs(Math.cos(b.heading)) > 0.5 ? 0 : 1, bx + Math.cos(b.heading) * half, by + Math.sin(b.heading) * half); }
      }
    }
    const G = m.g;
    G.clear();
    if (done) { for (const hd of m.hands) hd.c.visible = false; return; }
    const band = Math.max(0, Math.min(bands.dynamicOf.length - 1, bandOf(Math.round(at.x), Math.round(at.y))));
    if (band !== m.band || !G.parent) { G.zIndex = at.x + at.y - band + 0.6; bands.dynamicOf[band]?.addChild(G); m.band = band; }
    // ── THE DIGGER beside the line, its arm out over it, the next length hung from its bucket and coming down ──
    const dx = at.x - sh * SIDE, dy = at.y + ch * SIDE, toward = Math.atan2(at.y - dy, at.x - dx);
    place("layer", Math.max(0.5, k), [{ look: "exTracks", tint: YELLOW }, { look: "exDump", tint: YELLOW, heading: toward }], 0, SIDE);
    // (Down with a pause at the top and a gentle last of it: picked off the lorry, swung over, set.)
    const down = Math.max(0, Math.min(1, (fr - 0.15) / 0.7)), ease = down * down * (3 - 2 * down);
    // (Slung from the boom's tip, which is higher than the pipe lies: it comes down the last of the way onto its saddles.)
    const hook = pt(scale, dx + Math.cos(toward) * 3.9 * T, dy + Math.sin(toward) * 3.9 * T, h + 4.3 * M);
    const lift = LIFT + (1 - ease) * 0.62, r = Math.max(2, TUBE_PX * scale);
    /** A length of pipe from one point of the map to another, at a height: a lit round thing. */
    const tubeAt = (ax: number, ay: number, bx: number, by: number, z: number) => {
      const A = pt(scale, ax, ay, h + z), B = pt(scale, bx, by, h + z), ux = B[0] - A[0], uy = B[1] - A[1], len = Math.hypot(ux, uy) || 1, nx = -uy / len, ny = ux / len;
      const band2 = (o0: number, o1: number, colour: number) => G.poly([A[0] + nx * o0, A[1] + ny * o0, B[0] + nx * o0, B[1] + ny * o0, B[0] + nx * o1, B[1] + ny * o1, A[0] + nx * o1, A[1] + ny * o1]).fill({ color: colour });
      // (The normal is turned to whichever way is up the screen: the light is from above.)
      const s2 = ny < 0 ? 1 : -1;
      band2(-r, r, 0x74777a); band2(-r * 0.75 * s2, r * s2, 0xa6a9aa); band2(r * 0.25 * s2, r * 0.8 * s2, 0xd6d8d9);
      for (const E of [A, B]) G.ellipse(E[0], E[1], r * 0.55, r).fill({ color: 0x4d5053 });
      return [A, B] as const;
    };
    if (j.stalled <= 0 || ease > 0) {
      const [A, B] = tubeAt(at.x - ch * 0.48, at.y - sh * 0.48, at.x + ch * 0.48, at.y + sh * 0.48, lift);
      // The slings, from the bucket to a third of the way in from each end.
      for (const tq of [0.3, 0.7]) G.moveTo(hook[0], hook[1]).lineTo(A[0] + (B[0] - A[0]) * tq, A[1] + (B[1] - A[1]) * tq - r).stroke({ color: 0x2b2e33, width: Math.max(0.6, 0.5 * scale) });
    }
    // ── THE LORRY behind, on the same side, the lengths still to go lying on its bed ──
    const left = Math.max(0, Math.min(4, n - k - 1));
    const lorry = place("pipes", Math.max(0.5, k - 1.3), [{ look: "flatbed", tint: BLUE }], 0, SIDE + 0.22);
    if (lorry) for (let q = 0; q < left; q++) {
      // (Drawn in the lorry's own picture: along its bed, side by side and then on top.)
      const o = q < 3 ? (q - 1) * 0.055 : 0, zz = (q < 3 ? 1.35 : 1.75) * M;
      const a2 = alongLine(j.cells, Math.max(0.5, k - 1.3)), lh = a2.heading, lc = Math.cos(lh), ls = Math.sin(lh);
      const A = pt(scale, -lc * 0.22 - ls * o, -ls * 0.22 + lc * o, zz), B = pt(scale, lc * 0.12 - ls * o, ls * 0.12 + lc * o, zz);
      const ux = B[0] - A[0], uy = B[1] - A[1], len = Math.hypot(ux, uy) || 1, nx = (-uy / len) * r * 0.8, ny = (ux / len) * r * 0.8;
      lorry.over.poly([A[0] + nx, A[1] + ny, B[0] + nx, B[1] + ny, B[0] - nx, B[1] - ny, A[0] - nx, A[1] - ny]).fill({ color: q % 2 ? 0x9a9d9f : 0xb4b7b8 });
      lorry.over.ellipse(B[0], B[1], r * 0.45, r * 0.8).fill({ color: 0x4d5053 });
    }
    // ── TWO WELDERS at the newest joint, one each side of the pipe; they walk on to the next as it is made ──
    if (P && k >= 1) {
      [0.2, -0.2].forEach((ac, q) => {
        let hd = m!.hands[q];
        if (!hd) {
          const c = new Container(); c.eventMode = "none";
          const parts = [SKIN, LEGS, q ? 0xc8dc32 : 0xf47b20, 0xf5c224, 0xffffff].map((tint) => { const sp = new Sprite(); sp.tint = tint; c.addChild(sp); return sp; });
          hd = { c, parts, key: "", band: -1 };
          m!.hands[q] = hd;
        }
        hd.c.visible = true;
        const r2 = walkRound(hd, [{ al: 0, ac, pose: "work", dwell: 1e9, face: ac > 0 ? -Math.PI / 2 : Math.PI / 2 }], k - 0.5, j.stalled > 0 ? 0 : dt * 2.6);   // (brisk: a joint a tile on every few seconds, and they are to be at it)
        const a3 = alongLine(j.cells, Math.max(0.5, hd.p! + 0.5)), hx = a3.x - Math.sin(a3.heading) * hd.ac!, hy = a3.y + Math.cos(a3.heading) * hd.ac!;
        const cc = j.cells[Math.max(0, Math.min(n - 1, Math.floor(hd.p!)))];
        hd.key = posePerson(hd.parts, P, "builder", r2.pose, a3.heading + r2.face, r2.pose === "walk" ? w * 7.5 + q : w * 5 + q * 1.7, scale, 0.95, hd.key);
        const [sx, sy] = pt(scale, hx, hy, g.height[idx(g, cc.x, cc.y)]);
        for (const sp of hd.parts) sp.position.set(sx, sy);
        hd.band = into(hd.c, hd.band, hx, hy, [{ u: 0.05, v: 0.05 }]);
      });
      // SPARKS off the joint while they are at it: a white heart, orange about it, a few thrown clear.
      if (j.stalled <= 0 && m.hands.every((hd) => hd.there)) {
        const jt = alongLine(j.cells, Math.max(0.5, k)), [jx, jy] = pt(scale, jt.x, jt.y, h + LIFT);
        const fl = 0.5 + 0.5 * Math.sin(w * 47) * Math.sin(w * 31);
        G.circle(jx, jy, (2.2 + fl * 1.6) * scale).fill({ color: 0xffa62b, alpha: 0.55 + 0.4 * fl });
        G.circle(jx, jy, (1 + fl) * scale).fill({ color: 0xffffff });
        for (let q = 0; q < 5; q++) { const ph = (w * 3.1 + q * 0.37) % 1, a = q * 1.9 + Math.floor(w * 3.1 + q * 0.37) * 2.4; G.circle(jx + Math.cos(a) * ph * 9 * scale, jy - ph * 4 * scale + ph * ph * 10 * scale + Math.sin(a) * ph * 3 * scale, 0.7 * scale).fill({ color: 0xffd27a, alpha: 1 - ph }); }
      }
    }
  };
  const clear = () => { for (const q of ground) drop(q); ground = []; of.clear(); };
  const pt = (scale: number, u: number, v: number, h: number): [number, number] => [(u - v) * HW * scale, (u + v) * HH * scale - h * HEIGHT_UNIT * scale];
  const into = (c: Container, was: number, x: number, y: number, base: readonly { u: number; v: number }[]): number => {
    let band = -Infinity;
    for (const p of base) band = Math.max(band, bandOf(Math.round(x + p.u), Math.round(y + p.v)));
    band = Math.max(0, Math.min(bands.dynamicOf.length - 1, band));
    const z = x + y - band;
    if (band !== was || !c.parent) { c.zIndex = z; bands.dynamicOf[band]?.addChild(c); }
    else if (Math.abs(c.zIndex - z) > 0.04) c.zIndex = z;
    return band;
  };
  return {
    sync(g, rev, scale, t, depth) {
      const dt = last < 0 ? 0 : Math.min(0.1, Math.max(0, t - last));
      last = t;
      const jobs = g.lineJobs;
      const k = `${rev}|${scale}|${jobs.map((j) => [0, 1, 2].map((q) => Math.floor(lineFront(j, q) * FINE)).join(".")).join("|")}`;
      if (k !== key) {
        key = k;
        clear();
        /** The drawing of a band's share of the ground, made when first drawn on. */
        const gfx = (x: number, y: number): Graphics | null => {
          const band = bandOf(Math.round(x), Math.round(y)), layer = bands.pavedOf[band];
          if (!layer) return null;
          let q = of.get(band);
          if (!q) { q = new Graphics(); q.eventMode = "none"; q.context.batchMode = "batch"; layer.addChild(q); of.set(band, q); ground.push(q); }
          return q;
        };
        for (const j of jobs) {
          if (j.kind === "dredge") continue;
          const f = Array.from({ length: LINE_TRADES }, (_, q) => lineFront(j, q)), n = j.cells.length;
          /** A strip along the line from `a` to `b` tiles, `w` wide and `off` to its side, in short lengths each drawn with the tile it is on. */
          const strip = (a: number, b: number, w: number, off: number, colour: number, alpha = 1, up = 0) => {
            if (b - a < 0.02) return;
            const N = Math.max(1, Math.ceil((b - a) * 4));
            for (let q = 0; q < N; q++) {
              const p0 = alongLine(j.cells, a + ((b - a) * q) / N), p1 = alongLine(j.cells, a + ((b - a) * (q + 1)) / N);
              const c = j.cells[Math.max(0, Math.min(n - 1, Math.floor(a + ((b - a) * (q + 0.5)) / N)))], h = g.height[idx(g, c.x, c.y)] + up;
              const G = gfx((p0.x + p1.x) / 2, (p0.y + p1.y) / 2);
              if (!G) continue;
              const side = (p: { x: number; y: number; heading: number }, s: number) => pt(scale, p.x - Math.sin(p.heading) * s, p.y + Math.cos(p.heading) * s, h);
              G.poly([...side(p0, off - w / 2), ...side(p1, off - w / 2), ...side(p1, off + w / 2), ...side(p0, off + w / 2)]).fill({ color: colour, alpha });
            }
          };
          if (j.kind === "sewer") {
            // Made good behind; the open trench between the making good and the cut, its far wall lit; the pipe in it; the spoil beside.
            strip(0, f[2], 0.4, 0, SCAR, 0.85);
            strip(f[2], f[0], 0.36, 0, TRENCH);
            strip(f[2], f[0], 0.07, -0.15, TRENCH_SIDE);
            strip(f[2], f[1], 0.15, 0.02, SEWER_PIPE);
            strip(f[2], f[1], 0.05, -0.01, SEWER_LIT);
            strip(f[2], f[0], 0.16, 0.34, SPOIL);
            strip(f[2], f[0], 0.07, 0.31, SPOIL_TOP);
          }
          // (A MAIN has nothing drawn on the ground: it is the pipe itself that goes in. @see below)
        }
      }

      // ── THE MACHINES ────────────────────────────────────────────────────────────────────
      const seen = new Set<string>(), seenB = new Set<number>(), seenM = new Set<number>();
      if ((jobs.length || g.razeJobs.length) && bakedCars() && !cars && !asked) { asked = true; void loadCarSprites().then((s) => { cars = s; }); }
      const P = bakedPeople() ? peopleLoaded() : null;
      if (bakedPeople() && !P && (jobs.length || g.razeJobs.length)) void peopleSprites();
      for (const j of jobs) {
        const w = (clocks.get(j.id) ?? j.id * 2.9) + (j.stalled > 0 ? 0 : dt);
        clocks.set(j.id, w);
        const n = j.cells.length, f0 = lineFront(j, 0);
        const place = (name: string, p: number, looks: { look: string; tint: number; heading?: number }[], turn = 0, across = 0): Unit | null => {
          if (!cars) return null;
          const id = `${j.id}:${name}`, on = alongLine(j.cells, p), c = j.cells[Math.max(0, Math.min(n - 1, Math.floor(p)))];
          const at = { x: on.x - Math.sin(on.heading) * across, y: on.y + Math.cos(on.heading) * across, heading: on.heading };
          let u = units.get(id);
          if (!u) { u = makeUnit(looks.length); units.set(id, u); }
          seen.add(id);
          const base = poseUnit(u, cars, looks, { x: at.x, y: at.y, z: g.height[idx(g, c.x, c.y)], heading: at.heading + turn, pitch: 0 }, scale, P ? { people: P, id: j.id * 8 + name.length } : null);
          u.band = into(u.c, u.band, at.x, at.y, base);
          return u;
        };
        if (j.kind === "sewer" && f0 < n) {
          // THE DIGGER backs along the line ahead of its trench: a bite out of the end of it, round to the side, tipped on the ridge.
          const q = ((w % DIG_ALL) + DIG_ALL) % DIG_ALL, at = alongLine(j.cells, f0 + 0.62);
          let pose = "exDig", slew = 0;
          if (q < DIG.dig) pose = q < DIG.dig * 0.45 ? "exDig" : "exDig2";
          else if (q < DIG.dig + DIG.lift) pose = "exLift";
          else if (q < DIG.dig + DIG.lift + DIG.out) { pose = "exLift"; slew = (q - DIG.dig - DIG.lift) / DIG.out; }
          else if (q < DIG.dig + DIG.lift + DIG.out + DIG.tip) { pose = "exDump"; slew = 1; }
          else { pose = "exLift"; slew = 1 - (q - DIG.dig - DIG.lift - DIG.out - DIG.tip) / DIG.back; }
          const house = at.heading + Math.PI - 0.95 * (slew * slew * (3 - 2 * slew));
          place("digger", f0 + 0.62, [{ look: "exTracks", tint: YELLOW }, { look: j.stalled > 0 ? "exLift" : pose, tint: YELLOW, heading: house }]);
        }
        if (j.kind === "main") layMain(g, j, w, dt, scale, P, place, seenM);
        if (j.kind === "dredge" && f0 < n) {
          // THE DREDGER: a barge on the water over where it is working, a jib over its bow and a grab on a rope; mud in the water round it.
          seenB.add(j.id);
          let b = barges.get(j.id);
          if (!b) { const c = new Container(), gr = new Graphics(); c.eventMode = "none"; gr.context.batchMode = "batch"; c.addChild(gr); b = { c, g: gr, band: -1 }; barges.set(j.id, b); }
          const at = alongLine(j.cells, f0 + 0.2), c = j.cells[Math.max(0, Math.min(n - 1, Math.floor(f0)))];
          const h = g.height[idx(g, c.x, c.y)] + (depth?.(c.x, c.y) ?? 0);
          const G = b.g, ch = Math.cos(at.heading), sh = Math.sin(at.heading);
          /** A point of the barge: along it, across it, tiles; up, half steps — on the screen from its middle. */
          const at2 = (l: number, s: number, up: number): [number, number] => { const [x, y] = pt(scale, l * ch - s * sh, l * sh + s * ch, up); return [x, y]; };
          const box = (l0: number, l1: number, s: number, z0: number, z1: number, top: number, side: number) => {
            for (const sg of [-1, 1]) G.poly([...at2(l0, sg * s, z0), ...at2(l1, sg * s, z0), ...at2(l1, sg * s, z1), ...at2(l0, sg * s, z1)]).fill({ color: side });
            for (const l of [l0, l1]) G.poly([...at2(l, -s, z0), ...at2(l, s, z0), ...at2(l, s, z1), ...at2(l, -s, z1)]).fill({ color: side });
            G.poly([...at2(l0, -s, z1), ...at2(l1, -s, z1), ...at2(l1, s, z1), ...at2(l0, s, z1)]).fill({ color: top });
          };
          G.clear();
          // Mud in the water where the grab has been, drifting behind.
          for (let q = 0; q < 5; q++) { const ph = (w * 0.25 + q / 5) % 1, [x, y] = at2(-0.1 - ph * 0.7, ((q * 0.37) % 1 - 0.5) * 0.4, 0); G.circle(x, y, (5 + ph * 9) * scale).fill({ color: MUD, alpha: 0.4 * (1 - ph) }); }
          box(-0.34, 0.3, 0.15, 0, 0.3, DECK, HULL);
          box(-0.3, -0.1, 0.1, 0.3, 0.75, CABIN, 0xbfbab0);
          box(-0.36, -0.34, 0.15, 0, 0.3, HULL, HULL_SIDE);
          // The jib from the deck out over the bow, and the grab going down and coming up.
          const dip = 0.5 + 0.5 * Math.sin(w * 1.1), tip = at2(0.5, 0, 1.3), foot = at2(0.05, 0, 0.3), grab = at2(0.5, 0, 1.15 - dip * 1.1);
          G.moveTo(foot[0], foot[1]).lineTo(tip[0], tip[1]).stroke({ color: JIB, width: Math.max(1.2, 2.4 * scale) });
          G.moveTo(tip[0], tip[1]).lineTo(grab[0], grab[1]).stroke({ color: 0x2b2e33, width: Math.max(0.8, scale) });
          G.poly([grab[0] - 3 * scale, grab[1], grab[0] + 3 * scale, grab[1], grab[0] + 2 * scale, grab[1] + 4 * scale, grab[0] - 2 * scale, grab[1] + 4 * scale]).fill({ color: 0x3a3f46 });
          const [x, y] = pt(scale, at.x, at.y, h);
          b.c.position.set(x, y);
          b.band = into(b.c, b.band, at.x, at.y, [{ u: 0.3, v: 0.3 }]);
        }
      }
      // ── WHAT IS BEING PULLED DOWN: taped off, a digger at its front pulling at it, dust over it, rubble heaping at its foot ──
      const seenR = new Set<number>();
      for (const j of g.razeJobs) {
        const s = g.structures.get(j.structure);
        if (!s) continue;
        seenR.add(j.id);
        const w = (clocks.get(-j.id) ?? j.id * 1.7) + dt;
        clocks.set(-j.id, w);
        const h = g.height[idx(g, s.x, s.y)], p = Math.min(1, j.t / j.need);
        const x0 = s.x - 0.5, x1 = s.x + s.w - 0.5, y0 = s.y - 0.5, y1 = s.y + s.h - 0.5;
        let r = razing.get(j.id);
        if (!r) { const gr = new Graphics(); gr.eventMode = "none"; gr.context.batchMode = "batch"; r = { g: gr, band: -1 }; razing.set(j.id, r); }
        const band = Math.max(0, Math.min(bands.dynamicOf.length - 1, s.x + s.w - 1 + s.y + s.h - 1));
        if (band !== r.band || !r.g.parent) { r.g.zIndex = 3; bands.dynamicOf[band]?.addChild(r.g); r.band = band; }
        const G = r.g;
        G.clear();
        // Tape round it on posts, along the two near sides.
        for (const [a, b] of [[[x0, y1], [x1, y1]], [[x1, y1], [x1, y0]]] as [number[], number[]][]) {
          for (let q = 0; q < 8; q++) {
            const [ax, ay] = pt(scale, a[0] + ((b[0] - a[0]) * q) / 8, a[1] + ((b[1] - a[1]) * q) / 8, h + 0.45), [bx, by] = pt(scale, a[0] + ((b[0] - a[0]) * (q + 1)) / 8, a[1] + ((b[1] - a[1]) * (q + 1)) / 8, h + 0.45);
            G.moveTo(ax, ay).lineTo(bx, by).stroke({ color: q % 2 ? 0xf1efe8 : 0xe8463c, width: Math.max(1, 1.4 * scale) });
          }
        }
        for (const [u, v] of [[x0, y1], [x1, y1], [x1, y0]]) { const [px, py] = pt(scale, u, v, h); G.rect(px - scale, py - 6 * scale, 2 * scale, 6 * scale).fill({ color: 0xf4efe2 }); }
        // Rubble at its foot, more of it as it comes down.
        for (let q = 0; q < Math.round(p * 9); q++) {
          const [px, py] = pt(scale, x0 + (((q * 0.37) % 1) * (x1 - x0)), y1 - 0.08 - ((q * 0.61) % 1) * 0.25, h);
          G.poly([px - 5 * scale, py, px + 5 * scale, py, px + 2 * scale, py - (3 + (q % 3)) * scale, px - 3 * scale, py - (2 + (q % 2)) * scale]).fill({ color: q % 2 ? 0x8f8b84 : 0x7a5a3c });
        }
        // Dust, rising off it where the bucket is pulling.
        for (let q = 0; q < 7; q++) {
          const ph = (w * 0.45 + q / 7) % 1, [px, py] = pt(scale, x0 + ((q * 0.29 + 0.2) % 1) * (x1 - x0), y0 + ((q * 0.53 + 0.4) % 1) * (y1 - y0), h + 1 + ph * 3);
          G.circle(px, py, (5 + ph * 11) * scale).fill({ color: 0xc9bfae, alpha: 0.42 * (1 - ph) });
        }
        // THE DIGGER at the middle of its front, turned to it: a bite, a pull, and round to drop it.
        if (cars) {
          const id = `raze:${j.id}`, q = ((w % DIG_ALL) + DIG_ALL) % DIG_ALL, at = { x: (x0 + x1) / 2, y: y1 - 0.18 };   // (on the plot's own front edge: never out in the road)
          let u = units.get(id);
          if (!u) { u = makeUnit(2); units.set(id, u); }
          seen.add(id);
          const pose = q < DIG.dig * 0.45 ? "exDig" : q < DIG.dig ? "exDig2" : q < DIG.dig + DIG.lift + DIG.out ? "exLift" : q < DIG.dig + DIG.lift + DIG.out + DIG.tip ? "exDump" : "exLift";
          const slew = q < DIG.dig + DIG.lift ? 0 : q < DIG.dig + DIG.lift + DIG.out ? (q - DIG.dig - DIG.lift) / DIG.out : q < DIG.dig + DIG.lift + DIG.out + DIG.tip ? 1 : 1 - (q - DIG.dig - DIG.lift - DIG.out - DIG.tip) / DIG.back;
          const base = poseUnit(u, cars, [{ look: "exTracks", tint: YELLOW }, { look: pose, tint: YELLOW, heading: -Math.PI / 2 + 1.1 * (slew * slew * (3 - 2 * slew)) }], { x: at.x, y: at.y, z: h, heading: -Math.PI / 2, pitch: 0 }, scale, P ? { people: P, id: j.id * 5 } : null);
          u.band = into(u.c, u.band, at.x, at.y, base);
        }
      }
      for (const [id, r] of razing) if (!seenR.has(id)) { drop(r.g); razing.delete(id); }
      for (const [id, u] of units) if (!seen.has(id)) { drop(u.c); units.delete(id); }
      for (const [id, b] of barges) if (!seenB.has(id)) { drop(b.c); barges.delete(id); }
      for (const [id, m] of mains) if (!seenM.has(id)) { dropMain(m); mains.delete(id); }
      for (const id of clocks.keys()) if (id >= 0 ? !jobs.some((j) => j.id === id) : !g.razeJobs.some((j) => j.id === -id)) clocks.delete(id);
    },
    destroy() { for (const m of mains.values()) dropMain(m); mains.clear(); clear(); for (const r of razing.values()) drop(r.g); razing.clear(); for (const u of units.values()) drop(u.c); for (const b of barges.values()) drop(b.c); units.clear(); barges.clear(); clocks.clear(); },
  };
}
