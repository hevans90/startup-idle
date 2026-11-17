/**
 * World v2 — A ROAD BEING BUILT, on the map: each cell of a job that is not
 * open yet, painted by how far the trades have got with it — staked out with
 * tape and pegs, the ground stripped and rutted, the stone down, the
 * blacktop laid between its kerbs, its lines on. A trade's front MOVES
 * through the cell it is in, not from cell to cell: what is whole is redrawn
 * only when a trade passes a cell; the three moving edges, each frame.
 * Round it, where a gang is at work: cones, a barrier where the open road
 * stops, a heap of stone; and a bridge's own pieces, stood as the work comes
 * to each. @see roads/jobs, render/road-plant (the gang), plans/road-building.md
 */
import { Container, Graphics, Sprite } from "pixi.js";

import { idx, type Grid } from "../grid";
import { HEIGHT_UNIT, HH, HW, bandOf } from "../iso";
import { bakedProps, propSprite, propSprites, propsLoaded } from "../props/props-sheet";
import { GANGS, GAP, TRADES, frontAt, frontOf, plannedGrid, stageOf, type JobCell, type RoadJob } from "../roads/jobs";
import { looksOf, type Look } from "../roads/looks";
import type { BandLayer } from "./bands";
import { bridgePiecesOf } from "./bridge-props";
import { plannedTile, unlinedLooks, type PavedLayer } from "./paved";

const EARTH = 0x7a5a3c, RUT = 0x5c4330, STONE = 0x8f8b84, GRIT = [0xa7a39b, 0x76726c], BLACK = 0x2c2c2f, KERB = 0x9c9b97, LINE = 0xe9e7df;
const TAPE = 0xf2c230, PEG = 0xc9972a, SLAB = 0xaeaca6, SLAB_SIDE = 0x7f7d78;
const hash = (n: number) => { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };

/** How much of the road shows through, once the sub-base is down and before it is surfaced: the road taking shape on the formation. */
const FORMING = 0.5;

export type RoadWorks = { sync(g: Grid, rev: number, roadRev: number, scale: number, pl?: PavedLayer | null): void; destroy(): void };

/** Which way a job runs through one of its cells: a step along x or along y; neither on a corner. */
function wayAt(j: RoadJob, c: number): { ax: number; ay: number; ix: number; iy: number } {
  const here = j.cells[c], next = j.cells[Math.min(j.cells.length - 1, c + 1)], prev = j.cells[Math.max(0, c - 1)];
  // The way it comes in by, for a front moving through it.
  const ix = c > 0 ? here.x - prev.x : next.x - here.x, iy = c > 0 ? here.y - prev.y : next.y - here.y;
  const straight = (next.x - prev.x === 0) !== (next.y - prev.y === 0);
  return { ax: straight ? Math.sign(next.x - prev.x) : 0, ay: straight ? Math.sign(next.y - prev.y) : 0, ix, iy };
}

