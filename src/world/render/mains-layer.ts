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
import { MAIN_AI, MAIN_BORE, MAIN_END, idx, inBounds, type Grid } from "../grid";
import { allTanks } from "../projects/cooling";
import { HEIGHT_UNIT, HH, HW } from "../iso";
import { findMains, joined, mainReportAt, mainReports, type MainState } from "../water/mains";
import type { BandLayer } from "./bands";

const SIDES = ["N", "E", "S", "W"] as const;
/** The tube: its casing, body and highlight; how wide, in tile units; how high it lies off the ground, in half steps. */
const CASING = 0x2b3440, BODY = 0x8796a8, SHINE = 0xc9d3de;
const WIDE = 0.16;
const LIFT = 0.6;
/** How high a main rides over a road, half steps; how much fatter a widened bore is. */
const ROAD_LIFT = 2.4;
const BORE_WIDE = 1.4;
/** The AI's mains: a violet tint to the body, and its bands. */
const AI_BODY = 0x9d8bbd, AI_BAND = 0xb44aff;
/** The fittings. */
const GRATE = 0x3d4a57, PUMP_BODY = 0x4f6f8f, PUMP_TRIM = 0xe0a23a, VALVE = 0xb8463a, CAP = 0xc0392b;
/** The water in a main, and the warning at one that cannot deliver. */
const WATER = 0x5fb7ff, WARN = 0xf2a33a;
/** The Water overlay: the dimming, and each state's colour. */
const DIM = 0x05080d;
const STATE_COLOUR: Record<MainState, number> = {
  flowing: 0x3fe08a, full: 0x5fb7ff, "no-head": WARN, unpaid: WARN, dry: 0xe5484d, "no-source": 0xe5484d, "no-outlet": 0xe5484d,
};

export type MainsLayer = {
  /** Redraw the tubes where the mains changed. */
  sync: (g: Grid, scale: number) => void;
  /** The water moving in them, this frame; and the main being dragged out, a ghost of itself. */
  tick: (g: Grid, scale: number, now: number, preview?: readonly { x: number; y: number }[] | null, ok?: boolean, water?: boolean) => void;
  destroy: () => void;
};

