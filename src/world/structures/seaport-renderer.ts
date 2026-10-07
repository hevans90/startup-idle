/**
 * World v2 — a seaport, drawn.
 *
 * There is no seaport in the art set, so one is drawn the way a boat is: a
 * stone quay over the whole footprint, a warehouse with a pitched roof at the
 * back, a crane and a stack of crates at the front, worked out as boxes in the
 * tile plane and projected. @see boats-render
 *
 * ONE GRAPHICS, in the band of the footprint's front cell, among the
 * structures, so everything behind it has drawn before it and the ground in
 * front of it still covers it — the same rule the boats keep. A 2×2 is small
 * enough that splitting it into columns, as the kit buildings are, buys
 * nothing that can be seen. @see tiles-renderer
 */
import { Graphics } from "pixi.js";

import { idx, inBounds, type Structure } from "../grid";
import { HEIGHT_UNIT, HH, HW } from "../iso";
import { registerCustomRenderer, type RenderCtx, type StructureHandle } from "./render";

type SeaportHandle = StructureHandle & { g: Graphics };

const STONE = 0xa29d93;
const STONE_SIDE = 0x7d786f;
const STONE_SHADE = 0x625e57;
const PLANK = 0x8b6a45;
const WALL = 0xd2b48c;
const WALL_SHADE = 0xae9068;
const ROOF = 0xb5523b;
const ROOF_SHADE = 0x8e3d2b;
const DOOR = 0x5a3d22;
const CRANE = 0xe0b030;
const CRANE_SHADE = 0xa98220;
const CRATE = 0x9c6b3a;
const CRATE_SIDE = 0x7a5229;
const CRATE_BLUE = 0x3f6e9c;
const CRATE_BLUE_SIDE = 0x2f5478;
const ROPE = 0x2b2b2b;

/** Heights, in half steps over the ground. */
const QUAY = 0.6;
const WALLS = 3;
const RIDGE = 4.6;
const MAST = 6.5;

