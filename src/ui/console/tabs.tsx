/**
 * THE CONSOLE'S TABS: a rail of them, the current one underlined in the console's colour,
 * arrow keys between them; a tab that has just opened draws itself on. They
 * NEVER SCROLL: with `fill` they share the rail's width, close up when it is
 * narrow, and only then wrap onto a second row.
 * @see plans/ui-overhaul.md §3.4
 */
import { useEffect, useRef, type ReactNode } from "react";
import { twMerge } from "tailwind-merge";

import { useConsoleMotion } from "../motion";
import { FOCUS } from "./controls";

export type TabItem<T extends string> = { id: T; label: ReactNode; icon?: ReactNode; badge?: ReactNode };

export function Tabs<T extends string>({ tabs, value, onChange, label, hint, fill = false, className }: {
  tabs: readonly TabItem<T>[];
  value: T;
  onChange: (id: T) => void;
  label: string;
  /** Each tab's `data-hint`, `${hint}-${id}`: a handle for first-run hints. */
  hint?: string;
  /** Share the rail's width between them, closing up on a narrow one. */
  fill?: boolean;
  className?: string;
}) {
  const { calm } = useConsoleMotion();
  const move = (dir: number) => {
    const i = tabs.findIndex((t) => t.id === value);
    onChange(tabs[(i + dir + tabs.length) % tabs.length].id);
  };
  // WHAT WAS THERE at the first draw: only tabs that open later draw on, and
  // keep the class they drew on with (taking it off would restart nothing).
  const seen = useRef<Set<T> | null>(null);
  const fresh = useRef(new Set<T>());
  if (seen.current) for (const t of tabs) if (!seen.current.has(t.id)) fresh.current.add(t.id);
  useEffect(() => { seen.current = new Set(tabs.map((t) => t.id)); });
  return (
    <div role="tablist" aria-label={label} className={twMerge("@container flex flex-wrap items-stretch gap-1 border-b border-line-quiet", fill && "gap-0", className)}
      onKeyDown={(e) => { if (e.key === "ArrowRight") { e.preventDefault(); move(1); } else if (e.key === "ArrowLeft") { e.preventDefault(); move(-1); } }}>
      {tabs.map((t) => {
        const on = t.id === value;
        return (
          <button key={t.id} type="button" role="tab" aria-selected={on} tabIndex={on ? 0 : -1} onClick={() => onChange(t.id)}
            data-hint={hint ? `${hint}-${t.id}` : undefined}
            className={twMerge("relative flex shrink-0 cursor-pointer items-center gap-1.5 whitespace-nowrap px-2 py-2 font-display text-[10px] uppercase tracking-wider transition-colors", FOCUS,
              fill && "grow justify-center @max-md:px-1 @max-md:tracking-normal",
              on ? "text-fg" : "text-fg-muted hover:text-fg", fresh.current.has(t.id) && !calm && "ui-tab-in")}>
            {t.icon}
            <span>{t.label}</span>
            {t.badge}
            {on && <span aria-hidden className="pointer-events-none absolute inset-x-2 bottom-0 h-0.5 bg-console" />}
          </button>
        );
      })}
    </div>
  );
}
