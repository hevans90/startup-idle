/**
 * World v2 — A CARD BESIDE ITS PLACE: what was looked at, shown next to it on
 * the map rather than at the edge, kept there as the map pans and zooms —
 * placed a frame at a time as the event rings are, and kept on screen.
 * @see plans/ui-overhaul.md §3.2
 */
import { useEffect, useRef, type ReactNode } from "react";

import { useWorldStore } from "../../state/world.store";
import { idx, inBounds } from "../grid";
import { cellToWorld } from "../iso";

/** Screen pixels between the tile and the card's corner. */
const GAP = 18;

export function Anchored({ at, children }: { at: { x: number; y: number } | null; children: ReactNode }) {
  const el = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!at) return;
    let raf = 0, was = "";
    const frame = () => {
      raf = requestAnimationFrame(frame);
      const box = el.current, vp = useWorldStore.getState().viewport, g = useWorldStore.getState().grid;
      if (!box || !vp) return;
      const h = inBounds(g, at.x, at.y) ? g.height[idx(g, at.x, at.y)] : 0;
      const w = cellToWorld(at.x, at.y, h);
      const p = vp.toScreen(w.wx, w.wy);
      const parent = box.offsetParent as HTMLElement | null;
      const W = parent?.clientWidth ?? window.innerWidth, H = parent?.clientHeight ?? window.innerHeight;
      // Beside it, to the right — or the left, if there is no room — and never off the edge.
      let x = p.x + GAP, y = p.y - box.offsetHeight / 2;
      if (x + box.offsetWidth > W - 8) x = p.x - GAP - box.offsetWidth;
      x = Math.max(8, Math.min(W - box.offsetWidth - 8, x));
      y = Math.max(40, Math.min(H - box.offsetHeight - 96, y));
      // Written only when it moved: a still map costs a read a frame, no style.
      const to = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
      if (to !== was) box.style.transform = was = to;
    };
    frame();
    return () => cancelAnimationFrame(raf);
  }, [at?.x, at?.y]);
  if (!at) return null;
  return <div ref={el} className="absolute left-0 top-0 z-20">{children}</div>;
}
