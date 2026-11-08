/**
 * World v2 — DISASTERS YOU CAN SEE: what each one shows on the map, worked
 * out once a second from what is going on and put there.
 *
 *  - A HEATWAVE: a faint haze rising off everything that drinks; off each
 *    building it overheated, steam, and a red-orange glow (the lights'
 *    conditions) until the crew has been;
 *  - A FIRE: smoke off the building while it smoulders; once it has caught,
 *    flames on its roof, a column of smoke above, embers, and a flickering
 *    orange glow; burnt out, a charred tint until rebuilt (the scene's);
 *  - A BURST MAIN: spray off the joint (the solver pours the water); A SEWER
 *    BACKED UP: brown bubbling off the manhole (the slop is the slop's);
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
/** A fire's flames: bright tongues, yellow going red, licking up off the roof. */
export const FLAMES: Recipe = {
  texture: "flame", rate: 22, life: 700, rise: 46, drift: 8, wobble: 3, spread: 18,
  from: 0xfff0a0, to: 0xe0401a, alpha: 0.95, size: [0.9, 0.35], blend: "add",
};
/** Its smoke: dark, rising high, spreading as it goes. Thinner while it only smoulders. */
export const SMOKE: Recipe = {
  texture: "smoke", rate: 7, life: 3600, rise: 40, drift: 10, wobble: 8, spread: 14,
  from: 0x5a5450, to: 0x9a9690, alpha: 0.8, size: [0.6, 2.4], blend: "normal",
};
export const SMOULDER: Recipe = { ...SMOKE, rate: 3, alpha: 0.5, size: [0.4, 1.6], from: 0x8a8682, to: 0xb0aca8 };
/** Embers: sparks thrown up and off. */
export const EMBERS: Recipe = {
  texture: "dab", rate: 9, life: 1500, rise: 70, drift: 30, wobble: 10, spread: 14,
  from: 0xffd060, to: 0xff4010, alpha: 1, size: [0.22, 0.08], blend: "add",
};
/** A burst main's spray: white water thrown up off the joint. */
export const SPRAY: Recipe = {
  texture: "dab", rate: 26, life: 650, rise: 90, drift: 26, wobble: 2, spread: 6,
  from: 0xf2fbff, to: 0x7fc4ec, alpha: 0.85, size: [0.3, 0.7], blend: "normal",
};
/** A backed-up sewer's bubbling: brown gouts off the manhole. */
export const BUBBLE: Recipe = {
  texture: "dab", rate: 7, life: 900, rise: 14, drift: 6, wobble: 3, spread: 8,
  from: 0x7a5a32, to: 0x4a3820, alpha: 0.9, size: [0.25, 0.6], blend: "normal",
};
const RECIPES = { steam: STEAM, haze: HAZE, flames: FLAMES, smoke: SMOKE, smoulder: SMOULDER, embers: EMBERS, spray: SPRAY, bubble: BUBBLE } as const;

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
export function emittersWanted(g: Grid, damaged: Iterable<readonly [number, DamageCause]>, heatwave: boolean, drinkers: Iterable<number>, drawn?: RoofOf, fire: { burning: readonly number[]; smouldering: readonly number[] } = { burning: [], smouldering: [] }): Wanted {
  const out: Wanted = new Map();
  // A FIRE: flames, smoke and embers off what burns; smoke off what smoulders.
  const roofAt = (id: number) => {
    const s = g.structures.get(id);
    return s && { x: s.x, y: s.y, w: s.w, h: s.h, rise: Math.round(roofOf(id, s.def, s.w, s.h, drawn)) };
  };
  for (const id of fire.burning) {
    const at = roofAt(id);
    if (!at) continue;
    out.set(`flames:${id}`, { at, recipe: "flames" });
    out.set(`smoke:${id}`, { at: { ...at, rise: at.rise + 24 }, recipe: "smoke" });
    out.set(`embers:${id}`, { at, recipe: "embers" });
  }
  for (const id of fire.smouldering) {
    const at = roofAt(id);
    if (at && !fire.burning.includes(id)) out.set(`smoulder:${id}`, { at, recipe: "smoulder" });
  }
  for (const [id, cause] of damaged) {
    const s = g.structures.get(id);
    // Steam off what overheated — but not off what is on fire.
    if (cause !== "heat" || !s || fire.burning.includes(id) || fire.smouldering.includes(id)) continue;
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
    /** What is on fire now, and what is only smoking yet. @see FIRE */
    fire?: { burning: readonly number[]; smouldering: readonly number[] };
    /** A burst main's joint, spraying; a backed-up sewer's manhole, bubbling. @see BURST_MAIN, SEWER_BACKUP */
    spray?: readonly { x: number; y: number }[];
    bubble?: readonly { x: number; y: number }[];
  }) => void;
  clear: () => void;
};

export function createDisasterFx(): DisasterFx {
  const running = new Map<string, { stop: () => void; at: string }>();
  const barriers = new Map<number, Graphics>();
  /** What the glows were last put for: retouched only when it changes. */
  let glowKey = "";

  return {
    sync({ ctx, juice, lights, damaged, heatwave, drinkers, closed, roof, fire, spray = [], bubble = [] }) {
      const g = ctx.grid;
      // THE EMITTERS: started, moved or stopped to match what is wanted.
      const want = emittersWanted(g, damaged, heatwave, drinkers, roof, fire);
      for (const t of spray) want.set(`spray:${t.x},${t.y}`, { at: { x: t.x, y: t.y, w: 1, h: 1, rise: 0 }, recipe: "spray" });
      for (const t of bubble) want.set(`bubble:${t.x},${t.y}`, { at: { x: t.x, y: t.y, w: 1, h: 1, rise: 0 }, recipe: "bubble" });
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
        const key = JSON.stringify([damaged, closed, fire?.burning, g.structures.size]);
        if (key !== glowKey) {
          glowKey = key;
          // A building's glow halfway up it, as drawn.
          lights.conditions(g, ctx.scale, conditionsOf(g, damaged, closed, roof && ((id) => { const r = roof(id); return r === null ? null : r * 0.5; }), fire?.burning));
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
