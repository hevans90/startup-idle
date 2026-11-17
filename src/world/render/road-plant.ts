/**
 * World v2 — THE GANG ON A ROAD BEING BUILT, at work and not just there.
 *
 *  - THE EXCAVATOR digs a bucketful, lifts it, slews right round on its
 *    tracks and tips it into a lorry stood behind it, slews back and digs
 *    again: its tracks one sprite, its house another over them at whatever
 *    heading it has swung to, in three poses of its arm.
 *  - STONE comes off a lorry with its body up, creeping ahead as it tips, and
 *    a roller runs over it behind.
 *  - THE PAVER creeps with its own blacktop in its hopper, the wings folding up
 *    as it empties; blacktop falls from the conveyor's mouth at its back, ahead
 *    of the screed it tows; the mat behind the screed steams; a roller works
 *    it in passes, a lane over each time.
 *  - THE LINING TRUCK last, a puff of white at its tail.
 *  - BEFORE ANY OF IT, THE SETTING OUT: five on foot walk the line as it was
 *    ordered — two driving a peg at every corner, one each side; two behind
 *    them running the tape out peg to peg; one down the middle with a spray
 *    can — and their pickup after them. @see roads/jobs setOutAt
 *  - SIX IN HI-VIS, each walking a round of their own: two raking behind the
 *    screed, one shovelling between the hopper and the mat's edge, a banksman
 *    at the lorry's cab, one walking the roller's edge, the foreman.
 *
 * From the vehicles' sheet and the people's; moved BY TRANSFORM, a unit
 * changing parent only as it crosses into another band. All of it stands
 * still while the job stands for want of a load. @see roads/jobs frontAt
 */
import { Container, Graphics, Sprite } from "pixi.js";

import { bakedCars, loadCarSprites, type CarSprites } from "../agents/cars/car-sheet";
import { bakedPeople, peopleLoaded, peopleSprites, posePerson } from "../agents/people/people-sheet";
import { idx, type Grid } from "../grid";
import { HEIGHT_UNIT, HH, HW, bandOf } from "../iso";
import { PAVER_LOOKS, SPOIL_LOOKS, TIP_LOOKS } from "../agents/cars/models";
import { ARRIVE, GANGS, GAP, PACE, frontAt, setOutAt, setOutSeconds, type RoadJob } from "../roads/jobs";
import type { BandLayer } from "./bands";
import { ARM, BLUE, DIG, DIG_ALL, EARTH, M, PPM, STONE, T, TAR, YELLOW, drawSpill, makeSpill, makeUnit, poseUnit, type Spill, type Stuff, type Unit } from "./plant-kit";
import { COLUMN, carry, stepPour, type PourRun } from "./pour-sim";

/** The lining truck's white. (The contractor's yellow and the lorries' blue are every site's. @see plant-kit) */
const WHITE = 0xf1f1ee;
const VESTS = [0xf47b20, 0xc8dc32, 0xf47b20, 0xe8e23a, 0xc8dc32, 0xf47b20], HAT = 0xf5c224, SKIN = 0xd9a47a, LEGS = 0x3a4a63;

/** A person's footprint, for which tile they are drawn with. */
const FEET = [{ u: 0.05, v: 0.05 }];
type Hand = { c: Container; parts: Sprite[]; key: string; band: number } & Walker;
type At = { x: number; y: number; z: number; heading: number; pitch: number };

export type RoadPlant = { sync(g: Grid, scale: number, t: number): void; destroy(): void };

/** Where on a job's line a place `p` cells along it is, how high, which way it runs there and how steeply. */
export function alongJob(g: Grid, j: RoadJob, p: number): At {
  const n = j.cells.length, q = Math.max(0, Math.min(n - 1, p)), i = Math.min(n - 1, Math.floor(q)), f = q - i;
  const a = j.cells[i], b = j.cells[Math.min(n - 1, i + 1)], back = j.cells[Math.max(0, i - 1)];
  // On the ground as it is now; on a bridge, at its deck.
  const zOf = (c: typeof a) => (c.deck ? c.z : g.deck[idx(g, c.x, c.y)] !== 0 ? g.deckZ[idx(g, c.x, c.y)] : g.height[idx(g, c.x, c.y)]);
  const dx = b === a ? a.x - back.x : b.x - a.x, dy = b === a ? a.y - back.y : b.y - a.y;
  return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f, z: zOf(a) + (zOf(b) - zOf(a)) * f, heading: Math.atan2(dy, dx), pitch: b === a ? 0 : zOf(b) - zOf(a) };
}

