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
import { Container, Graphics, Matrix, Sprite } from "pixi.js";

import { NEIGHBOUR } from "../../iso/dir";
import { bakedPeople, peopleLoaded, peopleSprites, posePerson } from "../agents/people/people-sheet";
import { fitOf, type FitId } from "../boats/fittings";
import { BOX_TINTS, CRATE_TINTS, cargoOf, slotTint } from "../boats/cargo";
import { idx, inBounds, type Structure } from "../grid";
import { HEIGHT_UNIT, HH, HW } from "../iso";
import { portLife, type BerthState } from "./port-life";
import { cranesLoaded, craneSprites, framePiece, lightPiece, makePiece, type Piece } from "./cranes/crane-sheet";
import { BOX, CRATE, HARBOUR, LUFFING, M_STEP, M_TILE, STS, TURNS, type Turning } from "./cranes/models";
import { registerCustomRenderer, type RenderCtx, type StructureHandle } from "./render";

const STONE = 0xa29d93, STONE_SIDE = 0x7d786f, STONE_SHADE = 0x625e57;
const PLANK = 0x8b6a45;
const WALL = 0xd2b48c, WALL_SHADE = 0xae9068, ROOF = 0xb5523b, ROOF_SHADE = 0x8e3d2b, DOOR = 0x5a3d22;
const IRON = 0x33373c, FENDER = 0x1d1f22, TIMBER = 0x9a7446, TIMBER_SHADE = 0x6f5231;
const TOWER = 0xe8e2d2, TOWER_SHADE = 0xb9b2a0, GLASS = 0x29384a;
const BOX_SHADE = 0.72;
const ROPE = 0x2b2b2b;
const LAMP: Record<BerthState, number> = { free: 0x5dff8a, working: 0xffc247, blocked: 0xff5a4a };

/** Heights, in half steps over the ground. */
const QUAY = 0.6, WALLS = 3, RIDGE = 4.6;
/** How far back from the quay's edge a turning crane's mast stands, tiles, by what it is. */
const PIVOT = { harbour: 0.45, luffing: 0.5 } as const;
/** What a crane's steelwork is painted, by the fitting it serves. */
const PAINT: Record<string, number> = { gantry: 0x2f6ea8, crane: 0xe3ac1f, hardware: 0x8f959e, trade: 0xc9562c };
/** How far a gantry's boom is raised with no ship under it, radians; and seconds a berth is empty before it goes up. */
const BOOM_UP = 1.2;
const BOOM_WAITS = 4;
/**
 * How far a gantry runs either way along its rails, tiles: with its width,
 * inside its own tile of quay, so it never runs over the bay beside it or off
 * the end of the port.
 */
const TRAVEL = 0.5 - STS.half / M_TILE - 0.04;
/** How far under a spreader's top a container's floor hangs, and under a hook a crate's or a container's, metres. */
const UNDER_SPREADER = 0.95;
const SLINGS = 0.7;
/** A mooring rope: its colour, and how many short lengths its curve is laid in. */
const HEMP = 0xd8c79a, HEMP_SHADE = 0x8a7648;
const ROPE_LENGTHS = 6;
/** A ship's length and beam, tiles, and how high its rail stands over the water, half steps, by class. @see SHIP_CLASSES */
const SHIP_LENGTH = [0.84, 1.5, 2.4], SHIP_BEAM = [0.36, 0.5, 0.62], SHIP_RAIL = [0.5, 0.85, 1.3];
/** How high a ship's cargo stands over its waterline, by its class, half steps. */
const DECK = [0.9, 1.5, 2.6];
/** Where in a lift a crane waits: back over the yard, hook up, empty. */
const PARKED = 0.9;

