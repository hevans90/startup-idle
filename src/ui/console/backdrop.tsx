/**
 * THE CONSOLE'S BACKDROP: arwes's patterns (`@arwes/bgs`) on a canvas filling
 * its frame — dots, grid lines, and, once the AI has the console (from the
 * Overseer), its moving lines — faint, in the frame's tone, behind dialogs
 * and the founder's screen, never under scrolling content. Calm, nothing.
 * Drawn again when the theme or the tone changes; nothing runs at rest but
 * the moving lines. Its packages are fetched the first time one is drawn:
 * they are not in the main bundle. @see Frame
 */
import { useEffect, useRef } from "react";

import { useThemeStore } from "../../state/theme.store";
import { useConsoleMotion } from "../motion";

export function Backdrop({ kind = "dots", still = false }: { kind?: "dots" | "grid"; /** Never the moving lines: behind what stands, which must cost nothing at rest. */ still?: boolean }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const theme = useThemeStore((s) => s.theme);
  const { calm, moves: canMove } = useConsoleMotion();
  const moves = canMove && !still;
  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    let stop: (() => void) | null = null, gone = false;
    void Promise.all([import("@arwes/bgs"), import("@arwes/animator")]).then(([bgs, animator]) => {
      if (gone) return;
      // The frame's tone, resolved: the canvas cannot read a variable.
      const color = getComputedStyle(el).color;
      if (moves) {
        // Its lines run on an animator of their own: a node of a system made for it, taken down with it.
        const system = animator.createAnimatorSystem();
        const node = system.register(undefined, { getSettings: () => ({ duration: { enter: 1, interval: 8 } }) });
        const bg = bgs.createBackgroundMovingLines({ canvas: el, animator: node, settingsRef: { current: { lineColor: color, distance: 30, sets: 12 } } });
        node.send("setup");
        node.send("enter");
        stop = () => { bg.cancel(); system.unregister(node); };
        return;
      }
      const bg = kind === "dots"
        ? bgs.createBackgroundDots({ canvas: el, settingsRef: { current: { color, type: "box", distance: 22, size: 1.5 } } })
        : bgs.createBackgroundGridLines({ canvas: el, settingsRef: { current: { lineColor: color, lineWidth: 1, distance: 28, horizontalLineDash: [4], verticalLineDash: [] } } });
      stop = () => bg.cancel();
    });
    return () => { gone = true; stop?.(); };
  }, [kind, theme, moves]);
  if (calm) return null;
  // Faint by its wrapper: the patterns set the canvas's own opacity.
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 opacity-25">
      <canvas ref={canvas} className="h-full w-full" style={{ color: "var(--frame-tone, var(--ui-console))" }} />
    </div>
  );
}

/**
 * THE OVERSEER'S CONSOLE: behind the console's standing surfaces — the HUD, the
 * sidebar — the AI's grid, once the stage's mix has reached the Overseer's;
 * still, as what stands costs nothing at rest (the moving lines are for
 * dialogs); nothing before it, and nothing when calm. @see plans/ui-overhaul.md §1.4, §6
 */
export function OverseerBackdrop() {
  const { moves } = useConsoleMotion();
  return moves ? <Backdrop kind="grid" still /> : null;
}
