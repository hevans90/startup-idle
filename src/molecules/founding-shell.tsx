/**
 * FOUNDING, ONE BOOT SEQUENCE: the three steps — who, where, on what terms —
 * in one frame over the console's backdrop, the step rail at its head, and
 * Back and Next in the same place at its foot on every step.
 * @see FounderSelect, MapSetup, TermSheetSelect, plans/ui-overhaul.md §3.5
 */
import type { ReactNode } from "react";
import { twMerge } from "tailwind-merge";

import { Backdrop, Button, Frame, Text } from "../ui/console";

export type FoundingStep = "founder" | "land" | "terms";

const STEPS: readonly { id: FoundingStep; name: string }[] = [
  { id: "founder", name: "Founder" },
  { id: "land", name: "Land" },
  { id: "terms", name: "Term sheet" },
];

export function FoundingShell({ step, title, subtitle, back, next, foot, aside, children }: {
  step: FoundingStep;
  title: string;
  subtitle?: ReactNode;
  /** Back a step; none on the first. */
  back?: () => void;
  next: { label: string; disabled?: boolean; onClick: () => void };
  /** Beside the buttons: the version, a seed. */
  foot?: ReactNode;
  /** A column beside the frame, on wide screens. */
  aside?: ReactNode;
  children: ReactNode;
}) {
  const at = STEPS.findIndex((s) => s.id === step);
  return (
    <div className="relative flex h-full w-full overflow-hidden bg-surface-0 text-fg">
      <Backdrop kind="grid" />
      <div className="relative flex min-w-0 flex-1 flex-col gap-4 p-3 sm:p-6">
        {/* THE RAIL: where you are of the three. */}
        <ol aria-label="Founding" className="flex items-center justify-center gap-2 font-display text-xs uppercase tracking-widest">
          {STEPS.map((s, i) => (
            <li key={s.id} aria-current={i === at ? "step" : undefined} className="flex items-center gap-2">
              {i > 0 && <span aria-hidden className={twMerge("h-px w-6 sm:w-10", i <= at ? "bg-console" : "bg-line")} />}
              <span className={i === at ? "text-console" : i < at ? "text-fg" : "text-fg-faint"}>
                {i + 1} · {s.name}
              </span>
            </li>
          ))}
        </ol>
        <Frame kind="octagon" assemble="auto" className="flex min-h-0 flex-1 flex-col" inner="flex min-h-0 flex-1 flex-col">
          <div className="flex min-h-0 flex-1 flex-col">
            <header className="shrink-0 px-5 pt-5 text-center">
              <Text as="h1" text={title} className="block font-display text-2xl tracking-wide sm:text-3xl" />
              {subtitle && <p className="mt-1 text-sm text-fg-muted">{subtitle}</p>}
            </header>
            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-6">{children}</div>
            {/* BACK AND NEXT, where they always are. */}
            <footer className="flex shrink-0 items-center gap-3 border-t border-line-quiet px-5 py-3">
              <div className="flex-1">
                {back && <Button onClick={back}>← Back</Button>}
              </div>
              {foot && <div className="text-[11px] tabular-nums text-fg-faint">{foot}</div>}
              <div className="flex flex-1 justify-end">
                <Button variant="primary" size="md" disabled={next.disabled} onClick={next.onClick} className="font-bold">{next.label}</Button>
              </div>
            </footer>
          </div>
        </Frame>
      </div>
      {aside}
    </div>
  );
}
