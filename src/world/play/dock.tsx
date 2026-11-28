/**
 * THE DOCK: the console's deck along the bottom of a map, with a light touch of arwes — its cut frame, still.
 *  - THE BAR, one slim row in a cut frame; in AI mode the AI's violet. @see DockBar
 *  - TOOLS as their pictures; ONE SELECTION, a tint in the tool's own colour that slides to the tool in hand, its
 *    name beside it. @see Slide, DockTool
 *  - TRAYS, cut panels tethered to what opened them, heard opening and closing. @see DockTray, DockCard
 *  - ONE BUBBLE for the page, in the hovered tool's colour. @see DockTip
 * The editor's tool bar and the player's build bar are both made of these.
 * @see ToolDock, BuildBar, ui/console
 */
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { twMerge } from "tailwind-merge";

import { sfx } from "../../audio/sound";
import { Frame } from "../../ui/console";

/** The bar's body. (No blur behind it: a blur over the map is dear on the GPU.) */
export const DOCK = "border border-line bg-surface-0";
/** A tray's body, where it is not a frame's. */
export const DOCK_TRAY = "pointer-events-auto flex max-w-full";
export const DOCK_FOCUS = "outline-none focus-visible:ring-2 focus-visible:ring-tone";
/** A shape cut at two corners, as the octagon frame is: what its fill and its light are clipped to. */
const CUT = (n: number) => `polygon(${n}px 0, 100% 0, 100% calc(100% - ${n}px), calc(100% - ${n}px) 100%, 0 100%, 0 ${n}px)`;
/** The labels' face: the console's display type. */
const FACE = "font-display uppercase tracking-[0.14em]";
/** A tool's own colour as its tone: a hue picked for the dark, taken deeper in the light so it reads there. @see index.css --tone-ink */
export const toned = (tone: string) => ({ "--tone": tone.startsWith("#") ? `color-mix(in oklab, ${tone}, black var(--tone-ink))` : tone }) as CSSProperties;

export const Key = ({ k }: { k: string }) => <kbd className="border border-line bg-surface-2 px-1 font-mono text-[10px] leading-4 text-fg-muted">{k.toUpperCase()}</kbd>;

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
  // In the colour of what it is over.
  const tone = getComputedStyle(t.el).getPropertyValue("--tone").trim() || "var(--ui-console)";
  return createPortal(
    <div ref={box} role="tooltip" style={{ left: at?.x ?? -9999, top: at?.y ?? -9999, "--tone": tone } as CSSProperties}
      className="pointer-events-none fixed z-[1000] w-max max-w-64 -translate-y-full border-l-2 border-tone bg-surface-3 py-1.5 pr-3 pl-2.5 text-left text-[11px] leading-snug font-normal tracking-normal whitespace-normal text-fg normal-case">
      <span className="flex items-center gap-2 font-semibold text-fg">{t.name}{t.k && <Key k={t.k} />}</span>
      {t.hint && <span className="mt-0.5 block text-fg-muted">{t.hint}</span>}
    </div>,
    document.body,
  );
}

/** A hair between parts of the bar. */
export const Rule = () => <span aria-hidden className="mx-1 h-5 w-px shrink-0 bg-line-quiet" />;

/** A heading over a part of a tray, and a hair's rule between parts. */
export const Part = ({ title, note, children, className }: { title: ReactNode; note?: ReactNode; children: ReactNode; className?: string }) => (
  <section className={twMerge("flex min-w-0 shrink-0 flex-col gap-1.5 border-line-quiet px-3 not-first:border-l first:pl-1 last:pr-1", className)}>
    <h3 className={twMerge("flex h-4 items-center justify-between gap-3 text-[10px] text-fg-faint", FACE, "tracking-[0.2em]")}>
      <span className="flex items-center gap-1.5">
        {typeof title === "string" ? <><span aria-hidden className="size-1 bg-tone" />{title}</> : title}
      </span>
      {note !== undefined && <span className="font-mono tracking-normal whitespace-nowrap text-fg-muted normal-case">{note}</span>}
    </h3>
    {children}
  </section>
);

/** Under the pointer: a faint ground. */
const HOVER = "hover:bg-surface-1";

/**
 * A tool of the bar: its picture alone, its name and key in the bubble; in hand, lit by its `<Slide>`'s one selection,
 * its name beside it. `always`: its name shown whether in hand or not.
 */
