/**
 * World v2 — the LANES overlay: the lane graph drawn over the roads, to see
 * what traffic and walkers will follow. @see agents/lanes/graph
 *
 *  - street lanes blue, an arrowhead now and then the way they run;
 *  - curves through junctions by their turn: straight white, left amber,
 *    right green, U-turns pink; a roundabout's ring violet, on and off it lilac;
 *  - conflict zones red dots, where each of the two curves reaches the other;
 *  - pavements cyan, crossings white;
 *  - each junction's cells tinted by what it is: give way grey (its main
 *    road's mouths marked), lights red, roundabout violet.
 */
import type { Graphics } from "pixi.js";

import { roadHeightAt } from "../agents/roads";
import type { LaneGraph, Lane, JunctionKind } from "../agents/lanes/graph";
import { pointAt, type Pt } from "../agents/lanes/geometry";
import type { Grid } from "../grid";
import { HEIGHT_UNIT, HH, HW } from "../iso";
import { cellDiamond } from "./overlays";

const TURN: Record<string, number> = { straight: 0xf2f2f2, left: 0xf2b134, right: 0x5fd068, uturn: 0xf27ac8 };
const KIND: Record<Lane["kind"], number> = { street: 0x4f9cf2, connector: 0xf2f2f2, ring: 0x9b6bf2, entry: 0xc7a8f7, exit: 0xc7a8f7 };
const JUNCTION: Partial<Record<JunctionKind, number>> = { priority: 0x9a9a9a, signals: 0xe0473c, roundabout: 0x9b6bf2 };

export function drawLaneGraph(gfx: Graphics, g: Grid, G: LaneGraph, scale: number) {
  gfx.clear();
  const P = (p: Pt): [number, number] => {
    const z = roadHeightAt(g, p.x, p.y);
    return [(p.x - p.y) * HW * scale, (p.x + p.y) * HH * scale - z * HEIGHT_UNIT * scale];
  };
  const w = Math.max(1, 1.6 * scale);

  for (const J of G.junctions) {
    const c = JUNCTION[J.kind];
    if (c === undefined) continue;
    for (const i of J.cells) gfx.poly(cellDiamond(i % g.w, (i / g.w) | 0, roadHeightAt(g, i % g.w, (i / g.w) | 0), scale));
    gfx.fill({ color: c, alpha: 0.22 });
  }

  // Pavements, then crossings over them.
  const { nodes, edges } = G.walk;
  for (const e of edges) {
    if (e.crossing !== undefined) continue;
    gfx.moveTo(...P(nodes[e.a])).lineTo(...P(nodes[e.b]));
  }
  gfx.stroke({ color: 0x4fe0e8, width: w * 0.6, alpha: 0.8 });
  for (const e of edges) {
    if (e.crossing === undefined) continue;
    gfx.moveTo(...P(nodes[e.a])).lineTo(...P(nodes[e.b]));
  }
  gfx.stroke({ color: 0xffffff, width: w * 1.4, alpha: 0.9 });

  for (const l of G.lanes) {
    const colour = l.kind === "connector" ? TURN[l.turn ?? "straight"] : KIND[l.kind];
    gfx.moveTo(...P(l.pts[0]));
    for (let k = 1; k < l.pts.length; k++) gfx.lineTo(...P(l.pts[k]));
    gfx.stroke({ color: colour, width: l.kind === "street" ? w : w * 0.7, alpha: 0.95 });
    // Arrowheads, which way it runs.
    const every = l.kind === "street" ? 1.5 : Math.max(0.3, l.len * 0.6);
    for (let s = Math.min(every, l.len * 0.6); s < l.len; s += every) {
      const { p, h } = pointAt(l.pts, l.at, s);
      const tip = P(p), back = P({ x: p.x - h.x * 0.12, y: p.y - h.y * 0.12 });
      const dx = tip[0] - back[0], dy = tip[1] - back[1];
      gfx.poly([tip[0], tip[1], back[0] - dy * 0.5, back[1] + dx * 0.5, back[0] + dy * 0.5, back[1] - dx * 0.5]);
      gfx.fill({ color: colour, alpha: 0.95 });
    }
  }

  // Main-road mouths of a priority junction.
  for (const J of G.junctions) {
    if (J.kind !== "priority") continue;
    for (const a of J.arms) {
      if (!a.major) continue;
      const l = G.lanes[a.inLanes[0]];
      if (!l) continue;
      const [x, y] = P(l.pts[l.pts.length - 1]);
      gfx.circle(x, y, w * 1.8);
    }
  }
  gfx.fill({ color: 0xffffff, alpha: 0.9 });

  for (const z of G.zones) {
    for (const [id, s] of [[z.a, z.sa], [z.b, z.sb]] as const) {
      const l = G.lanes[id];
      const [x, y] = P(pointAt(l.pts, l.at, s).p);
      gfx.circle(x, y, w * (z.merge ? 1.6 : 1.1));
    }
  }
  gfx.fill({ color: 0xff3b30, alpha: 0.9 });
}
