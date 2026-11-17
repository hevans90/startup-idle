/**
 * World v2 — THE MACHINES ON A BUILDING SITE while its ground is worked: the
 * road gang's own, on a plot. THE DIGGER in the pit, biting toward the back
 * of it, slewing round to tip into THE LORRY stood in the gate — come empty,
 * filled a bucketful at a time, away full and another in — or onto its heap
 * where no lorry can stand. THE RIG at each pile in turn, its hammer riding
 * down as the pile goes in, dust off every blow. THE MIXER in the gate, its
 * drum's concrete down the chute into the pit.
 *
 * Each a unit from the vehicles' sheet and each pour the pour's own
 * simulation, as on a road (@see render/plant-kit); where they stand is the
 * site's plan (@see groundworks). Filed as the crew are: with the tile they
 * stand on, over its share of the site.
 */
import type { Container } from "pixi.js";

import type { CarSprites } from "../../agents/cars/car-sheet";
import { RIG_LOOKS, SPOIL_LOOKS } from "../../agents/cars/models";
import { HEIGHT_UNIT, HH, HW } from "../../iso";
import { ARM, BLUE, CONCRETE, DIG, DIG_ALL, EARTH, M, PPM, T, YELLOW, drawSpill, makeSpill, makeUnit, poseUnit, type Spill, type Stuff, type Unit } from "../../render/plant-kit";
import { stepPour, type PourRun } from "../../render/pour-sim";
import { RIG_HEADING, RIG_REACH, rigAt, type Ground } from "./groundworks";
import type { Site } from "./schedule";

/** The mixer's drum: off-white. */
const DRUM = 0xe6e2d8;
/** Seconds between a hammer's blows. */
const BLOW = 0.85;

export type SitePlant = { units: Map<string, Unit>; spills: Map<string, Spill>; /** The digger's turns of work when the lorry it loads first stood by it. */ since: number | null };
export const createSitePlant = (): SitePlant => ({ units: new Map(), spills: new Map(), since: null });
const drop = (c: Container) => { c.parent?.removeChild(c); c.destroy({ children: true }); };
export function dropSitePlant(sp: SitePlant): void {
  for (const u of sp.units.values()) drop(u.c);
  for (const q of sp.spills.values()) drop(q.c);
  sp.units.clear(); sp.spills.clear(); sp.since = null;
}

export type SiteView = {
  cars: CarSprites;
  /** The plot's back corner on the map, tiles; its ground, half steps; the map's scale. */
  ox: number; oy: number; z: number; scale: number;
  /** The layer of whatever stands at a place on the plot. */
  layer: (u: number, v: number) => Container | undefined;
};

/**
 * The machines of a site as its groundworks stand, `t` seconds into its work and `dt` on from the last time —
 * nought while it stands. None on a site past its groundworks, or with none.
 */
