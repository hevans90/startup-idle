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
import { Container, Graphics, Matrix, Rectangle, RenderTexture, Sprite, Texture, type Renderer } from "pixi.js";

import { HEIGHT_UNIT, HH, HW } from "../iso";
import type { BandLayer } from "../render/bands";
import { AI_TRUCK_COLOUR, atWork, HALF_STEP_IN_TILES, LEG, SWING, type Mover, type Town } from "./town";

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
/** A bus and a limousine: tiles long and wide. */
const BUS_L = 0.62;
const BUS_W = 0.24;
const BUS_SKIRT = 0.5;
const BUS_ROOF = 0.98;
const BUS_STRIPE = 0x2b2f36;
const LIMO_L = 0.6;
const LIMO_W = 0.21;
const CHROME = 0xd8dde3;
const BED = 0x5b5f66;
const LOAD = 0xb08a55;
const LOAD_TOP = 0xc9a46c;
/** The Machine's lorry: its light bar, and its crates. */
const AI_LIGHT_BAR = 0xb44aff;
const AI_LOAD = 0x2a2440;
const AI_LOAD_TOP = 0x3b3358;
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

/**
 * MOVERS AS SPRITES, from one atlas. Each look is drawn ONCE, by the drawing
 * below, into a page of a shared texture — and a mover is a sprite put where
 * it is and shown the frame for how it looks now. Moving a sprite, or showing
 * it another frame of the same page, is nothing to the renderer; redrawing a
 * Graphics, or handing it another drawing, rebuilt its band's whole draw list
 * — for nine hundred movers, most of a frame, every frame. @see Atlas
 *
 * A VEHICLE is one sprite, baked in its own colour — the colours are a short
 * palette. A PERSON is four, stacked — trousers, shirt, skin, hair — each
 * baked in white with its shading, and tinted: a tint multiplies, so a white
 * part shaded to 0.72 tinted blue is the blue shaded to 0.72 the drawing gave.
 * So every outfit shares one set of frames: a heading by a stride.
 *
 * Baked at `BAKE` texels to a unit of the map, so close in they stay sharp to
 * well past the usual zoom.
 */
export const HEADINGS = { vehicle: 32, person: 16 } as const;
export const STRIDES = 12;
const BAKE = 3;
const PAGE = 2048;
const PAD = 2;
const PERSON_PARTS = ["legs", "shirt", "skin", "hair"] as const;
const WHITE = { skin: 0xffffff, legs: 0xffffff, hair: 0xffffff };