export function DockTool({ on, onClick, name, label, hint, k, tone, children, dead, meter, always, className, ...rest }: {
  on: boolean; onClick: () => void; name: string; label?: string; hint?: ReactNode; k?: string; tone: string; children: ReactNode;
  dead?: boolean; meter?: ReactNode; always?: boolean; className?: string;
} & Record<`data-${string}` | `aria-${string}`, string | undefined>) {
  const said = label ?? name;
  return (
    <button type="button" aria-label={name} aria-pressed={on} disabled={dead} onClick={onClick} style={toned(tone)} data-slide="" {...rest}
      className={twMerge("group/tip relative z-[1] flex h-9 min-w-9 shrink-0 items-center justify-center gap-1.5 px-2 text-[10px] whitespace-nowrap transition-colors duration-200", FACE, DOCK_FOCUS,
        dead ? "text-fg-faint opacity-40" : "cursor-pointer", !dead && !on && HOVER, !dead && (on ? "text-fg" : "text-fg-muted hover:text-fg"), className)}>
      <span className={twMerge("grid place-items-center transition-[color,transform] duration-200 group-active/tip:scale-90", on ? "text-tone" : "group-hover/tip:text-tone")}>{children}</span>
      {(on || always) && <span className="max-w-28 truncate pr-0.5 max-md:hidden">{said}</span>}
      {meter}
      <Tip name={name} hint={hint} k={k} />
    </button>
  );
}

/**
 * A RUN OF TOOLS WITH ONE SELECTION: a tint of the tool in hand's tone, a line under it, that slides to the next as it
 * is picked. It finds the pressed `[data-slide]` among its own.
 */
export function Slide({ children, className }: { children: ReactNode; className?: string }) {
  const box = useRef<HTMLDivElement>(null);
  const [at, setAt] = useState<{ x: number; w: number; tone: string; el: Element } | null>(null);
  const [moved, setMoved] = useState(false);
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const place = () => {
      const on = el.querySelector<HTMLElement>(':scope > [data-slide][aria-pressed="true"]');
      setAt((was) => {
        if (!on) return null;
        const now = { x: on.offsetLeft, w: on.offsetWidth, tone: on.style.getPropertyValue("--tone"), el: on };
        if (was && was.x === now.x && was.w === now.w && was.tone === now.tone && was.el === now.el) return was;
        if (was) setMoved(true);
        return now;
      });
    };
    place();
    const seen = new MutationObserver(place);
    seen.observe(el, { subtree: true, childList: true, attributes: true, attributeFilter: ["aria-pressed", "style"] });
    const sized = new ResizeObserver(place);
    sized.observe(el);
    return () => { seen.disconnect(); sized.disconnect(); };
  }, []);
  return (
    <div ref={box} className={twMerge("relative flex items-center", className)}>
      {at && (
        <span aria-hidden style={{ ...toned(at.tone), width: at.w, transform: `translateX(${at.x}px)` } as CSSProperties}
          className={twMerge("pointer-events-none absolute top-1/2 left-0 h-9 -translate-y-1/2 bg-tone-soft", moved && "transition-[transform,width] duration-200 ease-out")}>
          <span className="absolute inset-x-2 bottom-0 h-0.5 bg-tone" />
        </span>
      )}
      {children}
    </div>
  );
}

/** Whether a thing that comes and goes is still on the page, and whether it is going: so it can leave as it came. */
export function usePresence(open: boolean, ms = 140): { shown: boolean; leaving: boolean } {
  const [shown, setShown] = useState(open);
  if (open && !shown) setShown(true);
  useEffect(() => {
    if (open || !shown) return;
    const id = setTimeout(() => setShown(false), ms);
    return () => clearTimeout(id);
  }, [open, shown, ms]);
  return { shown: shown || open, leaving: shown && !open };
}

/**
 * THE BAR: one slim row in a cut frame, its body cut to the frame's shape. `ai`: the frame in the AI's violet.
 */
export function DockBar({ ai = false, className, children, ...rest }: { ai?: boolean; className?: string; children: ReactNode } & Record<`aria-${string}`, string>) {
  const tone = ai ? "var(--ui-ai)" : "var(--ui-console)";
  return (
    <div role="toolbar" {...rest} data-dock-bar="" style={{ "--tone": tone, "--frame-tone": tone } as CSSProperties}
      className="pointer-events-auto relative max-w-full select-none">
      <div aria-hidden className="absolute inset-0 bg-surface-0" style={{ clipPath: CUT(7) }} />
      <Frame kind="cut" assemble={false} className="pointer-events-none absolute inset-0" style={{ "--frame-tone": tone, "--arwes-frames-bg-color": "transparent" } as CSSProperties} />
      <div className={twMerge("relative flex items-center px-1.5 py-1", className)}>{children}</div>
    </div>
  );
}

