/**
 * THE DOCK'S PARTS: the bar along the bottom of a map, as the editor's has it — a pane of glass with rounded ends,
 * tools as tiles in their own colour, a bubble over what is hovered. The editor's tool bar and the player's build bar
 * are both made of these. @see ToolDock, BuildBar
 */
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { twMerge } from "tailwind-merge";

/** The pane, with no blur behind it: a blur over the map is dear on the GPU. */
export const DOCK = "border border-line bg-surface-0/95";
/** A tray over the bar. */
export const DOCK_TRAY = twMerge("dock-tray-in pointer-events-auto flex max-w-full rounded-2xl p-2.5", DOCK);
export const DOCK_FOCUS = "outline-none focus-visible:ring-2 focus-visible:ring-tone";
/** A tool's own colour as its tone: a hue picked for the dark, taken deeper in the light so it reads there. @see index.css --tone-ink */
export const toned = (tone: string) => ({ "--tone": tone.startsWith("#") ? `color-mix(in oklab, ${tone}, black var(--tone-ink))` : tone }) as CSSProperties;

export const Key = ({ k }: { k: string }) => <kbd className="rounded border border-line bg-surface-2 px-1 font-mono text-[10px] leading-4 text-fg-muted">{k.toUpperCase()}</kbd>;

/**
 * THE DOCK'S ONE BUBBLE: what is hovered, its key, and what it does. One for the whole page, so two never stack;
 * stood over the whole dock — its trays too — so it never covers one; slow to come the first time, then quick from
 * tool to tool. A `<Tip>` inside a button is only what to say. @see DockTip
 */
type TipSay = { name: string; hint?: ReactNode; k?: string };
type TipNow = TipSay & { el: HTMLElement };
let tipNow: TipNow | null = null, warmUntil = 0, timer: ReturnType<typeof setTimeout> | undefined;
const tipSubs = new Set<() => void>();
const setTip = (t: TipNow | null) => { tipNow = t; for (const f of tipSubs) f(); };
const TIP_DELAY = 350, TIP_WARM = 400;
function showTip(t: TipNow) {
  clearTimeout(timer);
  if (performance.now() < warmUntil || tipNow) setTip(t);
  else timer = setTimeout(() => setTip(t), TIP_DELAY);
}
function hideTip(el: HTMLElement) {
  clearTimeout(timer);
  if (tipNow?.el !== el) return;
  warmUntil = performance.now() + TIP_WARM;
  setTip(null);
}

/** What a button says in the dock's bubble: put inside it. */
export function Tip(say: TipSay) {
  const ref = useRef<HTMLSpanElement>(null);
  const said = useRef(say);
  said.current = say;
  // (Said again while shown — Undo's sum, Pause become Resume — the bubble follows.)
  useEffect(() => { if (tipNow && tipNow.el === ref.current?.parentElement) setTip({ ...say, el: tipNow.el }); });
  useEffect(() => {
    const el = ref.current?.parentElement;
    if (!el) return;
    let pressed = false;
    const enter = () => { if (!pressed) showTip({ ...said.current, el }); };
    const leave = () => { pressed = false; hideTip(el); };
    // A press puts it away till the pointer leaves: what was clicked may open a tray where it stood.
    const press = () => { pressed = true; clearTimeout(timer); if (tipNow?.el === el) setTip(null); };
    const focus = () => { if (el.matches(":focus-visible")) showTip({ ...said.current, el }); };
    el.addEventListener("pointerenter", enter);
    el.addEventListener("pointerleave", leave);
    el.addEventListener("pointerdown", press);
    el.addEventListener("focus", focus);
    el.addEventListener("blur", leave);
    return () => {
      el.removeEventListener("pointerenter", enter);
      el.removeEventListener("pointerleave", leave);
      el.removeEventListener("pointerdown", press);
      el.removeEventListener("focus", focus);
      el.removeEventListener("blur", leave);
      hideTip(el);
    };
  }, []);
  return <span ref={ref} hidden />;
}

/** The bubble itself: once on the page, wherever a dock is. */
export function DockTip() {
  const t = useSyncExternalStore((f) => { tipSubs.add(f); return () => tipSubs.delete(f); }, () => tipNow);
  const box = useRef<HTMLDivElement>(null);
  const [at, setAt] = useState<{ x: number; y: number } | null>(null);
  useLayoutEffect(() => {
    if (!t || !box.current) { setAt(null); return; }
    if (!t.el.isConnected) { setTip(null); return; }
    const r = t.el.getBoundingClientRect();
    // Over the whole dock it is in: its trays too.
    const top = Math.min(r.top, t.el.closest("[data-dock-stack]")?.getBoundingClientRect().top ?? r.top);
    const w = box.current.offsetWidth, pad = 8;
    setAt({ x: Math.max(pad, Math.min(innerWidth - w - pad, r.left + r.width / 2 - w / 2)), y: top - 8 });
  }, [t]);
  if (!t) return null;
  return createPortal(
    <div ref={box} role="tooltip" style={{ left: at?.x ?? -9999, top: at?.y ?? -9999 }}
      className="pointer-events-none fixed z-[1000] w-max max-w-64 -translate-y-full rounded-lg border border-line-strong bg-surface-3 px-2.5 py-1.5 text-left text-[11px] leading-snug font-normal tracking-normal whitespace-normal text-fg normal-case">
      <span className="flex items-center gap-2 font-semibold">{t.name}{t.k && <Key k={t.k} />}</span>
      {t.hint && <span className="mt-0.5 block text-fg-muted">{t.hint}</span>}
    </div>,
    document.body,
  );
}

