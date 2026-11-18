/**
 * World v2 — the `tiles` render strategy: a house, as a stack of baked parts
 * on each cell of its footprint — a ground floor, a floor for each storey it
 * has risen, a roof — its walls in the building's own colour. A lot until
 * someone moves in. @see houses/houses-sheet
 *
 * A tall element decomposes into per-cell columns, each in its own band, the
 * only rule that stays correct when a building stands beside a taller one.
 */
import { Graphics, Sprite, type Container } from "pixi.js";

import { housedBy, residentsIn } from "../../game/housing";
import { pen } from "./project-renderer";

import { footprintCells, idx, inBounds, type Grid, type Structure } from "../grid";
import { bandOf, cellToWorld } from "../iso";
import { housePieces, housesLoaded, houseTint } from "../houses/houses-sheet";
import { kitFloors, type StructureDef } from "./def";
import { PIECE_TILE, registerRenderer, type RenderCtx, type StructureHandle, type StructureRenderer } from "./render";

type TilesHandle = StructureHandle & {
  sprites: Container[];
  /** What it was last drawn as: a site so far along, or a house of so many floors. */
  key: string;
  /** How many floors it stood at, and as what: for knowing when it has grown. */
  floors: number; def: string;
  /** How high it stands, half steps. */
  top: number;
  /** THE SCAFFOLD round it while a floor is being added or it is being rebuilt, and seconds it has left up. */
  scaffold: Graphics | null; left: number;
  /** Seconds since it was last looked at: a house that is not changing is looked at twice a second, not every frame. */
  due: number;
};
/** Seconds a scaffold stands round a house that has grown a floor, or been rebuilt a tier up. */
const SCAFFOLD_FOR = 16;
const POLE = 0xc7a24a, BOARD = 0x9a7347, NET = 0x3f86c8;

/**
 * Which mid-floor variants a building uses.
 *
 * The structure's id, so a row of identical kits does not render as a row of
 * identical buildings, and so the choice survives a save/load — the id does.
 * v1 seeds from a plot index, which is the same idea with a less stable key.
 */
const seedOf = (s: Structure) => s.id;

/**
 * Floors to draw: what the definition asks for, capped by what the kit has —
 * and for housing, AS FAR AS IT HAS FILLED: a house with a few of its people
 * in is a few floors, and it rises as the rest arrive. @see world/agents/arrivals
 */
function floorsFor(def: StructureDef, s?: Structure): number {
  const most = kitFloors(kitIdOf(def) ?? "");
  if (!most) return 0;
  // OUT OF THE WAY of what the player is aiming at: its ground floor and roof. @see cutaway
  if (s && collapsed.has(s.id)) return 1;
  const want = def.render.kind === "tiles" ? def.render.kit.floors ?? most : 0;
  const full = Math.max(1, Math.min(want, most));
  const h = housedBy(def.id);
  if (!s || !h || s.residents === undefined || h.slots <= 0) return full;
  return Math.max(1, Math.ceil((full * residentsIn(s)) / h.slots));
}

/**
 * Buildings COLLAPSED to one storey because they stand in front of what the
 * player is aiming at; set by the scene, read when a stack is built. @see cutaway
 */
const collapsed = new Set<number>();
export const setCollapsed = (id: number, down: boolean) => { if (down) collapsed.add(id); else collapsed.delete(id); };
export const isCollapsed = (id: number) => collapsed.has(id);

/** District colours, for a lot's sign. */
const LOT_SIGN: Record<string, number> = { intern: 0xf2b51d, vibe_coder: 0xff4fa3, "10x_dev": 0x2fb8a8 };
const LOT_EARTH = 0xb59a6e;
const LOT_EARTH_EDGE = 0x8f7650;
const STAKE = 0xf4efe2;
const STAKE_TAPE = 0xe0533b;
const POST = 0x6d4a2a;

/**
 * A LOT, zoned and empty: the ground scraped, a stake at each corner with tape
 * between, and a sign in its district's colour — somewhere for a new hire to
 * move in, and plainly not yet anywhere. @see Structure.residents
 */
/**
 * `done`, how far its servicing has got, nought to one: the ground scraped as the work starts; a stake at a time,
 * then the tape round them; a trench in from the front with its pipe in it; the trench filled, and the pipes'
 * capped ends left standing at the plot; and last the sign. Whole, a lot as it has always been — and serviced.
 */
