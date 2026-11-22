/**
 * World v2 — the `tiles` render strategy: a house, as a stack of baked parts
 * on each cell of its footprint — a ground floor, a floor for each storey it
 * has risen, a roof — its walls in the building's own colour. A lot until
 * someone moves in, put down whole. @see houses/houses-sheet
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
import { fadeWithSnow } from "../render/snow-cover";
import { frontOf, shopKeyOf, shopPaint } from "../render/shopfronts";
import { kitFloors, type StructureDef } from "./def";
import { PIECE_TILE, registerRenderer, type RenderCtx, type StructureHandle, type StructureRenderer } from "./render";

type TilesHandle = StructureHandle & {
  sprites: Container[];
  /** What it was last drawn as: a lot, or a house of so many floors. */
  key: string;
  /** Seconds since it was last looked at: a house that is not changing is looked at twice a second, not every frame. */
  due: number;
};

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
export function floorsFor(def: StructureDef, s?: Structure, standing = false): number {
  const most = kitFloors(kitIdOf(def) ?? "");
  if (!most) return 0;
  // OUT OF THE WAY of what the player is aiming at: its ground floor and roof. @see cutaway
  // (`standing`: as it stands, cut away or not — what throws its shadow. @see render/casters)
  if (s && !standing && collapsed.has(s.id)) return 1;
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
/** The buildings cut down now. @see render/lit-windows */
export const collapsedNow = (): ReadonlySet<number> => collapsed;

/** District colours, for a lot's sign. */
const LOT_SIGN: Record<string, number> = { intern: 0xf2b51d, vibe_coder: 0xff4fa3, "10x_dev": 0x2fb8a8 };
const LOT_EARTH = 0xb59a6e;
const LOT_EARTH_EDGE = 0x8f7650;
const STAKE = 0xf4efe2;
const STAKE_TAPE = 0xe0533b;
const POST = 0x6d4a2a;

/**
 * A LOT, zoned and empty: the ground scraped, a stake at each corner with tape
 * between, its pipes' capped ends at the plot, and a sign in its district's
 * colour — somewhere for a new hire to move in, and plainly not yet anywhere.
 * Put down whole: no gang sets it out. @see Structure.residents
 */
function drawLot(s: Structure, ctx: RenderCtx): Graphics {
  const g = new Graphics();
  const { quad, box, line, P } = pen(g, s, ctx, 0);
  const x0 = s.x - 0.5 + 0.08, x1 = s.x + s.w - 0.5 - 0.08, y0 = s.y - 0.5 + 0.08, y1 = s.y + s.h - 0.5 - 0.08;
  quad([P(x0, y0, 0.02), P(x1, y0, 0.02), P(x1, y1, 0.02), P(x0, y1, 0.02)], LOT_EARTH);
  line([[x0, y1, 0.02], [x1, y1, 0.02], [x1, y0, 0.02]], LOT_EARTH_EDGE, 1);
  // Its pipes' ends, capped, where the house will take them: water and waste; the scar of their trench in from the front.
  const tu = s.x - 0.12;
  quad([P(tu - 0.07, s.y, 0.025), P(tu + 0.07, s.y, 0.025), P(tu + 0.07, y1, 0.025), P(tu - 0.07, y1, 0.025)], 0x9a8058);
  box(tu - 0.06, s.y - 0.03, tu - 0.02, s.y + 0.01, 0, 0.32, 0x4f79a8, 0x4f79a8, 0x8fb4dc);
  box(tu + 0.02, s.y - 0.03, tu + 0.06, s.y + 0.01, 0, 0.26, 0x7b6a55, 0x7b6a55, 0xa8977f);
  // Tape round, at knee height, then the stakes over it.
  line([[x0, y0, 0.45], [x1, y0, 0.45], [x1, y1, 0.45], [x0, y1, 0.45], [x0, y0, 0.45]], STAKE_TAPE, 1);
  for (const [u, v] of [[x0, y0], [x1, y0], [x1, y1], [x0, y1]]) box(u - 0.025, v - 0.025, u + 0.025, v + 0.025, 0, 0.6, STAKE, STAKE, STAKE_TAPE);
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

export const kitIdOf = (def: StructureDef) =>
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
  // Nobody lives here yet: a lot, not a building.
  if ((s.residents === 0 || s.build) && housedBy(def.id)) {
    const g = drawLot(s, ctx);
    ctx.bands.structureOf[bandOf(s.x, s.y)].addChild(g);
    return [g];
  }
  const kitId = kitIdOf(def);
  // THE SHEET, if it is in: the scene loads it before it builds, so a house is never mounted bare.
  const H = housesLoaded(), look = kitId ? H?.kits.get(kitId) : undefined;
  if (!H || !look || !kitId) return [];
  const h = groundHeight(ctx.grid, s);
  const out: Container[] = [];
  // A SHOP in its ground floor: that ground floor, its front on the shop's face, painted the trade's. @see shopfronts
  const front = frontOf(ctx.grid, s);
  // (Cut down to see past it, it is left open: its ground floor, and no roof set on that. @see cutaway)
  const pieces = housePieces(look, kitId, floorsFor(def, s), seedOf(s), front && shopKeyOf(front), collapsed.has(s.id)), tint = houseTint(kitId, seedOf(s));
  const paint = front ? shopPaint(front.sv) : 0xffffff;
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
      else if (p.paint) sp.tint = paint;
      if (p.snow) fadeWithSnow(sp);
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
const keyOf = (s: Structure, def: StructureDef, g: Grid) => {
  if ((s.residents === 0 || s.build) && housedBy(def.id)) return `${def.id}|lot`;
  const f = frontOf(g, s);
  return `${def.id}|${floorsFor(def, s)}|${f ? `${f.sv}:${shopKeyOf(f)}` : ""}`;
};

/** Draw it again as it is now. */
function redraw(h: TilesHandle, s: Structure, def: StructureDef, ctx: RenderCtx) {
  destroyAll(h.sprites);
  h.sprites.push(...buildSprites(s, def, ctx));
  h.key = keyOf(s, def, ctx.grid);
}

export const tilesRenderer: StructureRenderer = {
  mount(s, def, ctx) {
    const sprites = buildSprites(s, def, ctx);
    const handle: TilesHandle = { sprites, key: keyOf(s, def, ctx.grid), due: 0, destroy: () => destroyAll(sprites) };
    return handle;
  },

  /**
   * Rebuilt rather than repositioned: a stack is a handful of sprites, and an update is an edit, not a frame. Only
   * its sprites: the cutaway lowers and raises a house through here, and that is no change to the house. @see cutaway
   */
  update(h, s, def, ctx) {
    redraw(h as TilesHandle, s, def, ctx);
  },

  /** A house is looked at twice a second for having grown: its residents arrive without the map being edited. */
  tick(h, s, def, ctx, dt) {
    const handle = h as TilesHandle;
    handle.due += dt;
    if (handle.due < 0.5) return;
    handle.due = 0;
    if (keyOf(s, def, ctx.grid) !== handle.key) tilesRenderer.update(handle, s, def, ctx);
  },

  unmount(h) {
    h.destroy();
  },
  pieces(h) { return [...(h as TilesHandle).sprites]; },
};

registerRenderer("tiles", tilesRenderer);

/** Sprite count a structure would draw — for tests and the debug readout. */
export const tileSpriteCount = (h: StructureHandle) => (h as TilesHandle).sprites.length;
