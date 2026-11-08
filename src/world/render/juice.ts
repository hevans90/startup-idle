/**
 * World v2 — JUICE: the small motions that make a building feel put there.
 *
 *  - DROP: a building new to the map falls the last few pixels into place,
 *    landing with a little give, as it fades up; dust puffs out at its feet;
 *  - HOP: a house that grows a tier jumps once, and sparkles;
 *  - PUFF: a building that comes down leaves a cloud where it stood;
 *  - CONFETTI: Ship It Fridays' release parties — a burst off a roof,
 *    fluttering down. @see game/culture
 *  - OPENED: a shop the town opens pops, sparkles in its colour, and its
 *    name floats up off it and fades. @see stepTown
 *  - EMITTERS: the same motes given off continuously at a spot until
 *    stopped — steam off an overheated rack, haze over what drinks in a
 *    heatwave, a fire's flames, smoke and embers. @see Recipe, disaster-fx
 *
 * Only for what changes while the map is up — not for what is there when it
 * loads, which arrives all at once and would be a storm. @see syncStructures
 */
import { Sprite, Text, Texture, type Container } from "pixi.js";

import { idx, inBounds, type Grid, type Structure } from "../grid";
import { bandOf, cellToWorld } from "../iso";
import type { RenderCtx, StructureHandle } from "../structures/render";
import { TIERS, tierOf } from "../agents/services";
import { partsOf } from "./holograms";
import { EASE, createTweens } from "./tween";
import { sfx } from "../../audio/sound";

/** How far a new building drops, screen pixels at scale 1, and over how long. */
const DROP_PX = 14;
const DROP_MS = 320;
/** A grown house's hop: how high, how long. */
const HOP_PX = 7;
const HOP_MS = 260;
/** Dust: how long a mote lives, and the most alive at once. */
const MOTE_MS = 650;
const MAX_MOTES = 240;
const DUST = 0xd8cfb8;
const SPARKLE = 0xfff3b0;
/** Ship It Fridays' confetti: its colours, how many a burst, how hard it falls (px/s², scale 1). */
const CONFETTI = [0xe0533d, 0x3d8be0, 0x45b07a, 0xf2c230, 0xa65ad6, 0xf27aa8];
const CONFETTI_N = 36;
const CONFETTI_FALL = 260;
/** A shop's opening: how much it swells, over how long; how far its name rises, over how long. */
const POP = 0.12;
const POP_MS = 380;
const NAME_PX = 34;
const NAME_MS = 2600;
/** A drone's light, as it is drawn: the overseer's violet. @see ai-layer */
const DRONE = 0xb44aff;

type Mote = { s: Sprite; vx: number; vy: number; at: number; life: number; grow: number; alpha: number; fall?: number; emitted?: Emitted };

/** What an emitter's mote carries besides a burst's: its ramp, its sway and its size over its life. */
type Emitted = { from: number; to: number; size: [number, number]; wobble: number; x0: number; seed: number };

/**
 * AN EMITTER'S RECIPE: what it gives off, how often, and how each mote moves
 * and fades. Lengths and speeds are screen px at scale 1. @see Juice.emit
 */
export type Recipe = {
  texture: "dab" | "smoke" | "flame";
  /** Motes a second, close up; fewer zoomed out. @see zoomRate */
  rate: number;
  /** How long a mote lives, ms. */
  life: number;
  /** How fast it rises, and drifts to one side or the other (at random, up to this). */
  rise: number;
  drift: number;
  /** How far it sways from side to side as it rises. */
  wobble: number;
  /** How far from the spot a mote may start. */
  spread: number;
  /** Its colour at birth and at death. */
  from: number;
  to: number;
  /** At its brightest, mid-life: it fades in and out. */
  alpha: number;
  /** Its scale at birth and at death. */
  size: [number, number];
  blend: "add" | "normal";
};

/** Where an emitter gives off from: a footprint, and how high over its ground. */
export type EmitAt = { x: number; y: number; w: number; h: number; rise: number };

/**
 * HOW MANY OF THE BUDGET EMITTERS MAY HOLD: the rest is kept for the bursts,
 * so a fire never stops a building landing with its dust. @see MAX_MOTES
 */
export const EMIT_MOTES = 160;

/** Motes due over `dtMs` at `rate` a second, with what was left over last time. Pure. */
export function spawnDue(rate: number, dtMs: number, carry: number): { n: number; carry: number } {
  const due = carry + (rate * dtMs) / 1000;
  const n = Math.floor(due);
  return { n, carry: due - n };
}

