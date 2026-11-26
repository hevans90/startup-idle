/**
 * FOUNDING, ONE CONSOLE: the three steps — who, where, on what terms — over
 * the console's grid with motes rising through it. A HUD along the top: the
 * name deciphering in, the step rail (where you are lit), the step's own
 * figures, the theme. Back and Next in the same place at the foot of every step.
 * @see FounderSelect, MapSetup, TermSheetSelect
 */
import type { ReactNode } from "react";
import { twMerge } from "tailwind-merge";

import { IconMoon, IconSun } from "@tabler/icons-react";

import { useThemeStore } from "../state/theme.store";
import { CURRENT_VERSION } from "../state/version.store";
import { Backdrop, FOCUS, Frame, Segmented, Text } from "../ui/console";

export type FoundingStep = "founder" | "land" | "terms";

const STEPS: readonly { id: FoundingStep; name: string }[] = [
  { id: "founder", name: "Founder" },
  { id: "land", name: "Land" },
  { id: "terms", name: "Terms" },
];

/** A figure in the HUD: what, then how much, in its colour. */
export function HudFigure({ label, value, className }: { label: string; value: ReactNode; className?: string }) {
  return (
    <Frame kind="underline" assemble="always" inner="flex items-baseline gap-2 px-2.5 pb-1.5 pt-1">
      <span className="font-display text-[10px] uppercase tracking-[0.2em] text-fg-faint">{label}</span>
      <span className={twMerge("font-display text-sm tabular-nums", className)}>{value}</span>
    </Frame>
  );
}

/** A BUTTON IN THE HUD: corners that light under the pointer; the step's own (primary), an octagon already lit. */
export function HudButton({ children, onClick, tone = "console", primary = false, disabled = false }: {
  children: ReactNode;
  onClick: () => void;
  tone?: "console" | "ai";
  primary?: boolean;
  disabled?: boolean;
}) {
  const ink = tone === "ai" ? "text-ai" : "text-console";
  return (
    <button type="button" onClick={onClick} disabled={disabled}
      className={twMerge("group shrink-0 cursor-pointer disabled:cursor-not-allowed disabled:opacity-40", FOCUS)}>
      <Frame kind={primary ? "octagon" : "corners"} tone={tone} lit={primary && !disabled} illuminate={!disabled} assemble={primary ? "always" : false}
        inner={twMerge("flex items-center gap-2 whitespace-nowrap font-display uppercase",
          primary ? twMerge("px-7 py-2.5 text-sm tracking-[0.2em]", ink) : twMerge("px-4 py-2 text-[11px] tracking-[0.18em] text-fg-muted transition-colors group-hover:text-fg", tone === "ai" && "text-ai group-hover:text-ai"))}>
        {children}
      </Frame>
    </button>
  );
}

export function FoundingShell({ step, title, subtitle, back, next, foot, meta, children }: {
  step: FoundingStep;
  title: string;
  subtitle?: ReactNode;
  /** Back a step; none on the first. */
  back?: () => void;
  next: { label: string; disabled?: boolean; onClick: () => void };
  /** Beside the buttons: a seed, links. */
  foot?: ReactNode;
  /** In the HUD, before the theme: the step's own figures. @see HudFigure */
  meta?: ReactNode;
  children: ReactNode;
}) {
  const at = STEPS.findIndex((s) => s.id === step);
  const theme = useThemeStore((s) => s.theme);
  const setTheme = useThemeStore((s) => s.setTheme);
  return (
    <div className="relative flex h-full w-full flex-col overflow-hidden bg-[color-mix(in_oklab,var(--ui-surface-1),var(--ui-surface-2))] text-fg dark:bg-surface-0">
      <Backdrop kind="grid" still />
      <Backdrop kind="puffs" />
      {/* THE HUD. */}
      <header className="relative flex shrink-0 flex-wrap items-center gap-x-8 gap-y-3 px-4 pt-4 sm:px-8">
        <span className="flex items-baseline gap-2 whitespace-nowrap">
          <Text mode="decipher" text="Startup Idle" className="font-display text-lg tracking-[0.15em] text-console" />
          <span className="font-display text-[10px] tabular-nums text-fg-faint">v{CURRENT_VERSION}</span>
        </span>
        <ol aria-label="Founding" className="flex items-center gap-2 font-display text-[11px] uppercase tracking-[0.2em] max-sm:hidden">
          {STEPS.map((s, i) => (
            <li key={s.id} aria-current={i === at ? "step" : undefined} className="flex items-center gap-2">
              {i > 0 && <span aria-hidden className={twMerge("h-px w-8", i <= at ? "bg-console" : "bg-line")} />}
              <Frame kind="corners" lit={i === at} assemble={i === at ? "always" : false}
                inner={twMerge("px-2.5 py-1", i === at ? "text-console" : i < at ? "text-fg-muted" : "text-fg-faint")}>
                <span className="tabular-nums">0{i + 1}</span> {s.name}
              </Frame>
            </li>
          ))}
        </ol>
        <div className="flex flex-1 flex-wrap items-center justify-end gap-3 whitespace-nowrap max-sm:w-full max-sm:basis-full max-sm:justify-between">
          {meta}
          <Segmented label="Theme" value={theme} onChange={setTheme} options={[
            { value: "light", label: <IconSun size={14} aria-hidden />, title: "Light" },
            { value: "dark", label: <IconMoon size={14} aria-hidden />, title: "Dark" },
          ]} />
        </div>
      </header>
      <main className="relative min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex min-h-full w-full max-w-[110rem] flex-col gap-6 px-4 py-6 sm:px-8">
          <div className="flex items-center gap-4">
            <span aria-hidden className="h-6 w-1 bg-console" />
            <div>
              <Text key={title} as="h1" mode="decipher" text={title} className="block font-display text-2xl uppercase tracking-[0.12em]" />
              {subtitle && <p className="mt-0.5 text-sm text-fg-muted">{subtitle}</p>}
            </div>
          </div>
          {children}
        </div>
      </main>
      {/* BACK AND NEXT, where they always are. */}
      <footer className="relative flex shrink-0 flex-wrap items-center gap-3 px-4 pb-5 pt-3 sm:px-8">
        {back && <HudButton onClick={back}>← Back</HudButton>}
        {foot}
        <span aria-hidden className="h-px min-w-8 flex-1 bg-console/40" />
        <HudButton primary disabled={next.disabled} onClick={next.onClick}>{next.label}</HudButton>
      </footer>
    </div>
  );
}
