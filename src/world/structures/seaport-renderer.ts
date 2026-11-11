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
const STEEL = 0x8a8f98, STEEL_SHADE = 0x5d626a;
const IRON = 0x33373c, FENDER = 0x1d1f22, TIMBER = 0x9a7446, TIMBER_SHADE = 0x6f5231;
const TOWER = 0xe8e2d2, TOWER_SHADE = 0xb9b2a0, GLASS = 0x29384a;
const BOXES = [0x3f6e9c, 0xb8463a, 0x2f7d5b, 0xd9a23a, 0xc9c4b8, 0x9c6b3a];
const BOX_SHADE = 0.72;
const ROPE = 0x2b2b2b;
const LAMP: Record<BerthState, number> = { free: 0x5dff8a, working: 0xffc247, blocked: 0xff5a4a };

/** Heights, in half steps over the ground. */
const QUAY = 0.6, WALLS = 3, RIDGE = 4.6, MAST = 6.5;
/** A gantry's boom over the quay, half steps, and how far out over the water it reaches, tiles. */
const BOOM_Z = 9.5, REACH = 0.95;
/**
 * A crane that TURNS, by the fitting it serves: how high its jib is, half
 * steps; how long the jib and its tail, tiles; and how big the crate it lifts.
 */
const GEAR = {
  trade: { z: MAST, jib: 1.25, tail: 0, crate: [0.16, 0.16, 0.5] },
  crane: { z: 8.4, jib: 1.55, tail: 0.6, crate: [0.24, 0.24, 0.8] },
} as const;
/** How far back from the quay's edge each one's mast stands, tiles. */
const PIVOT = { trade: 0.8, crane: 0.5 } as const;
/** How high a ship's cargo stands over its waterline, by its class, half steps. */
const DECK = [0.9, 1.5, 2.6];
/** Where in a lift a crane waits: back over the yard, hook up, empty. */
const PARKED = 0.9;

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
      // A DERRICK's mast. Its jib, and all that hangs from it, are apart. @see Rig
      mast(mid, depth - PIVOT.trade, 0.07, QUAY + GEAR.trade.z, CRANE, CRANE_SHADE);
    } else if (fit === "crane" || fit === "hardware") {
      // A TOWER CRANE's tower and its cab. Its jib turns, apart.
      const col = fit === "hardware" ? STEEL : CRANE, dark = fit === "hardware" ? STEEL_SHADE : CRANE_SHADE;
      mast(mid, depth - PIVOT.crane, 0.09, QUAY + GEAR.crane.z, col, dark);
      for (let z = 1; z < GEAR.crane.z - 1.4; z += 1.1) {
        line(Q(mid + 0.09, depth - PIVOT.crane - 0.09, QUAY + z), Q(mid + 0.09, depth - PIVOT.crane + 0.09, QUAY + z + 1.1), dark, 0.9, 0.8);
        line(Q(mid - 0.09, depth - PIVOT.crane + 0.09, QUAY + z), Q(mid + 0.09, depth - PIVOT.crane + 0.09, QUAY + z + 1.1), dark, 0.9, 0.8);
      }
      box(mid - 0.15, depth - PIVOT.crane - 0.15, mid + 0.15, depth - PIVOT.crane + 0.15, QUAY + GEAR.crane.z - 1.1, QUAY + GEAR.crane.z, 0xf2efe6, 0xf2efe6, 0xc9c3b4);
    } else if (fit === "gantry") {
      // A GANTRY's rails along the quay. The gantry runs on them, apart.
      for (const d of [depth - 0.95, depth - 0.12]) { line(Q(a0, d, QUAY + 0.02), Q(a1, d, QUAY + 0.02), IRON, 1.6); line(Q(a0, d, QUAY + 0.05), Q(a1, d, QUAY + 0.05), 0x8a8f98, 0.6); }
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
  gear: (typeof GEAR)[keyof typeof GEAR] | null;
  pivot: number;
  lamp: Graphics;
  lines: Graphics[];
  bars: Record<string, Graphics>;
  parts: Record<string, Graphics>;
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
  lift: number;
};

