/**
 * World v2 — THE PLACES A PIPE CAN CONNECT, lit while a pipe tool is in hand:
 * the bank beside usable water tinted, a ring on every inlet and slop port
 * that shows its tank — so the ones that need a pipe stand out — a dot on a
 * manhole or a pipe's open end, and a brighter ring on the one the stroke's
 * end has gone to. Redrawn only when what it shows changes; out of the draw
 * list while empty. @see connectPoints, plans/pipe-network.md §8
 */
import { Container, Graphics } from "pixi.js";

import type { Grid } from "../grid";
import { HH } from "../iso";
import type { ConnectPoint } from "../pipes/connect-points";
import { cellDiamond } from "./overlays";

const WATER = 0x58b8e8, RING = 0x3fe0a8, THIRSTY = 0xf0b040, DOT = 0x3fe0a8, HELD = 0xffffff;
/** A suggested route's ghost, by its place in the list. */
const WAY = [0x9cf5d4, 0x8fd0ff, 0xf5d48f];

export type ConnectGuide = {
  /**
   * Light `points`; `full` is how full the tank behind each stands, nought
   * to one, by the point's place in the list (NaN for none); `end` is the
   * tile the stroke's end is on, to be lit brighter.
   */
  draw: (g: Grid, points: readonly ConnectPoint[], full: readonly number[], end: number, scale: number) => void;
  /** The routes on offer from where a run was started, as ghosts: a line along each, tile to tile. None, and they go. @see pipes/suggest */
  ways: (g: Grid, routes: readonly (readonly { x: number; y: number }[])[], scale: number) => void;
  destroy: () => void;
};

export function createConnectGuide(overlay: Container): ConnectGuide {
  const gfx = new Graphics();
  gfx.eventMode = "none";
  gfx.zIndex = 996;
  gfx.visible = false;
  overlay.addChild(gfx);
  // THE SUGGESTED ROUTES, under the rings.
  const lines = new Graphics();
  lines.eventMode = "none";
  lines.zIndex = 995;
  lines.visible = false;
  overlay.addChild(lines);
  let was = "", wasWays = "";
  return {
    ways(g, routes, scale) {
      const key = routes.length ? `${g.rev}|${scale}|${routes.map((r) => `${r.length}:${r[0]?.x},${r[0]?.y}>${r[r.length - 1]?.x},${r[r.length - 1]?.y}`).join("|")}` : "";
      if (key === wasWays) return;
      wasWays = key;
      lines.clear();
      lines.visible = routes.length > 0;
      for (const [k, route] of routes.entries()) {
        for (const [n, c] of route.entries()) {
          const d = cellDiamond(c.x, c.y, g.height[c.y * g.w + c.x], scale), x = d[0], y = d[1] + HH * scale;
          if (n === 0) lines.moveTo(x, y); else lines.lineTo(x, y);
        }
        // The first on offer brightest; each a little apart in tone, so three that share a stretch still read as three.
        lines.stroke({ color: WAY[k % WAY.length], width: Math.max(2, HH * scale * 0.16), alpha: 0.75, cap: "round", join: "round" });
      }
    },
    draw(g, points, full, end, scale) {
      // By what it shows: the tanks to a tenth, so a ring moves a step at a time and not every frame.
      let key = `${g.rev}|${scale}|${end}|${points.length}`;
      for (let k = 0; k < points.length; k++) if (points[k].kind !== "water") key += `|${points[k].cell}:${Number.isNaN(full[k]) ? "" : Math.round(full[k] * 10)}`;
      if (key === was) return;
      was = key;
      gfx.clear();
      gfx.visible = points.length > 0;
      const r = HH * scale;
      for (let k = 0; k < points.length; k++) {
        const p = points[k], x = p.cell % g.w, y = (p.cell / g.w) | 0, h = g.height[p.cell];
        const d = cellDiamond(x, y, h, scale), cx = d[0], cy = d[1] + HH * scale;
        if (p.kind === "water") {
          gfx.poly(d);
          gfx.fill({ color: WATER, alpha: 0.3 });
          continue;
        }
        const here = p.cell === end;
        if (p.kind === "inlet" || p.kind === "slop-port" || p.kind === "processor") {
          // ITS TANK AS A RING: for an inlet, as much of the ring as it is empty — its thirst; for a slop port, as it is full.
          const f = Number.isNaN(full[k]) ? 0 : Math.max(0, Math.min(1, full[k]));
          const want = p.kind === "inlet" ? 1 - f : f;
          gfx.ellipse(cx, cy, r * 0.95, r * 0.5);
          gfx.stroke({ color: here ? HELD : RING, width: here ? 3 : 2, alpha: here ? 1 : 0.55 });
          if (want > 0.05) {
            gfx.arc(cx, cy, r * 0.62, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * want);
            gfx.stroke({ color: THIRSTY, width: 3, alpha: 0.95 });
          }
        } else {
          gfx.ellipse(cx, cy, r * 0.5, r * 0.26);
          gfx.fill({ color: here ? HELD : DOT, alpha: here ? 1 : 0.75 });
          gfx.ellipse(cx, cy, r * 0.95, r * 0.5);
          gfx.stroke({ color: here ? HELD : DOT, width: here ? 3 : 1.5, alpha: here ? 1 : 0.5 });
        }
      }
    },
    destroy() { gfx.parent?.removeChild(gfx); gfx.destroy(); lines.parent?.removeChild(lines); lines.destroy(); },
  };
}
