/**
 * World v2 — THE TOWN'S LIGHTS AT NIGHT: a warm glow in every building with
 * people in it, and pools of lamplight on the streets at their junctions and
 * every few tiles along them.
 *
 * Drawn ABOVE the night, not under it: the night is a sheet over the whole
 * screen, multiplied in (`world-scene`), and a light under it would be
 * darkened with everything else. So the lights are their own layer on the
 * stage, over the night sheet, carrying the map's own transform each frame.
 * A glow is soft enough that one seen through a building in front of it reads
 * as light spilling round it rather than as a mistake. @see darkness
 */
import { Container, Sprite, Texture, type Matrix } from "pixi.js";

import { housedBy, residentsIn } from "../../game/housing";
import { idx, inBounds, type Grid } from "../grid";
import { cellToWorld } from "../iso";
import { isPaved } from "../roads/mask";
import { tierOf } from "../agents/services";
import { DESKS } from "../agents/commute";
import { notable } from "../../game/machine";
import { serviceOf } from "../agents/needs";
import { SHOP_LOOK, shopfrontsOf } from "./shopfronts";

const WINDOW = 0xffc46b;
const NIGHT_SHIFT_WINDOW = 0xb44aff;
/** Crunch Week's: the offices' strip lights, cold and bright, everyone still in. */
const CRUNCH_WINDOW = 0xd8ecff;
const LAMP = 0xffe2a0;
/** How high a building's glow sits over its ground, screen px at scale 1, by tier. */
const RISE: Record<string, number> = { t0: 18, t1: 28, t2: 46, landmark: 80 };
/** How high a shop's sign glows over its ground, screen px at scale 1. */
const SIGN_RISE = 26;
/** A lamp every this many tiles along a straight street. */
const LAMP_EVERY = 4;

/**
 * A CONDITION'S GLOW, day and night: what is wrong with a building or a tile,
 * in light. Heat pulses red-orange; a fire flickers bright orange; closed is a
 * steady cold grey; road works an amber lamp, blinking. @see conditionsOf
 */
export type Condition = { kind: "heat" | "closed" | "works" | "fire"; x: number; y: number; w: number; h: number; rise: number };

const HEAT_GLOW = 0xff5a1f;
const FIRE_GLOW = 0xff8a1c;
const CLOSED_GLOW = 0x9aa6b4;
const WORKS_LAMP = 0xffa526;
/** The road-works lamp's height over its tile, screen px at scale 1: on top of the barrier. */
const WORKS_RISE = 15;

/** How high a building's glow sits, by its def. */
export const riseOf = (def: string) => RISE[tierOf(def) ?? ""] ?? 34;

/**
 * Where the conditions glow: each damaged building by its cause — none for a
 * flood, whose water shows it — and a lamp on each closed road tile. Pure.
 */
export function conditionsOf(g: Grid, damaged: Iterable<readonly [number, string]>, closedTiles: Iterable<{ x: number; y: number }>, riseFor?: (id: number) => number | null, burning: readonly number[] = []): Condition[] {
  const out: Condition[] = [];
  // ON FIRE: its flicker, in place of whatever else is wrong with it.
  for (const id of burning) {
    const s = g.structures.get(id);
    if (s) out.push({ kind: "fire", x: s.x, y: s.y, w: s.w, h: s.h, rise: Math.round(riseFor?.(id) ?? riseOf(s.def)) });
  }
  for (const [id, cause] of damaged) {
    const s = g.structures.get(id);
    if (!s || (cause !== "heat" && cause !== "closed") || burning.includes(id)) continue;
    out.push({ kind: cause, x: s.x, y: s.y, w: s.w, h: s.h, rise: Math.round(riseFor?.(id) ?? riseOf(s.def)) });
  }
  for (const t of closedTiles) out.push({ kind: "works", x: t.x, y: t.y, w: 1, h: 1, rise: WORKS_RISE });
  return out;
}

/** A condition's glow at `t` seconds: heat pulsing, a lamp blinking, closed steady. `phase` keeps two from pulsing together. Pure. */
export function conditionAlpha(kind: Condition["kind"], t: number, phase = 0): number {
  if (kind === "heat") return 0.45 + 0.25 * Math.sin((t * 1.6 + phase) * Math.PI);
  if (kind === "works") return (t + phase) % 1 < 0.55 ? 0.95 : 0.12;
  // Two waves out of step, so it never settles into a beat.
  if (kind === "fire") return 0.7 + 0.18 * Math.sin((t * 7.3 + phase) * Math.PI) + 0.12 * Math.sin((t * 11.9 + phase * 3) * Math.PI);
  return 0.42;
}

