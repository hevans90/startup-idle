/**
 * World v2 — the renderer registry.
 *
 * One interface per drawing STRATEGY, chosen by a definition's `render.kind`.
 * This is the abstraction v1 is missing: the slop pit is a renderer, but it is
 * inlined into `GroundRoadLayer` and hardcoded to one instance, so a second
 * excavation — or any structure that is not a stack of tiles — has nowhere to
 * live.
 *
 * `mount` / `update` / `unmount` rather than a single draw call, because the
 * band containers are retained: a structure's sprites persist between frames
 * and are reconciled in place, the same as terrain and roads.
 */
import type { Texture } from "pixi.js";

import type { Grid, Structure } from "../grid";
import type { BandLayer } from "../render/bands";
import type { RenderSpec, StructureDef } from "./def";

/** What every renderer is given. Deliberately small: containers, art, scale. */
export type RenderCtx = {
  bands: BandLayer;
  textures: Record<string, Texture>;
  grid: Grid;
  scale: number;
};

/**
 * Whatever a renderer needs to find its own sprites again.
 *
 * Opaque to the layer, which only stores it and hands it back. A renderer that
 * needs more than sprites — a simulation, a mesh — keeps it here rather than in
 * a module-level variable, which is what makes a second instance possible.
 */
export type StructureHandle = {
  /** Everything to destroy on unmount. Renderers may add their own fields. */
  destroy: () => void;
};

export type StructureRenderer = {
  mount(s: Structure, def: StructureDef, ctx: RenderCtx): StructureHandle;
  /** Reposition or restyle in place — a height edit under the footprint, say. */
  update(h: StructureHandle, s: Structure, def: StructureDef, ctx: RenderCtx): void;
  /**
   * Advance by `dt` seconds. OPTIONAL, and absent on everything static.
   *
   * A building is a stack of sprites that never moves, and a per-frame hook it
   * does not need is a per-frame cost it should not pay — so the layer only
   * calls this on strategies that declare it, and asks nothing of the rest.
   */
  tick?(h: StructureHandle, s: Structure, def: StructureDef, ctx: RenderCtx, dt: number): void;
  unmount(h: StructureHandle): void;
};

const byKind = new Map<RenderSpec["kind"], StructureRenderer>();
const byCustomId = new Map<string, StructureRenderer>();

/** Register a strategy. Called once per renderer module, at import. */
export function registerRenderer(kind: RenderSpec["kind"], r: StructureRenderer) {
  byKind.set(kind, r);
}

/** Register a `kind: "custom"` renderer under its `rendererId`. */
export function registerCustomRenderer(id: string, r: StructureRenderer) {
  byCustomId.set(id, r);
}

/**
 * The renderer for a definition, or null.
 *
 * Null rather than a throw: a map may name a structure whose renderer has not
 * shipped yet, and refusing to draw one building is better than refusing to
 * draw the world.
 */
export function rendererFor(def: StructureDef): StructureRenderer | null {
  if (def.render.kind === "custom") return byCustomId.get(def.render.rendererId) ?? null;
  return byKind.get(def.render.kind) ?? null;
}

/** Registered strategy names — for the debug panel, and for tests. */
export const registeredKinds = () => [...byKind.keys()];
