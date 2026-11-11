/**
 * World v2 — WHERE A SEAPORT GOES, shown with one in hand.
 *
 * Two pictures, both redrawn on a change and never a frame:
 *  - the BANKS a port of this tier could go on, lit along the water;
 *  - under the pointer, what THIS placement would be: each berth on the water
 *    beside its quay, the gate behind it, and the way a boat comes to it from
 *    where the river comes in.
 * @see validatePort, quayBanks, plans/seaports.md §1
 */
import { Graphics, type Container } from "pixi.js";

import { VOID, idx, inBounds, type Grid } from "../grid";
import { quayTiles, channelTo, steadyRivers, type Facing, type Rect } from "../boats/quay";
import { riverAt } from "../boats/river";
import { cellDiamond } from "./overlays";
import { cellToWorld } from "../iso";

/** A bank's light, by the biggest ship that can come alongside: boat, coaster, ship. */
const BANK = [0x5fe3ff, 0x7cfc9a, 0xffd166];
const GROUNDS = 0xff6b6b;
const BERTH = 0x8fd0ff;
const CHANNEL = 0x7cfc9a;
const GATE = 0x7cfc9a;
const NO_GATE = 0xffc857;

export type PortGuide = {
  /** Light these bank tiles; none clears them. */
  banks: (g: Grid, cells: readonly { i: number; cls: number }[], scale: number) => void;
  /** Show what a port standing here would be, for ships up to class `top`; null clears it. */
  ghost: (g: Grid, port: { at: Rect; facing: Facing; top: number } | null, scale: number) => void;
  destroy: () => void;
};

/** The standing water's surface on a tile, half steps. */
const surface = (g: Grid, x: number, y: number) => (inBounds(g, x, y) ? g.height[idx(g, x, y)] + g.pool[idx(g, x, y)] : 0);

export function createPortGuide(overlay: Container): PortGuide {
  const banks = new Graphics(), ghost = new Graphics();
  for (const gfx of [banks, ghost]) { gfx.eventMode = "none"; overlay.addChild(gfx); }
  banks.zIndex = 997;
  ghost.zIndex = 999;
  let banksKey = "", ghostKey = "";
  return {
    banks(g, cells, scale) {
      const key = `${g.rev}|${scale}|${cells.length}|${cells[0]?.i ?? -1}|${cells[cells.length - 1]?.i ?? -1}|${cells.reduce((n, c) => n + c.cls, 0)}`;
      if (key === banksKey) return;
      banksKey = key;
      banks.clear();
      // Out of the draw list while empty: a Graphics cleared to nothing kept showing what it had.
      banks.visible = cells.length > 0;
      for (const { i, cls } of cells) {
        banks.poly(cellDiamond(i % g.w, (i / g.w) | 0, g.height[i], scale));
        banks.fill({ color: BANK[cls] ?? BANK[0], alpha: 0.42 });
      }
    },
    ghost(g, port, scale) {
      const key = port ? `${g.rev}|${scale}|${port.at.x},${port.at.y},${port.at.w},${port.at.h},${port.facing},${port.top}` : "";
      if (key === ghostKey) return;
      ghostKey = key;
      ghost.clear();
      ghost.visible = !!port;
      if (!port) return;
      const rivers = steadyRivers(g);
      const quay = quayTiles(port.at, port.facing);
      // THE WAY IN, to the middle of the quay, under the berths.
      const mid = quay[(quay.length - 1) >> 1];
      const way = channelTo(rivers, { x: mid.wx, y: mid.wy });
      // Green where the biggest ship the port takes floats, red where it grounds.
      for (let k = 1; k < way.length; k++) {
        const a = way[k - 1], c = way[k];
        const p = cellToWorld(a.x, a.y, surface(g, a.x, a.y), scale), q = cellToWorld(c.x, c.y, surface(g, c.x, c.y), scale);
        const floats = rivers.reach[c.y * g.w + c.x] > port.top && rivers.reach[a.y * g.w + a.x] > port.top;
        ghost.moveTo(p.wx, p.wy).lineTo(q.wx, q.wy);
        ghost.stroke({ color: floats ? CHANNEL : GROUNDS, width: 2, alpha: 0.75 });
      }
      // THE BERTHS: the water a boat lies on, one a tile of quay.
      for (const q of quay) {
        if (!riverAt(rivers, q.wx, q.wy)) continue;
        ghost.poly(cellDiamond(q.wx, q.wy, surface(g, q.wx, q.wy), scale));
        ghost.fill({ color: BERTH, alpha: 0.3 });
        ghost.poly(cellDiamond(q.wx, q.wy, surface(g, q.wx, q.wy), scale));
        ghost.stroke({ color: BERTH, width: 1.5, alpha: 0.9 });
      }
      // THE GATE: the tiles behind it, green where a road already meets them.
      for (const q of quay) {
        if (!inBounds(g, q.bx, q.by)) continue;
        const i = idx(g, q.bx, q.by);
        ghost.poly(cellDiamond(q.bx, q.by, g.height[i], scale));
        ghost.stroke({ color: g.paved[i] !== VOID ? GATE : NO_GATE, width: 1.5, alpha: 0.9 });
      }
    },
    destroy() {
      for (const gfx of [banks, ghost]) { gfx.parent?.removeChild(gfx); gfx.destroy(); }
    },
  };
}