export function syncSitePlant(sp: SitePlant, site: Site | null, G: Ground, v: SiteView | null, t: number, dt: number): void {
  if (!site || !site.ground || !v) { if (sp.units.size || sp.spills.size) dropSitePlant(sp); return; }
  const seenU = new Set<string>(), seenS = new Set<string>(), still = dt <= 0, { scale } = v;
  const order = (u: number, w: number) => 1 + (u + w) / 100;
  const place = (name: string, u: number, w: number, looks: { look: string; tint: number; heading?: number }[], heading: number): Unit => {
    let unit = sp.units.get(name);
    if (!unit) { unit = makeUnit(looks.length); sp.units.set(name, unit); }
    seenU.add(name);
    poseUnit(unit, v.cars, looks, { x: v.ox + u, y: v.oy + w, z: v.z, heading, pitch: 0 }, scale);
    const layer = v.layer(u, w), z = order(u, w);
    if (layer && unit.c.parent !== layer) { unit.c.zIndex = z; layer.addChild(unit.c); }
    else if (Math.abs(unit.c.zIndex - z) > 0.0004) unit.c.zIndex = z;
    return unit;
  };
  /** Something poured by a machine at (`u`, `w`): from a lip to where it lands, each so far along `h` and across it, tiles, and so high, metres. */
  const spill = (name: string, u: number, w: number, h: number, from: [number, number, number], to: [number, number, number], stuff: Stuff, width: number, on: boolean, run: PourRun, wall = Infinity) => {
    let q = sp.spills.get(name);
    if (!q) { q = makeSpill(stuff, wall); sp.spills.set(name, q); }
    seenS.add(name);
    const tile = (p: [number, number, number]) => ({ u: u + Math.cos(h) * p[0] - Math.sin(h) * p[1], w: w + Math.sin(h) * p[0] + Math.cos(h) * p[1], m: p[2] });
    const px = (p: { u: number; w: number; m: number }): [number, number] => [(v.ox + p.u - v.oy - p.w) * HW * scale, (v.ox + p.u + v.oy + p.w) * HH * scale - v.z * HEIGHT_UNIT * scale - p.m * M * HEIGHT_UNIT * scale];
    const lip = tile(from), land = tile(to), a = px(lip), b = px(land), S = q.sim;
    S.dx = (b[0] - a[0]) / scale; S.drop = Math.max(2, (b[1] - a[1]) / scale); S.base = 0;
    stepPour(S, dt, on && !still, width * PPM, run);
    const layer = v.layer(land.u, land.w), z = order(Math.max(land.u, lip.u), Math.max(land.w, lip.w)) + 0.004;
    if (layer && q.c.parent !== layer) { q.c.zIndex = z; layer.addChild(q.c); }
    else if (Math.abs(q.c.zIndex - z) > 0.0004) q.c.zIndex = z;
    q.c.position.set(a[0], a[1]);
    drawSpill(q.gfx, S, stuff, scale);
  };

  // ── THE DIG: the digger, and the lorry it loads ────────────────────────────────────────
  if (site.dig > 0 && site.dig < 1) {
    const D = G.digger, q = ((t % DIG_ALL) + DIG_ALL) % DIG_ALL, cyc = Math.floor(t / DIG_ALL);
    // Each bite a little round from the last, toward the back of the pit; tipped toward the lorry, or the heap.
    const bite = -Math.PI / 2 + [-0.65, 0.05, 0.6, -0.25][((cyc % 4) + 4) % 4];
    const to = G.lorry ?? G.heap, tipAt = Math.atan2(to.v - D.v, to.u - D.u);
    let pose = "exDig", slew = 0, tip = false;
    if (q < DIG.dig) pose = q < DIG.dig * 0.45 ? "exDig" : "exDig2";
    else if (q < DIG.dig + DIG.lift) pose = "exLift";
    else if (q < DIG.dig + DIG.lift + DIG.out) { pose = "exLift"; slew = (q - DIG.dig - DIG.lift) / DIG.out; }
    else if (q < DIG.dig + DIG.lift + DIG.out + DIG.tip) { pose = "exDump"; slew = 1; tip = true; }
    else { pose = "exLift"; slew = 1 - (q - DIG.dig - DIG.lift - DIG.out - DIG.tip) / DIG.back; }
    let round = tipAt - bite;
    while (round > Math.PI) round -= Math.PI * 2;
    while (round < -Math.PI) round += Math.PI * 2;
    const hh = bite + round * (slew * slew * (3 - 2 * slew));
    place("digger", D.u, D.v, [{ look: "exTracks", tint: YELLOW }, { look: still ? "exLift" : pose, tint: YELLOW, heading: hh }], Math.PI / 2);
    const in2 = q >= DIG.dig * 0.45 && q < DIG.dig, carrying = q >= DIG.dig && q < DIG.dig + DIG.lift + DIG.out;
    spill("bite", D.u, D.v, bite, [4.4 * T, ARM, 0.85], [4.75 * T, ARM, 0.05], EARTH, 0.8, in2, { rate: 70, gain: 0 });
    spill("shed", D.u, D.v, hh, [3.3 * T, ARM, 1.9], [3.3 * T, ARM, 0.1], EARTH, 0.3, carrying, { rate: 24, gain: 0 });
    spill("load", D.u, D.v, tipAt, [5.25 * T, -ARM, 2.4], [5.25 * T, -ARM, G.lorry ? 1.45 : 0.3], EARTH, 1.0, tip, { rate: 190, gain: 0 }, G.lorry ? 10 : Infinity);
    if (G.lorry) {
      // IT COMES EMPTY AND IS FILLED; full, out through the gate while the digger takes its next bite, and an empty one in.
      const tipEnd = DIG.dig + DIG.lift + DIG.out + DIG.tip * 0.7, CAP = SPOIL_LOOKS.length - 1;
      if (sp.since === null) sp.since = q >= tipEnd ? cyc + 1 : cyc;
      const done = Math.max(0, cyc - sp.since), into = done % CAP, away = done > 0 && into === 0 && q < DIG.dig;
      const sw = away ? q / DIG.dig : 1, level = away && sw < 0.5 ? CAP : q >= tipEnd ? into + 1 : into;
      const gone = away ? (sw < 0.5 ? sw * 2 : 2 - sw * 2) : 0, eased = gone * gone * (3 - 2 * gone);
      const u = place("spoil", G.lorry.u, G.lorry.v + 0.9 * eased, [{ look: SPOIL_LOOKS[Math.min(CAP, level)], tint: BLUE }], G.lorry.heading);
      u.c.alpha = 1 - eased;
    }
  } else sp.since = null;

  // ── THE PILES: the rig at each in turn ─────────────────────────────────────────────────
  const rig = rigAt(G, site);
  if (rig) {
    const u = place("rig", rig.u, rig.v, [{ look: rig.driving ? RIG_LOOKS[Math.max(0, Math.min(RIG_LOOKS.length - 1, Math.floor(rig.in * RIG_LOOKS.length)))] : "rigUp", tint: YELLOW }], RIG_HEADING);
    // A BLOW: dust off the ground round the pile, and gone before the next.
    if (rig.driving && !still) {
      const ph = ((t % BLOW) + BLOW) % BLOW / BLOW, du = Math.cos(RIG_HEADING) * RIG_REACH, dw = Math.sin(RIG_HEADING) * RIG_REACH;
      const x = (du - dw) * HW * scale, y = (du + dw) * HH * scale;
      for (let k = 0; k < 4; k++) {
        const a = k * 1.7 + rig.pile, r = (3 + ph * 9) * scale;
        u.over.circle(x + Math.cos(a) * r, y + Math.sin(a) * r * 0.5 - ph * 5 * scale, (1.6 + ph * 3.2) * scale).fill({ color: 0xb59a78, alpha: 0.5 * (1 - ph) });
      }
    }
  }

  // ── THE POUR: the mixer in the gate, concrete down its chute ───────────────────────────
  if (site.fill > 0 && site.fill < 1 && G.lorry) {
    place("mixer", G.lorry.u, G.lorry.v, [{ look: "mixer", tint: DRUM }], G.lorry.heading);
    spill("concrete", G.lorry.u, G.lorry.v, G.lorry.heading, [-5.05 * T, 0, 1.05], [-5.5 * T, 0, 0.05], CONCRETE, 0.55, true, { gain: 0 });
  }

  for (const [id, u] of sp.units) if (!seenU.has(id)) { drop(u.c); sp.units.delete(id); }
  for (const [id, q] of sp.spills) if (!seenS.has(id)) { drop(q.c); sp.spills.delete(id); }
}
