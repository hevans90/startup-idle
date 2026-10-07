/**
 * World v2 — a seaport, drawn.
 *
 * There is no seaport in the art set, so one is drawn the way a boat is:
 * boxes and roofs worked out in the tile plane and projected. @see boats-render
 *
 * A PORT IS A ROW OF COLUMNS, one a tile wide across its footprint, each a
 * SHED (a warehouse with a pitched roof) or a YARD (a crane, crates and planking)
 * on a stone quay that runs the whole length. The tiers are longer rows: a
 * shed and a yard; a shed and two yards; then two of each. @see SEAPORTS
 *
 * A GRAPHICS PER COLUMN, each in the band of its own front cell, as the kit
 * buildings split by cell. Drawn as one piece, a long port sat in the band of
 * its front corner and painted over ground in front of its other end, which
 * belongs over it. @see tiles-renderer
 */
import { Graphics } from "pixi.js";

import { idx, inBounds, type Structure } from "../grid";
import { HEIGHT_UNIT, HH, HW } from "../iso";
import { registerCustomRenderer, type RenderCtx, type StructureHandle } from "./render";

type SeaportHandle = StructureHandle & { columns: Graphics[] };

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

/** What stands in each column of a port this many tiles long. */
const LAYOUT: Record<number, readonly ("shed" | "yard")[]> = {
  2: ["shed", "yard"],
  3: ["shed", "yard", "yard"],
  4: ["shed", "yard", "shed", "yard"],
};
const layoutOf = (w: number) => LAYOUT[w] ?? Array.from({ length: w }, (_, k) => (k % 2 ? "yard" : "shed"));