/** The share of an emitter's rate it gives off at a zoom: all of it close up, a quarter at most far out. Pure. */
export const zoomRate = (zoom: number) => Math.min(1, Math.max(0.25, zoom));

/** A colour `t` of the way from `a` to `b`, channel by channel. Pure. */
export function rampColour(a: number, b: number, t: number): number {
  const k = Math.min(1, Math.max(0, t));
  const ch = (sh: number) => Math.round(((a >> sh) & 255) + (((b >> sh) & 255) - ((a >> sh) & 255)) * k);
  return (ch(16) << 16) | (ch(8) << 8) | ch(0);
}

export type Juice = {
  /** A structure just mounted; `was` the record it replaced, if any. */
  mounted: (s: Structure, handle: StructureHandle, ctx: RenderCtx, was?: Structure) => void;
  /** A structure just taken off the map. */
  gone: (s: Structure, ctx: RenderCtx) => void;
  /** A burst of confetti off a building's roof. */
  confetti: (s: Structure, ctx: RenderCtx) => void;
  /**
   * The town has opened a shop here: the building pops — if it is drawn yet,
   * a house with a shop new in it — sparkles in `colour`, and `name` floats
   * up off it. @see stepTown
   */
  opened: (s: Structure, handle: StructureHandle | undefined, ctx: RenderCtx, name: string, colour: number) => void;
  /** A drone has landed its job here: a burst of its violet light, rising. */
  landed: (at: { x: number; y: number }, ctx: RenderCtx) => void;
  /**
   * AN EMITTER: motes given off at a spot, continuously, until the returned
   * stop is called. It shares the motes' budget, up to `EMIT_MOTES`. @see Recipe
   */
  emit: (at: EmitAt, recipe: Recipe, ctx: RenderCtx) => () => void;
  /**
   * Step everything on by `dtMs`. With `view`, an emitter gives off less
   * zoomed out and nothing while its band is out of sight.
   */
  tick: (dtMs: number, view?: { zoom: number; shown: (band: number) => boolean }) => void;
  clear: () => void;
};

/** A soft round dab, white, for tinting. Made once. */
let dab: Texture | null = null;
function dabTexture(): Texture {
  if (dab) return dab;
  const c = document.createElement("canvas");
  c.width = c.height = 32;
  const g = c.getContext("2d")!;
  const r = g.createRadialGradient(16, 16, 0, 16, 16, 16);
  r.addColorStop(0, "rgba(255,255,255,1)");
  r.addColorStop(0.5, "rgba(255,255,255,0.55)");
  r.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = r;
  g.fillRect(0, 0, 32, 32);
  dab = Texture.from(c);
  return dab;
}

/** Whether a new record is the old one grown a tier or more. */
export const grew = (was: string, now: string): boolean => {
  const a = tierOf(was), b = tierOf(now);
  return !!a && !!b && was.replace(/\.\w+$/, "") === now.replace(/\.\w+$/, "") && TIERS.indexOf(b) > TIERS.indexOf(a);
};

/** A flake of confetti: a little square, white, for tinting. Made once. */
let flake: Texture | null = null;
function flakeTexture(): Texture {
  if (flake) return flake;
  const c = document.createElement("canvas");
  c.width = 6; c.height = 4;
  const g = c.getContext("2d")!;
  g.fillStyle = "#fff";
  g.fillRect(0, 0, 6, 4);
  flake = Texture.from(c);
  return flake;
}

/** A puff of smoke or steam: a few soft lobes, white, for tinting. Made once. */
let smoke: Texture | null = null;
function smokeTexture(): Texture {
  if (smoke) return smoke;
  const c = document.createElement("canvas");
  c.width = c.height = 48;
  const g = c.getContext("2d")!;
  for (const [x, y, r] of [[24, 28, 14], [16, 22, 10], [32, 21, 11], [24, 16, 9]] as const) {
    const grad = g.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(0, "rgba(255,255,255,0.7)");
    grad.addColorStop(0.6, "rgba(255,255,255,0.35)");
    grad.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = grad;
    g.fillRect(0, 0, 48, 48);
  }
  smoke = Texture.from(c);
  return smoke;
}

