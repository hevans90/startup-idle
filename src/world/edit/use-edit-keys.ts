/**
 * Editor keyboard shortcuts.
 *
 * Undo/redo are the ones that matter: without them the paint tools are not
 * usable in practice, however good the command stack underneath is.
 */
import { useEffect } from "react";

import { useWorldStore } from "../../state/world.store";
import type { BrushId, ToolId } from "./tools";

const TOOL_KEYS: Record<string, ToolId> = {
  b: "paintTerrain", e: "erase", v: "inspect",
  // r/f rather than +/−: the height tools are modes like the others, and the
  // step size is a separate control
  r: "raise", f: "lower",
  p: "paintRoad", o: "eraseRoad",
  // n/x, not g/d: g already toggles the grid overlay, and d is free but pairs
  // badly with "demolish" sitting next to "draw"
  n: "placeStructure", x: "demolish",
  // j/k for fluid: adjacent, and everything nearer the obvious letters is taken
  j: "pourWater", k: "drainWater",
  // l/; carry on the same row: a spring and a drain are the running versions
  // of the two beside them
  l: "spring", ";": "sink", "'": "pipe",
  u: "slope", i: "unslope",
};
const BRUSH_KEYS: Record<string, BrushId> = { "1": "point", "2": "rect", "3": "line" };

export function useEditKeys() {
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      // never hijack typing in the panel's inputs
      const t = ev.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;

      const st = useWorldStore.getState();
      const meta = ev.metaKey || ev.ctrlKey;
      const k = ev.key.toLowerCase();

      if (meta && k === "z") {
        ev.preventDefault();
        if (ev.shiftKey) st.doRedo();
        else st.doUndo();
        return;
      }
      if (meta && k === "y") { ev.preventDefault(); st.doRedo(); return; }
      if (ev.key === "Escape") { st.cancelStroke(); return; }
      if (meta) return;                       // leave other shortcuts alone

      if (TOOL_KEYS[k]) { ev.preventDefault(); st.setTool(TOOL_KEYS[k]); return; }
      if (BRUSH_KEYS[ev.key]) { ev.preventDefault(); st.setBrush(BRUSH_KEYS[ev.key]); return; }
      // [ and ] step the brush size, the usual editor convention
      if (ev.key === "[") { ev.preventDefault(); st.setBrushRadius(Math.max(0, st.brushRadius - 1)); return; }
      if (ev.key === "]") { ev.preventDefault(); st.setBrushRadius(Math.min(4, st.brushRadius + 1)); return; }
      if (k === "g") { ev.preventDefault(); st.toggleOverlay("grid"); }
      // `y`, not `x`: demolish has that one, and x-ray is the sort of thing
      // you flick on and off while laying a run rather than hunt for.
      if (k === "y") { ev.preventDefault(); st.toggleOverlay("xray"); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}
