/**
 * World v2 — THE AI, SEEN ON THE MAP: drawn over everything in the overlay,
 * every frame, from where the singularity stands.
 *  - THE DATA CENTRE COMES ALIVE: a glow round it in its stage's colour,
 *    brighter at night and as the meter rises, and a shimmer of heat over it
 *    while it trains;
 *  - DATA LINKS: light running out along a line to every rack; a rack out of
 *    reach flickers;
 *  - HOLOGRAPHIC AGENTS: one a rack, up to `HOLOGRAMS`, walking the streets —
 *    translucent, and stranger as the stages go on;
 *  - THE ASCENSION: beams to every rack, a column of light, and the holograms
 *    pouring out. @see ascension-sequence
 * Nothing here is saved or clicked; it is how the town looks.
 */
import { Graphics, type Container } from "pixi.js";

import { NEIGHBOUR } from "../../iso/dir";
import { HEIGHT_UNIT, HH, HW } from "../iso";
import { idx, inBounds, structureAt, type Grid, type Structure } from "../grid";
import { structureDef } from "../structures/def";
import type { Masterplan } from "./masterplan/plan";
import type { PipeRoute } from "./pipe-route";
import { isPaved } from "../roads/mask";
import { powered as rackPowered } from "../projects/racks";
import { tankFor } from "../projects/cooling";
import { lookOf } from "../structures/projects/looks";
import { topOf } from "../structures/projects/schedule";
import type { Stage } from "../../state/ai-singularity.store";

/** Each stage's colour: green, through amber, to violet. */
export const STAGE_COLOUR: Record<Stage, number> = {
  tool: 0x3fe0a8, assistant: 0x8fe36a, colleague: 0xf2c230, manager: 0xf07a3a, overseer: 0xb44aff, ascension: 0xd8b4ff,
};
/** Holograms at most, and how fast they walk, tiles a second. */
export const HOLOGRAMS = 20;
const WALK = 0.7;
const HOLO = 0x7fe8ff;

/** What the layer needs to know each frame. */
export type AiView = {
  stage: Stage;
  /** The meter, 0–100. */
  value: number;
  /** Agents running, and racks standing. */
  running: number;
  training: boolean;
  /** 0 by day, up to 1 at the darkest of night. */
  night: number;
  /** 0 until the Ascension sequence starts, rising to 1 at its height. @see ascension-sequence */
  ascension: number;
  /** The AI's drones aloft, and whether each is scanning its spot. @see stepAi */
  drones?: readonly { x: number; y: number; scanning: boolean }[];
  /** AI mode's masterplan, to show as a ghost of the town to come. @see autopilot */
  plan?: Masterplan | null;
  /** A pipe AI mode means to lay and cannot yet pay for: cyan, its pump a square. @see pendingPipe */
  pipe?: PipeRoute | null;
  /** How well the Data Centre is cooled, 0–1, and how full its tank is; both 1 by default. @see game/cooling */
  cooled?: number;
  tank?: number;
};

/** The colour a Data Centre running dry turns. */
const HOT = 0xff5a2a;
/** Two colours mixed, `k` of the way from `a` to `b`. */
const mix = (a: number, b: number, k: number) => {
  const ch = (c: number, s: number) => (c >> s) & 255;
  const m = (s: number) => Math.round(ch(a, s) + (ch(b, s) - ch(a, s)) * k) << s;
  return m(16) | m(8) | m(0);
};

type Hologram = { x: number; y: number; fx: number; fy: number; tx: number; ty: number; k: number; seed: number };

export type AiLayer = {
  draw: (g: Grid, sc: number, view: AiView, dt: number, now: number) => void;
  /** Nothing shown: the editor, or no game. */
  clear: () => void;
  destroy: () => void;
};

const DIRS = ["N", "E", "S", "W"] as const;

