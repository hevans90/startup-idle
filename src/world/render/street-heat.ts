/**
 * World v2 — THE EARNINGS OVERLAY on the map: every street's road tinted gold
 * by what it earns against the best. In the overlay above everything, drawn
 * again every couple of seconds while it is on. @see liveStreetEarnings
 */
import { Graphics, type Container } from "pixi.js";

import { HEIGHT_UNIT, HH, HW } from "../iso";
import type { Grid } from "../grid";
import type { StreetEarning, Streets } from "../roads/streets";

const GOLD = 0xf2c230;

export type StreetHeat = {
  draw: (g: Grid, streets: Streets | null, ranked: readonly StreetEarning[], scale: number) => void;
  destroy: () => void;
};

export function createStreetHeat(overlay: Container): StreetHeat {
  const gfx = new Graphics();
  gfx.eventMode = "none";
  gfx.zIndex = 997;
  overlay.addChild(gfx);
  return {
    draw: (g, streets, ranked, sc) => {
      if (gfx.destroyed) return;
      gfx.clear();
      if (!streets || !ranked.length) return;
      const top = ranked[0].perSecond;
      for (const r of ranked) {
        const share = top > 0 ? r.perSecond / top : 0;
        if (share <= 0) continue;
        for (const i of streets.tiles[r.street]) {
          const x = i % g.w, y = (i - x) / g.w, h = g.height[i];
          const P = (u: number, v: number) => [(u - v) * HW * sc, (u + v) * HH * sc - h * HEIGHT_UNIT * sc];
          gfx.poly([...P(x - 0.5, y - 0.5), ...P(x + 0.5, y - 0.5), ...P(x + 0.5, y + 0.5), ...P(x - 0.5, y + 0.5)]);
          gfx.fill({ color: GOLD, alpha: 0.15 + 0.6 * share });
        }
      }
    },
    destroy: () => { gfx.parent?.removeChild(gfx); gfx.destroy(); },
  };
}
