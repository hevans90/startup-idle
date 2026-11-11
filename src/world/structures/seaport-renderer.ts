/**
 * World v2 — a seaport, drawn.
 *
 * There is no seaport in the art set, so one is drawn the way the old boat
 * was: boxes worked out in the tile plane and projected. @see plans/seaports.md §4
 *
 * A PORT IS A ROW OF COLUMNS, one a tile of quay wide: a SHED, or a YARD
 * behind a berth. A yard carries what its berth is FITTED with — a derrick,
 * a slewing crane, a gantry on its portal, a ferry's ramp, a pontoon — so a
 * port's fittings can be read off the map. Along the whole of it a stone quay
 * with fenders and bollards down to the water; at its back a gate; over it a
 * harbour master's tower with a beacon, and a floodlight.
 *
 * WORKED OUT FACING THE WATER, then turned: everything is placed by how far
 * ALONG the quay it is and how far OUT from the back toward the water, and
 * `L` turns that into the tile plane for the side the quay is on.
 * @see Structure.facing
 *
 * WHAT MOVES, MOVES BY TRANSFORM. The static picture is a Graphics per
 * column, in the band of its own front cell, redrawn only when the port or
 * its yard's fill changes. A crane's trolley, its rope and its load, the
 * lamps and the lights are their own small nodes, moved, stretched, tinted
 * and faded each frame — nothing is shown, hidden, reparented or redrawn
 * while a port works, so no draw list is rebuilt. @see render-group-rebuilds
 */
import { Container, Graphics, Sprite } from "pixi.js";

import { NEIGHBOUR } from "../../iso/dir";
import { bakedPeople, peopleLoaded, peopleSprites, posePerson } from "../agents/people/people-sheet";
import { fitOf, type FitId } from "../boats/fittings";
import { lands } from "../boats/yard";
import { idx, inBounds, type Structure } from "../grid";
import { HEIGHT_UNIT, HH, HW } from "../iso";
import { portLife, type BerthState } from "./port-life";
import { registerCustomRenderer, type RenderCtx, type StructureHandle } from "./render";

const STONE = 0xa29d93, STONE_SIDE = 0x7d786f, STONE_SHADE = 0x625e57;
const PLANK = 0x8b6a45;
const WALL = 0xd2b48c, WALL_SHADE = 0xae9068, ROOF = 0xb5523b, ROOF_SHADE = 0x8e3d2b, DOOR = 0x5a3d22;
const CRANE = 0xe0b030, CRANE_SHADE = 0xa98220;
const GANTRY = 0x2f6ea8, GANTRY_SHADE = 0x1f4c78;
const IRON = 0x33373c, FENDER = 0x1d1f22, TIMBER = 0x9a7446, TIMBER_SHADE = 0x6f5231;
const TOWER = 0xe8e2d2, TOWER_SHADE = 0xb9b2a0, GLASS = 0x29384a;
const BOXES = [0x3f6e9c, 0xb8463a, 0x2f7d5b, 0xd9a23a, 0xc9c4b8, 0x9c6b3a];
const BOX_SHADE = 0.72;
const ROPE = 0x2b2b2b;
const LAMP: Record<BerthState, number> = { free: 0x5dff8a, working: 0xffc247, blocked: 0xff5a4a };

/** Heights, in half steps over the ground. */
const QUAY = 0.6, WALLS = 3, RIDGE = 4.6, MAST = 6.5;
/** A slewing crane's jib and a gantry's boom, and how far out over the water each reaches, tiles. */
const JIB_Z = 8, BOOM_Z = 9.5, REACH = 0.6;
/** Seconds a crane takes over one lift, and where in a lift it waits: back over the yard, hook up, empty. */
const LIFT = 5;
const PARKED = 0.86;
/** How high a ship's cargo stands over its waterline, by its class, half steps. */
const DECK = [0.9, 1.5, 2.6];

/** What stands in each column of a port this many tiles long: its berths' yards, and a shed. @see berthsAlong */
const LAYOUT: Record<number, readonly ("shed" | "yard")[]> = {
  2: ["yard", "shed"],
  3: ["yard", "shed", "yard"],
  4: ["yard", "shed", "yard", "yard"],
};
const layoutOf = (n: number) => LAYOUT[n] ?? Array.from({ length: n }, (_, k) => (k % 2 ? "shed" : "yard"));