type SeaportHandle = StructureHandle & {
  columns: Graphics[];
  rigs: Rig[];
  nodes: Container[];
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
  const columns: Graphics[] = [], rigs: Rig[] = [], nodes: Container[] = [];
  const f = frame(s, ctx), sc = f.sc;
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
  /** A box drawn about its top's middle, `wa` along the quay, `wd` out, `h` high, in greys to tint. */
  const crate = (wa: number, wd: number, hgt: number) => shape((g) => {
    const [ua, va] = f.L(-wa / 2, -wd / 2), [ub, vb] = f.L(wa / 2, wd / 2), [u0, v0] = f.L(0, 0);
    const x0 = Math.min(ua, ub) - u0, x1 = Math.max(ua, ub) - u0, y0 = Math.min(va, vb) - v0, y1 = Math.max(va, vb) - v0;
    const R = (u: number, v: number, z: number): [number, number] => [(u - v) * HW * sc, (u + v) * HH * sc - z * HEIGHT_UNIT * sc];
    g.poly([R(x1, y0, 0), R(x1, y1, 0), R(x1, y1, -hgt), R(x1, y0, -hgt)].flat()).fill({ color: 0xd4d4d4 });
    g.poly([R(x0, y1, 0), R(x1, y1, 0), R(x1, y1, -hgt), R(x0, y1, -hgt)].flat()).fill({ color: 0xa2a2a2 });
    g.poly([R(x0, y0, 0), R(x1, y0, 0), R(x1, y1, 0), R(x0, y1, 0)].flat()).fill({ color: 0xffffff });
    // Its ribs, so a container reads as one.
    for (const t of [0.25, 0.5, 0.75]) g.moveTo(...R(x1, y0 + (y1 - y0) * t, 0)).lineTo(...R(x1, y0 + (y1 - y0) * t, -hgt));
    for (const t of [0.25, 0.5, 0.75]) g.moveTo(...R(x0 + (x1 - x0) * t, y1, 0)).lineTo(...R(x0 + (x1 - x0) * t, y1, -hgt));
    g.stroke({ color: 0x000000, width: Math.max(0.5, 0.6 * sc), alpha: 0.18 });
  });
  for (let c = 0; c < f.length; c++) {
    const g = new Graphics();
    g.eventMode = "none";
    bandFor(c).addChild(g);
    columns.push(g);
    if (!real) continue;
    if (f.kinds[c] === "shed" && !beacon) {
      beacon = add(bandFor(c), shape((b) => { b.circle(0, 0, 3.2 * sc).fill({ color: 0xff5a4a }); b.circle(0, 0, 9 * sc).fill({ color: 0xff5a4a, alpha: 0.25 }); }));
      beacon.blendMode = "add";
      beacon.position.set(...f.Q(c + 0.5, f.depth - 0.27, QUAY + 7.1));
    }
    if (c === f.length - 1) {
      flood = add(bandFor(c), shape((b) => { b.circle(0, 0, 4 * sc).fill({ color: 0xfff1c9 }); b.ellipse(0, 26 * sc, 70 * sc, 34 * sc).fill({ color: 0xfff1c9, alpha: 0.16 }); }));
      flood.blendMode = "add";
      flood.position.set(...f.Q(c + 1 - 0.08, 0.08, QUAY + 7));
      flood.alpha = 0;
    }
    if (f.kinds[c] !== "yard") continue;
    const fit = fitOf(s, f.berthOf(c)).id;
    const kind: Rig["kind"] = fit === "gantry" ? "gantry" : fit === "trade" || fit === "crane" || fit === "hardware" ? "turn" : "none";
    const gear = kind === "turn" ? GEAR[fit === "trade" ? "trade" : "crane"] : null;
    const col = fit === "hardware" ? STEEL : CRANE, dark = fit === "hardware" ? STEEL_SHADE : CRANE_SHADE;
    const bars: Rig["bars"] = {}, parts: Rig["parts"] = {};
    if (kind === "gantry") {
      // THE GANTRY ITSELF, drawn where it stands and then run along its rails: four legs, sill beams, a machinery house, the boom out over the ship and its stays.
      parts.portal = add(bandFor(c), shape((p) => {
        const d0 = f.depth - 0.95, d1 = f.depth - 0.12, a0 = c + 0.1, a1 = c + 0.9, top = QUAY + BOOM_Z;
        const ln = (a: [number, number], b: [number, number], colour: number, w: number) => { p.moveTo(...a).lineTo(...b); p.stroke({ color: colour, width: Math.max(1, w * sc) }); };
        // Far legs first, then the near.
        const legs: [number, number][] = [[a0, d0], [a1, d0], [a0, d1], [a1, d1]];
        if (f.away) legs.reverse();
        for (const [a, d] of legs) { ln(f.Q(a, d, QUAY), f.Q(a, d, top), GANTRY_SHADE, 5.2); ln(f.Q(a, d, QUAY), f.Q(a, d, top), GANTRY, 2.6); }
        for (const d of [d0, d1]) { ln(f.Q(a0, d, QUAY + 0.5), f.Q(a1, d, QUAY + 0.5), GANTRY_SHADE, 3); ln(f.Q(a0, d, QUAY + 3.2), f.Q(a1, d, top - 2.2), GANTRY_SHADE, 1.4); ln(f.Q(a1, d, QUAY + 3.2), f.Q(a0, d, top - 2.2), GANTRY_SHADE, 1.4); }
        for (const a of [a0, a1]) { ln(f.Q(a, d0, top), f.Q(a, d1, top), GANTRY_SHADE, 5); ln(f.Q(a, d0, top), f.Q(a, d1, top), GANTRY, 2.4); }
        ln(f.Q(a0, d0, top), f.Q(a1, d0, top), GANTRY, 4); ln(f.Q(a0, d1, top), f.Q(a1, d1, top), GANTRY, 4);
        // The boom, a girder with a walkway's shade under it; the A-frame over it and its stays.
        const m = c + 0.5, b0 = f.depth - 1.45, b1 = f.depth + REACH + 0.25;
        ln(f.Q(m, b0, top + 0.1), f.Q(m, b1, top + 0.1), GANTRY_SHADE, 6.5);
        ln(f.Q(m, b0, top + 0.35), f.Q(m, b1, top + 0.35), GANTRY, 3);
        ln(f.Q(m, d0 + 0.3, top), f.Q(m, d0 + 0.3, top + 3.2), GANTRY, 2.6);
        ln(f.Q(m, d0 + 0.3, top + 3.2), f.Q(m, b1, top + 0.35), GANTRY_SHADE, 1.3);
        ln(f.Q(m, d0 + 0.3, top + 3.2), f.Q(m, f.depth + 0.25, top + 0.35), GANTRY_SHADE, 1.3);
        ln(f.Q(m, d0 + 0.3, top + 3.2), f.Q(m, b0, top + 0.35), GANTRY_SHADE, 1.3);
        // The machinery house, white, on the landward end.
        const [hx, hy] = f.Q(m, b0 + 0.25, top + 0.4);
        p.rect(hx - 9 * sc, hy - 11 * sc, 18 * sc, 11 * sc).fill({ color: 0xf2efe6 });
        p.rect(hx - 9 * sc, hy - 4 * sc, 18 * sc, 4 * sc).fill({ color: 0xc9c3b4 });
      }));
      parts.trolley = add(over, shape((t) => { t.rect(-6 * sc, -4 * sc, 12 * sc, 5 * sc).fill({ color: IRON }); t.rect(-4 * sc, 1 * sc, 8 * sc, 3 * sc).fill({ color: 0xf2efe6 }); }));
      bars.ropeA = add(over, bar(ROPE, Math.max(1, 1.1 * sc)));
      bars.ropeB = add(over, bar(ROPE, Math.max(1, 1.1 * sc)));
      parts.crate = add(over, crate(0.5, 0.2, 0.95));
      parts.spreader = add(over, shape((p) => { const w = 0.5 * HW * sc * 1.15; p.rect(-w / 2, -2.2 * sc, w, 3 * sc).fill({ color: 0xf2c230 }); p.rect(-w / 2, 0.2 * sc, w, 1 * sc).fill({ color: 0xa98220 }); }));
    } else if (gear) {
      // A CRANE THAT TURNS: every member of it a bar laid between two points that move.
      if (gear.tail) { bars.tail = add(over, bar(dark, 4.6 * sc, col)); bars.stayB = add(over, bar(dark, 1.1 * sc)); }
      bars.jib = add(over, bar(dark, (gear.tail ? 4.6 : 3) * sc, col));
      bars.stayA = add(over, bar(dark, 1.1 * sc));
      bars.king = add(over, bar(col, 2.6 * sc));
      if (gear.tail) parts.weight = add(over, crate(0.2, 0.2, 0.8));
      parts.trolley = add(over, shape((t) => { t.rect(-4 * sc, -1.5 * sc, 8 * sc, 3.5 * sc).fill({ color: IRON }); }));
      bars.ropeA = add(over, bar(ROPE, Math.max(1, 1.2 * sc)));
      parts.crate = add(over, crate(gear.crate[0], gear.crate[1], gear.crate[2]));
      // The hook block, and slings down to the crate's corners.
      parts.block = add(over, shape((b) => {
        b.rect(-2.4 * sc, -5 * sc, 4.8 * sc, 4 * sc).fill({ color: 0xf2c230 });
        b.moveTo(0, -1 * sc).lineTo(-5 * sc, 4 * sc).moveTo(0, -1 * sc).lineTo(5 * sc, 4 * sc);
        b.stroke({ color: ROPE, width: Math.max(0.8, 0.8 * sc) });
      }));
      if (parts.weight) parts.weight.tint = 0x4a4f55;
    }
    const lamp = add(bandFor(c), shape((l) => { l.circle(0, 0, 2.6 * sc).fill({ color: 0xffffff }); l.circle(0, 0, 6 * sc).fill({ color: 0xffffff, alpha: 0.22 }); }));
    lamp.position.set(...f.Q(c + 0.5, f.depth - 0.03, QUAY + 0.75));
    const rig: Rig = {
      c, berth: f.berthOf(c), kind, gear, pivot: kind === "turn" ? f.depth - PIVOT[fit === "trade" ? "trade" : "crane"] : f.depth - 1.2,
      lamp, bars, parts, hand: [], handKey: "", state: "",
      // TWO LINES ASHORE to whatever lies alongside: slack with nothing there.
      lines: [0, 1].map(() => { const l = add(over, bar(0xe9e2cf, Math.max(0.8, 0.8 * sc))); l.alpha = 0; return l; }),
      turn: Math.PI, out: 0.7, hook: QUAY + 5, along: 0, speed: 0, lift: -1,
    };
    // A DOCKER by the berth, from the people sheet once it is in.
    const P = bakedPeople() ? peopleLoaded() : null;
    if (bakedPeople() && !P) void peopleSprites();
    if (P && P.figures.has("builder")) {
      rig.hand = WORKER.map((tint) => { const sp = add(bandFor(c), new Sprite()); sp.tint = tint; return sp; });
      const [x, y] = f.Q(c + 0.72, f.depth - 0.28, QUAY);
      for (const sp of rig.hand) sp.position.set(x, y);
    }
    rigs.push(rig);
  }
  const h: SeaportHandle = {
    columns, rigs, nodes, beacon, flood, drawnFor: "", t: 0,
    destroy: () => { for (const n of [...columns, ...nodes]) { n.parent?.removeChild(n); n.destroy(); } },
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
  const life = portLife(s.id);
  // The yard's stacks, redrawn when they change by a box; never by the frame.
  if (life && fitsKey(s, life.yard) !== h.drawnFor) redraw(h, s, ctx);
  const f = frame(s, ctx), sc = f.sc;
  const night = life?.night ?? 0;
  if (h.beacon) h.beacon.alpha = 0.35 + 0.65 * (Math.sin(h.t * 3) > 0.6 ? 1 : 0.15) * (0.4 + 0.6 * night);
  if (h.flood) h.flood.alpha = Math.min(1, Math.max(0, (night - 0.3) / 0.3));
  const P = peopleLoaded();
  const ground = inBounds(ctx.grid, s.x, s.y) ? ctx.grid.height[idx(ctx.grid, s.x, s.y)] : 0;
  const [fx, fy] = NEIGHBOUR[s.facing ?? "W"];
  /** A point of the map as the port sees it: how far along its quay, and how far out. */
  const local = (x: number, y: number): [number, number] => f.alongU
    ? [x - (s.x - 0.5), fy > 0 ? y - (s.y - 0.5) : s.y + s.h - 0.5 - y]
    : [y - (s.y - 0.5), fx > 0 ? x - (s.x - 0.5) : s.x + s.w - 0.5 - x];
  const k = dt > 0 ? Math.min(1, dt * 5) : 1;

  for (const r of h.rigs) {
    const at = life?.berths[r.berth];
    const state: BerthState = at?.state ?? "free";
    if (state !== r.state) { r.lamp.tint = LAMP[state]; r.state = state; }
    r.lamp.alpha = state === "working" ? 0.75 + 0.25 * Math.sin(h.t * 5 + r.c) : 0.9;
    const ship = at?.ship;
    if (r.hand.length && P) {
      r.handKey = posePerson(r.hand, P, "builder", ship ? "work" : "stand", f.alongU ? Math.PI / 2 : 0, h.t * 6 + r.c, ctx.scale, 1, r.handKey);
    }
    // LINES ASHORE: from a bollard to her bow, and to her stern.
    if (ship) {
      const len = [0.84, 1.5, 2.4][ship.cls] ?? 0.84;
      r.lines.forEach((l, j) => {
        const e = (j ? -1 : 1) * len * 0.4;
        const [sa, sd] = local(ship.x + Math.cos(ship.heading) * e, ship.y + Math.sin(ship.heading) * e);
        // The bollard on the side of the berth that end of her is nearer.
        const ba = r.c + (sa > r.c + 0.5 ? 0.75 : 0.25);
        lay(l, f.Q(ba, f.depth - 0.1, QUAY + 0.3), f.Q(sa, sd, ship.z - ground + 0.5));
        l.alpha = Math.min(1, l.alpha + dt * 2);
      });
    } else for (const l of r.lines) l.alpha = Math.max(0, l.alpha - dt * 3);
    if (r.kind === "none") continue;

    const lifting = !!ship?.cargo;
    const p = lifting ? ship!.phase : PARKED;
    const lift = lifting ? ship!.lift : Math.max(0, r.lift);
    // WHERE THE CARGO IS ABOARD: another hold each lift, along her from stern to bow.
    const [sa, sd] = ship ? local(ship.x, ship.y) : [r.c + 0.5, f.depth + 0.5];
    const hold = ship ? ([-0.2, 0.06, 0.24][lift % 3]) * ([0.84, 1.5, 2.4][ship.cls] ?? 1) * (Math.cos(ship.heading) * (f.alongU ? 1 : 0) + Math.sin(ship.heading) * (f.alongU ? 0 : 1) >= 0 ? 1 : -1) : 0;
    const deck = { a: sa + hold, d: sd, z: (ship ? ship.z - ground + DECK[ship.cls] : 0.6) + (lifting && !ship!.loading ? 0.4 : 0) };
    // AND ASHORE: another stack each lift, as high as the yard stands.
    const spot = [[0.28, 0.34], [0.72, 0.34], [0.28, 0.84], [0.72, 0.84]][lift % 4];
    const yard = { a: r.c + spot[0], d: spot[1], z: QUAY + 0.95 + 2.6 * (life?.yard ?? 0) };
    const [from, to] = lifting && ship!.loading ? [yard, deck] : [deck, yard];
    const across = ease(span(p, 0.3, 0.55)) - ease(span(p, 0.88, 1));
    const downFrom = ease(span(p, 0, 0.15)) - ease(span(p, 0.15, 0.3));
    const downTo = ease(span(p, 0.55, 0.7)) - ease(span(p, 0.7, 0.86));
    const carried = lifting && p >= 0.15 && p < 0.7;
    if (carried && r.lift !== lift) { r.parts.crate.tint = BOXES[(lift * 5 + r.c * 3 + s.id) % BOXES.length]; r.lift = lift; }
    r.parts.crate.alpha = carried ? 1 : 0;
    const mid = r.c + 0.5;

    if (r.kind === "gantry") {
      const top = QUAY + BOOM_Z, up = top - 1.6;
      // Along its rails to the hold or the stack, as far as they run; the trolley out along the boom.
      const wantAlong = Math.max(-0.32, Math.min(0.32, from.a + (to.a - from.a) * across - mid));
      const wantOut = Math.max(f.depth - 1.3, Math.min(f.depth + REACH + 0.15, from.d + (to.d - from.d) * across));
      const wantHook = up - downFrom * Math.max(0, up - from.z - 0.95) - downTo * Math.max(0, up - to.z - 0.95);
      r.speed += (Math.abs(wantOut - r.out) + Math.abs(wantAlong - r.along) - r.speed) * k;
      r.along += (wantAlong - r.along) * k; r.out += (wantOut - r.out) * k; r.hook += (wantHook - r.hook) * k;
      const o = f.Q(mid, 0, 0), q = f.Q(mid + r.along, 0, 0);
      r.parts.portal.position.set(q[0] - o[0], q[1] - o[1]);
      const [tx, ty] = f.Q(mid + r.along, r.out, top);
      const swing = Math.sin(h.t * 2.4 + r.c) * Math.min(1, r.speed * 6) * 3 * sc;
      const [, hy] = f.Q(mid + r.along, r.out, r.hook);
      const hx = tx + swing, w = 0.5 * HW * sc * 0.5;
      r.parts.trolley.position.set(tx, ty);
      lay(r.bars.ropeA, [tx - 4 * sc, ty + 2 * sc], [hx - w, hy - 2 * sc]);
      lay(r.bars.ropeB, [tx + 4 * sc, ty + 2 * sc], [hx + w, hy - 2 * sc]);
      r.parts.spreader.position.set(hx, hy);
      r.parts.crate.position.set(hx, hy + 1 * sc);
      continue;
    }

    // A CRANE THAT TURNS, about its mast at (mid, pivot).
    const gear = r.gear!, top = QUAY + gear.z, up = top - 1.4;
    const polar = (a: number, d: number) => ({ turn: Math.atan2(a - mid, d - r.pivot), out: Math.min(gear.jib - 0.08, Math.max(0.3, Math.hypot(a - mid, d - r.pivot))) });
    const A = polar(from.a, from.d), B = polar(to.a, to.d);
    const wantTurn = A.turn + (turnTo(A.turn, B.turn) - A.turn) * across;
    const wantOut = A.out + (B.out - A.out) * across;
    const wantHook = up - downFrom * Math.max(0, up - from.z - gear.crate[2]) - downTo * Math.max(0, up - to.z - gear.crate[2]);
    const next = turnTo(r.turn, wantTurn);
    r.speed += (Math.abs(next - r.turn) + Math.abs(wantOut - r.out) - r.speed) * k;
    r.turn += (next - r.turn) * k; r.out += (wantOut - r.out) * k; r.hook += (wantHook - r.hook) * k;
    const sin = Math.sin(r.turn), cos = Math.cos(r.turn);
    const head = f.Q(mid, r.pivot, top), apex = f.Q(mid, r.pivot, top + (gear.tail ? 1.7 : 0.9));
    const tip = f.Q(mid + sin * gear.jib, r.pivot + cos * gear.jib, top + (gear.tail ? 0 : 0.6));
    lay(r.bars.jib, head, tip);
    lay(r.bars.stayA, apex, tip);
    lay(r.bars.king, head, apex);
    if (gear.tail) {
      const end = f.Q(mid - sin * gear.tail, r.pivot - cos * gear.tail, top);
      lay(r.bars.tail, head, end);
      lay(r.bars.stayB, apex, end);
      const [wx, wy] = f.Q(mid - sin * gear.tail * 0.8, r.pivot - cos * gear.tail * 0.8, top - 0.1);
      r.parts.weight.position.set(wx, wy + 0.8 * HEIGHT_UNIT * sc);
    }
    const jibZ = top + (gear.tail ? 0 : 0.6 * (r.out / gear.jib));
    const [tx, ty] = f.Q(mid + sin * r.out, r.pivot + cos * r.out, jibZ);
    const swing = Math.sin(h.t * 2.4 + r.c) * Math.min(1, r.speed * 5) * 3.5 * sc;
    const [, hy] = f.Q(mid + sin * r.out, r.pivot + cos * r.out, r.hook + gear.crate[2]);
    const hx = tx + swing;
    r.parts.trolley.position.set(tx, ty);
    r.parts.trolley.alpha = gear.tail ? 1 : 0;
    lay(r.bars.ropeA, [tx, ty], [hx, hy - 5 * sc]);
    r.parts.block.position.set(hx, hy);
    r.parts.crate.position.set(hx, hy + 4 * sc);
    r.parts.crate.rotation = (swing / (40 * sc)) * 0.5;
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
