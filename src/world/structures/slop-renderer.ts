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
type SlopHandle = StructureHandle & { cols: Column[]; sprites: Container[] };

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
 * One column of the pit, in three layers: the OPENING, which is the mask —
 * everything inside the pit is seen only through the hole, as the ground in
 * front of it hides the rest; the INSIDE, walls and floor and sludge, drawn
 * through it; and the TOP, the concrete lip and the sign, over both.
 */
type Column = { box: Container; deep: Container; mask: Graphics; inside: Graphics; top: Graphics };

function draw(col: Column, s: Structure, ctx: RenderCtx, c: number): void {
  const { mask, inside, top } = col;
  mask.clear(); inside.clear(); top.clear();
  const x0 = s.x - 0.5, x1 = s.x + s.w - 0.5, y0 = s.y - 0.5, y1 = s.y + s.h - 0.5;
  const u0 = x0 + LIP, u1 = x1 - LIP, v0 = y0 + LIP, v1 = y1 - LIP;
  const cu0 = Math.max(x0, s.x + c - 0.5), cu1 = Math.min(x1, s.x + c + 0.5);
  const a = Math.max(u0, cu0), b = Math.min(u1, cu1);

  // THE OPENING, this column's share of it.
  const m = pen(mask, s, ctx, c);
  if (b > a) m.quad([m.P(a, v0, 0), m.P(b, v0, 0), m.P(b, v1, 0), m.P(a, v1, 0)], 0xffffff);

  // THE INSIDE: the walls the camera looks down onto, the floor, the sludge —
  // ALL of it, in every column. Looking down into one column's share of the
  // hole shows floor that lies under its neighbours'; the opening is what is
  // cut by column, and the openings do not overlap.
  const i = pen(inside, s, ctx, c);
  const flat = (p: typeof i, p0: number, q0: number, p1: number, q1: number, z: number, colour: number, alpha = 1, clip = true) => {
    const lo = clip ? Math.max(p0, cu0) : p0, hi = clip ? Math.min(p1, cu1) : p1;
    if (hi > lo) p.quad([p.P(lo, q0, z), p.P(hi, q0, z), p.P(hi, q1, z), p.P(lo, q1, z)], colour, alpha);
  };
  i.quad([i.P(u0, v0, 0), i.P(u1, v0, 0), i.P(u1, v0, -PIT_DEPTH), i.P(u0, v0, -PIT_DEPTH)], WALL);
  i.quad([i.P(u0, v0, 0), i.P(u0, v1, 0), i.P(u0, v1, -PIT_DEPTH), i.P(u0, v0, -PIT_DEPTH)], WALL_SHADE);
  flat(i, u0, v0, u1, v1, -PIT_DEPTH, FLOOR, 1, false);
  // THE SLUDGE IS NOT DRAWN HERE: it is fluid, in the water, standing in
  // the hole as deep as the pit is full. @see syncPit

  // THE TOP: the lip round the hole, and the hazard sign at the near corner.
  const o = pen(top, s, ctx, c);
  flat(o, x0, y0, x1, v0, 0.04, CONCRETE);
  flat(o, x0, v1, x1, y1, 0.04, CONCRETE);
  flat(o, x0, v0, u0, v1, 0.04, CONCRETE);
  flat(o, u1, v0, x1, v1, 0.04, CONCRETE);
  if (c === s.w - 1) {
    const su = x1 - 0.1, sv = y1 - 0.1;
    o.box(su - 0.02, sv - 0.02, su + 0.02, sv + 0.02, 0, 1.4, POST, POST, POST);
    o.box(su - 0.18, sv - 0.03, su + 0.02, sv + 0.03, 1.1, 1.6, SIGN, SIGN, SIGN);
  }
}

registerCustomRenderer("slop", {
  mount(s, _def, ctx) {
    const columns: Column[] = [];
    const last = ctx.bands.structureOf.length - 1;
    for (let c = 0; c < s.w; c++) {
      const box = new Container(), deep = new Container(), mask = new Graphics(), inside = new Graphics(), top = new Graphics();
      box.eventMode = "none";
      deep.eventMode = "none";
      deep.addChild(mask, inside);
      box.addChild(top);
      inside.mask = mask;
      const col = { box, deep, mask, inside, top };
      draw(col, s, ctx, c);
      // THE INSIDE WITH THE GROUND, in the pit's backmost band: under the
      // sludge, which is water and draws with the structures of each of the
      // pit's own bands — filed in front with the lip, the walls and floor
      // painted over all of it but the front row.
      ctx.bands.staticOf[Math.max(0, Math.min(last, s.x + s.y))].addChild(deep);
      // The lip and the sign in the band of the column's front cell, like the projects.
      ctx.bands.structureOf[Math.max(0, Math.min(last, s.x + c + s.y + s.h - 1))].addChild(box);
      columns.push(col);
    }
    const handle: SlopHandle = {
      cols: columns, sprites: columns.flatMap((col) => [col.box, col.deep]),
      destroy: () => {
        for (const col of columns) {
          for (const k of [col.box, col.deep]) { k.parent?.removeChild(k); k.destroy({ children: true }); }
        }
      },
    };
    return handle;
  },
  update(h, s, _def, ctx) {
    const handle = h as SlopHandle;
    handle.cols.forEach((col, c) => draw(col, s, ctx, c));
  },
  unmount(h) { h.destroy(); },
});