function drawLot(s: Structure, ctx: RenderCtx, done = 1): Graphics {
  const g = new Graphics();
  const { quad, box, line, P } = pen(g, s, ctx, 0);
  const x0 = s.x - 0.5 + 0.08, x1 = s.x + s.w - 0.5 - 0.08, y0 = s.y - 0.5 + 0.08, y1 = s.y + s.h - 0.5 - 0.08;
  const part = (a: number, b: number) => Math.max(0, Math.min(1, (done - a) / (b - a)));
  quad([P(x0, y0, 0.02), P(x1, y0, 0.02), P(x1, y1, 0.02), P(x0, y1, 0.02)], LOT_EARTH, 0.35 + 0.65 * part(0, 0.15));
  line([[x0, y1, 0.02], [x1, y1, 0.02], [x1, y0, 0.02]], LOT_EARTH_EDGE, 1);
  // THE SERVICES: a trench from the front edge to the middle of the plot, a pipe in it; then made good, the scar of it left.
  const tu = s.x - 0.12, open = part(0.3, 0.55), filled = part(0.62, 0.8);
  if (open > 0) {
    const v0 = y1 - (y1 - s.y) * open;
    quad([P(tu - 0.07, v0, 0.025), P(tu + 0.07, v0, 0.025), P(tu + 0.07, y1, 0.025), P(tu - 0.07, y1, 0.025)], filled >= 1 ? 0x9a8058 : 0x3a2a1c);
    if (filled < 1) quad([P(tu - 0.025, v0 + 0.02, 0.03), P(tu + 0.025, v0 + 0.02, 0.03), P(tu + 0.025, y1 - (y1 - s.y) * filled, 0.03), P(tu - 0.025, y1 - (y1 - s.y) * filled, 0.03)], 0x4f79a8);
    if (filled > 0 && filled < 1) quad([P(tu - 0.07, y1 - (y1 - s.y) * filled, 0.028), P(tu + 0.07, y1 - (y1 - s.y) * filled, 0.028), P(tu + 0.07, y1, 0.028), P(tu - 0.07, y1, 0.028)], 0x9a8058);
  }
  // Its pipes' ends, capped, where the house will take them: water and waste.
  if (part(0.55, 0.62) >= 1) {
    box(tu - 0.06, s.y - 0.03, tu - 0.02, s.y + 0.01, 0, 0.32, 0x4f79a8, 0x4f79a8, 0x8fb4dc);
    box(tu + 0.02, s.y - 0.03, tu + 0.06, s.y + 0.01, 0, 0.26, 0x7b6a55, 0x7b6a55, 0xa8977f);
  }
  // Tape round, at knee height, then the stakes over it — a stake at a time as the plot is set out.
  const stakes = Math.round(part(0.04, 0.24) * 4), corners: [number, number][] = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
  if (part(0.24, 0.3) >= 1) line([[x0, y0, 0.45], [x1, y0, 0.45], [x1, y1, 0.45], [x0, y1, 0.45], [x0, y0, 0.45]], STAKE_TAPE, 1);
  corners.slice(0, stakes).forEach(([u, v]) => box(u - 0.025, v - 0.025, u + 0.025, v + 0.025, 0, 0.6, STAKE, STAKE, STAKE_TAPE));
  g.eventMode = "none";
  if (part(0.85, 0.9) < 1) return g;
  // The sign, on two posts near the front.
  const sign = LOT_SIGN[housedBy(s.def)?.id ?? ""] ?? 0xdddddd;
  const su = s.x + 0.1, sv = s.y + 0.22;
  for (const u of [su - 0.16, su + 0.16]) box(u - 0.015, sv - 0.015, u + 0.015, sv + 0.015, 0, 1.2, POST, POST, POST);
  box(su - 0.22, sv - 0.02, su + 0.22, sv + 0.02, 1.2, 2.1, sign, sign, sign);
  line([[su - 0.15, sv + 0.021, 1.45], [su + 0.15, sv + 0.021, 1.45]], 0xffffff, 1.5);
  line([[su - 0.1, sv + 0.021, 1.8], [su + 0.12, sv + 0.021, 1.8]], 0xffffff, 1.5);
  g.eventMode = "none";
  return g;
}

