/**
 * THE CONSOLE'S BACKDROP: arwes's patterns (`@arwes/bgs`) on a canvas filling
 * its frame — dots, grid lines, and, once the AI has the console (from the
 * Overseer), its moving lines — faint, in the frame's tone, behind dialogs
 * and the founder's screen, never under scrolling content. Calm, nothing.
 * Drawn again when the theme or the tone changes; nothing runs at rest but
 * the moving lines. @see Frame
 */
import { useEffect, useRef } from "react";
import { createBackgroundDots, createBackgroundGridLines, createBackgroundMovingLines } from "@arwes/bgs";
import { createAnimatorSystem } from "@arwes/animator";

import { useThemeStore } from "../../state/theme.store";
import { useConsoleMotion } from "../motion";

export function Backdrop({ kind = "dots" }: { kind?: "dots" | "grid" }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const theme = useThemeStore((s) => s.theme);
  const { calm, moves } = useConsoleMotion();
  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    // The frame's tone, resolved: the canvas cannot read a variable.
    const color = getComputedStyle(el).color;
    if (moves) {
      // Its lines run on an animator of their own: a node of a system made for it, taken down with it.
      const system = createAnimatorSystem();
      const node = system.register(undefined, { getSettings: () => ({ duration: { enter: 1, interval: 8 } }) });
      const bg = createBackgroundMovingLines({ canvas: el, animator: node, settingsRef: { current: { lineColor: color, distance: 30, sets: 12 } } });
      node.send("setup");
      node.send("enter");
      return () => { bg.cancel(); system.unregister(node); };
    }
    const bg = kind === "dots"
      ? createBackgroundDots({ canvas: el, settingsRef: { current: { color, type: "box", distance: 22, size: 1.5 } } })
      : createBackgroundGridLines({ canvas: el, settingsRef: { current: { lineColor: color, lineWidth: 1, distance: 28, horizontalLineDash: [4], verticalLineDash: [] } } });
    return () => bg.cancel();
  }, [kind, theme, moves]);
  if (calm) return null;
  // Faint by its wrapper: the patterns set the canvas's own opacity.
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 opacity-25">
      <canvas ref={canvas} className="h-full w-full" style={{ color: "var(--frame-tone, var(--ui-console))" }} />
    </div>
  );
}
