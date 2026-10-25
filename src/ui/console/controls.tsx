/**
 * THE CONSOLE'S CONTROLS: buttons, a switch, a choice of a few, a slider —
 * each in the tokens' colours, keyboard-complete, a focus ring in the
 * console's colour. A primary button is a choice, so it wears the corners
 * frame. @see plans/ui-overhaul.md §2
 */
import { forwardRef, useEffect, useState, type ButtonHTMLAttributes, type ForwardedRef, type ReactNode } from "react";
import { twMerge } from "tailwind-merge";

import { sfx } from "../../audio/sound";
import { Frame, type Tone } from "./frame";

/** The focus ring every control shows from the keyboard. */
export const FOCUS = "outline-none focus-visible:ring-2 focus-visible:ring-console focus-visible:ring-offset-1 focus-visible:ring-offset-surface-0";

export type ButtonVariant = "primary" | "secondary" | "quiet" | "danger";
const VARIANT: Record<ButtonVariant, string> = {
  primary: "text-fg",
  secondary: "border border-line bg-surface-2 text-fg hover:border-line-strong",
  quiet: "text-fg-muted hover:bg-surface-2 hover:text-fg",
  danger: "border border-bad-line text-bad hover:bg-bad-soft",
};
const SIZE = { sm: "px-2 py-0.5 text-xs", md: "px-3 py-1.5 text-sm" };

export type ButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "prefix"> & {
  variant?: ButtonVariant;
  size?: keyof typeof SIZE;
  /** The primary's frame tone. */
  tone?: Tone;
  loading?: boolean;
  /**
   * Asks for a second press before it acts: the first arms it ("Press again"),
   * the second confirms, with the confirm tone. For what costs, or cannot be
   * taken back.
   */
  confirm?: boolean | string;
  children?: ReactNode;
};

export const Button = forwardRef(function Button(
  { variant = "secondary", size = "md", tone = "console", loading, confirm, className, children, onClick, disabled, onBlur, ...rest }: ButtonProps,
  ref: ForwardedRef<HTMLButtonElement>,
) {
  const [armed, setArmed] = useState(false);
  // Armed, it disarms on its own after a while.
  useEffect(() => {
    if (!armed) return;
    const t = window.setTimeout(() => setArmed(false), 4000);
    return () => window.clearTimeout(t);
  }, [armed]);
  const body = (
    <span className="relative flex items-center justify-center gap-1.5">
      {armed ? (typeof confirm === "string" ? confirm : "Press again") : children}
      {loading && <span aria-hidden className="h-3 w-3 animate-spin rounded-full border-2 border-line border-t-console" />}
    </span>
  );
  return (
    <button
      ref={ref}
      type="button"
      {...rest}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      onBlur={(e) => { setArmed(false); onBlur?.(e); }}
      onClick={(e) => {
        if (confirm && !armed) { setArmed(true); return; }
        if (confirm) { setArmed(false); sfx("confirm"); }
        onClick?.(e);
      }}
      className={twMerge(
        "cursor-pointer select-none font-space-mono transition-colors disabled:cursor-not-allowed disabled:opacity-50",
        FOCUS, SIZE[size], VARIANT[variant], armed && "text-warn", className,
      )}
    >
      {variant === "primary" ? <Frame kind="corners" tone={tone} illuminate lit={armed} className="-mx-1 -my-0.5 px-1 py-0.5">{body}</Frame> : body}
    </button>
  );
});

/** A button that is only an icon: its label for the screen reader and the tooltip. */
export function IconButton({ label, children, className, ...rest }: Omit<ButtonProps, "children" | "variant"> & { label: string; children: ReactNode }) {
  return (
    <Button variant="quiet" size="sm" aria-label={label} title={label} className={twMerge("px-1.5", className)} {...rest}>{children}</Button>
  );
}

/** A switch: on or off. */
export function Toggle({ on, onChange, label, disabled }: { on: boolean; onChange: (on: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} disabled={disabled} onClick={() => onChange(!on)}
      className={twMerge("relative inline-flex h-4 w-8 shrink-0 cursor-pointer items-center border transition-colors disabled:opacity-50", FOCUS,
        on ? "border-console bg-accent-soft" : "border-line bg-surface-2")}>
      <span className={twMerge("absolute h-2.5 w-2.5 transition-transform", on ? "translate-x-4 bg-console" : "translate-x-0.5 bg-fg-faint")} />
    </button>
  );
}

/** One of a few: a row of choices, the chosen one lit. Arrow keys move between them. */
export function Segmented<T extends string>({ value, options, onChange, label, size = "sm" }: {
  value: T;
  options: readonly { value: T; label: ReactNode; title?: string }[];
  onChange: (value: T) => void;
  label: string;
  size?: keyof typeof SIZE;
}) {
  const move = (dir: number) => {
    const i = options.findIndex((o) => o.value === value);
    onChange(options[(i + dir + options.length) % options.length].value);
  };
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex border border-line"
      onKeyDown={(e) => { if (e.key === "ArrowRight") { e.preventDefault(); move(1); } else if (e.key === "ArrowLeft") { e.preventDefault(); move(-1); } }}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button key={o.value} type="button" role="radio" aria-checked={on} title={o.title} tabIndex={on ? 0 : -1} onClick={() => onChange(o.value)}
            className={twMerge("cursor-pointer transition-colors", FOCUS, SIZE[size],
              on ? "bg-surface-3 text-console" : "text-fg-muted hover:bg-surface-2 hover:text-fg")}>
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/** A slider, in the console's colour. */
export function Slider({ value, onChange, min = 0, max = 1, step = 0.05, label, disabled, onCommit }: {
  value: number; onChange: (v: number) => void; min?: number; max?: number; step?: number; label: string; disabled?: boolean;
  /** When the pointer lets go: to hear what it set. */
  onCommit?: () => void;
}) {
  return (
    <input type="range" min={min} max={max} step={step} value={value} aria-label={label} disabled={disabled}
      onChange={(e) => onChange(Number(e.target.value))} onPointerUp={onCommit}
      className={twMerge("h-1 w-24 cursor-pointer accent-[var(--ui-console)] disabled:cursor-not-allowed disabled:opacity-40", FOCUS)} />
  );
}
