/**
 * World v2 — the town's traffic, drawn.
 *
 * Drawn the way the boats are, there being no car or person in the art set:
 * outlines worked out in the tile plane round each one's heading, stood up to
 * a height, and projected — only the sides that face the camera, lit a little
 * from the left. A car is a body and a cabin on it. @see boats-render
 *
 * A PERSON WALKS: two legs swinging through a stride, each bending at the knee
 * as it comes through, two arms swinging against them, a torso that rises and
 * falls with each step, and a head with hair. The stride is as long as the
 * ground covered, so feet do not skate. Limbs on the far side from the camera
 * are drawn first and a shade darker, so they read as behind. @see STRIDE
 *
 * IN THE BAND OF ITS FRONTMOST POINT, among the movers, and ordered within the
 * band by how far into it it is, so the ground in front of it covers it and
 * two cars side by side overlap the right way round. @see BandLayer.dynamicOf
 */
import { Graphics } from "pixi.js";

import { HEIGHT_UNIT, HH, HW } from "../iso";
import type { BandLayer } from "../render/bands";
import { HALF_STEP_IN_TILES, LEG, SWING, type Mover, type Town } from "./town";

/** A car, tiles long and wide, and its body and cabin heights in half steps. */
const CAR_L = 0.38;
const CAR_W = 0.2;
const BODY = 0.42;
const CABIN = 0.78;
/**
 * A person, in half steps up and tiles across: hip and shoulder heights, the
 * leg and arm lengths, the head's height, and the hips' and shoulders' half
 * widths. @see drawPerson
 */
const HIP = 0.5;
const SHOULDER = 0.92;
const ARM = 0.38;
const HEAD = 1.1;
const HIP_W = 0.022;
const SHOULDER_W = 0.036;
/** How far the knee bends as the leg comes through. */
const KNEE = 0.7;

const GLASS = 0x2a3a4a;
const HARD_HAT = 0xf2c230;
/** A lorry: tiles long and wide, its cab's height, and its load. */
const TRUCK_L = 0.56;
const TRUCK_W = 0.24;
const TRUCK_CAB = 0.7;
const BED = 0x5b5f66;
const LOAD = 0xb08a55;
const LOAD_TOP = 0xc9a46c;
const SKINS = [0xf1d0b0, 0xe0b48e, 0xc68c5d, 0x9c6a43, 0x6e4a2f];
const HAIRS = [0x2b2118, 0x4a3324, 0x8a5a2b, 0xd9b26a, 0x1c1c1c, 0x9a9a9a];
const TROUSERS = [0x3a3f4b, 0x2f4a6b, 0x5b4a3a, 0x2b2b2b, 0x6b6f75];

/** One of a list, the same one for the same mover every frame. */
const ofId = <T>(id: number, salt: number, list: readonly T[]) =>
  list[Math.abs(Math.imul(id ^ salt, 0x9e3779b1) >>> 7) % list.length];

/** Darker, by a share. */
const shade = (c: number, k: number) =>
  (Math.round(((c >> 16) & 255) * k) << 16) | (Math.round(((c >> 8) & 255) * k) << 8) | Math.round((c & 255) * k);

export type TownLayer = { draw: (town: Town, scale: number) => void; destroy: () => void };

export function createTownLayer(bands: BandLayer): TownLayer {
  const drawn = new Map<number, { g: Graphics; band: number }>();

  const draw = (town: Town, scale: number) => {
    const live = new Set<number>();
    for (const m of town.movers) {
      live.add(m.id);
      let d = drawn.get(m.id);
      if (!d) {
        const g = new Graphics();
        g.eventMode = "none";
        d = { g, band: -1 };
        drawn.set(m.id, d);
      }
      const band = drawMover(d.g, m, scale, bands.bands.length);
      if (band !== d.band) {
        d.g.parent?.removeChild(d.g);
        bands.dynamicOf[band].addChild(d.g);
        d.band = band;
      }
      d.g.zIndex = m.x + m.y - band;
    }
    for (const [id, d] of drawn) {
      if (live.has(id)) continue;
      d.g.destroy();
      drawn.delete(id);
    }
  };

  return {
    draw,
    destroy: () => {
      for (const d of drawn.values()) d.g.destroy();
      drawn.clear();
    },
  };
}

