/**
 * World v2 — DISASTERS YOU CAN SEE: what each one shows on the map, worked
 * out once a second from what is going on and put there.
 *
 *  - A HEATWAVE: a faint haze rising off everything that drinks; off each
 *    building it overheated, steam, and a red-orange glow (the lights'
 *    conditions) until the crew has been;
 *  - CLOSED BY THE INSPECTOR: a cold grey over the building;
 *  - ROAD WORKS: a striped barrier and two cones on the closed junction, an
 *    amber lamp blinking on it.
 *
 * Steam and haze are the juice's emitters; the barrier is Graphics in the
 * junction's band, put up when the works start and taken down when they end
 * — never touched in between. @see plans/disaster-rendering.md
 */
import { Graphics } from "pixi.js";

import { idx, inBounds, type Grid } from "../grid";
import { bandOf, cellToWorld } from "../iso";
import type { RenderCtx } from "../structures/render";
import type { DamageCause } from "../events/damage";
import type { EmitAt, Juice, Recipe } from "./juice";
import { conditionsOf, riseOf, type Lights } from "./lights";

/** Steam off an overheated building: white puffs, rising and greying. */
export const STEAM: Recipe = {
  texture: "smoke", rate: 6, life: 1900, rise: 34, drift: 6, wobble: 5, spread: 12,
  from: 0xffffff, to: 0xaeb5be, alpha: 0.9, size: [0.5, 1.5], blend: "normal",
};
/** Heat haze over what drinks: faint, warm, wavering up. */
export const HAZE: Recipe = {
  texture: "dab", rate: 2.5, life: 2300, rise: 16, drift: 4, wobble: 6, spread: 16,
  from: 0xffc070, to: 0xff7a30, alpha: 0.16, size: [0.9, 1.7], blend: "add",
};
const RECIPES = { steam: STEAM, haze: HAZE } as const;

/**
 * How high a building's roof is over its ground, screen px at scale 1: as
 * drawn, where the scene can say (`drawn`), else a guess by its tier and
 * footprint. A tower's steam comes off its top, not its middle.
 */
export type RoofOf = (id: number) => number | null;
const roofOf = (id: number, def: string, w: number, h: number, drawn?: RoofOf) =>
  drawn?.(id) ?? riseOf(def) + 12 * (Math.max(w, h) - 1);

/** What the heatwave and the damage want given off, by a key that stays the same while it does. */
export type Wanted = Map<string, { at: EmitAt; recipe: keyof typeof RECIPES }>;

/**
 * THE EMITTERS WANTED NOW: steam off what overheated, and haze off what
 * drinks while a heatwave is on. Pure. @see sync
 */
export function emittersWanted(g: Grid, damaged: Iterable<readonly [number, DamageCause]>, heatwave: boolean, drinkers: Iterable<number>, drawn?: RoofOf): Wanted {
  const out: Wanted = new Map();
  for (const [id, cause] of damaged) {
    const s = g.structures.get(id);
    if (cause !== "heat" || !s) continue;
    out.set(`steam:${id}`, { at: { x: s.x, y: s.y, w: s.w, h: s.h, rise: Math.round(roofOf(id, s.def, s.w, s.h, drawn)) }, recipe: "steam" });
  }
  if (heatwave) {
    for (const id of drinkers) {
      const s = g.structures.get(id);
      if (!s || s.build) continue;
      out.set(`haze:${id}`, { at: { x: s.x, y: s.y, w: s.w, h: s.h, rise: Math.round(roofOf(id, s.def, s.w, s.h, drawn) * 0.6) }, recipe: "haze" });
    }
  }
  return out;
}

