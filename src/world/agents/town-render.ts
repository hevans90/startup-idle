/**
 * World v2 — the town's traffic, drawn.
 *
 * Drawn the way the boats are, there being no car or person in the art set:
 * outlines worked out in the tile plane round each one's heading, stood up to
 * a height, and projected — only the sides that face the camera, lit a little
 * from the left. A car is a body and a cabin on it; a person is a figure and a
 * head, bobbing a little with each step. @see boats-render
 *
 * IN THE BAND OF ITS FRONTMOST POINT, among the movers, and ordered within the
 * band by how far into it it is, so the ground in front of it covers it and
 * two cars side by side overlap the right way round. @see BandLayer.dynamicOf
 */
import { Graphics } from "pixi.js";

import { HEIGHT_UNIT, HH, HW } from "../iso";
import type { BandLayer } from "../render/bands";
import type { Mover, Town } from "./town";

/** A car, tiles long and wide, and its body and cabin heights in half steps. */
const CAR_L = 0.38;
const CAR_W = 0.2;
const BODY = 0.42;
const CABIN = 0.78;
/** A person: tiles across, and half steps tall to the shoulder. */
const PERSON_W = 0.07;
const PERSON_H = 0.95;

const GLASS = 0x2a3a4a;
const SKIN = 0xe9c39b;
const TROUSERS = 0x3a3f4b;

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

/** Draw one; answers the band it belongs in. */
function drawMover(g: Graphics, m: Mover, s: number, bandsN: number): number {
  const ch = Math.cos(m.heading), sh = Math.sin(m.heading);
  const bob = m.kind === "person" ? Math.abs(Math.sin(m.phase)) * 0.06 : 0;
  /** `l` along the heading and `w` across it, tiles, `up` half steps over the road. */
  const at = (l: number, w: number, up: number) => {
    const u = m.x + l * ch - w * sh;
    const v = m.y + l * sh + w * ch;
    return { u, v, px: (u - v) * HW * s, py: (u + v) * HH * s - (m.z + up + bob) * HEIGHT_UNIT * s };
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

  g.clear();
  let front: { u: number; v: number }[];
  if (m.kind === "car") {
    const body = prism(box(CAR_L / 2, CAR_W / 2), 0.04, BODY, m.colour);
    // The cabin, set back from the bonnet, glass on its sides.
    prism([[CAR_L * 0.12, CAR_W * 0.42], [-CAR_L * 0.32, CAR_W * 0.42], [-CAR_L * 0.32, -CAR_W * 0.42], [CAR_L * 0.12, -CAR_W * 0.42]],
      BODY, CABIN, GLASS, shade(m.colour, 0.9));
    front = body;
  } else {
    // Legs, a shirt, and a head.
    prism(box(PERSON_W / 2, PERSON_W / 2), 0, PERSON_H * 0.45, TROUSERS);
    const top = prism(box(PERSON_W / 2, PERSON_W / 2), PERSON_H * 0.45, PERSON_H, m.colour);
    const head = at(0, 0, PERSON_H + 0.18);
    g.circle(head.px, head.py, Math.max(1, 0.035 * HW * s));
    g.fill({ color: SKIN });
    front = top;
  }
  let band = -Infinity;
  for (const p of front) band = Math.max(band, Math.round(p.u) + Math.round(p.v));
  return Math.max(0, Math.min(bandsN - 1, band));
}