/** Draw one; answers the band it belongs in. Exported for a harness to draw one still. */
export function drawMover(g: Graphics, m: Mover, s: number, bandsN: number): number {
  const ch = Math.cos(m.heading), sh = Math.sin(m.heading);
  // The body is highest mid-stride, over a straight leg, and lowest between.
  const bob = m.kind === "person" && m.job?.role !== "working" ? Math.abs(Math.cos(m.phase)) * 0.05 : 0;
  /** `l` along the heading and `w` across it, tiles, `up` half steps over the road. */
  const at = (l: number, w: number, up: number) => {
    const u = m.x + l * ch - w * sh;
    const v = m.y + l * sh + w * ch;
    const tilt = (m.pitch ?? 0) * l;
    return { u, v, px: (u - v) * HW * s, py: (u + v) * HH * s - (m.z + up + bob + tilt) * HEIGHT_UNIT * s };
  };
  /**
   * An outline stood up from `z0` to `z1`: the sides that face the camera,
   * then the top. The outline is wound so its outward normal is (dv, −du).
   */
  const prism = (outline: readonly (readonly [number, number])[], z0: number, z1: number, colour: number, top = colour) => {
    const lo = outline.map(([l, w]) => at(l, w, z0));
    const hi = outline.map(([l, w]) => at(l, w, z1));
    const n = outline.length;
    for (let k = 0; k < n; k++) {
      const a = hi[k], b = hi[(k + 1) % n];
      const nu = b.v - a.v, nv = -(b.u - a.u);
      if (nu + nv <= 0) continue;
      g.poly([a.px, a.py, b.px, b.py, lo[(k + 1) % n].px, lo[(k + 1) % n].py, lo[k].px, lo[k].py]);
      g.fill({ color: nu > nv ? colour : shade(colour, 0.72) });
    }
    g.poly(hi.flatMap((p) => [p.px, p.py]));
    g.fill({ color: top });
    return hi;
  };
  const box = (l: number, w: number) => [[l, w], [-l, w], [-l, -w], [l, -w]] as const;
  /** A box from `l0` forward to `l1` back, `w` either side. */
  const box2 = (l0: number, l1: number, w: number) => [[l0, w], [l1, w], [l1, -w], [l0, -w]] as const;

  g.clear();
  let front: { u: number; v: number }[];
  if (m.kind === "truck") {
    // A LORRY of materials: a cab, and a flatbed behind it stacked with a
    // pallet of something. @see stepWorks
    //
    // IN DEPTH ORDER, the cab and the cargo as two pieces, the further first.
    // Drawn cab-then-cargo always, a lorry turned toward the camera had its
    // load painted over its cab — right only while it was driving away.
    const front0 = TRUCK_L / 2, cabBack = TRUCK_L * 0.18;
    // THE CAB: a solid lower body, and over it a cabin of glass sides with a
    // painted roof — as the car's is. A windscreen drawn as a box of its own
    // inside the cab put its dark top through the cab's roof, a hole in it.
    const drawCab = () => {
      prism([[front0, TRUCK_W / 2], [cabBack, TRUCK_W / 2], [cabBack, -TRUCK_W / 2], [front0, -TRUCK_W / 2]],
        0.04, TRUCK_CAB * 0.55, m.colour);
      prism([[front0 - 0.02, TRUCK_W * 0.46], [cabBack, TRUCK_W * 0.46], [cabBack, -TRUCK_W * 0.46], [front0 - 0.02, -TRUCK_W * 0.46]],
        TRUCK_CAB * 0.55, TRUCK_CAB, GLASS, shade(m.colour, 0.92));
    };
    const drawCargo = () => {
      prism(box2(cabBack - 0.02, -TRUCK_L / 2, TRUCK_W / 2), 0.04, 0.32, BED);
      prism(box2(cabBack - 0.06, -TRUCK_L / 2 + 0.05, TRUCK_W * 0.4), 0.32, 0.72, LOAD, LOAD_TOP);
    };
    // Nearer the camera is further along u + v; the cab is ahead along the heading.
    const cabNearer = ch + sh > 0;
    if (cabNearer) { drawCargo(); drawCab(); } else { drawCab(); drawCargo(); }
    // ITS BAND from the whole lorry, not the cab: driving away, its tail is
    // the nearest part, and filed by the cab the ground in front painted over it.
    front = [front0, -TRUCK_L / 2].flatMap((l) => [at(l, TRUCK_W / 2, 0), at(l, -TRUCK_W / 2, 0)]);
  } else if (m.kind === "car") {
    const body = prism(box(CAR_L / 2, CAR_W / 2), 0.04, BODY, m.colour);
    // The cabin, set back from the bonnet, glass on its sides.
    prism([[CAR_L * 0.12, CAR_W * 0.42], [-CAR_L * 0.32, CAR_W * 0.42], [-CAR_L * 0.32, -CAR_W * 0.42], [CAR_L * 0.12, -CAR_W * 0.42]],
      BODY, CABIN, GLASS, shade(m.colour, 0.9));
    front = body;
  } else {
    front = drawPerson(g, m, s, at, prism);
  }
  let band = -Infinity;
  for (const p of front) band = Math.max(band, Math.round(p.u) + Math.round(p.v));
  return Math.max(0, Math.min(bandsN - 1, band));
}

type At = (l: number, w: number, up: number) => { u: number; v: number; px: number; py: number };
type Prism = (
  outline: readonly (readonly [number, number])[], z0: number, z1: number, colour: number, top?: number,
) => { u: number; v: number; px: number; py: number }[];

