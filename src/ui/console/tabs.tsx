/**
 * THE CONSOLE'S TABS: a rail of them, the current one underlined by a frame,
 * arrow keys between them; a tab that has just opened draws itself on.
 * @see plans/ui-overhaul.md §3.4
 */
import type { ReactNode } from "react";
import { twMerge } from "tailwind-merge";

import { FOCUS } from "./controls";
import { Frame } from "./frame";

export type TabItem<T extends string> = { id: T; label: ReactNode; icon?: ReactNode; badge?: ReactNode };

export function Tabs<T extends string>({ tabs, value, onChange, label, className }: {
  tabs: readonly TabItem<T>[];
  value: T;
  onChange: (id: T) => void;
  label: string;
  className?: string;
}) {
  const move = (dir: number) => {
    const i = tabs.findIndex((t) => t.id === value);
    onChange(tabs[(i + dir + tabs.length) % tabs.length].id);
  };
  return (
    <div role="tablist" aria-label={label} className={twMerge("flex items-stretch gap-1 border-b border-line-quiet", className)}
      onKeyDown={(e) => { if (e.key === "ArrowRight") { e.preventDefault(); move(1); } else if (e.key === "ArrowLeft") { e.preventDefault(); move(-1); } }}>
      {tabs.map((t) => {
        const on = t.id === value;
        return (
          <button key={t.id} type="button" role="tab" aria-selected={on} tabIndex={on ? 0 : -1} onClick={() => onChange(t.id)}
            className={twMerge("relative flex cursor-pointer items-center gap-1.5 px-3 py-2 text-sm transition-colors", FOCUS,
              on ? "text-fg" : "text-fg-muted hover:text-fg")}>
            {t.icon}
            <span>{t.label}</span>
            {t.badge}
            {on && <Frame kind="underline" assemble="auto" className="pointer-events-none absolute inset-x-1 bottom-0 h-2" />}
          </button>
        );
      })}
    </div>
  );
}
