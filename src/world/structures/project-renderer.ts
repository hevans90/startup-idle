/**
 * World v2 — a project's building, drawn going up, and drawn finished.
 *
 * WHILE IT IS A SITE (`Structure.build`), in stages by how far the work is:
 *  - a fence round the plot, the ground stripped to earth, and the materials
 *    on hand stacked on pallets — one stack a delivery not yet used;
 *  - the FOUNDATIONS, a slab rising out of the ground;
 *  - the WALLS, rising inside a SCAFFOLD that stands a little above them;
 *  - the ROOF, going on at the last.
 * FINISHED, the building it was: for the studio, a glass box on a concrete
 * plinth with a neon sign on the roof. @see game/projects, world/projects
 *
 * Drawn like the seaport — boxes in the tile plane, projected, a Graphics per
 * column of the footprint in that column's front band — and redrawn when the
 * work has moved on enough to see, not every frame. @see seaport-renderer
 */
import { Graphics } from "pixi.js";

import { idx, inBounds, type Structure } from "../grid";
import { HEIGHT_UNIT, HH, HW } from "../iso";
import { registerCustomRenderer, type RenderCtx, type StructureHandle } from "./render";

type ProjectHandle = StructureHandle & { columns: Graphics[]; drawn: string };

const FENCE = 0xc9b27a;
const FENCE_POST = 0x8a6d3b;
const EARTH = 0x8b6a4a;
const SLAB = 0xa7a39b;
const SLAB_SIDE = 0x86827a;
const SLAB_SHADE = 0x6e6a63;
const WALL_RAW = 0xbab4a8;
const WALL_RAW_SHADE = 0x938d81;
const SCAFFOLD = 0xd4a01e;
const PLANK = 0x8a6a42;
const PALLET = 0x9c7a4c;
const BRICKS = 0xb3563f;
const BRICKS_SHADE = 0x8c4030;

const GLASS = 0x6cc3c7;
const GLASS_SHADE = 0x3f8f96;
const GLASS_TOP = 0x2f3a42;
const MULLION = 0xe8f4f4;
const PARAPET = 0x4a525b;
const DOOR = 0x23292f;
const NEON = 0xff4fa3;
const NEON_DARK = 0xb02f71;

/** Heights in half steps. */
const PLINTH = 0.35;
const BODY = 3.2;
const SCAFFOLD_ABOVE = 0.7;
const INSET = 0.1;

/** What a column of a building draws with: projection, and boxes clipped to the column. */
function pen(g: Graphics, s: Structure, ctx: RenderCtx, c: number) {
  const sc = ctx.scale;
  const ground = inBounds(ctx.grid, s.x, s.y) ? ctx.grid.height[idx(ctx.grid, s.x, s.y)] : 0;
  const P = (u: number, v: number, z: number): [number, number] =>
    [(u - v) * HW * sc, (u + v) * HH * sc - (ground + z) * HEIGHT_UNIT * sc];
  const cu0 = s.x + c - 0.5, cu1 = cu0 + 1;
  const quad = (pts: [number, number][], color: number, alpha = 1) => {
    g.poly(pts.flat());
    g.fill({ color, alpha });
  };
  /**
   * A box, the part of it in this column: its top and the sides the camera
   * sees. Its lit +u side only in the column it ends in — inside the
   * building, the next column's box stands against it.
   */
  const box = (
    u0: number, v0: number, u1: number, v1: number, z0: number, z1: number,
    top: number, lit: number, shade: number,
  ) => {
    const a = Math.max(u0, cu0), b = Math.min(u1, cu1);
    if (b <= a || z1 <= z0) return;
    if (u1 <= cu1 + 1e-6) quad([P(b, v0, z1), P(b, v1, z1), P(b, v1, z0), P(b, v0, z0)], lit);
    quad([P(a, v1, z1), P(b, v1, z1), P(b, v1, z0), P(a, v1, z0)], shade);
    quad([P(a, v0, z1), P(b, v0, z1), P(b, v1, z1), P(a, v1, z1)], top);
  };
  const line = (pts: [number, number, number][], color: number, width: number) => {
    const inCol = pts.filter(([u]) => u >= cu0 - 1e-6 && u <= cu1 + 1e-6);
    if (inCol.length < 2) return;
    g.moveTo(...P(...inCol[0]));
    for (const p of inCol.slice(1)) g.lineTo(...P(...p));
    g.stroke({ color, width: Math.max(1, width * sc) });
  };
  return { P, quad, box, line, cu0, cu1, sc };
}

