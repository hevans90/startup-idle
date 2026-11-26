/**
 * THE DOCK'S PARTS: the bar along the bottom of a map, as the editor's has it — a pane of glass with rounded ends,
 * tools as tiles in their own colour, a bubble over what is hovered. The editor's tool bar and the player's build bar
 * are both made of these. @see ToolDock, BuildBar
 */
import type { CSSProperties, ReactNode } from "react";
import { twMerge } from "tailwind-merge";

/** The pane, with no blur behind it: a blur over the map is dear on the GPU. */
export const DOCK = "border border-line bg-surface-0/95";
/** A tray over the bar. */
export const DOCK_TRAY = twMerge("dock-tray-in pointer-events-auto flex max-w-full rounded-2xl p-2.5", DOCK);
export const DOCK_FOCUS = "outline-none focus-visible:ring-2 focus-visible:ring-tone";
export const toned = (tone: string) => ({ "--tone": tone }) as CSSProperties;

export const Key = ({ k }: { k: string }) => <kbd className="rounded border border-line bg-surface-2 px-1 font-mono text-[10px] leading-4 text-fg-muted">{k.toUpperCase()}</kbd>;

/** A bubble over what is hovered: what it is, its key, and what it does. */
export function Tip({ name, hint, k }: { name: string; hint?: ReactNode; k?: string }) {
  return (
    <span role="tooltip" className="pointer-events-none absolute bottom-full left-1/2 z-30 mb-2 w-max max-w-60 -translate-x-1/2 translate-y-1 rounded-lg border border-line bg-surface-1 px-2.5 py-1.5 text-left text-[11px] leading-snug font-normal tracking-normal text-fg normal-case opacity-0 transition-all delay-0 duration-100 group-hover/tip:translate-y-0 group-hover/tip:opacity-100 group-hover/tip:delay-300 group-focus-visible/tip:opacity-100">
      <span className="flex items-center gap-2 font-semibold">{name}{k && <Key k={k} />}</span>
      {hint && <span className="mt-0.5 block text-fg-muted">{hint}</span>}
    </span>
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
