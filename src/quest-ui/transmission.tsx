/**
 * QUEST UI — THE TRANSMISSION: what the AI asks, in an octagon frame on a
 * faint field of dots, at the map's right edge. Its title deciphered in, its
 * words typed in a line at a time, then the options as decision cards. It
 * does not pause the game, nor cover the map's middle; it can be put away to
 * a pulsing tab and brought back. How long before it chooses for itself is
 * shown under the cards. @see DecisionCard, QuestLayer
 */
import { useEffect, useRef, useState } from "react";
import { twMerge } from "tailwind-merge";

import { clock } from "../game/quests/describe";
import type { Disposition, Option } from "../game/quests/types";
import { DecisionCard } from "./decision-card";
import { Backdrop, Frame, IconButton, Text, takeoverGlitch, useGlitch } from "../ui/console";
import { useConsoleMotion } from "../ui/motion";

export type TransmissionProps = {
  /** What it is, over the title: "Chapter 3", "A request". */
  kicker: string;
  title: string;
  lines: readonly string[];
  options: readonly Option[];
  preferred: number;
  at: Disposition;
  /** Seconds before it chooses for itself. */
  left: number;
  onChoose: (option: number) => void;
  className?: string;
};

export function Transmission({ kicker, title, lines, options, preferred, at, left, onChoose, className }: TransmissionProps) {
  // Its words a line at a time, then the cards.
  const [shown, setShown] = useState(1);
  const [armed, setArmed] = useState<number | null>(null);
  const [chosen, setChosen] = useState<number | null>(null);
  const [away, setAway] = useState(false);
  useEffect(() => { setShown(1); setArmed(null); setChosen(null); setAway(false); }, [title]);
  // IT TEARS AS IT ARRIVES, and as hard and as often as the takeover has got. @see takeoverGlitch
  const box = useRef<HTMLDivElement>(null);
  const torn = takeoverGlitch(useConsoleMotion().mix);
  const kick = useGlitch(box, { arrive: true, strength: Math.max(0.6, torn.strength ?? 0), every: torn.active === false ? null : torn.every });
  // A new one in the same frame tears too.
  const said = useRef(title);
  useEffect(() => {
    if (said.current !== title) kick();
    said.current = title;
  }, [title, kick]);
  const pick = (i: number) => {
    if (chosen !== null) return;
    if (armed !== i) { setArmed(i); return; }
    // Chosen: the frame closes in, then it is answered.
    setChosen(i);
    window.setTimeout(() => onChoose(i), 260);
  };
  if (away) {
    return (
      <div ref={box} className={className}>
      <button type="button" onClick={() => setAway(false)} aria-label="Open the transmission"
        className="flex cursor-pointer items-center gap-2 border border-ai-line bg-surface-3 px-2 py-1 text-xs text-ai shadow">
        <span className="relative flex h-2 w-2">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-ai opacity-75" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-ai" />
        </span>
        Incoming transmission · {clock(left)}
      </button>
      </div>
    );
  }
  return (
    <div ref={box} className={twMerge("w-[26rem] max-w-full", className)}>
    <Frame kind="octagon" tone="ai" assemble="always" className="text-xs">
      <Backdrop kind="dots" />
      <div role="dialog" aria-label={title} className="relative flex flex-col gap-2 p-4">
        <div className="flex items-start justify-between gap-2">
          <p className="text-[10px] uppercase tracking-widest text-ai">
            {kicker} · <Text mode="decipher" text={title} className="font-bold" />
          </p>
          <IconButton label="Put it away: it waits" onClick={() => setAway(true)}>–</IconButton>
        </div>
        {lines.slice(0, shown).map((line, i) => (
          <Text mode="sequence" key={`${title}:${i}`} as="p" text={line} className="text-sm leading-snug"
            onDone={() => setShown((n) => Math.max(n, Math.min(lines.length + 1, i + 2)))} />
        ))}
        {shown > lines.length && (
          <>
            <div className={twMerge("grid gap-2", options.length > 2 ? "grid-cols-1" : "grid-cols-2")}>
              {options.map((o, i) => (
                <DecisionCard key={i} option={o} at={at} armed={armed === i} chosen={chosen === i} preferred={i === preferred} onPick={() => pick(i)} />
              ))}
            </div>
            <p className="text-[10px] text-fg-muted">Unanswered, it chooses for itself in {clock(left)}.</p>
          </>
        )}
      </div>
    </Frame>
    </div>
  );
}
