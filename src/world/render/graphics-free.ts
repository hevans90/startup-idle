/**
 * World v2 — A DESTROYED GRAPHICS LETS GO OF ITS SHAPES.
 *
 * Pixi's `Graphics.destroy(options)` destroys the shapes it owns only when
 * given NO options: `destroy({ children: true })`, which is how a layer here is
 * cleared, leaves the context standing in the renderer's table with its
 * geometry, and with the renderer's own collection off nothing ever takes it
 * out. The street's props alone were 140 a second in a busy town: 33,000
 * contexts at half an hour, a gigabyte and a half, and the tab dead in the hour.
 *
 * So a Graphics that owns its context destroys it, whatever it was told.
 * @see plans/ai-mode-rebuild.md, the play-through
 */
import { Graphics, GraphicsContext } from "pixi.js";

type Owner = { _ownedContext?: { destroyed?: boolean; destroy: () => void } | null };
type Patched = { __frees?: boolean };

/** Have every Graphics destroy the context it owns when it is destroyed. Once. */
export function freeGraphicsContexts(): void {
  const proto = Graphics.prototype as unknown as Patched & { destroy: (options?: unknown) => void };
  if (proto.__frees) return;
  proto.__frees = true;
  const destroy = proto.destroy;
  proto.destroy = function (this: Owner, options?: unknown) {
    const own = this._ownedContext;
    destroy.call(this, options);
    if (own && !own.destroyed) own.destroy();
  };
}

type Clearable = { instructions: unknown[]; _activePath?: { instructions?: unknown[] }; resetTransform: () => void };

/**
 * AN EMPTY GRAPHICS CLEARED IS LEFT AS IT WAS. Pixi marks a context changed at every `clear()`, drawn on or not,
 * and a changed Graphics that batches has the draw list of the render group it is in built again. The layers that
 * clear every frame before drawing what there is to draw — the holograms' scan, the AI's plans, the mains' water,
 * the overlays — mostly have nothing, and the map's own group was rebuilt every frame for them. Once.
 */
export function quietEmptyClears(): void {
  const proto = GraphicsContext.prototype as unknown as Patched & { __quiet?: boolean; clear: () => unknown };
  if (proto.__quiet) return;
  proto.__quiet = true;
  const clear = proto.clear;
  proto.clear = function (this: Clearable) {
    if (this.instructions.length === 0 && this._activePath?.instructions?.length === 0) { this.resetTransform(); return this; }
    return clear.call(this);
  };
}

type Shape = {
  indexOffset: number; indexSize: number; attributeOffset: number; attributeSize: number; baseColor: number; alpha: number;
  topology: string; texture: { _source: unknown }; _batch?: unknown; _batcher?: unknown;
};
type GpuContext = { isBatchable: boolean; batches: Shape[]; geometryData: { indices: number[] } };
type Drawn = { context: { dirty: boolean; _gpuData: Record<number, GpuContext | undefined> }; _ownedContext?: unknown; _gpuData: Record<number, { batches: Shape[] } | undefined> };
type GraphicsPipeLike = {
  renderer: { uid: number; graphicsContext: { updateGpuContext: (c: unknown) => GpuContext } };
  validateRenderable: (g: Drawn) => boolean; __inPlace?: boolean;
};

/**
 * Whether the shapes drawn now can be written where the last were: as many, as long, of the same textures, joined up
 * the same way — moved and recoloured, and no more. If so they are, colours and all.
 */
export function sameShapes(was: Shape[], now: Shape[], wasIndices: readonly number[], indices: readonly number[]): boolean {
  if (was.length !== now.length || !was.length || wasIndices.length !== indices.length) return false;
  for (let i = 0; i < was.length; i++) {
    const a = was[i], b = now[i];
    if (!a._batch || !a._batcher || a.indexOffset !== b.indexOffset || a.indexSize !== b.indexSize || a.attributeOffset !== b.attributeOffset
      || a.attributeSize !== b.attributeSize || a.topology !== b.topology || a.texture._source !== b.texture._source) return false;
  }
  for (let i = 0; i < indices.length; i++) if (wasIndices[i] !== indices[i]) return false;
  for (let i = 0; i < was.length; i++) { was[i].baseColor = now[i].baseColor; was[i].alpha = now[i].alpha; was[i].texture = now[i].texture; }
  return true;
}

/**
 * A GRAPHICS REDRAWN THE SAME SHAPE IS WRITTEN OVER. Pixi builds the whole draw list of the render group again
 * whenever a batched Graphics in it is drawn again, whatever was drawn; a shop's steam, a walker's lead, a sign's
 * lamps are the same handful of shapes a little moved, and a street of them was its list made again every frame —
 * every car, walker and prop in it packed afresh. Only a Graphics with a context of its own. Once a renderer.
 */
export function redrawInPlace(renderer: unknown): void {
  const pipe = (renderer as { renderPipes?: { graphics?: GraphicsPipeLike } })?.renderPipes?.graphics;
  if (!pipe || pipe.__inPlace || !pipe.renderer?.graphicsContext) return;
  pipe.__inPlace = true;
  const validate = pipe.validateRenderable;
  pipe.validateRenderable = function (g) {
    const uid = this.renderer.uid, context = g.context, had = context._gpuData[uid], drawn = g._gpuData[uid];
    if (!context.dirty || !had?.isBatchable || !drawn?.batches.length || g._ownedContext !== context) return validate.call(this, g);
    const indices = had.geometryData.indices.slice();
    const now = this.renderer.graphicsContext.updateGpuContext(context);
    return !(now.isBatchable && sameShapes(drawn.batches, now.batches, indices, now.geometryData.indices));
  };
}
