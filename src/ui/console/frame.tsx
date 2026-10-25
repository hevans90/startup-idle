/**
 * THE CONSOLE'S FRAME: an arwes SVG frame (`@arwes/frames`) behind content,
 * one shape for each kind of thing, so the shape says what something is
 * before it is read (plans/ui-overhaul.md §1.3):
 *  - `octagon` a dialog, something the game asks of you;
 *  - `corners` a choice you can make;
 *  - `kranox` a panel, a standing part of the console;
 *  - `nefrex` a card on the map, something there now;
 *  - `underline` a status line; `lines` a divider; `header` a title bar.
 *
 * Its colours are the tokens', never arwes's own: its `tone` — the console's
 * own colour by default, the founder's teal mixed toward the AI's violet, or
 * any role — sets the line, a tint of it the fill when lit (`.ui-frame` in
 * index.css). It draws on when it appears if the console's decoration has
 * reached that (`assemble="auto"`, from the Colleague), always unless calm
 * (`"always"`, for the AI's own words), or never; and never moves at rest.
 *
 * The DOM packages through our own refs, not `@arwes/react-*`: those mark
 * themselves unmounted in an effect's cleanup and never mounted again, so
 * under StrictMode nothing shows. Here an effect makes the frame and its
 * cleanup removes it, so a second mount simply makes it again.
 */
import { useEffect, useRef, type CSSProperties, type ReactNode } from "react";
import { twMerge } from "tailwind-merge";
import type { FrameSettings } from "@arwes/frames";

import type { Role } from "../theme/tokens";
import { useConsoleMotion } from "../motion";

export type FrameKind = "octagon" | "corners" | "kranox" | "nefrex" | "underline" | "lines" | "header";
/** What colours a frame: the console's own, or a role. */
export type Tone = "console" | Role;

/** The package, fetched the first time a frame is drawn: it is not in the main bundle. */
type ArwesFrames = typeof import("@arwes/frames");
let frames: Promise<ArwesFrames> | null = null;
const loadFrames = () => (frames ??= import("@arwes/frames"));

/** How each is cut: never animated by arwes's animator — the assembler draws it on. */
const SETTINGS: Record<FrameKind, (f: ArwesFrames) => FrameSettings> = {
  octagon: (f) => f.createFrameOctagonSettings({ animated: false, squareSize: 12, strokeWidth: 1.25, leftTop: true, rightTop: false, rightBottom: true, leftBottom: false }),
  corners: (f) => f.createFrameCornersSettings({ animated: false, cornerLength: 12, strokeWidth: 1.5 }),
  kranox: (f) => f.createFrameKranoxSettings({ animated: false, squareSize: 8, strokeWidth: 1.25, smallLineLength: 8, largeLineLength: 32 }),
  nefrex: (f) => f.createFrameNefrexSettings({ animated: false, squareSize: 10, strokeWidth: 1.25, smallLineLength: 8, largeLineLength: 28 }),
  underline: (f) => f.createFrameUnderlineSettings({ animated: false, squareSize: 8, strokeWidth: 1.25 }),
  lines: (f) => f.createFrameLinesSettings({ animated: false, largeLineWidth: 1.5, smallLineWidth: 1, smallLineLength: 12 }),
  header: (f) => f.createFrameHeaderSettings({ animated: false, strokeWidth: 1.25, decoWidth: 4, contentLength: 48 }),
};

/** Seconds a frame takes to draw on. */
export const ASSEMBLE = 0.6;

/** A tone as `--tone`, for what is drawn in CSS rather than as a frame: a panel's tick, a card's edge, a button's fill. */
export const toneVar = (tone: Tone): CSSProperties =>
  ({ ["--tone" as string]: tone === "console" ? "var(--ui-console)" : `var(--ui-${tone})` });

/** The CSS a tone sets: the frame's line, and what it fills with when lit. */
export const toneStyle = (tone: Tone): CSSProperties =>
  (tone === "console" ? {} : { ["--frame-tone" as string]: `var(--ui-${tone})` });

export function Frame({ kind = "kranox", tone = "console", illuminate = false, lit = false, assemble = "auto", className, inner, style, children }: {
  kind?: FrameKind;
  tone?: Tone;
  /** Lit up on hover: something under the pointer that can be acted on. */
  illuminate?: boolean;
  /** Lit up outright: chosen, armed, current. */
  lit?: boolean;
  /** Drawn on when it appears: as the console's decoration allows, always (unless calm), or never. */
  assemble?: "auto" | "always" | false;
  className?: string;
  /** The box its children sit in: to make them fill it. */
  inner?: string;
  style?: CSSProperties;
  children?: ReactNode;
}) {
  const svg = useRef<SVGSVGElement>(null);
  const motion = useConsoleMotion();
  const draws = assemble === "always" ? !motion.calm : assemble === "auto" ? motion.draws : false;
  useEffect(() => {
    const el = svg.current;
    if (!el) return;
    let stop: (() => void) | null = null, gone = false;
    void loadFrames().then((f) => {
      if (gone) return;
      const container = document.createElementNS("http://www.w3.org/2000/svg", "g");
      const frame = f.createFrame(el, { ...SETTINGS[kind](f), container });
      const drawing = draws ? f.animateFrameAssembler({ element: el, duration: ASSEMBLE }) : null;
      stop = () => { drawing?.stop(); frame.remove(); container.remove(); };
    });
    return () => { gone = true; stop?.(); };
  }, [kind, draws]);
  return (
    <div className={twMerge("ui-frame relative", className)} style={{ ...toneStyle(tone), ...style }}
      data-illuminate={illuminate || undefined} data-lit={lit || undefined}>
      <svg ref={svg} aria-hidden className="pointer-events-none absolute inset-0 h-full w-full overflow-visible" />
      <div className={twMerge("relative", inner)}>{children}</div>
    </div>
  );
}
