/**
 * World v2 — HOLOGRAMS: a building that is not there yet, drawn by its own
 * renderer — the real thing, at true depth among the town's, hidden by what
 * stands in front and hiding what stands behind — and then made light: tinted,
 * see-through, flickering, with scan lines running up it.
 *
 * What a placement would put down, under the build tool; what AI mode's
 * drones are about to put down, while they fly out and scan. A hologram that
 * cannot go where it is shown is red. @see world-scene, autopilot
 *
 * IMAGINARY STRUCTURES: records the grid never holds, mounted through the
 * renderer registry like any other, under ids no real structure has.
 */
import type { Container, Graphics } from "pixi.js";

import { idx, inBounds, type Structure } from "../grid";
import { HEIGHT_UNIT, HH, HW } from "../iso";
import { structureDef } from "../structures/def";
import { rendererFor, type RenderCtx, type StructureHandle, type StructureRenderer } from "../structures/render";

/**
 * One hologram: what, where, and whether it could go there. `key` keeps it
 * the same one between frames. `planned`: part of AI mode's masterplan, not
 * yet under way — dimmer and steady, and drawn without scan lines, so a town's
 * worth costs nothing a frame. `steady`: the build tool's — lit, with its
 * footprint, but no flicker and no warp-in, which is the AI building.
 */
export type HoloSpec = { key: string; def: string; x: number; y: number; ok: boolean; planned?: boolean; steady?: boolean };

export const HOLO_OK = 0x5fe3ff;
export const HOLO_BLOCKED = 0xff5a5a;
/** The most shown at once: a dragged row of lots, the AI's drones, and the masterplan's nearest. */
export const MAX_HOLOGRAMS = 260;
/** The masterplan's buildings shown as holograms at most; the rest stay a tint on the ground. */
export const PLAN_HOLOGRAMS = 200;
/** How a planned building looks: fainter than one on its way. */
const PLANNED_ALPHA = 0.45;
/** How the build tool's hologram looks: steady glass, a touch clearer than a planned one. */
const STEADY_ALPHA = 0.55;

type Shown = { spec: HoloSpec; s: Structure; handle: StructureHandle; renderer: StructureRenderer; styled: boolean };

export type Holograms = {
  /** Show exactly these, mounting what is new and unmounting what is gone. */
  set: (specs: readonly HoloSpec[], ctx: RenderCtx) => void;
  /** Restyle them for the moment `t` seconds, and draw their scan lines on `scan`, in its own space. */
  tick: (t: number, scan: Graphics) => void;
  clear: () => void;
};

/** What a renderer drew, to restyle: sprites, columns of graphics, a sky. */
const partsOf = (h: StructureHandle): Container[] => {
  const x = h as { sprites?: Container[]; columns?: Container[]; g?: Container; sky?: Container };
  return [...(x.sprites ?? []), ...(x.columns ?? []), ...(x.g ? [x.g] : []), ...(x.sky ? [x.sky] : [])];
};

/** A footprint's diamond on the ground, in the scan layer's space; null without a grid to stand on. */
let groundOf: ((x: number, y: number) => number) | null = null;
let scaleOf = 1;
function footOf(s: Structure, _scan: Graphics): number[] | null {
  if (!groundOf) return null;
  const z = groundOf(s.x, s.y);
  const P = (u: number, v: number): [number, number] => [(u - v) * HW * scaleOf, (u + v) * HH * scaleOf - z * HEIGHT_UNIT * scaleOf];
  return [...P(s.x - 0.5, s.y - 0.5), ...P(s.x + s.w - 0.5, s.y - 0.5), ...P(s.x + s.w - 0.5, s.y + s.h - 0.5), ...P(s.x - 0.5, s.y + s.h - 0.5)];
}

/** The part after the point, 0–1, whatever the sign. */
const frac = (x: number) => x - Math.floor(x);

