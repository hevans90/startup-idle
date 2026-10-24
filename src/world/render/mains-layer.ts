/**
 * World v2 — THE WATER MAINS, DRAWN: a built thing, not a line. Each cell is
 * a length of tube lying on the ground — a dark casing, a galvanised body, a
 * highlight along its top — out to the middle of each face it is joined on,
 * with round ends so the lengths meet seamlessly; and at its ends a fitting:
 * an intake's grate in the water, a pump's housing, an outlet's valve at the
 * building, a red cap. Drawn once a cell, in its band's paved tier, so it
 * sorts with the town; again only when the mains or the scale change.
 *
 * And THE WATER IN THEM, every frame, over the top: dashes of water running
 * from the intake to the building, as fast as the main carries; nothing in a
 * dry main; an amber warning at the intake of one that cannot reach its
 * building. @see world/water/mains, plans/pipes-overhaul.md §3
 */
import { Container, Graphics } from "pixi.js";

import { NEIGHBOUR } from "../../iso/dir";
import { MAIN_END, idx, inBounds, type Grid } from "../grid";
import { HEIGHT_UNIT, HH, HW } from "../iso";
import { findMains, joined, mainReportAt, type MainState } from "../water/mains";
import type { BandLayer } from "./bands";

const SIDES = ["N", "E", "S", "W"] as const;
/** The tube: its casing, body and highlight; how wide, in tile units; how high it lies off the ground, in half steps. */
const CASING = 0x2b3440, BODY = 0x8796a8, SHINE = 0xc9d3de;
const WIDE = 0.16;
const LIFT = 0.6;
/** The fittings. */
const GRATE = 0x3d4a57, PUMP_BODY = 0x4f6f8f, PUMP_TRIM = 0xe0a23a, VALVE = 0xb8463a, CAP = 0xc0392b;
/** The water in a main, and the warning at one that cannot deliver. */
const WATER = 0x5fb7ff, WARN = 0xf2a33a;

export type MainsLayer = {
  /** Redraw the tubes where the mains changed. */
  sync: (g: Grid, scale: number) => void;
  /** The water moving in them, this frame; and the main being dragged out, a ghost of itself. */
  tick: (g: Grid, scale: number, now: number, preview?: readonly { x: number; y: number }[] | null, ok?: boolean) => void;
  destroy: () => void;
};

/** The point in screen space of map coordinates (cell centres on the integers) at `z` half steps. */
const P = (s: number, u: number, v: number, z: number): [number, number] => [(u - v) * HW * s, (u + v) * HH * s - z * HEIGHT_UNIT * s];

/** The level a main lies at on a cell: just off its ground. */
const levelAt = (g: Grid, x: number, y: number) => (inBounds(g, x, y) ? g.height[idx(g, x, y)] : 0) + LIFT;

export function createMainsLayer(bands: BandLayer, overlay: Container): MainsLayer {
  const drawn = new Map<number, Graphics>();
  const flow = new Graphics();
  flow.eventMode = "none";
  overlay.addChild(flow);
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
    const c = P(s, x, y, levelAt(g, x, y));
    const w = WIDE * HW * 2 * s;
    // The tube: casing, body, highlight — round caps, so lengths meet without a seam.
    for (const [ax, ay, bx, by] of legs) gfx.moveTo(ax, ay).lineTo(bx, by);
    if (!legs.length) gfx.circle(c[0], c[1], w * 0.5);
    gfx.stroke({ color: CASING, width: w * 1.25, cap: "round", join: "round" });
    for (const [ax, ay, bx, by] of legs) gfx.moveTo(ax, ay).lineTo(bx, by);
    gfx.stroke({ color: BODY, width: w, cap: "round", join: "round" });
    for (const [ax, ay, bx, by] of legs) gfx.moveTo(ax, ay - w * 0.22).lineTo(bx, by - w * 0.22);
    gfx.stroke({ color: SHINE, width: Math.max(1, w * 0.22), cap: "round", alpha: 0.9 });
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
    },
    tick(g, scale, now, preview, ok = true) {
      flow.clear();
      const t = now / 1000;
      const w = WIDE * HW * 2 * scale;
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
              flow.moveTo(p0[0], p0[1] - w * 0.1).lineTo(p1[0], p1[1] - w * 0.1);
            }
          }
          flow.stroke({ color: WATER, width: Math.max(1, w * 0.45), cap: "round", alpha: 0.95 });
        } else if (state && state !== "full") {
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
    },
    destroy() {
      clear();
      flow.parent?.removeChild(flow);
      flow.destroy();
    },
  };
}