const kitIdOf = (def: StructureDef) =>
  def.render.kind === "tiles" ? def.render.kit.kit : null;

/**
 * Ground height a structure stands on.
 *
 * Read from the grid rather than stored on the record: placement levels the
 * footprint, so every cell agrees, and reading it means a later height edit
 * under the building moves the building instead of leaving it floating.
 */
function groundHeight(grid: Grid, s: Structure): number {
  return inBounds(grid, s.x, s.y) ? grid.height[idx(grid, s.x, s.y)] : 0;
}

function buildSprites(
  s: Structure,
  def: StructureDef,
  ctx: RenderCtx,
): Container[] {
  // Nobody lives here yet: a lot, not a building — as far as its servicing has got, while that is going on.
  if ((s.residents === 0 || s.build) && housedBy(def.id)) {
    const g = drawLot(s, ctx, s.build ? Math.min(1, s.build.done / s.build.need) : 1);
    ctx.bands.structureOf[bandOf(s.x, s.y)].addChild(g);
    return [g];
  }
  const kitId = kitIdOf(def);
  // THE SHEET, if it is in: the scene loads it before it builds, so a house is never mounted bare.
  const H = housesLoaded(), look = kitId ? H?.kits.get(kitId) : undefined;
  if (!H || !look || !kitId) return [];
  const h = groundHeight(ctx.grid, s);
  const out: Container[] = [];
  const pieces = housePieces(look, kitId, floorsFor(def, s), seedOf(s)), tint = houseTint(kitId, seedOf(s));
  // Lowest first, so insertion order alone stacks the column.
  for (const cell of footprintCells(s.x, s.y, s.w, s.h)) {
    if (!inBounds(ctx.grid, cell.x, cell.y)) continue;
    const { wx, wy } = cellToWorld(cell.x, cell.y, h, ctx.scale);
    const parent = ctx.bands.structureOf[bandOf(cell.x, cell.y)];
    for (const p of pieces) {
      const sp = new Sprite(p.tex);
      sp.anchor.set(p.anchor.x, p.anchor.y);
      sp.position.set(wx, wy - p.lift * ctx.scale);
      sp.scale.set(ctx.scale / H.res);
      if (p.walls) sp.tint = tint;
      sp.eventMode = "none";
      parent.addChild(sp);
      PIECE_TILE.set(sp, cell);
      out.push(sp);
    }
  }
  return out;
}

const destroyAll = (sprites: Container[]) => {
  for (const sp of sprites) {
    sp.parent?.removeChild(sp);
    sp.destroy();
  }
  sprites.length = 0;
};

/** What a structure is drawn as now: a change of it is a redraw. */
const keyOf = (s: Structure, def: StructureDef) =>
  s.build && housedBy(def.id) ? `site|${Math.floor((s.build.done / s.build.need) * 24)}` : `${def.id}|${s.residents === 0 ? "lot" : floorsFor(def, s)}`;
/** How high a house of so many floors stands, half steps: for the scaffold round it. */
const topOf = (def: StructureDef, s: Structure) => 1.2 + floorsFor(def, s) * 3.1;

/**
 * THE SCAFFOLD round a house being built up: poles at its corners and along its two near sides, a boarded lift at
 * every floor, braced, and netting over the top lift where the work is.
 */