/** A hair's rule between parts of the bar. */
export const Rule = () => <span className="mx-1 h-8 w-px shrink-0 bg-line-quiet" />;

/** A heading over a part of a tray, and a hair's rule between parts. */
export const Part = ({ title, note, children, className }: { title: ReactNode; note?: ReactNode; children: ReactNode; className?: string }) => (
  <section className={twMerge("flex min-w-0 shrink-0 flex-col gap-1.5 border-line-quiet px-3 not-first:border-l first:pl-1 last:pr-1", className)}>
    <h3 className="flex h-4 items-center justify-between gap-3 text-[10px] tracking-[0.18em] text-fg-faint uppercase">
      {title}{note !== undefined && <span className="font-mono tracking-normal whitespace-nowrap text-fg-muted normal-case">{note}</span>}
    </h3>
    {children}
  </section>
);

/** A tool of the bar: a tile with its picture and name, lit in its own colour while it is in hand. */
export function DockTool({ on, onClick, name, label, hint, k, tone, children, dead, className, ...rest }: {
  on: boolean; onClick: () => void; name: string; label?: ReactNode; hint?: ReactNode; k?: string; tone: string; children: ReactNode; dead?: boolean; className?: string;
} & Record<`data-${string}` | `aria-${string}`, string | undefined>) {
  return (
    <button type="button" aria-label={name} aria-pressed={on} disabled={dead} onClick={onClick} style={toned(tone)} {...rest}
      className={twMerge("group/tip relative flex h-12 min-w-16 shrink-0 flex-col items-center justify-center gap-0.5 rounded-xl px-1.5 text-[11px] whitespace-nowrap transition-all duration-150 max-md:min-w-11", DOCK_FOCUS,
        dead ? "text-fg-faint opacity-40" : "cursor-pointer active:scale-95",
        !dead && (on ? "-translate-y-0.5 bg-tone-fill text-fg" : "text-fg-muted hover:-translate-y-0.5 hover:bg-surface-2 hover:text-fg"), className)}>
      <span className={twMerge("grid place-items-center", on ? "text-tone" : "transition-colors group-hover/tip:text-tone")}>{children}</span>
      <span className="max-md:hidden">{label ?? name}</span>
      {k && <span className="absolute top-0.5 right-1 font-mono text-[9px] text-fg-faint max-md:hidden">{k.toUpperCase()}</span>}
      <span className={twMerge("absolute -bottom-px h-0.5 rounded-full bg-tone transition-all duration-200", on ? "w-8" : "w-0")} />
      <Tip name={name} hint={hint} k={k} />
    </button>
  );
}

/** A button of the bar's own: a view, a switch. Square, its picture alone. */
export function DockButton({ on, dead, onClick, name, k, hint, tone, children, ...rest }: {
  on?: boolean; dead?: boolean; onClick: () => void; name: string; k?: string; hint?: ReactNode; tone?: string; children: ReactNode;
} & Record<`data-${string}` | `aria-${string}`, string | boolean | undefined>) {
  return (
    <button type="button" aria-label={name} aria-pressed={on} disabled={dead} onClick={onClick} style={toned(tone ?? "var(--ui-console)")} {...rest}
      className={twMerge("group/tip relative grid size-10 shrink-0 place-items-center rounded-xl transition-all", DOCK_FOCUS,
        dead ? "text-fg-faint opacity-40" : "cursor-pointer active:scale-90", !dead && (on ? "bg-tone-fill text-tone" : "text-fg-muted hover:bg-surface-2 hover:text-fg"))}>
      {children}
      <Tip name={name} k={k} hint={hint} />
    </button>
  );
}

/** One of a few, in a run of them. */
export function Choice({ on, onClick, name, hint, children }: { on: boolean; onClick: () => void; name: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <button type="button" aria-pressed={on} aria-label={name} onClick={onClick}
      className={twMerge("group/tip relative flex h-7 cursor-pointer items-center justify-center gap-1.5 rounded-lg px-2 text-[11px] whitespace-nowrap transition-colors", DOCK_FOCUS,
        on ? "bg-tone-fill text-fg shadow-[inset_0_0_0_1px_var(--tone)]" : "text-fg-muted hover:bg-surface-3 hover:text-fg")}>
      {children}
      {hint && <Tip name={name} hint={hint} />}
    </button>
  );
}
export const Run = ({ children }: { children: ReactNode }) => <div className="flex w-max items-center gap-0.5 rounded-xl bg-surface-1 p-0.5">{children}</div>;