export type Lights = {
  /** Put the lights where the map's buildings and streets are now. */
  sync: (g: Grid, scale: number, crunch?: boolean) => void;
  /**
   * A BLACKOUT: these buildings' lights out — or, with `flicker`, flickering
   * as the grid fails. None to put them all back. @see BLACKOUT
   */
  dark: (ids: ReadonlySet<number>, flicker: boolean) => void;
  /** Put the conditions' glows where they are now; shown day and night. @see conditionsOf */
  conditions: (g: Grid, scale: number, list: readonly Condition[]) => void;
  /** This frame: how dark it is (0–1) and the map's transform to the screen. */
  tick: (night: number, map: Matrix, t: number) => void;
  destroy: () => void;
};

let glow: Texture | null = null;
/** A soft round glow, white, brightest in the middle: made once. */
function glowTexture(): Texture {
  if (glow) return glow;
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d")!;
  const r = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  r.addColorStop(0, "rgba(255,255,255,1)");
  r.addColorStop(0.35, "rgba(255,255,255,0.45)");
  r.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = r;
  g.fillRect(0, 0, 64, 64);
  glow = Texture.from(c);
  return glow;
}

/** Where the lights go: a glow per lit building, a pool per lamp. Pure, for tests. */
export function lightsOf(g: Grid, crunch = false): { kind: "window" | "lamp" | "sign"; x: number; y: number; w: number; h: number; rise: number; violet?: boolean; crunch?: boolean; tint?: number; neon?: boolean; id?: number }[] {
  // THE NIGHT SHIFT: workplaces lit violet, the AI at the empty desks. @see game/machine "nightshift"
  const night = notable("nightshift");
  const out: ReturnType<typeof lightsOf> = [];
  for (const s of g.structures.values()) {
    if (s.build) continue;
    const housed = housedBy(s.def);
    // A house with nobody in it is dark.
    if (housed && !residentsIn(s)) continue;
    if (s.def === "derelict") continue;
    out.push({ kind: "window", id: s.id, x: s.x, y: s.y, w: s.w, h: s.h, rise: riseOf(s.def), ...(night && s.def in DESKS ? { violet: true } : crunch && s.def in DESKS ? { crunch: true } : {}) });
  }
  // THE SHOPS' SIGNS, each in its own colour — a neon one brighter — at its front.
  for (const f of shopfrontsOf(g)) {
    const L = SHOP_LOOK[f.sv];
    out.push({ kind: "sign", x: f.x, y: f.y, w: 1, h: 1, rise: SIGN_RISE, tint: L.glow, ...(L.neon ? { neon: true } : {}) });
  }
  for (const s of g.structures.values()) {
    const sv = !s.build && serviceOf(s.def);
    if (!sv) continue;
    const L = SHOP_LOOK[sv];
    out.push({ kind: "sign", id: s.id, x: s.x, y: s.y, w: s.w, h: s.h, rise: SIGN_RISE, tint: L.glow, ...(L.neon ? { neon: true } : {}) });
  }
  const paved = (x: number, y: number) => inBounds(g, x, y) && isPaved(g, x, y);
  for (let y = 0; y < g.h; y++) {
    for (let x = 0; x < g.w; x++) {
      if (!paved(x, y)) continue;
      const ways = +paved(x + 1, y) + +paved(x - 1, y) + +paved(x, y + 1) + +paved(x, y - 1);
      if (ways >= 3 || (ways > 0 && (x + y) % LAMP_EVERY === 0)) out.push({ kind: "lamp", x, y, w: 1, h: 1, rise: 0 });
    }
  }
  return out;
}

