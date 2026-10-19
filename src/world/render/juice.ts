/**
 * World v2 — JUICE: the small motions that make a building feel put there.
 *
 *  - DROP: a building new to the map falls the last few pixels into place,
 *    landing with a little give, as it fades up; dust puffs out at its feet;
 *  - HOP: a house that grows a tier jumps once, and sparkles;
 *  - PUFF: a building that comes down leaves a cloud where it stood.
 *
 * Only for what changes while the map is up — not for what is there when it
 * loads, which arrives all at once and would be a storm. @see syncStructures
 */
import { Sprite, Texture, type Container } from "pixi.js";

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

type Mote = { s: Sprite; vx: number; vy: number; at: number; life: number; grow: number; alpha: number };

export type Juice = {
  /** A structure just mounted; `was` the record it replaced, if any. */
  mounted: (s: Structure, handle: StructureHandle, ctx: RenderCtx, was?: Structure) => void;
  /** A structure just taken off the map. */
  gone: (s: Structure, ctx: RenderCtx) => void;
  /** Step everything on by `dtMs`. */
  tick: (dtMs: number) => void;
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

export function createJuice(): Juice {
  const tweens = createTweens();
  const motes: Mote[] = [];
  const pool: Sprite[] = [];
  const live = (p: Container) => () => !p.destroyed;

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
      const m = pool.pop() ?? new Sprite(dabTexture());
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
    tick(dtMs) {
      tweens.step(dtMs);
      for (let k = motes.length - 1; k >= 0; k--) {
        const m = motes[k];
        m.at += dtMs;
        const t = m.at / m.life;
        if (t >= 1 || m.s.destroyed) {
          motes.splice(k, 1);
          if (!m.s.destroyed) { m.s.parent?.removeChild(m.s); pool.push(m.s); }
          continue;
        }
        const dt = dtMs / 1000;
        m.s.x += m.vx * dt;
        m.s.y += m.vy * dt;
        m.vx *= 0.94; m.vy *= 0.94;
        m.s.scale.set(m.grow * (0.4 + 0.8 * EASE.outCubic(t)));
        m.s.alpha = m.alpha * (1 - t);
      }
    },
    clear() {
      tweens.finish();
      for (const m of motes) if (!m.s.destroyed) m.s.destroy();
      motes.length = 0;
      for (const s of pool) s.destroy();
      pool.length = 0;
    },
  };
}
