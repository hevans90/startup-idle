/**
 * WHAT A POPOVER IS, everywhere: a raised card, its tone along its top edge;
 * a header strip — what it is in small capitals, its figure in the tone's
 * colour; rows between hairlines, in groups; and a footnote in a quiet strip.
 * A popover's `PopoverContent` takes `POPOVER_BARE` and a `PopCard` inside,
 * so the card's look is the card's, not the floating box's.
 * @see Popover, Tooltip, plans/ui-overhaul.md §2
 */
import type { ReactNode } from "react";
import { twMerge } from "tailwind-merge";

import { toneVar, type Tone } from "./frame";

/** The floating box around a `PopCard`: nothing drawn, only its layer and no focus ring. */
export const POPOVER_BARE = "z-[110] outline-none focus:ring-0";

export function PopCard({ title, value, icon, tone = "console", foot, className, children }: {
  title?: ReactNode;
  /** The figure it is about: a total, a price. */
  value?: ReactNode;
  icon?: ReactNode;
  tone?: Tone;
  foot?: ReactNode;
  className?: string;
  children?: ReactNode;
}) {
  return (
    <div style={toneVar(tone)} className={twMerge("flex w-64 flex-col border border-line-strong border-t-2 border-t-tone bg-surface-3 text-xs text-fg shadow-xl", className)}>
      {(title || value) && (
        <header className="flex items-baseline justify-between gap-3 border-b border-line-quiet px-3 py-2">
          <span className="flex min-w-0 items-center gap-2 font-display text-[11px] uppercase tracking-widest">{icon}<span className="truncate">{title}</span></span>
          {value != null && <span className="shrink-0 font-display text-base tabular-nums text-tone">{value}</span>}
        </header>
      )}
      {children && <div className="flex flex-col gap-2.5 px-3 py-2.5">{children}</div>}
      {foot && <footer className="border-t border-line-quiet bg-surface-2/50 px-3 py-2 text-[11px] leading-snug text-fg-muted">{foot}</footer>}
    </div>
  );
}

/** A group of rows: its label, then the rows between hairlines. */
export function PopGroup({ label, children }: { label?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex flex-col">
      {label && <span className="mb-1 text-[10px] uppercase tracking-widest text-fg-faint">{label}</span>}
      <div className="flex flex-col divide-y divide-line-quiet">{children}</div>
    </div>
  );
}

/** One figure (or one line): what it is, muted, and its value — in a tone if it says good or bad; indented under a heading row. */
export function PopRow({ label, value, valueClass, strong, indent, wrap }: {
  label: ReactNode; value?: ReactNode; valueClass?: string; strong?: boolean; indent?: boolean;
  /** A sentence, not a name: it wraps rather than being cut short. */
  wrap?: boolean;
}) {
  return (
    <div className={twMerge("flex items-baseline justify-between gap-4 py-1", indent && "pl-3")}>
      <span className={twMerge("min-w-0", wrap ? "leading-snug" : "truncate", strong ? "font-bold text-fg" : "text-fg-muted")}>{label}</span>
      {value != null && <span className={twMerge("shrink-0 tabular-nums", strong && "font-bold", valueClass)}>{value}</span>}
    </div>
  );
}