export function createHolograms(): Holograms {
  const shown = new Map<string, Shown>();
  let nextId = -1_000_000;

  const unmount = (key: string) => {
    const m = shown.get(key);
    if (!m) return;
    m.renderer.unmount(m.handle);
    shown.delete(key);
  };

  return {
    set(specs, ctx) {
      groundOf = (x, y) => (inBounds(ctx.grid, x, y) ? ctx.grid.height[idx(ctx.grid, x, y)] : 0);
      scaleOf = ctx.scale;
      const want = new Map(specs.slice(0, MAX_HOLOGRAMS).map((s) => [s.key, s]));
      for (const [key, m] of shown) {
        const w = want.get(key);
        if (!w || w.def !== m.spec.def || w.x !== m.spec.x || w.y !== m.spec.y) unmount(key);
        else { if (w.planned !== m.spec.planned || w.steady !== m.spec.steady || w.ok !== m.spec.ok) m.styled = false; m.spec = w; }
      }
      for (const [key, spec] of want) {
        if (shown.has(key)) continue;
        const def = structureDef(spec.def);
        const renderer = def ? rendererFor(def) : null;
        if (!def || !renderer) continue;
        const s: Structure = { id: nextId--, def: def.id, x: spec.x, y: spec.y, w: def.footprint.w, h: def.footprint.h };
        shown.set(key, { spec, s, handle: renderer.mount(s, def, ctx), renderer, styled: false });
      }
    },

    tick(t, scan) {
      scan.clear();
      for (const m of shown.values()) {
        const colour = m.spec.ok ? HOLO_OK : HOLO_BLOCKED;
        // PLANNED: styled once, and left — no flicker, no scan lines.
        if (m.spec.planned) {
          if (m.styled) continue;
          // Glass, not light: tinted over what is under it, so it stays cyan on grass.
          for (const p of partsOf(m.handle)) {
            (p as Container & { tint: number }).tint = colour;
            p.blendMode = "normal";
            p.alpha = PLANNED_ALPHA;
          }
          m.styled = true;
          continue;
        }
        // THE BUILD TOOL'S: tinted glass, still, its footprint outlined on the
        // ground — no glow, no flicker, no warp-in.
        if (m.spec.steady) {
          if (!m.styled) {
            for (const p of partsOf(m.handle)) {
              (p as Container & { tint: number }).tint = colour;
              p.blendMode = "normal";
              p.alpha = STEADY_ALPHA;
            }
            m.styled = true;
          }
          const foot = footOf(m.s, scan);
          if (foot) { scan.poly(foot); scan.fill({ color: colour, alpha: 0.1 }); scan.poly(foot); scan.stroke({ color: colour, width: 1.5, alpha: 0.6 }); }
          continue;
        }
        // THE AI BUILDING: a slow breath, and now and then a stutter.
        const seed = m.s.id * 0.37;
        const stutter = Math.sin(t * 23 + seed * 7) > 0.93 ? 0.45 : 1;
        const alpha = (0.62 + 0.12 * Math.sin(t * 3 + seed)) * stutter;
        let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
        for (const p of partsOf(m.handle)) {
          (p as Container & { tint: number }).tint = colour;
          // LIGHT, not paint: added to what is behind it, so it glows over grass and roofs alike.
          p.blendMode = "add";
          p.alpha = alpha;
          if (!scan.parent) continue;
          const b = p.getBounds().rectangle;
          if (b.width <= 0 || b.height <= 0) continue;
          x0 = Math.min(x0, b.x); y0 = Math.min(y0, b.y); x1 = Math.max(x1, b.x + b.width); y1 = Math.max(y1, b.y + b.height);
        }
        if (!Number.isFinite(x0) || !scan.parent) continue;
        // SCAN LINES, in the overlay's space: faint rules, and a bright one running up.
        const a = scan.parent.toLocal({ x: x0, y: y0 });
        // Its footprint lit on the ground beneath it.
        const foot = footOf(m.s, scan);
        if (foot) { scan.poly(foot); scan.fill({ color: colour, alpha: 0.22 * stutter }); scan.poly(foot); scan.stroke({ color: colour, width: 1.5, alpha: 0.8 * stutter }); }
        // SLICES THROUGH IT, not lines across the screen: the footprint's
        // outline lifted from the ground to the roof, so a scan follows its
        // walls at every height and never shows below it. Its height is how
        // far the back of the footprint has to rise to reach the top of what
        // it drew. Faint ones every so often, and a bright one running up.
        if (!foot) continue;
        const rise = Math.max(0, foot[1] - a.y);
        const slice = (up: number) => foot.map((v, k) => (k % 2 ? v - up : v));
        const rules = 7;
        for (let k = 1; k < rules; k++) scan.poly(slice(((k + frac(t * 0.4)) / rules) * rise));
        scan.stroke({ color: colour, width: 1, alpha: 0.2 * stutter });
        // A fraction always 0–1: holograms' ids are negative, and `%` keeps the sign.
        const run = frac(t * 0.6 + seed) * rise;
        scan.poly(slice(run));
        scan.stroke({ color: colour, width: 4, alpha: 0.25 * stutter });
        scan.poly(slice(run));
        scan.stroke({ color: 0xffffff, width: 1.5, alpha: 0.75 * stutter });
      }
    },

    clear() {
      for (const key of [...shown.keys()]) unmount(key);
    },
  };
}
