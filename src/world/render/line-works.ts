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
import { LINE_GAPS, LINE_LAYS, LINE_PACE, LINE_STAGES, MAIN, SEWER, alongLine, lineFront, type LineJob } from "../lines/jobs";
import type { BandLayer } from "./bands";
import { bakedProps, propSprite, propSprites, propsLoaded } from "../props/props-sheet";
import { BLUE, DIG, DIG_ALL, DRUM, M, T, YELLOW, makeUnit, mixerLook, poseUnit, type Unit } from "./plant-kit";
import { walkRound, type Walker } from "./road-plant";
import { destroyPipeDrawable, pipeDrawable } from "./pipe-gpu";
import { BEND_R, CHEEK, CONCRETE, MATERIAL, SADDLE, ZT, box as meshBox, elbowPath, flange, footing, made, pipeMesh, solid, sweep, tube as meshTube } from "./pipe-mesh";
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
/**
 * A LOOSE ELBOW, as a main's bend is made: the very sweep of a cell's bend (@see pipe-mesh `bendPath`) from the face
 * it comes in at (`a`, the way to the cell before) to the face it leaves by (`b`), a flange at each. About the
 * cell's own middle.
 */
function elbowMesh(a: { dx: number; dy: number }, b: { dx: number; dy: number }, scale: number, look: PipeStuff): Mesh<Geometry, Shader> {
  const m = pipeMesh(), path = elbowPath(0, 0, 0, { ...a, zf: 0 }, { ...b, zf: 0 }, 12);
  // (Its far face's flange behind it, its near face's before it.)
  const ends = [a, b].sort((p, q) => p.dx + p.dy - (q.dx + q.dy));
  flange(m, scale, ends[0].dx * 0.5, ends[0].dy * 0.5, 0, ends[0].dx, ends[0].dy, look.r, look.colour, 14, true, false);
  made(look.mat, () => sweep(m, scale, path, look.r, solid(look.colour), 14));
  flange(m, scale, ends[1].dx * 0.5, ends[1].dy * 0.5, 0, ends[1].dx, ends[1].dy, look.r, look.colour, 14, true, false);
  return pipeDrawable(m);
}
/**
 * A MAIN'S SADDLE, before its main: the very footing and block the main will lie in (@see pipe-mesh `saddle`) —
 * short along the tube, its cheeks out past it; square under a bend. About its own middle, on the ground.
 */
