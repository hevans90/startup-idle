/**
 * World v2 — THE WATER MAINS, DRAWN: a built thing, not a line. Each cell is
 * a length of tube lying on the ground — a dark casing, a galvanised body, a
 * highlight along its top — out to the middle of each face it is joined on,
 * with round ends so the lengths meet seamlessly; and at its ends a fitting:
 * an intake's grate in the water, a pump's housing, an outlet's valve at the
 * building, a red cap. Drawn once a cell, in its band's paved tier, so it
 * sorts with the town; again only when the mains or the scale change.
 *
 * And THE WATER IN THEM, every frame: dashes of water running from the
 * intake to the building, as fast as the main carries — drawn in each band
 * over its tubes, so a building in front hides them as it hides the tube;
 * nothing in a dry main; and, over everything, an amber warning at the
 * intake of one that cannot reach its building.
 *
 * A main lies just off the ground, but RIDES ON STILTS over a road, and over
 * a dip it spans level with the banks either side. A widened bore is a fatter
 * tube; the AI's mains are banded in its violet.
 *
 * THE WATER OVERLAY, with the Pipe tool in hand or turned on: the town dimmed,
 * every main coloured by what it is doing, each building that drinks with its
 * tank as a ring, and the numbers — the water's depth at each intake, each
 * main's head. @see world/water/mains, plans/pipes-overhaul.md §3
 */
import { Container, Graphics, Text } from "pixi.js";

import { NEIGHBOUR } from "../../iso/dir";
import { MAIN_AI, MAIN_BORE, MAIN_END, idx, inBounds, structureAt, type Grid } from "../grid";
import { allTanks } from "../projects/cooling";
import { HEIGHT_UNIT, HH, HW } from "../iso";
import { findMains, joined, mainReportAt, mainReports, type MainState } from "../water/mains";
import type { BandLayer } from "./bands";

const SIDES = ["N", "E", "S", "W"] as const;
/**
 * The tube: its shade (the underside), body and highlight; how wide, in tile
 * units; how high its middle lies off the ground, in half steps. And the
 * overlay's line, wider than the tube so a main reads at any zoom.
 */
const CASING = 0x2b3440, BODY = 0x8796a8, SHADE = 0x5d6b7c, SHINE = 0xd4dde6, COLLAR = 0x6f7d8e;
const WIDE = 0.11;
const OVERLAY_WIDE = 0.16;
const LIFT = 0.45;
/** Concrete for the saddles and posts it rests on. */
const CONCRETE = 0xc9c4b8, CONCRETE_SIDE = 0xaaa59a, CONCRETE_DARK = 0x958f84;
/** How high a main rides over a road, half steps; how much fatter a widened bore is. */
const ROAD_LIFT = 2.4;
const BORE_WIDE = 1.4;
/** The AI's mains: a violet tint to the body, and its bands. */
const AI_BODY = 0x9d8bbd, AI_BAND = 0xb44aff;
/** The fittings. */
const GRATE = 0x3d4a57, PUMP_BODY = 0x4f6f8f, PUMP_TRIM = 0xe0a23a, VALVE = 0xb8463a, CAP = 0xc0392b;
/** The water in a main, and the warning at one that cannot deliver. */
const WATER = 0x5fb7ff, WARN = 0xf2a33a;
/** A glass section's tint, and how far along each limb it reaches, as a share of the limb. */
const GLASS_TINT = 0xd9f1ff, GLASS = 0.62;
/** Glass every fourth tile of a straight run (collars on the others). */
const isGlass = (g: Grid, x: number, y: number) => {
  const i = idx(g, x, y);
  if (!g.main[i] || g.mainEnd[i]) return false;
  const ns = joined(g, x, y, "N") && joined(g, x, y, "S"), ew = joined(g, x, y, "E") && joined(g, x, y, "W");
  return (ns !== ew) && !joined(g, x, y, ns ? "E" : "N") && !joined(g, x, y, ns ? "W" : "S") && (x + y) % 4 === 2;
};
/** The Water overlay: the dimming, and each state's colour. */
const DIM = 0x05080d;
const STATE_COLOUR: Record<MainState, number> = {
  flowing: 0x3fe08a, full: 0x5fb7ff, "no-head": WARN, unpaid: WARN, dry: 0xe5484d, "no-source": 0xe5484d, "no-outlet": 0xe5484d,
};

