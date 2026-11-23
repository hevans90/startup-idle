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