/** Draw column `c` of a project's building, at whatever stage it is. */
function draw(g: Graphics, s: Structure, ctx: RenderCtx, c: number): void {
  g.clear();
  const { box, line, quad, P, cu0, cu1 } = pen(g, s, ctx, c);
  const x0 = s.x - 0.5, x1 = s.x + s.w - 0.5, y0 = s.y - 0.5, y1 = s.y + s.h - 0.5;
  const b = s.build;

  if (!b) {
    drawStudio(g, s, ctx, c);
    return;
  }

  const p = Math.min(1, b.done / b.need);
  // THE PLOT: stripped to earth, inside a fence.
  quad([P(Math.max(x0, cu0), y0, 0.02), P(Math.min(x1, cu1), y0, 0.02), P(Math.min(x1, cu1), y1, 0.02), P(Math.max(x0, cu0), y1, 0.02)], EARTH);
  for (let u = x0; u <= x1 + 1e-6; u += 0.5) {
    if (u < cu0 - 1e-6 || u > cu1 + 1e-6) continue;
    for (const v of [y0, y1]) box(u - 0.02, v - 0.02, u + 0.02, v + 0.02, 0, 0.9, FENCE_POST, FENCE_POST, FENCE_POST);
  }
  for (const v of [y0, y1]) {
    line([[x0, v, 0.75], [x1, v, 0.75]], FENCE, 1.6);
    line([[x0, v, 0.35], [x1, v, 0.35]], FENCE, 1.6);
  }

  // THE FOUNDATIONS, rising to the plinth over the first quarter.
  const slab = PLINTH * Math.min(1, p / 0.25);
  if (slab > 0.01) box(x0 + INSET, y0 + INSET, x1 - INSET, y1 - INSET, 0, slab, SLAB, SLAB_SIDE, SLAB_SHADE);

  // THE WALLS, rising through the middle, in a scaffold a little above them.
  const rise = Math.max(0, Math.min(1, (p - 0.25) / 0.6));
  const wall = PLINTH + (BODY - PLINTH) * rise;
  if (rise > 0) {
    box(x0 + INSET + 0.08, y0 + INSET + 0.08, x1 - INSET - 0.08, y1 - INSET - 0.08, PLINTH, wall, WALL_RAW, WALL_RAW, WALL_RAW_SHADE);
    const top = wall + SCAFFOLD_ABOVE;
    const su0 = x0 + 0.06, su1 = x1 - 0.06, sv0 = y0 + 0.06, sv1 = y1 - 0.06;
    for (let u = su0; u <= su1 + 1e-6; u += (su1 - su0) / (s.w * 2)) {
      for (const v of [sv0, sv1]) line([[u, v, PLINTH], [u, v, top]], SCAFFOLD, 1.3);
    }
    for (let z = PLINTH + 0.9; z < top; z += 0.9) {
      for (const v of [sv0, sv1]) line([[su0, v, z], [su1, v, z]], PLANK, 2);
    }
  }
  // THE ROOF, going on at the last.
  if (p > 0.85) {
    const r = (p - 0.85) / 0.15;
    box(x0 + INSET, y0 + INSET, x0 + INSET + (x1 - x0 - 2 * INSET) * r, y1 - INSET, BODY, BODY + 0.2, PARAPET, PARAPET, PARAPET);
  }

  // MATERIALS ON HAND: a stack for every delivery not yet built into it.
  const onHand = Math.max(0, b.delivered - Math.floor(p * b.deliveries + 1e-6));
  for (let k = 0; k < Math.min(onHand, 4); k++) {
    const u = x1 - 0.35 - (k % 2) * 0.3, v = y1 - 0.3 - Math.floor(k / 2) * 0.28;
    box(u - 0.12, v - 0.1, u + 0.12, v + 0.1, 0.02, 0.12, PALLET, PALLET, PALLET);
    box(u - 0.1, v - 0.08, u + 0.1, v + 0.08, 0.12, 0.62, BRICKS, BRICKS, BRICKS_SHADE);
  }
}

