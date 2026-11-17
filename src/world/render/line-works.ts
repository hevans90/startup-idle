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
import { Container, Graphics, Sprite, type Geometry, type Mesh, type Shader } from "pixi.js";

import { bakedCars, loadCarSprites, type CarSprites } from "../agents/cars/car-sheet";
import { bakedPeople, peopleLoaded, peopleSprites, posePerson } from "../agents/people/people-sheet";
import { idx, type Grid } from "../grid";
import { HEIGHT_UNIT, HH, HW, bandOf } from "../iso";
import { LINE_STAGES, MAIN, SEWER, alongLine, lineFront, type LineJob } from "../lines/jobs";
import type { BandLayer } from "./bands";
import { bakedProps, propSprite, propSprites, propsLoaded } from "../props/props-sheet";
import { BLUE, DIG, DIG_ALL, DRUM, M, T, YELLOW, makeUnit, mixerLook, poseUnit, type Unit } from "./plant-kit";
import { walkRound, type Walker } from "./road-plant";
import { destroyPipeDrawable, pipeDrawable } from "./pipe-gpu";
import { MATERIAL, ZT, flange, made, pipeMesh, solid, tube as meshTube } from "./pipe-mesh";
import { CRANE_LOOKS, CRANE_REACH, craneTip } from "../agents/cars/models";

/** How high a main's middle lies off the ground, half steps. @see mains-layer LIFT */
const LIFT = 1.1;
const SKIN = 0xd9a47a, LEGS = 0x3a4a63;
/** A main's tube: its radius, tiles and half steps; its steel. @see mains-layer TUBE_R, STEEL */
const TUBE_R = 0.09 / Math.SQRT2, STEEL = 0xa6a9aa;
/** How long a length of pipe is as it comes off the lorry, tiles: two to a tile of main. */
const LENGTH = 0.46;
/**
 * A LOOSE LENGTH OF MAIN, as the main itself is made: the very tube — its steel, its welds and seams, lit as it is —
 * a flange at each end, about its own middle and lying along u or along v. Moved by its place; made again only for
 * another scale. @see pipe-mesh, mains-layer
 */
function lengthMesh(alongU: boolean, scale: number, look: PipeStuff): Mesh<Geometry, Shader> {
  const m = pipeMesh(), du = alongU ? 1 : 0, dv = alongU ? 0 : 1, h = LENGTH / 2;
  made(look.mat, () => meshTube(m, scale, -du * h, -dv * h, 0, du * h, dv * h, 0, look.r, solid(look.colour), 14));
  for (const e of [-h, h]) flange(m, scale, du * e, dv * e, 0, du, dv, look.r, look.colour, 14, true, false);
  return pipeDrawable(m);
}
/** What a run's lengths are: a main's steel; a drain's cast iron, a little fatter; a sewer's trunk, iron and fatter again. @see mains-layer */
type PipeStuff = { id: string; r: number; colour: number; mat: number };
const IRON = 0x7d5c40;
const STUFF: Record<"main" | "drain" | "sewer", PipeStuff> = {
  main: { id: "steel", r: TUBE_R, colour: STEEL, mat: MATERIAL.steel },
  drain: { id: "iron", r: TUBE_R * 1.25, colour: IRON, mat: MATERIAL.iron },
  sewer: { id: "trunk", r: TUBE_R * 1.1, colour: IRON, mat: MATERIAL.iron },
};