/**
 * A person mid-stride. Their phase runs π a step: the legs swing opposite
 * ways through `SWING` either side of down, the one coming through bent at the
 * knee, and each arm swings against the leg on its side.
 */
function drawPerson(g: Graphics, m: Mover, s: number, at: At, prism: Prism) {
  const skin = ofId(m.id, 0x51, SKINS), legs = ofId(m.id, 0x33, TROUSERS);
  // A BUILDER wears a hard hat, so a crew can be told from a crowd. @see stepWorks
  const hair = m.job ? HARD_HAT : ofId(m.id, 0x7a, HAIRS);
  const ch = Math.cos(m.heading), sh = Math.sin(m.heading);
  // Which side is nearer the camera, which looks down the +u +v diagonal.
  const nearSide = -sh + ch >= 0 ? 1 : -1;
  const px = (n: number) => Math.max(1, n * Math.hypot(HW, HH) * s);

  /** A limb from a joint: `angle` forward of straight down, in the person's own plane. */
  const swing = (from: { l: number; up: number }, len: number, angle: number) => ({
    l: from.l + Math.sin(angle) * len * HALF_STEP_IN_TILES,
    up: from.up - Math.cos(angle) * len,
  });
  /** A limb through its joints, `w` tiles to the side of the body's middle. */
  const limb = (w: number, pts: { l: number; up: number }[], colour: number, width: number) => {
    g.moveTo(...xy(at(pts[0].l, w, pts[0].up)));
    for (const p of pts.slice(1)) g.lineTo(...xy(at(p.l, w, p.up)));
    g.stroke({ color: colour, width: px(width), cap: "round", join: "round" });
  };
  const xy = (p: { px: number; py: number }): [number, number] => [p.px, p.py];

  const working = m.job?.role === "working";
  const parts = (side: number) => {
    // AT WORK: feet planted, and a hammer arm — the near one — beating.
    if (working) {
      const hip = { l: 0, up: HIP };
      const foot = { l: side * 0.004, up: 0 };
      const knee = { l: 0.01, up: HIP / 2 };
      const shoulder = { l: 0, up: SHOULDER - 0.04 };
      const beat = side === nearSide ? 1.2 + 0.9 * Math.sin(m.phase) : 0.5;
      const elbow = swing(shoulder, ARM / 2, beat);
      const hand = swing(elbow, ARM / 2, beat + 0.6);
      return { leg: [hip, knee, foot], arm: [shoulder, elbow, hand] };
    }
    const p = m.phase + (side > 0 ? 0 : Math.PI);
    const thigh = SWING * Math.sin(p);
    // The knee bends as the leg comes forward through the stride.
    const bend = KNEE * Math.max(0, Math.cos(p));
    const hip = { l: 0, up: HIP };
    const knee = swing(hip, LEG / 2, thigh);
    const foot = swing(knee, LEG / 2, thigh - bend);
    const arm = -0.8 * thigh;
    const shoulder = { l: 0, up: SHOULDER - 0.04 };
    const elbow = swing(shoulder, ARM / 2, arm);
    const hand = swing(elbow, ARM / 2, arm + 0.35);
    return { leg: [hip, knee, foot], arm: [shoulder, elbow, hand] };
  };
  const dim = (c: number) => shade(c, 0.78);

  // THE FAR SIDE first, darker, then the body, then the near side over it.
  const far = parts(-nearSide), near = parts(nearSide);
  limb(-nearSide * HIP_W, far.leg, dim(legs), 0.026);
  limb(-nearSide * SHOULDER_W, far.arm, dim(m.colour), 0.02);
  const torso = prism(
    [[0.022, SHOULDER_W], [-0.022, SHOULDER_W], [-0.022, -SHOULDER_W], [0.022, -SHOULDER_W]],
    HIP - 0.04, SHOULDER, m.colour,
  );
  limb(nearSide * HIP_W, near.leg, legs, 0.026);
  limb(nearSide * SHOULDER_W, near.arm, m.colour, 0.02);
  // Hands.
  for (const [side, arm, c] of [[-nearSide, far.arm, dim(skin)], [nearSide, near.arm, skin]] as const) {
    const h = at(arm[2].l, side * SHOULDER_W, arm[2].up);
    g.circle(h.px, h.py, px(0.012));
    g.fill({ color: c });
  }
  // THE HEAD, and hair over the top and back of it.
  const head = at(0, 0, HEAD), r = px(0.034);
  g.circle(head.px, head.py, r);
  g.fill({ color: skin });
  const back = at(-0.012, 0, HEAD + 0.02);
  g.moveTo(back.px - r, back.py).arc(back.px, back.py, r, Math.PI, 0).closePath();
  g.fill({ color: hair });
  return torso;
}