const shade = (c: number, k = BOX_SHADE) => (((c >> 16) * k) << 16) | ((((c >> 8) & 255) * k) << 8) | ((c & 255) * k);

/** How a port lies, for everything that draws on it. */
function frame(s: Structure, ctx: RenderCtx) {
  const sc = ctx.scale;
  const ground = inBounds(ctx.grid, s.x, s.y) ? ctx.grid.height[idx(ctx.grid, s.x, s.y)] : 0;
  /** A point in the tile plane, `z` half steps over the ground, on the screen. */
  const P = (u: number, v: number, z: number): [number, number] =>
    [(u - v) * HW * sc, (u + v) * HH * sc - (ground + z) * HEIGHT_UNIT * sc];
  const [fx, fy] = NEIGHBOUR[s.facing ?? "W"];
  const alongU = fx === 0;
  const depth = alongU ? s.h : s.w, length = alongU ? s.w : s.h;
  /** Along the quay and out toward the water, in the tile plane. */
  const L = (a: number, d: number): [number, number] => alongU
    ? [s.x - 0.5 + a, fy > 0 ? s.y - 0.5 + d : s.y + s.h - 0.5 - d]
    : [fx > 0 ? s.x - 0.5 + d : s.x + s.w - 0.5 - d, s.y - 0.5 + a];
  const Q = (a: number, d: number, z: number) => P(...L(a, d), z);
  const kinds = layoutOf(length);
  /** Which berth a column's yard is behind, or −1: the yards in order are the berths in order. */
  const berthOf = (c: number) => (kinds[c] === "yard" ? kinds.slice(0, c).filter((k) => k === "yard").length : -1);
  return { sc, P, L, Q, depth, length, kinds, berthOf, alongU, away: fx + fy < 0 };
}

