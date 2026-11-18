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
import type { PeopleSprites } from "../../agents/people/people-sheet";
import { RIG_LOOKS, SPOIL_LOOKS } from "../../agents/cars/models";
import { HEIGHT_UNIT, HH, HW } from "../../iso";
import { PLANT_COLOUR, type Plant, type PlantKind } from "../../fleet/plant";
import { ARM, BLUE, CONCRETE, DIG, DIG_ALL, DRUM, EARTH, mixerLook, M, PLANT_SPEED, PPM, T, YELLOW, drawSpill, follow, makeSpill, makeUnit, poseUnit, type Spill, type Standing, type Stuff, type Unit } from "../../render/plant-kit";
import { stepPour, type PourRun } from "../../render/pour-sim";
import { RIG_HEADING, RIG_REACH, rigAt, sitePlantOf, type Ground } from "./groundworks";
import type { Site } from "./schedule";

/** Seconds between a hammer's blows. */
const BLOW = 0.85;

type Look = { look: string; tint: number; heading?: number };
/** A site's machines by the mover that brings each (@see groundworks SITE_PLANT): the digger and the rig on low-loaders, the lorry, the mixer. */
const SITE_UNITS: Readonly<Record<string, { kind: PlantKind; li: number; tracked?: boolean }>> = {
  digger: { kind: "loader", li: 0, tracked: true }, rig: { kind: "loader", li: 1, tracked: true },
  spoil: { kind: "tipper", li: 0 }, mixer: { kind: "mixer", li: 0 },
};
/** Each as it stands before its trade has begun. */
const SITE_STOOD: Readonly<Record<string, Look[]>> = {
  digger: [{ look: "exTracks", tint: YELLOW }, { look: "exLift", tint: YELLOW, heading: 0 }], rig: [{ look: "rigUp", tint: YELLOW }],
  spoil: [{ look: SPOIL_LOOKS[0], tint: BLUE }], mixer: [{ look: "mixer", tint: DRUM }],
};

export type SitePlant = {
  units: Map<string, Unit>; spills: Map<string, Spill>;
  /** Where each of its machines is, driving; and what each was last drawn as, for standing it when its trade is over. @see plant-kit follow */
  poses: Map<string, Standing>; kept: Map<string, Look[]>;
  /** Which of its tracked machines are up on the low-loader come back for them. */
  aboard: Set<number>;
};
export const createSitePlant = (): SitePlant => ({ units: new Map(), spills: new Map(), poses: new Map(), kept: new Map(), aboard: new Set() });
const drop = (c: Container) => { c.parent?.removeChild(c); c.destroy({ children: true }); };
export function dropSitePlant(sp: SitePlant): void {
  for (const u of sp.units.values()) drop(u.c);
  for (const q of sp.spills.values()) drop(q.c);
  sp.units.clear(); sp.spills.clear(); sp.poses.clear(); sp.kept.clear(); sp.aboard.clear();
}

export type SiteView = {
  cars: CarSprites;
  /** The people's sheet, when it is in, and a number of the site's own: for who works its machines. */
  people: PeopleSprites | null; id: number;
  /** The plot's back corner on the map, tiles; its ground, half steps; the map's scale. */
  ox: number; oy: number; z: number; scale: number;
  /** The plot's size, tiles; and its machines as they come from the yard and go home — null, a site none come to by road: they are simply there. @see fleet/plant */
  w: number; h: number; plant: Plant | null;
  /** The layer of whatever stands at a place on the plot. */
  layer: (u: number, v: number) => Container | undefined;
  /** The layer, and the place in it, of a vehicle off the plot — on the road, or half on it — so much of the map under it: filed as the town files one. */
  road: (x: number, y: number, base: readonly { u: number; v: number }[]) => { layer: Container | undefined; z: number };
};

/**
 * The machines of a site as its groundworks stand, `t` seconds into its work and `dt` on from the last time —
 * nought while it stands. None on a site past its groundworks, or with none.
 */
