/**
 * World v2 — HEADLIGHTS AT NIGHT: a pool of light on the road ahead of each
 * vehicle, a glow at its headlamps and a red one at its tail; a cyclist's
 * little lamps. The lamps themselves are lit on the vehicle. @see town-render
 *
 * Over the night, as the town's lights are, and for the same reason: under
 * it, multiplied in, light would be darkened with everything else. A pool
 * seen over a building in front reads as light spilling round it.
 * @see render/lights
 */
import { Container, Matrix, Sprite, Texture } from "pixi.js";

import { HEIGHT_UNIT, HH, HW } from "../iso";
import { halfLength } from "../agents/cars/fleet";
import { HALF_STEPS_PER_M } from "../agents/cars/models";
import type { Mover, Town } from "../agents/town";

/** The pool: how far ahead and how wide at its far end, tiles; how bright. */
const REACH = 1.7, SPREAD = 1.1, POOL = 0.55;
/** The lamps' glows: how high, metres, how big and how bright. */
const LAMP_Z = 0.7, LAMP_SIZE = 0.16, HEAD_GLOW = 0.8, TAIL_GLOW = 0.6;
const HEAD = 0xfff0c8, TAIL = 0xff2a18;
/** A cyclist's: smaller, and their pool shorter. */
const BIKE = 0.5;

let beam: Texture | null = null, dot: Texture | null = null;
/** The pool, along x from the lamps out, across y: brightest near, widening and fading away. */
function beamTexture(): Texture {
  if (beam) return beam;
  const W = 128, H = 64, c = document.createElement("canvas");
  c.width = W; c.height = H;
  const g = c.getContext("2d")!, img = g.createImageData(W, H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const f = (x + 0.5) / W, across = ((y + 0.5) / H - 0.5) * 2, wide = 0.3 + 0.7 * f;
    const a = Math.pow(1 - f, 1.4) * Math.exp(-3 * (across / wide) ** 2) * Math.min(1, f * 8);
    const o = (y * W + x) * 4;
    img.data[o] = img.data[o + 1] = img.data[o + 2] = 255;
    img.data[o + 3] = Math.round(a * 255);
  }
  g.putImageData(img, 0, 0);
  return (beam = Texture.from(c));
}
function dotTexture(): Texture {
  if (dot) return dot;
  const c = document.createElement("canvas");
  c.width = c.height = 32;
  const g = c.getContext("2d")!, r = g.createRadialGradient(16, 16, 0, 16, 16, 16);
  r.addColorStop(0, "rgba(255,255,255,1)");
  r.addColorStop(0.3, "rgba(255,255,255,0.5)");
  r.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = r;
  g.fillRect(0, 0, 32, 32);
  return (dot = Texture.from(c));
}

type Glow = { pool: Sprite; head: Sprite; tail: Sprite };

export type CarGlow = {
  /** This frame: the town's vehicles, how dark it is (0–1), the map's transform to the screen and its scale. */
  tick: (town: Town, night: number, map: Matrix, scale: number) => void;
  destroy: () => void;
};

export function createCarGlow(stage: Container, zIndex: number): CarGlow {
  const root = new Container({ label: "car glow" });
  root.eventMode = "none";
  root.zIndex = zIndex;
  stage.addChild(root);
  const shown = new Map<number, Glow>();
  const make = (): Glow => {
    const pool = new Sprite(beamTexture());
    pool.anchor.set(0, 0.5);
    const head = new Sprite(dotTexture()), tail = new Sprite(dotTexture());
    for (const s of [pool, head, tail]) { s.blendMode = "add"; root.addChild(s); }
    head.anchor.set(0.5); tail.anchor.set(0.5);
    head.tint = HEAD; pool.tint = HEAD; tail.tint = TAIL;
    return { pool, head, tail };
  };
  const m3 = new Matrix();
  return {
    tick(town, night, map, scale) {
      root.visible = night > 0.05;
      if (!root.visible) {
        if (shown.size) { for (const g of shown.values()) for (const s of [g.pool, g.head, g.tail]) s.destroy(); shown.clear(); }
        return;
      }
      root.alpha = Math.min(1, night * 1.2);
      root.setFromMatrix(map);
      const live = new Set<number>();
      for (const m of town.movers) {
        if (!lit(m)) continue;
        live.add(m.id);
        let g = shown.get(m.id);
        if (!g) shown.set(m.id, (g = make()));
        const k = m.kind === "bike" ? BIKE : 1;
        const ch = Math.cos(m.heading), sh = Math.sin(m.heading), half = m.kind === "bike" ? 0.08 : halfLength(m);
        // On the ground: a tile along the heading, and a tile to its right, on the screen.
        const Ax = (ch - sh) * HW * scale, Ay = (ch + sh) * HH * scale;
        const Bx = (-sh - ch) * HW * scale, By = (-sh + ch) * HH * scale;
        const at = (l: number, up: number) => ({
          x: (m.x - m.y) * HW * scale + Ax * l,
          y: (m.x + m.y) * HH * scale + Ay * l - (m.z + up) * HEIGHT_UNIT * scale,
        });
        // THE POOL, laid on the road from the nose.
        const tw = g.pool.texture.width, th = g.pool.texture.height, nose = at(half, 0);
        m3.set((Ax * REACH * k) / tw, (Ay * REACH * k) / tw, (Bx * SPREAD * k) / th, (By * SPREAD * k) / th, nose.x, nose.y);
        g.pool.setFromMatrix(m3);
        g.pool.alpha = POOL;
        // THE LAMPS' GLOWS.
        const up = LAMP_Z * HALF_STEPS_PER_M * k, size = (LAMP_SIZE * k * scale * 64) / 32;
        const h = at(half, up), t = at(-half, up);
        g.head.position.set(h.x, h.y); g.head.scale.set(size); g.head.alpha = HEAD_GLOW;
        g.tail.position.set(t.x, t.y); g.tail.scale.set(size * 0.8); g.tail.alpha = TAIL_GLOW;
      }
      for (const [id, g] of shown) {
        if (live.has(id)) continue;
        for (const s of [g.pool, g.head, g.tail]) s.destroy();
        shown.delete(id);
      }
    },
    destroy() {
      root.parent?.removeChild(root);
      root.destroy({ children: true });
      shown.clear();
    },
  };
}

/** Whether a mover has lamps lit at night: on the road, not parked. */
const lit = (m: Mover) => m.kind !== "person" && !!m.drive && !m.park;