/** A round somebody walks: places to be — tiles along the road from their machine and across it — what they do at each, how long, and which way they face doing it, from the road's own way. */
type Stop = { al: number; ac: number; pose: "work" | "stand"; dwell: number; face: number };
/** Somebody on a round: where they are on the ground — cells along the job, tiles across it — the stop they are at or walking to, whether they are there, and how long they have left there. */
export type Walker = { p?: number; ac?: number; k?: number; there?: boolean; left?: number };
/** Tiles a second somebody walks to keep up with a machine that has moved on, and how far it may get from them before they leave what they are doing and go after it. */
export const STRIDE = 0.34, LEFT_BEHIND = 0.32;
/**
 * A STEP OF SOMEBODY'S ROUND, the machine now at `by` cells along the job.
 * NOBODY RIDES ALONG WITH A MACHINE: at a stop they stand where they stopped,
 * on the ground, while the machine creeps on; when their time there is up, or
 * the machine has got away from them, they WALK to the next place — which is
 * by the machine, wherever it has got to. Says what they are doing and which
 * way they face, from the road's own way.
 */
export function walkRound(h: Walker, round: readonly Stop[], by: number, dt: number, first = 0): { pose: "work" | "stand" | "walk"; face: number } {
  if (h.k === undefined || h.k >= round.length) h.k = first % round.length;
  let stop = round[h.k], tp = by + stop.al;
  if (h.p === undefined || h.ac === undefined) { h.p = tp; h.ac = stop.ac; h.there = true; h.left = stop.dwell; }
  if (h.there) {
    h.left = (h.left ?? 0) - dt;
    const away = Math.hypot(tp - h.p, stop.ac - h.ac) > LEFT_BEHIND;
    if (h.left > 0 && !away) return { pose: stop.pose, face: stop.face };
    // (Either way they are done there: on to the next place.)
    h.there = false;
    h.k = (h.k + 1) % round.length;
  }
  stop = round[h.k]; tp = by + stop.al;
  const dal = tp - h.p, dac = stop.ac - h.ac, far = Math.hypot(dal, dac), go = STRIDE * dt;
  if (far <= go + 1e-4) { h.p = tp; h.ac = stop.ac; h.there = true; h.left = stop.dwell; return { pose: stop.pose, face: stop.face }; }
  h.p += (dal / far) * go; h.ac += (dac / far) * go;
  return { pose: dt > 0 ? "walk" : "stand", face: Math.atan2(dac, dal) };
}
const BACK = Math.PI, LEFT = Math.PI / 2, RIGHT = -Math.PI / 2;
/** The rounds while the paver lays, from the paver: rakers behind the screed, a shoveller, one seeing its line ahead of the hopper, one on the roller's edge, the foreman. */
const LAYING: Stop[][] = [
  [{ al: -0.6, ac: 0.24, pose: "work", dwell: 5, face: BACK }, { al: -0.66, ac: 0.08, pose: "work", dwell: 4, face: BACK }, { al: -0.78, ac: 0.3, pose: "stand", dwell: 1.5, face: BACK }],
  [{ al: -0.64, ac: -0.26, pose: "work", dwell: 6, face: BACK }, { al: -0.7, ac: -0.06, pose: "work", dwell: 3.5, face: BACK }, { al: -0.84, ac: -0.3, pose: "stand", dwell: 2, face: BACK }],
  [{ al: 0.42, ac: 0.42, pose: "work", dwell: 3, face: RIGHT }, { al: -0.55, ac: 0.42, pose: "work", dwell: 3.5, face: RIGHT }, { al: -0.1, ac: 0.44, pose: "stand", dwell: 1, face: RIGHT }],
  [{ al: 0.62, ac: -0.45, pose: "stand", dwell: 6, face: BACK }, { al: 0.5, ac: 0.46, pose: "stand", dwell: 3, face: BACK }],
  [{ al: -1.3, ac: 0.43, pose: "stand", dwell: 3, face: RIGHT }, { al: -2.3, ac: 0.43, pose: "work", dwell: 3, face: RIGHT }, { al: -1.8, ac: 0.44, pose: "stand", dwell: 2, face: RIGHT }],
  [{ al: 0.1, ac: -0.45, pose: "stand", dwell: 8, face: LEFT }, { al: -1.1, ac: -0.45, pose: "stand", dwell: 5, face: LEFT }],
];
/** The rounds while only the digger is at work, from the digger: two trimming the cut behind it, one seeing the lorry back, the foreman with the pegs ahead. */
const DIGGING: Stop[][] = [
  [{ al: -0.25, ac: 0.4, pose: "work", dwell: 5, face: RIGHT }, { al: -0.7, ac: 0.4, pose: "work", dwell: 4, face: RIGHT }],
  [{ al: -0.45, ac: -0.4, pose: "work", dwell: 4.5, face: LEFT }, { al: -0.05, ac: -0.4, pose: "work", dwell: 4, face: LEFT }, { al: -0.3, ac: -0.42, pose: "stand", dwell: 2, face: LEFT }],
  [{ al: -2.1, ac: 0.42, pose: "stand", dwell: 7, face: 0 }, { al: -1.7, ac: 0.43, pose: "stand", dwell: 3, face: 0 }],
  [{ al: 1.5, ac: 0.38, pose: "work", dwell: 3, face: RIGHT }, { al: 2.3, ac: -0.38, pose: "work", dwell: 3, face: LEFT }, { al: 1.2, ac: -0.4, pose: "stand", dwell: 4, face: 0 }],
];