/** A mover's look, as a key, and the mover to draw it from: at the origin, heading and stride snapped. */
export function lookOf(m: Mover): { key: string; canon: Mover } {
  const n = m.kind === "person" ? HEADINGS.person : HEADINGS.vehicle;
  const step = (Math.PI * 2) / n;
  const h = ((Math.round(m.heading / step) % n) + n) % n;
  const pitch = Math.round((m.pitch ?? 0) * 20) / 20;
  let phase = m.phase, key: string;
  if (m.kind === "person") {
    // Every outfit shares a person's frames: only the pose is in the key.
    const p = (((m.phase % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)) / (Math.PI * 2);
    const f = Math.round(p * STRIDES) % STRIDES;
    phase = (f / STRIDES) * Math.PI * 2;
    key = `person|${h}|${atWork(m) ? "w" : ""}${f}`;
  } else key = `${m.kind}|${m.colour}|${h}|${pitch}`;
  return { key, canon: { ...m, x: 0, y: 0, z: 0, heading: h * step, phase, pitch, ...(m.kind === "person" ? { colour: 0xffffff } : {}) } };
}

/** A baked frame: its texture, where the mover's foot is in it, and its base's points for the band. */
type Frame = { tex: Texture; ax: number; ay: number };
type Look = { frames: Frame[]; front: { u: number; v: number }[] };

/** Pages of baked frames, packed in shelves. */
function createAtlas(renderer: Renderer) {
  const pages: RenderTexture[] = [];
  let x = PAGE, y = 0, shelf = 0;
  return {
    /** Bake `g` into a free slot; its frame, anchored at the drawing's origin. */
    add(g: Graphics): Frame {
      const b = g.getLocalBounds();
      const w = Math.max(1, Math.ceil(b.width * BAKE)) + 2 * PAD, h = Math.max(1, Math.ceil(b.height * BAKE)) + 2 * PAD;
      if (x + w > PAGE) { x = 0; y += shelf; shelf = 0; }
      if (!pages.length || y + h > PAGE) {
        pages.push(RenderTexture.create({ width: PAGE, height: PAGE, antialias: true }));
        x = 0; y = 0; shelf = 0;
      }
      const page = pages[pages.length - 1];
      const sx = x, sy = y;
      // The drawing's origin — the mover's foot — lands here in the page.
      const ox = sx + PAD - b.x * BAKE, oy = sy + PAD - b.y * BAKE;
      renderer.render({ container: g, target: page, clear: false, transform: new Matrix(BAKE, 0, 0, BAKE, ox, oy) });
      const tex = new Texture({ source: page.source, frame: new Rectangle(sx, sy, w, h) });
      x += w; shelf = Math.max(shelf, h);
      return { tex, ax: (ox - sx) / w, ay: (oy - sy) / h };
    },
    destroy() { for (const p of pages) p.destroy(true); pages.length = 0; },
  };
}

/** One mover on the map: a container of its sprites — one for a vehicle, a part each for a person. */
type Shown = { c: Container; parts: Sprite[]; band: number; key: string };

export function createTownLayer(bands: BandLayer, renderer: Renderer): TownLayer {
  const drawn = new Map<number, Shown>();
  const looks = new Map<string, Look>();
  let atlas = createAtlas(renderer), atScale = NaN;

  const bake = (m: Mover, scale: number): Look => {
    const { key, canon } = lookOf(m);
    let look = looks.get(key);
    if (look) return look;
    const frames: Frame[] = [];
    let front: { u: number; v: number }[] = [];
    if (m.kind === "person") {
      for (const part of PERSON_PARTS) {
        const g = new Graphics();
        // The one part, white with its shading; the rest not drawn.
        front = drawMoverFront(g, canon, scale, (p, color) => (p === part ? { color } : { color: 0, alpha: 0 }), WHITE);
        frames.push(atlas.add(g));
        g.destroy();
      }
    } else {
      const g = new Graphics();
      front = drawMoverFront(g, canon, scale);
      frames.push(atlas.add(g));
      g.destroy();
    }
    look = { frames, front };
    looks.set(key, look);
    return look;
  };

  const draw = (town: Town, scale: number) => {
    // A new scale is every look baked again.
    if (scale !== atScale) {
      atlas.destroy(); atlas = createAtlas(renderer); looks.clear(); atScale = scale;
      for (const d of drawn.values()) d.key = "";
    }
    const live = new Set<number>();
    for (const m of town.movers) {
      // A BUILDER AT WORK is drawn by the site, where the work is: on the
      // frame, on the scaffold, in the yard. Here they would only be stood
      // wherever they were put down. @see projects/crew
      if (m.job?.role === "working") continue;
      live.add(m.id);
      let d = drawn.get(m.id);
      if (!d) {
        const c = new Container();
        c.eventMode = "none";
        const n = m.kind === "person" ? PERSON_PARTS.length : 1;
        const parts = Array.from({ length: n }, () => { const sp = new Sprite(); sp.scale.set(1 / BAKE); c.addChild(sp); return sp; });
        // A person's parts tinted their own colours, once: they never change.
        if (m.kind === "person") {
          const o = outfitOf(m);
          [o.legs, m.colour, o.skin, o.hair].forEach((t, k) => { parts[k].tint = t; });
        }
        d = { c, parts, band: -1, key: "" };
        drawn.set(m.id, d);
      }
      const { key } = lookOf(m);
      const look = looks.get(key) ?? bake(m, scale);
      if (d.key !== key) {
        d.key = key;
        look.frames.forEach((f, k) => { const sp = d!.parts[k]; sp.texture = f.tex; sp.anchor.set(f.ax, f.ay); });
      }
      d.c.position.set((m.x - m.y) * HW * scale, (m.x + m.y) * HH * scale - m.z * HEIGHT_UNIT * scale);
      let band = -Infinity;
      for (const p of look.front) band = Math.max(band, Math.round(m.x + p.u) + Math.round(m.y + p.v));
      band = Math.max(0, Math.min(bands.bands.length - 1, band));
      const z = m.x + m.y - band;
      if (band !== d.band) {
        d.c.parent?.removeChild(d.c);
        d.c.zIndex = z;
        bands.dynamicOf[band].addChild(d.c);
        d.band = band;
      } else if (crosses(d.c, z)) d.c.zIndex = z;
    }
    for (const [id, d] of drawn) {
      if (live.has(id)) continue;
      d.c.destroy({ children: true });
      drawn.delete(id);
    }
  };

  return {
    draw,
    destroy: () => {
      for (const d of drawn.values()) d.c.destroy({ children: true });
      drawn.clear();
      looks.clear();
      atlas.destroy();
    },
  };
}

/**
 * Whether moving a child's depth to `z` would carry it past one of its
 * siblings: only then is its band's order — and so its draw list — changed.
 * Set every frame, every mover's band was sorted and rebuilt every frame.
 */
function crosses(c: Container, z: number): boolean {
  const from = c.zIndex, lo = Math.min(from, z), hi = Math.max(from, z);
  if (lo === hi) return false;
  for (const o of c.parent?.children ?? []) {
    if (o !== c && o.zIndex >= lo && o.zIndex <= hi) return true;
  }
  return false;
}

/** Draw one; answers the band it belongs in. Exported for a harness to draw one still. */
export function drawMover(g: Graphics, m: Mover, s: number, bandsN: number): number {
  let band = -Infinity;
  for (const p of drawMoverFront(g, m, s)) band = Math.max(band, Math.round(p.u) + Math.round(p.v));
  return Math.max(0, Math.min(bandsN - 1, band));
}

/** Draw one; answers the points along its base that decide its band, in tiles. */
export function drawMoverFront(
  g: Graphics, m: Mover, s: number, paint: Paint = asIs, outfit: { skin: number; legs: number; hair: number } = outfitOf(m),
): { u: number; v: number }[] {
  const ch = Math.cos(m.heading), sh = Math.sin(m.heading);
  // The body is highest mid-stride, over a straight leg, and lowest between.
  const bob = m.kind === "person" && !atWork(m) ? Math.abs(Math.cos(m.phase)) * 0.05 : 0;
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
  const prism = (outline: readonly (readonly [number, number])[], z0: number, z1: number, colour: number, top = colour, part: Part = "body") => {
    const lo = outline.map(([l, w]) => at(l, w, z0));
    const hi = outline.map(([l, w]) => at(l, w, z1));
    const n = outline.length;
    for (let k = 0; k < n; k++) {
      const a = hi[k], b = hi[(k + 1) % n];
      const nu = b.v - a.v, nv = -(b.u - a.u);
      if (nu + nv <= 0) continue;
      g.poly([a.px, a.py, b.px, b.py, lo[(k + 1) % n].px, lo[(k + 1) % n].py, lo[k].px, lo[k].py]);
      g.fill(paint(part, nu > nv ? colour : shade(colour, 0.72)));
    }
    g.poly(hi.flatMap((p) => [p.px, p.py]));
    g.fill(paint(part, top));
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
    // THE MACHINE'S LORRY, with Autonomous Freight: white, no glass in its
    // cab — nobody drives it — a violet light bar across the roof, and its
    // load in the AI's dark crates. @see AI_TRUCK_COLOUR
    const ai = m.colour === AI_TRUCK_COLOUR;
    const drawCab = () => {
      prism([[front0, TRUCK_W / 2], [cabBack, TRUCK_W / 2], [cabBack, -TRUCK_W / 2], [front0, -TRUCK_W / 2]],
        0.04, TRUCK_CAB * 0.55, m.colour);
      prism([[front0 - 0.02, TRUCK_W * 0.46], [cabBack, TRUCK_W * 0.46], [cabBack, -TRUCK_W * 0.46], [front0 - 0.02, -TRUCK_W * 0.46]],
        TRUCK_CAB * 0.55, TRUCK_CAB, ai ? shade(m.colour, 0.94) : GLASS, shade(m.colour, 0.92));
      if (ai) prism(box2(cabBack + 0.1, cabBack + 0.02, TRUCK_W * 0.4), TRUCK_CAB, TRUCK_CAB + 0.05, AI_LIGHT_BAR);
    };
    const drawCargo = () => {
      prism(box2(cabBack - 0.02, -TRUCK_L / 2, TRUCK_W / 2), 0.04, 0.32, BED);
      prism(box2(cabBack - 0.06, -TRUCK_L / 2 + 0.05, TRUCK_W * 0.4), 0.32, 0.72, ai ? AI_LOAD : LOAD, ai ? AI_LOAD_TOP : LOAD_TOP);
    };
    // Nearer the camera is further along u + v; the cab is ahead along the heading.
    const cabNearer = ch + sh > 0;
    if (cabNearer) { drawCargo(); drawCab(); } else { drawCab(); drawCargo(); }
    // ITS BAND from the whole lorry, not the cab: driving away, its tail is
    // the nearest part, and filed by the cab the ground in front painted over it.
    front = [front0, -TRUCK_L / 2].flatMap((l) => [at(l, TRUCK_W / 2, 0), at(l, -TRUCK_W / 2, 0)]);
  } else if (m.kind === "bus") {
    // THE INTERNS' BUS: a long yellow box, a band of windows down its sides
    // under a pale roof, and a dark stripe along the skirt.
    const body = prism(box(BUS_L / 2, BUS_W / 2), 0.04, BUS_SKIRT * 0.3, BUS_STRIPE);
    prism(box(BUS_L / 2, BUS_W / 2), BUS_SKIRT * 0.3, BUS_SKIRT, m.colour);
    prism(box(BUS_L / 2 - 0.01, BUS_W / 2 - 0.004), BUS_SKIRT, BUS_ROOF - 0.08, GLASS);
    prism(box(BUS_L / 2, BUS_W / 2), BUS_ROOF - 0.08, BUS_ROOF, m.colour, 0xf4efe2);
    front = body;
  } else if (m.kind === "limo") {
    // THE 10X DEV'S LIMOUSINE: long, low and black, a stretched cabin of dark
    // glass, and a line of chrome along its waist.
    const body = prism(box(LIMO_L / 2, LIMO_W / 2), 0.04, BODY * 0.9, m.colour);
    prism(box(LIMO_L / 2 - 0.005, LIMO_W / 2 + 0.002), BODY * 0.9 - 0.04, BODY * 0.9, CHROME, m.colour);
    prism([[LIMO_L * 0.2, LIMO_W * 0.42], [-LIMO_L * 0.38, LIMO_W * 0.42], [-LIMO_L * 0.38, -LIMO_W * 0.42], [LIMO_L * 0.2, -LIMO_W * 0.42]],
      BODY * 0.9, CABIN * 0.88, 0x1d2630, shade(m.colour, 1.4));
    front = body;
  } else if (m.kind === "car") {
    const body = prism(box(CAR_L / 2, CAR_W / 2), 0.04, BODY, m.colour);
    // The cabin, set back from the bonnet, glass on its sides.
    prism([[CAR_L * 0.12, CAR_W * 0.42], [-CAR_L * 0.32, CAR_W * 0.42], [-CAR_L * 0.32, -CAR_W * 0.42], [CAR_L * 0.12, -CAR_W * 0.42]],
      BODY, CABIN, GLASS, shade(m.colour, 0.9));
    front = body;
  } else {
    front = drawPerson(g, m, s, at, prism, paint, outfit);
  }
  return front.map((p) => ({ u: p.u, v: p.v }));
}

type At = (l: number, w: number, up: number) => { u: number; v: number; px: number; py: number };
type Prism = (
  outline: readonly (readonly [number, number])[], z0: number, z1: number, colour: number, top?: number, part?: Part,
) => { u: number; v: number; px: number; py: number }[];

/** The parts a person is drawn in, each its own colour: a vehicle is all `body`. @see Paint */
export type Part = "body" | "legs" | "shirt" | "skin" | "hair";
/**
 * How a part is filled: as it is, or — baking a person part by part for the
 * atlas — the one part in white, keeping its shading, and the rest not at all,
 * so a tint puts the colour back. @see createTownLayer
 */
export type Paint = (part: Part, colour: number) => { color: number; alpha?: number };
const asIs: Paint = (_part, color) => ({ color });

/** A person's skin, trousers and hair — a hard hat, at work — the same each frame. */
export function outfitOf(m: Mover): { skin: number; legs: number; hair: number } {
  return {
    skin: ofId(m.id, 0x51, SKINS), legs: ofId(m.id, 0x33, TROUSERS),
    // A BUILDER wears a hard hat, so a crew can be told from a crowd. @see stepWorks
    hair: m.job && m.job.role !== "moving-in" ? HARD_HAT : ofId(m.id, 0x7a, HAIRS),
  };
}

/**
 * A person mid-stride. Their phase runs π a step: the legs swing opposite
 * ways through `SWING` either side of down, the one coming through bent at the
 * knee, and each arm swings against the leg on its side.
 */
function drawPerson(g: Graphics, m: Mover, s: number, at: At, prism: Prism, paint: Paint, outfit: { skin: number; legs: number; hair: number }) {
  const { skin, legs, hair } = outfit;
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
  const limb = (w: number, pts: { l: number; up: number }[], part: Part, colour: number, width: number) => {
    g.moveTo(...xy(at(pts[0].l, w, pts[0].up)));
    for (const p of pts.slice(1)) g.lineTo(...xy(at(p.l, w, p.up)));
    g.stroke({ ...paint(part, colour), width: px(width), cap: "round", join: "round" });
  };
  const xy = (p: { px: number; py: number }): [number, number] => [p.px, p.py];

  const working = atWork(m);
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
  limb(-nearSide * HIP_W, far.leg, "legs", dim(legs), 0.026);
  limb(-nearSide * SHOULDER_W, far.arm, "shirt", dim(m.colour), 0.02);
  const torso = prism(
    [[0.022, SHOULDER_W], [-0.022, SHOULDER_W], [-0.022, -SHOULDER_W], [0.022, -SHOULDER_W]],
    HIP - 0.04, SHOULDER, m.colour, m.colour, "shirt",
  );
  limb(nearSide * HIP_W, near.leg, "legs", legs, 0.026);
  limb(nearSide * SHOULDER_W, near.arm, "shirt", m.colour, 0.02);
  // Hands.
  for (const [side, arm, c] of [[-nearSide, far.arm, dim(skin)], [nearSide, near.arm, skin]] as const) {
    const h = at(arm[2].l, side * SHOULDER_W, arm[2].up);
    g.circle(h.px, h.py, px(0.012));
    g.fill(paint("skin", c));
  }
  // THE HEAD, and hair over the top of it — centred on the head on screen: a
  // cap set back along the heading slides sideways in this view, off the head.
  const head = at(0, 0, HEAD), r = px(0.034);
  g.circle(head.px, head.py, r);
  g.fill(paint("skin", skin));
  const top = head.py - r * 0.2;
  g.moveTo(head.px - r, top).arc(head.px, top, r, Math.PI, 0).closePath();
  g.fill(paint("hair", hair));
  return torso;
}
