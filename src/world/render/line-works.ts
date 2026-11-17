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
import { LINE_STAGES, MAIN, alongLine, lineFront, type LineJob } from "../lines/jobs";
import type { BandLayer } from "./bands";
import { bakedProps, propSprite, propSprites, propsLoaded } from "../props/props-sheet";
import { BLUE, DIG, DIG_ALL, DRUM, M, T, YELLOW, makeUnit, mixerLook, poseUnit, type Unit } from "./plant-kit";
import { walkRound, type Walker } from "./road-plant";

/** How high a main's middle lies off the ground, half steps; and how thick it is, px at the map's own scale. @see mains-layer LIFT, TUBE_R */
const LIFT = 1.1, TUBE_PX = 5.6;
const SKIN = 0xd9a47a, LEGS = 0x3a4a63;
/** A main's tube's radius in half steps, for laying a length on something. */
const TUBE_R_HS = 0.34;
/** A length of pipe from one point of the map to another, `z` half steps up, drawn into `G`: a lit round thing, its ends dark. Gives its two ends on the screen. */
function tube(G: Graphics, scale: number, ax: number, ay: number, bx: number, by: number, z: number, thin = 1): readonly [[number, number], [number, number]] {
  const P2 = (u: number, v: number): [number, number] => [(u - v) * HW * scale, (u + v) * HH * scale - z * HEIGHT_UNIT * scale];
  const A = P2(ax, ay), B = P2(bx, by), ux = B[0] - A[0], uy = B[1] - A[1], len = Math.hypot(ux, uy) || 1, nx = -uy / len, ny = ux / len, r = Math.max(1.5, TUBE_PX * scale * thin);
  const band = (o0: number, o1: number, colour: number) => G.poly([A[0] + nx * o0, A[1] + ny * o0, B[0] + nx * o0, B[1] + ny * o0, B[0] + nx * o1, B[1] + ny * o1, A[0] + nx * o1, A[1] + ny * o1]).fill({ color: colour });
  // (Lit from above: the normal turned to whichever way is up the screen.)
  const s2 = ny < 0 ? 1 : -1;
  band(-r, r, 0x74777a); band(-r * 0.75 * s2, r * s2, 0xa6a9aa); band(r * 0.25 * s2, r * 0.8 * s2, 0xd6d8d9);
  for (const E of [A, B]) G.ellipse(E[0], E[1], r * 0.55, r).fill({ color: 0x4d5053 });
  return [A, B];
}

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
  /**
   * A main being laid: what moves over it each frame — a length in the slings, the concrete off a chute, the sparks;
   * what stands along it till the pipe comes — pits, formwork, plinths, lengths on their skids — a drawing a band;
   * its crew; and the pegs set out ahead of it.
   */
  type Hand = Walker & { c: Container; parts: Sprite[]; key: string; band: number };
  type Laying = { g: Graphics; band: number; stood: Map<number, Graphics>; stoodKey: string; hands: Map<string, Hand>; pegs: Container[]; pegged: string };
  const mains = new Map<number, Laying>();
  const dropMain = (m: Laying) => { drop(m.g); for (const q of m.stood.values()) drop(q); for (const h of m.hands.values()) drop(h.c); for (const q of m.pegs) drop(q); };
  /**
   * A MAIN GOING IN, SIX TRADES ALONG IT AT ONCE (@see lines/jobs MAIN). The pipe itself is real — on the map a
   * length at a time, drawn by the mains' own layer — so what is drawn here is everything that comes before it and
   * the work round it:
   *  - FOOTINGS: a small digger ahead on the far side, a pit a tile, its spoil beside;
   *  - POUR: formwork in each pit, a mixer backed up to it, its drum turning, concrete down the chute to a plinth;
   *  - STRINGING: a lorry of pipe, its lengths laid out along the line on timber skids;
   *  - SETTING: a digger at its boom's reach lifts each length off its skids, over, and down onto the plinths —
   *    as it lands it is the real pipe; a banksman sees it in;
   *  - WELDING: the welders' truck, a screen stood by the joint, two welders at it and the sparks off it;
   *  - INSPECTION: one in a white hat, behind, walking the run.
   */
  const layMain = (
    g: Grid, j: LineJob, w: number, dt: number, scale: number, P: ReturnType<typeof peopleLoaded>,
    place: (name: string, p: number, looks: { look: string; tint: number; heading?: number }[], turn?: number, across?: number) => Unit | null,
    seenM: Set<number>,
  ) => {
    const n = j.cells.length, f = [0, 1, 2, 3, 4, 5].map((q) => lineFront(j, q)), laid = j.laid ?? 0, still = j.stalled > 0;
    const done = f[MAIN.inspect] >= n;
    let m = mains.get(j.id);
    if (!m) { const gr = new Graphics(); gr.eventMode = "none"; gr.context.batchMode = "batch"; m = { g: gr, band: -1, stood: new Map(), stoodKey: "", hands: new Map(), pegs: [], pegged: "" }; mains.set(j.id, m); }
    seenM.add(j.id);
    const M_ = m;
    const hAt = (p: number) => { const c = j.cells[Math.max(0, Math.min(n - 1, Math.floor(p)))]; return g.height[idx(g, c.x, c.y)]; };
    /** A place by the line: `p` tiles along it, `across` to its side. */
    const by = (p: number, across = 0) => { const a = alongLine(j.cells, p); return { x: a.x - Math.sin(a.heading) * across, y: a.y + Math.cos(a.heading) * across, heading: a.heading }; };
    /** The side the pipe comes from — its lorry, its skids — and the side it is worked from. */
    const FAR = -1, NEAR = 1, SKID = 0.3 * FAR, REACH = 3.9 * T + 0.04, PLINTH = LIFT - 0.34;

    // ── ITS LINE, PEGGED OUT AHEAD of the first trade: a stake a tile, the builder's line between ──
    const Pr = bakedProps() ? propsLoaded() : null;
    if (bakedProps() && !Pr) void propSprites();
    const k0 = Math.floor(f[MAIN.foot]), pk = `${Pr ? 1 : 0}|${k0}|${scale}`;
    if (pk !== m.pegged) {
      m.pegged = pk;
      for (const q of m.pegs) drop(q);
      m.pegs = [];
      if (Pr) for (let c = k0; c <= n && c < k0 + 40; c++) {
        const a = by(Math.min(n, c), 0.4 * NEAR), hh = hAt(c), band = bandOf(Math.round(a.x), Math.round(a.y));
        const put = (id: string, turn: number, px: number, py: number) => { const sp = propSprite(Pr, id, turn, px, py, hh, scale), layer = bands.dynamicOf[band]; if (sp && layer) { sp.zIndex = px + py - band; layer.addChild(sp); M_.pegs.push(sp); } };
        put("stake", c & 3, a.x, a.y);
        if (c < n) { const b = by(c + 0.5, 0.4 * NEAR); for (const half of [-0.25, 0.25]) put("tape", Math.abs(Math.cos(b.heading)) > 0.5 ? 0 : 1, b.x + Math.cos(b.heading) * half, b.y + Math.sin(b.heading) * half); }
      }
    }

    // ── WHAT STANDS ALONG IT TILL THE PIPE COMES: a pit, its formwork, its plinth; a length on its skids ──
    const sk = `${scale}|${laid}|${f.slice(0, 4).map((q) => Math.floor(q * 12)).join(".")}|${Math.floor(f[MAIN.weld])}`;
    if (sk !== m.stoodKey) {
      m.stoodKey = sk;
      for (const q of m.stood.values()) q.clear();
      /** A box stood on the map, seen from the camera: its top and its two near faces. */
      const box = (x: number, y: number, hx: number, hy: number, z0: number, z1: number, h: number, top: number, lit: number, dark: number) => {
        const band = bandOf(Math.round(x), Math.round(y)), layer = bands.dynamicOf[band];
        if (!layer) return;
        let G = M_.stood.get(band);
        if (!G) { G = new Graphics(); G.eventMode = "none"; G.context.batchMode = "batch"; G.zIndex = -0.05; layer.addChild(G); M_.stood.set(band, G); }
        const Q = (u: number, v: number, z: number) => pt(scale, u, v, h + z);
        G.poly([...Q(x + hx, y - hy, z1), ...Q(x + hx, y + hy, z1), ...Q(x + hx, y + hy, z0), ...Q(x + hx, y - hy, z0)]).fill({ color: lit });
        G.poly([...Q(x - hx, y + hy, z1), ...Q(x + hx, y + hy, z1), ...Q(x + hx, y + hy, z0), ...Q(x - hx, y + hy, z0)]).fill({ color: dark });
        G.poly([...Q(x - hx, y - hy, z1), ...Q(x + hx, y - hy, z1), ...Q(x + hx, y + hy, z1), ...Q(x - hx, y + hy, z1)]).fill({ color: top });
      };
      // THE WELDERS' SCREEN: two panels on feet beyond the joint they are at, to keep the arc from the rest of the gang.
      if (f[MAIN.weld] > 0.5 && f[MAIN.weld] < n) {
        const kw = Math.floor(f[MAIN.weld]), a = by(Math.max(0.5, kw), 0.36 * -1), along = Math.abs(Math.cos(a.heading)) > 0.5, hj = hAt(kw);
        for (const e of [-0.09, 0.09]) box(a.x + (along ? e : 0), a.y + (along ? 0 : e), along ? 0.085 : 0.012, along ? 0.012 : 0.085, 0.08, 1.05, hj, 0xe8742a, 0xe8742a, 0xc95a1c);
      }
      for (let c = 0; c < n; c++) {
        // (Where the pipe is, the pipe's own saddle stands: nothing of this.)
        if (c < laid) continue;
        const at = by(c + 0.5), h = hAt(c), foot = Math.max(0, Math.min(1, f[MAIN.foot] - c)), pour = Math.max(0, Math.min(1, f[MAIN.pour] - c));
        if (foot <= 0) break;
        // The pit, growing; its spoil thrown up beside it.
        const half = 0.07 + 0.09 * foot;
        box(at.x, at.y, half, half, 0, 0.015, h, pour > 0.35 ? 0x8d9296 : 0x3a2a1c, 0x3a2a1c, 0x3a2a1c);
        const sp = by(c + 0.5, 0.3 * NEAR);
        box(sp.x, sp.y, 0.07 * foot, 0.07 * foot, 0, 0.16 * foot, h, 0xa98660, 0x8b6a47, 0x6f5338);
        if (pour > 0) {
          // FORMWORK round it, ply; then the concrete rising in it to a plinth; struck when it is up, the plinth standing grey.
          const up = Math.max(0, Math.min(1, (pour - 0.35) / 0.55)), struck = pour >= 1;
          if (!struck) box(at.x, at.y, 0.12, 0.12, 0, PLINTH + 0.06, h, 0xb9a070, 0xd8c08f, 0xb39a68);
          if (up > 0) box(at.x, at.y, 0.1, 0.1, 0, PLINTH * up, h, up < 1 ? 0x8d9296 : 0xc9c4b8, struck ? 0xbdb8ac : 0x8d9296, struck ? 0x9d988d : 0x7b8084);
        }
        // A LENGTH on its skids, on the far side, from when the lorry has passed until it is lifted.
        if (f[MAIN.string] > c + 0.5 && Math.floor(f[MAIN.set]) < c) {
          const a = by(c + 0.5, SKID), ch = Math.cos(a.heading), sh = Math.sin(a.heading);
          for (const e of [-0.3, 0.3]) box(a.x + ch * e, a.y + sh * e, 0.05, 0.05, 0, 0.07, h, 0xb08a5a, 0x9a7347, 0x7b5b38);
          const band = bandOf(Math.round(a.x), Math.round(a.y)), G = M_.stood.get(band);
          if (G) tube(G, scale, a.x - ch * 0.46, a.y - sh * 0.46, a.x + ch * 0.46, a.y + sh * 0.46, h + 0.07 + TUBE_R_HS);
        }
      }
    }

    const G = m.g;
    G.clear();
    const setK = Math.min(n - 1, Math.floor(f[MAIN.set])), at = by(Math.max(0.5, setK)), h = hAt(setK);
    const band = Math.max(0, Math.min(bands.dynamicOf.length - 1, bandOf(Math.round(at.x), Math.round(at.y))));
    if (band !== m.band || !G.parent) { G.zIndex = at.x + at.y - band + 0.6; bands.dynamicOf[band]?.addChild(G); m.band = band; }
    const seenH = new Set<string>();
    /** One of the crew, at a place by the line that moves on: stood at it, working, and walking after it when it has gone. */
    const hand = (name: string, p: number, across: number, pose: "work" | "stand", face: number, tints: number[], brisk = 2.4) => {
      if (!P) return null;
      seenH.add(name);
      let hd = M_.hands.get(name);
      if (!hd) {
        const c = new Container(); c.eventMode = "none";
        const parts = tints.map((tint) => { const sp = new Sprite(); sp.tint = tint; c.addChild(sp); return sp; });
        hd = { c, parts, key: "", band: -1 };
        M_.hands.set(name, hd);
      }
      const r2 = walkRound(hd, [{ al: 0, ac: across, pose, dwell: 1e9, face }], p, still ? 0 : dt * brisk);
      const a3 = by(Math.max(0.05, hd.p!), hd.ac!);
      hd.key = posePerson(hd.parts, P, "builder", still && r2.pose === "work" ? "stand" : r2.pose, a3.heading + r2.face, r2.pose === "walk" ? w * 7.5 + name.length : w * 5 + name.length * 1.7, scale, 0.95, hd.key);
      const [sx, sy] = pt(scale, a3.x, a3.y, hAt(hd.p!));
      for (const sp of hd.parts) sp.position.set(sx, sy);
      hd.band = into(hd.c, hd.band, a3.x, a3.y, [{ u: 0.05, v: 0.05 }]);
      return hd;
    };
    const VEST = (k: number) => [SKIN, LEGS, k % 2 ? 0xc8dc32 : 0xf47b20, 0xf5c224, 0xffffff];

    // ── FOOTINGS: a digger ahead, on the far side, turned to the line: a bite a few seconds, a pit a tile ──
    if (f[MAIN.foot] < n) {
      const q = ((w % DIG_ALL) + DIG_ALL) % DIG_ALL, a = by(f[MAIN.foot] + 0.5, 0.5 * FAR), to = by(f[MAIN.foot] + 0.5), toward = Math.atan2(to.y - a.y, to.x - a.x);
      const pose = q < DIG.dig * 0.45 ? "exDig" : q < DIG.dig ? "exDig2" : q < DIG.dig + DIG.lift + DIG.out ? "exLift" : q < DIG.dig + DIG.lift + DIG.out + DIG.tip ? "exDump" : "exLift";
      const slew = q < DIG.dig + DIG.lift ? 0 : q < DIG.dig + DIG.lift + DIG.out ? (q - DIG.dig - DIG.lift) / DIG.out : q < DIG.dig + DIG.lift + DIG.out + DIG.tip ? 1 : 1 - (q - DIG.dig - DIG.lift - DIG.out - DIG.tip) / DIG.back;
      place("footer", f[MAIN.foot] + 0.5, [{ look: "exTracks", tint: YELLOW }, { look: still ? "exLift" : pose, tint: YELLOW, heading: toward + 0.9 * (slew * slew * (3 - 2 * slew)) }], 0, 0.5 * FAR);
    }
    // ── THE POUR: a mixer backed up to the pit square to the line, its drum turning; concrete down its chute; two at the formwork ──
    if (f[MAIN.pour] > 0 && f[MAIN.pour] < n) {
      const c = Math.floor(f[MAIN.pour]), fr = f[MAIN.pour] - c, pit = by(c + 0.5), pouring = !still && fr > 0.35 && fr < 0.92;
      // (Its tail to the pit: it faces away from the line, its chute's end over the formwork.)
      place("mixer", c + 0.5, [{ look: mixerLook(w, pouring), tint: DRUM }], Math.PI / 2 * FAR, 0.6 * FAR);
      if (pouring) {
        const from = by(c + 0.5, 0.14 * FAR), hp = hAt(c);
        for (let q = 0; q < 6; q++) {
          const ph = (w * 2.2 + q / 6) % 1, [x0, y0] = pt(scale, from.x, from.y, hp + 0.95 * M * 2.268 * 0.44 + 0.55), [x1, y1] = pt(scale, pit.x, pit.y, hp + PLINTH * Math.max(0, (fr - 0.35) / 0.55));
          G.circle(x0 + (x1 - x0) * ph, y0 + (y1 - y0) * ph * ph, (1.6 + 0.8 * Math.sin(q * 2.1)) * scale).fill({ color: q % 2 ? 0x93969a : 0xb4b7ba });
        }
      }
      hand("form0", c + 0.28, 0.2 * NEAR, "work", -Math.PI / 2, VEST(0));
      hand("form1", c + 0.72, 0.2 * NEAR, "work", -Math.PI / 2, VEST(1));
    }
    // ── STRINGING: the pipe lorry on the far side, its lengths off it one by one onto their skids ──
    if (f[MAIN.string] > 0 && f[MAIN.string] < n) {
      const lorry = place("pipes", f[MAIN.string] + 0.55, [{ look: "flatbed", tint: BLUE }], 0, 0.78 * FAR);
      const left = Math.max(0, Math.min(4, Math.ceil(n - f[MAIN.string])));
      if (lorry) for (let q = 0; q < left; q++) {
        // (In the lorry's own picture: along its bed, side by side and then on top.)
        const a2 = by(f[MAIN.string] + 0.55), lc = Math.cos(a2.heading), ls = Math.sin(a2.heading), o = q < 3 ? (q - 1) * 0.055 : 0, zz = (q < 3 ? 1.35 : 1.75) * M;
        tube(lorry.over, scale, -lc * 0.22 - ls * o, -ls * 0.22 + lc * o, lc * 0.12 - ls * o, ls * 0.12 + lc * o, zz, 0.8);
      }
    }
    // ── SETTING: a digger at its boom's reach on the near side lifts the next length off its skids, over, and down ──
    if (f[MAIN.set] > 0 && f[MAIN.set] < n) {
      const fr = f[MAIN.set] - setK, ch = Math.cos(at.heading), sh = Math.sin(at.heading);
      const dg = by(Math.max(0.5, setK), REACH * NEAR), toward = Math.atan2(at.y - dg.y, at.x - dg.x);
      // (Up off the skids, across, and down the last of the way: an arc.)
      const go = Math.max(0, Math.min(1, (fr - 0.1) / 0.8)), e = go * go * (3 - 2 * go);
      const across = SKID * (1 - e), lift = (0.07 + TUBE_R_HS) + (LIFT - 0.07 - TUBE_R_HS) * e + 0.75 * Math.sin(Math.PI * e);
      // (Its boom follows the load: out toward the skids to pick, in over the line to set.)
      const reach = (3.9 * T) * (1 + 0.55 * (1 - e));
      place("layer", Math.max(0.5, setK), [{ look: "exTracks", tint: YELLOW }, { look: "exDump", tint: YELLOW, heading: toward }], 0, REACH * NEAR);
      const hook = pt(scale, dg.x + Math.cos(toward) * Math.min(reach, 3.9 * T * 1.15), dg.y + Math.sin(toward) * Math.min(reach, 3.9 * T * 1.15), h + 4.3 * M);
      const cx = at.x - sh * across, cy = at.y + ch * across;
      const [A, B] = tube(G, scale, cx - ch * 0.48, cy - sh * 0.48, cx + ch * 0.48, cy + sh * 0.48, h + lift);
      const r = Math.max(2, TUBE_PX * scale);
      for (const tq of [0.3, 0.7]) G.moveTo(hook[0], hook[1]).lineTo(A[0] + (B[0] - A[0]) * tq, A[1] + (B[1] - A[1]) * tq - r).stroke({ color: 0x2b2e33, width: Math.max(0.6, 0.5 * scale) });
      hand("banks", Math.max(0.3, setK - 0.1), 0.62 * FAR, "stand", Math.PI / 2, VEST(1));
    }
    // ── WELDING: the welders' truck on the near side; a screen stood by the joint; two at it, and the sparks ──
    if (f[MAIN.weld] > 0.5 && f[MAIN.weld] < n) {
      const kw = Math.floor(f[MAIN.weld]), jp = Math.max(0.5, kw), jt = by(jp), hj = hAt(kw);
      place("welder", Math.max(0.5, f[MAIN.weld] - 0.9), [{ look: "pickup", tint: YELLOW }], 0, 0.62 * NEAR);
      const w0 = hand("weld0", jp, 0.2 * NEAR, "work", -Math.PI / 2, VEST(0)), w1 = hand("weld1", jp, 0.2 * FAR, "work", Math.PI / 2, VEST(1));
      if (!still && w0?.there && w1?.there) {
        const [jx, jy] = pt(scale, jt.x, jt.y, hj + LIFT), fl = 0.5 + 0.5 * Math.sin(w * 47) * Math.sin(w * 31);
        G.circle(jx, jy, (3 + fl * 2) * scale).fill({ color: 0x9fd0ff, alpha: 0.35 + 0.3 * fl });
        G.circle(jx, jy, (2 + fl * 1.4) * scale).fill({ color: 0xffa62b, alpha: 0.6 + 0.35 * fl });
        G.circle(jx, jy, (0.9 + fl) * scale).fill({ color: 0xffffff });
        for (let q = 0; q < 7; q++) { const ph = (w * 3.1 + q * 0.37) % 1, a = q * 1.9 + Math.floor(w * 3.1 + q * 0.37) * 2.4; G.circle(jx + Math.cos(a) * ph * 11 * scale, jy - ph * 5 * scale + ph * ph * 13 * scale + Math.sin(a) * ph * 3 * scale, 0.75 * scale).fill({ color: 0xffd27a, alpha: 1 - ph }); }
      }
    }
    // ── INSPECTION: one in a white hat, walking the run behind the welders ──
    if (f[MAIN.inspect] > 0.3 && !done) hand("inspect", f[MAIN.inspect], 0.28 * NEAR, "stand", -Math.PI / 2, [SKIN, LEGS, 0xf2f2f2, 0xf2f2f2, 0xffffff], 1.4);
    for (const [name, hd] of m.hands) if (!seenH.has(name)) { drop(hd.c); m.hands.delete(name); }
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
          const f = Array.from({ length: LINE_STAGES[j.kind] }, (_, q) => lineFront(j, q)), n = j.cells.length;
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
