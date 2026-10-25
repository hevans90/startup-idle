/**
 * THE CONSOLE'S STRUCTURE: a panel (a standing part of it, the kranox frame),
 * a card (something on the map now, the nefrex), a section's divider, and a
 * dialog (something the game asks of you, the octagon) — focus kept inside it
 * and given back, Esc to close where it can be closed, its entrance in steps:
 * the frame, the title, the body, the actions. @see Frame, useSequence
 */
import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { twMerge } from "tailwind-merge";

import { sfx } from "../../audio/sound";
import { useConsoleMotion, useSequence } from "../motion";
import { Backdrop } from "./backdrop";
import { FOCUS } from "./controls";
import { Tooltip } from "./feedback";
import { Frame, type Tone } from "./frame";
import { Text } from "./text";

/** A small label: a panel's controls, a field, a kicker over a title. */
export const Label = ({ children, className }: { children: ReactNode; className?: string }) => (
  <span className={twMerge("text-[10px] uppercase tracking-widest text-fg-muted", className)}>{children}</span>
);

/** A standing part of the console: a title, its controls, what it is for on a "?", and what is in it. */
export function Panel({ title, controls, help, tone = "console", className, children }: {
  title: string;
  controls?: ReactNode;
  help?: ReactNode;
  tone?: Tone;
  className?: string;
  children?: ReactNode;
}) {
  return (
    <Frame kind="kranox" tone={tone} className={twMerge("text-fg", className)}>
      <section aria-label={title} className="flex flex-col gap-2 px-3 pb-3 pt-2">
        <header className="flex items-center justify-between gap-2">
          <Text as="h3" text={title} className="font-display text-sm uppercase tracking-wider text-[color:var(--frame-tone,var(--ui-console))]" />
          {(controls || help) && (
            <div className="flex items-center gap-1">
              {controls}
              {help && (
                <Tooltip content={<div className="max-w-64 text-xs">{help}</div>}>
                  <button type="button" aria-label={`About ${title}`} className={twMerge("cursor-help border border-line px-1.5 text-xs text-fg-muted hover:text-fg", FOCUS)}>?</button>
                </Tooltip>
              )}
            </div>
          )}
        </header>
        {children}
      </section>
    </Frame>
  );
}

/** Something on the map, now: a card with a title and, if it can go, a close. */
export function Card({ title, tone = "console", onClose, className, children }: {
  title?: ReactNode;
  tone?: Tone;
  onClose?: () => void;
  className?: string;
  children?: ReactNode;
}) {
  return (
    <Frame kind="nefrex" tone={tone} className={twMerge("text-xs text-fg", className)}>
      <div className="flex flex-col gap-1 px-2.5 py-2">
        {(title || onClose) && (
          <div className="flex items-start justify-between gap-2">
            {title && <div className="font-bold">{title}</div>}
            {onClose && (
              <button type="button" onClick={onClose} aria-label="Close" className={twMerge("cursor-pointer px-1 text-fg-muted hover:text-fg", FOCUS)}>✕</button>
            )}
          </div>
        )}
        {children}
      </div>
    </Frame>
  );
}

/** A divider inside a panel, with a label. */
export function Section({ label, children }: { label?: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <Frame kind="lines" className="h-3" />
      {label && <Label>{label}</Label>}
      {children}
    </div>
  );
}

const FOCUSABLE = "button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex='-1'])";

/**
 * Something the game asks of you, over everything: the octagon, a faint
 * pattern behind, a kicker and a title, what it says, and what you can do.
 * Without `onClose` it cannot be dismissed — it must be answered.
 */
export function Dialog({ title, kicker, onClose, actions, tone = "console", wide, children }: {
  title: string;
  kicker?: string;
  /** Closing it: Esc, and the ✕. None, and it must be answered. */
  onClose?: () => void;
  actions?: ReactNode;
  tone?: Tone;
  wide?: boolean;
  children?: ReactNode;
}) {
  const box = useRef<HTMLDivElement>(null);
  const { calm } = useConsoleMotion();
  // Its entrance: the frame, then the title, then the body, then the actions.
  const step = useSequence(4, calm, title);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    sfx("open");
    const back = document.activeElement as HTMLElement | null;
    const first = box.current?.querySelector<HTMLElement>(FOCUSABLE);
    (first ?? box.current)?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape" && close.current) { e.preventDefault(); close.current(); return; }
      if (e.key !== "Tab" || !box.current) return;
      const all = [...box.current.querySelectorAll<HTMLElement>(FOCUSABLE)];
      if (!all.length) return;
      const [a, z] = [all[0], all[all.length - 1]];
      if (e.shiftKey && document.activeElement === a) { e.preventDefault(); z.focus(); }
      else if (!e.shiftKey && document.activeElement === z) { e.preventDefault(); a.focus(); }
    };
    window.addEventListener("keydown", key);
    return () => { window.removeEventListener("keydown", key); sfx("close"); back?.focus?.(); };
  }, []);
  return createPortal(
    // On a phone, the whole screen. @see isPhone
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-surface-0/60 p-4 backdrop-blur-[1px] max-md:p-0">
      <div ref={box} role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} className={twMerge("w-full outline-none max-md:h-full max-md:max-w-none", wide ? "max-w-2xl" : "max-w-md")}>
        <Frame kind="octagon" tone={tone} assemble="auto" className="text-fg max-md:h-full max-md:bg-surface-1" inner="max-md:h-full max-md:overflow-y-auto">
          <Backdrop kind="dots" />
          <div className="relative flex flex-col gap-3 p-5">
            <div className="flex items-start justify-between gap-2">
              <div>
                {kicker && <Label className="text-console">{kicker}</Label>}
                {step >= 2 && <Text as="h2" text={title} className="block font-display text-xl tracking-wide" />}
              </div>
              {onClose && (
                <button type="button" onClick={onClose} aria-label="Close" className={twMerge("cursor-pointer px-1 text-fg-muted hover:text-fg", FOCUS)}>✕</button>
              )}
            </div>
            <div className={twMerge("text-sm transition-opacity duration-200", step >= 3 ? "opacity-100" : "opacity-0")}>{children}</div>
            {actions && <div className={twMerge("flex flex-wrap justify-end gap-2 transition-opacity duration-200", step >= 4 ? "opacity-100" : "opacity-0")}>{actions}</div>}
          </div>
        </Frame>
      </div>
    </div>,
    document.body,
  );
}
