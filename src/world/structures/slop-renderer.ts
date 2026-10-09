/**
 * World v2 — THE SLOP PIT, drawn: a square hole with a concrete lip, earth
 * walls going down into it, and sludge standing in it as high as the pit is
 * full — toxic green, bubbling — with a hazard sign on a post at one corner.
 * @see SLOP_PIT, state/slop-pit.store
 *
 * Drawn like the projects, a Graphics per column, and redrawn every frame:
 * the sludge bubbles. Three columns of a few quads each is nothing.
 */
import { Container, Graphics } from "pixi.js";

import { useSlopPitStore } from "../../state/slop-pit.store";
import type { Structure } from "../grid";
import { pen } from "./project-renderer";
import { registerCustomRenderer, type RenderCtx, type StructureHandle } from "./render";

/** `sprites` are what it drew, for the labels and the pointer. @see drawnTop, structureHitAt */
type SlopHandle = StructureHandle & { cols: Column[]; sprites: Container[]; t: number };

/** How deep the pit goes, in half steps, and how far in its walls stand. */
export const PIT_DEPTH = 3;
const LIP = 0.16;

const CONCRETE = 0xb9b4a8;
const WALL = 0x5b4632;
const WALL_SHADE = 0x46362a;
const FLOOR = 0x2e2620;
const SLUDGE = 0xb4f22c;
const SLUDGE_DEEP = 0x6f9e12;
const FOAM = 0xeeffa8;
const SIGN = 0xf2c230;
const POST = 0x3a3f45;

/**
 * One column of the pit, in three layers: the OPENING, which is the mask —
 * everything inside the pit is seen only through the hole, as the ground in
 * front of it hides the rest; the INSIDE, walls and floor and sludge, drawn
 * through it; and the TOP, the concrete lip and the sign, over both.
 */
type Column = { box: Container; mask: Graphics; inside: Graphics; top: Graphics };

function draw(col: Column, s: Structure, ctx: RenderCtx, c: number, t: number): void {
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
  const fill = Math.max(0, Math.min(1, useSlopPitStore.getState().fill / 100));
  if (fill > 0.005) {
    const z = -PIT_DEPTH + PIT_DEPTH * fill * 0.95;
    flat(i, u0, v0, u1, v1, z, fill > 0.5 ? SLUDGE : SLUDGE_DEEP, 0.95, false);
    // The scum line on the back walls, just above the surface.
    i.quad([i.P(u0, v0, z + 0.15), i.P(u1, v0, z + 0.15), i.P(u1, v0, z), i.P(u0, v0, z)], FOAM, 0.6);
    i.quad([i.P(u0, v0, z + 0.15), i.P(u0, v1, z + 0.15), i.P(u0, v1, z), i.P(u0, v0, z)], FOAM, 0.45);
    // Bubbles, each rising and bursting on a cycle of its own.
    for (let k = 0; k < 9; k++) {
      const bu = u0 + 0.2 + ((k * 0.37) % 1) * (u1 - u0 - 0.4), bv = v0 + 0.2 + ((k * 0.61) % 1) * (v1 - v0 - 0.4);
      const phase = (t * (0.6 + (k % 3) * 0.25) + k * 0.31) % 1;
      const [px, py] = i.P(bu, bv, z);
      inside.circle(px, py, (1 + phase * 3) * ctx.scale * 2.2);
      inside.fill({ color: FOAM, alpha: 0.85 * (1 - phase) });
    }
  }

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
    for (let c = 0; c < s.w; c++) {
      const box = new Container(), mask = new Graphics(), inside = new Graphics(), top = new Graphics();
      box.eventMode = "none";
      box.addChild(mask, inside, top);
      inside.mask = mask;
      const col = { box, mask, inside, top };
      draw(col, s, ctx, c, 0);
      // In the band of its column's front cell, like the projects.
      const band = Math.max(0, Math.min(ctx.bands.structureOf.length - 1, s.x + c + s.y + s.h - 1));
      ctx.bands.structureOf[band].addChild(box);
      columns.push(col);
    }
    const handle: SlopHandle = {
      cols: columns, sprites: columns.map((col) => col.box), t: 0,
      destroy: () => { for (const col of columns) { col.box.parent?.removeChild(col.box); col.box.destroy({ children: true }); } },
    };
    return handle;
  },
  update(h, s, _def, ctx) {
    const handle = h as SlopHandle;
    handle.cols.forEach((col, c) => draw(col, s, ctx, c, handle.t));
  },
  tick(h, s, _def, ctx, dt) {
    const handle = h as SlopHandle;
    handle.t += dt;
    handle.cols.forEach((col, c) => draw(col, s, ctx, c, handle.t));
  },
  unmount(h) { h.destroy(); },
});
