/**
 * World v2 — THE PEOPLE IN A VEHICLE, drawn: each a seated figure from the
 * people's sheet at their seat, and over them what of the vehicle is nearer
 * the camera than they are — the near door, a pillar, the roof's edge, and
 * its glass as a tint. So they are inside it. @see crew (who they are),
 * raster BakeOpts.over (how the over layers are baked)
 *
 * One container, put in a vehicle's own between its trim and its lamps and
 * never moved: the riders in a fixed set of sprites, dealt out far to near
 * as the vehicle turns — nothing is re-ordered, only re-skinned.
 */
import { Container, Rectangle, Sprite, Texture } from "pixi.js";

import { HEIGHT_UNIT, HH, HW } from "../../iso";
import { posePerson, type PeopleSprites } from "../people/people-sheet";
import type { CarPoses } from "./car-sheet";
import type { Rider } from "./crew";
import { HALF_STEPS_PER_M, pitchAngle, TILES_PER_M, type Seat } from "./models";

/** How high the seat is that a sitter is baked on, metres. @see figures SIT_HIP */
const SEAT_Z = 0.45;

export type Riders = { c: Container; riders: readonly Rider[]; slots: Sprite[][]; keys: string[]; cuts: (number | null)[]; over: Sprite[]; key: string };

export function makeRiders(riders: readonly Rider[]): Riders {
  const c = new Container();
  c.eventMode = "none";
  const slots = riders.map(() => Array.from({ length: 5 }, () => { const sp = new Sprite(); c.addChild(sp); return sp; }));
  const over = [0, 1].map(() => { const sp = new Sprite(); c.addChild(sp); return sp; });
  return { c, riders, slots, keys: riders.map(() => ""), cuts: riders.map(() => null), over, key: "" };
}

/** Where a seat's sitter stands in the vehicle's own picture: their feet, map pixels from its middle, and how near the camera they are. */
export function seatAt(seat: Seat, height: number, heading: number, lean: number, scale: number): { x: number; y: number; depth: number } {
  const ch = Math.cos(heading), sh = Math.sin(heading), th = pitchAngle(lean), z = seat.z - SEAT_Z * height;
  // (Leant with the vehicle: along it and up, turned by its slope. @see town-render, the beacons)
  const l = seat.l * Math.cos(th) - z * Math.sin(th), up = seat.l * Math.sin(th) + z * Math.cos(th);
  const u = (l * ch - seat.y * sh) * TILES_PER_M, v = (l * sh + seat.y * ch) * TILES_PER_M;
  return { x: (u - v) * HW * scale, y: (u + v) * HH * scale - up * HALF_STEPS_PER_M * HEIGHT_UNIT * scale, depth: u + v };
}

/** A low car's floor, metres up: what of a sitter hangs under it is under the car, and not drawn. */
const FLOOR_Z = 0.32;
/** How far below their feet's place a sitter in a seat `z` up may be drawn, map pixels at scale 1: to the shin where it meets the floor, or the hips if they are lower on the screen; null, all of them. */
export function cutAt(seat: Seat, height: number, heading: number): number | null {
  const z = seat.z - SEAT_Z * height;
  if (z > FLOOR_Z - 0.03) return null;
  const fwd = (Math.cos(heading) + Math.sin(heading)) * TILES_PER_M * HH;
  const up = HALF_STEPS_PER_M * HEIGHT_UNIT;
  // (Their shins are some half a metre ahead of their hips.)
  return Math.max(0.5 * height * fwd - (FLOOR_Z - z) * up, -0.2 * height * Math.abs(fwd) - SEAT_Z * height * up);
}
/** Frames cut short, by the frame and the rows kept of it. */
const short = new WeakMap<Texture, Map<number, Texture>>();
/** A sprite's frame cut off `down` map pixels (at `scale`) below its anchor. */
function cutShort(sp: Sprite, down: number): void {
  const t = sp.texture, h = t.frame.height, at = sp.anchor.y * h;
  const keep = Math.max(1, Math.min(h, Math.round(at + down / sp.scale.y)));
  if (t === Texture.EMPTY || keep >= h) return;
  let by = short.get(t);
  if (!by) short.set(t, (by = new Map()));
  let c = by.get(keep);
  if (!c) by.set(keep, (c = new Texture({ source: t.source, frame: new Rectangle(t.frame.x, t.frame.y, t.frame.width, keep) })));
  sp.texture = c;
  sp.anchor.y = at / keep;
}

/**
 * The riders as their vehicle is now: the frame `k` of `from` at `heading`, leant `lean`, at the map's `scale` —
 * `key` says when any of that has changed, and nothing is done until it has. `paint` tints the paint that is over them.
 */
export function poseRiders(R: Riders, P: PeopleSprites, seats: readonly Seat[], from: CarPoses, k: number, heading: number, lean: number, scale: number, res: number, paint: number, key: string): void {
  if (R.key === key) return;
  R.key = key;
  // FAR TO NEAR: whoever is further from the camera into the earlier sprites.
  const placed = R.riders.map((r) => ({ r, at: seatAt(seats[r.seat], r.height, heading, lean, scale) })).sort((a, b) => a.at.depth - b.at.depth);
  placed.forEach(({ r, at }, j) => {
    const parts = R.slots[j];
    [r.skin, r.legs, r.top, r.hair, 0xffffff].forEach((t, q) => { if (parts[q].tint !== t) parts[q].tint = t; });
    const cut = cutAt(seats[r.seat], r.height, heading), was = R.cuts[j] === cut ? R.keys[j] : "";
    R.cuts[j] = cut;
    R.keys[j] = posePerson(parts, P, r.figure, "sit", heading, 0, scale, r.height, was);
    if (cut !== null && R.keys[j] !== was) for (const sp of parts) cutShort(sp, cut * scale);
    for (const sp of parts) sp.position.set(at.x, at.y);
  });
  const o = from.at(k).over;
  R.over.forEach((sp, q) => {
    const l = o[q];
    sp.visible = !!l;
    if (!l) return;
    sp.texture = l.tex; sp.anchor.set(l.anchor.x, l.anchor.y); sp.scale.set(scale / res);
  });
  if (R.over[0].tint !== paint) R.over[0].tint = paint;
}