/** A lorry's turn at tipping, seconds: body down as it backs in, up while it tips, down as it pulls off. */
const TIP = { in: 2.5, up: 10, off: 2 }, TIP_ALL = TIP.in + TIP.up + TIP.off;
/** A paver's hopper through a turn, seconds: full and spread, its wings folding up as it empties, held up, and down again. */
/** Where the paver stands, cells past the blacktop's front. */
const PAVER_AT = -0.12;
const FEED = { full: 9, fold: 5, up: 3, down: 2 }, FEED_ALL = FEED.full + FEED.fold + FEED.up + FEED.down;

export function createRoadPlant(bands: BandLayer): RoadPlant {
  const units = new Map<string, Unit>(), hands = new Map<string, Hand>(), spills = new Map<string, Spill>();
  /** Each job's own time at work, seconds: stopped while it stands. */
  const clocks = new Map<number, number>();
  /** Each job's digger's turns of work when the lorry it loads first stood by it: for how many bucketfuls that lorry has had. */
  const since = new Map<number, number>();
  let cars: CarSprites | null = null, asked = false, last = -1;
  const drop = (c: Container) => { c.parent?.removeChild(c); c.destroy({ children: true }); };
  /**
   * FILED AS THE TOWN FILES A VEHICLE: with the tile its foremost corner is over — a lorry half on the next tile is
   * drawn with that one, after its road, not under it — and within that tile by how near the camera it is.
   */
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
    sync(g, scale, t) {
      const dt = last < 0 ? 0 : Math.min(0.1, Math.max(0, t - last));
      last = t;
      const seenU = new Set<string>(), seenH = new Set<string>(), seenS = new Set<string>();
      if (g.roadJobs.length && bakedCars()) {
        if (!cars && !asked) { asked = true; void loadCarSprites().then((s) => { cars = s; }); }
        const P = bakedPeople() ? peopleLoaded() : null;
        if (bakedPeople() && !P) void peopleSprites();
        g.roadJobs.slice(0, GANGS).forEach((j) => {
          if (!cars) return;
          const still = j.stalled > 0, n = j.cells.length, f = [0, 1, 2, 3].map((s) => frontAt(j, s));
          const w = (clocks.get(j.id) ?? j.id * 3.7) + (still ? 0 : dt);
          clocks.set(j.id, w);
          /** A point by a place on the line: so far along the road from it and across it, in tiles, and so high in metres — on the screen, from that place. */
          const off = (h: number, al: number, ac: number, m = 0): [number, number] => {
            const du = Math.cos(h) * al - Math.sin(h) * ac, dv = Math.sin(h) * al + Math.cos(h) * ac;
            return [(du - dv) * HW * scale, (du + dv) * HH * scale - m * M * HEIGHT_UNIT * scale];
          };
          /** A machine at a place: its sprites — one, or tracks and a house — each a look at a heading. What is drawn under and over it is the caller's. */
          const place = (name: string, at: At, looks: { look: string; tint: number; heading?: number }[]): Unit | null => {
            const id = `${j.id}:${name}`;
            let u = units.get(id);
            if (!u) {
              u = makeUnit(looks.length);
              units.set(id, u);
            }
            seenU.add(id);
            const base = poseUnit(u, cars!, looks, at, scale);
            u.band = into(u.c, u.band, at.x, at.y, base);
            return u;
          };
          /**
           * SOMETHING POURED by a machine at `at`: from a lip to where it lands — each so far along the heading `h`
           * and across it, in tiles, and so high, in metres — while `on`. ITS GRAINS ARE REAL: let go, fallen, landed,
           * heaped and slumped by the pour's own simulation, a step a frame whether it pours or not — so the last of
           * it falls and the heap goes on being taken away. Drawn in a layer of its own, with the tile it LANDS on.
           */
          const spill = (name: string, at: At, h: number, from: [number, number, number], to: [number, number, number], stuff: Stuff, width: number, on: boolean, run: PourRun, wall = Infinity, lift = 0.35): void => {
            const id = `${j.id}:${name}`;
            seenS.add(id);
            let sp = spills.get(id);
            if (!sp) {
              sp = makeSpill(stuff, wall);
              spills.set(id, sp);
            }
            const tile = (p: [number, number, number]) => ({ x: at.x + Math.cos(h) * p[0] - Math.sin(h) * p[1], y: at.y + Math.sin(h) * p[0] + Math.cos(h) * p[1], m: p[2] });
            const px = (p: { x: number; y: number; m: number }): [number, number] => [(p.x - p.y) * HW * scale, (p.x + p.y) * HH * scale - at.z * HEIGHT_UNIT * scale - p.m * M * HEIGHT_UNIT * scale];
            const lip = tile(from), land = tile(to), a = px(lip), b = px(land), S = sp.sim;
            S.dx = (b[0] - a[0]) / scale; S.drop = Math.max(2, (b[1] - a[1]) / scale);
            // WHAT HAS LANDED ON THE GROUND STAYS ON THE GROUND: as the machine moves on, its heap is left where it fell —
            // along the road, which on the screen runs aslant, so the ground under the heap does too.
            const run2 = [(Math.cos(h) - Math.sin(h)) * HW, (Math.cos(h) + Math.sin(h)) * HH];
            S.base = Math.abs(run2[0]) > 1 ? run2[1] / run2[0] : 0;
            const across = b[0] / scale;
            if (Number.isNaN(sp.landed)) sp.landed = across;
            if (Math.abs(across - sp.landed) >= COLUMN) { const k = Math.round((across - sp.landed) / COLUMN); carry(S, k * COLUMN); sp.landed += k * COLUMN; }
            stepPour(S, still ? 0 : dt, on && !still, width * PPM, run);
            // FILED WITH THE TILE IT LANDS ON, or its lip's if that is nearer the camera: over that tile's road, not under it.
            const band = Math.max(0, Math.min(bands.dynamicOf.length - 1, Math.max(bandOf(Math.round(land.x), Math.round(land.y)), bandOf(Math.round(lip.x), Math.round(lip.y)))));
            const z = land.x + land.y - band + lift;
            if (band !== sp.band || !sp.c.parent) { sp.c.zIndex = z; bands.dynamicOf[band]?.addChild(sp.c); sp.band = band; }
            else if (Math.abs(sp.c.zIndex - z) > 0.04) sp.c.zIndex = z;
            sp.c.position.set(a[0], a[1]);
            drawSpill(sp.gfx, S, stuff, scale);
          };
          /** Puffs that rise from a point and thin: steam, dust. */
          const puffs = (gfx: Graphics, h: number, al: number, ac: number, m: number, colour: number, count: number, spread: number, rise: number, alpha: number) => {
            for (let q = 0; q < count; q++) {
              const ph = (w * 0.5 + q / count + ((q * 0.618) % 1) * 0.4) % 1, [x, y] = off(h, al + ((q * 0.29) % 1 - 0.5) * 0.12, ac + (count > 1 ? (q / (count - 1) - 0.5) * spread : 0), m);
              gfx.circle(x, y - ph * rise * scale, (3 + ph * 6) * scale).fill({ color: colour, alpha: alpha * (1 - ph) });
            }
          };
          /** A lorry's body through its turn at tipping: whether it is up, and so whether anything comes off it. */
          const tipping = (phase: number) => { const q = ((w + phase) % TIP_ALL + TIP_ALL) % TIP_ALL; return q > TIP.in && q < TIP.in + TIP.up; };
          /** The lorry as it is then: the one lorry, its body level, on up in steps as it rises, right up while it tips, and down again the same way. */
          const tipLook = (phase: number) => {
            const q = ((w + phase) % TIP_ALL + TIP_ALL) % TIP_ALL, rise = 1.2;
            const up = still ? 0 : q < TIP.in ? 1 - (TIP.in - q) / rise : q > TIP.in + TIP.up ? 1 - (q - TIP.in - TIP.up) / rise : 1;
            return TIP_LOOKS[Math.max(0, Math.min(3, Math.round(up * 3)))];
          };

          // ── THE SETTING OUT: who walks the line before it is dug ───────────────────────────
          // There as the order is given, gone when the last of the line is marked.
          const shown = Math.max(0, Math.min(1, j.t / 1.2, (setOutSeconds(j) + 1.5 - j.t) / 1.5));
          if (shown > 0) {
            const so = [0, 1, 2].map((q) => setOutAt(j, q));
            /** A place on the line, or off either end of it: `p` cells along, a cell's middle a whole number. */
            const lineAt = (p: number): At => { const q = Math.max(0, Math.min(n - 1, p)), at = alongJob(g, j, q); at.x += Math.cos(at.heading) * (p - q); at.y += Math.sin(at.heading) * (p - q); return at; };
            // A PEG A CORNER: across a cell to its far corners, then the peg driven there.
            const pc = Math.min(n - 1, Math.floor(so[0])), pfr = so[0] - pc, driving = so[0] < n && pfr >= 0.6;
            const pegAt = so[0] >= n ? n - 0.5 : pc - 0.5 + Math.min(1, pfr / 0.6);
            // The can: a burst, a pace, a burst.
            const m2 = so[2] * 2, spraying = so[2] > 0 && so[2] < n && m2 % 1 < 0.3;
            /** (Stood still to spray, then on half a cell: the can's place, not the front's.) */
            const canAt = so[2] >= n ? n : (Math.floor(m2) + Math.max(0, (m2 % 1) - 0.3) / 0.7) / 2;
            const crew: { al: number; ac: number; pose: "work" | "stand" | "walk"; face: number }[] = [
              { al: pegAt, ac: 0.5, pose: driving ? "work" : so[0] < n && j.t > 0 ? "walk" : "stand", face: driving ? RIGHT : 0 },
              { al: pegAt, ac: -0.5, pose: driving ? "work" : so[0] < n && j.t > 0 ? "walk" : "stand", face: driving ? LEFT : 0 },
              { al: so[1] - 0.5, ac: 0.6, pose: so[1] > 0 && so[1] < n ? "walk" : "stand", face: 0 },
              { al: so[1] - 0.5, ac: -0.6, pose: so[1] > 0 && so[1] < n ? "walk" : "stand", face: 0 },
              { al: canAt - 0.5, ac: 0.06, pose: spraying ? "work" : so[2] > 0 && so[2] < n ? "walk" : "stand", face: 0 },
            ];
            if (P) crew.forEach((r, k) => {
              const at = lineAt(r.al), id = `${j.id}:set${k}`;
              seenH.add(id);
              let hnd = hands.get(id);
              if (!hnd) {
                const c = new Container(); c.eventMode = "none";
                // (White hats: the engineers, not the gang.)
                const parts = [SKIN, LEGS, k === 4 ? 0xe8e23a : 0xf47b20, 0xf2f2f2, 0xffffff].map((tint) => { const sp = new Sprite(); sp.tint = tint; c.addChild(sp); return sp; });
                hnd = { c, parts, key: "", band: -1 };
                hands.set(id, hnd);
              }
              const px = at.x - Math.sin(at.heading) * r.ac, py = at.y + Math.cos(at.heading) * r.ac;
              hnd.key = posePerson(hnd.parts, P, "builder", r.pose, at.heading + r.face, r.pose === "walk" ? j.t * 7.5 + k : r.pose === "work" ? j.t * 6 + k * 1.7 : 0, scale, 0.93 + 0.03 * (k % 3), hnd.key);
              const x = (px - py) * HW * scale, y = (px + py) * HH * scale - at.z * HEIGHT_UNIT * scale;
              for (const sp of hnd.parts) sp.position.set(x, y);
              hnd.c.alpha = shown;
              hnd.band = into(hnd.c, hnd.band, px, py, FEET);
            });
            // THEIR PICKUP after them, with the pegs and the tape in the back of it.
            if (so[2] > 1.6) { const u = place("survey", lineAt(Math.min(n - 1, so[2] - 1.9)), [{ look: "pickup", tint: YELLOW }]); if (u) u.c.alpha = shown * Math.min(1, (so[2] - 1.6) / 0.4); }
          }
          if (j.t <= ARRIVE) return;

          // ── THE EXCAVATOR, and the lorry it loads ──────────────────────────────────────────
          const digAt = Math.max(0, f[0] - 0.62);
          const digging = f[0] < n && !j.cells[Math.min(n - 1, Math.floor(f[0]))].deck && !j.cells[Math.max(0, Math.floor(digAt))].deck;
          if (digging) {
            const at = alongJob(g, j, digAt), q = ((w % DIG_ALL) + DIG_ALL) % DIG_ALL;
            // Where its turn has got to: what its arm is doing, and how far round its house has slewed.
            let pose = "exDig", slew = 0, tip = false;
            // A bite: the bucket set in the ground ahead, then drawn in and curled through it.
            if (q < DIG.dig) pose = q < DIG.dig * 0.45 ? "exDig" : "exDig2";
            else if (q < DIG.dig + DIG.lift) pose = "exLift";
            else if (q < DIG.dig + DIG.lift + DIG.out) { pose = "exLift"; slew = (q - DIG.dig - DIG.lift) / DIG.out; }
            else if (q < DIG.dig + DIG.lift + DIG.out + DIG.tip) { pose = "exDump"; slew = 1; tip = true; }
            else { pose = "exLift"; slew = 1 - (q - DIG.dig - DIG.lift - DIG.out - DIG.tip) / DIG.back; }
            // Eased, as a machine of that weight starts and stops; right round, to the lorry behind it.
            const turn = Math.PI * (slew * slew * (3 - 2 * slew)), hh = at.heading + turn;
            const u = place("digger", at, [{ look: "exTracks", tint: YELLOW }, { look: pose, tint: YELLOW, heading: hh }]);
            const in2 = q >= DIG.dig * 0.45 && q < DIG.dig, carrying = q >= DIG.dig && q < DIG.dig + DIG.lift + DIG.out;
            if (u && !still && q < DIG.dig) puffs(u.over, hh, (in2 ? 4.6 : 5.6) * T, ARM, 0.3, 0xa98660, 4, 0.12, 16, 0.4);
            // EARTH breaking over the bucket's lip as it is drawn through the ground; a full bucket shedding as it is
            // lifted and swung; and TIPPED, the bucketful into the lorry's body, heaping there bucket on bucket.
            // (None of it heaps: what falls back falls into the cut; what is tipped goes into the lorry's load.)
            spill("bite", at, at.heading, [4.4 * T, ARM, 0.85], [4.75 * T, ARM, 0.05], EARTH, 0.8, in2, { rate: 70, gain: 0 });
            spill("shed", at, hh, [3.3 * T, ARM, 1.9], [3.3 * T, ARM, 0.1], EARTH, 0.3, carrying, { rate: 24, gain: 0 });
            spill("load", at, at.heading + Math.PI, [5.25 * T, -ARM, 2.4], [5.25 * T, -ARM, 1.45], EARTH, 1.0, tip, { rate: 190, gain: 0 }, 10);
            // (Backed up to it, tail first: its body under where the bucket swings round to.)
            // IT COMES EMPTY AND IS FILLED: a bucketful more in it each time the bucket is tipped; full, it pulls away up
            // the cut while the digger takes its next bite, and an empty one backs in to where it stood.
            if (digAt > 1.3) {
              const cyc = Math.floor(w / DIG_ALL), tipEnd = DIG.dig + DIG.lift + DIG.out + DIG.tip * 0.7, CAP = SPOIL_LOOKS.length - 1;
              if (!since.has(j.id)) since.set(j.id, q >= tipEnd ? cyc + 1 : cyc);
              const done = Math.max(0, cyc - since.get(j.id)!), into2 = done % CAP, away = done > 0 && into2 === 0 && q < DIG.dig;
              // (Half the bite for the full one to go, half for the empty one to come.)
              const sw = away ? q / DIG.dig : 1, level = away && sw < 0.5 ? CAP : q >= tipEnd ? into2 + 1 : into2;
              const gone = away ? (sw < 0.5 ? sw * 2 : 2 - sw * 2) : 0, eased = gone * gone * (3 - 2 * gone);
              const la = alongJob(g, j, digAt - 0.68 - 1.5 * eased);
              const u = place("spoil", la, [{ look: SPOIL_LOOKS[Math.min(CAP, level)], tint: BLUE, heading: la.heading + Math.PI }]);
              if (u) u.c.alpha = 1 - eased;
            } else since.delete(j.id);
          }

          // ── STONE: a lorry tipping as it creeps, a roller over it behind ───────────────────
          const basing = j.tm > ARRIVE + GAP * PACE && f[1] < n && f[1] > 0.05;
          if (basing && f[1] + 0.75 < f[0] - 1.9) {
            const at = alongJob(g, j, f[1] + 0.42), up = tipping(4) && !still;
            const u = place("stone", at, [{ look: tipLook(4), tint: BLUE }]);
            // STONE sliding off the body's tail to the ground behind, a windrow heaping under it — and spread as fast as it comes; dust off where it lands.
            spill("stone", at, at.heading, [-3.15 * T, 0, 1.1], [-4.0 * T, 0, 0.05], STONE, 1.7, up, { gain: 0.22, drain: 1.1 });
            if (u && up) puffs(u.over, at.heading, -4.1 * T, 0, 0.25, 0xc4bfb5, 3, 0.25, 14, 0.3);
          }
          if (basing && f[1] > 1.1) place("packer", alongJob(g, j, f[1] - 0.75 + (still ? 0 : 0.35 * Math.sin(w * 0.9))), [{ look: "roller", tint: YELLOW }]);

          // ── THE PAVER, the lorry at its hopper, the hot mat, the roller's passes ───────────
          const paving = j.tm > ARRIVE + 2 * GAP * PACE && f[2] < n && f[2] > 0.02;
          if (paving) {
            // (A front is told from the first cell's near edge, a place on the line from its middle: half a cell between them.
            // So stood that the mat comes out from under the screed's back edge.)
            const at = alongJob(g, j, f[2] + PAVER_AT);
            // ITS HOPPER THROUGH A TURN: full and spread, then its wings folding up as it empties, and down again filled.
            const q = ((w % FEED_ALL) + FEED_ALL) % FEED_ALL, fold = still ? 0 : q < FEED.full ? 0 : q < FEED.full + FEED.fold ? (q - FEED.full) / FEED.fold : q < FEED.full + FEED.fold + FEED.up ? 1 : 1 - (q - FEED.full - FEED.fold - FEED.up) / FEED.down;
            // THE SCREED towed behind it, on the line as the paver is: the blacktop falls between the two.
            const sc = alongJob(g, j, f[2] + PAVER_AT - 3.75 * T);
            const su = place("screed", sc, [{ look: "screed", tint: YELLOW }]);
            place("paver", at, [{ look: PAVER_LOOKS[Math.max(0, Math.min(2, Math.round(fold * 2)))], tint: YELLOW }]);
            // BLACKTOP out of the conveyor's mouth at its back, a thick wet fall of it the width of the mouth, into the
            // head the screed pushes; and the heat off it. (Into what is there already: nothing heaps.) Filed between
            // the paver and the screed, by where it lands.
            spill("tar", at, at.heading, [-2.25 * T, 0, 1.35], [-2.8 * T, 0, 0.3], TAR, 1.8, !still, { gain: 0 }, Infinity, 0.02);
            // Steam off the mat behind the screed, the width of it — not over the fall, which is to be seen. (The mat itself is the road's own, growing. @see road-grow)
            if (su && !still) { puffs(su.over, sc.heading, -2.2 * T, 0, 0.2, 0xffffff, 5, 0.5, 30, 0.2); }
          }
          if (j.tm > ARRIVE + 2 * GAP * PACE && f[3] < n && f[2] > 1.4) {
            // A PASS up the mat and back, then over a lane: a triangle of travel, a step of offset each time round.
            const period = 8, ph = ((w % period) + period) % period / period, tri = ph < 0.5 ? ph * 2 : 2 - ph * 2, lane = Math.floor(w / period) % 3 - 1;
            const at = alongJob(g, j, Math.min(n - 1, f[2]) - 1.05 - 0.95 * tri);
            at.x += -Math.sin(at.heading) * lane * 0.13; at.y += Math.cos(at.heading) * lane * 0.13;
            place("roller", at, [{ look: "roller", tint: YELLOW }]);
          }
          // ── LINES ─────────────────────────────────────────────────────────────────────────
          if (f[3] > 0.25 && f[3] < n) {
            const at = alongJob(g, j, f[3] - 0.22), u = place("liner", at, [{ look: "pickup", tint: WHITE }]);
            if (u && !still) puffs(u.over, at.heading, -0.26, 0, 0.1, 0xffffff, 2, 0.06, 6, 0.5);
          }

          // ── THE GANG ──────────────────────────────────────────────────────────────────────
          if (P) {
            const rounds = paving ? LAYING : DIGGING, by = paving ? f[2] + PAVER_AT : digAt;
            // NOBODY RIDES ALONG WITH A MACHINE. Each stands where they stopped, on the ground, and does their work there
            // while the machine creeps on; when it is done, or the machine has got away from them, they WALK to the next
            // place of their round — which is by the machine, wherever it has got to.
            rounds.forEach((round, k) => {
              const id = `${j.id}:${k}`;
              seenH.add(id);
              let hnd = hands.get(id);
              if (!hnd) {
                const c = new Container(); c.eventMode = "none";
                // The foreman in a white shirt: the last of the round.
                const parts = [SKIN, LEGS, k === rounds.length - 1 && k >= 3 ? 0xf2f2f2 : VESTS[k % VESTS.length], HAT, 0xffffff].map((tint) => { const sp = new Sprite(); sp.tint = tint; c.addChild(sp); return sp; });
                hnd = { c, parts, key: "", band: -1 };
                hands.set(id, hnd);
              }
              const { pose, face } = walkRound(hnd, round, by, still ? 0 : dt, k * 2);
              const at = alongJob(g, j, hnd.p!);
              const px = at.x - Math.sin(at.heading) * hnd.ac!, py = at.y + Math.cos(at.heading) * hnd.ac!;
              hnd.key = posePerson(hnd.parts, P, "builder", still && pose !== "stand" ? "stand" : pose, at.heading + face, pose === "walk" ? w * 7.5 + k : pose === "work" ? w * 4.5 + k * 1.7 : 0, scale, 0.93 + 0.03 * (k % 4), hnd.key);
              const x = (px - py) * HW * scale, y = (px + py) * HH * scale - at.z * HEIGHT_UNIT * scale;
              for (const sp of hnd.parts) sp.position.set(x, y);
              hnd.band = into(hnd.c, hnd.band, px, py, FEET);
            });
          }
        });
      }
      for (const [id, u] of units) if (!seenU.has(id)) { drop(u.c); units.delete(id); }
      for (const [id, h] of hands) if (!seenH.has(id)) { drop(h.c); hands.delete(id); }
      for (const [id, sp] of spills) if (!seenS.has(id)) { drop(sp.c); spills.delete(id); }
      for (const id of clocks.keys()) if (!g.roadJobs.some((j) => j.id === id)) { clocks.delete(id); since.delete(id); }
    },
    destroy() { for (const u of units.values()) drop(u.c); for (const h of hands.values()) drop(h.c); for (const sp of spills.values()) drop(sp.c); units.clear(); hands.clear(); spills.clear(); clocks.clear(); },
  };
}
