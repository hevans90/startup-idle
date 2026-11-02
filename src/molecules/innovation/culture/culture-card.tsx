/**
 * A CULTURE CARD, as it is held: a card the size of a card, its tag's colour
 * across its head with the tag's mark in a medallion, its name, its trade a
 * line a stat (gains first, in the good tone; costs after, in the bad), its
 * ranks as pips and its rank-3 rule at its foot — lit, its medallion filled
 * and the card aglow, once it has it. The same face in an offer, a slot and
 * the hand. @see game/culture, CultureBoard
 */
import type { CSSProperties, ReactNode } from "react";
import { twMerge } from "tailwind-merge";

import { MAX_RANK, card, cardLines, type CardId, type Tag } from "../../../game/culture";
import { toneVar, type Tone } from "../../../ui/console/frame";

export const TAG_TONE: Record<Tag, Tone> = { hustle: "warn", wellness: "good", growth: "info", chaos: "juice" };
export const TAG_NAME: Record<Tag, string> = { hustle: "Hustle", wellness: "Wellness", growth: "Growth", chaos: "Chaos" };
const ONLY_NAME = { intern: "Interns only", vibe_coder: "Vibe coders only", "10x_dev": "10x devs only" } as const;

/** Each tag's mark, drawn on a 24 grid in the current colour. */
export function TagMark({ tag, className }: { tag: Tag; className?: string }) {
  const path: Record<Tag, ReactNode> = {
    // A bolt.
    hustle: <path d="M13.5 2 5 13.5h6L9.5 22 19 9.5h-6.2L13.5 2Z" fill="currentColor" />,
    // A leaf, its vein.
    wellness: <><path d="M5 19C5 10 10.5 4.5 20 4c-.5 9.5-6 15-15 15Z" fill="currentColor" /><path d="M5 19 14 10" stroke="var(--card-head)" strokeWidth="1.6" strokeLinecap="round" /></>,
    // Three bars, rising.
    growth: <><rect x="3.5" y="13" width="4.5" height="8" fill="currentColor" /><rect x="9.75" y="8.5" width="4.5" height="12.5" fill="currentColor" /><rect x="16" y="3" width="4.5" height="18" fill="currentColor" /></>,
    // A spiral.
    chaos: <path d="M12 12.2c0-1 1.6-1.2 2-.2.6 1.6-1.3 3-2.9 2.6-2.3-.5-2.8-3.5-1.3-5.2 2-2.2 5.8-1.6 7 1 1.5 3.3-1 7-4.6 7.2-4.2.3-7.4-3.4-6.6-7.5.9-4.6 6-7.2 10.3-5.4" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" />,
  };
  return <svg viewBox="0 0 24 24" aria-hidden className={className}>{path[tag]}</svg>;
}

/** The card's sizes: in the hand and slots, and larger when offered. */
const SIZE = { md: "w-[9.5rem] h-[18rem]", lg: "w-[11rem] h-[19.5rem]" };

/** Its outline, chamfered at the corners as the console's frames are. */
export const CARD_CLIP = "polygon(10px 0, calc(100% - 10px) 0, 100% 10px, 100% calc(100% - 10px), calc(100% - 10px) 100%, 10px 100%, 0 calc(100% - 10px), 0 10px)";