export function createLights(stage: Container, zIndex: number): Lights {
  const root = new Container();
  root.eventMode = "none";
  root.zIndex = zIndex;
  root.visible = false;
  stage.addChild(root);
  const sprites: Sprite[] = [];
  /** Each light's building, if it is one's, and its own alpha, for a blackout to take and give back. */
  const owner: (number | undefined)[] = [];
  const base: number[] = [];
  let darkIds: ReadonlySet<number> = new Set(), flickering = false, wasDark = false;
  // THE CONDITIONS, their own root: the lights' is hidden by day. Over the
  // night sheet as the lights are, so a glow at night is not darkened.
  const cond = new Container();
  cond.eventMode = "none";
  cond.zIndex = zIndex;
  cond.visible = false;
  stage.addChild(cond);
  const glows: { s: Sprite; kind: Condition["kind"]; phase: number }[] = [];
  return {
    conditions(g, scale, list) {
      while (glows.length > list.length) glows.pop()!.s.destroy();
      while (glows.length < list.length) {
        const s = new Sprite(glowTexture());
        s.anchor.set(0.5);
        cond.addChild(s);
        glows.push({ s, kind: "heat", phase: 0 });
      }
      list.forEach((c, k) => {
        const gl = glows[k], s = gl.s;
        gl.kind = c.kind;
        gl.phase = ((c.x * 7 + c.y * 13) % 10) / 10;
        const z = inBounds(g, c.x, c.y) ? g.height[idx(g, c.x, c.y)] : 0;
        const { wx, wy } = cellToWorld(c.x + (c.w - 1) / 2, c.y + (c.h - 1) / 2, z, scale);
        s.x = wx;
        s.y = wy - c.rise * scale;
        if (c.kind === "works") {
          s.tint = WORKS_LAMP;
          s.blendMode = "add";
          s.scale.set(0.55 * scale);
        } else {
          // Heat added on, as light; closed laid over, a cold grey wash.
          s.tint = c.kind === "heat" ? HEAT_GLOW : c.kind === "fire" ? FIRE_GLOW : CLOSED_GLOW;
          s.blendMode = c.kind === "closed" ? "normal" : "add";
          s.scale.set((c.kind === "fire" ? 1.5 : 1) * (1.1 + 0.5 * Math.max(c.w, c.h)) * scale);
        }
      });
      cond.visible = glows.length > 0;
    },
    sync(g, scale, crunch = false) {
      const want = lightsOf(g, crunch);
      while (sprites.length > want.length) sprites.pop()!.destroy();
      while (sprites.length < want.length) {
        const s = new Sprite(glowTexture());
        s.anchor.set(0.5);
        s.blendMode = "add";
        root.addChild(s);
        sprites.push(s);
      }
      owner.length = base.length = 0;
      want.forEach((l, k) => {
        const s = sprites[k];
        owner[k] = l.id;
        const z = inBounds(g, l.x, l.y) ? g.height[idx(g, l.x, l.y)] : 0;
        const { wx, wy } = cellToWorld(l.x + (l.w - 1) / 2, l.y + (l.h - 1) / 2, z, scale);
        s.x = wx;
        s.y = wy - l.rise * scale;
        if (l.kind === "window") {
          s.tint = l.violet ? NIGHT_SHIFT_WINDOW : l.crunch ? CRUNCH_WINDOW : WINDOW;
          s.scale.set((l.crunch ? 1.6 : 1) * (1.1 + 0.5 * Math.max(l.w, l.h)) * scale);
          s.alpha = l.crunch ? 0.8 : 0.55;
        } else if (l.kind === "sign") {
          // Toward the front, where the sign is.
          s.y += 10 * scale;
          s.tint = l.tint ?? WINDOW;
          s.scale.set((l.neon ? 1.1 : 0.8) * Math.max(l.w, l.h) * scale);
          s.alpha = l.neon ? 0.85 : 0.6;
        } else {
          s.tint = LAMP;
          // A pool on the ground: flattened, as the tiles are.
          s.scale.set(1.3 * scale, 0.65 * scale);
          s.alpha = 0.4;
        }
        base[k] = s.alpha;
      });
      wasDark = true;
    },
    dark(ids, flicker) {
      darkIds = ids;
      flickering = flicker;
    },
    tick(night, map, t) {
      if (cond.visible) {
        cond.setFromMatrix(map);
        for (const gl of glows) gl.s.alpha = conditionAlpha(gl.kind, t, gl.phase);
      }
      root.visible = night > 0.02 && sprites.length > 0;
      if (!root.visible) return;
      root.alpha = Math.min(1, night * 1.2);
      root.setFromMatrix(map);
      // THE DISTRICT DARK, or failing: its lights out, or stuttering.
      if (darkIds.size || wasDark) {
        sprites.forEach((s, k) => {
          const id = owner[k];
          const out = id !== undefined && darkIds.has(id);
          s.alpha = !out ? base[k] : flickering ? (Math.sin(t * 23 + k) > 0.3 && Math.random() > 0.4 ? base[k] : 0.05) : 0;
        });
        wasDark = darkIds.size > 0;
      }
    },
    destroy() {
      root.parent?.removeChild(root);
      root.destroy({ children: true });
      sprites.length = 0;
      cond.parent?.removeChild(cond);
      cond.destroy({ children: true });
      glows.length = 0;
    },
  };
}
