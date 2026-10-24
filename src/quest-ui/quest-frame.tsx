/**
 * QUEST UI — THE FRAME every piece of the AI's console sits in: an arwes SVG
 * frame (`@arwes/frames`) behind the content, drawn on with arwes's assembler
 * when it appears. Its colours are never arwes's own: `.quest-frame` sets
 * arwes's CSS variables from the game's palette, violet on a light panel in
 * light mode and violet on near-black in dark (index.css).
 *
 * The DOM packages through our own refs, not `@arwes/react-*`: those mark
 * themselves unmounted in an effect's cleanup and never mounted again, so
 * under StrictMode nothing ever shows. Here an effect makes the frame and its
 * cleanup takes it away, so a second mount simply makes it again.
 * @see plans/ai-takeover.md "The UI", utils/ten-x-utils
 */
import { useEffect, useRef, type ReactNode } from "react";
import { twMerge } from "tailwind-merge";
import {
  animateFrameAssembler, createFrame, createFrameCornersSettings, createFrameOctagonSettings, createFrameUnderlineSettings,
  type FrameSettings,
} from "@arwes/frames";

import { useReducedMotion } from "./motion";

/** The shapes: the transmission's octagon, a decision card's corners, the tracker's underline. */
export type QuestFrameKind = "octagon" | "corners" | "underline";

/** How each is cut: never animated by arwes's animator — the assembler draws it on. */
const SETTINGS: Record<QuestFrameKind, () => FrameSettings> = {
  octagon: () => createFrameOctagonSettings({ animated: false, squareSize: 14, strokeWidth: 1.5 }),
  corners: () => createFrameCornersSettings({ animated: false, cornerLength: 14, strokeWidth: 1.5 }),
  underline: () => createFrameUnderlineSettings({ animated: false, squareSize: 10, strokeWidth: 1.5 }),
};

/** Seconds the frame takes to draw on. */
export const ASSEMBLE = 0.6;

export function QuestFrame({ kind = "octagon", illuminate = false, assemble = true, className, children }: {
  kind?: QuestFrameKind;
  /** Lit up on hover: a decision card under the pointer. */
  illuminate?: boolean;
  /** Drawn on when it appears; otherwise, and with less motion, simply there. */
  assemble?: boolean;
  className?: string;
  children?: ReactNode;
}) {
  const svg = useRef<SVGSVGElement>(null);
  const reduced = useReducedMotion();
  useEffect(() => {
    const el = svg.current;
    if (!el) return;
    const container = document.createElementNS("http://www.w3.org/2000/svg", "g");
    const frame = createFrame(el, { ...SETTINGS[kind](), container });
    const drawing = assemble && !reduced ? animateFrameAssembler({ element: el, duration: ASSEMBLE }) : null;
    return () => {
      drawing?.stop();
      frame.remove();
      container.remove();
    };
  }, [kind, assemble, reduced]);
  return (
    <div className={twMerge("quest-frame relative", className)} data-illuminate={illuminate || undefined}>
      <svg ref={svg} aria-hidden className="pointer-events-none absolute inset-0 h-full w-full overflow-visible" />
      <div className="relative">{children}</div>
    </div>
  );
}