/** Draw column `c` of a port — one tile of its quay, across its whole depth — with its yard `fill` full. */
function draw(g: Graphics, s: Structure, ctx: RenderCtx, c: number, fill: number): void {
  const { sc, P, L, Q, depth, length, kinds, berthOf, alongU, away } = frame(s, ctx);
  const quad = (pts: [number, number][], color: number) => { g.poly(pts.flat()); g.fill({ color }); };
  const rect = (a0: number, d0: number, a1: number, d1: number) => {
    const [ua, va] = L(a0, d0), [ub, vb] = L(a1, d1);
    return [Math.min(ua, ub), Math.min(va, vb), Math.max(ua, ub), Math.max(va, vb)] as const;
  };
  /** A box: its top and the sides the camera sees, which face +u and +v. The +u side is the lit one. */
  const box = (a0: number, d0: number, a1: number, d1: number, z0: number, z1: number, top: number, lit: number, dark: number) => {
    const [u0, v0, u1, v1] = rect(a0, d0, a1, d1);
    quad([P(u1, v0, z1), P(u1, v1, z1), P(u1, v1, z0), P(u1, v0, z0)], lit);
    quad([P(u0, v1, z1), P(u1, v1, z1), P(u1, v1, z0), P(u0, v1, z0)], dark);
    quad([P(u0, v0, z1), P(u1, v0, z1), P(u1, v1, z1), P(u0, v1, z1)], top);
  };
  const line = (a: [number, number], b: [number, number], color: number, width: number, alpha = 1) => {
    g.moveTo(...a).lineTo(...b);
    g.stroke({ color, width: Math.max(1, width * sc), alpha });
  };

  g.clear();
  const last = c === length - 1;
  const a0 = c, a1 = c + 1;

  // THE QUAY under this column, down past the water, and a kerb along its outside edges.
  box(a0, 0, a1, depth, -1.6, QUAY, STONE, STONE_SIDE, STONE_SHADE);
  g.moveTo(...Q(a0, 0, QUAY)).lineTo(...Q(a1, 0, QUAY));
  g.moveTo(...Q(a0, depth, QUAY)).lineTo(...Q(a1, depth, QUAY));
  if (c === 0) g.moveTo(...Q(a0, 0, QUAY)).lineTo(...Q(a0, depth, QUAY));
  if (last) g.moveTo(...Q(a1, 0, QUAY)).lineTo(...Q(a1, depth, QUAY));
  g.stroke({ color: STONE_SHADE, width: Math.max(1, 1.4 * sc), alpha: 0.8 });
  // FENDERS down its water face, where the camera sees that face; and a ladder.
  if (!away) {
    for (const t of [0.2, 0.5, 0.8]) line(Q(a0 + t, depth, QUAY - 0.15), Q(a0 + t, depth, -0.9), FENDER, 3.2);
    if (c === 0) for (const t of [0.34, 0.4]) line(Q(a0 + t, depth, QUAY), Q(a0 + t, depth, -1.2), IRON, 0.9);
  }
  // BOLLARDS along its edge.
  for (const t of [0.25, 0.75]) box(a0 + t - 0.04, depth - 0.14, a0 + t + 0.04, depth - 0.06, QUAY, QUAY + 0.35, IRON, IRON, FENDER);

  if (kinds[c] === "shed") {
    // A SHED: walls, a door, a roof whose ridge runs out toward the water.
    const [wu0, wv0, wu1, wv1] = rect(a0 + 0.08, 0.1, a0 + 0.95, depth - 0.45);
    const top = QUAY + WALLS, ridge = top + (RIDGE - WALLS), eave = 0.08;
    quad([P(wu1, wv0, top), P(wu1, wv1, top), P(wu1, wv1, QUAY), P(wu1, wv0, QUAY)], WALL);
    quad([P(wu0, wv1, top), P(wu1, wv1, top), P(wu1, wv1, QUAY), P(wu0, wv1, QUAY)], WALL_SHADE);
    // EACH SLOPE IS ONE PLANE, through the ridge and the wall's top edge, and
    // the eave carries on down it; the roof ends FLUSH with the gable, since an
    // overhang there is seen from underneath at this angle.
    if (alongU) {
      const um = (wu0 + wu1) / 2, low = top - (eave * (ridge - top)) / (um - wu0);
      quad([P(wu0, wv1, top), P(wu1, wv1, top), P(um, wv1, ridge)], WALL_SHADE);
      quad([P(wu0 - eave, wv0, low), P(um, wv0, ridge), P(um, wv1, ridge), P(wu0 - eave, wv1, low)], ROOF_SHADE);
      quad([P(um, wv0, ridge), P(wu1 + eave, wv0, low), P(wu1 + eave, wv1, low), P(um, wv1, ridge)], ROOF);
      const dv = (wv0 + wv1) / 2;
      quad([P(wu1, dv - 0.22, QUAY + 1.8), P(wu1, dv + 0.22, QUAY + 1.8), P(wu1, dv + 0.22, QUAY), P(wu1, dv - 0.22, QUAY)], DOOR);
    } else {
      const vm = (wv0 + wv1) / 2, low = top - (eave * (ridge - top)) / (vm - wv0);
      quad([P(wu1, wv0, top), P(wu1, wv1, top), P(wu1, vm, ridge)], WALL);
      quad([P(wu0, wv0 - eave, low), P(wu0, vm, ridge), P(wu1, vm, ridge), P(wu1, wv0 - eave, low)], ROOF);
      quad([P(wu0, vm, ridge), P(wu0, wv1 + eave, low), P(wu1, wv1 + eave, low), P(wu1, vm, ridge)], ROOF_SHADE);
      const du = (wu0 + wu1) / 2;
      quad([P(du - 0.22, wv1, QUAY + 1.8), P(du + 0.22, wv1, QUAY + 1.8), P(du + 0.22, wv1, QUAY), P(du - 0.22, wv1, QUAY)], DOOR);
    }
    // THE HARBOUR MASTER'S TOWER by the water, glazed round its top; its beacon is lit apart.
    box(a0 + 0.36, depth - 0.4, a0 + 0.64, depth - 0.14, QUAY, QUAY + 5.4, TOWER, TOWER, TOWER_SHADE);
    box(a0 + 0.32, depth - 0.44, a0 + 0.68, depth - 0.1, QUAY + 5.4, QUAY + 6.5, GLASS, GLASS, shade(GLASS));
    box(a0 + 0.3, depth - 0.46, a0 + 0.7, depth - 0.08, QUAY + 6.5, QUAY + 6.7, TOWER, TOWER, TOWER_SHADE);
    // THE GATE at its back: two posts, and a striped bar across.
    box(a0 + 0.02, 0, a0 + 0.08, 0.06, QUAY, QUAY + 1.2, IRON, IRON, FENDER);
    box(a0 + 0.92, 0, a0 + 0.98, 0.06, QUAY, QUAY + 1.2, IRON, IRON, FENDER);
    line(Q(a0 + 0.05, 0.03, QUAY + 1.0), Q(a0 + 0.95, 0.03, QUAY + 1.0), 0xf2f2f2, 2.2);
    for (const t of [0.2, 0.5, 0.8]) line(Q(a0 + t - 0.07, 0.03, QUAY + 1.0), Q(a0 + t + 0.07, 0.03, QUAY + 1.0), 0xd8432f, 2.2);
    return;
  }

  // A YARD: planking; what has been landed, stacked at the back; and what its berth is fitted with.
  const fit: FitId = fitOf(s, berthOf(c)).id;
  for (let k = 1; k < 8; k++) line(Q(a0 + 0.05, (depth * k) / 8, QUAY), Q(a1 - 0.05, (depth * k) / 8, QUAY), PLANK, 1.1, 0.55);
  /** A box of cargo, coloured by where it stands. */
  const cargo = (a: number, d: number, tier: number, n: number, w = 0.3, l = 0.42, h = 0.9) => {
    const col = BOXES[(c * 7 + n * 3 + tier) % BOXES.length];
    box(a, d, a + w, d + l, QUAY + tier * h, QUAY + (tier + 1) * h - 0.04, col, col, shade(col));
  };
  // THE STACKS: as high as the yard is full, so the port's state reads from across the map.
  const stacks = () => {
    if (!lands(fit)) { cargo(a0 + 0.12, 0.2, 0, 0); cargo(a0 + 0.5, 0.2, 0, 1); cargo(a0 + 0.3, 0.24, 1, 2); return; }
    const boxes = Math.round(fill * 12);
    // Far stacks first, so the near ones draw over them.
    const spots = [[0.1, 0.12], [0.55, 0.12], [0.1, 0.62], [0.55, 0.62]];
    if (away) spots.reverse();
    spots.forEach(([a, d], k) => { for (let t = 0; t * 4 + k < boxes && t < 3; t++) cargo(a0 + a, d, t, k + t); });
  };
  /** A lattice mast: a box, and cross-bracing up its lit face. */
  const mast = (a: number, d: number, half: number, z1: number, col: number, dark: number) => {
    box(a - half, d - half, a + half, d + half, QUAY, z1, col, col, dark);
  };

  const mid = a0 + 0.5;
  const gear = () => {
    if (fit === "trade") {
      // A DERRICK: a mast and a jib out over the edge of the quay. Its hook is apart.
      mast(mid, depth - 0.85, 0.07, QUAY + MAST, CRANE, CRANE_SHADE);
      const jib = Q(mid, depth + 0.35, QUAY + MAST - 0.4);
      g.moveTo(...Q(mid, depth - 1.15, QUAY + MAST - 0.2)).lineTo(...Q(mid, depth - 0.85, QUAY + MAST)).lineTo(...jib);
      g.stroke({ color: CRANE_SHADE, width: Math.max(1, 2.4 * sc) });
    } else if (fit === "crane" || fit === "hardware") {
      // A SLEWING CRANE: a tower, a cab, a jib out over the berth and a tail with its weight behind. Its trolley is apart.
      const col = fit === "hardware" ? 0x8a8f98 : CRANE, dark = fit === "hardware" ? 0x5d626a : CRANE_SHADE;
      mast(mid, depth - 0.5, 0.09, QUAY + JIB_Z, col, dark);
      box(mid - 0.16, depth - 0.66, mid + 0.16, depth - 0.34, QUAY + JIB_Z - 1.1, QUAY + JIB_Z, 0xf2efe6, 0xf2efe6, 0xc9c3b4);
      line(Q(mid, depth - 1.25, QUAY + JIB_Z), Q(mid, depth + REACH, QUAY + JIB_Z), dark, 3);
      line(Q(mid, depth - 0.5, QUAY + JIB_Z + 1.3), Q(mid, depth + REACH, QUAY + JIB_Z), dark, 1.2);
      line(Q(mid, depth - 0.5, QUAY + JIB_Z + 1.3), Q(mid, depth - 1.25, QUAY + JIB_Z), dark, 1.2);
      line(Q(mid, depth - 0.5, QUAY + JIB_Z), Q(mid, depth - 0.5, QUAY + JIB_Z + 1.3), dark, 2);
      box(mid - 0.1, depth - 1.32, mid + 0.1, depth - 1.12, QUAY + JIB_Z - 0.9, QUAY + JIB_Z - 0.1, IRON, IRON, FENDER);
    } else if (fit === "gantry") {
      // A GANTRY on its portal, astride the quay's edge: four legs, a beam across, a boom out over the ship. Its trolley is apart.
      for (const [a, d] of [[a0 + 0.12, depth - 0.95], [a0 + 0.88, depth - 0.95], [a0 + 0.12, depth - 0.12], [a0 + 0.88, depth - 0.12]]) mast(a, d, 0.05, QUAY + BOOM_Z, GANTRY, GANTRY_SHADE);
      box(a0 + 0.07, depth - 1.0, a0 + 0.93, depth - 0.07, QUAY + BOOM_Z, QUAY + BOOM_Z + 0.5, GANTRY, GANTRY, GANTRY_SHADE);
      line(Q(mid, depth - 1.4, QUAY + BOOM_Z + 0.25), Q(mid, depth + REACH + 0.25, QUAY + BOOM_Z + 0.25), GANTRY_SHADE, 3.4);
      line(Q(mid, depth - 0.5, QUAY + BOOM_Z + 2.2), Q(mid, depth + REACH + 0.25, QUAY + BOOM_Z + 0.25), GANTRY_SHADE, 1.2);
      line(Q(mid, depth - 0.5, QUAY + BOOM_Z + 0.5), Q(mid, depth - 0.5, QUAY + BOOM_Z + 2.2), GANTRY_SHADE, 2);
      // Rails along the quay under it.
      line(Q(a0, depth - 0.95, QUAY + 0.02), Q(a1, depth - 0.95, QUAY + 0.02), IRON, 1);
      line(Q(a0, depth - 0.12, QUAY + 0.02), Q(a1, depth - 0.12, QUAY + 0.02), IRON, 1);
    } else if (fit === "ferry") {
      // A FERRY'S RAMP down to the water, a ticket hut, a striped post either side.
      quad([Q(a0 + 0.2, depth, QUAY), Q(a0 + 0.8, depth, QUAY), Q(a0 + 0.8, depth + 0.45, -0.7), Q(a0 + 0.2, depth + 0.45, -0.7)], 0x4a4f55);
      for (const t of [0.35, 0.5, 0.65]) line(Q(a0 + t, depth + 0.05, QUAY - 0.1), Q(a0 + t, depth + 0.4, -0.6), 0xf2d24a, 0.8, 0.8);
      box(a0 + 0.06, depth - 0.75, a0 + 0.42, depth - 0.35, QUAY, QUAY + 1.9, 0xf2efe6, 0xf2efe6, 0xc9c3b4);
      box(a0 + 0.03, depth - 0.78, a0 + 0.45, depth - 0.32, QUAY + 1.9, QUAY + 2.05, 0x2f5f8f, 0x2f5f8f, shade(0x2f5f8f));
      for (const t of [0.16, 0.84]) box(a0 + t - 0.03, depth - 0.1, a0 + t + 0.03, depth - 0.04, QUAY, QUAY + 1.4, 0xd8432f, 0xd8432f, shade(0xd8432f));
    } else {
      // A PONTOON: a float out on the water, a gangway down to it, mooring posts.
      box(a0 + 0.1, depth + 0.05, a0 + 0.9, depth + 0.5, -1.0, -0.6, TIMBER, TIMBER, TIMBER_SHADE);
      quad([Q(a0 + 0.42, depth - 0.05, QUAY), Q(a0 + 0.58, depth - 0.05, QUAY), Q(a0 + 0.58, depth + 0.2, -0.6), Q(a0 + 0.42, depth + 0.2, -0.6)], TIMBER_SHADE);
      for (const t of [0.14, 0.86]) box(a0 + t - 0.03, depth + 0.42, a0 + t + 0.03, depth + 0.48, -1.0, 0.5, 0xf2efe6, 0xf2efe6, 0xc9c3b4);
      // A flagstaff ashore, and a pennant.
      line(Q(a0 + 0.85, depth - 0.3, QUAY), Q(a0 + 0.85, depth - 0.3, QUAY + 4.5), 0xf2efe6, 1.2);
      quad([Q(a0 + 0.85, depth - 0.3, QUAY + 4.5), Q(a0 + 0.85, depth - 0.3, QUAY + 3.9), Q(a0 + 0.62, depth - 0.3, QUAY + 4.2)], 0x2f5f8f);
    }
  };
  // What is nearer the camera is drawn later: the stacks are at the back, the gear by the water.
  if (away) { gear(); stacks(); } else { stacks(); gear(); }
  // A FLOODLIGHT's mast at the back of the last column; its light is apart.
  if (last) line(Q(a1 - 0.08, 0.08, QUAY), Q(a1 - 0.08, 0.08, QUAY + 7), IRON, 1.4);
}

