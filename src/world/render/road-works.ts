/**
 * World v2 — A ROAD BEING BUILT, on the map: each cell of a job that is not
 * open yet, painted by how far the trades have got with it — staked out with
 * tape and pegs, the ground stripped and rutted, the stone down, the
 * blacktop laid between its kerbs, its lines on. A trade's front MOVES
 * through the cell it is in, not from cell to cell: what is whole is redrawn
 * only when a trade passes a cell; the three moving edges, each frame.
 * Round it, where a gang is at work: cones, a barrier where the open road
 * stops; and a bridge's own pieces, stood as the work comes
 * to each. @see roads/jobs, render/road-plant (the gang), plans/road-building.md
 */
import { Container, Graphics, Sprite } from "pixi.js";

import { idx, type Grid } from "../grid";
import { HEIGHT_UNIT, HH, HW, bandOf } from "../iso";
import { bakedProps, propSprite, propSprites, propsLoaded } from "../props/props-sheet";
import { CONCRETE_LAG, GANGS, GAP, PACE, TRADES, frontAt, frontOf, plannedGrid, setOutAt, stageOf, type JobCell, type RoadJob } from "../roads/jobs";
import { looksOf, type Look } from "../roads/looks";
import type { BandLayer } from "./bands";
import { bridgePiecesOf } from "./bridge-props";
import { plannedTile, unlinedLooks, type PavedLayer } from "./paved";
import { createGrow, type Grow } from "./road-grow";

