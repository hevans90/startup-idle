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

const WINDOW = 0xffc46b;
const LAMP = 0xffe2a0;
/** How high a building's glow sits over its ground, screen px at scale 1, by tier. */
const RISE: Record<string, number> = { t0: 18, t1: 28, t2: 46, landmark: 80 };
/** A lamp every this many tiles along a straight street. */
const LAMP_EVERY = 4;

export type Lights = {
  /** Put the lights where the map's buildings and streets are now. */
  sync: (g: Grid, scale: number) => void;
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
export function lightsOf(g: Grid): { kind: "window" | "lamp"; x: number; y: number; w: number; h: number; rise: number }[] {
  const out: ReturnType<typeof lightsOf> = [];
  for (const s of g.structures.values()) {
    if (s.build) continue;
    const housed = housedBy(s.def);
    // A house with nobody in it is dark.
    if (housed && !residentsIn(s)) continue;
    if (s.def === "derelict") continue;
    out.push({ kind: "window", x: s.x, y: s.y, w: s.w, h: s.h, rise: RISE[tierOf(s.def) ?? ""] ?? 34 });
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
  return {
    sync(g, scale) {
      const want = lightsOf(g);
      while (sprites.length > want.length) sprites.pop()!.destroy();
      while (sprites.length < want.length) {
        const s = new Sprite(glowTexture());
        s.anchor.set(0.5);
        s.blendMode = "add";
        root.addChild(s);
        sprites.push(s);
      }
      want.forEach((l, k) => {
        const s = sprites[k];
        const z = inBounds(g, l.x, l.y) ? g.height[idx(g, l.x, l.y)] : 0;
        const { wx, wy } = cellToWorld(l.x + (l.w - 1) / 2, l.y + (l.h - 1) / 2, z, scale);
        s.x = wx;
        s.y = wy - l.rise * scale;
        if (l.kind === "window") {
          s.tint = WINDOW;
          s.scale.set((1.1 + 0.5 * Math.max(l.w, l.h)) * scale);
          s.alpha = 0.55;
        } else {
          s.tint = LAMP;
          // A pool on the ground: flattened, as the tiles are.
          s.scale.set(1.3 * scale, 0.65 * scale);
          s.alpha = 0.4;
        }
      });
    },
    tick(night, map) {
      root.visible = night > 0.02 && sprites.length > 0;
      if (!root.visible) return;
      root.alpha = Math.min(1, night * 1.2);
      root.setFromMatrix(map);
    },
    destroy() {
      root.parent?.removeChild(root);
      root.destroy({ children: true });
      sprites.length = 0;
    },
  };
}
