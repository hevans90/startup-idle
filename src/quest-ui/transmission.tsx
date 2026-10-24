/**
 * QUEST UI — THE TRANSMISSION: what the AI asks, in an octagon frame on a
 * faint field of dots, at the map's right edge. Its title deciphered in, its
 * words typed in a line at a time, then the options as decision cards. It
 * does not pause the game, nor cover the map's middle; it can be put away to
 * a pulsing tab and brought back. How long before it chooses for itself is
 * shown under the cards. @see DecisionCard, QuestLayer
 */
import { useEffect, useState } from "react";
import { twMerge } from "tailwind-merge";

import { clock } from "../game/quests/describe";
import type { Disposition, Option } from "../game/quests/types";
import { DecisionCard } from "./decision-card";
import { QuestBackground } from "./quest-background";
import { QuestFrame } from "./quest-frame";
import { QuestText } from "./quest-text";

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
  const pick = (i: number) => {
    if (chosen !== null) return;
    if (armed !== i) { setArmed(i); return; }
    // Chosen: the frame closes in, then it is answered.
    setChosen(i);
    window.setTimeout(() => onChoose(i), 260);
  };
  if (away) {
    return (
      <button type="button" onClick={() => setAway(false)} aria-label="Open the transmission"
        className={twMerge("flex cursor-pointer items-center gap-2 border border-violet-500 bg-primary-50/95 px-2 py-1 text-xs text-violet-800 shadow dark:border-violet-400 dark:bg-primary-950/95 dark:text-violet-200", className)}>
        <span className="relative flex h-2 w-2">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-violet-500 opacity-75 dark:bg-violet-400" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-violet-600 dark:bg-violet-300" />
        </span>
        Incoming transmission · {clock(left)}
      </button>
    );
  }
  return (
    <QuestFrame kind="octagon" className={twMerge("w-[26rem] max-w-full text-xs", className)}>
      <QuestBackground kind="dots" />
      <div role="dialog" aria-label={title} className="relative flex flex-col gap-2 p-4">
        <div className="flex items-start justify-between gap-2">
          <p className="text-[10px] uppercase tracking-widest text-violet-700 dark:text-violet-300">
            {kicker} · <QuestText mode="decipher" text={title} className="font-bold" />
          </p>
          <button type="button" onClick={() => setAway(true)} aria-label="Put the transmission away" title="Put it away: it waits"
            className="cursor-pointer px-1 text-primary-500 hover:text-primary-900 dark:text-primary-400 dark:hover:text-primary-100">–</button>
        </div>
        {lines.slice(0, shown).map((line, i) => (
          <QuestText key={`${title}:${i}`} as="p" text={line} className="text-sm leading-snug"
            onDone={() => setShown((n) => Math.max(n, Math.min(lines.length + 1, i + 2)))} />
        ))}
        {shown > lines.length && (
          <>
            <div className={twMerge("grid gap-2", options.length > 2 ? "grid-cols-1" : "grid-cols-2")}>
              {options.map((o, i) => (
                <DecisionCard key={i} option={o} at={at} armed={armed === i} chosen={chosen === i} preferred={i === preferred} onPick={() => pick(i)} />
              ))}
            </div>
            <p className="text-[10px] text-primary-600 dark:text-primary-400">Unanswered, it chooses for itself in {clock(left)}.</p>
          </>
        )}
      </div>
    </QuestFrame>
  );
}
