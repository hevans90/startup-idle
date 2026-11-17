/**
 * World v2 — A ROAD BEING BUILT, on the map: each cell of a job that is not
 * open yet, painted by how far the trades have got with it — staked out, the
 * ground stripped, the stone down, the blacktop laid. Plainly: a tint a
 * stage, redrawn when a trade passes a cell and never between.
 * @see roads/jobs, plans/road-building.md (the plant and the gang come later)
 */
import { Container, Graphics } from "pixi.js";

import { idx, type Grid } from "../grid";
import { bandOf } from "../iso";
import { bakedProps, propSprite, propSprites, propsLoaded } from "../props/props-sheet";
import { GANGS, frontOf, stageOf } from "../roads/jobs";
import type { BandLayer } from "./bands";
import { cellDiamond } from "./overlays";

/** What a cell's ground is, a stage: earth, stone, blacktop unlined, blacktop. */
const GROUND = [0, 0x7a5a3c, 0x8f8b84, 0x2e2e31, 0x2a2a2d];
const STAKE = 0xf2c230;

export type RoadWorks = { sync(g: Grid, rev: number, roadRev: number, scale: number): void; destroy(): void };

export function createRoadWorks(bands: BandLayer): RoadWorks {
  let drawn: Container[] = [], key = "";
  const clear = () => { for (const c of drawn) { c.parent?.removeChild(c); c.destroy({ children: true }); } drawn = []; };
  return {
    sync(g, rev, roadRev, scale) {
      const P = bakedProps() ? propsLoaded() : null;
      if (bakedProps() && !P && g.roadJobs.length) void propSprites();
      const k = `${rev}|${roadRev}|${scale}|${g.roadJobs.length}|${P ? 1 : 0}`;
      if (k === key) return;
      key = k;
      clear();
      const of = new Map<number, Graphics>();
      g.roadJobs.forEach((j, n) => {
        for (let c = j.opened; c < j.cells.length; c++) {
          const cell = j.cells[c];
          if (!cell.fresh) continue;
          const band = bandOf(cell.x, cell.y), layer = bands.pavedOf[band];
          if (!layer) continue;
          let gfx = of.get(band);
          if (!gfx) { gfx = new Graphics(); gfx.eventMode = "none"; gfx.context.batchMode = "batch"; layer.addChild(gfx); of.set(band, gfx); drawn.push(gfx); }
          // A job waiting its turn is staked out and no more.
          const stage = n < GANGS ? stageOf(j, c) : 0;
          const d = cellDiamond(cell.x, cell.y, cell.deck ? cell.z : g.height[idx(g, cell.x, cell.y)], scale);
          if (stage > 0 && !cell.deck) gfx.poly(d).fill({ color: GROUND[stage] });
          else if (stage > 1) gfx.poly(d).fill({ color: GROUND[stage] });
          // Staked: a line round it, and a peg at each corner, until the blacktop is down.
          if (stage < 3) {
            gfx.poly(d).stroke({ color: STAKE, width: Math.max(1, 2 * scale), alpha: 0.9 });
            for (let q = 0; q < 8; q += 2) gfx.circle(d[q], d[q + 1], Math.max(1.5, 3 * scale)).fill({ color: STAKE });
          }
          if (!P || n >= GANGS) continue;
          // WHAT STANDS ROUND IT, where a gang is at work: a cone each side of every other cell till it is lined; a
          // barrier across where the open road stops; a heap of stone just ahead of the sub-base.
          const next = j.cells[Math.min(j.cells.length - 1, c + 1)], prev = j.cells[Math.max(0, c - 1)];
          const ax = Math.sign(next.x - prev.x) || 0, ay = Math.sign(next.y - prev.y) || 0, z = cell.deck ? cell.z : g.height[idx(g, cell.x, cell.y)];
          const stand = (id: string, turn: number, x: number, y: number) => { const sp = propSprite(P, id, turn, x, y, z, scale); const dyn = bands.dynamicOf[band]; if (sp && dyn) { sp.zIndex = 0.2; dyn.addChild(sp); drawn.push(sp); } };
          if (stage >= 1 && c % 2 === 0 && (ax === 0) !== (ay === 0)) for (const sg of [-1, 1]) stand("cone", 0, cell.x - ay * sg * 0.44, cell.y + ax * sg * 0.44);
          if (c === j.opened && j.opened > 0) stand("barrier", ax !== 0 ? 1 : 0, cell.x - ax * 0.42, cell.y - ay * 0.42);
          if (c === Math.min(j.cells.length - 1, frontOf(j, 1) + 1) && stage === 1) stand("heapStone", c % 4, cell.x + ay * 0.2, cell.y - ax * 0.2);
        }
      });
    },
    destroy: clear,
  };
}