/**
 * A TRAY over the bar: a cut panel, tethered by a line to what opened it — `from`, a selector
 * among the dock's own — and heard opening and closing. Leaving, it sinks away as it rose.
 */
export function DockTray({ from, tone, leaving, className, children }: { from?: string; tone?: string; leaving?: boolean; className?: string; children: ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
  const [x, setX] = useState<number | null>(null);
  useEffect(() => { sfx("open"); }, []);
  useEffect(() => { if (leaving) sfx("close"); }, [leaving]);
  useLayoutEffect(() => {
    const el = box.current;
    if (!el || !from) { setX(null); return; }
    const place = () => {
      const to = el.closest("[data-dock-stack]")?.querySelector<HTMLElement>(from);
      if (!to) { setX(null); return; }
      const a = to.getBoundingClientRect(), b = el.getBoundingClientRect();
      setX(Math.max(16, Math.min(b.width - 16, a.left + a.width / 2 - b.left)));
    };
    place();
    const sized = new ResizeObserver(place);
    sized.observe(el);
    addEventListener("resize", place);
    return () => { sized.disconnect(); removeEventListener("resize", place); };
  }, [from]);
  const t = toned(tone ?? "var(--ui-console)");
  return (
    <div ref={box} style={{ ...t, "--frame-tone": "var(--tone)" } as CSSProperties} className={twMerge("relative max-w-full", leaving ? "dock-tray-out pointer-events-none" : "dock-tray-in")}>
      <Frame kind="cut" assemble={false} style={{ "--frame-tone": "var(--tone)", "--arwes-frames-bg-color": "var(--ui-surface-0)" } as CSSProperties}
        className="pointer-events-auto max-w-full" inner={twMerge("flex max-w-full px-2.5 py-2", className)}>
        {children}
      </Frame>
      {x !== null && (
        <span aria-hidden style={{ left: x }} className="pointer-events-none absolute top-full flex h-2 -translate-x-1/2 flex-col items-center transition-[left] duration-200">
          <span className="w-px flex-1 bg-tone" /><span className="size-[3px] bg-tone" />
        </span>
      )}
    </div>
  );
}

/** A card in a tray: a hair's border, the tone's under the pointer and when chosen. */
export function DockCard({ on, onClick, title, className, children }: { on: boolean; i?: number; onClick: () => void; title?: string; className?: string; children: ReactNode }) {
  return (
    <button type="button" aria-pressed={on} title={title} onClick={onClick}
      className={twMerge("group shrink-0 cursor-pointer border text-left transition-colors", DOCK_FOCUS,
        on ? "border-tone bg-tone-soft" : "border-line-quiet bg-surface-1 hover:border-tone")}>
      <div className={className}>{children}</div>
    </button>
  );
}

/** A button of the bar's own: a view, a switch. Square, its picture alone. */
export function DockButton({ on, dead, onClick, name, k, hint, tone, children, ...rest }: {
  on?: boolean; dead?: boolean; onClick: () => void; name: string; k?: string; hint?: ReactNode; tone?: string; children: ReactNode;
} & Record<`data-${string}` | `aria-${string}`, string | boolean | undefined>) {
  return (
    <button type="button" aria-label={name} aria-pressed={on} disabled={dead} onClick={onClick} style={toned(tone ?? "var(--ui-console)")} {...rest}
      className={twMerge("group/tip relative grid size-9 shrink-0 place-items-center transition-colors", DOCK_FOCUS,
        dead ? "text-fg-faint opacity-40" : "cursor-pointer active:scale-90",
        !dead && (on ? "bg-tone-soft text-tone" : twMerge("text-fg-muted hover:text-fg", HOVER)))}>
      {children}
      <Tip name={name} k={k} hint={hint} />
    </button>
  );
}

/** One of a few, in a run of them. */
export function Choice({ on, onClick, name, hint, children }: { on: boolean; onClick: () => void; name: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <button type="button" aria-pressed={on} aria-label={name} onClick={onClick}
      className={twMerge("group/tip relative flex h-7 cursor-pointer items-center justify-center gap-1.5 px-2 text-[10px] whitespace-nowrap transition-colors", FACE, DOCK_FOCUS,
        on ? "bg-tone-soft text-tone" : twMerge("text-fg-muted hover:text-fg", HOVER))}>
      {children}
      {hint && <Tip name={name} hint={hint} />}
    </button>
  );
}
export const Run = ({ children }: { children: ReactNode }) => <div className="flex w-max items-center gap-0.5 border border-line-quiet bg-surface-1 p-0.5">{children}</div>;
