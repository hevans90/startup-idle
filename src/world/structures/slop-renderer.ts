/**
 * World v2 — THE SLOP PIT, drawn: a square hole with a concrete lip, earth
 * walls going down into it, and a hazard sign on a post at one corner.
 * @see SLOP_PIT, state/slop-pit.store
 *
 * Drawn like the projects, a Graphics per column. The sludge in it is not
 * drawn here: it is fluid, in the water. @see syncPit
 */
import { Container, Graphics } from "pixi.js";

import { SLOP_PIT } from "./def";
import type { Structure } from "../grid";
import { pen } from "./project-renderer";
import { registerCustomRenderer, type RenderCtx, type StructureHandle } from "./render";

/** `sprites` are what it drew, for the labels and the pointer. @see drawnTop, structureHitAt */
type SlopHandle = StructureHandle & { cols: Column[]; cells: Graphics[]; sprites: Container[] };

/** How deep the pit goes, in half steps, and how far in its walls stand. */
export const PIT_DEPTH = SLOP_PIT.basin ?? 3;
const LIP = 0.16;

const CONCRETE = 0xb9b4a8;
const WALL = 0x5b4632;
const WALL_SHADE = 0x46362a;
const FLOOR = 0x2e2620;
const SIGN = 0xf2c230;
const POST = 0x3a3f45;

/**
 * One column of the pit, in two layers: the OPENING, which is the mask —
 * everything inside the pit is seen only through the hole, as the ground in
 * front of it hides the rest — and the INSIDE, walls and floor, drawn
 * through it. The lip round it is drawn a cell at a time. @see drawLip
 */
type Column = { deep: Container; mask: Graphics; inside: Graphics };

function draw(col: Column, s: Structure, ctx: RenderCtx, c: number): void {
  const { mask, inside } = col;
  mask.clear(); inside.clear();
  const x0 = s.x - 0.5, x1 = s.x + s.w - 0.5;
  const y0 = s.y - 0.5, y1 = s.y + s.h - 0.5;
  const u0 = x0 + LIP, u1 = x1 - LIP, v0 = y0 + LIP, v1 = y1 - LIP;
  const cu0 = Math.max(x0, s.x + c - 0.5), cu1 = Math.min(x1, s.x + c + 0.5);
  const a = Math.max(u0, cu0), b = Math.min(u1, cu1);

  // THE OPENING, this column's share of it.
  const m = pen(mask, s, ctx, c);
  if (b > a) m.quad([m.P(a, v0, 0), m.P(b, v0, 0), m.P(b, v1, 0), m.P(a, v1, 0)], 0xffffff);

  // THE INSIDE: the walls the camera looks down onto, the floor — ALL of it,
  // in every column. Looking down into one column's share of the hole shows
  // floor that lies under its neighbours'; the opening is what is cut by
  // column, and the openings do not overlap.
  const i = pen(inside, s, ctx, c);
  i.quad([i.P(u0, v0, 0), i.P(u1, v0, 0), i.P(u1, v0, -PIT_DEPTH), i.P(u0, v0, -PIT_DEPTH)], WALL);
  i.quad([i.P(u0, v0, 0), i.P(u0, v1, 0), i.P(u0, v1, -PIT_DEPTH), i.P(u0, v0, -PIT_DEPTH)], WALL_SHADE);
  i.quad([i.P(u0, v0, -PIT_DEPTH), i.P(u1, v0, -PIT_DEPTH), i.P(u1, v1, -PIT_DEPTH), i.P(u0, v1, -PIT_DEPTH)], FLOOR);
  // THE SLUDGE IS NOT DRAWN HERE: it is fluid, in the water, standing in
  // the hole as deep as the pit is full. @see syncPit
}

/**
 * THE LIP round the hole, one cell's share of it — and the hazard sign, on
 * the near corner's.
 *
 * A CELL AT A TIME, in that cell's own band, as the ground is. It was drawn a
 * column at a time in the band of the column's front cell, like a building's
 * walls; but the lip is flat, so its strip along the pit's BACK edge was then
 * filed two bands in front of where it lies, and painted over the front of a
 * house standing beside the pit's back corner.
 */