/** What moves on one yard: a crane's trolley, rope and load, where it has one; its berth's lamp; a worker. */
type Rig = {
  c: number;
  berth: number;
  lamp: Graphics;
  trolley: Graphics | null;
  rope: Graphics | null;
  load: Graphics | null;
  hand: Sprite[];
  handKey: string;
  /** Where in its lift the crane is, 0–1, and the lamp's colour as last set. */
  phase: number;
  state: BerthState | "";
  /** Where its hook is now — how far out, and how high — eased toward where the lift wants it. */
  d: number;
  z: number;
};

type SeaportHandle = StructureHandle & {
  columns: Graphics[];
  rigs: Rig[];
  beacon: Graphics | null;
  flood: Graphics | null;
  /** The yard's fill and the fittings the static picture was drawn for. */
  drawnFor: string;
  t: number;
};

/** The band of a column's front cell: the nearest the camera of the tiles it stands on. */
const bandOfColumn = (s: Structure, c: number) =>
  NEIGHBOUR[s.facing ?? "W"][0] === 0 ? s.x + c + s.y + s.h - 1 : s.x + s.w - 1 + s.y + c;

const fitsKey = (s: Structure, fill: number) => `${(s.fit ?? []).join(",")}|${Math.round(fill * 12)}|${s.x},${s.y},${s.w},${s.h},${s.facing}`;

