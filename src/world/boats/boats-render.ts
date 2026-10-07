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
import { Graphics } from "pixi.js";

import { HEIGHT_UNIT, HH, HW } from "../iso";
import type { BandLayer } from "../render/bands";
import type { ColumnField } from "../../fluid/columns";
import { BOAT_BEAM, BOAT_LENGTH, type Boat, type Fleet } from "./fleet";
import { createWake, stepWake, wakeMarks, type WakeMark } from "./wake";

/** How far the gunwale stands over the water, in half steps. */
const FREEBOARD = 0.55;
/** How tall the mast is over the deck, in half steps. */
const MAST = 3.4;

const HULL = 0xf2efe6;
const HULL_SHADE = 0xc9c3b4;
const STRIPE = 0xb8463a;
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
  /** Step the wake by `dt` and draw it and every boat on `c`'s water. */
  draw: (fleet: Fleet, c: ColumnField, scale: number, dt: number) => void;
  destroy: () => void;
};

export function createBoatLayer(bands: BandLayer): BoatLayer {
  const drawn = new Map<number, { g: Graphics; band: number }>();
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

  const draw = (fleet: Fleet, c: ColumnField, scale: number, dt: number) => {
    stepWake(wake, fleet, dt);
    drawWake(wakeMarks(wake, c), scale);
    const live = new Set<number>();
    for (const b of fleet.boats) {
      live.add(b.id);
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
    g.fill({ color: lit ? HULL : HULL_SHADE });
    // A stripe under the gunwale.
    const a2 = at(OUTLINE[k][0] * BOAT_LENGTH, OUTLINE[k][1] * BOAT_BEAM, FREEBOARD * 0.62);
    const c2 = at(OUTLINE[(k + 1) % n][0] * BOAT_LENGTH, OUTLINE[(k + 1) % n][1] * BOAT_BEAM, FREEBOARD * 0.62);
    g.poly([a.px, a.py, c.px, c.py, c2.px, c2.py, a2.px, a2.py]);
    g.fill({ color: STRIPE });
  }
  // THE DECK, at the gunwale, and its edge.
  g.poly(rim.flatMap((p) => [p.px, p.py]));
  g.fill({ color: DECK });
  g.stroke({ color: DECK_EDGE, width: Math.max(1, 1.2 * s), alpha: 0.9 });

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
