/**
 * THE CONSOLE'S TEXT: arwes's text effects (`@arwes/text`), once, as a piece
 * appears — a title DECIPHERED in, words typed in as a SEQUENCE — or plain.
 * `auto` deciphers only once the console's decoration has reached it (from
 * the Manager); calm, the text is simply there. Plays again when the text
 * changes; under StrictMode's second mount it starts over cleanly.
 * @see Frame, ui/motion
 */
import { useEffect, useRef, type RefObject } from "react";

import { useConsoleMotion } from "../motion";

/** Characters a second it types at, and the longest a line takes, seconds; how long a title takes to decipher. */
const TYPED = 60;
const LONGEST = 4;
const DECIPHER = 0.8;

/** The package, fetched the first time text plays: it is not in the main bundle. */
let arwesText: Promise<typeof import("@arwes/text")> | null = null;
const loadText = () => (arwesText ??= import("@arwes/text"));

/** How many titles are deciphering now: one at a time on screen — one that comes while another plays is simply there. */
let deciphering = 0;

export type TextMode = "decipher" | "sequence" | "auto" | "plain";

export function Text({ text, mode = "auto", as = "span", className, onDone }: {
  text: string;
  /** Deciphered, typed, deciphered when the console has got that far, or plain. */
  mode?: TextMode;
  as?: "span" | "p" | "h1" | "h2" | "h3" | "div";
  className?: string;
  /** When it has all arrived: the next line may start. */
  onDone?: () => void;
}) {
  const root = useRef<HTMLElement>(null);
  const content = useRef<HTMLSpanElement>(null);
  const motion = useConsoleMotion();
  const plays = mode === "auto" ? motion.deciphers : mode !== "plain" && !motion.calm;
  const effect = mode === "sequence" ? "sequence" : "decipher";
  const done = useRef(onDone);
  done.current = onDone;
  useEffect(() => {
    const rootElement = root.current, contentElement = content.current;
    if (!rootElement || !contentElement) return;
    if (!plays) {
      contentElement.style.visibility = "visible";
      done.current?.();
      return;
    }
    if (effect === "decipher" && deciphering > 0) {
      contentElement.style.visibility = "visible";
      done.current?.();
      return;
    }
    let live = true, cancel: (() => void) | null = null;
    if (effect === "decipher") deciphering++;
    void loadText().then((t) => {
      if (!live) return;
      const duration = effect === "decipher" ? DECIPHER : t.getAnimationTextDuration({ length: text.length, charactersPerSecond: TYPED, maxDuration: LONGEST });
      const play = effect === "decipher" ? t.animateTextDecipher : t.animateTextSequence;
      const a = play({ rootElement, contentElement, duration, isEntering: true, hideOnEntered: false });
      cancel = () => a.cancel();
      void a.then(() => { if (live) done.current?.(); });
    });
    // Its turn ends when it has played, or is taken down — once.
    let held = effect === "decipher";
    const release = () => { if (held) { held = false; deciphering = Math.max(0, deciphering - 1); } };
    const ends = window.setTimeout(release, (DECIPHER + 0.1) * 1000);
    return () => { live = false; cancel?.(); window.clearTimeout(ends); release(); };
  }, [text, effect, plays]);
  // One element type for the ref; any of these takes it alike.
  const Tag = as as "span";
  return (
    <Tag ref={root as RefObject<HTMLSpanElement>} className={className} style={{ position: "relative" }}>
      {/* Hidden till the effect brings it in: no flash of it whole first. */}
      <span ref={content} style={{ position: "relative", visibility: plays ? "hidden" : "visible" }}>{text}</span>
    </Tag>
  );
}