export type MainsLayer = {
  /** Redraw the tubes where the mains changed. */
  sync: (g: Grid, scale: number) => void;
  /** The water moving in them, this frame; and the main being dragged out, a ghost of itself. */
  tick: (g: Grid, scale: number, now: number, preview?: readonly { x: number; y: number }[] | null, ok?: boolean, water?: boolean, hover?: { x: number; y: number } | null) => void;
  destroy: () => void;
};

/** The point in screen space of map coordinates (cell centres on the integers) at `z` half steps. */
const P = (s: number, u: number, v: number, z: number): [number, number] => [(u - v) * HW * s, (u + v) * HH * s - z * HEIGHT_UNIT * s];

/**
 * A RING ROUND THE TUBE: a collar or a flange, drawn as the ellipse it is in
 * the plane across the tube — the tube running along `u` (N–S) or `v` (E–W) —
 * `px` its radius on screen.
 */
function ring(gfx: Graphics, s: number, u: number, v: number, z: number, along: "u" | "v", px: number, colour: number) {
  const rT = px / (Math.hypot(HW, HH) * s), rZ = px / (HEIGHT_UNIT * s), pts: number[] = [];
  for (let k = 0; k < 16; k++) {
    const t = (k / 16) * Math.PI * 2, c = Math.cos(t) * rT;
    pts.push(...P(s, u + (along === "v" ? c : 0), v + (along === "u" ? c : 0), z + Math.sin(t) * rZ));
  }
  gfx.poly(pts);
  gfx.fill({ color: colour });
}

/**
 * A SOLID BOX in the map's own axes, from (u0, v0) to (u1, v1), z0 to z1 half
 * steps: its top and the two sides that face the camera (+v and +u), shaded.
 * What the saddles, posts and fittings are made of.
 */
function isoBox(gfx: Graphics, s: number, u0: number, v0: number, u1: number, v1: number, z0: number, z1: number, top: number, left: number, right: number) {
  const q = (u: number, v: number, z: number) => P(s, u, v, z);
  const poly = (pts: [number, number][], colour: number) => { gfx.poly(pts.flat()); gfx.fill({ color: colour }); };
  poly([q(u0, v1, z1), q(u1, v1, z1), q(u1, v1, z0), q(u0, v1, z0)], left);
  poly([q(u1, v0, z1), q(u1, v1, z1), q(u1, v1, z0), q(u1, v0, z0)], right);
  poly([q(u0, v0, z1), q(u1, v0, z1), q(u1, v1, z1), q(u0, v1, z1)], top);
}

const ground = (g: Grid, x: number, y: number) => (inBounds(g, x, y) ? g.height[idx(g, x, y)] : 0);

/**
 * The level a main lies at on a cell: just off its ground — but on stilts
 * over a road, and over a dip (both cells it joins higher) level with the
 * lower of them.
 */
function levelAt(g: Grid, x: number, y: number): number {
  if (!inBounds(g, x, y)) return LIFT;
  let z = ground(g, x, y), banks = 0, low = Infinity;
  for (const side of SIDES) {
    if (!joined(g, x, y, side)) continue;
    const [dx, dy] = NEIGHBOUR[side];
    const h = ground(g, x + dx, y + dy);
    if (h > z) { banks++; low = Math.min(low, h); }
  }
  if (banks >= 2) z = low;
  return z + (g.paved[idx(g, x, y)] ? ROAD_LIFT : LIFT);
}

