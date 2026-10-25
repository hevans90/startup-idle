/**
 * QUEST UI — THE PATTERN behind a transmission: arwes's dots or grid lines
 * (`@arwes/bgs`), faint, on a canvas filling its frame. Its colour is the
 * frame's `--quest-pattern`, read from the page — so it follows the theme —
 * and drawn again when the theme changes.
 */
import { useEffect, useRef } from "react";
import { createBackgroundDots, createBackgroundGridLines } from "@arwes/bgs";

import { useThemeStore } from "../state/theme.store";
import { useConsoleMotion } from "../ui/motion";

export function QuestBackground({ kind = "dots" }: { kind?: "dots" | "grid" }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const theme = useThemeStore((s) => s.theme);
  // CALM, nothing behind. @see useConsoleMotion
  const calm = useConsoleMotion().calm;
  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    const color = getComputedStyle(el).getPropertyValue("--quest-pattern").trim() || "#8b5cf6";
    const bg = kind === "dots"
      ? createBackgroundDots({ canvas: el, settingsRef: { current: { color, type: "box", distance: 22, size: 1.5 } } })
      : createBackgroundGridLines({ canvas: el, settingsRef: { current: { lineColor: color, lineWidth: 1, distance: 28, horizontalLineDash: [4], verticalLineDash: [] } } });
    return () => bg.cancel();
  }, [kind, theme, calm]);
  if (calm) return null;
  return <canvas ref={canvas} aria-hidden className="pointer-events-none absolute inset-0 h-full w-full" />;
}