/** Draw the static picture, for the yard as it stands. */
function redraw(h: SeaportHandle, s: Structure, ctx: RenderCtx): void {
  const fill = portLife(s.id)?.yard ?? 0;
  h.columns.forEach((g, c) => draw(g, s, ctx, c, fill));
  h.drawnFor = fitsKey(s, fill);
}

const WORKER = [0xe0b090, 0x2b3a55, 0xf2a21a, 0x3a2a1a, 0xffffff];

function mount(s: Structure, _def: unknown, ctx: RenderCtx): SeaportHandle {
  const columns: Graphics[] = [], rigs: Rig[] = [];
  const f = frame(s, ctx);
  const bandFor = (c: number) => ctx.bands.structureOf[Math.max(0, Math.min(ctx.bands.structureOf.length - 1, bandOfColumn(s, c)))];
  // A hologram of a port — one not there yet — is its static picture alone.
  const real = s.id >= 0;
  let beacon: Graphics | null = null, flood: Graphics | null = null;
  const node = (c: number, make: (g: Graphics) => void, blend = false) => {
    const g = new Graphics();
    g.eventMode = "none";
    make(g);
    if (blend) g.blendMode = "add";
    bandFor(c).addChild(g);
    return g;
  };
  for (let c = 0; c < f.length; c++) {
    const g = new Graphics();
    g.eventMode = "none";
    bandFor(c).addChild(g);
    columns.push(g);
    if (!real) continue;
    const sc = f.sc;
    if (f.kinds[c] === "shed" && !beacon) {
      beacon = node(c, (b) => { b.circle(0, 0, 3.2 * sc).fill({ color: 0xff5a4a }); b.circle(0, 0, 9 * sc).fill({ color: 0xff5a4a, alpha: 0.25 }); }, true);
      beacon.position.set(...f.Q(c + 0.5, f.depth - 0.27, QUAY + 7.1));
    }
    if (c === f.length - 1) {
      flood = node(c, (b) => { b.circle(0, 0, 4 * sc).fill({ color: 0xfff1c9 }); b.ellipse(0, 26 * sc, 70 * sc, 34 * sc).fill({ color: 0xfff1c9, alpha: 0.16 }); }, true);
      flood.position.set(...f.Q(c + 1 - 0.08, 0.08, QUAY + 7));
      flood.alpha = 0;
    }
    if (f.kinds[c] !== "yard") continue;
    const fit = fitOf(s, f.berthOf(c)).id;
    const crane = fit === "trade" || fit === "crane" || fit === "hardware" || fit === "gantry";
    const rig: Rig = {
      c, berth: f.berthOf(c), phase: PARKED, state: "", handKey: "", hand: [], d: f.depth - 1, z: QUAY + 4,
      trolley: crane ? node(c, (t) => { t.rect(-4 * sc, -2 * sc, 8 * sc, 4 * sc).fill({ color: IRON }); }) : null,
      // A rope a unit long, stretched to the hoist: a transform, not a redraw.
      rope: crane ? node(c, (r) => { r.rect(-0.9 * sc, 0, Math.max(1.5, 1.8 * sc), 1).fill({ color: ROPE }); }) : null,
      load: crane ? node(c, (l) => {
        const col = BOXES[(c + s.id) % BOXES.length], w = (fit === "gantry" ? 15 : fit === "trade" ? 6 : 9) * sc, hh = (fit === "trade" ? 5 : 7) * sc;
        l.rect(-w / 2, 0, w, hh).fill({ color: col });
        l.rect(-w / 2, hh * 0.55, w, hh * 0.45).fill({ color: shade(col) });
      }) : null,
      lamp: node(c, (l) => { l.circle(0, 0, 2.6 * sc).fill({ color: 0xffffff }); l.circle(0, 0, 6 * sc).fill({ color: 0xffffff, alpha: 0.22 }); }),
    };
    rig.lamp.position.set(...f.Q(c + 0.5, f.depth - 0.03, QUAY + 0.75));
    // A DOCKER by the berth, from the people sheet once it is in.
    const P = bakedPeople() ? peopleLoaded() : null;
    if (bakedPeople() && !P) void peopleSprites();
    if (P && P.figures.has("builder")) {
      rig.hand = WORKER.map((tint) => { const sp = new Sprite(); sp.eventMode = "none"; sp.tint = tint; bandFor(c).addChild(sp); return sp; });
      const [x, y] = f.Q(c + 0.72, f.depth - 0.28, QUAY);
      for (const sp of rig.hand) sp.position.set(x, y);
    }
    rigs.push(rig);
  }
  const h: SeaportHandle = {
    columns, rigs, beacon, flood, drawnFor: "", t: 0,
    destroy: () => {
      const all: (Container | null)[] = [...columns, beacon, flood, ...rigs.flatMap((r) => [r.lamp, r.trolley, r.rope, r.load, ...r.hand])];
      for (const n of all) { if (!n) continue; n.parent?.removeChild(n); n.destroy(); }
    },
  };
  redraw(h, s, ctx);
  tick(h, s, _def, ctx, 0);
  return h;
}