export function createMainsLayer(bands: BandLayer, overlay: Container): MainsLayer {
  const drawn = new Map<number, Graphics>();
  /** The water in the tubes, a Graphics a band, over that band's tubes; and those drawn in last frame. */
  const water = new Map<number, Graphics>();
  const wet = new Set<Graphics>();
  const flow = new Graphics();
  flow.eventMode = "none";
  overlay.addChild(flow);
  // The Water overlay's numbers, a pool of them, read again twice a second.
  const words = new Container();
  words.eventMode = "none";
  overlay.addChild(words);
  const pool: Text[] = [];
  let wordsAt = -Infinity;
  let key = "";

  /** Each half-length of tube a cell draws: from its middle to the middle of a joined face. */
  const limbs = (g: Grid, x: number, y: number, s: number) => {
    const z = levelAt(g, x, y), out: [number, number, number, number][] = [];
    for (const side of SIDES) {
      if (!joined(g, x, y, side)) continue;
      const [dx, dy] = NEIGHBOUR[side];
      const zf = (z + levelAt(g, x + dx, y + dy)) / 2;
      const a = P(s, x, y, z), b = P(s, x + dx * 0.5, y + dy * 0.5, zf);
      out.push([a[0], a[1], b[0], b[1]]);
    }
    return out;
  };

  const drawCell = (g: Grid, i: number, s: number): Graphics => {
    const x = i % g.w, y = (i / g.w) | 0;
    const gfx = new Graphics();
    gfx.eventMode = "none";
    const legs = limbs(g, x, y, s);
    const z = levelAt(g, x, y), floor = ground(g, x, y);
    const c = P(s, x, y, z);
    const bits = g.main[i], ai = (bits & MAIN_AI) !== 0;
    const bore = bits & MAIN_BORE ? BORE_WIDE : 1;
    const w = WIDE * HW * 2 * s * bore;
    /** The tube's radius in half steps, for what it rests on. */
    const rz = (WIDE * bore * HW * 2) / HEIGHT_UNIT / 2;
    const straight = legs.length === 2 && (joined(g, x, y, "N") && joined(g, x, y, "S") || joined(g, x, y, "E") && joined(g, x, y, "W"));
    // ITS SHADOW on the ground, softly, under where it lies.
    const lift = (z - floor) * HEIGHT_UNIT * s;
    for (const [ax, ay, bx, by] of legs) gfx.moveTo(ax, ay + lift).lineTo(bx, by + lift);
    gfx.stroke({ color: 0x000000, width: w * 1.3, cap: "round", join: "round", alpha: 0.16 });
    // WHAT IT RESTS ON: posts where it rides high, a low saddle every other tile.
    const high = z - floor > LIFT + 0.4;
    if (high) {
      for (const o of [-0.09, 0.09]) isoBox(gfx, s, x + o - 0.025, y - o - 0.025, x + o + 0.025, y - o + 0.025, floor, z - rz, CONCRETE, CONCRETE_SIDE, CONCRETE_DARK);
    } else if (straight && (x + y) % 2 === 0) {
      isoBox(gfx, s, x - 0.07, y - 0.07, x + 0.07, y + 0.07, floor, z - rz * 0.4, CONCRETE, CONCRETE_SIDE, CONCRETE_DARK);
    }
    // THE TUBE, shaded as a cylinder: its underside, its body, the light along its top.
    for (const [ax, ay, bx, by] of legs) gfx.moveTo(ax, ay + w * 0.12).lineTo(bx, by + w * 0.12);
    if (!legs.length) gfx.circle(c[0], c[1], w * 0.5);
    gfx.stroke({ color: ai ? 0x6e5f8f : SHADE, width: w, cap: "round", join: "round" });
    for (const [ax, ay, bx, by] of legs) gfx.moveTo(ax, ay - w * 0.05).lineTo(bx, by - w * 0.05);
    gfx.stroke({ color: ai ? AI_BODY : BODY, width: w * 0.8, cap: "round", join: "round" });
    for (const [ax, ay, bx, by] of legs) gfx.moveTo(ax, ay - w * 0.26).lineTo(bx, by - w * 0.26);
    gfx.stroke({ color: SHINE, width: Math.max(0.6, w * 0.18), cap: "round", join: "round", alpha: 0.85 });
    // WHICH WAY it runs here: N–S along u, E–W along v. @see NEIGHBOUR
    const along: "u" | "v" = joined(g, x, y, "N") || joined(g, x, y, "S") ? "u" : "v";
    // A COLLAR every few tiles of a straight run, and the AI's violet band: rings round the tube.
    if (straight && (x + y) % 4 === 0) ring(gfx, s, x, y, z, along, w * 0.6, COLLAR);
    if (ai && straight && (x + y) % 4 === 3) ring(gfx, s, x, y, z, along, w * 0.58, AI_BAND);
    // A GLASS SECTION every few tiles: a pale window down the tube, ringed at each end, where the water inside shows. @see isGlass
    if (isGlass(g, x, y)) {
      const [ax, ay, bx, by] = legs[0], [cx, cy, dx, dy] = legs[1];
      const along2 = (k: number): [number, number] => k < 0 ? [ax + (bx - ax) * -k, ay + (by - ay) * -k] : [cx + (dx - cx) * k, cy + (dy - cy) * k];
      const a = along2(-GLASS), b = along2(GLASS);
      gfx.moveTo(a[0], a[1] - w * 0.05).lineTo(b[0], b[1] - w * 0.05);
      gfx.stroke({ color: GLASS_TINT, width: w * 0.82, cap: "butt", alpha: 0.9 });
      for (const k of [-1, 1]) {
        const o = k * GLASS * 0.5;
        ring(gfx, s, x + (along === "u" ? o : 0), y + (along === "v" ? o : 0), z, along, w * 0.55, COLLAR);
      }
    }
    // THE FITTING at an end: solids, sized to the tube.
    const end = g.mainEnd[i];
    if (end === MAIN_END.intake) {
      // A grated bell mouth, set into the water at the bank.
      isoBox(gfx, s, x - 0.09, y - 0.09, x + 0.09, y + 0.09, z - rz * 1.2, z + rz * 0.9, COLLAR, SHADE, CASING);
      for (const k of [-0.045, 0, 0.045]) { const a = P(s, x - 0.07, y + k, z + rz * 0.9), b = P(s, x + 0.07, y + k, z + rz * 0.9); gfx.moveTo(a[0], a[1]).lineTo(b[0], b[1]); }
      gfx.stroke({ color: GRATE, width: Math.max(0.5, w * 0.1) });
    } else if (end === MAIN_END.pump && g.structures.get(structureAt(g, x, y))?.def !== "pump") {
      // A small pump house on the bank, where no pump house building stands: walls, a roof in the pump's amber, a wheel on its side.
      const top = Math.max(z + rz * 2, floor + 2.6);
      isoBox(gfx, s, x - 0.22, y - 0.18, x + 0.22, y + 0.18, floor, top, 0x6f8fae, PUMP_BODY, 0x3e5872);
      isoBox(gfx, s, x - 0.25, y - 0.21, x + 0.25, y + 0.21, top, top + 0.35, PUMP_TRIM, 0xb8812a, 0x9a6b22);
      const hub = P(s, x + 0.22, y, (floor + top) / 2);
      gfx.ellipse(hub[0], hub[1], w * 0.55, w * 0.8);
      gfx.stroke({ color: CASING, width: Math.max(0.6, w * 0.16) });
    } else if (end === MAIN_END.outlet) {
      // A flange where it meets the building, and a small valve wheel on it.
      ring(gfx, s, x, y, z, along, w * 0.72, COLLAR);
      gfx.circle(c[0], c[1] - w * 1.05, w * 0.42);
      gfx.stroke({ color: VALVE, width: Math.max(0.6, w * 0.16) });
    } else if (end === MAIN_END.cap) {
      gfx.circle(c[0], c[1], w * 0.55);
      gfx.fill({ color: CAP });
    }
    return gfx;
  };

  const clear = () => {
    for (const gfx of drawn.values()) { gfx.parent?.removeChild(gfx); gfx.destroy(); }
    drawn.clear();
    for (const gfx of water.values()) { gfx.parent?.removeChild(gfx); gfx.destroy(); }
    water.clear();
    wet.clear();
  };

  /** One of the overlay's numbers, from the pool. */
  const word = (k: number, text: string, colour: number, at: [number, number], px: number) => {
    let tx = pool[k];
    if (!tx) {
      tx = new Text({ text, style: { fontFamily: "system-ui, sans-serif", fontSize: 11, fontWeight: "600", fill: 0xffffff, stroke: { color: 0x05080d, width: 3 } } });
      tx.anchor.set(0.5, 1);
      pool[k] = tx;
      words.addChild(tx);
    }
    tx.visible = true;
    if (tx.text !== text) tx.text = text;
    tx.style.fill = colour;
    tx.scale.set(px);
    tx.position.set(at[0], at[1]);
  };

  /** THE WATER OVERLAY, this frame: the town dimmed; every main by its state; the tanks; the numbers. */
  const drawWater = (g: Grid, s: number, w: number, now: number) => {
    // A screen pixel, in the overlay's units: the rings and the numbers keep their size at any zoom.
    const px = 1 / Math.max(1e-3, Math.abs(overlay.worldTransform.a));
    // Dimmed, the whole map and a margin round it for what stands up off it.
    const top = P(s, 0, 0, 40), bottom = P(s, g.w, g.h, -10), left = P(s, 0, g.h, 0), right = P(s, g.w, 0, 0);
    flow.rect(left[0] - 200 * s, top[1] - 200 * s, right[0] - left[0] + 400 * s, bottom[1] - top[1] + 400 * s);
    flow.fill({ color: DIM, alpha: 0.55 });
    const { list } = findMains(g);
    for (const net of list) {
      const r = mainReportAt(g, net.cells[0] % g.w, (net.cells[0] / g.w) | 0);
      const colour = r ? STATE_COLOUR[r.state] : 0x8796a8;
      for (const i of net.cells) {
        const x = i % g.w, y = (i / g.w) | 0;
        const a = P(s, x, y, levelAt(g, x, y));
        let any = false;
        for (const side of SIDES) {
          if (!joined(g, x, y, side)) continue;
          const [dx, dy] = NEIGHBOUR[side];
          const b = P(s, x + dx * 0.5, y + dy * 0.5, (levelAt(g, x, y) + levelAt(g, x + dx, y + dy)) / 2);
          flow.moveTo(a[0], a[1]).lineTo(b[0], b[1]);
          any = true;
        }
        if (!any) flow.circle(a[0], a[1], w * 0.6);
      }
      flow.stroke({ color: colour, width: w * (net.bore > 1 ? 1.5 : 1.1), cap: "round", join: "round", alpha: 0.95 });
    }
    // EACH BUILDING THAT DRINKS, its tank as a ring: full round, empty none.
    const ringAt = new Map<number, [number, number]>();
    for (const [id, tank] of allTanks()) {
      const b = g.structures.get(id);
      if (!b) continue;
      const c = P(s, b.x + (b.w - 1) / 2, b.y + (b.h - 1) / 2, ground(g, b.x, b.y) + 4);
      ringAt.set(id, c);
      const r = 11 * px, share = tank.capacity > 0 ? Math.max(0, Math.min(1, tank.level / tank.capacity)) : 0;
      flow.circle(c[0], c[1], r);
      flow.fill({ color: DIM, alpha: 0.8 });
      flow.circle(c[0], c[1], r);
      flow.stroke({ color: 0x2b3440, width: 3.5 * px });
      if (share > 0) {
        flow.moveTo(c[0], c[1] - r).arc(c[0], c[1], r, -Math.PI / 2, -Math.PI / 2 + share * Math.PI * 2);
        flow.stroke({ color: share < 0.25 ? WARN : WATER, width: 3.5 * px, cap: "round" });
      }
    }
    // THE NUMBERS, twice a second: each tank's share, each intake's depth, each main's head.
    words.visible = true;
    if (now - wordsAt < 500) return;
    wordsAt = now;
    let k = 0;
    for (const [id, tank] of allTanks()) {
      const c = ringAt.get(id);
      if (!c) continue;
      word(k++, `${Math.round(tank.capacity > 0 ? (100 * tank.level) / tank.capacity : 0)}%`, 0xffffff, [c[0], c[1] - 13 * px], px);
    }
    for (const r of mainReports().values()) {
      for (const it of r.intakes) {
        const x = it.cell % g.w, y = (it.cell / g.w) | 0;
        const c = P(s, x, y, levelAt(g, x, y));
        word(k++, it.surface === null ? "dry" : `${(it.depth / 2).toFixed(1)} deep`, it.surface === null ? 0xff8a8d : 0x9fd6ff, [c[0], c[1] - w * 3.4], px);
      }
    }
    for (const net of list) {
      const r = mainReportAt(g, net.cells[0] % g.w, (net.cells[0] / g.w) | 0);
      if (!r || !r.intakes.some((it) => it.surface !== null) || !r.outlets.some((o) => o.building >= 0)) continue;
      const mid = net.cells[(net.cells.length / 2) | 0], x = mid % g.w, y = (mid / g.w) | 0;
      const c = P(s, x, y, levelAt(g, x, y));
      const slabs = r.head / 2;
      word(k++, `head ${slabs > 0 ? "+" : ""}${slabs.toFixed(1)}`, STATE_COLOUR[r.state], [c[0], c[1] - w * 1.6], px);
    }
    for (let j = k; j < pool.length; j++) pool[j].visible = false;
  };

  return {
    sync(g, scale) {
      const k = `${g.rev}|${scale}|${g.w}x${g.h}`;
      if (k === key) return;
      key = k;
      clear();
      for (let i = 0; i < g.main.length; i++) {
        if (!g.main[i] && !g.mainEnd[i]) continue;
        const band = (i % g.w) + ((i / g.w) | 0);
        if (!bands.pavedOf[band]) continue;
        const gfx = drawCell(g, i, scale);
        bands.pavedOf[band].addChild(gfx);
        drawn.set(i, gfx);
      }
      // The water's Graphics last in each band, over all its tubes.
      for (const i of drawn.keys()) {
        const band = (i % g.w) + ((i / g.w) | 0);
        if (water.has(band)) continue;
        const gfx = new Graphics();
        gfx.eventMode = "none";
        bands.pavedOf[band].addChild(gfx);
        water.set(band, gfx);
      }
    },
    tick(g, scale, now, preview, ok = true, overlayOn = false, hover = null) {
      flow.clear();
      for (const gfx of wet) gfx.clear();
      wet.clear();
      const t = now / 1000;
      const w = WIDE * HW * 2 * scale, ow = OVERLAY_WIDE * HW * 2 * scale;
      if (overlayOn) drawWater(g, scale, ow, now);
      else if (words.visible) words.visible = false;
      // THE MAIN BEING DRAGGED: its route as a tube of light, teal where it will work, amber where it won't.
      if (preview && preview.length) {
        const colour = ok ? 0x3fe0a8 : WARN;
        for (const [k, c] of preview.entries()) {
          const p = P(scale, c.x, c.y, levelAt(g, c.x, c.y));
          if (k === 0) flow.moveTo(p[0], p[1]); else flow.lineTo(p[0], p[1]);
        }
        flow.stroke({ color: colour, width: ow * 1.1, cap: "round", join: "round", alpha: 0.45 + 0.15 * Math.sin(t * 6) });
        for (const c of [preview[0], preview[preview.length - 1]]) {
          const p = P(scale, c.x, c.y, levelAt(g, c.x, c.y));
          flow.circle(p[0], p[1], ow * 0.8);
          flow.fill({ color: colour, alpha: 0.8 });
        }
      }
      const { list } = findMains(g);
      if (!list.length) return;
      const streaks = new Map<Graphics, [number, number, number, number][]>();
      const hoverAt = hover && inBounds(g, hover.x, hover.y) ? idx(g, hover.x, hover.y) : null;
      for (const net of list) {
        const first = net.cells[0], fx = first % g.w, fy = (first / g.w) | 0;
        const r = mainReportAt(g, fx, fy);
        const state: MainState | undefined = r?.state;
        // WHICH WAY: steps from the nearest intake, so the water runs away from it.
        const dist = new Map<number, number>();
        const queue = [...net.intakes];
        for (const q of queue) dist.set(q, 0);
        for (let h = 0; h < queue.length; h++) {
          const i = queue[h], x = i % g.w, y = (i / g.w) | 0;
          for (const side of SIDES) {
            if (!joined(g, x, y, side)) continue;
            const [dx, dy] = NEIGHBOUR[side];
            const j = idx(g, x + dx, y + dy);
            if (dist.has(j)) continue;
            dist.set(j, dist.get(i)! + 1);
            queue.push(j);
          }
        }
        // THE WATER, seen through each glass section: streaks running downstream
        // at the main's speed while it flows, standing still in a full one,
        // nothing in a dry one. @see isGlass
        if ((state === "flowing" || state === "full") && r) {
          const speed = state === "flowing" ? 0.35 + Math.min(2, r.flow) * 0.6 : 0;
          for (const i of net.cells) {
            const x = i % g.w, y = (i / g.w) | 0;
            if (!isGlass(g, x, y)) continue;
            const gfx = water.get(x + y);
            if (!gfx) continue;
            // Downstream: toward the neighbour further from the intake.
            const d = dist.get(i) ?? 0;
            let dir: [number, number] = [0, 0];
            for (const side of SIDES) {
              if (!joined(g, x, y, side)) continue;
              const [dx, dy] = NEIGHBOUR[side];
              if ((dist.get(idx(g, x + dx, y + dy)) ?? 0) > d) dir = [dx, dy];
            }
            const z = levelAt(g, x, y), half = GLASS * 0.5;
            const at = (k: number) => P(scale, x + dir[0] * k, y + dir[1] * k, z);
            // The water itself, a band along the glass; then the streaks moving in it.
            const a0 = at(-half), a1 = at(half);
            gfx.moveTo(a0[0], a0[1] + w * 0.04).lineTo(a1[0], a1[1] + w * 0.04);
            wet.add(gfx);
            if (speed > 0) {
              for (let k = 0; k < 3; k++) {
                const ph = (((t * speed + k / 3) % 1) + 1) % 1;
                const p0 = at(-half + ph * 2 * half * 0.85), p1 = at(-half + Math.min(1, ph * 0.85 + 0.15) * 2 * half);
                const list = streaks.get(gfx) ?? [];
                list.push([p0[0], p0[1] - w * 0.06, p1[0], p1[1] - w * 0.06]);
                streaks.set(gfx, list);
              }
            }
          }
          // THE INTAKE DRAWING: a slow swirl in the water at its mouth.
          if (state === "flowing") {
            for (const q of net.intakes) {
              const x = q % g.w, y = (q / g.w) | 0, c = P(scale, x, y, levelAt(g, x, y) - 0.3);
              for (let k = 0; k < 2; k++) {
                const a = t * 2.2 + k * Math.PI;
                flow.arc(c[0], c[1], w * (1.1 + k * 0.5), a, a + 1.6);
                flow.stroke({ color: 0xe8f6ff, width: Math.max(0.6, w * 0.12), alpha: 0.7 });
              }
            }
          }
        }
        // WHICH WAY IT RUNS, on the main under the pointer and every main in the
        // Water overlay: chevrons every other tile, pointing downstream.
        const hovered = hoverAt !== null && net.cells.includes(hoverAt);
        if ((hovered || overlayOn) && state === "flowing") {
          for (const i of net.cells) {
            const x = i % g.w, y = (i / g.w) | 0;
            if ((x + y) % 2) continue;
            const d = dist.get(i) ?? 0;
            for (const side of SIDES) {
              if (!joined(g, x, y, side)) continue;
              const [dx, dy] = NEIGHBOUR[side];
              if ((dist.get(idx(g, x + dx, y + dy)) ?? 0) <= d) continue;
              const z = levelAt(g, x, y);
              const tip = P(scale, x + dx * 0.22, y + dy * 0.22, z), l = P(scale, x + dx * 0.06 - dy * 0.08, y + dy * 0.06 + dx * 0.08, z), rr = P(scale, x + dx * 0.06 + dy * 0.08, y + dy * 0.06 - dx * 0.08, z);
              const lift = ow * 0.45;
              flow.moveTo(l[0], l[1] - lift).lineTo(tip[0], tip[1] - lift).lineTo(rr[0], rr[1] - lift);
              flow.stroke({ color: 0xffffff, width: Math.max(1, ow * 0.12), alpha: 0.9, join: "round", cap: "round" });
            }
          }
        }
        if (state && state !== "flowing" && state !== "full") {
          // CANNOT DELIVER: a pulsing warning at each intake — or at its far end, with none.
          const at = net.intakes.length ? net.intakes : [net.cells[0]];
          const pulse = 0.55 + 0.45 * Math.sin(t * 4);
          for (const i of at) {
            const x = i % g.w, y = (i / g.w) | 0;
            // Floated over the fitting: a pump house stands tall at an intake.
            const c = P(scale, x, y, Math.max(levelAt(g, x, y), ground(g, x, y) + 3.4));
            flow.circle(c[0], c[1] - ow * 2.4, ow * 0.9);
            flow.fill({ color: WARN, alpha: pulse });
            flow.rect(c[0] - ow * 0.12, c[1] - ow * 2.9, ow * 0.24, ow * 0.6);
            flow.fill({ color: 0x1a1a1a, alpha: pulse });
          }
        }
      }
      for (const gfx of wet) {
        gfx.stroke({ color: WATER, width: Math.max(0.8, w * 0.62), cap: "butt", alpha: 0.85 });
        // The streaks, light on the water, over it in the same band.
        const list = streaks.get(gfx);
        if (!list) continue;
        for (const [ax, ay, bx, by] of list) gfx.moveTo(ax, ay).lineTo(bx, by);
        gfx.stroke({ color: 0xffffff, width: Math.max(0.5, w * 0.16), cap: "round", alpha: 0.9 });
      }
    },
    destroy() {
      clear();
      flow.parent?.removeChild(flow);
      flow.destroy();
      words.parent?.removeChild(words);
      words.destroy({ children: true });
    },
  };
}

