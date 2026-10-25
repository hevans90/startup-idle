/**
 * THE CONSOLE'S READOUTS: a number in its resource's colour, a meter filling
 * an underline frame, a badge, a chip, a key, a tooltip — and a LOCKED
 * feature, shown behind a frame with what unlocks it and the way to it,
 * never an empty box. @see plans/ui-overhaul.md §2
 */
import { cloneElement, useEffect, useState, type ReactElement, type ReactNode } from "react";
import type Decimal from "break_infinity.js";
import { FloatingPortal, autoUpdate, flip, offset, shift, useDismiss, useFloating, useFocus, useHover, useInteractions, useRole } from "@floating-ui/react";
import { twMerge } from "tailwind-merge";
import { IconLock } from "@tabler/icons-react";

import { ENTER_MOST, useConsoleMotion } from "../motion";
import type { Role } from "../theme/tokens";
import { Button } from "./controls";
import type { Tone } from "./frame";

/** What a popover is drawn as: a raised surface, a strong line. Every popover the same. */
export const POPOVER = "border border-line-strong bg-surface-3 p-3 text-fg shadow-lg outline-none focus:ring-0";

const color = (tone: Tone) => (tone === "console" ? "var(--ui-console)" : `var(--ui-${tone})`);

/** A number, in its resource's colour, its digits lined up. */
export function Num({ children, role, className }: { children: ReactNode; role?: Role; className?: string }) {
  return <span className={twMerge("tabular-nums", className)} style={role ? { color: color(role) } : undefined}>{children}</span>;
}

/**
 * A NUMBER COUNTING UP to what it is, over the entrance's budget, on a timer
 * (a hidden tab's frames stop); at once when calm. A `Decimal` counts as one.
 */
export function CountUp<T extends number | Decimal>({ to, format, role, className }: { to: T; format: (v: T) => string; role?: Role; className?: string }) {
  const { calm } = useConsoleMotion();
  const [t, setT] = useState(calm ? 1 : 0);
  const key = String(to);
  useEffect(() => {
    if (calm) { setT(1); return; }
    const start = Date.now(), ms = ENTER_MOST * 1000;
    setT(0);
    const id = window.setInterval(() => {
      const k = Math.min(1, (Date.now() - start) / ms);
      setT(k);
      if (k >= 1) window.clearInterval(id);
    }, 40);
    return () => window.clearInterval(id);
  }, [calm, key]);
  // Eased out: fast, then settling on it.
  const e = 1 - (1 - t) ** 3;
  const v = (typeof to === "number" ? to * e : (to as Decimal).mul(e)) as T;
  return <Num role={role} className={className}>{format(t >= 1 ? to : v)}</Num>;
}

/** How far something has come, 0–1: its label and number over a thin bar, filled in its tone. */
export function Meter({ value, tone = "console", label, detail, className }: {
  value: number;
  tone?: Tone;
  /** What it measures, for the eye and the screen reader. */
  label: string;
  /** Beside the label: a number, a stage. */
  detail?: ReactNode;
  className?: string;
}) {
  const v = Math.max(0, Math.min(1, value));
  return (
    <div className={twMerge("flex flex-col gap-1 text-xs", className)}>
      <div className="flex items-baseline justify-between gap-2"><span className="text-fg-muted">{label}</span>{detail && <span className="tabular-nums">{detail}</span>}</div>
      <div role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(v * 100)} className="h-1 w-full bg-surface-3">
        <div className="h-full transition-[width] duration-500" style={{ width: `${v * 100}%`, background: color(tone) }} />
      </div>
    </div>
  );
}

/** A count, or a state, in a small pill. */
export function Badge({ children, tone = "console" }: { children: ReactNode; tone?: Tone }) {
  return (
    <span className="inline-flex min-w-4 items-center justify-center px-1 text-[10px] font-bold leading-4 tabular-nums"
      style={{ color: color(tone), background: tone === "console" ? "var(--ui-accent-soft)" : `var(--ui-${tone}-soft)` }}>{children}</span>
  );
}

/** A modifier, a gate, a tag: its words on a tint of its tone. */
export function Chip({ children, tone = "console", title }: { children: ReactNode; tone?: Tone; title?: string }) {
  return (
    <span title={title} className="inline-flex items-center gap-1 border px-1.5 text-[11px] leading-5"
      style={{ color: color(tone), borderColor: tone === "console" ? "var(--ui-console)" : `var(--ui-${tone}-line)`, background: tone === "console" ? "var(--ui-accent-soft)" : `var(--ui-${tone}-soft)` }}>{children}</span>
  );
}

/** A key on the keyboard. */
export const Kbd = ({ children }: { children: ReactNode }) => (
  <kbd className="border border-line bg-surface-2 px-1 font-space-mono text-[10px] leading-4 text-fg-muted">{children}</kbd>
);

/**
 * What something is, on hover or focus: one behaviour everywhere — in after
 * 300 ms, beside what it explains and never over it, gone on Esc.
 */
export function Tooltip({ content, children }: { content: ReactNode; children: ReactElement<Record<string, unknown>> }) {
  const [open, setOpen] = useState(false);
  const { refs, floatingStyles, context } = useFloating({
    open, onOpenChange: setOpen, placement: "top", whileElementsMounted: autoUpdate, middleware: [offset(6), flip(), shift({ padding: 8 })],
  });
  const { getReferenceProps, getFloatingProps } = useInteractions([
    useHover(context, { delay: { open: 300, close: 0 }, move: false }), useFocus(context), useDismiss(context), useRole(context, { role: "tooltip" }),
  ]);
  return (
    <>
      {cloneElement(children, { ref: refs.setReference, ...getReferenceProps(children.props) })}
      {open && (
        <FloatingPortal>
          <div ref={refs.setFloating} style={floatingStyles} {...getFloatingProps()}
            className="z-[60] max-w-xs border border-line-strong bg-surface-3 px-2 py-1 text-xs text-fg shadow">
            {content}
          </div>
        </FloatingPortal>
      )}
    </>
  );
}

/**
 * A FEATURE NOT YET OPEN: a dashed outline where it will be, what is in it
 * dimmed, what opens it and — if it is somewhere on the map — a way to be shown.
 */
export function Locked({ needs, onShow, children, className }: { needs: ReactNode; onShow?: () => void; children?: ReactNode; className?: string }) {
  return (
    <div className={twMerge("flex flex-col gap-1.5 border border-dashed border-line bg-surface-1/60 p-2.5 text-fg", className)}>
      {children && <div aria-hidden className="pointer-events-none select-none opacity-30">{children}</div>}
      <div className="flex items-center justify-between gap-3 text-xs">
        <span className="flex items-center gap-2 text-fg-muted"><IconLock size={14} aria-hidden className="shrink-0" />{needs}</span>
        {onShow && <Button size="sm" variant="secondary" onClick={onShow} className="shrink-0 whitespace-nowrap">Show me</Button>}
      </div>
    </div>
  );
}