function drawLip(g: Graphics, s: Structure, ctx: RenderCtx, cx: number, cy: number): void {
  g.clear();
  const x0 = s.x - 0.5, x1 = s.x + s.w - 0.5, y0 = s.y - 0.5, y1 = s.y + s.h - 0.5;
  const u0 = x0 + LIP, u1 = x1 - LIP, v0 = y0 + LIP, v1 = y1 - LIP;
  const o = pen(g, s, ctx, cx - s.x);
  const ca = cx - 0.5, cb = cx + 0.5, da = cy - 0.5, db = cy + 0.5;
  const flat = (p0: number, q0: number, p1: number, q1: number) => {
    const lo = Math.max(p0, ca), hi = Math.min(p1, cb), lq = Math.max(q0, da), hq = Math.min(q1, db);
    if (hi > lo && hq > lq) o.quad([o.P(lo, lq, 0.04), o.P(hi, lq, 0.04), o.P(hi, hq, 0.04), o.P(lo, hq, 0.04)], CONCRETE);
  };
  flat(x0, y0, x1, v0);
  flat(x0, v1, x1, y1);
  flat(x0, v0, u0, v1);
  flat(u1, v0, x1, v1);
  if (cx === s.x + s.w - 1 && cy === s.y + s.h - 1) {
    const su = x1 - 0.1, sv = y1 - 0.1;
    o.box(su - 0.02, sv - 0.02, su + 0.02, sv + 0.02, 0, 1.4, POST, POST, POST);
    o.box(su - 0.18, sv - 0.03, su + 0.02, sv + 0.03, 1.1, 1.6, SIGN, SIGN, SIGN);
  }
}

/** Every cell the lip passes through: the ring round the pit's middle. */
function lipCells(s: Structure): [number, number][] {
  const out: [number, number][] = [];
  for (let cy = s.y; cy < s.y + s.h; cy++) {
    for (let cx = s.x; cx < s.x + s.w; cx++) {
      if (cx === s.x || cy === s.y || cx === s.x + s.w - 1 || cy === s.y + s.h - 1) out.push([cx, cy]);
    }
  }
  return out;
}

registerCustomRenderer("slop", {
  mount(s, _def, ctx) {
    const columns: Column[] = [];
    const last = ctx.bands.structureOf.length - 1;
    const band = (b: number) => Math.max(0, Math.min(last, b));
    for (let c = 0; c < s.w; c++) {
      const deep = new Container(), mask = new Graphics(), inside = new Graphics();
      deep.eventMode = "none";
      deep.addChild(mask, inside);
      inside.mask = mask;
      const col = { deep, mask, inside };
      draw(col, s, ctx, c);
      // THE INSIDE WITH THE GROUND, in the pit's backmost band: under the
      // sludge, which is water and draws with the structures of each of the
      // pit's own bands — filed in front with the lip, the walls and floor
      // painted over all of it but the front row.
      ctx.bands.staticOf[band(s.x + s.y)].addChild(deep);
      columns.push(col);
    }
    const cells = lipCells(s).map(([cx, cy]) => {
      const g = new Graphics();
      g.eventMode = "none";
      drawLip(g, s, ctx, cx, cy);
      ctx.bands.structureOf[band(cx + cy)].addChild(g);
      return g;
    });
    const handle: SlopHandle = {
      cols: columns, cells, sprites: [...cells, ...columns.map((col) => col.deep)],
      destroy: () => {
        for (const k of [...cells, ...columns.map((col) => col.deep)]) { k.parent?.removeChild(k); k.destroy({ children: true }); }
      },
    };
    return handle;
  },
  update(h, s, _def, ctx) {
    const handle = h as SlopHandle;
    handle.cols.forEach((col, c) => draw(col, s, ctx, c));
    lipCells(s).forEach(([cx, cy], k) => { if (handle.cells[k]) drawLip(handle.cells[k], s, ctx, cx, cy); });
  },
  unmount(h) { h.destroy(); },
});
