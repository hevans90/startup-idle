/**
 * World v2 — the company's map, in the game.
 *
 * Where the old procedural city used to be: the company's own town, made new
 * for every company, built on by the player under the game's rules, and
 * telling the economy its beds. @see useFoundWorld, BuildBar
 *
 * The default export, so the game can load it lazily: the map engine is most
 * of the bundle, and the founder screen does not need it.
 */
import { useResizeToWrapper } from "../../hooks/use-resize-to-wrapper";
import { useFoundWorld, WorldCanvas } from "../world-canvas";
import { BuildBar } from "./build-bar";
// The stores on `window` in development, as the editor has them. @see expose-store
import "../debug/expose-store";

export default function CompanyMap() {
  const { ref: wrapperRef, setRef, size } = useResizeToWrapper();
  useFoundWorld("run", true);
  return (
    <div ref={setRef} className="absolute inset-0 min-h-0 bg-primary-900">
      <WorldCanvas wrapperRef={wrapperRef} size={size} />
      <BuildBar className="absolute bottom-3 left-1/2 z-10 -translate-x-1/2 items-center" />
    </div>
  );
}
