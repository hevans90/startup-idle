/**
 * World v2 — boats, drawn.
 *
 * There is no boat in the art set, so a boat is drawn: a hull, a deck, a mast
 * and a sail, worked out in the tile plane round the boat's heading and
 * projected, every frame. That is what lets it face any way at all and ride
 * the water's slope — a sprite has eight facings and no tilt.
 *
 * IN THE BAND OF ITS FRONTMOST POINT, among the movers, so every band of water
 * under it has drawn before it — a boat filed in its middle's band had the
 * band in front's water painted over its bow — and the ground in front of it
 * still covers it. Only the hull ABOVE the waterline is drawn, so nothing has
 * to be cut away where it meets the water. @see BandLayer.dynamicOf
 *
 * THE WAKE goes under them, a segment at a time in the band of its own front
 * end, first among that band's movers so a boat in the same band draws over
 * it. It is foam drawn on the sheet and nothing more. @see wake
 */
import { Container, Graphics, Sprite, Texture } from "pixi.js";

import { HEIGHT_UNIT, HH, HW } from "../iso";
import type { BandLayer } from "../render/bands";
import type { ColumnField } from "../../fluid/columns";
import { type Boat, type Fleet } from "./fleet";
import { classOf } from "./classes";
import { bakedBoats, boatSprites, boatsLoaded, type BoatSprites } from "./boat-sheet";
import { AI_HULL as AI_LIVERY, CONVOY_HULL, LIVERIES, YACHT_HULLS } from "./models";
import { cargoOf, lookOf, slotTint } from "./cargo";
import { HALF_STEPS_PER_M, TILES_PER_M } from "../agents/cars/models";
import { cranesLoaded, craneSprites, framePiece, makePiece, type Piece } from "../structures/cranes/crane-sheet";
import { createWake, stepWake, wakeMarks, type WakeMark } from "./wake";

/** How far the gunwale stands over the water, in half steps. */
const BOARD = 0.55;
/** How tall the mast is over the deck, in half steps. */
const MAST = 3.4;

const HULL = 0xf2efe6;
const HULL_SHADE = 0xc9c3b4;
const STRIPE = 0xb8463a;
/** The Machine's freighter: a violet hull, its stripe a light. */
const AI_HULL = 0x3b3358;
const AI_HULL_SHADE = 0x2a2440;
const AI_LIGHT = 0xb44aff;
const DECK = 0xa9773f;
const DECK_EDGE = 0x6d4a25;
const SAIL = 0xfbf8f0;
const MAST_COLOUR = 0x5a3d22;
const FOAM = 0xffffff;
/** Two marks further apart than this, tiles, are not one arm: water drained between. */
const WAKE_GAP = 0.5;

/**
 * The hull's outline at the gunwale, along the bow and across the beam, as
 * shares of the length and the beam: a pointed bow, a square stern.
 */
const OUTLINE: readonly (readonly [number, number])[] = [
  [0.5, 0], [0.24, 0.5], [-0.34, 0.48], [-0.5, 0.34],
  [-0.5, -0.34], [-0.34, -0.48], [0.24, -0.5],
];

export type BoatLayer = {
  /** Step the wake by `dt` and draw it and every boat on `c`'s water; `night`, how dark it is, 0–1, lights their lamps. */
  draw: (fleet: Fleet, c: ColumnField, scale: number, dt: number, night?: number) => void;
  destroy: () => void;
};