/** A tongue of flame: a teardrop, white, brightest at its foot, for tinting. Made once. */
let flame: Texture | null = null;
function flameTexture(): Texture {
  if (flame) return flame;
  const c = document.createElement("canvas");
  c.width = 24; c.height = 40;
  const g = c.getContext("2d")!;
  const grad = g.createRadialGradient(12, 30, 0, 12, 26, 18);
  grad.addColorStop(0, "rgba(255,255,255,1)");
  grad.addColorStop(0.5, "rgba(255,255,255,0.6)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grad;
  g.beginPath();
  g.moveTo(12, 1);
  g.bezierCurveTo(19, 14, 23, 24, 21, 31);
  g.bezierCurveTo(19, 38, 5, 38, 3, 31);
  g.bezierCurveTo(1, 24, 5, 14, 12, 1);
  g.fill();
  flame = Texture.from(c);
  return flame;
}

type Emitter = { wx: number; wy: number; band: number; recipe: Recipe; ctx: RenderCtx; carry: number; spread: number };

/** `texture`: what an emitter's motes are drawn with, for a test with no canvas to draw one. */
export function createJuice(opts: { texture?: (kind: Recipe["texture"]) => Texture } = {}): Juice {
  const textureOf = opts.texture ?? ((kind: Recipe["texture"]) => (kind === "smoke" ? smokeTexture() : kind === "flame" ? flameTexture() : dabTexture()));
  const tweens = createTweens();
  const motes: Mote[] = [];
  const pool: Sprite[] = [];
  const live = (p: Container) => () => !p.destroyed;
  const emitters = new Set<Emitter>();
  /** Motes alive that an emitter gave off. */
  let emitted = 0;
  /** A sprite from the pool, as a plain dab again: an emitter's may have been smoke, or added. */
  const fromPool = () => {
    const m = pool.pop();
    if (!m) return new Sprite(dabTexture());
    m.texture = dabTexture();
    m.blendMode = "normal";
    m.alpha = 1;
    return m;
  };

  /** One mote off an emitter. */
  function giveOff(e: Emitter) {
    const layer = e.ctx.bands.dynamicOf[e.band];
    if (!layer || layer.destroyed) return;
    const r = e.recipe, sc = e.ctx.scale;
    const m = pool.pop() ?? new Sprite(textureOf(r.texture));
    m.texture = textureOf(r.texture);
    m.blendMode = r.blend;
    // A flame stands on its foot; the rest on their middles.
    m.anchor.set(0.5, r.texture === "flame" ? 0.85 : 0.5);
    m.tint = r.from;
    m.alpha = 0;
    const a = Math.random() * Math.PI * 2, d = Math.sqrt(Math.random()) * e.spread;
    m.x = e.wx + Math.cos(a) * d;
    m.y = e.wy + Math.sin(a) * d * 0.5;
    m.scale.set(r.size[0] * sc);
    m.zIndex = 1e6;
    m.eventMode = "none";
    layer.addChild(m);
    emitted++;
    motes.push({
      s: m, vx: (Math.random() * 2 - 1) * r.drift * sc, vy: -r.rise * sc * (0.8 + Math.random() * 0.4),
      at: 0, life: r.life * (0.8 + Math.random() * 0.4), grow: sc, alpha: r.alpha,
      emitted: { from: r.from, to: r.to, size: r.size, wobble: r.wobble * sc, x0: m.x, seed: Math.random() * 6.28 },
    });
  }

  /** Where a footprint's front foot is on the ground, in the scene's space, and its band. */
  const footOf = (g: Grid, s: Structure, scale: number) => {
    const x = s.x + s.w - 1, y = s.y + s.h - 1;
    const z = inBounds(g, x, y) ? g.height[idx(g, x, y)] : 0;
    const { wx, wy } = cellToWorld(s.x + (s.w - 1) / 2, s.y + (s.h - 1) / 2, z, scale);
    return { wx, wy, band: bandOf(x, y) };
  };

  /** A puff of `n` motes at a spot, spread over a footprint `span` tiles wide. */
  function puff(ctx: RenderCtx, s: Structure, n: number, colour: number, up = 0) {
    const { wx, wy, band } = footOf(ctx.grid, s, ctx.scale);
    const layer = ctx.bands.dynamicOf[band];
    if (!layer) return;
    const span = Math.max(s.w, s.h) * 40 * ctx.scale;
    for (let k = 0; k < n && motes.length < MAX_MOTES; k++) {
      const m = fromPool();
      m.anchor.set(0.5);
      m.tint = colour;
      const a = (k / n) * Math.PI * 2 + Math.random() * 0.6;
      m.x = wx + Math.cos(a) * span * 0.35;
      m.y = wy + Math.sin(a) * span * 0.18 - up * ctx.scale;
      m.zIndex = 1e6;
      m.eventMode = "none";
      layer.addChild(m);
      const speed = (30 + Math.random() * 40) * ctx.scale;
      motes.push({
        s: m, vx: Math.cos(a) * speed, vy: Math.sin(a) * speed * 0.5 - (up ? 40 : 12) * ctx.scale,
        at: 0, life: MOTE_MS * (0.7 + Math.random() * 0.6), grow: (0.5 + Math.random() * 0.5) * ctx.scale, alpha: up ? 0.9 : 0.55,
      });
    }
  }

  /** A burst of confetti off a building's roof, `up` px over its foot. */
  function confetti(ctx: RenderCtx, s: Structure, up: number) {
    const { wx, wy, band } = footOf(ctx.grid, s, ctx.scale);
    const layer = ctx.bands.dynamicOf[band];
    if (!layer) return;
    for (let k = 0; k < CONFETTI_N && motes.length < MAX_MOTES; k++) {
      const m = new Sprite(flakeTexture());
      m.anchor.set(0.5);
      m.tint = CONFETTI[k % CONFETTI.length];
      m.x = wx + (Math.random() - 0.5) * s.w * 30 * ctx.scale;
      m.y = wy - up * ctx.scale;
      m.rotation = Math.random() * Math.PI;
      m.zIndex = 1e6;
      m.eventMode = "none";
      layer.addChild(m);
      const a = -Math.PI / 2 + (Math.random() - 0.5) * 1.6, speed = (120 + Math.random() * 110) * ctx.scale;
      motes.push({
        s: m, vx: Math.cos(a) * speed, vy: Math.sin(a) * speed, at: 0, life: 1400 + Math.random() * 700,
        grow: (0.9 + Math.random() * 0.6) * ctx.scale, alpha: 1, fall: CONFETTI_FALL * ctx.scale,
      });
    }
  }

  return {
    mounted(s, handle, ctx, was) {
      const parts = partsOf(handle);
      if (!was) {
        // DROP: from above, landing with a little give, fading up as it comes.
        for (const p of parts) {
          const y = p.y, a = p.alpha;
          tweens.add({ from: -DROP_PX * ctx.scale, to: 0, ms: DROP_MS, ease: EASE.outBack, set: (v) => { p.y = y + v; }, alive: live(p) });
          tweens.add({ from: 0, to: a, ms: DROP_MS * 0.6, ease: EASE.outCubic, set: (v) => { p.alpha = v; }, alive: live(p) });
        }
        tweens.add({ from: 0, to: 1, ms: DROP_MS * 0.8, ease: EASE.linear, set: () => {}, done: () => { puff(ctx, s, 8 + 2 * s.w * s.h, DUST); sfx("build"); } });
      } else if (grew(was.def, s.def)) {
        // HOP: up and down again, and a sparkle off the roof.
        for (const p of parts) {
          const y = p.y;
          tweens.add({ from: 0, to: -HOP_PX * ctx.scale, ms: HOP_MS, ease: EASE.hop, set: (v) => { p.y = y + v; }, alive: live(p) });
        }
        puff(ctx, s, 7, SPARKLE, 40);
        sfx("pop");
      }
    },
    gone(s, ctx) {
      // PUFF, where it stood.
      puff(ctx, s, 10 + 3 * s.w * s.h, DUST);
      sfx("crumble");
    },
    confetti(s, ctx) {
      confetti(ctx, s, 30 + 12 * Math.max(s.w, s.h));
    },
    opened(s, handle, ctx, name, colour) {
      const { wx, wy, band } = footOf(ctx.grid, s, ctx.scale);
      // THE POP: swelling out of its foot and back, its parts together.
      for (const p of handle ? partsOf(handle) : []) {
        const x = p.x, y = p.y, sx = p.scale.x, sy = p.scale.y;
        tweens.add({
          from: 0, to: 1, ms: POP_MS, ease: EASE.hop, alive: live(p),
          set: (v) => { const k = 1 + POP * v; p.scale.set(sx * k, sy * k); p.x = wx + (x - wx) * k; p.y = wy + (y - wy) * k; },
        });
      }
      puff(ctx, s, 9, colour, 40);
      // ITS NAME, rising off the roof and fading.
      const layer = ctx.bands.dynamicOf[band];
      if (layer) {
        const t = new Text({ text: name, style: { fontFamily: "Space Mono, monospace", fontSize: 13, fontWeight: "700", fill: 0xffffff, stroke: { color: colour, width: 3 } } });
        t.anchor.set(0.5, 1);
        t.scale.set(ctx.scale);
        t.zIndex = 1e6;
        t.eventMode = "none";
        const y0 = wy - (50 + 14 * Math.max(s.w, s.h)) * ctx.scale;
        t.position.set(wx, y0);
        layer.addChild(t);
        tweens.add({
          from: 0, to: 1, ms: NAME_MS, ease: EASE.linear, alive: live(t),
          set: (v) => { t.y = y0 - NAME_PX * ctx.scale * EASE.outCubic(v); t.alpha = v < 0.6 ? Math.min(1, v * 8) : (1 - v) / 0.4; },
          done: () => { t.parent?.removeChild(t); t.destroy(); },
        });
      }
      sfx("pop");
    },
    landed(at, ctx) {
      const x = Math.round(at.x), y = Math.round(at.y);
      puff(ctx, { id: -1, def: "", x, y, w: 1, h: 1 }, 9, DRONE, 30);
    },
    emit(at, recipe, ctx) {
      const x = at.x + at.w - 1, y = at.y + at.h - 1;
      const z = inBounds(ctx.grid, x, y) ? ctx.grid.height[idx(ctx.grid, x, y)] : 0;
      const { wx, wy } = cellToWorld(at.x + (at.w - 1) / 2, at.y + (at.h - 1) / 2, z, ctx.scale);
      const e: Emitter = { wx, wy: wy - at.rise * ctx.scale, band: bandOf(x, y), recipe, ctx, carry: Math.random(), spread: recipe.spread * ctx.scale * Math.max(1, Math.min(at.w, at.h)) };
      emitters.add(e);
      return () => { emitters.delete(e); };
    },
    tick(dtMs, view) {
      tweens.step(dtMs);
      // THE EMITTERS' MOTES: none for one out of sight, fewer zoomed out.
      const rate = view ? zoomRate(view.zoom) : 1;
      for (const e of emitters) {
        if (view && !view.shown(e.band)) { e.carry = 0; continue; }
        const due = spawnDue(e.recipe.rate * rate, dtMs, e.carry);
        e.carry = due.carry;
        for (let k = 0; k < due.n && emitted < EMIT_MOTES && motes.length < MAX_MOTES; k++) giveOff(e);
      }
      for (let k = motes.length - 1; k >= 0; k--) {
        const m = motes[k];
        m.at += dtMs;
        const t = m.at / m.life;
        if (t >= 1 || m.s.destroyed) {
          motes.splice(k, 1);
          if (m.emitted) emitted--;
          // A flake is no dab: not for the pool.
          if (!m.s.destroyed) { m.s.parent?.removeChild(m.s); if (m.fall) m.s.destroy(); else pool.push(m.s); }
          continue;
        }
        const dt = dtMs / 1000;
        m.s.x += m.vx * dt;
        m.s.y += m.vy * dt;
        if (m.emitted) {
          // An emitter's: rising steadily, swaying, its colour and size over its life, in and out.
          const em = m.emitted;
          em.x0 += m.vx * dt;
          m.s.x = em.x0 + Math.sin(em.seed + m.at / 300) * em.wobble;
          m.s.tint = rampColour(em.from, em.to, t);
          m.s.scale.set(m.grow * (em.size[0] + (em.size[1] - em.size[0]) * t));
          m.s.alpha = m.alpha * Math.sin(Math.PI * t);
          continue;
        }
        if (m.fall) {
          // A flake: thrown up, slowed by the air, fluttering as it comes down.
          m.vy += m.fall * dt;
          m.vx *= 0.97; m.vy *= 0.97;
          m.s.rotation += dt * 6;
          m.s.scale.set(m.grow, m.grow * Math.abs(Math.cos(m.at / 90)));
          m.s.alpha = t < 0.75 ? 1 : (1 - t) * 4;
          continue;
        }
        m.vx *= 0.94; m.vy *= 0.94;
        m.s.scale.set(m.grow * (0.4 + 0.8 * EASE.outCubic(t)));
        m.s.alpha = m.alpha * (1 - t);
      }
    },
    clear() {
      tweens.finish();
      for (const m of motes) if (!m.s.destroyed) m.s.destroy();
      motes.length = 0;
      emitted = 0;
      emitters.clear();
      for (const s of pool) s.destroy();
      pool.length = 0;
    },
  };
}
