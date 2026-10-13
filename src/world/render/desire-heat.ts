/**
 * World v2 — THE PLACING HEAT MAP: with a lot in hand, every tile it could go
 * on tinted by how desirable a house there would be — so where to build is
 * read off the map, not found out afterwards. @see world/agents/desirability
 *
 * Drawn once whenever the map, the tool or the building in hand changes, not
 * every frame: a tint a tile, in the overlay above everything.
 */
import { Graphics, type Container } from "pixi.js";

import type { GeneratorId } from "../../state/generators.store";
import { HEIGHT_UNIT, HH, HW } from "../iso";
import { idx, type Grid } from "../grid";
import { desireAt, type DesireMaps } from "../agents/desirability";

/** A desirability as a colour: red for a place nobody wants, deep green for the best. */
export function heatColour(total: number): number {
  if (total >= 16) return 0x2e9e4f;
  if (total >= 10) return 0x63c26a;
  if (total >= 4) return 0xb6e07a;
  if (total >= 0) return 0xf2d06b;
  if (total > -15) return 0xf08a5a;
  return 0xe0554a;
}

export type DesireHeat = {
  /** Tint every tile `can` allows, for a house of `who`; or clear with no kind. */
  draw: (g: Grid, maps: DesireMaps | null, who: GeneratorId | null, can: (x: number, y: number) => boolean, scale: number, slopFill: number) => void;
  destroy: () => void;
};

export function createDesireHeat(overlay: Container): DesireHeat {
  const gfx = new Graphics();
  gfx.eventMode = "none";
  gfx.zIndex = 998;               // under the cursor's tint and outline
  gfx.alpha = 0.45;
  overlay.addChild(gfx);
  return {
    draw: (g, maps, who, can, sc, slopFill) => {
      gfx.clear();
      if (!maps || !who) return;
      for (let y = 0; y < g.h; y++) {
        for (let x = 0; x < g.w; x++) {
          if (!can(x, y)) continue;
          const d = desireAt(g, maps, x, y, who, slopFill);
          if (!d) continue;
          const h = g.height[idx(g, x, y)];
          const P = (u: number, v: number) => [(u - v) * HW * sc, (u + v) * HH * sc - h * HEIGHT_UNIT * sc];
          gfx.poly([...P(x - 0.5, y - 0.5), ...P(x + 0.5, y - 0.5), ...P(x + 0.5, y + 0.5), ...P(x - 0.5, y + 0.5)]);
          gfx.fill({ color: heatColour(d.total) });
        }
      }
    },
    destroy: () => { gfx.parent?.removeChild(gfx); gfx.destroy(); },
  };
}