export function syncSitePlant(sp: SitePlant, site: Site | null, G: Ground, v: SiteView | null, t: number, dt: number): void {
  const plant = v?.plant ?? null;
  // (Its ground done, they are on it still till the last of them has set off home.)
  const going = !!plant && plant.leaving !== undefined && (plant.home?.length ?? 1) > 0;
  if (!site || !v || (!site.ground && !going) || (plant && !plant.here && !plant.at?.length)) { if (sp.units.size || sp.spills.size || sp.poses.size) dropSitePlant(sp); return; }
  const seenU = new Set<string>(), seenS = new Set<string>(), still = dt <= 0, { scale } = v;
  const kinds = sitePlantOf({ w: v.w, h: v.h });
  const order = (u: number, w: number) => 1 + (u + w) / 100;
  /** Where a machine stands when its trade is not at work: inside the fence along the front, the wheeled ones to one side of the gate, the low-loaders to the other. */
  const rest = (k: number) => {
    const gu = v.w / 2, low = k >= 7, n = low ? k - 7 : k % 2, gap = 0.6, first = low ? 0.72 : 0.66;
    const cols = Math.max(1, Math.floor((gu - first - 0.3) / gap) + 1), u = gu + (low ? 1 : -1) * (first + gap * (n % cols));
    return { x: v.ox + Math.max(0.3, Math.min(v.w - 0.3, u)), y: v.oy + v.h - 0.3 - 0.62 * Math.floor(n / cols) };
  };
  const put = (name: string, x: number, y: number, looks: Look[], heading: number): Unit => {
    let unit = sp.units.get(name);
    if (!unit || unit.parts.length !== looks.length * 2) { if (unit) drop(unit.c); unit = makeUnit(looks.length); sp.units.set(name, unit); }
    seenU.add(name);
    const base = poseUnit(unit, v.cars, looks, { x, y, z: v.z, heading, pitch: 0 }, scale, v.people ? { people: v.people, id: v.id * 16 + name.length } : null);
    const u = x - v.ox, w = y - v.oy;
    // (Any of it over the plot's edge, it is on the road: drawn with the road's tile, over it, not under.)
    const out = base.some((p) => u + p.u < 0 || w + p.v < 0 || u + p.u > v.w || w + p.v > v.h), on = out ? v.road(x, y, base) : null;
    const layer = on ? on.layer : v.layer(u, w), z = on ? on.z : order(u, w);
    if (layer && unit.c.parent !== layer) { unit.c.zIndex = z; layer.addChild(unit.c); }
    else if (Math.abs(unit.c.zIndex - z) > 0.0004) unit.c.zIndex = z;
    return unit;
  };
  /** Towards a place at a machine's pace: whether it is still on its way. */
  const drive = (st: Standing, to: { x: number; y: number }): boolean => {
    const dx = to.x - st.x, dy = to.y - st.y, d = Math.hypot(dx, dy), step = PLANT_SPEED * dt;
    if (d <= Math.max(step, 0.03)) { st.x = to.x; st.y = to.y; return false; }
    st.x += (dx / d) * step; st.y += (dy / d) * step; st.heading = Math.atan2(dy, dx);
    return true;
  };
  const loaders = (plant?.at ?? []).filter((a) => a.colour === PLANT_COLOUR.loader);
  const allLoaders = kinds.filter((q) => q === "loader").length, sentLoaders = allLoaders - (plant?.home ? plant.home.filter((q) => q === "loader").length : allLoaders);
  /**
   * A TRACKED MACHINE — the digger, the rig — which no low-loader waits for (@see fleet/plant shuttle): off the one
   * that brought it where that stopped, to its work or to stand inside the fence; and, the ground done, to the one
   * come back for it and up onto it.
   */
  const tracked = (name: string, li: number, want: { x: number; y: number; heading: number } | null): { at: { x: number; y: number; heading: number } | null; away: boolean } => {
    const id = `s:${name}`, P = plant!;
    if (li < sentLoaders || sp.aboard.has(li) || (!P.here && loaders.length <= li)) return { at: null, away: false };
    let st = sp.poses.get(id);
    if (!st) { const from = loaders[li]; st = from ? { x: from.x, y: from.y, heading: from.heading, k: 0 } : { ...rest(7 + li), heading: want?.heading ?? Math.PI / 2, k: 0 }; sp.poses.set(id, st); }
    const leaving = P.leaving !== undefined, back = leaving ? P.back?.[li] : undefined;
    const away = drive(st, back ?? (leaving || !want || !P.here ? rest(7 + li) : want));
    if (!away && back) { sp.aboard.add(li); st.heading = back.heading; return { at: null, away: false }; }
    // (Sent off before it was up: it is up.)
    if (back && P.to?.kind === "loader" && li === sentLoaders) { sp.aboard.add(li); return { at: null, away: false }; }
    if (!away && want && !leaving && P.here) st.heading = want.heading;
    return { at: { x: st.x, y: st.y, heading: st.heading }, away };
  };
  /**
   * A machine at its work. ONE THAT CAME FROM THE YARD DRIVES THERE (@see plant-kit follow): from where it left the
   * road, between its places of work — `away` while it does, and its work waits for it. Null: gone home.
   */
  const place = (name: string, u: number, w: number, looks: Look[], heading: number): { unit: Unit; away: boolean } | null => {
    let x = v.ox + u, y = v.oy + w, away = false;
    const mine = SITE_UNITS[name];
    if (plant && mine) {
      const fo = mine.tracked ? tracked(name, mine.li, { x, y, heading }) : follow(sp.poses, `s:${name}`, plant, kinds, mine.kind, mine.li, PLANT_COLOUR[mine.kind], mine, { x, y, heading }, () => rest(mine.kind === "mixer" ? 1 : 0), dt);
      sp.kept.set(name, looks);
      if (!fo.at) return null;
      x = fo.at.x; y = fo.at.y; away = fo.away;
      if (away) { heading = fo.at.heading; looks = looks.map((l) => (l.heading !== undefined ? { ...l, heading } : l)); }
      else if (!mine.tracked || !plant.here) heading = fo.at.heading;
    }
    return { unit: put(name, x, y, looks, heading), away };
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
    // THE ONE LORRY, there from the first bucketful to the last: filled as the pit is dug, and away with it when it is.
    const lorry = G.lorry ? place("spoil", G.lorry.u, G.lorry.v, [{ look: SPOIL_LOOKS[Math.max(0, Math.min(SPOIL_LOOKS.length - 1, Math.floor(site.dig * SPOIL_LOOKS.length)))], tint: BLUE }], G.lorry.heading) : null;
    // (Nothing is dug till the digger is stood in the pit, nor tipped till the lorry is under its bucket.)
    const waits = G.lorry ? !lorry || lorry.away : false;
    const dg = place("digger", D.u, D.v, [{ look: "exTracks", tint: YELLOW }, { look: still ? "exLift" : pose, tint: YELLOW, heading: hh }], Math.PI / 2);
    const at = !!dg && !dg.away && !waits;
    if (dg && !dg.away && waits) put("digger", v.ox + D.u, v.oy + D.v, [{ look: "exTracks", tint: YELLOW }, { look: "exLift", tint: YELLOW, heading: bite }], Math.PI / 2);
    const in2 = q >= DIG.dig * 0.45 && q < DIG.dig, carrying = q >= DIG.dig && q < DIG.dig + DIG.lift + DIG.out;
    spill("bite", D.u, D.v, bite, [4.4 * T, ARM, 0.85], [4.75 * T, ARM, 0.05], EARTH, 0.8, at && in2, { rate: 70, gain: 0 });
    spill("shed", D.u, D.v, hh, [3.3 * T, ARM, 1.9], [3.3 * T, ARM, 0.1], EARTH, 0.3, at && carrying, { rate: 24, gain: 0 });
    spill("load", D.u, D.v, tipAt, [5.25 * T, -ARM, 2.4], [5.25 * T, -ARM, G.lorry ? 1.45 : 0.3], EARTH, 1.0, at && tip, { rate: 190, gain: 0 }, G.lorry ? 10 : Infinity);
  }

  // ── THE PILES: the rig at each in turn ─────────────────────────────────────────────────
  const rig = rigAt(G, site);
  if (rig) {
    const r = place("rig", rig.u, rig.v, [{ look: rig.driving ? RIG_LOOKS[Math.max(0, Math.min(RIG_LOOKS.length - 1, Math.floor(rig.in * RIG_LOOKS.length)))] : "rigUp", tint: YELLOW }], RIG_HEADING);
    // A BLOW: dust off the ground round the pile, and gone before the next.
    if (r && !r.away && rig.driving && !still) {
      const u = r.unit;
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
    const m = place("mixer", G.lorry.u, G.lorry.v, [{ look: mixerLook(t, !still), tint: DRUM }], G.lorry.heading);
    spill("concrete", G.lorry.u, G.lorry.v, G.lorry.heading, [-5.05 * T, 0, 1.05], [-5.5 * T, 0, 0.05], CONCRETE, 0.55, !!m && !m.away, { gain: 0 });
  }

  // WHAT IS NOT AT WORK STANDS INSIDE THE FENCE — before its trade has begun, and after — and the low-loaders that
  // brought the tracked ones, bare, till they take them home.
  if (plant) {
    const stand = (name: string, looks: Look[], mine: { kind: PlantKind; li: number; tracked?: boolean }) => {
      if (seenU.has(name) || !kinds.includes(mine.kind as never)) return;
      const fo = mine.tracked ? tracked(name, mine.li, null) : follow(sp.poses, `s:${name}`, plant, kinds, mine.kind, mine.li, PLANT_COLOUR[mine.kind], mine, null, () => rest(mine.kind === "mixer" ? 1 : 0), dt);
      if (!fo.at) return;
      put(name, fo.at.x, fo.at.y, looks.map((l) => (l.heading !== undefined ? { ...l, heading: fo.at!.heading } : l)), fo.at.heading);
    };
    for (const name of Object.keys(SITE_UNITS)) stand(name, sp.kept.get(name) ?? SITE_STOOD[name], SITE_UNITS[name]);
    // THE LOW-LOADERS: each stood where it stopped while its machine is driven off it, then round to where its way
    // home begins, bare; and, come back, stood again till its machine is up on it, and away with it.
    const low = (id: string, from: { x: number; y: number; heading: number }, to: { x: number; y: number; heading: number } | undefined, loaded: boolean) => {
      let st = sp.poses.get(`s:${id}`);
      if (!st) { st = { x: from.x, y: from.y, heading: from.heading, k: 0 }; sp.poses.set(`s:${id}`, st); }
      if (to && !drive(st, to)) st.heading = to.heading;
      put(id, st.x, st.y, [{ look: loaded ? "lowLoader" : "lowLoaderEmpty", tint: YELLOW }], st.heading);
    };
    plant.lows?.forEach((l, k) => { if (!l.gone) low(`low${k}`, l, l.to, false); });
    plant.back?.forEach((b, k) => { if (k >= sentLoaders) low(`back${k}`, b, plant.to?.kind === "loader" && k === sentLoaders ? plant.to : undefined, sp.aboard.has(k)); });
  }

  for (const [id, u] of sp.units) if (!seenU.has(id)) { drop(u.c); sp.units.delete(id); }
  for (const [id, q] of sp.spills) if (!seenS.has(id)) { drop(q.c); sp.spills.delete(id); }
}