const TRENCH = 0x35271b, TRENCH_SIDE = 0x4a3625, SPOIL = 0x8b6a47, SPOIL_TOP = 0xa98660, SCAR = 0x7a5a3c;
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
  type Laying = { g: Graphics; band: number; stood: Map<number, Graphics>; /** What of that stands NEARER than a length down in a trench: the near sheet of its shoring, drawn over the length. */ front: Map<number, Graphics>; stoodKey: string; hands: Map<string, Hand>; pegs: Container[]; pegged: string; /** Its loose lengths, each the real tube: on the lorry, on their skids, in the slings, set and waiting to be made one with the run. */ loose: Map<string, { mesh: Mesh<Geometry, Shader>; key: string; band: number }> };
  const mains = new Map<number, Laying>();
  const dropMain = (m: Laying) => { for (const q of m.loose.values()) destroyPipeDrawable(q.mesh); m.loose.clear(); drop(m.g); for (const q of m.stood.values()) drop(q); for (const q of m.front.values()) drop(q); for (const h of m.hands.values()) drop(h.c); for (const q of m.pegs) drop(q); };
  /**
   * A MAIN GOING IN, SIX TRADES ALONG IT AT ONCE (@see lines/jobs MAIN). The pipe itself is real — on the map a
   * length at a time, drawn by the mains' own layer — so what is drawn here is everything that comes before it and
   * the work round it:
   *  - FOOTINGS: a small digger ahead on the far side, a pit a tile, its spoil beside;
   *  - POUR: formwork in each pit, a mixer backed up to it, its drum turning, concrete down the chute to a plinth;
   *  - STRINGING: a lorry of pipe, its lengths — the real tube, two to a tile — laid out along the line on skids;
   *  - SETTING: a CRANE on its outriggers beside the line, its boom luffing out with each length: off the skids,
   *    over, down onto the plinths; a banksman sees it in. Set, a length waits there till the run is made one with it;
   *  - WELDING: the welders' truck, a screen stood by the joint, two welders at it and the sparks off it;
   *  - INSPECTION: one in a white hat, behind, walking the run.
   */
  const layMain = (
    g: Grid, j: LineJob, w: number, dt: number, scale: number, P: ReturnType<typeof peopleLoaded>,
    place: (name: string, p: number, looks: { look: string; tint: number; heading?: number }[], turn?: number, across?: number) => Unit | null,
    seenM: Set<number>,
  ) => {
    const n = j.cells.length, f = Array.from({ length: LINE_STAGES[j.kind] }, (_, q) => lineFront(j, q)), laid = j.laid ?? 0, still = j.stalled > 0;
    // UNDER THE GROUND, a sewer's trunk: the same lengths, the same crane — into a trench, and the trench filled over them.
    const under = j.kind === "sewer", stuff = STUFF[j.kind === "dredge" ? "main" : j.kind], R_HS = stuff.r / ZT;
    const done = f[f.length - 1] >= n;
    let m = mains.get(j.id);
    if (!m) { const gr = new Graphics(); gr.eventMode = "none"; gr.context.batchMode = "batch"; m = { g: gr, band: -1, stood: new Map(), front: new Map(), stoodKey: "", hands: new Map(), pegs: [], pegged: "", loose: new Map() }; mains.set(j.id, m); }
    seenM.add(j.id);
    const M_ = m;
    const hAt = (p: number) => { const c = j.cells[Math.max(0, Math.min(n - 1, Math.floor(p)))]; return g.height[idx(g, c.x, c.y)]; };
    /** A place by the line: `p` tiles along it, `across` to its side. */
    const by = (p: number, across = 0) => { const a = alongLine(j.cells, p); return { x: a.x - Math.sin(a.heading) * across, y: a.y + Math.cos(a.heading) * across, heading: a.heading }; };
    /** The side the pipe comes from — its lorry, its skids — and the side it is worked from. */
    const FAR = -1, NEAR = 1, SKID = (under ? 0.52 : 0.3) * NEAR, CRANE_AT = SKID + 0.324 * NEAR, PLINTH = LIFT - 0.34;
    /** Where a length lies when it is set: on its plinths, the main's own height; or down in the trench. */
    const SET_Z = under ? -0.25 * R_HS : LIFT;
    /** A loose length at a place by the line, `z` half steps over the ground there: the real tube, kept by name. */
    const seenL = new Set<string>();
    const length = (name: string, p: number, across: number, z: number, lift = 0) => {
      const a = by(p, across), alongU = Math.abs(Math.cos(a.heading)) > 0.5, key = `${alongU}|${scale}|${stuff.id}`;
      let q = M_.loose.get(name);
      if (q && q.key !== key) { destroyPipeDrawable(q.mesh); M_.loose.delete(name); q = undefined; }
      if (!q) { q = { mesh: lengthMesh(alongU, scale, stuff), key, band: -1 }; M_.loose.set(name, q); }
      seenL.add(name);
      const [x, y] = pt(scale, a.x, a.y, hAt(p) + z), band = Math.max(0, Math.min(bands.dynamicOf.length - 1, bandOf(Math.round(a.x), Math.round(a.y))));
      q.mesh.position.set(x, y);
      const zi = a.x + a.y - band + lift;
      if (band !== q.band || !q.mesh.parent) { q.mesh.zIndex = zi; bands.dynamicOf[band]?.addChild(q.mesh); q.band = band; }
      else if (Math.abs(q.mesh.zIndex - zi) > 0.04) q.mesh.zIndex = zi;
      return { x, y, a };
    };

    // ── ITS LINE, PEGGED OUT AHEAD of the first trade: a stake a tile, the builder's line between ──
    const Pr = bakedProps() ? propsLoaded() : null;
    if (bakedProps() && !Pr) void propSprites();
    const k0 = Math.floor(f[0]), pk = `${Pr ? 1 : 0}|${k0}|${scale}`;
    if (pk !== m.pegged) {
      m.pegged = pk;
      for (const q of m.pegs) drop(q);
      m.pegs = [];
      if (Pr) for (let c = k0; c <= n && c < k0 + 40; c++) {
        const a = by(Math.min(n, c), 0.4 * FAR), hh = hAt(c), band = bandOf(Math.round(a.x), Math.round(a.y));
        const put = (id: string, turn: number, px: number, py: number) => { const sp = propSprite(Pr, id, turn, px, py, hh, scale), layer = bands.dynamicOf[band]; if (sp && layer) { sp.zIndex = px + py - band; layer.addChild(sp); M_.pegs.push(sp); } };
        put("stake", c & 3, a.x, a.y);
        if (c < n) { const b = by(c + 0.5, 0.4 * FAR); for (const half of [-0.25, 0.25]) put("tape", Math.abs(Math.cos(b.heading)) > 0.5 ? 0 : 1, b.x + Math.cos(b.heading) * half, b.y + Math.sin(b.heading) * half); }
      }
    }

    // ── WHAT STANDS ALONG IT TILL THE PIPE COMES: a pit, its formwork, its plinth; a length on its skids ──
    const sk = `${scale}|${laid}|${f.map((q, k) => Math.floor(q * (k === MAIN.set ? 2 : k < 3 ? 12 : 4))).join(".")}`;
    if (sk !== m.stoodKey) {
      m.stoodKey = sk;
      for (const q of m.stood.values()) q.clear();
      for (const q of m.front.values()) q.clear();
      /** A box stood on the map, seen from the camera: its top and its two near faces. */
      const box = (x: number, y: number, hx: number, hy: number, z0: number, z1: number, h: number, top: number, lit: number, dark: number, front = false) => {
        const band = bandOf(Math.round(x), Math.round(y)), layer = bands.dynamicOf[band];
        if (!layer) return;
        const into2 = front ? M_.front : M_.stood;
        let G = into2.get(band);
        if (!G) { G = new Graphics(); G.eventMode = "none"; G.context.batchMode = "batch"; G.zIndex = front ? 0.45 : -0.05; layer.addChild(G); into2.set(band, G); }
        const Q = (u: number, v: number, z: number) => pt(scale, u, v, h + z);
        G.poly([...Q(x + hx, y - hy, z1), ...Q(x + hx, y + hy, z1), ...Q(x + hx, y + hy, z0), ...Q(x + hx, y - hy, z0)]).fill({ color: lit });
        G.poly([...Q(x - hx, y + hy, z1), ...Q(x + hx, y + hy, z1), ...Q(x + hx, y + hy, z0), ...Q(x - hx, y + hy, z0)]).fill({ color: dark });
        G.poly([...Q(x - hx, y - hy, z1), ...Q(x + hx, y - hy, z1), ...Q(x + hx, y + hy, z1), ...Q(x - hx, y + hy, z1)]).fill({ color: top });
      };
      // THE WELDERS' SCREEN: two panels on feet beyond the joint they are at, to keep the arc from the rest of the gang.
      if (!under && f[MAIN.weld] > 0.5 && f[MAIN.weld] < n) {
        const kw = Math.floor(f[MAIN.weld]), a = by(Math.max(0.5, kw), 0.36 * -1), along = Math.abs(Math.cos(a.heading)) > 0.5, hj = hAt(kw);
        for (const e of [-0.09, 0.09]) box(a.x + (along ? e : 0), a.y + (along ? 0 : e), along ? 0.085 : 0.012, along ? 0.012 : 0.085, 0.08, 1.05, hj, 0xe8742a, 0xe8742a, 0xc95a1c);
      }
      for (let c = 0; c < n; c++) {
        // (Where the pipe is, the pipe's own saddle stands: nothing of this.)
        if (c < laid) continue;
        const at = by(c + 0.5), h = hAt(c), foot = Math.max(0, Math.min(1, f[0] - c)), pour = Math.max(0, Math.min(1, f[1] - c));
        if (foot <= 0) break;
        if (under) {
          const along = Math.abs(Math.cos(at.heading)) > 0.5;
          // SHORING, from when the trench is shored till it is filled: a steel sheet down each side of it, standing a
          // little proud of the ground, and a prop across between them.
          if (pour >= 1 && f[SEWER.fill] < c + 0.5) {
            // (The near one over whatever is down in the trench; the far one behind it.)
            for (const sg of [-1, 1]) { const e = by(c + 0.5, 0.29 * sg); box(e.x, e.y, along ? 0.46 : 0.012, along ? 0.012 : 0.46, -0.1, 0.24, h, 0xc9b25a, 0xd8c26a, 0xa8934a, sg > 0); }
            for (const o of [-0.25, 0.25]) { const e = by(c + 0.5 + o); box(e.x, e.y, along ? 0.015 : 0.29, along ? 0.29 : 0.015, 0.12, 0.18, h, 0x8f959e, 0x8f959e, 0x6d737b, true); }
          }
          // A MANHOLE where the plan puts one: its concrete rings standing in the trench once its length is set; then,
          // the ground made good round it, its cover.
          if (j.marks?.includes(c) && f[SEWER.set] > c + 0.5) {
            if (f[SEWER.fill] > c + 0.5) { box(at.x, at.y, 0.13, 0.13, 0, 0.02, h, 0xc9c4b8, 0xbdb8ac, 0x9d988d); box(at.x, at.y, 0.09, 0.09, 0.02, 0.035, h, 0x3d4046, 0x2e3035, 0x2e3035); }
            else box(at.x, at.y, 0.15, 0.15, -0.1, 0.14, h, 0xc9c4b8, 0xbdb8ac, 0x9d988d);
          }
        } else {
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
        }
        // SKIDS, two to a length, where each length lies from when the lorry has passed until the crane takes it.
        for (const half of [0.25, 0.75]) {
          const p = c + half;
          if (f[MAIN.string] <= p + 0.2 || Math.floor(f[MAIN.set] * 2) > Math.round(p * 2 - 0.5)) continue;
          const a = by(p, SKID), ch = Math.cos(a.heading), sh = Math.sin(a.heading);
          for (const e of [-0.14, 0.14]) box(a.x + ch * e, a.y + sh * e, 0.03 + 0.04 * Math.abs(sh), 0.03 + 0.04 * Math.abs(ch), 0, 0.07, h, 0xb08a5a, 0x9a7347, 0x7b5b38);
        }
      }
    }

    const G = m.g;
    G.clear();
    const setK = Math.min(n - 1, Math.floor(f[MAIN.set])), at = by(Math.max(0.5, setK));
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
    if (!under && f[MAIN.foot] < n) {
      const q = ((w % DIG_ALL) + DIG_ALL) % DIG_ALL, a = by(f[MAIN.foot] + 0.5, 0.5 * FAR), to = by(f[MAIN.foot] + 0.5), toward = Math.atan2(to.y - a.y, to.x - a.x);
      const pose = q < DIG.dig * 0.45 ? "exDig" : q < DIG.dig ? "exDig2" : q < DIG.dig + DIG.lift + DIG.out ? "exLift" : q < DIG.dig + DIG.lift + DIG.out + DIG.tip ? "exDump" : "exLift";
      const slew = q < DIG.dig + DIG.lift ? 0 : q < DIG.dig + DIG.lift + DIG.out ? (q - DIG.dig - DIG.lift) / DIG.out : q < DIG.dig + DIG.lift + DIG.out + DIG.tip ? 1 : 1 - (q - DIG.dig - DIG.lift - DIG.out - DIG.tip) / DIG.back;
      place("footer", f[MAIN.foot] + 0.5, [{ look: "exTracks", tint: YELLOW }, { look: still ? "exLift" : pose, tint: YELLOW, heading: toward + 0.9 * (slew * slew * (3 - 2 * slew)) }], 0, 0.5 * FAR);
    }
    // ── THE POUR: a mixer backed up to the pit square to the line, its drum turning; concrete down its chute; two at the formwork ──
    // (A sewer's second trade is its shoring: two of the gang at the sheets, one each side of the trench.)
    if (under && f[SEWER.shore] > 0 && f[SEWER.shore] < n) {
      hand("shore0", f[SEWER.shore] + 0.2, 0.4 * NEAR, "work", -Math.PI / 2, VEST(0), 1.6);
      hand("shore1", f[SEWER.shore] - 0.2, 0.72 * FAR, "work", Math.PI / 2, VEST(1), 1.6);
    }
    if (!under && f[MAIN.pour] > 0 && f[MAIN.pour] < n) {
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
    // ── EVERY LENGTH NOT YET PART OF THE RUN, where it is: two to a tile, each the real tube ──
    // On its skids from when the lorry has passed; in the crane's slings in its turn; set on its plinths and waiting,
    // till the pipe's own layer has it. (A length is half a tile: `i` counts them from the line's first.)
    const turn = Math.floor(f[MAIN.set] * 2), lf = f[MAIN.set] * 2 - turn, setting = f[MAIN.set] > 0 && f[MAIN.set] < n;
    // (Up off the skids, out over the line as the boom comes down, and lowered the last of the way.)
    const go = Math.max(0, Math.min(1, (lf - 0.08) / 0.84)), e = go * go * (3 - 2 * go);
    const rk = Math.max(0, Math.min(CRANE_REACH.length - 1, Math.round(e * (CRANE_REACH.length - 1)))), reach = CRANE_REACH[rk] * T;
    const REST = 0.07 + R_HS, slung = { across: CRANE_AT - reach * NEAR, z: REST + (SET_Z - REST) * e + 1.1 * Math.sin(Math.PI * e) };
    let load: { x: number; y: number; a: { x: number; y: number; heading: number } } | null = null;
    for (let i = 0; i < n * 2; i++) {
      const p = (i + 0.5) / 2;
      // (Set, it shows until it is part of the run — or, in a trench, until the trench is filled over it.)
      if (i < turn) { if (under ? p > f[SEWER.fill] : p > laid - 0.5) length(`l${i}`, p, 0, SET_Z, under ? 0.1 : 0.3); }
      else if (i === turn && setting) load = length(`l${i}`, p, slung.across, slung.z, 0.5);
      else if (f[MAIN.string] > p + 0.2) length(`l${i}`, p, SKID, REST, 0.1);
      else break;
    }
    // ── STRINGING: the pipe lorry, its lengths on its bed, laying them out on their skids as it goes ──
    if (f[MAIN.string] > 0 && f[MAIN.string] < n) {
      const lp = f[MAIN.string] + 0.5;
      place("pipes", lp, [{ look: "flatbed", tint: BLUE }], 0, 0.74 * NEAR);
      const left = Math.max(0, Math.min(3, Math.ceil((n - f[MAIN.string]) * 2)));
      for (let q = 0; q < left; q++) length(`bed${q}`, lp - 0.12, 0.74 * NEAR + (q < 2 ? (q - 0.5) * 0.13 : 0), (q < 2 ? 1.25 : 1.95) * M + R_HS, 0.4);
    }
    // ── SETTING: THE CRANE, parked on its outriggers beside the line; its boom luffs out with each length — picked
    // off the skids at its foot, carried out over the line, lowered onto the plinths — and a banksman sees it in ──
    if (setting) {
      const p = (turn + 0.5) / 2, cr = by(p, CRANE_AT), toward = cr.heading - (Math.PI / 2) * NEAR;
      place("crane", p, [{ look: "craneCarrier", tint: YELLOW }, { look: CRANE_LOOKS[rk], tint: YELLOW, heading: toward }], 0, CRANE_AT);
      if (load) {
        // THE ROPE from the boom's head down to the hook over the load, and the slings from it to the length's two ends.
        const tip = pt(scale, cr.x + Math.cos(toward) * reach, cr.y + Math.sin(toward) * reach, hAt(p) + craneTip(CRANE_REACH[rk]) * M);
        const r = stuff.r * HW * Math.SQRT2 * scale, hook: [number, number] = [load.x, load.y - r - 9 * scale];
        const lw = Math.max(0.6, 0.55 * scale), ch = Math.cos(load.a.heading), sh = Math.sin(load.a.heading);
        G.moveTo(tip[0], tip[1]).lineTo(hook[0], hook[1]).stroke({ color: 0x1f2226, width: lw });
        G.rect(hook[0] - 1.6 * scale, hook[1] - 2 * scale, 3.2 * scale, 4 * scale).fill({ color: 0xe9a71b });
        for (const sg of [-1, 1]) { const ex = (ch - sh) * HW * scale * LENGTH * 0.36 * sg, ey = (ch + sh) * HH * scale * LENGTH * 0.36 * sg; G.moveTo(hook[0], hook[1] + 2 * scale).lineTo(load.x + ex, load.y + ey - r).stroke({ color: 0x1f2226, width: lw }); }
      }
      hand("banks", Math.max(0.3, p - 0.1), (under ? 0.72 : 0.5) * FAR, "stand", Math.PI / 2, VEST(1));
    }
    // ── WELDING: the welders' truck on the near side; a screen stood by the joint; two at it, and the sparks ──
    if (!under && f[MAIN.weld] > 0.5 && f[MAIN.weld] < n) {
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
    if (under) {
      // ── JOINTING: two down at the newest joint, one each side of the trench, making it ──
      if (f[SEWER.joint] > 0.5 && f[SEWER.joint] < n) {
        const jp = Math.floor(f[SEWER.joint] * 2) / 2;
        hand("joint0", jp, 0.4 * NEAR, "work", -Math.PI / 2, VEST(0));
        hand("joint1", jp, 0.72 * FAR, "work", Math.PI / 2, VEST(1));
      }
      // ── FILLING: a digger on the spoil's side, pulling the ridge back into the trench a bucket at a time ──
      if (f[SEWER.fill] > 0 && f[SEWER.fill] < n) {
        const q = ((w % DIG_ALL) + DIG_ALL) % DIG_ALL, a = by(f[SEWER.fill] + 0.5, 0.95 * FAR), to = by(f[SEWER.fill] + 0.5), toward = Math.atan2(to.y - a.y, to.x - a.x);
        const pose = q < DIG.dig * 0.45 ? "exDig" : q < DIG.dig ? "exDig2" : q < DIG.dig + DIG.lift + DIG.out ? "exLift" : q < DIG.dig + DIG.lift + DIG.out + DIG.tip ? "exDump" : "exLift";
        place("filler", f[SEWER.fill] + 0.5, [{ look: "exTracks", tint: YELLOW }, { look: still ? "exLift" : pose, tint: YELLOW, heading: toward }], 0, 0.95 * FAR);
      }
      // ── ROLLING: a roller up and down the filled trench behind, and the ground made good under it ──
      if (f[SEWER.roll] > 0 && f[SEWER.roll] < n) place("roller", Math.max(0.4, f[SEWER.roll] + 0.55 + (still ? 0 : 0.4 * Math.sin(w * 0.9))), [{ look: "roller", tint: YELLOW }]);
    }
    if (!under && f[MAIN.inspect] > 0.3 && !done) hand("inspect", f[MAIN.inspect], 0.28 * NEAR, "stand", -Math.PI / 2, [SKIN, LEGS, 0xf2f2f2, 0xf2f2f2, 0xffffff], 1.4);
    for (const [name, hd] of m.hands) if (!seenH.has(name)) { drop(hd.c); m.hands.delete(name); }
    for (const [name, q] of m.loose) if (!seenL.has(name)) { destroyPipeDrawable(q.mesh); m.loose.delete(name); }
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
            // CUT AT THE QUARTERS OF A TILE, so no piece lies across two tiles: a piece is drawn with the tile its middle is
            // on, and whatever of it lay on the next tile was drawn over by that tile's ground — a gap a tile.
            const cuts = [a];
            for (let k = Math.floor(a * 4) + 1; k / 4 < b; k++) cuts.push(k / 4);
            cuts.push(b);
            for (let q = 0; q + 1 < cuts.length; q++) {
              if (cuts[q + 1] - cuts[q] < 1e-4) continue;
              const p0 = alongLine(j.cells, cuts[q]), p1 = alongLine(j.cells, cuts[q + 1]);
              const c = j.cells[Math.max(0, Math.min(n - 1, Math.floor((cuts[q] + cuts[q + 1]) / 2)))], h = g.height[idx(g, c.x, c.y)] + up;
              const G = gfx((p0.x + p1.x) / 2, (p0.y + p1.y) / 2);
              if (!G) continue;
              const side = (p: { x: number; y: number; heading: number }, s: number) => pt(scale, p.x - Math.sin(p.heading) * s, p.y + Math.cos(p.heading) * s, h);
              G.poly([...side(p0, off - w / 2), ...side(p1, off - w / 2), ...side(p1, off + w / 2), ...side(p0, off + w / 2)]).fill({ color: colour, alpha });
            }
          };
          if (j.kind === "sewer") {
            // The scar of the filled trench till it is rolled; the open trench between the cut and the filling, its far
            // wall lit, stone bedded along its floor once it is shored; and its spoil in a ridge on the far side.
            strip(f[SEWER.roll], f[SEWER.fill], 0.58, 0, SCAR, 0.9);
            strip(f[SEWER.fill], f[SEWER.cut], 0.6, 0, TRENCH);
            strip(f[SEWER.fill], f[SEWER.cut], 0.12, -0.24, TRENCH_SIDE);
            strip(f[SEWER.fill], f[SEWER.shore], 0.3, 0.06, 0x8f8b84);
            strip(f[SEWER.fill], f[SEWER.cut], 0.2, -0.5, SPOIL);
            strip(f[SEWER.fill], f[SEWER.cut], 0.08, -0.53, SPOIL_TOP);
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
        if (j.kind !== "dredge") layMain(g, j, w, dt, scale, P, place, seenM);
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