function saddleMesh(along: "u" | "v" | null, scale: number, r: number): Mesh<Geometry, Shader> {
  const m = pipeMesh(), du = along === "u" ? SADDLE / 2 : r * CHEEK, dv = along === "v" ? SADDLE / 2 : r * CHEEK;
  const top = footing(m, scale, -du, -dv, du, dv, 0);
  made(MATERIAL.concrete, () => meshBox(m, scale, -du, -dv, top, du, dv, LIFT * ZT - r * 0.15, solid(CONCRETE)));
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
  type Laying = { /** The job's pieces in order and its haul track, worked out once. */ plan?: { key: string; pieces: unknown[]; pts: { x: number; y: number }[]; cum: number[]; uCell: number[]; turnAt: number; load: number }; g: Graphics; band: number; stood: Map<number, Graphics>; /** What of that stands NEARER than a length down in a trench: the near sheet of its shoring, drawn over the length. */ front: Map<number, Graphics>; stoodKey: string; hands: Map<string, Hand>; pegs: Container[]; pegged: string; /** Its loose lengths, each the real tube: on the lorry, on their skids, in the slings, set and waiting to be made one with the run. */ loose: Map<string, { mesh: Mesh<Geometry, Shader>; key: string; band: number }> };
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
    placeAt: (name: string, x: number, y: number, heading: number, h: number, looks: { look: string; tint: number; heading?: number }[]) => Unit | null,
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
    const FAR = -1, NEAR = 1, CRANE_AT = 0.45 * NEAR, PLINTH = LIFT - 0.34;
    /** Where a length lies when it is set: on its plinths, the main's own height; or down in the trench. */
    const SET_Z = under ? -0.25 * R_HS : LIFT;
    /** A cell's SADDLE: where it stands (a bend's, under the middle of its curve), which way its tube runs, its half sizes. */
    const saddleOf = (c: number) => {
      const k = j.cells[c], a = j.cells[Math.max(0, c - 1)], b = j.cells[Math.min(n - 1, c + 1)];
      const ax = a.x - k.x, ay = a.y - k.y, bx = b.x - k.x, by2 = b.y - k.y;
      const bent = c > 0 && c < n - 1 && (ax + bx !== 0 || ay + by2 !== 0), o = bent ? BEND_R * (1 - Math.SQRT1_2) : 0;
      const along: "u" | "v" | null = bent ? null : (ax || bx) !== 0 ? "u" : "v";
      return { x: k.x + (ax + bx) * o, y: k.y + (ay + by2) * o, along, hx: along === "u" ? SADDLE / 2 : stuff.r * CHEEK, hy: along === "v" ? SADDLE / 2 : stuff.r * CHEEK, i: idx(g, k.x, k.y) };
    };
    /** A loose length at a place by the line, `z` half steps over the ground there: the real tube, kept by name. */
    const seenL = new Set<string>();
    /** A loose piece of the main at a place, `z` half steps over ground `h` there: the real tube, kept by name. */
    const piece = (name: string, key: string, make: () => Mesh<Geometry, Shader>, px: number, py: number, h: number, z: number, lift: number) => {
      let q = M_.loose.get(name);
      if (q && q.key !== key) { destroyPipeDrawable(q.mesh); M_.loose.delete(name); q = undefined; }
      if (!q) { q = { mesh: make(), key, band: -1 }; M_.loose.set(name, q); }
      seenL.add(name);
      const [x, y] = pt(scale, px, py, h + z), band = Math.max(0, Math.min(bands.dynamicOf.length - 1, bandOf(Math.round(px), Math.round(py))));
      q.mesh.position.set(x, y);
      const zi = px + py - band + lift;
      if (band !== q.band || !q.mesh.parent) { q.mesh.zIndex = zi; bands.dynamicOf[band]?.addChild(q.mesh); q.band = band; }
      else if (Math.abs(q.mesh.zIndex - zi) > 0.04) q.mesh.zIndex = zi;
      return { x, y };
    };
    type Slung = { x: number; y: number; at: { x: number; y: number }; ends: [number, number][] };
    const lengthAt = (name: string, a: { x: number; y: number; heading: number }, h: number, z: number, lift: number): Slung => {
      const alongU = Math.abs(Math.cos(a.heading)) > 0.5, ch = Math.cos(a.heading), sh = Math.sin(a.heading);
      const at = piece(name, `${alongU}|${scale}|${stuff.id}`, () => lengthMesh(alongU, scale, stuff), a.x, a.y, h, z, lift);
      return { ...at, at: a, ends: [[ch * LENGTH * 0.36, sh * LENGTH * 0.36], [-ch * LENGTH * 0.36, -sh * LENGTH * 0.36]] };
    };
    /**
     * A BEND of the line, at its cell `k`: the ways to the cell before and the cell after; and the corner of what
     * runs beside the line there — `across` to its side on both legs — which is the bend's middle moved by `mitre`
     * times that. Inside the bend, the near side, or outside it.
     */
    const bendAt = (k: number) => {
      if (k <= 0 || k >= n - 1) return null;
      const c = j.cells[k], a = { dx: j.cells[k - 1].x - c.x, dy: j.cells[k - 1].y - c.y }, b = { dx: j.cells[k + 1].x - c.x, dy: j.cells[k + 1].y - c.y };
      if (a.dx + b.dx === 0 && a.dy + b.dy === 0) return null;
      // (The way it goes in is -a, out is b; a side of a way (dx, dy) is (-dy, dx).)
      const mitre = { x: a.dy - b.dy, y: -a.dx + b.dx }, inside = (a.dy * b.dx - a.dx * b.dy) * NEAR > 0;
      return { c, a, b, mitre, inside, out: { x: -b.dy, y: b.dx } };
    };
    const elbow = (name: string, bd: NonNullable<ReturnType<typeof bendAt>>, px: number, py: number, z: number, lift: number): Slung => {
      const at = piece(name, `elbow|${bd.a.dx},${bd.a.dy},${bd.b.dx},${bd.b.dy}|${scale}|${stuff.id}`, () => elbowMesh(bd.a, bd.b, scale, stuff), px, py, g.height[idx(g, bd.c.x, bd.c.y)], z, lift);
      return { ...at, at: { x: px, y: py }, ends: [[bd.a.dx * 0.36, bd.a.dy * 0.36], [bd.b.dx * 0.36, bd.b.dy * 0.36]] };
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
        const bd = c < n ? bendAt(c) : null;
        if (bd) {
          // ROUND A BEND the line turns with the main: a stake at its corner, and the line along each leg to it — longer
          // round the outside of the bend, shorter inside it.
          const PEG = 0.4 * FAR, outside = bd.inside;
          put("stake", (c + 2) & 3, bd.c.x + bd.mitre.x * PEG, bd.c.y + bd.mitre.y * PEG);
          for (const [l, sx, sy] of [[bd.a, bd.a.dy, -bd.a.dx], [bd.b, -bd.b.dy, bd.b.dx]] as const) {
            if (!outside) continue;
            for (const along of [0.25, -0.15]) put("tape", l.dx !== 0 ? 0 : 1, bd.c.x + l.dx * along + sx * PEG, bd.c.y + l.dy * along + sy * PEG);
          }
        } else if (c < n) { const b = by(c + 0.5, 0.4 * FAR); for (const half of [-0.25, 0.25]) put("tape", Math.abs(Math.cos(b.heading)) > 0.5 ? 0 : 1, b.x + Math.cos(b.heading) * half, b.y + Math.sin(b.heading) * half); }
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
        // NOTHING where the main will stand on none: on a road, where it rides a frame or lies on the paving.
        const sd = saddleOf(c);
        if (!g.paved[sd.i]) {
        // The pit, growing, the shape of the footing to come; its spoil thrown up beside it.
        box(sd.x, sd.y, (sd.hx + 0.07) * (0.5 + 0.5 * foot), (sd.hy + 0.07) * (0.5 + 0.5 * foot), 0, 0.015, h, pour > 0.35 ? 0x8d9296 : 0x3a2a1c, 0x3a2a1c, 0x3a2a1c);
        const sp = by(c + 0.5, 0.3 * NEAR);
        box(sp.x, sp.y, 0.07 * foot, 0.07 * foot, 0, 0.16 * foot, h, 0xa98660, 0x8b6a47, 0x6f5338);
        if (pour > 0 && pour < 1) {
          // FORMWORK round it, ply, the saddle's own shape; the concrete rising in it. Struck when it is up — and what
          // stands then is the main's very saddle. @see below, saddleMesh
          const up = Math.max(0, Math.min(1, (pour - 0.35) / 0.55));
          if (up > 0) box(sd.x, sd.y, sd.hx, sd.hy, 0, (PLINTH + 0.04) * up, h, 0x8d9296, 0x8d9296, 0x7b8084);
          box(sd.x - sd.hx - 0.012, sd.y, 0.012, sd.hy + 0.024, 0, PLINTH + 0.06, h, 0xb9a070, 0xd8c08f, 0xb39a68);
          box(sd.x, sd.y - sd.hy - 0.012, sd.hx + 0.024, 0.012, 0, PLINTH + 0.06, h, 0xb9a070, 0xd8c08f, 0xb39a68);
          box(sd.x + sd.hx + 0.012, sd.y, 0.012, sd.hy + 0.024, 0, PLINTH + 0.06, h, 0xb9a070, 0xd8c08f, 0xb39a68);
          box(sd.x, sd.y + sd.hy + 0.012, sd.hx + 0.024, 0.012, 0, PLINTH + 0.06, h, 0xb9a070, 0xd8c08f, 0xb39a68);
        }
        }
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
      // From one pit to the next it pulls out, runs along the line and backs in: it is never lifted from one to the other.
      const mv = c > 0 ? (() => { const q = Math.max(0, Math.min(1, fr / 0.3)); return q * q * (3 - 2 * q); })() : 1, sw = Math.sin(Math.PI * mv);
      place("mixer", c - 0.5 + mv, [{ look: mixerLook(w, pouring), tint: DRUM }], (Math.PI / 2) * FAR * (1 - sw), (0.6 + 0.4 * sw) * FAR);
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
    // ── THE PIPE GOES IN A PIECE AT A TIME, OFF LORRIES THAT NEVER LEAVE THE JOB ──
    // The pipe runs from the middle of its first tile to the middle of its last — as the main does — so its pieces
    // are the halves of THAT, two to a tile, and a bend's ELBOW for the two that meet in its cell.
    // A few lorries work the job from first to last, round a HAUL TRACK beside the line: each is loaded with three
    // pieces off the stack at the LAYDOWN behind the line's start, drives up the track, waits its turn, draws up
    // outside the CRANE and stands while the crane takes its pieces one at a time — hooked on the bed, lifted,
    // slewed round over the crane's own front and lowered onto the saddles — then pulls on, turns, and drives back
    // down the far side of the track for more. Where each is, is worked out from how far the pipe has got: nothing
    // appears and nothing is taken away, and a job that stands, stands with them where they were.
    const lengths = Math.max(0, 2 * (n - 1)), setRaw = j.t / LINE_PACE[j.kind] - LINE_LAYS[j.kind] * LINE_GAPS[j.kind];
    type Piece = { i: number; bd: ReturnType<typeof bendAt>; p: number; turns: number };
    const ease = (v: number) => { const q = Math.max(0, Math.min(1, v)); return q * q * (3 - 2 * q); };
    /** Pieces a lorry brings; how far a lorry's bed is behind its middle; the gap in a queue; when the hook lets go. */
    const PER = 3, BED_BACK = 0.12, GAP = 0.95, UNHOOK = 0.66, HOOKED = 0.1;
    /** The haul track: its middle so far from the line, its lanes so far either side of that, lorries so close parked. */
    const TRACK = 1.3, LANE = 0.36, ROW = 0.62;
    const lorries = Math.max(3, Math.min(6, Math.ceil(2.8 + n / 9)));
    let plan = M_.plan;
    if (!plan || plan.key !== `${n}|${lorries}|${j.cells[0].x},${j.cells[0].y}|${j.cells[n - 1].x},${j.cells[n - 1].y}`) {
      const pieces: Piece[] = [];
      for (let i = 0; i < lengths; i++) {
        const k = Math.round((i + 0.5) / 2), bd = bendAt(k);
        if (!bd) pieces.push({ i, bd: null, p: (i + 1.5) / 2, turns: 1 });
        else if (i === 2 * k - 1) pieces.push({ i, bd, p: k + 0.5, turns: 2 });
      }
      // THE TRACK'S MIDDLE: from the laydown, behind the line's start, up beside every tile of the line — round the
      // outside or the inside of each bend — and on a little past its end; its corners rounded.
      const way = (k: number) => { const a = j.cells[Math.max(0, k - 1)], b = j.cells[Math.min(n - 1, k + 1)], l = Math.hypot(b.x - a.x, b.y - a.y) || 1; return { x: (b.x - a.x) / l, y: (b.y - a.y) / l }; };
      const d0 = way(0), dn = way(n - 1), turnAt = 0.5, load = turnAt + 0.5 + ROW * lorries, back = load + 0.6 + GAP + 0.4;
      let pts: { x: number; y: number }[] = [];
      const first = { x: j.cells[0].x - d0.y * TRACK * NEAR, y: j.cells[0].y + d0.x * TRACK * NEAR };
      for (const q of [1, 0.66, 0.33]) pts.push({ x: first.x - d0.x * back * q, y: first.y - d0.y * back * q });
      for (let k = 0; k < n; k++) {
        const bd = bendAt(k), d = way(k);
        pts.push(bd ? { x: bd.c.x + bd.mitre.x * TRACK * NEAR, y: bd.c.y + bd.mitre.y * TRACK * NEAR } : { x: j.cells[k].x - d.y * TRACK * NEAR, y: j.cells[k].y + d.x * TRACK * NEAR });
      }
      const last = pts[pts.length - 1];
      pts.push({ x: last.x + dn.x * 1.2, y: last.y + dn.y * 1.2 }, { x: last.x + dn.x * 2.4, y: last.y + dn.y * 2.4 });
      for (let it = 0; it < 2; it++) {
        const o = [pts[0]];
        for (let k = 0; k + 1 < pts.length; k++) { const a = pts[k], b = pts[k + 1]; o.push({ x: a.x * 0.75 + b.x * 0.25, y: a.y * 0.75 + b.y * 0.25 }, { x: a.x * 0.25 + b.x * 0.75, y: a.y * 0.25 + b.y * 0.75 }); }
        o.push(pts[pts.length - 1]);
        pts = o;
      }
      const cum = [0];
      for (let k = 1; k < pts.length; k++) cum.push(cum[k - 1] + Math.hypot(pts[k].x - pts[k - 1].x, pts[k].y - pts[k - 1].y));
      // (Where along it each tile of the line is abreast: straight tiles by their own place, never going back.)
      const uCell: number[] = [];
      let from = 0;
      for (let k = 0; k < n; k++) {
        const bd = bendAt(k), d = way(k), cx = bd ? bd.c.x + bd.mitre.x * TRACK * NEAR : j.cells[k].x - d.y * TRACK * NEAR, cy = bd ? bd.c.y + bd.mitre.y * TRACK * NEAR : j.cells[k].y + d.x * TRACK * NEAR;
        let best = from, bestD = Infinity;
        for (let q = from; q < pts.length; q++) { const dd = (pts[q].x - cx) ** 2 + (pts[q].y - cy) ** 2; if (dd < bestD) { bestD = dd; best = q; } else if (dd > bestD + 4) break; }
        uCell.push(cum[best]);
        from = best;
      }
      plan = M_.plan = { key: `${n}|${lorries}|${j.cells[0].x},${j.cells[0].y}|${j.cells[n - 1].x},${j.cells[n - 1].y}`, pieces, pts, cum, uCell, turnAt, load };
    }
    const PL = plan, pieces = PL.pieces as Piece[], total = pieces.length, trips = Math.ceil(total / PER);
    /** A place on the track: so far along its middle, so far to its side — towards the line, less than nought. */
    const onTrack = (u: number, side: number) => {
      const at = (v: number) => {
        const q = Math.max(0, Math.min(PL.cum[PL.cum.length - 1], v));
        let lo = 0, hi = PL.cum.length - 1;
        while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (PL.cum[mid] <= q) lo = mid; else hi = mid; }
        const fr = (q - PL.cum[lo]) / Math.max(1e-6, PL.cum[hi] - PL.cum[lo]);
        return { x: PL.pts[lo].x + (PL.pts[hi].x - PL.pts[lo].x) * fr, y: PL.pts[lo].y + (PL.pts[hi].y - PL.pts[lo].y) * fr };
      };
      const c = at(u), a = at(u - 0.3), b = at(u + 0.3), heading = Math.atan2(b.y - a.y, b.x - a.x);
      return { x: c.x - Math.sin(heading) * side * NEAR, y: c.y + Math.cos(heading) * side * NEAR, heading };
    };
    /** How far along the track a place along the line is abreast of. */
    const uOf = (p: number) => { const q = Math.max(0, Math.min(n - 1, p - 0.5)), k = Math.min(n - 2, Math.floor(q)); return n < 2 ? PL.uCell[0] : PL.uCell[k] + (PL.uCell[k + 1] - PL.uCell[k]) * (q - k); };
    const cellH = (x: number, y: number) => { const cx = Math.max(0, Math.min(g.w - 1, Math.round(x))), cy = Math.max(0, Math.min(g.h - 1, Math.round(y))); return g.height[idx(g, cx, cy)]; };

    // WHERE THE WORK IS: which piece is the crane's, and how far through its turn; the trip that piece came on.
    const turnF = f[MAIN.set] * 2 - 1, turn = Math.floor(turnF);
    let ci = -1;
    if (turn >= 0 && total) { let lo = 0, hi = total - 1; while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (pieces[mid].i <= turn) lo = mid; else hi = mid - 1; } if (turn < pieces[lo].i + pieces[lo].turns) ci = lo; }
    const cur = ci >= 0 ? pieces[ci] : null, lf = cur ? (turnF - cur.i) / cur.turns : 0;
    /** How many pieces along the work is, and a fraction: before the first, how long till it; after the last, how long since. */
    const sigma = cur ? ci + lf : turn < 0 ? Math.min(-1e-3, setRaw * 2 - 1) : total + Math.max(0, setRaw * 2 - 1 - lengths);
    const tau = sigma / PER;
    /** Where the crane stands for a trip's pieces: abreast of the middle of them. */
    const craneP = (trip: number) => { const a = pieces[Math.max(0, Math.min(total - 1, trip * PER))], b = pieces[Math.max(0, Math.min(total - 1, trip * PER + PER - 1))]; return (a.p + b.p) / 2; };
    const tripNow = Math.max(0, Math.min(trips - 1, Math.floor(Math.max(0, tau)))), sNow = tau - tripNow;
    // (It moves up between trips, while one lorry pulls away and the next draws up.)
    const MOVE0 = 0.9, MOVE1 = 0.995;
    const craneU = total ? uOf(craneP(tripNow)) + (uOf(craneP(Math.min(trips - 1, tripNow + 1))) - uOf(craneP(tripNow))) * ease((sNow - MOVE0) / (MOVE1 - MOVE0)) : 0;
    const setShown = (q: Piece) => (under ? q.p > f[SEWER.fill] : q.p > laid - 0.5);
    const put = (q: Piece, at: { x: number; y: number; heading: number }, h: number, z: number, lift: number): Slung =>
      q.bd ? elbow(`l${q.i}`, q.bd, at.x, at.y, z, lift) : lengthAt(`l${q.i}`, at, h, z, lift);
    const setAt = (q: Piece) => (q.bd ? { x: q.bd.c.x, y: q.bd.c.y, heading: 0 } : by(q.p));
    /** A piece's place on its lorry's bed: the `b`th of them — two side by side, and one on the two. */
    const onBed = (lorry: { x: number; y: number; heading: number }, b: number) => {
      const ch = Math.cos(lorry.heading), sh = Math.sin(lorry.heading), off = b < 2 ? (b - 0.5) * 0.13 : 0;
      return { x: lorry.x - ch * BED_BACK - sh * off, y: lorry.y - sh * BED_BACK + ch * off, heading: lorry.heading, z: (b < 2 ? 1.25 : 1.95) * M + R_HS };
    };
    /** The laydown: where a lorry stands to be loaded, the stack it is loaded from, and the machine that loads it. */
    const loadAt = onTrack(PL.load, -LANE), stackAt = onTrack(PL.load, -LANE - 0.46), loaderAt = onTrack(PL.load + 0.75, -LANE - 0.55);

    // ── EVERY LORRY, where it is in its round ──
    // A round, in trips (a trip is the time the crane takes over one lorry's pieces): loaded; up the track; a place
    // back in the queue, then drawn up at the crane; stood while it is unloaded; on, round, and back; round again
    // at the laydown and up to the stack.
    const T_LOAD = 0.5, T_LEAVE = 0.8, T_ON = 0.88, T_ROUND = 1.04, T_HOME = T_ROUND + (lorries - 2.88) / 2, T_IN = T_HOME + 0.16, T_END = T_IN + 0.1;
    const rowU = (slot: number) => PL.load - ROW * (slot + 1);
    const slotU = (trip: number) => uOf(craneP(Math.max(0, Math.min(trips - 1, trip))));
    const beds = new Map<number, { x: number; y: number; heading: number }>();
    let loading: { x: number; y: number } | null = null;
    for (let l = 0; l < lorries && total; l++) {
      // (Its trip: the one it is on its way with, standing with, or coming back from.)
      const trip = l + lorries * Math.ceil((tau - T_END - l) / lorries + 1e-9), s = tau - trip;
      let at: { x: number; y: number; heading: number };
      const parked = (slot: number) => onTrack(rowU(slot), -LANE);
      const lastOf = (t: number) => t - Math.max(0, trips - lorries);
      if (trip < 0) at = parked(l);
      else if (trip >= trips) at = parked(trip - lorries < 0 ? l : lastOf(trip - lorries));
      else if (s < 0) {
        // LOADED, from where it was parked or had come round to; up the track; into the queue; up to the crane.
        const s0 = T_END - lorries, fromU = trip < lorries ? rowU(l) : PL.load, here = slotU(trip), behind = slotU(trip - 1) - GAP;
        if (s < s0 + 0.08) at = onTrack(fromU + (PL.load - fromU) * ease((s - s0) / 0.08), -LANE);
        else if (s < s0 + 0.08 + T_LOAD) at = loadAt;
        else if (s < -1) at = onTrack(PL.load + (Math.max(PL.load, behind) - PL.load) * ease((s - (s0 + 0.08 + T_LOAD)) / Math.max(1e-6, -1 - (s0 + 0.08 + T_LOAD))), -LANE);
        else at = onTrack(Math.max(PL.load, behind) + (here - Math.max(PL.load, behind)) * ease((s + 1 - MOVE0 - 0.02) / (MOVE1 - MOVE0)), -LANE);
        // ITS PIECES ON ITS BED, as they are put there. (The first loaded lies lowest; the crane takes the top one first.)
        const count = Math.min(PER, total - trip * PER);
        for (let q = 0; q < count; q++) {
          const pc = pieces[trip * PER + q], b = count - 1 - q, t0 = s0 + 0.08 + T_LOAD * (b + 0.1) / PER, t1 = s0 + 0.08 + T_LOAD * (b + 0.75) / PER;
          if (s < t0) continue;
          const bed = onBed(at, b), go = ease((s - t0) / (t1 - t0));
          if (go < 1) { const x = stackAt.x + (bed.x - stackAt.x) * go, y = stackAt.y + (bed.y - stackAt.y) * go; put(pc, { x, y, heading: bed.heading }, cellH(x, y), 0.5 + R_HS + (bed.z - 0.5 - R_HS) * go + 1.1 * Math.sin(Math.PI * go), 0.5); loading = { x, y }; }
          else put(pc, bed, cellH(at.x, at.y), bed.z, 0.4);
        }
      } else {
        const here = slotU(trip), end = trip + lorries >= trips, homeU = end ? rowU(lastOf(trip)) : PL.load;
        if (s < T_LEAVE) at = onTrack(here, -LANE);
        else if (s < T_ON) at = onTrack(here + 1.0 * ease((s - T_LEAVE) / (T_ON - T_LEAVE)), -LANE);
        else if (s < T_ROUND) {
          // ROUND, beyond the crane: out of the near lane, across the track and into the far one, facing back.
          const c = onTrack(here + 1.0, 0), th = Math.PI * ease((s - T_ON) / (T_ROUND - T_ON)), nx = -Math.sin(c.heading) * NEAR, ny = Math.cos(c.heading) * NEAR;
          at = { x: c.x + (-nx * Math.cos(th) + Math.cos(c.heading) * Math.sin(th)) * LANE, y: c.y + (-ny * Math.cos(th) + Math.sin(c.heading) * Math.sin(th)) * LANE, heading: c.heading + th * NEAR };
        } else if (s < T_HOME) { const q = onTrack(here + 1.0 + (PL.turnAt - here - 1.0) * ease((s - T_ROUND) / (T_HOME - T_ROUND)), LANE); at = { ...q, heading: q.heading + Math.PI }; }
        else if (s < T_IN) {
          // ROUND AGAIN, at the laydown: back into the near lane, facing up the track.
          const c = onTrack(PL.turnAt, 0), th = Math.PI * ease((s - T_HOME) / (T_IN - T_HOME)), nx = -Math.sin(c.heading) * NEAR, ny = Math.cos(c.heading) * NEAR;
          at = { x: c.x + (nx * Math.cos(th) - Math.cos(c.heading) * Math.sin(th)) * LANE, y: c.y + (ny * Math.cos(th) - Math.sin(c.heading) * Math.sin(th)) * LANE, heading: c.heading + Math.PI + th * NEAR };
        } else at = onTrack(PL.turnAt + (homeU - PL.turnAt) * ease((s - T_IN) / (T_END - T_IN)), -LANE);
        // WHAT IS STILL ON ITS BED, at the crane: the pieces whose turn has not come, and the one not yet lifted.
        const count = Math.min(PER, total - trip * PER);
        for (let q = 0; q < count; q++) {
          const m = trip * PER + q;
          if (m > ci && ci >= 0 || (m === ci && lf < HOOKED)) put(pieces[m], onBed(at, count - 1 - q), cellH(at.x, at.y), onBed(at, count - 1 - q).z, 0.4);
        }
        if (s < T_LEAVE) beds.set(trip, at);
      }
      placeAt(`lorry${l}`, at.x, at.y, at.heading, cellH(at.x, at.y), [{ look: "flatbed", tint: BLUE }]);
    }
    // ── THE LAYDOWN: what is left of the pipe, stacked; and the machine that loads it, turned to what it has hold of ──
    if (total) {
      const left = Math.max(0, Math.min(5, total - Math.max(0, Math.floor(tau + lorries - T_END + 1)) * PER));
      for (let q = 0; q < left; q++) {
        const row = q < 3 ? 0 : 1, off = row ? (q - 3.5) * 0.14 : (q - 1) * 0.14;
        lengthAt(`stk${q}`, { x: stackAt.x - Math.sin(stackAt.heading) * off, y: stackAt.y + Math.cos(stackAt.heading) * off, heading: stackAt.heading }, cellH(stackAt.x, stackAt.y), 0.07 + R_HS + row * R_HS * 1.75, 0.05 + row * 0.02);
      }
      const face = loading ? Math.atan2(loading.y - loaderAt.y, loading.x - loaderAt.x) : Math.atan2(stackAt.y - loaderAt.y, stackAt.x - loaderAt.x);
      placeAt("loader", loaderAt.x, loaderAt.y, loaderAt.heading, cellH(loaderAt.x, loaderAt.y), [{ look: "exTracks", tint: YELLOW }, { look: "exLift", tint: YELLOW, heading: face }]);
    }
    // ── THE PIECES IN, and the one in the slings ──
    let load: Slung | null = null, boom = 0, far = CRANE_REACH[0] * T;
    const cr = total ? onTrack(craneU, -(TRACK - CRANE_AT * NEAR)) : null;
    for (let q = Math.max(0, ci < 0 && turn >= 0 ? total - 40 : 0); q < total; q++) {
      const pc = pieces[q];
      if (pc.i < 2 * Math.floor(under ? f[SEWER.fill] : laid) - 5) continue;
      if (ci >= 0 ? q > ci || (q === ci && lf < UNHOOK) : turn < 0) break;
      // (Set, it shows until it is part of the run — or, in a trench, until the trench is filled over it.)
      if (setShown(pc)) put(pc, setAt(pc), hAt(pc.p), SET_Z, under ? 0.1 : 0.3);
    }
    if (cur && cr) {
      // Where it is picked from — its place on the bed of the lorry drawn up outside the crane — and where it is
      // set; round the crane from one to the other, over its front.
      const trip = Math.floor(ci / PER), lorry = beds.get(trip) ?? onTrack(slotU(trip), -LANE), count = Math.min(PER, total - trip * PER);
      const from = onBed(lorry, count - 1 - (ci - trip * PER)), to = setAt(cur);
      const a0 = Math.atan2(from.y - cr.y, from.x - cr.x), a1 = Math.atan2(to.y - cr.y, to.x - cr.x), r0 = Math.hypot(from.x - cr.x, from.y - cr.y), r1 = Math.hypot(to.x - cr.x, to.y - cr.y);
      let sweepBy = a1 - a0;
      while (sweepBy * NEAR > 0) sweepBy -= 2 * Math.PI * NEAR;
      while (sweepBy * NEAR <= -2 * Math.PI) sweepBy += 2 * Math.PI * NEAR;
      // (Hooked on; lifted, slewed and lowered; unhooked; and the boom back round, empty, for the next.)
      const carry = ease((lf - HOOKED) / 0.5), back = ease((lf - 0.72) / 0.26), on = lf < UNHOOK ? carry : 1 - back;
      boom = a0 + sweepBy * on;
      far = r0 + (r1 - r0) * on;
      if (lf >= HOOKED && lf < UNHOOK) load = put(cur, { x: cr.x + Math.cos(boom) * far, y: cr.y + Math.sin(boom) * far, heading: to.heading }, hAt(cur.p), from.z + (SET_Z - from.z) * carry + 1.5 * Math.sin(Math.PI * carry), 0.5);
    } else if (cr) boom = cr.heading + (Math.PI / 2) * NEAR;
    // ── THE CRANE, on its outriggers beside the line, and a banksman to see each piece in ──
    if (cr) {
      const p = cur ? cur.p : turn < 0 ? 0.5 : n - 0.5;
      const rk2 = CRANE_REACH.reduce((best, r0, q) => (Math.abs(r0 * T - far) < Math.abs(CRANE_REACH[best] * T - far) ? q : best), 0);
      placeAt("crane", cr.x, cr.y, cr.heading, cellH(cr.x, cr.y), [{ look: "craneCarrier", tint: YELLOW }, { look: CRANE_LOOKS[rk2], tint: YELLOW, heading: boom }]);
      // THE ROPE from the boom's head down to the hook: over the load, slings from it to the piece's two ends; or empty.
      const reach = Math.min(far, CRANE_REACH[CRANE_REACH.length - 1] * T);
      const tip = pt(scale, cr.x + Math.cos(boom) * reach, cr.y + Math.sin(boom) * reach, cellH(cr.x, cr.y) + craneTip(CRANE_REACH[rk2]) * M);
      const lw = Math.max(0.6, 0.55 * scale);
      if (load) {
        const r = stuff.r * HW * Math.SQRT2 * scale, hook: [number, number] = [load.x, load.y - r - 9 * scale];
        G.moveTo(tip[0], tip[1]).lineTo(hook[0], hook[1]).stroke({ color: 0x1f2226, width: lw });
        G.rect(hook[0] - 1.6 * scale, hook[1] - 2 * scale, 3.2 * scale, 4 * scale).fill({ color: 0xe9a71b });
        for (const [ox, oy] of load.ends) { const ex = (ox - oy) * HW * scale, ey = (ox + oy) * HH * scale; G.moveTo(hook[0], hook[1] + 2 * scale).lineTo(load.x + ex, load.y + ey - r).stroke({ color: 0x1f2226, width: lw }); }
      } else {
        const hook = pt(scale, cr.x + Math.cos(boom) * reach, cr.y + Math.sin(boom) * reach, cellH(cr.x, cr.y) + 2.6);
        G.moveTo(tip[0], tip[1]).lineTo(hook[0], hook[1]).stroke({ color: 0x1f2226, width: lw });
        G.rect(hook[0] - 1.6 * scale, hook[1] - 2 * scale, 3.2 * scale, 4 * scale).fill({ color: 0xe9a71b });
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
    // THE SADDLES, struck and standing till the main's own layer has them: the main's very footing and block.
    if (!under) for (let c = laid; c < n && f[MAIN.pour] - c >= 1; c++) {
      const sd = saddleOf(c);
      if (g.paved[sd.i]) continue;
      const name = `s${c}`, key = `saddle|${sd.along}|${scale}|${stuff.id}`;
      let q = M_.loose.get(name);
      if (q && q.key !== key) { destroyPipeDrawable(q.mesh); M_.loose.delete(name); q = undefined; }
      if (!q) { q = { mesh: saddleMesh(sd.along, scale, stuff.r), key, band: -1 }; M_.loose.set(name, q); }
      seenL.add(name);
      const [x, y] = pt(scale, sd.x, sd.y, g.height[sd.i]), band = Math.max(0, Math.min(bands.dynamicOf.length - 1, bandOf(Math.round(sd.x), Math.round(sd.y))));
      q.mesh.position.set(x, y);
      if (band !== q.band || !q.mesh.parent) { q.mesh.zIndex = sd.x + sd.y - band + 0.05; bands.dynamicOf[band]?.addChild(q.mesh); q.band = band; }
    }
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
        const placeAt = (name: string, x: number, y: number, heading: number, h: number, looks: { look: string; tint: number; heading?: number }[]): Unit | null => {
          if (!cars) return null;
          const id = `${j.id}:${name}`;
          let u = units.get(id);
          if (!u) { u = makeUnit(looks.length); units.set(id, u); }
          seen.add(id);
          const base = poseUnit(u, cars, looks, { x, y, z: h, heading, pitch: 0 }, scale, P ? { people: P, id: j.id * 8 + name.length } : null);
          u.band = into(u.c, u.band, x, y, base);
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
        if (j.kind !== "dredge") layMain(g, j, w, dt, scale, P, place, seenM, placeAt);
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
