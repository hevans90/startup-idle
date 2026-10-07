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
 */
import { Graphics } from "pixi.js";

import { HEIGHT_UNIT, HH, HW } from "../iso";
import type { BandLayer } from "../render/bands";
import { BOAT_BEAM, BOAT_LENGTH, type Boat, type Fleet } from "./fleet";

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

/**
 * The hull's outline at the gunwale, along the bow and across the beam, as
 * shares of the length and the beam: a pointed bow, a square stern.
 */
const OUTLINE: readonly (readonly [number, number])[] = [
  [0.5, 0], [0.24, 0.5], [-0.34, 0.48], [-0.5, 0.34],
  [-0.5, -0.34], [-0.34, -0.48], [0.24, -0.5],
];

export type BoatLayer = {
  draw: (fleet: Fleet, scale: number) => void;
  destroy: () => void;
};

export function createBoatLayer(bands: BandLayer): BoatLayer {
  const drawn = new Map<number, { g: Graphics; band: number }>();

  const draw = (fleet: Fleet, scale: number) => {
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
