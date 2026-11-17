/**
 * World v2 — WHAT EVERY WORKING MACHINE IS DRAWN WITH, a road's or a building
 * site's: a UNIT — a vehicle's sprites, one look or several over one another
 * (tracks, a house slewed on them), each at its own heading, with a drawing
 * under and over them — and a SPILL: something poured, its grains and its
 * heap from the pour's own simulation. Where they are filed is their user's.
 * @see road-plant, structures/projects/site-plant, pour-sim
 */
import { Container, Graphics, Sprite } from "pixi.js";

import { baseCorners, headingIndex, pitchMatrix, poseOf, type CarSprites } from "../agents/cars/car-sheet";
import { MIXER_LOOKS, seatsOf } from "../agents/cars/models";
import { plantCrew } from "../agents/cars/crew";
import { makeRiders, poseRiders, type Riders } from "../agents/cars/occupants";
import type { PeopleSprites } from "../agents/people/people-sheet";
import { HEIGHT_UNIT, HH, HW } from "../iso";
import { COLUMN, POURS, createPourSim, eachColumn, eachGrain, type PourKind, type PourSim } from "./pour-sim";

/** The contractor's yellow; the lorries' blue; a mixer's drum, off-white. */
export const YELLOW = 0xe9a71b, BLUE = 0x3f6fb0, DRUM = 0xe6e2d8;
/** Metres to half steps, for what is drawn above the ground; tiles a metre. */
export const M = 1 / 2.268, T = 0.09;
/** How far to the side of its middle an excavator's arm is, tiles: across, to its left. @see models ARM_Y */
export const ARM = -0.3 * T;
/** Pixels a metre at the map's own scale, about: for a lip's width. */
export const PPM = 6.5;
/** How many looks a second a mixer's drum goes through as it turns: brisk enough to be seen turning, slow enough to read. */
export const DRUM_RATE = 7;
/** The mixer as it is `t` seconds into its work: its drum turning while it pours, at rest when it does not. */
export const mixerLook = (t: number, turning: boolean) => MIXER_LOOKS[turning ? ((Math.floor(t * DRUM_RATE) % MIXER_LOOKS.length) + MIXER_LOOKS.length) % MIXER_LOOKS.length : 0];
/** A digger's turn of work, seconds: dig, lift, slew round, tip, slew back. */
export const DIG = { dig: 3.2, lift: 0.8, out: 1.9, tip: 1.3, back: 1.9 }, DIG_ALL = DIG.dig + DIG.lift + DIG.out + DIG.tip + DIG.back;

export type Unit = { c: Container; under: Graphics; parts: Sprite[]; over: Graphics; keys: string[]; band: number; /** Who works each of its looks, once there is a sheet to draw them from; null, a look nobody sits in. @see cars/occupants */ riders: (Riders | null | undefined)[] };
/** What pours: how it falls and heaps, and its tones from shade to lit. */
export type Stuff = { kind: PourKind; tones: [number, number, number]; wet: boolean };
export const EARTH: Stuff = { kind: POURS.earth, tones: [0x4d3722, 0x73553a, 0x9a7650], wet: false };
export const STONE: Stuff = { kind: POURS.stone, tones: [0x6b6862, 0x908c84, 0xb9b4aa], wet: false };
export const TAR: Stuff = { kind: POURS.tar, tones: [0x09090b, 0x121214, 0x1c1c20], wet: true };
/** Something being poured: its grains and its heap, and what draws them — in a layer of its own, filed by where it lands. */
export type Spill = { sim: PourSim; c: Container; gfx: Graphics; band: number; /** Where it last landed on the map's own picture, pixels across at the map's scale: for leaving its heap where it fell. */ landed: number };
/** Concrete: wet and grey, slumping nearly level. */
export const CONCRETE: Stuff = { kind: POURS.concrete, tones: [0x74777a, 0x93969a, 0xb4b7ba], wet: true };

/** A machine of so many looks: a drawing under them, two sprites a look, a drawing over. */
export function makeUnit(looks: number): Unit {
  const c = new Container(); c.eventMode = "none";
  const under = new Graphics(), over = new Graphics();
  under.context.batchMode = "batch"; over.context.batchMode = "batch";
  c.addChild(under);
  const parts: Sprite[] = [];
  for (let k = 0; k < looks * 2; k++) { const sp = new Sprite(); parts.push(sp); c.addChild(sp); }
  c.addChild(over);
  return { c, under, parts, over, keys: Array.from({ length: looks }, () => ""), band: -1, riders: Array.from({ length: looks }, () => undefined) };
}
/**
 * A unit AT A PLACE — tiles, half steps up, a heading and a pitch — as these looks, each at its own heading or the
 * place's: its sprites set, itself moved there and leant to the slope, its two drawings cleared for the caller.
 * Gives back its footprint, every part's: for whoever files it.
 */
