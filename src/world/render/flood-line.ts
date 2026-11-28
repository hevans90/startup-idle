/**
 * World v2 — THE FLOOD LINE, on the map: with a flood wall in hand, or a flood
 * on its way, every tile the river would come to washed blue, deeper where it
 * would stand deeper, the line it would stop at drawn round it, and each home
 * it would reach outlined. Redrawn on a change, never a frame. @see floodReach
 */
import { Graphics, type Container } from "pixi.js";

import { idx, inBounds, type Grid } from "../grid";
import { FLOODED } from "../events/flood";
import { atRisk, floodReach, floodReachOf, type FloodReach } from "../events/flood-reach";
import { cellDiamond } from "./overlays";

const WASH = 0x3d8bfd;
const LINE = 0x9cc9ff;
const AT_RISK = 0xff6b6b;

/** A run of walls looked at, and the buildings it keeps dry, picked out. @see wallRunInfo */
export type Mark = { run: readonly number[]; safe: readonly number[] };
const RUN = 0xf2efe6;
const SAFE = 0x7cfc9a;

export type FloodLine = {
  /** Draw this flood line, and these homes at risk; null clears it. */
  draw: (g: Grid, reach: FloodReach | null, risk: ReadonlySet<number>, scale: number, mark?: Mark) => void;
  /**
   * Show the flood line as it would stand with these walls put up too — a row
   * being dragged — or as it stands, with none; null hides it. Drawn again
   * only when the map, the walls or the scale have changed.
   */
  sync: (g: Grid, walls: readonly { x: number; y: number }[] | null, scale: number, mark?: Mark) => void;
  destroy: () => void;
};

export function createFloodLine(overlay: Container): FloodLine {
  const wash = new Graphics(), line = new Graphics();
  for (const gfx of [wash, line]) { gfx.eventMode = "none"; gfx.zIndex = 997; overlay.addChild(gfx); }
  let key = "", seen: Grid | null = null;
  const self: FloodLine = {
    sync: (g, walls, sc, mark) => {
      const k = walls === null ? "" : `${g.rev}|${sc}|${walls.map((c) => `${c.x},${c.y}`).join(";")}|${mark ? mark.run[0] : ""}`;
      if (k === key && g === seen) return;
      key = k; seen = g;
      if (walls === null) { self.draw(g, null, new Set(), sc); return; }
      if (!walls.length) { const { reach, risk } = floodReachOf(g); self.draw(g, reach, risk, sc, mark); return; }
      const reach = floodReach(g, new Set(walls.filter((c) => inBounds(g, c.x, c.y)).map((c) => idx(g, c.x, c.y))));
      self.draw(g, reach, atRisk(g, reach), sc, mark);
    },
    draw: (g, reach, risk, sc, mark) => {
      wash.clear();
      line.clear();
      if (!reach || !reach.peak) return;
      const wet = (x: number, y: number) => inBounds(g, x, y) && (reach.river[idx(g, x, y)] === 1 || reach.depth[idx(g, x, y)] > 0);
      for (let y = 0; y < g.h; y++) for (let x = 0; x < g.w; x++) {
        const i = idx(g, x, y), d = reach.depth[i];
        if (reach.river[i] || d <= 0) continue;
        const h = g.height[i];
        wash.poly(cellDiamond(x, y, h, sc));
        wash.fill({ color: WASH, alpha: d > FLOODED ? 0.42 : 0.22 });
        // THE LINE: each side of a covered tile that meets dry ground. Corners: top, right, bottom, left.
        const [tx, ty, rx, ry, bx, by, lx, ly] = cellDiamond(x, y, h, sc);
        if (!wet(x + 1, y)) line.moveTo(rx, ry).lineTo(bx, by);
        if (!wet(x - 1, y)) line.moveTo(lx, ly).lineTo(tx, ty);
        if (!wet(x, y + 1)) line.moveTo(bx, by).lineTo(lx, ly);
        if (!wet(x, y - 1)) line.moveTo(tx, ty).lineTo(rx, ry);
      }
      line.stroke({ color: LINE, width: Math.max(1, 1.5 * sc), alpha: 0.95 });
      // THE HOMES IT WOULD REACH, outlined.
      for (const id of risk) {
        const s = g.structures.get(id);
        if (!s) continue;
        for (let y = s.y; y < s.y + s.h; y++) for (let x = s.x; x < s.x + s.w; x++) {
          line.poly(cellDiamond(x, y, g.height[idx(g, x, y)], sc));
        }
      }
      if (risk.size) line.stroke({ color: AT_RISK, width: Math.max(1, 2 * sc), alpha: 0.95 });
      // A RUN LOOKED AT, and what it keeps dry.
      if (mark) {
        for (const i of mark.run) line.poly(cellDiamond(i % g.w, (i / g.w) | 0, g.height[i], sc));
        if (mark.run.length) line.stroke({ color: RUN, width: Math.max(1, 2 * sc), alpha: 0.95 });
        for (const id of mark.safe) {
          const s = g.structures.get(id);
          if (!s) continue;
          for (let y = s.y; y < s.y + s.h; y++) for (let x = s.x; x < s.x + s.w; x++) line.poly(cellDiamond(x, y, g.height[idx(g, x, y)], sc));
        }
        if (mark.safe.length) line.stroke({ color: SAFE, width: Math.max(1, 2 * sc), alpha: 0.95 });
      }
    },
    destroy: () => { for (const gfx of [wash, line]) { gfx.parent?.removeChild(gfx); gfx.destroy(); } },
  };
  return self;
}