function drawScaffold(s: Structure, ctx: RenderCtx, top: number): Graphics {
  const g = new Graphics();
  const { quad, line, P } = pen(g, s, ctx, 0);
  const x0 = s.x - 0.5 + 0.02, x1 = s.x + s.w - 0.5 - 0.02, y0 = s.y - 0.5 + 0.02, y1 = s.y + s.h - 0.5 - 0.02, H = top + 0.6;
  // The far poles first, then the two near faces.
  for (const [u, v] of [[x0, y0], [x1, y0], [x0, y1]]) line([[u, v, 0], [u, v, H]], POLE, 1.4);
  for (let z = 3.1; z < H; z += 3.1) {
    quad([P(x0, y1, z), P(x1, y1, z), P(x1, y1, z + 0.14), P(x0, y1, z + 0.14)], BOARD);
    quad([P(x1, y0, z), P(x1, y1, z), P(x1, y1, z + 0.14), P(x1, y0, z + 0.14)], BOARD, 0.85);
  }
  quad([P(x0, y1, Math.max(0, H - 3.6)), P(x1, y1, Math.max(0, H - 3.6)), P(x1, y1, H), P(x0, y1, H)], NET, 0.28);
  quad([P(x1, y0, Math.max(0, H - 3.6)), P(x1, y1, Math.max(0, H - 3.6)), P(x1, y1, H), P(x1, y0, H)], NET, 0.22);
  for (let k = 0; k <= 2; k++) {
    const u = x0 + ((x1 - x0) * k) / 2, v = y0 + ((y1 - y0) * k) / 2;
    line([[u, y1, 0], [u, y1, H]], POLE, 1.4);
    line([[x1, v, 0], [x1, v, H]], POLE, 1.4);
  }
  line([[x0, y1, 0], [x1, y1, Math.min(H, 3.1)]], POLE, 1);
  line([[x1, y1, 0], [x1, y0, Math.min(H, 3.1)]], POLE, 1);
  line([[x0, y1, H], [x1, y1, H], [x1, y0, H]], POLE, 1.4);
  g.eventMode = "none";
  return g;
}
const strike = (h: TilesHandle) => { h.scaffold?.parent?.removeChild(h.scaffold); h.scaffold?.destroy(); h.scaffold = null; h.left = 0; };
/** Draw it again as it is now; and if it has GROWN — a floor more, or a tier up — put a scaffold round it for a while. */
function redraw(h: TilesHandle, s: Structure, def: StructureDef, ctx: RenderCtx, grew: boolean) {
  destroyAll(h.sprites);
  h.sprites.push(...buildSprites(s, def, ctx));
  h.key = keyOf(s, def); h.floors = floorsFor(def, s); h.def = def.id; h.top = topOf(def, s);
  const house = !!housedBy(def.id) && !s.build && s.residents !== 0;
  if (h.scaffold) { const left = h.left; strike(h); if (house) h.left = left; }
  if (house && (grew || h.left > 0)) {
    if (grew) h.left = SCAFFOLD_FOR;
    h.scaffold = drawScaffold(s, ctx, h.top);
    // Over its own sprites, in the band of its front corner.
    ctx.bands.structureOf[bandOf(s.x + s.w - 1, s.y + s.h - 1)].addChild(h.scaffold);
  }
}

export const tilesRenderer: StructureRenderer = {
  mount(s, def, ctx) {
    const sprites = buildSprites(s, def, ctx);
    const handle: TilesHandle = {
      sprites, key: keyOf(s, def), floors: floorsFor(def, s), def: def.id, top: topOf(def, s), scaffold: null, left: 0, due: 0,
      destroy: () => { destroyAll(sprites); strike(handle); },
    };
    return handle;
  },

  /** Rebuilt rather than repositioned: a stack is a handful of sprites, and an update is an edit, not a frame. */
  update(h, s, def, ctx) {
    const handle = h as TilesHandle;
    // GROWN: more floors than it stood at, or the same plot a tier up — somebody has been building. (Not a lot's first house: that is a house arriving.)
    const grew = !s.build && s.residents !== 0 && handle.key.indexOf("lot") < 0 && handle.key.indexOf("site") < 0
      && (floorsFor(def, s) > handle.floors || (def.id !== handle.def && !!housedBy(def.id)));
    redraw(handle, s, def, ctx, grew);
  },

  /**
   * A lot being serviced is drawn again as the work moves on; a scaffold comes down when its time is up; and a
   * house is looked at twice a second for having grown — its residents arrive without the map being edited.
   */
  tick(h, s, def, ctx, dt) {
    const handle = h as TilesHandle;
    if (handle.scaffold) { handle.left -= dt; if (handle.left <= 0) strike(handle); }
    handle.due += dt;
    if (!s.build && handle.due < 0.5) return;
    handle.due = 0;
    if (keyOf(s, def) !== handle.key) tilesRenderer.update(handle, s, def, ctx);
  },

  unmount(h) {
    h.destroy();
  },
  pieces(h) { const handle = h as TilesHandle; return handle.scaffold ? [...handle.sprites, handle.scaffold] : [...handle.sprites]; },
};

registerRenderer("tiles", tilesRenderer);

/** Sprite count a structure would draw — for tests and the debug readout. */
export const tileSpriteCount = (h: StructureHandle) => (h as TilesHandle).sprites.length;