/** The finished studio: a glass box on a plinth, a flat roof, a door, a neon sign. */
function drawStudio(g: Graphics, s: Structure, ctx: RenderCtx, c: number): void {
  const { box, line, quad, P } = pen(g, s, ctx, c);
  const x0 = s.x - 0.5, x1 = s.x + s.w - 0.5, y0 = s.y - 0.5, y1 = s.y + s.h - 0.5;
  box(x0 + INSET, y0 + INSET, x1 - INSET, y1 - INSET, 0, PLINTH, SLAB, SLAB_SIDE, SLAB_SHADE);
  const g0 = x0 + 0.2, g1 = x1 - 0.2, h0 = y0 + 0.2, h1 = y1 - 0.2;
  box(g0, h0, g1, h1, PLINTH, BODY, GLASS_TOP, GLASS, GLASS_SHADE);
  // Mullions on the two faces the camera sees.
  for (let u = g0 + 0.25; u < g1 - 0.05; u += 0.25) line([[u, h1, PLINTH], [u, h1, BODY]], MULLION, 1);
  for (let v = h0 + 0.25; v < h1 - 0.05; v += 0.25) line([[g1, v, PLINTH], [g1, v, BODY]], MULLION, 1);
  for (const z of [PLINTH + 1.4, BODY - 0.05]) {
    line([[g0, h1, z], [g1, h1, z]], MULLION, 1.2);
    line([[g1, h0, z], [g1, h1, z]], MULLION, 1.2);
  }
  // A parapet round the roof.
  box(g0, h0, g1, h0 + 0.06, BODY, BODY + 0.25, PARAPET, PARAPET, PARAPET);
  box(g0, h1 - 0.06, g1, h1, BODY, BODY + 0.25, PARAPET, PARAPET, PARAPET);
  // The door, in the middle of the front.
  const mid = (x0 + x1) / 2;
  if (mid >= s.x + c - 0.5 && mid <= s.x + c + 0.5) {
    quad([P(mid - 0.18, h1, PLINTH + 1.3), P(mid + 0.18, h1, PLINTH + 1.3), P(mid + 0.18, h1, PLINTH), P(mid - 0.18, h1, PLINTH)], DOOR);
  }
  // THE SIGN, standing on the roof.
  const su = x1 - 0.9;
  box(su, h0 + 0.3, su + 0.6, h0 + 0.36, BODY + 0.25, BODY + 1.35, NEON_DARK, NEON, NEON_DARK);
  line([[su + 0.1, h0 + 0.37, BODY + 0.6], [su + 0.5, h0 + 0.37, BODY + 0.6]], 0xffd1e8, 1.6);
  line([[su + 0.1, h0 + 0.37, BODY + 1.0], [su + 0.5, h0 + 0.37, BODY + 1.0]], 0xffd1e8, 1.6);
}

/** The band of a column's front cell. */
const bandOfColumn = (s: Structure, c: number) => s.x + c + s.y + s.h - 1;

/** What a drawing depends on, so it is redrawn only when that changes enough to see. */
const stateOf = (s: Structure) =>
  s.build ? `${Math.floor((s.build.done / s.build.need) * 200)}:${s.build.delivered}` : "done";

function mount(s: Structure, _def: unknown, ctx: RenderCtx): ProjectHandle {
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
    drawn: stateOf(s),
    destroy: () => { for (const g of columns) { g.parent?.removeChild(g); g.destroy(); } },
  };
}

registerCustomRenderer("project", {
  mount,
  update(h, s, _def, ctx) {
    const handle = h as ProjectHandle;
    handle.columns.forEach((g, c) => draw(g, s, ctx, c));
    handle.drawn = stateOf(s);
  },
  // GOING UP: redrawn as the work moves on, half a percent at a time.
  tick(h, s, _def, ctx) {
    const handle = h as ProjectHandle;
    const now = stateOf(s);
    if (now === handle.drawn) return;
    handle.columns.forEach((g, c) => draw(g, s, ctx, c));
    handle.drawn = now;
  },
  unmount(h) { h.destroy(); },
});