/** The point in screen space of map coordinates (cell centres on the integers) at `z` half steps. */
const P = (s: number, u: number, v: number, z: number): [number, number] => [(u - v) * HW * s, (u + v) * HH * s - z * HEIGHT_UNIT * s];

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
    const w = WIDE * HW * 2 * s * (bits & MAIN_BORE ? BORE_WIDE : 1);
    // STILTS, where it rides high: a pair of legs down to the ground, behind the tube.
    if (z - floor > LIFT + 0.4) {
      const f = P(s, x, y, floor);
      for (const o of [-0.5, 0.5]) gfx.moveTo(c[0] + o * w, c[1]).lineTo(f[0] + o * w * 1.3, f[1]);
      gfx.stroke({ color: CASING, width: Math.max(1, w * 0.28) });
      gfx.moveTo(f[0] - w, f[1]).lineTo(f[0] + w, f[1]);
      gfx.stroke({ color: CASING, width: Math.max(1, w * 0.2) });
    }
    // The tube: casing, body, highlight — round caps, so lengths meet without a seam.
    for (const [ax, ay, bx, by] of legs) gfx.moveTo(ax, ay).lineTo(bx, by);
    if (!legs.length) gfx.circle(c[0], c[1], w * 0.5);
    gfx.stroke({ color: CASING, width: w * 1.25, cap: "round", join: "round" });
    for (const [ax, ay, bx, by] of legs) gfx.moveTo(ax, ay).lineTo(bx, by);
    gfx.stroke({ color: ai ? AI_BODY : BODY, width: w, cap: "round", join: "round" });
    for (const [ax, ay, bx, by] of legs) gfx.moveTo(ax, ay - w * 0.22).lineTo(bx, by - w * 0.22);
    gfx.stroke({ color: SHINE, width: Math.max(1, w * 0.22), cap: "round", alpha: 0.9 });
    // THE AI'S: a band of its violet round the middle of each length.
    if (ai && legs.length) {
      const [ax, ay, bx, by] = legs[0];
      gfx.moveTo(ax + (bx - ax) * 0.45, ay + (by - ay) * 0.45).lineTo(ax + (bx - ax) * 0.65, ay + (by - ay) * 0.65);
      gfx.stroke({ color: AI_BAND, width: w * 1.08, cap: "butt" });
    }
    // A flange every few tiles, where a run is straight.
    if (legs.length === 2 && (x + y) % 3 === 0) {
      gfx.circle(c[0], c[1], w * 0.68);
      gfx.fill({ color: CASING });
      gfx.circle(c[0], c[1], w * 0.5);
      gfx.fill({ color: BODY });
    }
    // THE FITTING at an end.
    const end = g.mainEnd[i];
    if (end === MAIN_END.intake) {
      gfx.rect(c[0] - w * 0.9, c[1] - w * 0.9, w * 1.8, w * 1.4);
      gfx.fill({ color: GRATE });
      for (let k = -1; k <= 1; k++) gfx.rect(c[0] - w * 0.75, c[1] - w * 0.55 + k * w * 0.4, w * 1.5, w * 0.12);
      gfx.fill({ color: SHINE, alpha: 0.7 });
    } else if (end === MAIN_END.pump) {
      gfx.rect(c[0] - w * 1.4, c[1] - w * 2.6, w * 2.8, w * 2.6);
      gfx.fill({ color: PUMP_BODY });
      gfx.rect(c[0] - w * 1.4, c[1] - w * 2.9, w * 2.8, w * 0.4);
      gfx.fill({ color: PUMP_TRIM });
      gfx.circle(c[0] + w * 0.5, c[1] - w * 1.3, w * 0.7);
      gfx.stroke({ color: CASING, width: Math.max(1, w * 0.2) });
    } else if (end === MAIN_END.outlet) {
      gfx.circle(c[0], c[1] - w * 0.9, w * 0.75);
      gfx.stroke({ color: VALVE, width: Math.max(1.2, w * 0.25) });
      gfx.moveTo(c[0] - w * 0.75, c[1] - w * 0.9).lineTo(c[0] + w * 0.75, c[1] - w * 0.9);
      gfx.stroke({ color: VALVE, width: Math.max(1, w * 0.18) });
    } else if (end === MAIN_END.cap) {
      gfx.circle(c[0], c[1], w * 0.62);
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
    tick(g, scale, now, preview, ok = true, overlayOn = false) {
      flow.clear();
      for (const gfx of wet) gfx.clear();
      wet.clear();
      const t = now / 1000;
      const w = WIDE * HW * 2 * scale;
      if (overlayOn) drawWater(g, scale, w, now);
      else if (words.visible) words.visible = false;
      // THE MAIN BEING DRAGGED: its route as a tube of light, teal where it will work, amber where it won't.
      if (preview && preview.length) {
        const colour = ok ? 0x3fe0a8 : WARN;
        for (const [k, c] of preview.entries()) {
          const p = P(scale, c.x, c.y, levelAt(g, c.x, c.y));
          if (k === 0) flow.moveTo(p[0], p[1]); else flow.lineTo(p[0], p[1]);
        }
        flow.stroke({ color: colour, width: w * 1.1, cap: "round", join: "round", alpha: 0.45 + 0.15 * Math.sin(t * 6) });
        for (const c of [preview[0], preview[preview.length - 1]]) {
          const p = P(scale, c.x, c.y, levelAt(g, c.x, c.y));
          flow.circle(p[0], p[1], w * 0.8);
          flow.fill({ color: colour, alpha: 0.8 });
        }
      }
      const { list } = findMains(g);
      if (!list.length) return;
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
        if (state === "flowing" && r) {
          const speed = 0.6 + Math.min(2, r.flow) * 1.2;
          for (const i of net.cells) {
            const x = i % g.w, y = (i / g.w) | 0, d = dist.get(i) ?? 0;
            for (const side of SIDES) {
              if (!joined(g, x, y, side)) continue;
              const [dx, dy] = NEIGHBOUR[side];
              const j = idx(g, x + dx, y + dy);
              if ((dist.get(j) ?? 0) <= d) continue;           // each length once, downstream
              const phase = ((t * speed + d * 0.5) % 1 + 1) % 1;
              const z0 = levelAt(g, x, y), z1 = levelAt(g, x + dx, y + dy);
              const a = phase, b = Math.min(1, phase + 0.35);
              const p0 = P(scale, x + dx * a, y + dy * a, z0 + (z1 - z0) * a), p1 = P(scale, x + dx * b, y + dy * b, z0 + (z1 - z0) * b);
              const gfx = water.get(x + y);
              if (!gfx) continue;
              gfx.moveTo(p0[0], p0[1] - w * 0.1).lineTo(p1[0], p1[1] - w * 0.1);
              wet.add(gfx);
            }
          }
        }
        if (state && state !== "flowing" && state !== "full") {
          // CANNOT DELIVER: a pulsing warning at each intake — or at its far end, with none.
          const at = net.intakes.length ? net.intakes : [net.cells[0]];
          const pulse = 0.55 + 0.45 * Math.sin(t * 4);
          for (const i of at) {
            const x = i % g.w, y = (i / g.w) | 0;
            const c = P(scale, x, y, levelAt(g, x, y));
            flow.circle(c[0], c[1] - w * 2.4, w * 0.9);
            flow.fill({ color: WARN, alpha: pulse });
            flow.rect(c[0] - w * 0.12, c[1] - w * 2.9, w * 0.24, w * 0.6);
            flow.fill({ color: 0x1a1a1a, alpha: pulse });
          }
        }
      }
      for (const gfx of wet) gfx.stroke({ color: WATER, width: Math.max(1, w * 0.45), cap: "round", alpha: 0.95 });
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

