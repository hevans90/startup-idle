/**
 * World v2 — the mounted-structure layer.
 *
 * Holds one handle per placed structure and reconciles that set against the
 * grid. Structures are few — tens, not thousands — so this walks the whole map
 * of records rather than maintaining a dirty set of its own; the expensive part
 * is mounting, and that only happens for a record that actually appeared.
 *
 * The layer deliberately knows nothing about how anything DRAWS. It mounts,
 * updates and unmounts through the registry, which is what lets the pit and a
 * tower share one lifecycle.
 */
import { structureDef } from "./def";
import { rendererFor, type RenderCtx, type StructureHandle, type StructureRenderer } from "./render";
import type { Grid, Structure } from "../grid";

type Mounted = {
  handle: StructureHandle;
  renderer: StructureRenderer;
  /** The record as mounted, to detect a moved or replaced structure. */
  s: Structure;
};

export type StructureLayer = {
  mounted: Map<number, Mounted>;
  /** Structures whose definition or renderer is missing — reported, not hidden. */
  unrenderable: number;
};

export const createStructureLayer = (): StructureLayer => ({
  mounted: new Map(),
  unrenderable: 0,
});

function mountOne(sl: StructureLayer, ctx: RenderCtx, s: Structure): void {
  const def = structureDef(s.def);
  const renderer = def ? rendererFor(def) : null;
  if (!def || !renderer) {
    sl.unrenderable++;
    return;
  }
  sl.mounted.set(s.id, { handle: renderer.mount(s, def, ctx), renderer, s });
}

function unmountOne(sl: StructureLayer, id: number): void {
  const m = sl.mounted.get(id);
  if (!m) return;
  m.renderer.unmount(m.handle);
  sl.mounted.delete(id);
}

/**
 * Reconcile the mounted set against the grid: mount what appeared, unmount what
 * went, and re-mount anything whose record was replaced under the same id.
 *
 * Called after every edit rather than only after a structure edit. It is a walk
 * over a handful of records, and the alternative — trusting the caller to say
 * when structures changed — is exactly the kind of seam that let Phase 4's
 * component count go stale.
 */
export function syncStructures(sl: StructureLayer, ctx: RenderCtx): void {
  sl.unrenderable = 0;
  for (const [id, m] of sl.mounted) {
    const live = ctx.grid.structures.get(id);
    if (!live) unmountOne(sl, id);
    else if (live !== m.s) { unmountOne(sl, id); mountOne(sl, ctx, live); }
  }
  for (const s of ctx.grid.structures.values()) {
    if (!sl.mounted.has(s.id)) mountOne(sl, ctx, s);
  }
}

/**
 * Re-draw the structures standing on any of these cells.
 *
 * For a height edit UNDER a building: the sprites are positioned from the
 * ground they stand on, so the ground moving means they move. Driven by the
 * editor's dirty cells, so a stroke nowhere near a building costs nothing.
 */
export function refreshStructuresAt(
  sl: StructureLayer,
  ctx: RenderCtx,
  cells: readonly { x: number; y: number }[],
): void {
  if (!sl.mounted.size || !cells.length) return;
  const hit = new Set<number>();
  for (const c of cells) {
    const id = idAt(ctx.grid, c.x, c.y);
    if (id >= 0 && sl.mounted.has(id)) hit.add(id);
  }
  for (const id of hit) {
    const m = sl.mounted.get(id)!;
    const def = structureDef(m.s.def);
    if (def) m.renderer.update(m.handle, m.s, def, ctx);
  }
}

const idAt = (g: Grid, x: number, y: number) =>
  x >= 0 && y >= 0 && x < g.w && y < g.h ? g.structureAt[y * g.w + x] : -1;

/**
 * Advance every animated structure by `dt` seconds.
 *
 * Driven from the scene's ticker. Costs one map lookup when nothing on the map
 * animates, because a renderer without a `tick` is skipped outright.
 */
export function tickStructures(sl: StructureLayer, ctx: RenderCtx, dt: number): void {
  for (const m of sl.mounted.values()) {
    if (!m.renderer.tick) continue;
    const def = structureDef(m.s.def);
    if (def) m.renderer.tick(m.handle, m.s, def, ctx, dt);
  }
}

/** Whether anything on the map needs a per-frame tick at all. */
export const hasAnimated = (sl: StructureLayer) => {
  for (const m of sl.mounted.values()) if (m.renderer.tick) return true;
  return false;
};

/** Unmount everything. For a map reload or a teardown. */
export function clearStructureLayer(sl: StructureLayer): void {
  for (const id of [...sl.mounted.keys()]) unmountOne(sl, id);
  sl.unrenderable = 0;
}

export const mountedCount = (sl: StructureLayer) => sl.mounted.size;