export function CultureCard({ id, rank, size = "md", className, style, children }: {
  id: CardId;
  /** The rank shown: 1 for a card offered. */
  rank: number;
  size?: keyof typeof SIZE;
  className?: string;
  style?: CSSProperties;
  /** Over the face: a shine, a badge. */
  children?: ReactNode;
}) {
  const c = card(id);
  const tone = TAG_TONE[c.tag];
  // At the top rank, the rule is the card's.
  const ruled = rank >= MAX_RANK;
  return (
    <div className={twMerge("relative select-none", SIZE[size], ruled && "card-ruled", className)}
      style={{ ...toneVar(tone), ["--card-head" as string]: "color-mix(in oklab, var(--tone) 34%, var(--ui-surface-1, #111))", ...style }}>
      {/* THE EDGE: the tone, a pixel round the face. */}
      <div className="absolute inset-0 bg-tone" style={{ clipPath: CARD_CLIP }} />
      <div className="absolute inset-px flex flex-col overflow-hidden bg-surface-1" style={{ clipPath: CARD_CLIP }}>
        {/* THE HEAD: its tag's colour, the tag named. */}
        <div className="relative h-11 shrink-0" style={{ background: "var(--card-head)" }}>
          <div className="absolute inset-0 opacity-25" style={{ backgroundImage: "repeating-linear-gradient(135deg, var(--tone) 0 1px, transparent 1px 7px)" }} />
          <span className="absolute left-2.5 top-1.5 font-display text-[9px] uppercase tracking-[0.2em] text-fg">{TAG_NAME[c.tag]}</span>
          <span className="absolute right-2.5 top-1.5 text-[9px] uppercase tracking-wider text-fg-muted">Rank {rank}</span>
        </div>
        {/* THE MEDALLION, on the seam. */}
        <div className={twMerge("absolute left-1/2 top-11 flex h-9 w-9 -translate-x-1/2 -translate-y-1/2 rotate-45 items-center justify-center border border-tone", ruled ? "bg-tone" : "bg-surface-1")}>
          <TagMark tag={c.tag} className={twMerge("h-5 w-5 -rotate-45", ruled ? "text-surface-1" : "text-tone")} />
        </div>
        {/* THE FACE, in the same bands on every card: whatever a card says,
            its name, its trade, its pips and its rule sit where every other's do. */}
        <div className="flex min-h-0 flex-1 flex-col pt-6">
          {/* THE NAME: room for two lines, and the kind it is for under them. */}
          <div className="flex h-14 shrink-0 flex-col items-center px-2.5 pt-1 text-center">
            <span className={twMerge("line-clamp-2 font-display leading-[1.3] tracking-wide text-fg", size === "lg" ? "text-[15px]" : "text-[13px]")}>{c.name}</span>
            {c.only && <span className="mt-0.5 text-[9px] uppercase tracking-wider text-tone">{ONLY_NAME[c.only]}</span>}
          </div>
          {/* THE TRADE: gains, then costs, from the same line down. */}
          <ul className="flex min-h-0 flex-1 flex-col gap-1 overflow-hidden px-2.5 pt-1">
            {cardLines(c, rank).map((l) => (
              <li key={l.text} className={twMerge("flex gap-1.5 text-left text-[11px] leading-tight", l.good ? "text-good" : "text-bad")}>
                <span aria-hidden className="w-2 shrink-0 pt-px text-[8px]">{l.good ? "▲" : "▼"}</span>
                <span className="min-w-0 flex-1">{l.text}</span>
              </li>
            ))}
          </ul>
          {/* THE FOOT: its ranks, and the rule rank 3 brings — lit once it has it. */}
          <div className="flex h-5 shrink-0 items-center justify-center gap-1" aria-label={`Rank ${rank} of ${MAX_RANK}`}>
            {[1, 2, 3].map((r) => (
              <span key={r} className={twMerge("h-1.5 w-1.5 rotate-45 border border-tone", r <= rank && "bg-tone", r === 3 && "h-2 w-2", r === 3 && r > rank && "opacity-60")} />
            ))}
          </div>
          <div className={twMerge("flex h-16 shrink-0 flex-col items-center justify-center gap-0.5 border-t px-2.5 text-center text-[10px] leading-snug",
            ruled ? "border-tone text-fg" : "border-line-quiet text-fg-muted")}
            style={ruled ? { background: "color-mix(in oklab, var(--tone) 16%, transparent)" } : undefined}>
            <span className={twMerge("text-[9px] uppercase tracking-wider", ruled && "text-tone")}>{ruled ? "Rule" : "Rule at rank 3"}</span>
            <span className={twMerge("line-clamp-3", !ruled && "italic")}>{c.keystone}</span>
          </div>
        </div>
      </div>
      {children}
    </div>
  );
}
