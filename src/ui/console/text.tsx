/**
 * THE CONSOLE'S TEXT: arwes's text effects (`@arwes/text`), once, as a piece
 * appears — a title DECIPHERED in, words typed in as a SEQUENCE — or plain.
 * `auto` deciphers only once the console's decoration has reached it (from
 * the Manager); calm, the text is simply there. Plays again when the text
 * changes; under StrictMode's second mount it starts over cleanly.
 * @see Frame, ui/motion
 */
import { useEffect, useRef, type RefObject } from "react";
import { animateTextDecipher, animateTextSequence, getAnimationTextDuration } from "@arwes/text";

import { useConsoleMotion } from "../motion";

/** Characters a second it types at, and the longest a line takes, seconds; how long a title takes to decipher. */
const TYPED = 60;
const LONGEST = 4;
const DECIPHER = 0.8;

export type TextMode = "decipher" | "sequence" | "auto" | "plain";

export function Text({ text, mode = "auto", as = "span", className, onDone }: {
  text: string;
  /** Deciphered, typed, deciphered when the console has got that far, or plain. */
  mode?: TextMode;
  as?: "span" | "p" | "h2" | "h3" | "div";
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
    const duration = effect === "decipher" ? DECIPHER : getAnimationTextDuration({ length: text.length, charactersPerSecond: TYPED, maxDuration: LONGEST });
    const play = effect === "decipher" ? animateTextDecipher : animateTextSequence;
    const a = play({ rootElement, contentElement, duration, isEntering: true, hideOnEntered: false });
    let live = true;
    void a.then(() => { if (live) done.current?.(); });
    return () => { live = false; a.cancel(); };
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
