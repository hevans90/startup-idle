/**
 * Editor keyboard shortcuts.
 *
 * Undo/redo are the ones that matter: without them the paint tools are not
 * usable in practice, however good the command stack underneath is.
 */
import { useEffect } from "react";

import { useWorldStore } from "../../state/world.store";
import { GROUPS, TOOL_KEYS, pickGroup, pickTool } from "./toolbox";
import type { BrushId } from "./tools";

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

      if (ev.altKey) return;
      // Shift and a number: that group of tools, as it was last left. (By the key and not what it types: ⇧2 is @ or ".)
      if (ev.shiftKey && /^Digit\d$/.test(ev.code)) {
        const g = GROUPS.find((x) => x.key === ev.code.slice(5));
        if (g) { ev.preventDefault(); pickGroup(g.id); }
        return;
      }
      if (TOOL_KEYS[k]) { ev.preventDefault(); pickTool(TOOL_KEYS[k]); return; }
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