/** A barrier across a road tile and two cones before it, drawn about its centre, at scale 1. */
function barrier(): Graphics {
  const g = new Graphics();
  // Two posts, a striped bar between.
  g.rect(-24, -16, 3, 16).fill({ color: 0x3a3a3a });
  g.rect(21, -16, 3, 16).fill({ color: 0x3a3a3a });
  for (let k = 0; k < 6; k++) g.rect(-24 + k * 8, -18, 8, 5).fill({ color: k % 2 ? 0xf4f1ea : 0xd8342c });
  // Two cones, in front: orange wedges with a white band.
  for (const cx of [-15, 13]) {
    g.poly([cx - 5, 9, cx + 5, 9, cx, -4]).fill({ color: 0xf07a1a });
    g.rect(cx - 3, 2, 6, 2).fill({ color: 0xf8f4ec });
  }
  g.eventMode = "none";
  return g;
}

export type DisasterFx = {
  /**
   * Put on the map what is going on now: `damaged` with causes, whether a
   * heatwave is on, the drinkers' ids, the road tiles closed.
   */
  sync: (o: {
    ctx: RenderCtx; juice: Juice; lights: Lights | null;
    damaged: readonly (readonly [number, DamageCause])[]; heatwave: boolean; drinkers: Iterable<number>;
    closed: readonly { x: number; y: number }[];
    /** A building's roof as drawn. @see RoofOf */
    roof?: RoofOf;
  }) => void;
  clear: () => void;
};

export function createDisasterFx(): DisasterFx {
  const running = new Map<string, { stop: () => void; at: string }>();
  const barriers = new Map<number, Graphics>();
  /** What the glows were last put for: retouched only when it changes. */
  let glowKey = "";

  return {
    sync({ ctx, juice, lights, damaged, heatwave, drinkers, closed, roof }) {
      const g = ctx.grid;
      // THE EMITTERS: started, moved or stopped to match what is wanted.
      const want = emittersWanted(g, damaged, heatwave, drinkers, roof);
      for (const [key, r] of running) {
        const w = want.get(key);
        if (w && JSON.stringify(w.at) === r.at) continue;
        r.stop();
        running.delete(key);
      }
      for (const [key, w] of want) {
        if (running.has(key)) continue;
        running.set(key, { stop: juice.emit(w.at, RECIPES[w.recipe], ctx), at: JSON.stringify(w.at) });
      }
      // THE BARRIERS: one a closed tile, up while it is closed. One whose band
      // went with a rebuilt map is put up again.
      const tiles = new Set(closed.filter((t) => inBounds(g, t.x, t.y)).map((t) => idx(g, t.x, t.y)));
      for (const [i, b] of barriers) {
        if (tiles.has(i) && !b.destroyed && b.parent && !b.parent.destroyed) continue;
        if (!b.destroyed) { b.parent?.removeChild(b); b.destroy(); }
        barriers.delete(i);
      }
      for (const t of closed) {
        if (!inBounds(g, t.x, t.y)) continue;
        const i = idx(g, t.x, t.y);
        const layer = ctx.bands.dynamicOf[bandOf(t.x, t.y)];
        if (barriers.has(i) || !layer) continue;
        const b = barrier();
        const { wx, wy } = cellToWorld(t.x, t.y, g.height[i], ctx.scale);
        b.position.set(wx, wy);
        b.scale.set(ctx.scale);
        b.zIndex = 1e6 - 1;
        layer.addChild(b);
        barriers.set(i, b);
      }
      // THE GLOWS, by cause, and the works' lamps.
      if (lights) {
        const key = JSON.stringify([damaged, closed, g.structures.size]);
        if (key !== glowKey) {
          glowKey = key;
          // A building's glow halfway up it, as drawn.
          lights.conditions(g, ctx.scale, conditionsOf(g, damaged, closed, roof && ((id) => { const r = roof(id); return r === null ? null : r * 0.5; })));
        }
      }
    },
    clear() {
      for (const r of running.values()) r.stop();
      running.clear();
      for (const b of barriers.values()) if (!b.destroyed) { b.parent?.removeChild(b); b.destroy(); }
      barriers.clear();
      glowKey = "";
    },
  };
}