export function createBoatLayer(bands: BandLayer): BoatLayer {
  const drawn = new Map<number, { g: Graphics; band: number }>();
  // THE BAKED FLEET, once its sheet is in: a container a boat. Until then,
  // and with `?boats=drawn`, the drawn boat.
  //
  // A SHIP WITH CARGO is drawn in this order: her hull; her house, if it is
  // the further from the camera; her boxes, one sprite each, far to near; her
  // house again, if it is the nearer. There are two houses and only one is
  // seen, and the boxes' sprites never change order — each is given whichever
  // box is next furthest — so nothing is reordered as she turns or is worked.
  type Group = { sp: Sprite[]; look: string; frame: number };
  type Baked = {
    c: Container; hull: Group; back: Group; front: Group; boxes: Piece[];
    band: number; lit: number; shown: string;
  };
  const baked = new Map<number, Baked>();
  if (bakedBoats()) { void boatSprites(); void craneSprites(); }
  /** The colours a hull's lights are lit in, in the marks' order: windows and white lights, port, starboard. */
  const LIGHTS = [0xffe2a8, 0xff4a3a, 0x4dff8a];
  const group = (P: BoatSprites, c: Container, tint: number): Group => ({
    look: "", frame: -1,
    sp: Array.from({ length: P.layers + P.marks }, (_, k) => {
      const sp = new Sprite();
      if (k === 0) sp.tint = tint;
      if (k >= P.layers) { sp.blendMode = "add"; sp.tint = LIGHTS[k - P.layers] ?? 0xffffff; sp.alpha = 0; }
      c.addChild(sp);
      return sp;
    }),
  });
  const turn = (P: BoatSprites, g: Group, look: string, frame: number) => {
    if (g.look === look && g.frame === frame) return;
    const f = P.boats.get(look)?.[frame];
    g.sp.forEach((sp, k) => { sp.texture = f ? f.tex[k] : Texture.EMPTY; if (f) sp.anchor.set(f.anchor[k].x, f.anchor[k].y); });
    g.look = look; g.frame = frame;
  };
  const drawBaked = (P: BoatSprites, b: Boat, s: number, night: number) => {
    const cls = classOf(b.cls);
    const look = lookOf(b.cls ?? 0, b.fit, !!b.ai, b.id % 2 === 1);
    if (!P.boats.has(look)) return;
    const cargo = cargoOf(look), CP = cranesLoaded();
    const step = (Math.PI * 2) / P.headings;
    const frame = ((Math.round(b.heading / step) % P.headings) + P.headings) % P.headings;
    let d = baked.get(b.id);
    if (!d) {
      const c = new Container();
      c.eventMode = "none";
      const tint = b.ai ? AI_LIVERY : b.convoy ? CONVOY_HULL : look === "yacht" ? YACHT_HULLS[b.id % YACHT_HULLS.length] : LIVERIES[b.id % LIVERIES.length];
      const hull = group(P, c, tint), back = group(P, c, tint);
      // One sprite a slot, in the order they are drawn; which box each shows is settled as she turns.
      const boxes = cargo && CP ? cargo.slots.map(() => { const pc = makePiece(CP, c, cargo.kind, 0, 0xffffff, 1); pc.c.scale.set(P.res / CP.res); pc.c.alpha = 0; return pc; }) : [];
      d = { c, hull, back, front: group(P, c, tint), boxes, band: -1, lit: -1, shown: "" };
      baked.set(b.id, d);
    }
    turn(P, d.hull, look, frame);
    // HER HOUSE, behind her boxes or in front of them: whichever of the two is nearer the camera as she heads.
    const h0 = frame * step, ch0 = Math.cos(h0), sh0 = Math.sin(h0);
    const houseNear = !!cargo && cargo.house * (ch0 + sh0) > 0;
    turn(P, d.back, cargo && !houseNear ? `${look}-house` : "", frame);
    turn(P, d.front, cargo && houseNear ? `${look}-house` : "", frame);
    // HER BOXES: those aboard, the furthest from the camera on the first sprite.
    const n = Math.max(0, Math.min(d.boxes.length, b.boxes ?? 0));
    const shown = `${frame}|${n}`;
    if (cargo && CP && d.boxes.length && shown !== d.shown) {
      const tall = cargo.kind === "box" ? 2.2 : 1.3;
      const at = cargo.slots.slice(0, n).map((sl, k) => {
        const u = (sl.x * ch0 - sl.y * sh0) * TILES_PER_M, v = (sl.x * sh0 + sl.y * ch0) * TILES_PER_M;
        return { k, u, v, z: sl.z * HALF_STEPS_PER_M, key: u + v + sl.z / (tall * 40) };
      }).sort((p, q) => p.key - q.key);
      d.boxes.forEach((pc, i) => {
        const a = at[i];
        if (!a) { pc.c.alpha = 0; return; }
        framePiece(CP, pc, frame);
        pc.sp[0].tint = slotTint(cargo.kind, b.id, a.k);
        pc.c.position.set((a.u - a.v) * HW * P.res, ((a.u + a.v) * HH - a.z * HEIGHT_UNIT) * P.res);
        pc.c.alpha = 1;
      });
      d.shown = shown;
    }
    // LIT as it gets dark; by alpha, never by showing and hiding. @see render-group-rebuilds
    const lit = Math.round(Math.min(1, Math.max(0, (night - 0.35) / 0.3)) * 20) / 20;
    if (lit !== d.lit) { for (const g of [d.hull, d.back, d.front]) for (let k = P.layers; k < g.sp.length; k++) g.sp[k].alpha = lit; d.lit = lit; }
    d.c.scale.set(s / P.res);
    d.c.position.set((b.x - b.y) * HW * s, (b.x + b.y) * HH * s - b.z * HEIGHT_UNIT * s);
    // A little of the water's roll, as a lean.
    d.c.rotation = Math.max(-0.08, Math.min(0.08, b.roll * 0.05));
    // THE BAND OF ITS FRONTMOST CORNER. @see the note at the top
    const ch = Math.cos(b.heading), sh = Math.sin(b.heading), l = cls.length / 2, w = cls.beam / 2;
    let front = -Infinity;
    for (const [a, e] of [[l, w], [l, -w], [-l, w], [-l, -w]]) front = Math.max(front, Math.round(b.x + a * ch - e * sh) + Math.round(b.y + a * sh + e * ch));
    const band = Math.max(0, Math.min(bands.bands.length - 1, front));
    if (band !== d.band) {
      d.c.parent?.removeChild(d.c);
      bands.dynamicOf[band].addChild(d.c);
      d.band = band;
    }
  };
  const wake = createWake();
  /** One Graphics of foam per band that has had any, cleared every frame. */
  const foam = new Map<number, Graphics>();
  const foamOf = (band: number) => {
    let g = foam.get(band);
    if (!g) {
      g = new Graphics();
      g.eventMode = "none";
      bands.dynamicOf[band].addChildAt(g, 0);
      foam.set(band, g);
    }
    return g;
  };

  const drawWake = (marks: WakeMark[], s: number) => {
    for (const g of foam.values()) g.clear();
    const bandsN = bands.bands.length;
    const px = (p: { x: number; y: number; z: number }) => (p.x - p.y) * HW * s;
    const py = (p: { x: number; y: number; z: number }) => (p.x + p.y) * HH * s - p.z * HEIGHT_UNIT * s;
    const bandOf = (a: { x: number; y: number }, b: { x: number; y: number }) =>
      Math.max(0, Math.min(bandsN - 1,
        Math.max(Math.round(a.x) + Math.round(a.y), Math.round(b.x) + Math.round(b.y))));
    const seg = (
      a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number },
      width: number, alpha: number,
    ) => {
      if (alpha < 0.02) return;
      foamOf(bandOf(a, b)).moveTo(px(a), py(a)).lineTo(px(b), py(b))
        .stroke({ color: FOAM, width: Math.max(1, width * s), alpha, cap: "round" });
    };
    // ONE BOAT'S MARKS AT A TIME: every boat drops its points into the one
    // list as it goes, so neighbours in it are as often two boats as one.
    const byBoat = new Map<number, WakeMark[]>();
    for (const m of marks) {
      const l = byBoat.get(m.boat);
      if (l) l.push(m); else byBoat.set(m.boat, [m]);
    }
    for (const trail of byBoat.values()) for (let k = 1; k < trail.length; k++) {
      const a = trail[k - 1], b = trail[k];
      if (Math.hypot(a.mid.x - b.mid.x, a.mid.y - b.mid.y) > WAKE_GAP) continue;
      // The churned water straight behind, wide and soon gone; then the arms.
      seg(a.mid, b.mid, 7, 0.6 * Math.min(a.churn, b.churn));
      const arm = 0.95 * Math.min(a.arm, b.arm);
      seg(a.left, b.left, 3, arm);
      seg(a.right, b.right, 3, arm);
    }
  };

  const draw = (fleet: Fleet, c: ColumnField, scale: number, dt: number, night = 0) => {
    stepWake(wake, fleet, dt);
    drawWake(wakeMarks(wake, c), scale);
    const live = new Set<number>();
    const P = bakedBoats() ? boatsLoaded() : null;
    for (const b of fleet.boats) {
      live.add(b.id);
      if (P) { drawBaked(P, b, scale, night); continue; }
      let d = drawn.get(b.id);
      if (!d) {
        const g = new Graphics();
        g.eventMode = "none";
        d = { g, band: -1 };
        drawn.set(b.id, d);
      }
      const band = drawBoat(d.g, b, scale, bands.bands.length);
      if (band !== d.band) {
        d.g.parent?.removeChild(d.g);
        bands.dynamicOf[band].addChild(d.g);
        d.band = band;
      }
    }
    for (const [id, d] of drawn) {
      if (live.has(id) && !P) continue;
      d.g.destroy();
      drawn.delete(id);
    }
    for (const [id, d] of baked) {
      if (live.has(id)) continue;
      d.c.destroy({ children: true });
      baked.delete(id);
    }
  };

  return {
    draw,
    destroy: () => {
      for (const d of drawn.values()) d.g.destroy();
      drawn.clear();
      for (const d of baked.values()) d.c.destroy({ children: true });
      baked.clear();
      for (const g of foam.values()) g.destroy();
      foam.clear();
    },
  };
}

