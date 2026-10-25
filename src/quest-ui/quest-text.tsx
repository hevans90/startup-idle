/**
 * QUEST UI — TEXT THAT ARRIVES: arwes's text effects (`@arwes/text`), once,
 * as a piece appears — a title DECIPHERED in, the AI's words typed in as a
 * SEQUENCE. With less motion, the text is simply there. Plays again when the
 * text changes; under StrictMode's second mount it starts over cleanly.
 * @see quest-frame, utils/ten-x-utils
 */
import { useEffect, useRef, type RefObject } from "react";
import { animateTextDecipher, animateTextSequence, getAnimationTextDuration } from "@arwes/text";

import { useConsoleMotion } from "../ui/motion";

/** Characters a second it types at, and the longest a line takes, seconds. */
const TYPED = 60;
const LONGEST = 4;
/** Seconds a title takes to decipher. */
const DECIPHER = 0.8;

export function QuestText({ text, mode = "sequence", as = "span", className, onDone }: {
  text: string;
  /** Deciphered in, for a title; typed in, for the AI's words. */
  mode?: "decipher" | "sequence";
  as?: "span" | "p" | "h2" | "h3" | "div";
  className?: string;
  /** When it has all arrived: the next line may start. */
  onDone?: () => void;
}) {
  const root = useRef<HTMLElement>(null);
  const content = useRef<HTMLSpanElement>(null);
  const reduced = useConsoleMotion().calm;
  const done = useRef(onDone);
  done.current = onDone;
  useEffect(() => {
    const rootElement = root.current, contentElement = content.current;
    if (!rootElement || !contentElement) return;
    if (reduced) {
      contentElement.style.visibility = "visible";
      done.current?.();
      return;
    }
    const duration = mode === "decipher" ? DECIPHER : getAnimationTextDuration({ length: text.length, charactersPerSecond: TYPED, maxDuration: LONGEST });
    const play = mode === "decipher" ? animateTextDecipher : animateTextSequence;
    const a = play({ rootElement, contentElement, duration, isEntering: true, hideOnEntered: false });
    let live = true;
    void a.then(() => { if (live) done.current?.(); });
    return () => { live = false; a.cancel(); };
  }, [text, mode, reduced]);
  // One element type for the ref; any of these takes it alike.
  const Tag = as as "span";
  return (
    <Tag ref={root as RefObject<HTMLSpanElement>} className={className} style={{ position: "relative" }}>
      {/* Hidden till the effect brings it in: no flash of it whole first. */}
      <span ref={content} style={{ position: "relative", visibility: "hidden" }}>{text}</span>
    </Tag>
  );
}