const EARTH = 0x7a5a3c, RUT = 0x5c4330, STONE = 0x8f8b84, GRIT = [0xa7a39b, 0x76726c], BLACK = 0x2c2c2f, KERB = 0x9c9b97, LINE = 0xe9e7df;
const SLAB = 0xaeaca6, SLAB_SIDE = 0x7f7d78;
/** The plan's own blue-white, as a drawing's; the spray on the ground. */
const PLAN = 0x9fe0ff, SPRAY = 0xff7ab8;
/** How finely the setting out is redrawn as it goes: steps a tile. */
const SET_FINE = 16;
/** A trade's front as its shader is told it: nowhere till the trade has begun, and begun from behind the job's first edge — every front is ragged and reaches ahead of itself, and must not reach onto ground its trade has not come to. */
const told = (f: number) => (f <= 0 ? -2 : f - 0.65 * (1 - Math.min(1, f)) ** 2);
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
  /**
   * THE CELLS GROWING: a quad a cell of a job at work, drawn by the road's own shader from the tile it will be —
   * the cut, the stone, the blacktop and the lines each spreading over it as its trade comes. @see road-grow
   */
  const growing = new Map<number, { grow: Grow; band: number }>();
  /**
   * THE LINE AS ORDERED, AND AS SET OUT: a band's three drawings — what is sprayed on the ground, under the road as
   * it grows; the plan, which breathes — and each planned cell's own tile,
   * shown pale till its pegs are in. Drawn again only as the setting out moves on. @see setOutAt
   */
  const setOf = new Map<number, { low: Graphics; plan: Graphics }>();
  let ghosts: { sp: Sprite; j: RoadJob; n: number; c: number }[] = [], setKey = "";
  /** What the line is set out WITH, standing on it: stakes, lengths of tape and their pins, profile boards, hubs, the level — baked, and filed with what else stands on the map. Stood again only as a whole piece more of it goes in. */
  let stood: Container[] = [], stoodKey = "";
  const unstand = () => { for (const c of stood) { c.parent?.removeChild(c); c.destroy({ children: true }); } stood = []; stoodKey = ""; };
  const ungrow = () => { for (const c of growing.values()) c.grow.destroy(); growing.clear(); };
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
        // What is planned has changed: the tiles may have. Every growing cell is made again from them.
        ungrow();
        pl.ghost = new Set();
      }
      if (!g.roadJobs.length) { plan = null; if (growing.size) ungrow(); }
      /** Whether the cells grow by the shader: wherever there are tiles to grow. */
      const grows = !!pl?.painter && !!plan;
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
        // A JUNCTION JOINS AS THE ROAD REACHES IT, not when the length opens: every road that stands beside a cell
        // whose blacktop is down — the road it leaves, one it crosses, one it comes to, the open part of its own job —
        // is drawn as the cell it will be, its kerb gone and its lines carried through. Where its level is to
        // change for the junction it waits for that.
        const joined = new Set<number>();
        const surf = (q: Grid, i: number) => (q.deck[i] !== 0 ? q.deckZ[i] : q.height[i]);
        g.roadJobs.slice(0, GANGS).forEach((j) => {
          for (let c = j.opened; c < j.cells.length; c++) {
            const cell = j.cells[c];
            if (!cell.fresh || stageOf(j, c) < 3) continue;
            for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
              const x = cell.x + dx, y = cell.y + dy;
              if (x < 0 || y < 0 || x >= g.w || y >= g.h) continue;
              const i = idx(g, x, y), layer = bands.pavedOf[bandOf(x, y)];
              if (g.paved[i] === 0 || joined.has(i) || !plan || !layer || surf(plan.grid, i) !== surf(g, i) || plan.grid.ramp[i] !== g.ramp[i]) continue;
              joined.add(i);
              const sp = tileOf(x, y, true);
              if (sp) { layer.addChild(sp); drawn.push(sp); }
            }
          }
        });
        // THE ROAD AS IT WILL BE, pale on the ground it is ordered on: each cell's own tile, till its pegs are in.
        setOf.clear(); ghosts = []; setKey = "";
        g.roadJobs.forEach((j, n) => {
          for (let c = j.opened; c < j.cells.length; c++) {
            const cell = j.cells[c], layer = bands.pavedOf[bandOf(cell.x, cell.y)];
            if (!cell.fresh || !layer || (n < GANGS && stageOf(j, c) > 0)) continue;
            const sp = tileOf(cell.x, cell.y, true);
            if (sp) { sp.alpha = 0.5; sp.tint = 0x9fd6ff; layer.addChild(sp); drawn.push(sp); ghosts.push({ sp, j, n, c }); }
          }
        });
        g.roadJobs.forEach((j, n) => {
          for (let c = j.opened; c < j.cells.length; c++) {
            const cell = j.cells[c];
            if (!cell.fresh) continue;
            const band = bandOf(cell.x, cell.y), layer = bands.pavedOf[band];
            if (!layer) continue;
            if (!setOf.has(band)) {
              const mk = () => { const q = new Graphics(); q.eventMode = "none"; q.context.batchMode = "batch"; layer.addChild(q); drawn.push(q); return q; };
              setOf.set(band, { low: mk(), plan: mk() });
            }
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
            } else if (stage >= 1 && !(grows && n < GANGS)) ground(gfx, scale, cell, w, 1, h);
            // THE ROAD ITSELF grows on the cell by its own shader (below). Drawn plainly where there is no painter.
            if (stage >= 2 && !(grows && n < GANGS)) {
              const sp = tileOf(cell.x, cell.y, stage >= TRADES);
              if (sp) { if (stage === 2) sp.alpha = FORMING; layer.addChild(sp); drawn.push(sp); }
              else if (!cell.deck || stage >= 3) ground(gfx, scale, cell, w, stage, h);
            }
            if (!P || n >= GANGS) continue;
            // WHAT STANDS ROUND IT, where a gang is at work: a cone each side of every other cell till it is lined; a
            // barrier across where the open road stops.
            const stand = (id: string, turn: number, x: number, y: number) => { const sp = propSprite(P, id, turn, x, y, h, scale); const dyn = bands.dynamicOf[band]; if (sp && dyn) { sp.zIndex = x + y - band; dyn.addChild(sp); drawn.push(sp); } };
            if (stage >= 1 && c % 2 === 0 && (w.ax !== 0 || w.ay !== 0)) for (const sg of [-1, 1]) stand("cone", 0, cell.x - w.ay * sg * 0.44, cell.y + w.ax * sg * 0.44);
            if (c === j.opened && j.opened > 0) stand("barrier", w.ix !== 0 ? 1 : 0, cell.x - w.ix * 0.42, cell.y - w.iy * 0.42);
          }
        });
      }
      // THE ROAD GROWING, every frame: each cell of a job at work that a trade has come near, its four fronts told
      // to its shader — how far past the cell's near edge each has got. What grows there is the tile it will be.
      const alive = new Set<number>();
      if (grows) g.roadJobs.slice(0, GANGS).forEach((j) => {
        const f = [0, 1, 2, 3].map((t) => frontAt(j, t));
        // (Nothing grows on a job nobody digs yet.)
        if (f[0] <= 0) return;
        const tf = f.map(told), tc = told(frontAt(j, 1, CONCRETE_LAG * PACE));
        for (let c = j.opened; c < j.cells.length; c++) {
          const cell = j.cells[c];
          // (A ragged front reaches a little ahead of where its trade is: a cell is begun before the trade is on it.)
          if (!cell.fresh || f[0] - c < -0.8) continue;
          const i = idx(g, cell.x, cell.y), band = bandOf(cell.x, cell.y), layer = bands.pavedOf[band];
          if (!layer) continue;
          alive.add(i);
          let it = growing.get(i);
          if (!it) {
            const bare = plannedTile(pl!, plan!.grid, plan!.bare, cell.x, cell.y), lined = plannedTile(pl!, plan!.grid, plan!.lined, cell.x, cell.y);
            if (!bare || !lined) continue;
            const w = wayAt(j, c), pi = idx(plan!.grid, cell.x, cell.y);
            const h = plan!.grid.deck[pi] !== 0 ? plan!.grid.deckZ[pi] : plan!.grid.height[pi];
            it = { grow: createGrow({ bare: bare.tex, lined: lined.tex, x: bare.x, y: bare.y, scale: pl!.scale, cx: cell.x, cy: cell.y, h, ix: w.ix, iy: w.iy, deck: cell.deck }), band: -1 };
            growing.set(i, it);
          }
          // (Over what is drawn whole, which was just put back under it.)
          if (rebuilt || it.band !== band || !it.grow.mesh.parent) { layer.addChild(it.grow.mesh); it.band = band; }
          it.grow.fronts(tf[0] - c, tf[1] - c, tf[2] - c, tf[3] - c, tc - c);
        }
      });
      for (const [i, it] of growing) if (!alive.has(i)) { it.grow.destroy(); growing.delete(i); }

      // ── THE LINE, ORDERED AND SET OUT ───────────────────────────────────────────────────
      // ORDERED, it is a PLAN: the road it will be, pale, inside a bright line round the whole of it. Then a crew
      // walks it and it becomes a SITE a step at a time — a peg driven at every corner, tape strung peg to peg with
      // ribbons on it, the centre sprayed on the ground — and the plan is gone from each cell as its pegs go in.
      const sk = g.roadJobs.map((j, n) => (n < GANGS ? [0, 1, 2].map((q) => Math.floor(setOutAt(j, q) * SET_FINE)).join(".") : "w")).join("|");
      if (rebuilt || sk !== setKey) {
        setKey = sk;
        for (const s of setOf.values()) { s.low.clear(); s.plan.clear(); }
        /** Every cell some job is to build: a plan's line runs round all of them together, not between two of them. */
        const mine = new Set<number>();
        for (const j of g.roadJobs) for (let c = j.opened; c < j.cells.length; c++) if (j.cells[c].fresh) mine.add(idx(g, j.cells[c].x, j.cells[c].y));
        const lw = Math.max(1.5, 2.2 * scale);
        for (const gh of ghosts) gh.sp.visible = gh.n >= GANGS || (setOutAt(gh.j, 0) < gh.c + 1 && stageOf(gh.j, gh.c) === 0) || (gh.j.cells[gh.c].deck && stageOf(gh.j, gh.c) < 2);
        g.roadJobs.forEach((j, n) => {
          const at = n < GANGS ? [0, 1, 2].map((q) => setOutAt(j, q)) : [0, 0, 0];
          for (let c = j.opened; c < j.cells.length; c++) {
            const cell = j.cells[c];
            if (!cell.fresh) continue;
            const s = setOf.get(bandOf(cell.x, cell.y)), stage = n < GANGS ? stageOf(j, c) : 0;
            if (!s || stage >= 3) continue;
            const w = wayAt(j, c), h = cell.deck ? cell.z : g.height[idx(g, cell.x, cell.y)];
            /** The cell's edges that are the line's own — none of them between two cells to be built — each with how far along the job's way its ends are. */
            const sides: { a: number[]; b: number[]; fa: number; fb: number }[] = [];
            for (const [ex, ey] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
              const x = cell.x + ex, y = cell.y + ey;
              // (Nor where it meets a road that is there: nothing is strung across the way in.)
              if (x >= 0 && y >= 0 && x < g.w && y < g.h && (mine.has(idx(g, x, y)) || g.paved[idx(g, x, y)] !== 0)) continue;
              const a = [cell.x + ex * 0.5 - ey * 0.5, cell.y + ey * 0.5 - ex * 0.5], b = [cell.x + ex * 0.5 + ey * 0.5, cell.y + ey * 0.5 + ex * 0.5];
              const far = (q: number[]) => (q[0] - cell.x) * w.ix + (q[1] - cell.y) * w.iy + 0.5;
              sides.push(far(a) <= far(b) ? { a, b, fa: far(a), fb: far(b) } : { a: b, b: a, fa: far(b), fb: far(a) });
            }
            const pegged = at[0] >= c + 1 || stage > 0;
            if (!pegged || (cell.deck && stage < 2)) {
              // THE PLAN: a wash, and the line round it — bright, and thick enough to read from far off.
              s.plan.poly(rect(scale, cell.x - 0.5, cell.y - 0.5, cell.x + 0.5, cell.y + 0.5, h)).fill({ color: 0x3fb4ff, alpha: 0.26 });
              for (const e of sides) { const [x0, y0] = pt(scale, e.a[0], e.a[1], h), [x1, y1] = pt(scale, e.b[0], e.b[1], h); s.plan.moveTo(x0, y0).lineTo(x1, y1).stroke({ color: PLAN, width: lw * 1.6, alpha: 1, cap: "round" }); }
              // Its middle, in dashes the way it runs.
              if (w.ax !== 0 || w.ay !== 0) for (const l of [-0.42, -0.08, 0.26]) s.plan.poly(strip(scale, cell, w, -0.03, 0.03, h, l, l + 0.18)).fill({ color: PLAN, alpha: 0.95 });
            }
            if (cell.deck || n >= GANGS) continue;
            // SPRAYED, the centre of it: dashes the way it runs and a cross at the cell's middle — till it is dug.
            const mk = Math.max(0, Math.min(1, at[2] - c));
            if (stage === 0 && mk > 0) {
              if (w.ix !== 0 || w.iy !== 0) for (const l of [0.08, 0.6]) { if (l >= mk) continue; const l1 = Math.min(mk, l + 0.28); s.low.poly(strip(scale, cell, { ax: w.ix, ay: w.iy }, -0.022, 0.022, h, w.ix + w.iy > 0 ? l - 0.5 : 0.5 - l1, w.ix + w.iy > 0 ? l1 - 0.5 : 0.5 - l)).fill({ color: SPRAY, alpha: 0.95 }); }
              if (mk > 0.5) for (const [du, dv] of [[1, 1], [1, -1]]) { const [x0, y0] = pt(scale, cell.x - du * 0.07, cell.y - dv * 0.07, h), [x1, y1] = pt(scale, cell.x + du * 0.07, cell.y + dv * 0.07, h); s.low.moveTo(x0, y0).lineTo(x1, y1).stroke({ color: SPRAY, width: Math.max(1, 1.4 * scale), alpha: 0.95 }); }
            }
          }
        });
      }
      // WHAT STANDS ON THE LINE, baked: a stake at every corner once driven; tape from stake to stake in half-tile
      // lengths as it is run out, a pin under each join; a profile board each side every third tile; a hub at each
      // cell's centre till it is dug; the level on its tripod by the start while the line is being set out.
      const stand: { id: string; turn: number; x: number; y: number; h: number; cell: JobCell }[] = [];
      // (Worked out again only when a whole piece more of it is due: a stake, half a tile of tape, a hub; or a trade has passed a cell.)
      const sk2 = `${scale}|${P ? 1 : 0}|${g.roadJobs.slice(0, GANGS).map((j) => `${j.id}.${j.opened}.${Math.floor(setOutAt(j, 0))}.${Math.floor(setOutAt(j, 1) * 2)}.${Math.floor(setOutAt(j, 2) + 0.5)}.${[0, 1, 2].map((t) => frontOf(j, t)).join("-")}`).join("|")}`;
      const restand = rebuilt || sk2 !== stoodKey;
      if (P && restand) {
        const mine = new Set<number>();
        for (const j of g.roadJobs) for (let c = j.opened; c < j.cells.length; c++) if (j.cells[c].fresh) mine.add(idx(g, j.cells[c].x, j.cells[c].y));
        const staked = new Set<string>();
        g.roadJobs.slice(0, GANGS).forEach((j) => {
          const at = [0, 1, 2].map((q) => setOutAt(j, q));
          if (at[2] < j.cells.length && j.cells.length) { const c0 = j.cells[0], w0 = wayAt(j, 0); stand.push({ id: "tripod", turn: 0, x: c0.x - w0.iy * 0.82 - w0.ix * 0.3, y: c0.y + w0.ix * 0.82 - w0.iy * 0.3, h: g.height[idx(g, c0.x, c0.y)], cell: c0 }); }
          for (let c = j.opened; c < j.cells.length; c++) {
            const cell = j.cells[c], stage = stageOf(j, c);
            if (!cell.fresh || cell.deck || stage >= 3 || !(at[0] >= c + 1 || stage > 0)) continue;
            const w = wayAt(j, c), h = g.height[idx(g, cell.x, cell.y)];
            // MIXED UP, the same every time: a few tiles of bunting, then a few of plain line; a flagged stake among the plain ones.
            const bright = hash(j.id * 7.3 + Math.floor(c / 3) * 1.9) < 0.42;
            for (const [du, dv] of [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]]) {
              const k = `${cell.x + du},${cell.y + dv}`;
              if (!staked.has(k)) { staked.add(k); stand.push({ id: hash((cell.x + du) * 5.1 + (cell.y + dv) * 9.7) < 0.3 ? "stakeFlag" : "stake", turn: (cell.x * 3 + cell.y + (du > 0 ? 1 : 0) + (dv > 0 ? 2 : 0)) & 3, x: cell.x + du, y: cell.y + dv, h, cell }); }
            }
            // TAPE, as far as it has been run out: each of the cell's own edges in two lengths.
            const run = stage > 0 ? 1 : Math.max(0, Math.min(1, at[1] - c));
            if (run > 0) for (const [ex, ey] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
              const x = cell.x + ex, y = cell.y + ey;
              if (x >= 0 && y >= 0 && x < g.w && y < g.h && (mine.has(idx(g, x, y)) || g.paved[idx(g, x, y)] !== 0)) continue;
              const far = (qx: number, qy: number) => (qx - cell.x) * w.ix + (qy - cell.y) * w.iy + 0.5;
              let any = false;
              for (const half of [-0.25, 0.25]) {
                // (Along the edge: an edge across x runs along y, and the other way about.)
                const mx = cell.x + ex * 0.5 + Math.abs(ey) * half, my = cell.y + ey * 0.5 + Math.abs(ex) * half;
                const ends = [far(mx - Math.abs(ey) * 0.25, my - Math.abs(ex) * 0.25), far(mx + Math.abs(ey) * 0.25, my + Math.abs(ex) * 0.25)];
                if (Math.max(...ends) > run + 1e-6 && !(ends[0] === ends[1] && ends[0] <= run)) continue;
                any = true;
                stand.push({ id: bright ? "bunting" : "tape", turn: (ex !== 0 ? 1 : 0) + ((cell.x + cell.y) & 1) * 2, x: mx, y: my, h, cell });
              }
              if (any) stand.push({ id: bright ? "buntingPin" : "tapePin", turn: 0, x: cell.x + ex * 0.5, y: cell.y + ey * 0.5, h, cell });
            }
            // A PROFILE BOARD each side, across the line, every third tile of a straight.
            if (run >= 1 && c % 3 === 1 && (w.ax !== 0 || w.ay !== 0)) for (const sg of [-1, 1]) stand.push({ id: hash(cell.x * 3.3 + cell.y * 7.1) < 0.5 ? "profileRed" : "profile", turn: w.ax !== 0 ? 1 : 0, x: cell.x - w.ay * sg * 0.68 + w.ax * 0.5, y: cell.y + w.ax * sg * 0.68 + w.ay * 0.5, h, cell });
            // A HUB at its centre, till it is dug.
            if (stage === 0 && at[2] >= c + 0.5) stand.push({ id: "hub", turn: (cell.x + cell.y * 3) & 3, x: cell.x, y: cell.y, h, cell });
          }
        });
      }
      if (restand) {
        unstand();
        stoodKey = sk2;
        for (const q of stand) {
          const band = bandOf(q.cell.x, q.cell.y), dyn = bands.dynamicOf[band], sp = P ? propSprite(P, q.id, q.turn, q.x, q.y, q.h, scale) : null;
          if (!sp || !dyn) { sp?.destroy({ children: true }); continue; }
          sp.zIndex = q.x + q.y - band;
          dyn.addChild(sp); stood.push(sp);
        }
      }
      // (The plan breathes, so the eye finds it.)
      if (setOf.size) { const a = 0.78 + 0.22 * Math.sin(performance.now() / 380); for (const s of setOf.values()) s.plan.alpha = a; }
      // THE MOVING EDGES, where there is no painter: in the cell a trade is passing through, what it leaves behind
      // it as far as it has got.
      const live = new Set<string>();
      if (!grows) g.roadJobs.slice(0, GANGS).forEach((j) => {
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
    destroy() { clear(); unstand(); setOf.clear(); ghosts = []; ungrow(); for (const e of edges.values()) { if (e.tile) { e.tile.mask = null; e.tile.destroy(); } e.gfx.parent?.removeChild(e.gfx); e.gfx.destroy(); } edges.clear(); },
  };
}
