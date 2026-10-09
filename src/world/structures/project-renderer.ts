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
export function pen(g: Graphics, s: Structure, ctx: RenderCtx, c: number) {
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

  const look = LOOKS[s.def] ?? LOOKS.studio;
  if (!b) {
    look.finished(g, s, ctx, c);
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
  const wall = PLINTH + (look.body - PLINTH) * rise;
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
    box(x0 + INSET, y0 + INSET, x0 + INSET + (x1 - x0 - 2 * INSET) * r, y1 - INSET, look.body, look.body + 0.2, PARAPET, PARAPET, PARAPET);
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

/**
 * THE FINISHED HQ: a podium of dark glass with an entrance canopy, a glass
 * tower stepped back on it banded floor by floor, and a lit sign and a mast on
 * the roof.
 */
function drawHq(g: Graphics, s: Structure, ctx: RenderCtx, c: number): void {
  const { box, line, quad, P } = pen(g, s, ctx, c);
  const x0 = s.x - 0.5, x1 = s.x + s.w - 0.5, y0 = s.y - 0.5, y1 = s.y + s.h - 0.5;
  box(x0 + INSET, y0 + INSET, x1 - INSET, y1 - INSET, 0, PLINTH, SLAB, SLAB_SIDE, SLAB_SHADE);
  // The podium: the lobby floors, dark glass.
  const p0 = x0 + 0.2, p1 = x1 - 0.2, q0 = y0 + 0.2, q1 = y1 - 0.2;
  box(p0, q0, p1, q1, PLINTH, PODIUM, PODIUM_TOP, LOBBY, LOBBY_SHADE);
  // The canopy over the front door.
  const mid = (x0 + x1) / 2;
  box(mid - 0.45, q1, mid + 0.45, q1 + 0.35, PODIUM - 0.45, PODIUM - 0.3, CANOPY, CANOPY, CANOPY_SHADE);
  if (mid >= s.x + c - 0.5 && mid <= s.x + c + 0.5) {
    quad([P(mid - 0.22, q1, PLINTH + 0.9), P(mid + 0.22, q1, PLINTH + 0.9), P(mid + 0.22, q1, PLINTH), P(mid - 0.22, q1, PLINTH)], DOOR);
  }
  // The tower, stepped back from the podium's edges.
  const t0 = x0 + 0.68, t1 = x1 - 0.68, u0 = y0 + 0.68, u1 = y1 - 0.68;
  box(t0, u0, t1, u1, PODIUM, TOWER, GLASS_TOP, TOWER_GLASS, TOWER_SHADE);
  for (let z = PODIUM + 0.9; z < TOWER - 0.2; z += 0.9) {
    line([[t0, u1, z], [t1, u1, z]], MULLION, 1.2);
    line([[t1, u0, z], [t1, u1, z]], MULLION, 1.2);
  }
  for (let u = t0 + 0.3; u < t1 - 0.05; u += 0.3) line([[u, u1, PODIUM], [u, u1, TOWER]], MULLION, 0.8);
  for (let v = u0 + 0.3; v < u1 - 0.05; v += 0.3) line([[t1, v, PODIUM], [t1, v, TOWER]], MULLION, 0.8);
  // The crown: a parapet, the company's sign, a mast.
  box(t0, u0, t1, u1, TOWER, TOWER + 0.3, PARAPET, PARAPET, PARAPET);
  box(t0 + 0.2, u1 - 0.08, t1 - 0.2, u1 - 0.02, TOWER + 0.3, TOWER + 1.1, SIGN_DARK, SIGN, SIGN);
  line([[t0 + 0.35, u1, TOWER + 0.7], [t1 - 0.35, u1, TOWER + 0.7]], 0xfff1c9, 2);
  const cx = (t0 + t1) / 2, cy = (u0 + u1) / 2;
  line([[cx, cy, TOWER + 0.3], [cx, cy, TOWER + 2.6]], PARAPET, 1.4);
}

/**
 * THE FINISHED GARAGE: a breeze-block box with a roller door in its front, a
 * flat roof lipped over the walls, and a hand-painted sign above the door.
 */
function drawGarage(g: Graphics, s: Structure, ctx: RenderCtx, c: number): void {
  const { box, line, quad, P } = pen(g, s, ctx, c);
  const x0 = s.x - 0.5, x1 = s.x + s.w - 0.5, y0 = s.y - 0.5, y1 = s.y + s.h - 0.5;
  box(x0 + INSET, y0 + INSET, x1 - INSET, y1 - INSET, 0, 0.15, SLAB, SLAB_SIDE, SLAB_SHADE);
  const w0 = x0 + 0.18, w1 = x1 - 0.18, v0 = y0 + 0.18, v1 = y1 - 0.18;
  box(w0, v0, w1, v1, 0.15, GARAGE_WALL, BLOCK_TOP, BLOCK, BLOCK_SHADE);
  // Courses of block on the two faces the camera sees.
  for (let z = 0.6; z < GARAGE_WALL; z += 0.45) {
    line([[w0, v1, z], [w1, v1, z]], BLOCK_LINE, 0.8);
    line([[w1, v0, z], [w1, v1, z]], BLOCK_LINE, 0.8);
  }
  // The roller door, ribbed, in the front.
  const d0 = w0 + 0.25, d1 = w1 - 0.25, top = GARAGE_WALL - 0.5;
  if (d1 > s.x + c - 0.5 && d0 < s.x + c + 0.5) {
    const a = Math.max(d0, s.x + c - 0.5), b = Math.min(d1, s.x + c + 0.5);
    quad([P(a, v1, top), P(b, v1, top), P(b, v1, 0.15), P(a, v1, 0.15)], DOOR_ROLL);
    for (let z = 0.35; z < top; z += 0.22) line([[a, v1, z], [b, v1, z]], DOOR_RIB, 0.8);
  }
  // A flat roof lipped over the walls, and the sign.
  box(w0 - 0.05, v0 - 0.05, w1 + 0.05, v1 + 0.05, GARAGE_WALL, GARAGE_WALL + 0.18, ROOF_FLAT, ROOF_EDGE, ROOF_EDGE);
  box(d0 + 0.1, v1 + 0.01, d1 - 0.1, v1 + 0.03, top + 0.12, GARAGE_WALL - 0.08, SIGN_BOARD, SIGN_BOARD, SIGN_BOARD);
  line([[d0 + 0.2, v1 + 0.04, top + 0.3], [d1 - 0.2, v1 + 0.04, top + 0.3]], SIGN_PAINT, 1.4);
}

/** Heights of the garage, in half steps, and its colours. */
const GARAGE_WALL = 2.4;
const BLOCK = 0xd8d2c4;
const BLOCK_SHADE = 0xb3ac9c;
const BLOCK_TOP = 0xc9c2b2;
const BLOCK_LINE = 0xa39c8c;
const DOOR_ROLL = 0x9aa3ab;
const DOOR_RIB = 0x7a838b;
const ROOF_FLAT = 0x50565d;
const ROOF_EDGE = 0x3c4147;
const SIGN_BOARD = 0x2f6d4f;
const SIGN_PAINT = 0xf3eed8;

/** Heights of the HQ, in half steps, and its colours. */
const PODIUM = 1.7;
const TOWER = 14;
const PODIUM_TOP = 0x3a4048;
const LOBBY = 0x3f6273;
const LOBBY_SHADE = 0x2c4652;
const CANOPY = 0xd9dde2;
const CANOPY_SHADE = 0xa9aeb5;
const TOWER_GLASS = 0x8fb7cf;
const TOWER_SHADE = 0x5f87a0;
const SIGN = 0xf2b43c;
const SIGN_DARK = 0xb97f17;

/**
 * THE FINISHED BOARDROOM TOWER: slim and very tall, dark bronze glass on a
 * stone podium, ribbed with gold fins, a gold crown, and a spire.
 */
function drawBoardroom(g: Graphics, s: Structure, ctx: RenderCtx, c: number): void {
  const { box, line } = pen(g, s, ctx, c);
  const x0 = s.x - 0.5, x1 = s.x + s.w - 0.5, y0 = s.y - 0.5, y1 = s.y + s.h - 0.5;
  box(x0 + INSET, y0 + INSET, x1 - INSET, y1 - INSET, 0, PLINTH, SLAB, SLAB_SIDE, SLAB_SHADE);
  box(x0 + 0.3, y0 + 0.3, x1 - 0.3, y1 - 0.3, PLINTH, BR_PODIUM, STONE_TOP, STONE, STONE_SHADE);
  const t0 = x0 + 0.8, t1 = x1 - 0.8, u0 = y0 + 0.8, u1 = y1 - 0.8;
  box(t0, u0, t1, u1, BR_PODIUM, BR_TOWER, BRONZE_TOP, BRONZE, BRONZE_SHADE);
  for (let u = t0 + 0.2; u < t1 - 0.05; u += 0.2) line([[u, u1, BR_PODIUM], [u, u1, BR_TOWER]], GOLD_FIN, 1);
  for (let v = u0 + 0.2; v < u1 - 0.05; v += 0.2) line([[t1, v, BR_PODIUM], [t1, v, BR_TOWER]], GOLD_FIN, 1);
  box(t0 - 0.03, u0 - 0.03, t1 + 0.03, u1 + 0.03, BR_TOWER, BR_TOWER + 0.5, GOLD, GOLD, GOLD_SHADE);
  box(t0 + 0.25, u0 + 0.25, t1 - 0.25, u1 - 0.25, BR_TOWER + 0.5, BR_TOWER + 1.3, BRONZE_TOP, BRONZE, BRONZE_SHADE);
  const cx = (t0 + t1) / 2, cy = (u0 + u1) / 2;
  line([[cx, cy, BR_TOWER + 1.3], [cx, cy, BR_TOWER + 4]], GOLD, 1.6);
}

/** Heights of the boardroom tower, in half steps, and its colours. */
const BR_PODIUM = 1.3;
const BR_TOWER = 19;
const STONE = 0xc9c0ad;
const STONE_SHADE = 0xa59c89;
const STONE_TOP = 0xb8af9c;
const BRONZE = 0x6b6258;
const BRONZE_SHADE = 0x4a433c;
const BRONZE_TOP = 0x3a352f;
const GOLD = 0xd8b04a;
const GOLD_SHADE = 0xa9852c;
const GOLD_FIN = 0xc9a24a;

/**
 * THE FINISHED CAMPUS: low and white, a long block across the back and a wing
 * down one side, window bands along both, gardens on the roof, and a
 * courtyard of grass and trees in the corner they make.
 */
function drawCampus(g: Graphics, s: Structure, ctx: RenderCtx, c: number): void {
  const { box, line, quad, P } = pen(g, s, ctx, c);
  const x0 = s.x - 0.5, x1 = s.x + s.w - 0.5, y0 = s.y - 0.5, y1 = s.y + s.h - 0.5;
  box(x0 + INSET, y0 + INSET, x1 - INSET, y1 - INSET, 0, PLINTH, SLAB, SLAB_SIDE, SLAB_SHADE);
  const mid = y0 + 1.9, split = x0 + 2.2;
  // The courtyard, before what stands round it.
  quad([P(Math.max(x0 + 0.2, s.x + c - 0.5), mid, PLINTH + 0.02), P(Math.min(split, s.x + c + 0.5), mid, PLINTH + 0.02),
    P(Math.min(split, s.x + c + 0.5), y1 - 0.2, PLINTH + 0.02), P(Math.max(x0 + 0.2, s.x + c - 0.5), y1 - 0.2, PLINTH + 0.02)], LAWN);
  // The long block across the back, and the wing down the side.
  const blocks: [number, number, number, number, number][] = [
    [x0 + 0.2, y0 + 0.2, x1 - 0.2, mid, CAMPUS_TALL],
    [split, mid, x1 - 0.2, y1 - 0.2, CAMPUS_LOW],
  ];
  for (const [a0, b0, a1, b1, h] of blocks) {
    box(a0, b0, a1, b1, PLINTH, h, ROOF_GARDEN, WHITE_PANEL, WHITE_SHADE);
    for (let z = PLINTH + 0.7; z < h - 0.3; z += 1.1) {
      line([[a0, b1, z], [a1, b1, z]], CAMPUS_GLASS, 3);
      line([[a1, b0, z], [a1, b1, z]], CAMPUS_GLASS, 3);
    }
  }
  // Trees in the courtyard.
  for (const [tu, tv] of [[x0 + 0.8, y1 - 0.8], [x0 + 1.6, y1 - 1.3]]) {
    box(tu - 0.04, tv - 0.04, tu + 0.04, tv + 0.04, PLINTH, PLINTH + 1, TRUNK, TRUNK, TRUNK);
    box(tu - 0.28, tv - 0.28, tu + 0.28, tv + 0.28, PLINTH + 1, PLINTH + 2.1, LEAVES_TOP, LEAVES, LEAVES_SHADE);
  }
}

/** Heights of the campus, in half steps, and its colours. */
const CAMPUS_TALL = 4.6;
const CAMPUS_LOW = 3.2;
const WHITE_PANEL = 0xeeeee8;
const WHITE_SHADE = 0xc8c8c0;
const ROOF_GARDEN = 0x7fae5c;
const CAMPUS_GLASS = 0x6c9fb8;
const LAWN = 0x8cc46a;
const TRUNK = 0x6d4a2a;
const LEAVES = 0x5c9a46;
const LEAVES_SHADE = 0x467a35;
const LEAVES_TOP = 0x6db254;

/**
 * Each project's building: how tall its walls go up while it is a site, and
 * how it is drawn finished.
 */
const LOOKS: Record<string, { body: number; finished: typeof drawStudio }> = {
  garage: { body: GARAGE_WALL, finished: drawGarage },
  studio: { body: BODY, finished: drawStudio },
  hq: { body: TOWER, finished: drawHq },
  // Offices, drawn as the buildings that first opened their kind of work.
  "office-intern": { body: GARAGE_WALL, finished: drawGarage },
  "office-vibe": { body: BODY, finished: drawStudio },
  "office-10x": { body: TOWER, finished: drawHq },
  boardroom: { body: BR_TOWER, finished: drawBoardroom },
  campus: { body: CAMPUS_TALL, finished: drawCampus },
};

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
