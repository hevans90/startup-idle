/**
 * World v2 — A FARM'S REACH, with one in hand: the ground round it it would
 * take for fields washed green, and the edge of its reach drawn. Redrawn when
 * the farm moves or the map changes, never a frame. @see claimable
 */
import { Graphics, type Container } from "pixi.js";

import { idx, inBounds, type Grid } from "../grid";
import { farmReach } from "../vegetation/fields";
import { claimable } from "../vegetation/tend";
import { cellDiamond } from "./overlays";

type Palette = readonly (string | null)[];
type Rect = { x: number; y: number; w: number; h: number };

const WASH = 0x9bd46a;
const EDGE = 0xd8f0b8;

export type FarmReach = {
  /** Show a farm's fields-to-be at this footprint; null hides them. */
  sync: (g: Grid, palette: Palette, at: Rect | null, scale: number) => void;
  destroy: () => void;
};

export function createFarmReach(overlay: Container): FarmReach {
  const wash = new Graphics(), edge = new Graphics();
  for (const gfx of [wash, edge]) { gfx.eventMode = "none"; gfx.zIndex = 997; overlay.addChild(gfx); }
  let key = "", seen: Grid | null = null;
  return {
    sync: (g, palette, at, sc) => {
      const k = at ? `${g.rev}|${g.veg.rev}|${sc}|${farmReach()}|${at.x},${at.y},${at.w},${at.h}` : "";
      if (k === key && g === seen) return;
      key = k; seen = g;
      wash.clear(); edge.clear();
      if (!at) return;
      for (const i of claimable(g, palette, at)) {
        const x = i % g.w, y = (i / g.w) | 0;
        wash.poly(cellDiamond(x, y, g.height[i], sc));
      }
      wash.fill({ color: WASH, alpha: 0.38 });
      // THE EDGE OF ITS REACH: each side of the box that is on the map.
      const R = farmReach(), x0 = at.x - R, y0 = at.y - R, x1 = at.x + at.w + R - 1, y1 = at.y + at.h + R - 1;
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
        if (!inBounds(g, x, y) || (x !== x0 && x !== x1 && y !== y0 && y !== y1)) continue;
        const [tx, ty, rx, ry, bx, by, lx, ly] = cellDiamond(x, y, g.height[idx(g, x, y)], sc);
        if (x === x1) edge.moveTo(rx, ry).lineTo(bx, by);
        if (x === x0) edge.moveTo(lx, ly).lineTo(tx, ty);
        if (y === y1) edge.moveTo(bx, by).lineTo(lx, ly);
        if (y === y0) edge.moveTo(tx, ty).lineTo(rx, ry);
      }
      edge.stroke({ color: EDGE, width: Math.max(1, 1.5 * sc), alpha: 0.8 });
    },
    destroy: () => { for (const gfx of [wash, edge]) { gfx.parent?.removeChild(gfx); gfx.destroy(); } },
  };
}
