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
import { Graphics } from "pixi.js";

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