export function poseUnit(u: Unit, cars: CarSprites, looks: readonly { look: string; tint: number; heading?: number }[], at: { x: number; y: number; z: number; heading: number; pitch: number }, scale: number, crew?: { people: PeopleSprites; id: number } | null): { u: number; v: number }[] {
  let lean: { heading: number; shear: number } | null = null;
  // Its footprint: every part's, a house slewed off its tracks reaching further than they do.
  const base: { u: number; v: number }[] = [];
  looks.forEach((l, k) => {
    const L = cars.looks.get(l.look);
    if (!L) return;
    base.push(...baseCorners(L, l.heading ?? at.heading));
    const h = headingIndex(l.heading ?? at.heading, cars.headings), pose = poseOf(cars, L, h, k === 0 ? at.pitch : 0), F = pose.from, q = pose.k;
    if (k === 0) lean = { heading: pose.heading, shear: pose.shear };
    const key = `${l.look}|${pose.key}|${scale}`, paint = u.parts[k * 2], trim = u.parts[k * 2 + 1];
    // WHO WORKS IT, sat in this part of it — a house slewed on its tracks takes its driver round with it: put in once,
    // over this look's own sprites and under the next's.
    if (crew) {
      if (u.riders[k] === undefined) {
        const who = plantCrew(l.look, crew.id * 4 + k);
        u.riders[k] = who.length ? makeRiders(who) : null;
        if (u.riders[k]) u.c.addChildAt(u.riders[k]!.c, u.c.getChildIndex(trim) + 1);
      }
      const R = u.riders[k];
      if (R) poseRiders(R, crew.people, seatsOf(l.look), F, q, pose.heading, pose.lean, scale, cars.res, l.tint, key);
    }
    if (u.keys[k] === key) return;
    u.keys[k] = key;
    paint.tint = l.tint;
    paint.texture = F.paint[q]; trim.texture = F.trim[q];
    paint.anchor.set(F.paintAnchor[q].x, F.paintAnchor[q].y); trim.anchor.set(F.trimAnchor[q].x, F.trimAnchor[q].y);
    paint.scale.set(scale / cars.res); trim.scale.set(scale / cars.res);
  });
  const x = (at.x - at.y) * HW * scale, y = (at.x + at.y) * HH * scale - at.z * HEIGHT_UNIT * scale;
  const tilt = lean ? pitchMatrix((lean as { heading: number; shear: number }).heading, (lean as { heading: number; shear: number }).shear) : null;
  if (tilt) { tilt.tx = x; tilt.ty = y; u.c.setFromMatrix(tilt); } else { u.c.scale.set(1); u.c.skew.set(0, 0); u.c.rotation = 0; u.c.position.set(x, y); }
  u.under.clear(); u.over.clear();
  return base;
}
/** Something to be poured: its simulation, and the layer it is drawn in. */
export function makeSpill(stuff: Stuff, wall = Infinity): Spill {
    const c = new Container(), gfx = new Graphics();
    c.eventMode = "none"; gfx.context.batchMode = "batch";
    c.addChild(gfx);
    return { sim: createPourSim(stuff.kind, wall), c, gfx, band: -1, landed: NaN };
}
/** A pour, drawn: its heap and every grain in the air. */
export function drawSpill(G: Graphics, S: PourSim, stuff: Stuff, scale: number): void {
  // DRAWN: the heap as what it is — grains, piled, each column's own and keeping its tone as the lip moves on,
  // the lit ones on top and toward the light; then every grain in the air, by its tone.
  const r = S.kind.grain * scale, cw = COLUMN * scale;
  G.clear();
  for (let tone = 0; tone < 3; tone++) {
    let any = false;
    eachColumn(S, (x, ground, high, id) => {
      for (let up = 0; up < high; up += COLUMN) {
        const hsh = Math.abs(Math.sin(id * 12.9898 + Math.floor(up / COLUMN) * 78.233) * 43758.5453) % 1;
        // Lighter toward the top of it, where the light falls.
        const tn = Math.min(2, Math.floor((hsh * 0.7 + (up / Math.max(high, COLUMN)) * 0.45) * 3));
        if (tn !== tone) continue;
        any = true;
        G.rect(x * scale - cw / 2, (ground - Math.min(high, up + COLUMN)) * scale, cw, Math.min(COLUMN, high - up) * scale + 0.5);
      }
    });
    if (any) G.fill({ color: stuff.tones[tone] });
  }
  for (let tone = 0; tone < 3; tone++) {
    let any = false;
    eachGrain(S, (x, y, tn) => {
      if (Math.min(2, Math.floor(tn * 3)) !== tone) return;
      any = true;
      if (stuff.wet) G.circle(x * scale, y * scale, r * 0.62); else G.rect(x * scale - r / 2, y * scale - r / 2, r, r);
    });
    if (any) G.fill({ color: stuff.tones[tone] });
  }
  // Blacktop is wet: a glint on the lit side of some of it.
  if (stuff.wet) { let any = false; eachGrain(S, (x, y, tn) => { if (tn > 0.55) { any = true; G.rect(x * scale - r * 0.45, y * scale - r * 0.45, r * 0.4, r * 0.4); } }); if (any) G.fill({ color: 0x6a6a74 }); }
}
