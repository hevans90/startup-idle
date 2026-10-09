/**
 * World v2 — the `tiles` render strategy: a stack of sprites per cell.
 *
 * The stack itself comes from `composeBuilding` in `src/iso/kits.ts`, which v1
 * also calls. That is the whole reason Phase 0 moved it there: the rules for
 * which frame sits on which floor, and how far each one lifts, are ART facts
 * and must not fork between the two renderers.
 *
 * What is new here is the DEPTH treatment. A tall element decomposes into
 * per-cell columns, each in its own band, which is the rule §4 states and the
 * only one that stays correct when a building stands beside a taller one. v1
 * instead sorts every sprite in one container by `cityDepthKey`, which is the
 * same ordering arrived at globally — and re-sorted whenever anything changes.
 */
import { Graphics, Sprite, type Container, type Texture } from "pixi.js";

import { housedBy, residentsIn } from "../../game/housing";
import { pen } from "./project-renderer";

import { composeBuilding } from "../../iso/kits";
import { footprintCells, idx, inBounds, type Grid, type Structure } from "../grid";
import { GROUND_FRAME_H, bandOf, cellToWorld, spriteY } from "../iso";
import { kitByName, type StructureDef } from "./def";
import { registerRenderer, type RenderCtx, type StructureHandle, type StructureRenderer } from "./render";

type TilesHandle = StructureHandle & { sprites: Container[] };

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
  const kit = kitByName(kitIdOf(def) ?? "");
  if (!kit) return 0;
  const want = def.render.kind === "tiles" ? def.render.kit.floors ?? kit.maxFloors : 0;
  const full = Math.max(1, Math.min(want, kit.maxFloors));
  const h = housedBy(def.id);
  if (!s || !h || s.residents === undefined || h.slots <= 0) return full;
  return Math.max(1, Math.ceil((full * residentsIn(s)) / h.slots));
}

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
function drawLot(s: Structure, ctx: RenderCtx): Graphics {
  const g = new Graphics();
  const { quad, box, line, P } = pen(g, s, ctx, 0);
  const x0 = s.x - 0.5 + 0.08, x1 = s.x + s.w - 0.5 - 0.08, y0 = s.y - 0.5 + 0.08, y1 = s.y + s.h - 0.5 - 0.08;
  quad([P(x0, y0, 0.02), P(x1, y0, 0.02), P(x1, y1, 0.02), P(x0, y1, 0.02)], LOT_EARTH);
  line([[x0, y1, 0.02], [x1, y1, 0.02], [x1, y0, 0.02]], LOT_EARTH_EDGE, 1);
  // Tape round, at knee height, then the stakes over it.
  line([[x0, y0, 0.45], [x1, y0, 0.45], [x1, y1, 0.45], [x0, y1, 0.45], [x0, y0, 0.45]], STAKE_TAPE, 1);
  for (const [u, v] of [[x0, y0], [x1, y0], [x0, y1], [x1, y1]]) box(u - 0.025, v - 0.025, u + 0.025, v + 0.025, 0, 0.6, STAKE, STAKE, STAKE_TAPE);
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
  // Nobody lives here yet: a lot, not a building.
  if (s.residents === 0 && housedBy(def.id)) {
    const g = drawLot(s, ctx);
    ctx.bands.structureOf[bandOf(s.x, s.y)].addChild(g);
    return [g];
  }
  const kitId = kitIdOf(def);
  const kit = kitId ? kitByName(kitId) : null;
  if (!kit) return [];
  const parts = composeBuilding(kit, floorsFor(def, s), seedOf(s));
  const h = groundHeight(ctx.grid, s);
  const out: Container[] = [];

  // EVERY PART STANDS WHERE THE CELL'S TERRAIN TILE DOES, lifted by its own
  // `lift`: the building art is drawn to share one bottom with a terrain tile,
  // which is how v1 places terrain and buildings alike — all at one point.
  //  - Each part anchored by its OWN frame's height put a frame shorter than
  //    the ground tile — a roof, a cap — higher by the difference, on top of
  //    its lift, and every stack's upper floors floated off over the road.
  //  - Anchored by the building's ground frame, which is taller than a
  //    terrain frame, sank the whole stack into its tile by the difference.
  for (const cell of footprintCells(s.x, s.y, s.w, s.h)) {
    if (!inBounds(ctx.grid, cell.x, cell.y)) continue;
    const { wx, wy } = cellToWorld(cell.x, cell.y, h, ctx.scale);
    const parent = ctx.bands.structureOf[bandOf(cell.x, cell.y)];
    const base = spriteY(wy, GROUND_FRAME_H, ctx.scale);
    // Ground floor first, so insertion order alone stacks the column: each
    // higher part is added later and therefore draws over the one below.
    for (const part of parts) {
      const tex: Texture | undefined = ctx.textures[part.spriteId];
      if (!tex) continue;                       // a kit naming a missing frame
      const sp = new Sprite(tex);
      sp.anchor.set(0.5, 1);
      sp.roundPixels = true;
      sp.x = wx;
      sp.y = base - part.lift * ctx.scale;
      sp.scale.set(ctx.scale);
      parent.addChild(sp);
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

export const tilesRenderer: StructureRenderer = {
  mount(s, def, ctx) {
    const sprites = buildSprites(s, def, ctx);
    const handle: TilesHandle = { sprites, destroy: () => destroyAll(sprites) };
    return handle;
  },

  /**
   * Rebuilt rather than repositioned.
   *
   * A stack is a handful of sprites and an update happens on an edit, not per
   * frame; moving each one in place would mean re-deriving which sprite is
   * which part, and the bug that hides in that is a building whose floors drift
   * apart. Cheap and total beats clever here.
   */
  update(h, s, def, ctx) {
    const handle = h as TilesHandle;
    destroyAll(handle.sprites);
    handle.sprites.push(...buildSprites(s, def, ctx));
  },

  unmount(h) {
    h.destroy();
  },
};

registerRenderer("tiles", tilesRenderer);

/** Sprite count a structure would draw — for tests and the debug readout. */
export const tileSpriteCount = (h: StructureHandle) => (h as TilesHandle).sprites.length;