/** Draw column `c` of a port — the tile `s.x + c` across its whole depth. */
function draw(g: Graphics, s: Structure, ctx: RenderCtx, c: number): void {
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
   * A box: its top and the sides the camera sees, which face +u and +v. The
   * +u side is the lit one, as on the boats; `side` false leaves it off, for
   * a box with another drawn against it there.
   */
  const box = (
    u0: number, v0: number, u1: number, v1: number, z0: number, z1: number,
    top: number, lit: number, shade: number, side = true,
  ) => {
    if (side) quad([P(u1, v0, z1), P(u1, v1, z1), P(u1, v1, z0), P(u1, v0, z0)], lit);
    quad([P(u0, v1, z1), P(u1, v1, z1), P(u1, v1, z0), P(u0, v1, z0)], shade);
    quad([P(u0, v0, z1), P(u1, v0, z1), P(u1, v1, z1), P(u0, v1, z1)], top);
  };

  g.clear();
  const kinds = layoutOf(s.w);
  const last = c === s.w - 1;
  const x0 = s.x + c - 0.5, x1 = x0 + 1, y0 = s.y - 0.5, y1 = s.y + s.h - 0.5;

  // THE QUAY under this column, its lit end only where the row ends, and a
  // kerb along its outside edges.
  box(x0, y0, x1, y1, -0.4, QUAY, STONE, STONE_SIDE, STONE_SHADE, last);
  g.moveTo(...P(x0, y0, QUAY)).lineTo(...P(x1, y0, QUAY));
  g.moveTo(...P(x0, y1, QUAY)).lineTo(...P(x1, y1, QUAY));
  if (c === 0) g.moveTo(...P(x0, y0, QUAY)).lineTo(...P(x0, y1, QUAY));
  if (last) g.moveTo(...P(x1, y0, QUAY)).lineTo(...P(x1, y1, QUAY));
  g.stroke({ color: STONE_SHADE, width: Math.max(1, 1.4 * sc), alpha: 0.8 });

  if (kinds[c] === "shed") {
    // A SHED, the second one taller: walls, a door, a roof pitched along v.
    const tall = kinds.slice(0, c).includes("shed") ? 1.35 : 1;
    const wu0 = x0 + 0.08, wu1 = x0 + 0.95, wv0 = y0 + 0.1, wv1 = y1 - 0.25;
    const top = QUAY + WALLS * tall, ridge = top + (RIDGE - WALLS), eave = 0.08;
    box(wu0, wv0, wu1, wv1, QUAY, top, WALL, WALL, WALL_SHADE);
    const um = (wu0 + wu1) / 2;
    // THE GABLE, then the roof over it, which overhangs the long walls by
    // `eave` but ends FLUSH with the gable. An overhang there is seen from
    // underneath at this angle — the line of sight climbs faster than the roof
    // does — and with no soffit drawn the gap under it showed straight through.
    //
    // EACH SLOPE IS ONE PLANE, through the ridge and the wall's top edge, and the
    // eave carries on down it: `low` is lower than the wall top by the drop over
    // the overhang. An eave put at the wall top's height made the roof's edge a
    // different line from the gable's, and the sliver between them showed the
    // wall and the sky.
    const low = top - (eave * (ridge - top)) / (um - wu0);
    quad([P(wu0, wv1, top), P(wu1, wv1, top), P(um, wv1, ridge)], WALL_SHADE);
    quad([P(wu0 - eave, wv0, low), P(um, wv0, ridge), P(um, wv1, ridge), P(wu0 - eave, wv1, low)], ROOF_SHADE);
    quad([P(um, wv0, ridge), P(wu1 + eave, wv0, low), P(wu1 + eave, wv1, low), P(um, wv1, ridge)], ROOF);
    const dv = (wv0 + wv1) / 2;
    quad([P(wu1, dv - 0.22, QUAY + 1.8), P(wu1, dv + 0.22, QUAY + 1.8), P(wu1, dv + 0.22, QUAY), P(wu1, dv - 0.22, QUAY)], DOOR);
    return;
  }

  // A YARD: planking, crates at the front, and a crane at the back whose jib
  // reaches out over the front edge of the quay, to the water.
  for (let k = 1; k < 8; k++) {
    const v = y0 + ((y1 - y0) * k) / 8;
    g.moveTo(...P(x0 + 0.05, v, QUAY)).lineTo(...P(x1 - 0.05, v, QUAY));
  }
  g.stroke({ color: PLANK, width: Math.max(1, 1.1 * sc), alpha: 0.55 });
  const cu = x0 + 0.5, cv = y0 + 0.45;
  box(cu - 0.08, cv - 0.08, cu + 0.08, cv + 0.08, QUAY, QUAY + MAST, CRANE, CRANE, CRANE_SHADE);
  const jib: [number, number, number] = [cu, y1 + 0.35, QUAY + MAST - 0.4];
  g.moveTo(...P(cu, cv - 0.3, QUAY + MAST - 0.2)).lineTo(...P(cu, cv, QUAY + MAST)).lineTo(...P(...jib));
  g.stroke({ color: CRANE_SHADE, width: Math.max(1, 2.4 * sc) });
  const [hx, hy] = P(jib[0], jib[1], QUAY + 2.2);
  g.moveTo(...P(...jib)).lineTo(hx, hy);
  g.stroke({ color: ROPE, width: Math.max(1, 0.8 * sc) });
  g.rect(hx - 1.6 * sc, hy, 3.2 * sc, 2.4 * sc);
  g.fill({ color: ROPE });
  // Crates, a stack of them.
  box(x0 + 0.12, y1 - 0.62, x0 + 0.47, y1 - 0.27, QUAY, QUAY + 0.9, CRATE, CRATE, CRATE_SIDE);
  box(x0 + 0.5, y1 - 0.62, x0 + 0.82, y1 - 0.3, QUAY, QUAY + 0.9, CRATE_BLUE, CRATE_BLUE, CRATE_BLUE_SIDE);
  box(x0 + 0.22, y1 - 0.55, x0 + 0.55, y1 - 0.25, QUAY + 0.9, QUAY + 1.8, CRATE_BLUE, CRATE_BLUE, CRATE_BLUE_SIDE);
}

/** The band of a column's front cell. */
const bandOfColumn = (s: Structure, c: number) => s.x + c + s.y + s.h - 1;

function mount(s: Structure, _def: unknown, ctx: RenderCtx): SeaportHandle {
  const columns: Graphics[] = [];
  for (let c = 0; c < s.w; c++) {
    const g = new Graphics();
    g.eventMode = "none";
    draw(g, s, ctx, c);
    const band = Math.max(0, Math.min(ctx.bands.structureOf.length - 1, bandOfColumn(s, c)));
    ctx.bands.structureOf[band].addChild(g);
    columns.push(g);
  }
  return {
    columns,
    destroy: () => { for (const g of columns) { g.parent?.removeChild(g); g.destroy(); } },
  };
}

registerCustomRenderer("seaport", {
  mount,
  update(h, s, _def, ctx) { (h as SeaportHandle).columns.forEach((g, c) => draw(g, s, ctx, c)); },
  unmount(h) { h.destroy(); },
});