export function createAiLayer(overlay: Container): AiLayer {
  const gfx = new Graphics();
  gfx.eventMode = "none";
  gfx.zIndex = 996;
  overlay.addChild(gfx);
  let holos: Hologram[] = [];
  let dcTop: { def: string; z: number } | null = null;

  const ground = (g: Grid, x: number, y: number) => (inBounds(g, x, y) ? g.height[idx(g, x, y)] : 0);
  const P = (sc: number, u: number, v: number, z: number): [number, number] =>
    [(u - v) * HW * sc, (u + v) * HH * sc - z * HEIGHT_UNIT * sc];

  /** A hologram's next tile: a paved neighbour, not back the way it came if it can help it. */
  const step = (g: Grid, h: Hologram) => {
    const opts = DIRS.map((d) => NEIGHBOUR[d]).map(([dx, dy]) => ({ x: h.tx + dx, y: h.ty + dy }))
      .filter((c) => isPaved(g, c.x, c.y));
    const fresh = opts.filter((c) => c.x !== h.fx || c.y !== h.fy);
    const pool = fresh.length ? fresh : opts;
    h.fx = h.tx; h.fy = h.ty;
    if (!pool.length) return;
    h.seed = (h.seed * 1664525 + 1013904223) >>> 0;
    const n = pool[h.seed % pool.length];
    h.tx = n.x; h.ty = n.y; h.k = 0;
  };

  /** The town to come: what is not built yet of the plan. */
  const drawPlan = (g: Grid, sc: number, plan: Masterplan) => {
    const tile = (x: number, y: number, z: number) =>
      [...P(sc, x - 0.5, y - 0.5, z), ...P(sc, x + 0.5, y - 0.5, z), ...P(sc, x + 0.5, y + 0.5, z), ...P(sc, x - 0.5, y + 0.5, z)];
    for (const s of plan.steps) {
      if (s.kind === "road") {
        for (let y = Math.min(s.from.y, s.to.y); y <= Math.max(s.from.y, s.to.y); y++) {
          for (let x = Math.min(s.from.x, s.to.x); x <= Math.max(s.from.x, s.to.x); x++) {
            if (!inBounds(g, x, y) || isPaved(g, x, y)) continue;
            gfx.poly(tile(x, y, ground(g, x, y)));
            gfx.fill({ color: 0x2b2f36, alpha: 0.45 });
          }
        }
        continue;
      }
      // TERRAFORMING hatched; what it will pull up or down, outlined red.
      if (s.kind === "level") {
        for (let y = Math.min(s.from.y, s.to.y); y <= Math.max(s.from.y, s.to.y); y++) {
          for (let x = Math.min(s.from.x, s.to.x); x <= Math.max(s.from.x, s.to.x); x++) {
            if (!inBounds(g, x, y) || g.height[idx(g, x, y)] === s.z) continue;
            const z = ground(g, x, y);
            gfx.moveTo(...P(sc, x - 0.4, y - 0.4, z)).lineTo(...P(sc, x + 0.4, y + 0.4, z));
            gfx.moveTo(...P(sc, x + 0.4, y - 0.4, z)).lineTo(...P(sc, x - 0.4, y + 0.4, z));
            gfx.stroke({ color: 0xb07a3c, width: Math.max(1, sc), alpha: 0.85 });
          }
        }
        continue;
      }
      if (s.kind === "lift" || s.kind === "clear") {
        const there = s.kind === "lift" ? isPaved(g, s.at.x, s.at.y) : structureAt(g, s.at.x, s.at.y) >= 0;
        if (!there) continue;
        gfx.poly(tile(s.at.x, s.at.y, ground(g, s.at.x, s.at.y)));
        gfx.stroke({ color: 0xef4444, width: Math.max(1, 1.5 * sc), alpha: 0.9 });
        continue;
      }
      const d = structureDef(s.def);
      if (!d || structureAt(g, s.at.x, s.at.y) >= 0) continue;
      // Lots violet, the AI's own colour; offices blue; services gold. Outlined whole.
      const colour = s.def.startsWith("kit:") ? 0xa78bfa : s.def.startsWith("office") ? 0x4f8cff : 0xf2c230;
      const { w, h } = d.footprint;
      const z = ground(g, s.at.x, s.at.y);
      gfx.poly([...P(sc, s.at.x - 0.45, s.at.y - 0.45, z), ...P(sc, s.at.x + w - 0.55, s.at.y - 0.45, z), ...P(sc, s.at.x + w - 0.55, s.at.y + h - 0.55, z), ...P(sc, s.at.x - 0.45, s.at.y + h - 0.55, z)]);
      gfx.fill({ color: colour, alpha: 0.4 });
      gfx.stroke({ color: colour, width: Math.max(1, sc), alpha: 0.9 });
    }
  };

  return {
    draw: (g, sc, view, dt, now) => {
      gfx.clear();
      const structures = [...g.structures.values()];
      // THE MASTERPLAN: planned streets outlined, planned buildings a tint on the ground.
      if (view.plan) drawPlan(g, sc, view.plan);
      // AND THE PIPE IT MEANS TO LAY, cyan; its pump house a square.
      if (view.pipe) {
        for (const c of view.pipe.pipe) {
          const z = ground(g, c.x, c.y);
          gfx.poly([...P(sc, c.x - 0.18, c.y - 0.18, z), ...P(sc, c.x + 0.18, c.y - 0.18, z), ...P(sc, c.x + 0.18, c.y + 0.18, z), ...P(sc, c.x - 0.18, c.y + 0.18, z)]);
          gfx.fill({ color: 0x22d3ee, alpha: 0.7 });
        }
        if (view.pipe.pump) {
          const c = view.pipe.pump, z = ground(g, c.x, c.y);
          gfx.poly([...P(sc, c.x - 0.4, c.y - 0.4, z), ...P(sc, c.x + 0.4, c.y - 0.4, z), ...P(sc, c.x + 0.4, c.y + 0.4, z), ...P(sc, c.x - 0.4, c.y + 0.4, z)]);
          gfx.stroke({ color: 0x22d3ee, width: Math.max(1, 1.5 * sc), alpha: 0.9 });
        }
      }
      const dc = structures.find((s) => s.def === "datacentre" && !s.build);
      if (!dc) { holos = []; return; }
      if (!dcTop || dcTop.def !== dc.def) dcTop = { def: dc.def, z: topOf(lookOf(dc.def, { w: dc.w, h: dc.h })) };
      const t = now / 1000;
      const asc = view.ascension;
      // RUNNING DRY it turns orange-red, and pulses slow, as if labouring; its links dim. @see game/cooling
      const cooled = asc > 0 ? 1 : Math.max(0, Math.min(1, view.cooled ?? 1));
      const heat = (1 - cooled) * (0.75 + 0.25 * Math.sin(t * 1.2));
      const colour = heat > 0.01 ? mix(STAGE_COLOUR[view.stage], HOT, heat) : STAGE_COLOUR[view.stage];
      const base = ground(g, dc.x, dc.y);
      const cu = dc.x - 0.5 + dc.w / 2, cv = dc.y - 0.5 + dc.h / 2;

      // THE GLOW round its foot: brighter at night, as the meter rises, and at the Ascension.
      const glow = Math.min(0.85, (0.12 + 0.35 * view.night + 0.25 * (view.value / 100)) * (0.85 + 0.15 * Math.sin(t * 2)) + asc * 0.5);
      // Close round its footprint: drawn over everything, a wide one tints the houses beside it.
      for (const [r, a] of [[0.35, 0.35], [0.2, 0.6], [0.08, 1]] as const) {
        const ru = dc.w / 2 + r, rv = dc.h / 2 + r;
        gfx.poly([...P(sc, cu - ru, cv - rv, base), ...P(sc, cu + ru, cv - rv, base), ...P(sc, cu + ru, cv + rv, base), ...P(sc, cu - ru, cv + rv, base)]);
        gfx.fill({ color: colour, alpha: glow * a * 0.5 });
      }
      const roof = base + dcTop.z;

      // ITS STATUS LIGHTS: a ring round the roof's edge in the stage's colour, pulsing.
      {
        const u0 = dc.x - 0.5 + 0.15, v0 = dc.y - 0.5 + 0.15, u1 = dc.x - 0.5 + dc.w - 0.15, v1 = dc.y - 0.5 + dc.h - 0.15;
        gfx.poly([...P(sc, u0, v0, roof), ...P(sc, u1, v0, roof), ...P(sc, u1, v1, roof), ...P(sc, u0, v1, roof)]);
        gfx.stroke({ color: colour, width: Math.max(1.5, 2.5 * sc), alpha: 0.55 + 0.35 * Math.sin(t * 3) });
      }

      // HEAT over it while it trains: wavering lines rising off the roof.
      if (view.training) {
        for (let k = 0; k < 5; k++) {
          const u = cu - dc.w / 2 + ((k + 0.5) / 5) * dc.w;
          const rise = (t * 0.8 + k * 0.37) % 1;
          const [x0, y0] = P(sc, u, cv, roof + rise * 3);
          gfx.moveTo(x0, y0);
          for (let s = 1; s <= 6; s++) {
            const [x, y] = P(sc, u + Math.sin(t * 4 + s + k) * 0.06, cv, roof + rise * 3 + s * 0.35);
            gfx.lineTo(x, y);
          }
          gfx.stroke({ color: 0xffd2a0, width: Math.max(1, 1.5 * sc), alpha: 0.35 * (1 - rise) });
        }
      }

      // VAPOUR off the roof while it is cooled with water to spare: thin puffs, rising and fading.
      if (cooled > 0.95 && (view.tank ?? 1) > 0.5 && asc === 0) {
        for (let k = 0; k < 3; k++) {
          const rise = (t * 0.3 + k / 3) % 1;
          const [x, y] = P(sc, cu + (k - 1) * 0.35, cv, roof + 0.4 + rise * 2.5);
          gfx.circle(x, y, (3 + rise * 6) * sc);
          gfx.fill({ color: 0xe8eef4, alpha: 0.28 * (1 - rise) });
        }
      }

      // THE AI'S OWN, RUNNING DRY: an orange outline on the ground, flickering. @see game/cooling
      for (const s of structures) {
        if (s.build || (s.def !== "gpu-farm" && s.def !== "ai-node" && s.def !== "compute-spire")) continue;
        const share = tankFor(s.id)?.share ?? 1;
        if (share > 0.6) continue;
        const on = Math.sin(t * 11 + s.id) > 0 ? 1 : 0.35;
        const z = ground(g, s.x, s.y);
        gfx.poly([...P(sc, s.x - 0.5, s.y - 0.5, z), ...P(sc, s.x + s.w - 0.5, s.y - 0.5, z), ...P(sc, s.x + s.w - 0.5, s.y + s.h - 0.5, z), ...P(sc, s.x - 0.5, s.y + s.h - 0.5, z)]);
        gfx.stroke({ color: HOT, width: Math.max(1, 1.5 * sc), alpha: (0.9 - share) * on });
      }

      // DATA LINKS to every rack: a faint line, and light running out along it.
      const racks = structures.filter((s) => s.def === "rack" && !s.build);
      const from = P(sc, cu, cv, roof + 0.3);
      for (const [k, r] of racks.entries()) {
        const on = rackPowered(g, r);
        const to = P(sc, r.x, r.y, ground(g, r.x, r.y) + 2.2);
        const flick = on ? 1 : 0.4 + 0.6 * (Math.sin(t * 13 + k * 2.1) > 0.3 ? 1 : 0.2);
        gfx.moveTo(from[0], from[1]).lineTo(to[0], to[1]);
        gfx.stroke({ color: colour, width: Math.max(1, (1 + asc * 3) * sc), alpha: (0.18 + asc * 0.5) * flick * (0.4 + 0.6 * cooled) });
        if (view.running > 0 || asc > 0) {
          for (let p = 0; p < 3; p++) {
            const f = (t * (0.35 + asc) + p / 3 + k * 0.13) % 1;
            gfx.circle(from[0] + (to[0] - from[0]) * f, from[1] + (to[1] - from[1]) * f, Math.max(1.2, 2.2 * sc));
            gfx.fill({ color: 0xffffff, alpha: 0.7 * flick * (0.4 + 0.6 * cooled) });
          }
        }
      }

      // THE ASCENSION'S COLUMN of light off the Data Centre.
      if (asc > 0) {
        const [x, y] = P(sc, cu, cv, roof);
        const w = (12 + 30 * asc) * sc;
        gfx.poly([x - w / 2, y, x + w / 2, y, x + w / 4, y - 2000 * sc, x - w / 4, y - 2000 * sc]);
        gfx.fill({ color: STAGE_COLOUR.ascension, alpha: 0.25 + 0.4 * asc });
      }

      // THE DRONES: a dark body and a violet light, high up; a beam down while they scan.
      for (const [k, d] of (view.drones ?? []).entries()) {
        const z = ground(g, Math.round(d.x), Math.round(d.y));
        const hover = 5 + Math.sin(t * 6 + k) * 0.15;
        const [x, y] = P(sc, d.x, d.y, z + hover);
        if (d.scanning) {
          const [bx, by] = P(sc, d.x, d.y, z);
          gfx.poly([x - 2 * sc, y, x + 2 * sc, y, bx + 14 * sc, by, bx - 14 * sc, by]);
          gfx.fill({ color: STAGE_COLOUR.overseer, alpha: 0.18 + 0.12 * Math.sin(t * 10) });
        }
        gfx.ellipse(x, y, 6 * sc, 2.4 * sc);
        gfx.fill({ color: 0x1b1530, alpha: 0.95 });
        for (const s of [-1, 1]) {
          gfx.ellipse(x + s * 6 * sc, y - 1.5 * sc, 3.5 * sc, 1 * sc);
          gfx.fill({ color: 0x8a86a0, alpha: 0.5 + 0.3 * Math.sin(t * 40 + s) });
        }
        gfx.circle(x, y - 0.5 * sc, 1.4 * sc);
        gfx.fill({ color: STAGE_COLOUR.overseer, alpha: 0.9 });
      }

      // HOLOGRAMS: one a rack from the Assistant on, more at the Ascension.
      const want = view.stage === "tool" && asc === 0 ? 0 : Math.min(HOLOGRAMS, Math.max(1, racks.length) * (asc > 0 ? 3 : 1));
      while (holos.length > want) holos.pop();
      while (holos.length < want) {
        const r = racks.length ? racks[holos.length % racks.length] : dc;
        const start = nearestRoad(g, r);
        if (!start) break;
        const h: Hologram = { x: start.x, y: start.y, fx: start.x, fy: start.y, tx: start.x, ty: start.y, k: 1, seed: holos.length * 977 + 13 };
        step(g, h);
        holos.push(h);
      }
      const strange = view.stage === "overseer" || view.stage === "ascension" || asc > 0;
      const standing = view.stage === "overseer" && asc === 0;
      for (const [k, h] of holos.entries()) {
        if (!standing) {
          h.k += (WALK * dt);
          if (h.k >= 1) step(g, h);
        }
        const u = h.fx + (h.tx - h.fx) * Math.min(1, h.k), v = h.fy + (h.ty - h.fy) * Math.min(1, h.k);
        const z = ground(g, Math.round(u), Math.round(v));
        const [x, y] = P(sc, u, v, z);
        const glitch = strange && Math.sin(t * 17 + k * 3.3) > 0.85 ? (Math.sin(t * 91 + k) * 4) * sc : 0;
        const tall = (strange ? 1.25 : 1) * sc;
        const a = 0.45 + 0.15 * Math.sin(t * 5 + k);
        gfx.roundRect(x - 2.5 * sc + glitch, y - 15 * tall, 5 * sc, 11 * tall, 2 * sc);
        gfx.fill({ color: HOLO, alpha: a });
        gfx.circle(x + glitch, y - 18 * tall, 2.6 * sc);
        gfx.fill({ color: HOLO, alpha: a + 0.1 });
        gfx.ellipse(x, y, 4 * sc, 1.6 * sc);
        gfx.fill({ color: HOLO, alpha: 0.18 });
      }
    },
    clear: () => { gfx.clear(); holos = []; },
    destroy: () => { gfx.parent?.removeChild(gfx); gfx.destroy(); },
  };
}

/** The road tile nearest a building, by a search out from it. */
function nearestRoad(g: Grid, s: Structure): { x: number; y: number } | null {
  for (let r = 1; r < 8; r++) {
    for (let y = s.y - r; y <= s.y + s.h - 1 + r; y++) {
      for (let x = s.x - r; x <= s.x + s.w - 1 + r; x++) {
        if (isPaved(g, x, y)) return { x, y };
      }
    }
  }
  return null;
}