function draw(g: Graphics, s: Structure, ctx: RenderCtx): void {
  const sc = ctx.scale;
  const ground = inBounds(ctx.grid, s.x, s.y) ? ctx.grid.height[idx(ctx.grid, s.x, s.y)] : 0;
  /** A point in the tile plane, `z` half steps over the ground, on the screen. */
  const P = (u: number, v: number, z: number): [number, number] =>
    [(u - v) * HW * sc, (u + v) * HH * sc - (ground + z) * HEIGHT_UNIT * sc];
  const quad = (pts: [number, number][], color: number) => {
    g.poly(pts.flat());
    g.fill({ color });
  };
  /**
   * A box: its top and the two sides the camera sees, which face +u and +v.
   * The +u side is the lit one, as on the boats.
   */
  const box = (
    u0: number, v0: number, u1: number, v1: number, z0: number, z1: number,
    top: number, lit: number, shade: number,
  ) => {
    quad([P(u1, v0, z1), P(u1, v1, z1), P(u1, v1, z0), P(u1, v0, z0)], lit);
    quad([P(u0, v1, z1), P(u1, v1, z1), P(u1, v1, z0), P(u0, v1, z0)], shade);
    quad([P(u0, v0, z1), P(u1, v0, z1), P(u1, v1, z1), P(u0, v1, z1)], top);
  };

  g.clear();
  const x0 = s.x - 0.5, y0 = s.y - 0.5, x1 = s.x + s.w - 0.5, y1 = s.y + s.h - 0.5;

  // THE QUAY, and planks across it.
  box(x0, y0, x1, y1, -0.4, QUAY, STONE, STONE_SIDE, STONE_SHADE);
  for (let k = 1; k < 8; k++) {
    const v = y0 + ((y1 - y0) * k) / 8;
    const [ax, ay] = P(x0 + 0.95, v, QUAY), [bx, by] = P(x1 - 0.05, v, QUAY);
    g.moveTo(ax, ay).lineTo(bx, by);
  }
  g.stroke({ color: PLANK, width: Math.max(1, 1.1 * sc), alpha: 0.55 });
  // A kerb of darker stone round the edge.
  g.poly([...P(x0, y0, QUAY), ...P(x1, y0, QUAY), ...P(x1, y1, QUAY), ...P(x0, y1, QUAY)]);
  g.stroke({ color: STONE_SHADE, width: Math.max(1, 1.4 * sc), alpha: 0.8 });

  // THE WAREHOUSE, at the back: walls, a door, and a roof pitched along v.
  const wu0 = x0 + 0.08, wu1 = x0 + 0.95, wv0 = y0 + 0.1, wv1 = y1 - 0.25;
  box(wu0, wv0, wu1, wv1, QUAY, QUAY + WALLS, WALL, WALL, WALL_SHADE);
  const um = (wu0 + wu1) / 2, top = QUAY + WALLS, ridge = QUAY + RIDGE, eave = 0.08;
  // THE GABLE BEFORE THE ROOF: the roof overhangs it by `eave`, so it is in
  // front of the gable's top edges and has to be painted over them. Drawn
  // after, the gable cut a wedge out of both slopes.
  quad([P(wu0, wv1, top), P(wu1, wv1, top), P(um, wv1, ridge)], WALL_SHADE);
  quad([P(wu0 - eave, wv0, top), P(um, wv0, ridge), P(um, wv1 + eave, ridge), P(wu0 - eave, wv1 + eave, top)], ROOF_SHADE);
  quad([P(um, wv0, ridge), P(wu1 + eave, wv0, top), P(wu1 + eave, wv1 + eave, top), P(um, wv1 + eave, ridge)], ROOF);
  // And a door in the lit side.
  const dv = (wv0 + wv1) / 2;
  quad([P(wu1, dv - 0.22, QUAY + 1.8), P(wu1, dv + 0.22, QUAY + 1.8), P(wu1, dv + 0.22, QUAY), P(wu1, dv - 0.22, QUAY)], DOOR);

  // CRATES, stacked at the front.
  box(x1 - 0.75, y1 - 0.62, x1 - 0.4, y1 - 0.27, QUAY, QUAY + 0.9, CRATE, CRATE, CRATE_SIDE);
  box(x1 - 0.38, y1 - 0.62, x1 - 0.06, y1 - 0.3, QUAY, QUAY + 0.9, CRATE_BLUE, CRATE_BLUE, CRATE_BLUE_SIDE);
  box(x1 - 0.65, y1 - 0.55, x1 - 0.32, y1 - 0.25, QUAY + 0.9, QUAY + 1.8, CRATE_BLUE, CRATE_BLUE, CRATE_BLUE_SIDE);

  // THE CRANE: a post, a jib out over the edge, and a hook on a rope.
  const cu = x1 - 0.45, cv = y0 + 0.45;
  box(cu - 0.08, cv - 0.08, cu + 0.08, cv + 0.08, QUAY, QUAY + MAST, CRANE, CRANE, CRANE_SHADE);
  const [mx, my] = P(cu, cv, QUAY + MAST), [jx, jy] = P(cu + 0.9, cv - 0.35, QUAY + MAST - 0.4);
  const [bx, by] = P(cu - 0.35, cv + 0.15, QUAY + MAST - 0.2);
  g.moveTo(bx, by).lineTo(mx, my).lineTo(jx, jy);
  g.stroke({ color: CRANE_SHADE, width: Math.max(1, 2.4 * sc) });
  const [hx, hy] = P(cu + 0.9, cv - 0.35, QUAY + 2.2);
  g.moveTo(jx, jy).lineTo(hx, hy);
  g.stroke({ color: ROPE, width: Math.max(1, 0.8 * sc) });
  g.rect(hx - 1.6 * sc, hy, 3.2 * sc, 2.4 * sc);
  g.fill({ color: ROPE });
}

const frontBand = (s: Structure) => s.x + s.w - 1 + s.y + s.h - 1;

function mount(s: Structure, _def: unknown, ctx: RenderCtx): SeaportHandle {
  const g = new Graphics();
  g.eventMode = "none";
  draw(g, s, ctx);
  const band = Math.max(0, Math.min(ctx.bands.structureOf.length - 1, frontBand(s)));
  ctx.bands.structureOf[band].addChild(g);
  return { g, destroy: () => { g.parent?.removeChild(g); g.destroy(); } };
}

registerCustomRenderer("seaport", {
  mount,
  update(h, s, _def, ctx) { draw((h as SeaportHandle).g, s, ctx); },
  unmount(h) { h.destroy(); },
});