/** What stands in each column of a port this many tiles long: its berths' yards, and a shed. @see berthsAlong */
const LAYOUT: Record<number, readonly ("shed" | "yard" | "stack")[]> = {
  2: ["yard", "shed"],
  3: ["yard", "shed", "yard"],
  // THE BIGGEST IS ALL CONTAINER YARD: no shed, a bay of stacks where the quay has no berth.
  4: ["yard", "stack", "yard", "yard"],
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
function draw(G: Statics, s: Structure, ctx: RenderCtx, c: number): void {
  // What is drawn goes to `g`: the bay's ground first, then its stacks and its gear each on their own. @see Statics
  let g = G.base;
  G.stacks.clear();
  G.gear.clear();
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
  // What is stacked on a yard is not drawn here: it is boxes, each its own. @see Yard
  const stacks = () => {};
  if (kinds[c] === "stack") {
    // A BAY OF THE CONTAINER YARD: lanes painted on the quay, and rows of
    // boxes lying along it — a tier always there, more as the yard fills.
    for (const d of [0.14, depth - 0.42]) line(Q(a0 + 0.04, d, QUAY + 0.01), Q(a1 - 0.04, d, QUAY + 0.01), 0xf2d24a, 0.9, 0.8);
    // THE GATE at its back: two posts, and a striped bar across.
    box(a0 + 0.02, 0, a0 + 0.08, 0.06, QUAY, QUAY + 1.2, IRON, IRON, FENDER);
    box(a0 + 0.92, 0, a0 + 0.98, 0.06, QUAY, QUAY + 1.2, IRON, IRON, FENDER);
    line(Q(a0 + 0.05, 0.03, QUAY + 1.0), Q(a0 + 0.95, 0.03, QUAY + 1.0), 0xf2f2f2, 2.2);
    for (const t of [0.2, 0.5, 0.8]) line(Q(a0 + t - 0.07, 0.03, QUAY + 1.0), Q(a0 + t + 0.07, 0.03, QUAY + 1.0), 0xd8432f, 2.2);
    return;
  }
  const gear = () => {
    if (fit === "trade") {
      // A HARBOUR CRANE stands here, on its pedestal: all of it is apart. @see Rig
    } else if (fit === "crane" || fit === "hardware" || fit === "gantry") {
      // THE RAILS a crane runs on, along the quay. The crane is apart.
      const rails = fit === "gantry" ? [depth + STS.land / M_TILE, depth + STS.water / M_TILE] : [depth - PIVOT.luffing - 1.9 / M_TILE, depth - PIVOT.luffing + 1.9 / M_TILE];
      for (const d of rails) { line(Q(a0, d, QUAY + 0.02), Q(a1, d, QUAY + 0.02), IRON, 1.6); line(Q(a0, d, QUAY + 0.05), Q(a1, d, QUAY + 0.05), 0x8a8f98, 0.6); }
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
  // The stacks at the back and the gear by the water, each on its own, so what moves can go between them.
  g = G.stacks; stacks();
  g = G.gear; gear();
  g = G.base;
  // A FLOODLIGHT's mast at the back of the last column; its light is apart.
  if (last) line(Q(a1 - 0.08, 0.08, QUAY), Q(a1 - 0.08, 0.08, QUAY + 7), IRON, 1.4);
}

/**
 * A BAY'S STATIC PICTURE, in three: its ground (the quay, and all of a shed
 * or a bay of stacks); the stacks at the back of a yard; and the gear by the
 * water. Three, so that what moves can be drawn BETWEEN them. @see SLOTS
 */
type Statics = { base: Graphics; stacks: Graphics; gear: Graphics };

/**
 * THE ORDER A BAY IS DRAWN IN, far from the camera to near. Everything of a
 * bay is in the band of the bay's own front tile, so the bay nearer the
 * camera covers the one behind it, whatever either is doing; and within the
 * bay each thing has a slot in this order.
 *
 * A crane's LOAD — its rope, its hook and what hangs from it — changes where
 * it is in that order as it goes: behind the gear over the yard, in front of
 * it over the quay, and over the ship out past the edge. A node cannot change
 * its parent without the band's draw list being rebuilt, so there are three
 * loads, one in each place, and only the one where the hook is can be seen.
 *
 * With the water TOWARD the camera the ship is in a band in front, and the
 * load over her is drawn there (`over`); with the water BEHIND, the ship is
 * behind, the gear behind the stacks, and the order runs the other way.
 */
const SLOTS = {
  near: ["base", "stacks", "loadA", "gear", "jib", "loadB", "front", "top", "edge"],
  away: ["loadC", "base", "edge", "gear", "jib", "loadB", "front", "top", "stacks", "loadA"],
} as const;

/**
 * WHAT STANDS ON A YARD, box by box: every place one can stand, a sprite
 * there already, and how many are there now. The places are in the order
 * they are drawn — a stack at a time, far from the camera to near, each from
 * the ground up — and each has its turn to be FILLED: a tier at a time across
 * the yard. A box set down by a crane keeps the colour it came with.
 */
type Yard = {
  kind: "box" | "crate";
  at: { a: number; d: number; z: number; turn: number }[];
  pieces: Piece[];
  tints: number[];
  /** How many stand there whatever the yard holds, and how many are showing. */
  base: number;
  shown: number;
};

/** What hangs from a crane, once for each place it can be: its ropes, what is on the hook, and the hook or spreader. */
type Load = { ropes: Graphics[]; hook: Graphics | null; spreader: Piece | null; box: Piece; crate: Piece };

/**
 * WHAT MOVES ON ONE YARD, every piece its own node, made once and then only
 * moved, turned, stretched, tinted and faded:
 *  - a crane that TURNS (a derrick, a tower crane): its jib and tail swung
 *    round the mast, two stays from the apex, a counterweight, a trolley out
 *    along the jib, a rope, a hook block and a crate;
 *  - or a GANTRY: the portal itself, run along its rails, a trolley on its
 *    boom, a spreader on two ropes and a container;
 *  - the berth's lamp, a docker, and two lines to a ship alongside.
 */
type Rig = {
  c: number;
  berth: number;
  kind: "turn" | "gantry" | "none";
  /** A turning crane's measures, and how far it reaches, tiles; null for a gantry. */
  T: Turning | null;
  reach: number;
  pivot: number;
  /** Its baked parts. @see crane-sheet */
  pieces: Record<string, Piece>;
  /** What stands on its yard, if it lands things there. */
  yard: Yard | null;
  /** What it last had on its hook, and whether it had it a frame ago. */
  what: "box" | "crate";
  had: boolean;
  tint: number;
  /** A gantry's boom: how far raised, radians; and how long its berth has been empty. */
  boom: number;
  idle: number;
  lamp: Graphics;
  /** Its two mooring ropes, each a run of short lengths laid along a sagging curve. */
  lines: Graphics[][];
  /** How far across each is, nought coiled on the quay to one made fast; and where on the ship each was last fast, on the screen. */
  fast: number;
  cleats: [number, number][];
  bars: Record<string, Graphics>;
  parts: Record<string, Graphics>;
  /** Its load, in each of the three places it can be: over the yard, over the quay, over the ship. @see SLOTS */
  loads: Load[];
  hand: Sprite[];
  handKey: string;
  state: BerthState | "";
  /** Its pose now, eased toward where the lift wants it: the jib's turn, how far out the trolley is, how high the hook, how far along its rails. */
  turn: number;
  out: number;
  hook: number;
  along: number;
  /** How fast it is moving, for the load's swing; and the lift whose crate it carries. */
  speed: number;
  /** How fast each of those is changing: a crane gathers way and brakes, it does not glide. @see damp */
  vel: { turn: number; out: number; hook: number; along: number };
  /** The load's swing on its ropes, radians, and how fast; and where its hanging point was a frame ago, to know how hard it was pulled. */
  sway: number;
  swayV: number;
  hungAt: number;
  hungV: number;
  lift: number;
};

type SeaportHandle = StructureHandle & {
  columns: Graphics[];
  statics: Statics[];
  yards: Yard[];
  rigs: Rig[];
  nodes: Container[];
  beacon: Graphics | null;
  flood: Graphics | null;
  /** The yard's fill and the fittings the static picture was drawn for. */
  drawnFor: string;
  /** Made before the cranes' sheet was in: to be made again once it is. */
  pending: boolean;
  t: number;
};

/** The band of a column's front cell: the nearest the camera of the tiles it stands on. */
const bandOfColumn = (s: Structure, c: number) =>
  NEIGHBOUR[s.facing ?? "W"][0] === 0 ? s.x + c + s.y + s.h - 1 : s.x + s.w - 1 + s.y + c;

const fitsKey = (s: Structure, fill: number) => `${(s.fit ?? []).join(",")}|${Math.round(fill * 12)}|${s.x},${s.y},${s.w},${s.h},${s.facing}`;

/** Draw the static picture, for the yard as it stands. */
function redraw(h: SeaportHandle, s: Structure, ctx: RenderCtx): void {
  const fill = portLife(s.id)?.yard ?? 0;
  h.statics.forEach((g, c) => draw(g, s, ctx, c));
  h.drawnFor = fitsKey(s, fill);
}

/** A quay's facing as the cranes are baked: the heading its water is toward, and which of the four that is. */
const FACING_INDEX = { S: 0, W: 1, N: 2, E: 3 } as const;
const FACING = [0, Math.PI / 2, Math.PI, -Math.PI / 2];

const WORKER = [0xe0b090, 0x2b3a55, 0xf2a21a, 0x3a2a1a, 0xffffff];

/** A bar a unit long from its origin along +x, `w` thick: laid between two points by `lay`, never redrawn. */
function bar(color: number, w: number, under?: number): Graphics {
  const g = new Graphics();
  g.eventMode = "none";
  g.rect(0, -w / 2, 1, w).fill({ color });
  if (under !== undefined) g.rect(0, w * 0.1, 1, w * 0.4).fill({ color: under });
  return g;
}
function lay(g: Graphics, a: readonly [number, number], b: readonly [number, number]): void {
  g.position.set(a[0], a[1]);
  g.rotation = Math.atan2(b[1] - a[1], b[0] - a[0]);
  g.scale.x = Math.max(0.001, Math.hypot(b[0] - a[0], b[1] - a[1]));
}

function mount(s: Structure, _def: unknown, ctx: RenderCtx): SeaportHandle {
  const columns: Graphics[] = [], statics: Statics[] = [], rigs: Rig[] = [], nodes: Container[] = [], yards: Yard[] = [];
  const f = frame(s, ctx), sc = f.sc;
  // Which of the four ways the quay faces, as the cranes' parts are baked. @see FACING_HEADINGS
  const fi = FACING_INDEX[s.facing ?? "W"];
  void craneSprites();
  const clampBand = (b: number) => Math.max(0, Math.min(ctx.bands.structureOf.length - 1, b));
  const bandFor = (c: number) => ctx.bands.structureOf[clampBand(bandOfColumn(s, c))];
  // WHAT REACHES OUT OVER THE WATER is drawn with the movers of a band in
  // front of the berths, so a crate lowered onto a ship is over the ship, not
  // behind it; where the water is behind the port, in the port's own.
  const front = clampBand(s.x + s.w - 1 + s.y + s.h - 1 + (f.away ? 0 : 3));
  const over = ctx.bands.dynamicOf[front] ?? bandFor(f.length - 1);
  // A hologram of a port — one not there yet — is its static picture alone.
  const real = s.id >= 0;
  let beacon: Graphics | null = null, flood: Graphics | null = null;
  const add = <T extends Container>(parent: Container, n: T): T => { n.eventMode = "none"; parent.addChild(n); nodes.push(n); return n; };
  const shape = (make: (g: Graphics) => void) => { const g = new Graphics(); make(g); return g; };
  for (let c = 0; c < f.length; c++) {
    // THE BAY'S SLOTS, far to near, in its own band. @see SLOTS
    const slot: Record<string, Container> = {};
    for (const name of f.away ? SLOTS.away : SLOTS.near) slot[name] = add(bandFor(c), new Container());
    if (!f.away) slot.loadC = over;
    const st: Statics = { base: add(slot.base, new Graphics()), stacks: add(slot.stacks, new Graphics()), gear: add(slot.gear, new Graphics()) };
    statics.push(st);
    columns.push(st.base, st.stacks, st.gear);
    if (!real) continue;
    if (f.kinds[c] === "shed" && !beacon) {
      beacon = add(slot.edge, shape((b) => { b.circle(0, 0, 3.2 * sc).fill({ color: 0xff5a4a }); b.circle(0, 0, 9 * sc).fill({ color: 0xff5a4a, alpha: 0.25 }); }));
      beacon.blendMode = "add";
      beacon.position.set(...f.Q(c + 0.5, f.depth - 0.27, QUAY + 7.1));
    }
    if (c === f.length - 1) {
      flood = add(slot.front, shape((b) => { b.circle(0, 0, 4 * sc).fill({ color: 0xfff1c9 }); b.ellipse(0, 26 * sc, 70 * sc, 34 * sc).fill({ color: 0xfff1c9, alpha: 0.16 }); }));
      flood.blendMode = "add";
      flood.position.set(...f.Q(c + 1 - 0.08, 0.08, QUAY + 7));
      flood.alpha = 0;
    }
    /**
     * A yard of boxes on this bay: a stack at each of `as` along the quay by
     * `ds` out from the back, `tiers` high, `base` of them always there.
     */
    const yardOf = (kind: "box" | "crate", as: readonly number[], ds: readonly number[], tiers: number, base: number): Yard | null => {
      const CP0 = cranesLoaded();
      if (!CP0) return null;
      const tall = (kind === "box" ? BOX.tall : CRATE.tall) / M_STEP + 0.02;
      const spots = as.flatMap((a) => ds.map((d) => ({ a: c + a, d })));
      // The order they are filled in: a tier at a time. And drawn in: a stack at a time, the furthest first.
      const turnOf = new Map(spots.map((sp, k) => [sp, k]));
      const depthOf = (sp: { a: number; d: number }) => { const [u, v] = f.L(sp.a, sp.d); return u + v; };
      const at = [...spots].sort((p, q) => depthOf(p) - depthOf(q))
        .flatMap((sp) => Array.from({ length: tiers }, (_, t) => ({ ...sp, z: QUAY + t * tall, turn: t * spots.length + turnOf.get(sp)! })));
      const list = kind === "box" ? BOX_TINTS : CRATE_TINTS;
      const tints = at.map((_, k) => list[(k * 5 + c * 3 + s.id) % list.length]);
      const made = at.map((p) => {
        const pc = makePiece(CP0, slot.stacks, kind, (fi * 8 + 8) % TURNS, tints[p.turn], sc);
        nodes.push(pc.c);
        pc.c.position.set(...f.Q(p.a, p.d, p.z));
        pc.c.alpha = p.turn < base ? 1 : 0;
        return pc;
      });
      const y: Yard = { kind, at, pieces: made, tints, base, shown: base };
      yards.push(y);
      return y;
    };
    // A BAY OF THE CONTAINER YARD: rows of boxes lying along the quay, a tier always there.
    if (f.kinds[c] === "stack") yardOf("box", [0.27, 0.73], Array.from({ length: Math.floor((f.depth - 0.55) / 0.24) }, (_, k) => 0.2 + k * 0.24), 3, 2 * Math.floor((f.depth - 0.55) / 0.24));
    if (f.kinds[c] !== "yard") continue;
    const fit = fitOf(s, f.berthOf(c)).id;
    const CP = cranesLoaded();
    const kind: Rig["kind"] = !CP ? "none" : fit === "gantry" ? "gantry" : fit === "trade" || fit === "crane" || fit === "hardware" ? "turn" : "none";
    const T = kind === "turn" ? (fit === "trade" ? HARBOUR : LUFFING) : null;
    const paint = PAINT[fit] ?? 0xffffff;
    const bars: Rig["bars"] = {}, parts: Rig["parts"] = {}, pieces: Rig["pieces"] = {}, loads: Load[] = [];
    const piece = (where: Container, id: string, frame: number, tint = paint) => { const pc = makePiece(CP!, where, id, frame, tint, sc); nodes.push(pc.c); return pc; };
    /** What hangs from it, in one of the three places it can be. @see SLOTS */
    const load = (where: Container, ropes: number, spreader: boolean): Load => ({
      ropes: Array.from({ length: ropes }, () => add(where, bar(ROPE, Math.max(1, 1.1 * sc)))),
      box: piece(where, "box", (fi * 8 + 8) % TURNS, 0xffffff),
      crate: piece(where, "crate", (fi * 8 + 8) % TURNS, 0xc9a26b),
      spreader: spreader ? piece(where, "sts-spreader", fi) : null,
      // The hook block, and slings down to the load's corners.
      hook: spreader ? null : add(where, shape((b) => {
        b.rect(-2.6 * sc, -6 * sc, 5.2 * sc, 5 * sc).fill({ color: 0xf2c230 });
        b.rect(-2.6 * sc, -3.5 * sc, 5.2 * sc, 1.2 * sc).fill({ color: 0x2b2b2b });
        b.moveTo(0, -1 * sc).lineTo(-7 * sc, 8 * sc).moveTo(0, -1 * sc).lineTo(7 * sc, 8 * sc);
        b.stroke({ color: ROPE, width: Math.max(0.8, 0.9 * sc) });
      })),
    });
    if (kind === "gantry") {
      // THE SHIP-TO-SHORE GANTRY, in its baked parts: the side frame further
      // from the camera, then what it carries, then the nearer side frame,
      // then its top works, its boom and its trolley. @see cranes/models
      const bNear = Math.cos(FACING[fi]) - Math.sin(FACING[fi]) > 0;
      pieces.far = piece(slot.gear, bNear ? "sts-side-a" : "sts-side-b", fi);
      pieces.near = piece(slot.front, bNear ? "sts-side-b" : "sts-side-a", fi);
      pieces.top = piece(slot.top, "sts-top", fi);
      // Its forestays, from the head of the A-frame to the boom: laid as it is raised.
      bars.stayA = add(slot.top, bar(shade(paint, 0.8), Math.max(1, 1.3 * sc)));
      bars.stayB = add(slot.top, bar(shade(paint, 0.8), Math.max(1, 1.3 * sc)));
      pieces.boom = piece(slot.top, "sts-boom", fi);
      pieces.trolley = piece(slot.top, "sts-trolley", fi);
      for (const where of [slot.loadA, slot.loadB, slot.loadC]) loads.push(load(where, 2, true));
    } else if (T) {
      // A CRANE THAT TURNS: its base, the house that turns on it, and the jib about its foot.
      pieces.base = piece(slot.gear, fit === "trade" ? "harbour-base" : "luff-portal", fi);
      pieces.house = piece(slot.jib, fit === "trade" ? "harbour-house" : "luff-house", 0);
      bars.luffA = add(slot.jib, bar(ROPE, Math.max(1, 1 * sc)));
      bars.luffB = add(slot.jib, bar(ROPE, Math.max(1, 1 * sc)));
      pieces.jib = piece(slot.jib, fit === "trade" ? "harbour-jib" : "luff-jib", 0);
      for (const where of [slot.loadA, slot.loadB, slot.loadC]) loads.push(load(where, 1, false));
    }
    const lamp = add(slot.edge, shape((l) => { l.circle(0, 0, 2.6 * sc).fill({ color: 0xffffff }); l.circle(0, 0, 6 * sc).fill({ color: 0xffffff, alpha: 0.22 }); }));
    lamp.position.set(...f.Q(c + 0.5, f.depth - 0.03, QUAY + 0.75));
    const rig: Rig = {
      c, berth: f.berthOf(c), kind, T, pieces, boom: BOOM_UP, idle: BOOM_WAITS,
      // What it lands stands behind it: containers behind a gantry, crates behind a crane; a few crates always by a trading quay.
      yard: fit === "gantry" ? yardOf("box", [0.27, 0.73], [0.42, 0.66, 0.9], 3, 0)
        : fit === "crane" || fit === "hardware" ? yardOf("crate", [0.22, 0.5, 0.78], [0.22, 0.42, 0.62, 0.82], 2, 0)
          : fit === "trade" ? yardOf("crate", [0.25, 0.5], [0.3, 0.5], 2, 3) : null,
      what: fit === "gantry" ? "box" : "crate", had: false, tint: 0xffffff,
      reach: T ? (T.foot[0] + T.jib * 0.98) / M_TILE : 0,
      pivot: T ? f.depth - (fit === "trade" ? PIVOT.harbour : PIVOT.luffing) : f.depth - 1.2,
      lamp, bars, parts, loads, hand: [], handKey: "", state: "",
      // TWO ROPES ASHORE. Where the ship lies in front of the quay they are
      // drawn with the quay, so her hull hides what runs behind it; where she
      // lies behind it, with the movers of the band before the quay's, over
      // her and under the port.
      lines: [0, 1].map(() => Array.from({ length: ROPE_LENGTHS }, () => {
        const l = add(f.away ? ctx.bands.dynamicOf[clampBand(bandOfColumn(s, c) - 1)] ?? slot.edge : slot.edge, bar(HEMP, Math.max(1, 1.3 * sc), HEMP_SHADE));
        l.alpha = 0;
        return l;
      })),
      fast: 0, cleats: [[0, 0], [0, 0]],
      turn: Math.PI, out: 0.7, hook: QUAY + 5, along: 0, speed: 0, lift: -1,
      vel: { turn: 0, out: 0, hook: 0, along: 0 }, sway: 0, swayV: 0, hungAt: NaN, hungV: 0,
    };
    // A DOCKER by the berth, from the people sheet once it is in.
    const P = bakedPeople() ? peopleLoaded() : null;
    if (bakedPeople() && !P) void peopleSprites();
    if (P && P.figures.has("builder")) {
      rig.hand = WORKER.map((tint) => { const sp = add(slot.edge, new Sprite()); sp.tint = tint; return sp; });
      const [x, y] = f.Q(c + 0.72, f.depth - 0.28, QUAY);
      for (const sp of rig.hand) sp.position.set(x, y);
    }
    rigs.push(rig);
  }
  const h: SeaportHandle = {
    columns, statics, yards, rigs, nodes, beacon, flood, drawnFor: "", t: 0, pending: real && !cranesLoaded(),
    // What was made last first: a slot after everything in it.
    destroy: () => { for (const n of [...nodes].reverse()) { n.parent?.removeChild(n); n.destroy({ children: true }); } },
  };
  redraw(h, s, ctx);
  tick(h, s, _def, ctx, 0);
  return h;
}

const ease = (t: number) => t * t * t * (t * (6 * t - 15) + 10);
const span = (p: number, a: number, b: number) => Math.min(1, Math.max(0, (p - a) / (b - a)));
/** The shorter way round from one turn to another. */
const turnTo = (from: number, to: number) => from + Math.atan2(Math.sin(to - from), Math.cos(to - from));

/**
 * A frame of a port at work.
 *
 * A LIFT, in step with the ship's own cargo (@see liftAt): down to where the
 * cargo is and up with it — the moment the ship is seen to have one less —
 * across, down onto the stack, up empty, and back. Unloading, the cargo is
 * at the ship; loading, at the yard. Each lift picks from another hold and
 * sets down on another stack. With no ship, the crane waits over the yard.
 *
 * A crane that turns SWINGS its jib to it and runs its trolley out; a gantry
 * RUNS ALONG ITS RAILS to the hold and its trolley out along the boom. The
 * load swings a little as it is carried. All of it eased toward where the
 * lift wants it, so nothing jumps when a ship comes or goes.
 *
 * Transforms, tints and alphas only. @see render-group-rebuilds
 */
function tick(hh: StructureHandle, s: Structure, _def: unknown, ctx: RenderCtx, dt: number): void {
  const h = hh as SeaportHandle;
  if (!h.rigs.length && !h.beacon) return;
  h.t += dt;
  // THE CRANES' SHEET CAME IN after this port was drawn: its cranes are made now.
  if (h.pending && cranesLoaded()) {
    const fresh = mount(s, _def, ctx);
    h.destroy();
    Object.assign(h, fresh);
    return;
  }
  const life = portLife(s.id);
  // The yard's stacks, redrawn when they change by a box; never by the frame.
  if (life && fitsKey(s, life.yard) !== h.drawnFor) redraw(h, s, ctx);
  const f = frame(s, ctx), sc = f.sc;
  const night = life?.night ?? 0;
  if (h.beacon) h.beacon.alpha = 0.35 + 0.65 * (Math.sin(h.t * 3) > 0.6 ? 1 : 0.15) * (0.4 + 0.6 * night);
  if (h.flood) h.flood.alpha = Math.min(1, Math.max(0, (night - 0.3) / 0.3));
  // WHAT STANDS ON EACH YARD, as full as the port's yard is: shown and hidden by alpha, a box at a time.
  for (const y of h.yards) {
    const want = y.base + Math.round((life?.yard ?? 0) * (y.at.length - y.base));
    if (want === y.shown) continue;
    y.at.forEach((p, k) => { y.pieces[k].c.alpha = p.turn < want ? 1 : 0; if (p.turn >= y.shown && p.turn < want) y.pieces[k].sp[0].tint = y.tints[p.turn]; });
    y.shown = want;
  }
  const P = peopleLoaded();
  const ground = inBounds(ctx.grid, s.x, s.y) ? ctx.grid.height[idx(ctx.grid, s.x, s.y)] : 0;
  const [fx, fy] = NEIGHBOUR[s.facing ?? "W"];
  /** A point of the map as the port sees it: how far along its quay, and how far out. */
  const local = (x: number, y: number): [number, number] => f.alongU
    ? [x - (s.x - 0.5), fy > 0 ? y - (s.y - 0.5) : s.y + s.h - 0.5 - y]
    : [y - (s.y - 0.5), fx > 0 ? x - (s.x - 0.5) : s.x + s.w - 0.5 - x];

  for (const r of h.rigs) {
    const at = life?.berths[r.berth];
    const state: BerthState = at?.state ?? "free";
    if (state !== r.state) { r.lamp.tint = LAMP[state]; r.state = state; }
    r.lamp.alpha = state === "working" ? 0.75 + 0.25 * Math.sin(h.t * 5 + r.c) : 0.9;
    const ship = at?.ship;
    if (r.hand.length && P) {
      r.handKey = posePerson(r.hand, P, "builder", ship ? "work" : "stand", f.alongU ? Math.PI / 2 : 0, h.t * 6 + r.c, ctx.scale, 1, r.handKey);
    }
    // MOORED BY TWO ROPES, each from a bollard to the nearest cleat along her
    // quay-side rail. THROWN ACROSS as she ties up — paid out from the
    // bollard, slack, then hauled taut — and LET GO as she leaves: hauled back
    // from where it was last fast, and coiled. Each hangs in a curve.
    if (ship) {
      const len = SHIP_LENGTH[ship.cls] ?? 0.84, beam = SHIP_BEAM[ship.cls] ?? 0.36;
      const hx = Math.cos(ship.heading), hy = Math.sin(ship.heading);
      // Toward the quay from her middle, across her beam.
      const [fx2, fy2] = NEIGHBOUR[s.facing ?? "W"];
      r.cleats = [0.25, 0.75].map((t) => {
        const ba = r.c + t;
        let best: [number, number] = [0, 0], bestD = Infinity;
        for (const e of [-0.4, -0.14, 0.14, 0.4]) {
          // A cleat on her rail, on the side the quay is.
          const x = ship.x + hx * e * len - fx2 * beam * 0.42, y = ship.y + hy * e * len - fy2 * beam * 0.42;
          const [a, d] = local(x, y);
          if (Math.abs(a - ba) < bestD) { bestD = Math.abs(a - ba); best = f.Q(a, d, ship.z - ground + SHIP_RAIL[ship.cls]); }
        }
        return best;
      });
      r.fast = Math.min(1, r.fast + dt / 0.9);
    } else r.fast = Math.max(0, r.fast - dt / 0.6);
    r.lines.forEach((rope, j) => {
      const from = f.Q(r.c + (j ? 0.75 : 0.25), f.depth - 0.1, QUAY + 0.32);
      const reach = ease(Math.min(1, r.fast * 1.4));
      const to: [number, number] = [from[0] + (r.cleats[j][0] - from[0]) * reach, from[1] + (r.cleats[j][1] - from[1]) * reach];
      // Slack while it is paid out, near taut once fast; a little life in it with the water.
      const span2 = Math.hypot(to[0] - from[0], to[1] - from[1]);
      const sag = span2 * (0.1 + 0.3 * (1 - ease(r.fast))) + Math.sin(h.t * 1.7 + r.c + j) * 0.6 * sc * r.fast;
      const at = (t: number): [number, number] => [from[0] + (to[0] - from[0]) * t, from[1] + (to[1] - from[1]) * t + sag * 4 * t * (1 - t)];
      rope.forEach((seg, n) => {
        lay(seg, at(n / ROPE_LENGTHS), at((n + 1) / ROPE_LENGTHS));
        seg.alpha = r.fast > 0.02 ? 1 : 0;
      });
    });
    if (r.kind === "none") continue;

    const CP = cranesLoaded();
    if (!CP) continue;
    const lit = Math.round(Math.min(1, Math.max(0, (night - 0.35) / 0.3)) * 10) / 10;
    for (const pc of Object.values(r.pieces)) lightPiece(CP, pc, lit);
    const lifting = !!ship?.cargo;
    const p = lifting ? ship!.phase : PARKED;
    // WHAT SHE CARRIES, and the very box this crane is on: the slot on her
    // deck it takes one from, or sets one in. Each by its floor. @see slotAt
    const cargo = ship ? cargoOf(ship.look) : null;
    if (lifting && cargo) r.what = cargo.kind;
    const what = r.what;
    const tall = (what === "box" ? BOX.tall : CRATE.tall) / M_STEP;
    const sl = lifting && cargo ? cargo.slots[ship!.slot] : null;
    const ch = ship ? Math.cos(ship.heading) : 1, sh = ship ? Math.sin(ship.heading) : 0;
    const [sa, sd] = ship
      ? local(ship.x + ((sl?.x ?? 0) * ch - (sl?.y ?? 0) * sh) / M_TILE, ship.y + ((sl?.x ?? 0) * sh + (sl?.y ?? 0) * ch) / M_TILE)
      : [r.c + 0.5, f.depth + 0.5];
    const deck = { a: sa, d: sd, z: ship ? ship.z - ground + (sl ? sl.z / M_STEP : DECK[ship.cls]) : 0.6 };
    // AND ASHORE: the next place free on the yard behind it, to set one down;
    // the last one filled, to take one up.
    const ya = r.yard;
    const turn = ya ? Math.max(0, Math.min(ya.at.length - 1, lifting && ship!.loading ? ya.shown - 1 : ya.shown)) : 0;
    const place = ya?.at.find((q) => q.turn === turn);
    const yard = place ? { a: place.a, d: place.d, z: place.z } : { a: r.c + 0.5, d: 0.5, z: QUAY };
    const [from, to] = lifting && ship!.loading ? [yard, deck] : [deck, yard];
    // THE LIFT, as a driver works it: down, a moment still to lock on, and up;
    // away across while still hoisting; lowering before it has stopped; a
    // moment still to let go; up and back at once. @see PICKED, SET_DOWN
    const across = ease(span(p, 0.25, 0.56)) - ease(span(p, 0.8, 1));
    const downFrom = ease(span(p, 0, 0.12)) - ease(span(p, 0.18, 0.32));
    const downTo = ease(span(p, 0.5, 0.67)) - ease(span(p, 0.73, 0.86));
    const carried = lifting && p >= 0.15 && p < 0.7;
    if (carried && !r.had) {
      // The box's own colour, as it was on her deck — or will be.
      r.tint = slotTint(what, ship!.id, ship!.slot);
      for (const l of r.loads) (what === "box" ? l.box : l.crate).sp[0].tint = r.tint;
    }
    // SET DOWN ASHORE: the place it went keeps its colour, for when the yard shows it there.
    if (!carried && r.had && ya && !(ship?.loading) && ya.kind === what) ya.tints[turn] = r.tint;
    r.had = carried;
    const mid = r.c + 0.5;
    /**
     * Put the load where the hook is, in the one of its three places that is
     * right for how far out it is: over the yard (behind the gear), over the
     * quay, or out over the ship. The other two are not seen. `under` is how
     * far below the hook the load's floor hangs, half steps. @see SLOTS
     */
    const hang = (a: number, d: number, behind: number, ends: [number, number][], under: number, swing: number) => {
      const where = d >= f.depth - 0.02 ? 2 : d < behind ? 0 : 1;
      const [hx0, hy] = f.Q(a, d, r.hook), hx = hx0 + swing;
      const drop = under * HEIGHT_UNIT * sc;
      r.loads.forEach((l, n) => {
        const on = n === where ? 1 : 0;
        l.ropes.forEach((rope, e) => { lay(rope, ends[e], [hx + (l.ropes.length > 1 ? (e ? 1 : -1) * 9 * sc : 0), hy - (l.hook ? 6 * sc : 0)]); rope.alpha = on; });
        if (l.hook) { l.hook.position.set(hx, hy); l.hook.alpha = on; }
        if (l.spreader) { l.spreader.c.position.set(hx, hy); l.spreader.c.alpha = on; }
        const mine = what === "box" ? l.box : l.crate, other = what === "box" ? l.crate : l.box;
        mine.c.position.set(hx, hy + drop);
        mine.c.alpha = on && carried ? 1 : 0;
        other.c.alpha = 0;
      });
    };

    if (r.kind === "gantry") {
      const rail = QUAY + STS.rail / M_STEP, up = rail - 2.6 / M_STEP, under = (UNDER_SPREADER + BOX.tall) / M_STEP;
      // THE BOOM comes down as a ship ties up, and goes up when the berth has stood empty a while.
      r.idle = ship ? 0 : r.idle + dt;
      const wantBoom = r.idle >= BOOM_WAITS ? BOOM_UP : 0;
      r.boom += Math.sign(wantBoom - r.boom) * Math.min(Math.abs(wantBoom - r.boom), dt * 0.45);
      // Along its rails to the hold or the stack — never out of its own bay —
      // and the trolley out along the boom, once the boom is down.
      const wantAlong = Math.max(-TRAVEL, Math.min(TRAVEL, from.a + (to.a - from.a) * across - mid));
      const inner = f.depth + (STS.back + 3) / M_TILE, outer = f.depth + (STS.hinge[0] + STS.boom - 2) / M_TILE;
      const wantOut = Math.max(inner, Math.min(r.boom > 0.12 ? f.depth + (STS.hinge[0] - 2) / M_TILE : outer, from.d + (to.d - from.d) * across));
      const wantHook = up - downFrom * Math.max(0, up - from.z - under) - downTo * Math.max(0, up - to.z - under);
      [r.along, r.vel.along] = damp(r.along, r.vel.along, wantAlong, 0.45, dt);
      [r.out, r.vel.out] = damp(r.out, r.vel.out, wantOut, 0.3, dt);
      [r.hook, r.vel.hook] = damp(r.hook, r.vel.hook, wantHook, 0.22, dt);
      const a = mid + r.along;
      const stands = f.Q(a, f.depth, QUAY);
      for (const id of ["far", "near", "top"]) r.pieces[id].c.position.set(stands[0], stands[1]);
      // THE BOOM, RAISED: its picture lying down, sheared about its hinge. Exact, for a thing in one upright plane.
      const [ox, oy] = f.Q(0, 0, 0), [dx, dy] = f.Q(0, 1 / M_TILE, 0), [, zy] = f.Q(0, 0, 1 / M_STEP);
      const A0: [number, number] = [dx - ox, dy - oy], B0: [number, number] = [0, zy - oy];
      const hinge = f.Q(a, f.depth + STS.hinge[0] / M_TILE, QUAY + STS.hinge[2] / M_STEP);
      shear(r.pieces.boom.c, A0, B0, A0, B0, 0, r.boom, CP.res / sc, hinge);
      const along = (m: number, upM: number): [number, number] => {
        const cb = Math.cos(r.boom), sb = Math.sin(r.boom);
        return [hinge[0] + A0[0] * (m * cb - upM * sb) + B0[0] * (m * sb + upM * cb), hinge[1] + A0[1] * (m * cb - upM * sb) + B0[1] * (m * sb + upM * cb)];
      };
      const apex = f.Q(a, f.depth + STS.apex[0] / M_TILE, QUAY + STS.apex[2] / M_STEP);
      lay(r.bars.stayA, apex, along(STS.boom * 0.55, 1));
      lay(r.bars.stayB, apex, along(STS.boom - 0.6, 1));
      const [tx, ty] = f.Q(a, r.out, rail);
      r.pieces.trolley.c.position.set(tx, ty);
      const swing = swingOf(r, tx, (rail - r.hook) * HEIGHT_UNIT * sc, sc, dt);
      hang(a, r.out, f.depth + STS.land / M_TILE - 0.1, [[tx - 8 * sc, ty], [tx + 8 * sc, ty]], under, swing);
      continue;
    }

    // A CRANE THAT TURNS, about its mast at (mid, pivot): its jib luffed to
    // put its head over the hook — raised to bring the load in, lowered to
    // reach out — and slewed to follow it.
    const T = r.T!, up = QUAY + (T.foot[1] + 1.5) / M_STEP, under = SLINGS / M_STEP + tall;
    const polar = (a: number, d: number) => ({ turn: Math.atan2(a - mid, d - r.pivot), out: Math.min(r.reach, Math.max(0.28, Math.hypot(a - mid, d - r.pivot))) });
    // THE LOAD GOES STRAIGHT from the one to the other, and the jib follows it.
    const want = polar(from.a + (to.a - from.a) * across, from.d + (to.d - from.d) * across);
    const wantHook = up - downFrom * Math.max(0, up - from.z - under) - downTo * Math.max(0, up - to.z - under);
    const next = turnTo(r.turn, want.turn);
    [r.turn, r.vel.turn] = damp(r.turn, r.vel.turn, next, 0.4, dt);
    [r.out, r.vel.out] = damp(r.out, r.vel.out, want.out, 0.35, dt);
    [r.hook, r.vel.hook] = damp(r.hook, r.vel.hook, wantHook, 0.24, dt);
    const sin = Math.sin(r.turn), cos = Math.cos(r.turn);
    // Which way that is on the map, and the baked heading nearest it.
    const ea = f.alongU ? [1, 0] : [0, 1];
    const wx = cos * fx + sin * ea[0], wy = cos * fy + sin * ea[1];
    const step = (Math.PI * 2) / TURNS;
    const heading = (Math.atan2(wy, wx) + Math.PI * 2) % (Math.PI * 2);
    const turnK = Math.floor(heading / step) % TURNS, baked = (turnK + 0.5) * step;
    const axis = f.Q(mid, r.pivot, QUAY);
    r.pieces.base.c.position.set(axis[0], axis[1]);
    r.pieces.house.c.position.set(axis[0], axis[1]);
    framePiece(CP, r.pieces.house, turnK);
    framePiece(CP, r.pieces.jib, turnK);
    // A metre out from the mast on the screen — as it is, and as it was baked — and a metre up.
    const px = (ux: number, uy: number): [number, number] => [((ux - uy) * HW * sc) / M_TILE, ((ux + uy) * HH * sc) / M_TILE];
    const Sr = px(wx, wy), Sr0 = px(Math.cos(baked), Math.sin(baked)), Sz: [number, number] = [0, (-HEIGHT_UNIT * sc) / M_STEP];
    const foot: [number, number] = [axis[0] + Sr[0] * T.foot[0] + Sz[0] * T.foot[1], axis[1] + Sr[1] * T.foot[0] + Sz[1] * T.foot[1]];
    const luff = Math.acos(Math.min(0.985, Math.max(0.06, (r.out * M_TILE - T.foot[0]) / T.jib)));
    shear(r.pieces.jib.c, Sr0, Sz, Sr, Sz, T.baked, luff, CP.res / sc, foot);
    const onJib = (m: number): [number, number] => [foot[0] + (Sr[0] * Math.cos(luff) + Sz[0] * Math.sin(luff)) * m, foot[1] + (Sr[1] * Math.cos(luff) + Sz[1] * Math.sin(luff)) * m];
    const tip = onJib(T.jib);
    // The luffing ropes, from the head of the mast — where the house was baked — to the jib.
    const apex: [number, number] = [axis[0] + Sr0[0] * T.apex[0] + Sz[0] * T.apex[1], axis[1] + Sr0[1] * T.apex[0] + Sz[1] * T.apex[1]];
    lay(r.bars.luffA, apex, tip);
    lay(r.bars.luffB, apex, onJib(T.jib * 0.62));
    const swing = swingOf(r, tip[0], f.Q(mid + sin * r.out, r.pivot + cos * r.out, r.hook)[1] - tip[1], sc, dt);
    hang(mid + sin * r.out, r.pivot + cos * r.out, r.pivot - 0.12, [tip], under, swing);
  }
}

/**
 * Move a value toward where it is wanted as a thing with weight does: it
 * gathers way, and brakes into its mark without passing it. `smooth` is about
 * how long it takes, seconds. Answers the value and its speed.
 */
function damp(x: number, v: number, to: number, smooth: number, dt: number): [number, number] {
  if (dt <= 0) return [x, v];
  const w = 2 / smooth, e = w * Math.min(dt, 0.1), k = 1 / (1 + e + 0.48 * e * e + 0.235 * e * e * e);
  const off = x - to, t = (v + w * off) * Math.min(dt, 0.1);
  return [to + (off + t) * k, (v - w * t) * k];
}

/**
 * THE LOAD'S SWING, as a weight on a rope: pulled back when what it hangs
 * from gathers way, forward when it brakes, and swinging on after at the
 * pace of a pendulum as long as its rope — a short hoist quick, a long one
 * slow — until it dies down. `x` is where it hangs from on the screen and
 * `rope` how long it hangs, px. Answers how far aside it is, px.
 */
function swingOf(r: Rig, x: number, rope: number, sc: number, dt: number): number {
  const h = Math.min(Math.max(dt, 0), 1 / 20), len = Math.max(10 * sc, rope);
  if (h <= 0 || !Number.isFinite(r.hungAt) || Math.abs(x - r.hungAt) > 60 * sc) { r.hungAt = x; r.hungV = 0; return r.sway * len; }
  const v = (x - r.hungAt) / h, pull = Math.max(-600 * sc, Math.min(600 * sc, (v - r.hungV) / h));
  r.hungAt = x; r.hungV = v;
  // A pendulum as long as its rope, in metres, lightly damped.
  const w0 = Math.sqrt(9.81 / Math.max(1.5, (len / (HEIGHT_UNIT * sc)) * M_STEP));
  r.swayV += (-w0 * w0 * r.sway - 2 * 0.16 * w0 * r.swayV - pull / len) * h;
  r.sway = Math.max(-0.3, Math.min(0.3, r.sway + r.swayV * h));
  return r.sway * len;
}

/**
 * Lay a part baked in one upright plane — a jib, a boom — at another angle
 * in that plane, and in a plane turned a little from it: the 2×2 that takes
 * the picture's two axes (along the part and across it, as baked) to where
 * they should be now. `r0` and `r` are a metre out along the ground on the
 * screen, as baked and now; `z`, a metre up; `texel`, texels to a screen px.
 */
function shear(
  c: Container, r0: readonly [number, number], z0: readonly [number, number], r: readonly [number, number], z: readonly [number, number],
  bakedAngle: number, angle: number, texel: number, at: readonly [number, number],
): void {
  const c0 = Math.cos(bakedAngle), s0 = Math.sin(bakedAngle), c1 = Math.cos(angle), s1 = Math.sin(angle);
  // The baked axes, in texels; and the same axes now, on the screen.
  const A0 = [(c0 * r0[0] + s0 * z0[0]) * texel, (c0 * r0[1] + s0 * z0[1]) * texel], B0 = [(-s0 * r0[0] + c0 * z0[0]) * texel, (-s0 * r0[1] + c0 * z0[1]) * texel];
  const A = [c1 * r[0] + s1 * z[0], c1 * r[1] + s1 * z[1]], B = [-s1 * r[0] + c1 * z[0], -s1 * r[1] + c1 * z[1]];
  const det = A0[0] * B0[1] - A0[1] * B0[0];
  if (Math.abs(det) < 1e-9) return;
  // M = [A B] · inv([A0 B0])
  const i00 = B0[1] / det, i01 = -B0[0] / det, i10 = -A0[1] / det, i11 = A0[0] / det;
  SHEAR.set(A[0] * i00 + B[0] * i10, A[1] * i00 + B[1] * i10, A[0] * i01 + B[0] * i11, A[1] * i01 + B[1] * i11, at[0], at[1]);
  c.setFromMatrix(SHEAR);
}
const SHEAR = new Matrix();

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