const ease = (t: number) => t * t * (3 - 2 * t);
const span = (p: number, a: number, b: number) => Math.min(1, Math.max(0, (p - a) / (b - a)));

/**
 * A frame of a port at work: each crane's lift — out over the ship, down,
 * up with a box, back over the yard, down, up empty — while its berth has a
 * ship alongside, and parked over the yard while it has none; the lamps, the
 * beacon and the floodlight. Transforms, tints and alphas only.
 */
function tick(hh: StructureHandle, s: Structure, _def: unknown, ctx: RenderCtx, dt: number): void {
  const h = hh as SeaportHandle;
  if (!h.rigs.length && !h.beacon) return;
  h.t += dt;
  const life = portLife(s.id);
  // The yard's stacks, redrawn when they change by a box; never by the frame.
  if (life && fitsKey(s, life.yard) !== h.drawnFor) redraw(h, s, ctx);
  const f = frame(s, ctx);
  const night = life?.night ?? 0;
  if (h.beacon) h.beacon.alpha = 0.35 + 0.65 * (Math.sin(h.t * 3) > 0.6 ? 1 : 0.15) * (0.4 + 0.6 * night);
  if (h.flood) h.flood.alpha = Math.min(1, Math.max(0, (night - 0.3) / 0.3));
  const P = peopleLoaded();
  for (const r of h.rigs) {
    const state: BerthState = life?.berths[r.berth]?.state ?? "free";
    if (state !== r.state) { r.lamp.tint = LAMP[state]; r.state = state; }
    r.lamp.alpha = state === "working" ? 0.75 + 0.25 * Math.sin(h.t * 5 + r.c) : 0.9;
    const working = state === "working";
    if (r.hand.length && P) {
      r.handKey = posePerson(r.hand, P, "builder", working ? "work" : "stand", f.alongU ? Math.PI / 2 : 0, h.t * 6 + r.c, ctx.scale, 1, r.handKey);
    }
    if (!r.trolley || !r.rope || !r.load) continue;
    const ship = life?.berths[r.berth]?.ship;
    const lifting = working && !!ship?.cargo;
    // A LIFT: down to where the cargo is, up with a box, across, down, up
    // empty, and back. While its berth has a ship it goes round; with none it
    // finishes the lift in hand and parks over the yard, hook up.
    // Slowed by a full yard as the call is. @see yardSlows
    if (lifting) r.phase = (r.phase + dt / (LIFT * (1 + (life?.yard ?? 0)))) % 1;
    else if (r.phase < PARKED) r.phase = Math.min(PARKED, r.phase + dt / LIFT);
    else if (r.phase > PARKED) r.phase = (r.phase + dt / LIFT) % 1;
    const p = r.phase;
    const fit = fitOf(s, r.berth).id;
    const jibZ = QUAY + (fit === "gantry" ? BOOM_Z : fit === "trade" ? MAST - 0.5 : JIB_Z) - 0.1;
    const reach = f.depth + (fit === "gantry" ? REACH + 0.25 : fit === "trade" ? 0.35 : REACH);
    // OVER THE YARD, on its stacks; and OVER THE SHIP, on its deck — the ship
    // where it really lies, as far out as the jib reaches.
    const yard = { d: f.depth - (fit === "trade" ? 0.75 : 1.2), z: QUAY + 0.3 + 2.4 * (life?.yard ?? 0) };
    const [fx, fy] = NEIGHBOUR[s.facing ?? "W"];
    const outOf = (x: number, y: number) => (f.alongU ? (fy > 0 ? y - (s.y - 0.5) : s.y + s.h - 0.5 - y) : fx > 0 ? x - (s.x - 0.5) : s.x + s.w - 0.5 - x);
    const ground = inBounds(ctx.grid, s.x, s.y) ? ctx.grid.height[idx(ctx.grid, s.x, s.y)] : 0;
    const deck = ship
      ? { d: Math.min(reach, Math.max(f.depth + 0.15, outOf(ship.x, ship.y))), z: ship.z - ground + DECK[ship.cls] }
      : { d: reach, z: 0.6 };
    // Unloading, the cargo is at the ship; loading, at the yard. Parked, it is as if unloading: back over the yard.
    const [from, to] = lifting && ship?.loading ? [yard, deck] : [deck, yard];
    const across = ease(span(p, 0.3, 0.55)) - ease(span(p, 0.85, 1));
    const downFrom = ease(span(p, 0, 0.15)) - ease(span(p, 0.15, 0.3));
    const downTo = ease(span(p, 0.55, 0.7)) - ease(span(p, 0.7, 0.85));
    const up = jibZ - 0.9;
    const wantD = from.d + (to.d - from.d) * across;
    const wantZ = up - downFrom * Math.max(0, up - from.z) - downTo * Math.max(0, up - to.z);
    // EASED toward it, so a ship arriving, or a turn from unloading to loading, never jumps the hook.
    const k = dt > 0 ? Math.min(1, dt * 5) : 1;
    r.d += (wantD - r.d) * k;
    r.z += (wantZ - r.z) * k;
    const [tx, ty] = f.Q(r.c + 0.5, r.d, jibZ);
    const hoist = Math.max(1, (jibZ - r.z) * HEIGHT_UNIT * ctx.scale);
    r.trolley.position.set(tx, ty);
    r.rope.position.set(tx, ty);
    r.rope.scale.y = hoist;
    r.load.position.set(tx, ty + hoist);
    // On the hook from where it is picked up to where it is set down; by alpha, so nothing is shown or hidden.
    r.load.alpha = lifting && p > 0.15 && p < 0.7 ? 1 : 0;
    // A derrick has no trolley to see: its hook runs from the jib.
    r.trolley.alpha = fit === "trade" ? 0 : 1;
  }
}

registerCustomRenderer("seaport", {
  mount,
  update(h, s, _def, ctx) {
    // A port refitted has other gear: its moving parts are made again with it.
    const was = h as SeaportHandle;
    const fits = (s.fit ?? []).join(",");
    if (was.drawnFor.split("|")[0] !== fits && was.rigs.length) {
      const fresh = mount(s, _def, ctx);
      was.destroy();
      Object.assign(was, fresh);
      return;
    }
    redraw(was, s, ctx);
    tick(was, s, _def, ctx, 0);
  },
  tick,
  unmount(h) { h.destroy(); },
});