/** Draw one boat; answers the band it belongs in. */
function drawBoat(g: Graphics, b: Boat, s: number, bandsN: number): number {
  const ch = Math.cos(b.heading), sh = Math.sin(b.heading);
  /**
   * A point on the boat, `l` along the bow and `w` across the beam in tiles,
   * `up` half steps over the waterline: into the tile plane, tilted with the
   * water, and onto the screen.
   */
  const at = (l: number, w: number, up: number) => {
    const u = b.x + l * ch - w * sh;
    const v = b.y + l * sh + w * ch;
    const z = b.z + up + l * b.pitch + w * b.roll;
    return { u, v, px: (u - v) * HW * s, py: (u + v) * HH * s - z * HEIGHT_UNIT * s };
  };
  const cls = classOf(b.cls), BOAT_LENGTH = cls.length, BOAT_BEAM = cls.beam;
  // A bigger hull stands higher out of the water.
  const FREEBOARD = BOARD * (1 + 0.5 * (b.cls ?? 0));
  const rim = OUTLINE.map(([l, w]) => at(l * BOAT_LENGTH, w * BOAT_BEAM, FREEBOARD));
  const sea = OUTLINE.map(([l, w]) => at(l * BOAT_LENGTH * 0.94, w * BOAT_BEAM * 0.86, 0));

  g.clear();
  // THE SIDES THAT FACE THE CAMERA, which looks down the +x +y diagonal: an
  // edge whose outward normal points that way is seen, the rest are behind
  // the deck. Lit a little from the left, so the two faces of a corner read.
  const n = OUTLINE.length;
  for (let k = 0; k < n; k++) {
    const a = rim[k], c = rim[(k + 1) % n];
    // Outward normal in the tile plane, for an outline wound this way round.
    const nu = c.v - a.v, nv = -(c.u - a.u);
    if (nu + nv <= 0) continue;
    const lit = nu > nv;
    g.poly([a.px, a.py, c.px, c.py, sea[(k + 1) % n].px, sea[(k + 1) % n].py, sea[k].px, sea[k].py]);
    g.fill({ color: b.ai ? (lit ? AI_HULL : AI_HULL_SHADE) : lit ? HULL : HULL_SHADE });
    // A stripe under the gunwale.
    const a2 = at(OUTLINE[k][0] * BOAT_LENGTH, OUTLINE[k][1] * BOAT_BEAM, FREEBOARD * 0.62);
    const c2 = at(OUTLINE[(k + 1) % n][0] * BOAT_LENGTH, OUTLINE[(k + 1) % n][1] * BOAT_BEAM, FREEBOARD * 0.62);
    g.poly([a.px, a.py, c.px, c.py, c2.px, c2.py, a2.px, a2.py]);
    g.fill({ color: b.ai ? AI_LIGHT : STRIPE });
  }
  // THE DECK, at the gunwale, and its edge.
  g.poly(rim.flatMap((p) => [p.px, p.py]));
  g.fill({ color: DECK });
  g.stroke({ color: DECK_EDGE, width: Math.max(1, 1.2 * s), alpha: 0.9 });

  // THE MACHINE'S FREIGHTER: no mast, no wheelhouse, nobody aboard — a
  // light at the bow. @see Boat.ai
  if (b.ai) {
    const bow = at(BOAT_LENGTH * 0.46, 0, FREEBOARD + 0.4);
    g.circle(bow.px, bow.py, Math.max(1.5, 2.2 * s));
    g.fill({ color: AI_LIGHT, alpha: 0.95 });
    let front = -Infinity;
    for (const p of rim) front = Math.max(front, Math.round(p.u) + Math.round(p.v));
    return Math.max(0, Math.min(bandsN - 1, front));
  }

  // A COASTER OR A SHIP: no sail — a hold of cargo amidships and a
  // wheelhouse aft, its sides the camera sees and its roof.
  if (b.cls) {
    const block = (l0: number, l1: number, half: number, up: number, top: number, lit: number, shade: number) => {
      const c = [at(l0, -half, FREEBOARD), at(l1, -half, FREEBOARD), at(l1, half, FREEBOARD), at(l0, half, FREEBOARD)];
      const r = [at(l0, -half, FREEBOARD + up), at(l1, -half, FREEBOARD + up), at(l1, half, FREEBOARD + up), at(l0, half, FREEBOARD + up)];
      for (let k = 0; k < 4; k++) {
        const a = c[k], n2 = c[(k + 1) % 4];
        const nu = n2.v - a.v, nv = -(n2.u - a.u);
        if (nu + nv <= 0) continue;
        g.poly([r[k].px, r[k].py, r[(k + 1) % 4].px, r[(k + 1) % 4].py, n2.px, n2.py, a.px, a.py]);
        g.fill({ color: nu > nv ? lit : shade });
      }
      g.poly(r.flatMap((p) => [p.px, p.py]));
      g.fill({ color: top });
    };
    const L = BOAT_LENGTH, W = BOAT_BEAM;
    // Drawn far end first, by which way it faces the camera.
    const parts: [number, () => void][] = [
      [-0.36, () => block(-0.44 * L, -0.28 * L, 0.34 * W, 1.6 + 0.5 * b.cls!, 0xf4f1e8, 0xe9e5d8, 0xbdb7a6)],
      [0.02, () => block(-0.22 * L, 0.3 * L, 0.36 * W, 0.7 + 0.35 * b.cls!, b.cls === 2 ? 0x3f6e9c : 0x9c6b3a, b.cls === 2 ? 0x3f6e9c : 0x9c6b3a, b.cls === 2 ? 0x2f5478 : 0x7a5229)],
    ];
    parts.sort((p, q) => (p[0] - q[0]) * (ch + sh));
    for (const [, drawPart] of parts) drawPart();
    let front = -Infinity;
    for (const p of rim) front = Math.max(front, Math.round(p.u) + Math.round(p.v));
    return Math.max(0, Math.min(bandsN - 1, front));
  }

  // THE MAST and A SAIL off it, toward the stern.
  const foot = at(BOAT_LENGTH * 0.08, 0, FREEBOARD);
  const top = at(BOAT_LENGTH * 0.08, 0, FREEBOARD + MAST);
  const boom = at(-BOAT_LENGTH * 0.36, 0, FREEBOARD + 0.5);
  const low = at(BOAT_LENGTH * 0.08, 0, FREEBOARD + 0.5);
  g.poly([top.px, top.py, low.px, low.py, boom.px, boom.py]);
  g.fill({ color: SAIL, alpha: 0.95 });
  g.moveTo(foot.px, foot.py).lineTo(top.px, top.py);
  g.stroke({ color: MAST_COLOUR, width: Math.max(1, 2 * s) });

  // THE BAND OF ITS FRONTMOST POINT. @see the note at the top
  let front = -Infinity;
  for (const p of rim) front = Math.max(front, Math.round(p.u) + Math.round(p.v));
  return Math.max(0, Math.min(bandsN - 1, front));
}