export function createRoadWorks(bands: BandLayer): RoadWorks {
  let drawn: Container[] = [], key = "";
  /** The moving edges: a Graphics a trade a job, in the band of the cell its front is in — and, for a trade that lays road, the road's own tile shown through it. */
  const edges = new Map<string, { gfx: Graphics; tile: Sprite | null; band: number; at: number }>();
  /**
   * THE ROAD IT WILL BE: every cell's look on the map as it will be, whole and
   * unlined — worked out again only when the jobs or the map change, not as
   * the trades move. A job's cells are drawn with the very tiles they will be.
   */
  let plan: { key: string; grid: Grid; lined: (Look | null)[]; bare: (Look | null)[] } | null = null;
  const clear = () => { for (const c of drawn) { c.parent?.removeChild(c); c.destroy({ children: true }); } drawn = []; };
  /** Tile coordinates to the screen, at a height. */
  const pt = (scale: number, u: number, v: number, h: number) => [(u - v) * HW * scale, (u + v) * HH * scale - h * HEIGHT_UNIT * scale];
  const rect = (scale: number, u0: number, v0: number, u1: number, v1: number, h: number) => [...pt(scale, u0, v0, h), ...pt(scale, u1, v0, h), ...pt(scale, u1, v1, h), ...pt(scale, u0, v1, h)];
  /** A strip along a cell's road, `a0…a1` across it from its middle, the whole cell long — or `l0…l1` of it. */
  const strip = (scale: number, c: JobCell, w: { ax: number; ay: number }, a0: number, a1: number, h: number, l0 = -0.5, l1 = 0.5) =>
    w.ax !== 0 ? rect(scale, c.x + l0, c.y + a0, c.x + l1, c.y + a1, h) : rect(scale, c.x + a0, c.y + l0, c.x + a1, c.y + l1, h);
  /** A cell's ground at a stage, on `u0…v1` of it. */
  function ground(gfx: Graphics, scale: number, c: JobCell, w: { ax: number; ay: number }, stage: number, h: number, u0 = c.x - 0.5, v0 = c.y - 0.5, u1 = c.x + 0.5, v1 = c.y + 0.5, whole = true) {
    if (stage < 1) return;
    gfx.poly(rect(scale, u0, v0, u1, v1, h)).fill({ color: stage === 1 ? EARTH : stage === 2 ? STONE : BLACK });
    if (!whole || (w.ax === 0 && w.ay === 0)) return;
    if (stage === 1) {
      // Ruts where the plant has run, and a lighter lip to the cut.
      for (const a of [-0.2, 0.17]) gfx.poly(strip(scale, c, w, a - 0.035, a + 0.035, h)).fill({ color: RUT, alpha: 0.8 });
      for (const a of [-0.5, 0.46]) gfx.poly(strip(scale, c, w, a, a + 0.04, h)).fill({ color: 0x94714d });
    } else if (stage === 2) {
      // Stone: a scatter of lighter and darker grit, the same every time.
      for (let q = 0; q < 14; q++) {
        const r = hash(c.x * 31 + c.y * 17 + q * 7.3), r2 = hash(c.x * 13 + c.y * 41 + q * 3.1), [x, y] = pt(scale, c.x - 0.45 + r * 0.9, c.y - 0.45 + r2 * 0.9, h);
        gfx.circle(x, y, Math.max(0.8, 1.6 * scale)).fill({ color: GRIT[q & 1], alpha: 0.9 });
      }
    } else {
      // Blacktop between its kerbs; lined, a broken line down its middle.
      for (const a of [-0.5, 0.44]) gfx.poly(strip(scale, c, w, a, a + 0.06, h)).fill({ color: KERB });
      if (stage >= TRADES) for (const l of [-0.4, 0.1]) gfx.poly(strip(scale, c, w, -0.012, 0.012, h, l, l + 0.3)).fill({ color: LINE });
    }
  }
  return {
    sync(g, rev, roadRev, scale, pl) {
      const planKey = `${rev}|${g.roadJobs.map((j) => `${j.id}.${j.opened}.${j.cells.length}`).join(",")}`;
      if (pl?.painter && g.roadJobs.length && plan?.key !== planKey) {
        const grid = plannedGrid(g), lined = looksOf(grid, pl.dress);
        plan = { key: planKey, grid, lined, bare: unlinedLooks(lined) };
      }
      if (!g.roadJobs.length) plan = null;
      /** A cell's own tile as a sprite: unlined, or with its lines. */
      const tileOf = (x: number, y: number, lined: boolean): Sprite | null => {
        const t = pl && plan ? plannedTile(pl, plan.grid, lined ? plan.lined : plan.bare, x, y) : null;
        if (!t) return null;
        const sp = new Sprite(t.tex);
        sp.roundPixels = true; sp.eventMode = "none";
        sp.anchor.set(t.tex.defaultAnchor?.x ?? 0.5, t.tex.defaultAnchor?.y ?? 1);
        sp.position.set(t.x, t.y); sp.scale.set(pl!.scale);
        return sp;
      };
      const P = bakedProps() ? propsLoaded() : null;
      if (bakedProps() && !P && g.roadJobs.length) void propSprites();
      const k = `${rev}|${roadRev}|${scale}|${g.roadJobs.length}|${P ? 1 : 0}`;
      const rebuilt = k !== key;
      if (rebuilt) {
        key = k;
        clear();
        if (pl) pl.ghost = new Set();
        const of = new Map<number, Graphics>();
        // A BRIDGE GOES UP AS A BRIDGE: the pieces it will have, from the map as it will be, each stood as the work
        // comes to it — its piers and its bank's walls rising from the ground once the earthworks reach their tile,
        // its sides and what stands over the road once the deck there is surfaced. @see bridgePiecesOf
        const building = new Map<number, { j: RoadJob; k: number }>();
        g.roadJobs.slice(0, GANGS).forEach((j) => j.cells.forEach((c, n) => { if (n >= j.opened && c.deck && g.deck[idx(g, c.x, c.y)] === 0) building.set(idx(g, c.x, c.y), { j, k: n }); }));
        if (P && building.size) {
          const cellOf = (p: { x: number; y: number; cell?: { x: number; y: number } }) => idx(g, p.cell?.x ?? Math.ceil(p.x), p.cell?.y ?? Math.ceil(p.y));
          const pieces = bridgePiecesOf(plannedGrid(g)).filter((p) => building.has(cellOf(p)));
          const span = new Map<number, [number, number]>();
          for (const p of pieces) if (p.tier === "under") { const i = cellOf(p), s = span.get(i) ?? [Infinity, -Infinity]; span.set(i, [Math.min(s[0], p.z), Math.max(s[1], p.z)]); }
          const under = new Map<number, Container>();
          for (const p of pieces) {
            const i = cellOf(p), { j, k: n } = building.get(i)!, stage = stageOf(j, n);
            if (p.tier === "under") {
              // From the ground up, as the earthworks go on past it.
              const [z0, z1] = span.get(i)!, risen = Math.max(0, Math.min(1, (frontAt(j, 0) - n) / GAP));
              if (stage < 1 || (z1 > z0 && (p.z - z0) / (z1 - z0) > risen + 1e-6)) continue;
            } else if (stage < 3) continue;
            const band = bandOf(i % g.w, (i / g.w) | 0), sp = propSprite(P, p.id, p.turn, p.x, p.y, p.z, scale);
            if (!sp) continue;
            if (p.stretch) sp.scale.y = p.stretch;
            if (p.tier === "under") {
              let c = under.get(band);
              if (!c) { const layer = bands.staticOf[band]; if (!layer) { sp.destroy({ children: true }); continue; } c = new Container(); c.eventMode = "none"; layer.addChild(c); under.set(band, c); drawn.push(c); }
              c.addChild(sp);
            } else {
              const layer = bands.dynamicOf[band];
              if (!layer) { sp.destroy({ children: true }); continue; }
              sp.zIndex = p.tier === "back" ? -0.45 : 0.45;
              layer.addChild(sp); drawn.push(sp);
            }
          }
        }
        g.roadJobs.forEach((j, n) => {
          // WHERE THE OPEN ROAD STOPS for now it is not a road's end: the last open cell is drawn as the cell it will
          // be, running on, over its own rounded end — once the road beyond it is laid.
          if (n < GANGS && j.opened > 0 && j.opened < j.cells.length && stageOf(j, j.opened) >= 3) {
            const last = j.cells[j.opened - 1], layer = bands.pavedOf[bandOf(last.x, last.y)], sp = layer ? tileOf(last.x, last.y, true) : null;
            if (sp && layer) { layer.addChild(sp); drawn.push(sp); }
          }
          for (let c = j.opened; c < j.cells.length; c++) {
            const cell = j.cells[c];
            if (!cell.fresh) continue;
            const band = bandOf(cell.x, cell.y), layer = bands.pavedOf[band];
            if (!layer) continue;
            let gfx = of.get(band);
            if (!gfx) { gfx = new Graphics(); gfx.eventMode = "none"; gfx.context.batchMode = "batch"; layer.addChild(gfx); of.set(band, gfx); drawn.push(gfx); }
            // A job waiting its turn is staked out and no more.
            const stage = n < GANGS ? stageOf(j, c) : 0, w = wayAt(j, c), h = cell.deck ? cell.z : g.height[idx(g, cell.x, cell.y)];
            if (cell.deck) {
              // A DECK: nothing till the sub-base's turn — then its slab, thick at the edges that show, and its top as a road's.
              if (stage >= 2) {
                const t = 0.45;
                gfx.poly([...pt(scale, cell.x - 0.5, cell.y + 0.5, h), ...pt(scale, cell.x + 0.5, cell.y + 0.5, h), ...pt(scale, cell.x + 0.5, cell.y + 0.5, h - t), ...pt(scale, cell.x - 0.5, cell.y + 0.5, h - t)]).fill({ color: SLAB_SIDE });
                gfx.poly([...pt(scale, cell.x + 0.5, cell.y - 0.5, h), ...pt(scale, cell.x + 0.5, cell.y + 0.5, h), ...pt(scale, cell.x + 0.5, cell.y + 0.5, h - t), ...pt(scale, cell.x + 0.5, cell.y - 0.5, h - t)]).fill({ color: 0x6f6d69 });
                gfx.poly(rect(scale, cell.x - 0.5, cell.y - 0.5, cell.x + 0.5, cell.y + 0.5, h)).fill({ color: SLAB });
              }
            } else if (stage >= 1) ground(gfx, scale, cell, w, 1, h);
            // THE ROAD ITSELF, from the sub-base on: the tile this cell will be — its kerbs, its pavements, its corners,
            // its ramp — showing through the formation, then laid whole, then lined. Drawn plainly where there is no painter.
            if (stage >= 2) {
              const sp = tileOf(cell.x, cell.y, stage >= TRADES);
              if (sp) { if (stage === 2) sp.alpha = FORMING; layer.addChild(sp); drawn.push(sp); }
              else if (!cell.deck || stage >= 3) ground(gfx, scale, cell, w, stage, h);
            }
            // STAKED till the blacktop is down: tape along each side of the line, a peg at each corner; a wash over a
            // cell nothing has been done to yet, so the line reads from far off.
            if (stage < 3) {
              if (stage === 0) gfx.poly(rect(scale, cell.x - 0.5, cell.y - 0.5, cell.x + 0.5, cell.y + 0.5, h)).fill({ color: TAPE, alpha: cell.deck ? 0.06 : 0.1 });
              const lw = Math.max(1, 1.3 * scale);
              if (w.ax !== 0 || w.ay !== 0) for (const a of [-0.5, 0.5]) { const s = strip(scale, cell, w, a, a, h); gfx.moveTo(s[0], s[1]).lineTo(s[2], s[3]).stroke({ color: TAPE, width: lw, alpha: 0.85 }); }
              else gfx.poly(rect(scale, cell.x - 0.5, cell.y - 0.5, cell.x + 0.5, cell.y + 0.5, h)).stroke({ color: TAPE, width: lw, alpha: 0.85 });
              for (const [du, dv] of [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]]) { const [x, y] = pt(scale, cell.x + du, cell.y + dv, h); gfx.rect(x - 1.2 * scale, y - 5 * scale, 2.4 * scale, 5 * scale).fill({ color: PEG }); }
            }
            if (!P || n >= GANGS) continue;
            // WHAT STANDS ROUND IT, where a gang is at work: a cone each side of every other cell till it is lined; a
            // barrier across where the open road stops; a heap of stone just ahead of the sub-base.
            const stand = (id: string, turn: number, x: number, y: number) => { const sp = propSprite(P, id, turn, x, y, h, scale); const dyn = bands.dynamicOf[band]; if (sp && dyn) { sp.zIndex = 0.2; dyn.addChild(sp); drawn.push(sp); } };
            if (stage >= 1 && c % 2 === 0 && (w.ax !== 0 || w.ay !== 0)) for (const sg of [-1, 1]) stand("cone", 0, cell.x - w.ay * sg * 0.44, cell.y + w.ax * sg * 0.44);
            if (c === j.opened && j.opened > 0) stand("barrier", w.ix !== 0 ? 1 : 0, cell.x - w.ix * 0.42, cell.y - w.iy * 0.42);
            if (c === Math.min(j.cells.length - 1, frontOf(j, 1) + 1) && stage === 1 && !cell.deck) stand("heapStone", c % 4, cell.x + w.ay * 0.22, cell.y - w.ax * 0.22);
          }
        });
      }
      // THE MOVING EDGES, every frame: in the cell a trade is passing through, what it leaves behind it as far as
      // it has got — so the stone, the blacktop and the lines creep along the road and do not jump a tile at a time.
      const live = new Set<string>();
      g.roadJobs.slice(0, GANGS).forEach((j) => {
        for (let trade = 0; trade < TRADES; trade++) {
          const p = frontAt(j, trade), c = Math.floor(p), f = p - c;
          if (c < j.opened || c >= j.cells.length || f <= 0.01) continue;
          const cell = j.cells[c];
          if (!cell.fresh || (cell.deck && trade < 2)) continue;
          const id = `${j.id}:${trade}`, band = bandOf(cell.x, cell.y), layer = bands.pavedOf[band];
          if (!layer) continue;
          live.add(id);
          let e = edges.get(id);
          if (!e) { const gfx = new Graphics(); gfx.eventMode = "none"; gfx.context.batchMode = "batch"; e = { gfx, tile: null, band: -1, at: -1 }; edges.set(id, e); }
          // A trade that lays road shows the cell's own tile, as far as it has got: the tile, cut off at its edge by a mask.
          const lays = trade >= 1 && !!plan && !!pl?.painter;
          if (rebuilt || e.band !== band || e.at !== c || !e.gfx.parent) {
            e.at = c;
            // (Over what is whole, which was just put back under it. And the tile again: its cell has changed, or what is planned has.)
            if (e.tile) { e.tile.mask = null; e.tile.parent?.removeChild(e.tile); e.tile.destroy(); e.tile = null; }
            if (lays) { e.tile = tileOf(cell.x, cell.y, trade >= 3); if (e.tile) { if (trade === 1) e.tile.alpha = FORMING; layer.addChild(e.tile); } }
            layer.addChild(e.gfx);
            e.band = band;
          }
          const w = wayAt(j, c), h = cell.deck ? cell.z : g.height[idx(g, cell.x, cell.y)];
          // From the edge it came in by, as far as it has got.
          const u0 = w.ix > 0 ? cell.x - 0.5 : w.ix < 0 ? cell.x + 0.5 - f : cell.x - 0.5, u1 = w.ix > 0 ? cell.x - 0.5 + f : cell.x + 0.5;
          const v0 = w.iy > 0 ? cell.y - 0.5 : w.iy < 0 ? cell.y + 0.5 - f : cell.y - 0.5, v1 = w.iy > 0 ? cell.y - 0.5 + f : cell.y + 0.5;
          e.gfx.clear();
          if (e.tile) {
            // The mask: this much of the cell, and everything above it on the screen that the tile's kerbs and its ramp stand up into.
            e.gfx.poly(rect(scale, u0, v0, u1, v1, h)).fill({ color: 0xffffff });
            e.gfx.poly(rect(scale, u0, v0, u1, v1, h + 2)).fill({ color: 0xffffff });
            e.tile.mask = e.gfx;
          } else {
            ground(e.gfx, scale, cell, w, trade + 1, h, u0, v0, u1, v1, false);
            if (trade >= 2) for (const a of [-0.5, 0.44]) e.gfx.poly(w.ix !== 0 ? rect(scale, u0, cell.y + a, u1, cell.y + a + 0.06, h) : rect(scale, cell.x + a, v0, cell.x + a + 0.06, v1, h)).fill({ color: KERB });
          }
        }
      });
      for (const [id, e] of edges) if (!live.has(id)) { if (e.tile) { e.tile.mask = null; e.tile.parent?.removeChild(e.tile); e.tile.destroy(); } e.gfx.parent?.removeChild(e.gfx); e.gfx.destroy(); edges.delete(id); }
    },
    destroy() { clear(); for (const e of edges.values()) { if (e.tile) { e.tile.mask = null; e.tile.destroy(); } e.gfx.parent?.removeChild(e.gfx); e.gfx.destroy(); } edges.clear(); },
  };
}
