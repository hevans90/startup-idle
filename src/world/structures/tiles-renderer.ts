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
import { Sprite, type Texture } from "pixi.js";

import { composeBuilding } from "../../iso/kits";
import { footprintCells, idx, inBounds, type Grid, type Structure } from "../grid";
import { bandOf, cellToWorld, spriteY } from "../iso";
import { kitByName, type StructureDef } from "./def";
import { registerRenderer, type RenderCtx, type StructureHandle, type StructureRenderer } from "./render";

type TilesHandle = StructureHandle & { sprites: Sprite[] };

/**
 * Which mid-floor variants a building uses.
 *
 * The structure's id, so a row of identical kits does not render as a row of
 * identical buildings, and so the choice survives a save/load — the id does.
 * v1 seeds from a plot index, which is the same idea with a less stable key.
 */
const seedOf = (s: Structure) => s.id;

/** Floors to draw: what the definition asks for, capped by what the kit has. */
function floorsFor(def: StructureDef): number {
  const kit = kitByName(kitIdOf(def) ?? "");
  if (!kit) return 0;
  const want = def.render.kind === "tiles" ? def.render.kit.floors ?? kit.maxFloors : 0;
  return Math.max(1, Math.min(want, kit.maxFloors));
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
): Sprite[] {
  const kitId = kitIdOf(def);
  const kit = kitId ? kitByName(kitId) : null;
  if (!kit) return [];
  const parts = composeBuilding(kit, floorsFor(def), seedOf(s));
  const h = groundHeight(ctx.grid, s);
  const out: Sprite[] = [];

  for (const cell of footprintCells(s.x, s.y, s.w, s.h)) {
    if (!inBounds(ctx.grid, cell.x, cell.y)) continue;
    const { wx, wy } = cellToWorld(cell.x, cell.y, h, ctx.scale);
    const parent = ctx.bands.structureOf[bandOf(cell.x, cell.y)];
    // Ground floor first, so insertion order alone stacks the column: each
    // higher part is added later and therefore draws over the one below.
    for (const part of parts) {
      const tex: Texture | undefined = ctx.textures[part.spriteId];
      if (!tex) continue;                       // a kit naming a missing frame
      const sp = new Sprite(tex);
      sp.anchor.set(0.5, 1);
      sp.roundPixels = true;
      sp.x = wx;
      sp.y = spriteY(wy, tex.height, ctx.scale) - part.lift * ctx.scale;
      sp.scale.set(ctx.scale);
      parent.addChild(sp);
      out.push(sp);
    }
  }
  return out;
}

const destroyAll = (sprites: Sprite[]) => {
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
