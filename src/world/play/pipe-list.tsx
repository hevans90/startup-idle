/**
 * World v2 — EVERY PIPE, LISTED, while the Pipes view is on: which side is
 * shown — water or sewers — a row a network with a dot for its state, what
 * it joins and how much of what it could carry it is carrying, trouble at
 * the top, a click to fly there; and the key to the map's colours along the
 * bottom. @see pipeRows, plans/pipe-network.md §8
 */
import { twMerge } from "tailwind-merge";

import { useTicking } from "../../hooks/use-ticking";
import { useWorldStore } from "../../state/world.store";
import { pipeRows, type PipeRow, type PipeTone } from "../pipes/overview";
import { showMe } from "./map-focus";

/** A state's colour, as the map draws it, and its line: solid while it works, broken where it needs help, dots where it has stopped. */
export const PIPE_KEY: { tone: PipeTone; label: string; dot: string; line: string }[] = [
  { tone: "good", label: "Working", dot: "bg-good dark:bg-good", line: "border-solid border-good dark:border-good" },
  { tone: "warn", label: "Needs help", dot: "bg-warn dark:bg-warn", line: "border-dashed border-warn dark:border-warn" },
  { tone: "bad", label: "Stopped", dot: "bg-bad dark:bg-bad", line: "border-dotted border-bad dark:border-bad" },
];
const DOT: Record<PipeTone, string> = { good: PIPE_KEY[0].dot, warn: PIPE_KEY[1].dot, bad: PIPE_KEY[2].dot, idle: "bg-surface-3 dark:bg-surface-3" };
const BAR: Record<PipeTone, string> = { ...DOT };
const SIDE = "px-2 py-0.5 text-[10px] uppercase tracking-widest";

function Row({ r, w }: { r: PipeRow; w: number }) {
  return (
    <button type="button" onClick={() => showMe({ x: r.cell % w, y: Math.floor(r.cell / w) })}
      title={`${r.text}${r.warning ? ` · ${r.warning}` : ""} · ${r.flow.toFixed(2)} of ${r.capacity.toFixed(2)} a second`}
      className="flex w-full cursor-pointer items-center gap-2 py-0.5 text-left hover:bg-surface-2 dark:hover:bg-surface-2">
      <span aria-hidden className={twMerge("h-2 w-2 shrink-0 rounded-full", DOT[r.tone])} />
      <span className="min-w-0 flex-1 truncate">{r.joins}</span>
      <span className={twMerge("shrink-0", r.tone === "bad" ? "text-bad" : r.tone === "warn" ? "text-warn" : "text-fg-muted")}>{r.warning ? "Soon" : r.title}</span>
      <span aria-hidden className="h-1 w-8 shrink-0 bg-surface-3 dark:bg-surface-3">
        <span className={twMerge("block h-full", BAR[r.tone])} style={{ width: `${Math.round(r.share * 100)}%` }} />
      </span>
    </button>
  );
}

export function PipeList({ className }: { className?: string }) {
  useTicking(1000);
  const water = useWorldStore((s) => s.waterOverlay);
  const sewers = useWorldStore((s) => s.sewerView);
  const tool = useWorldStore((s) => s.tool);
  const playing = useWorldStore((s) => s.playing);
  const setWater = useWorldStore((s) => s.setWaterOverlay);
  const setSewers = useWorldStore((s) => s.setSewerView);
  // ON BY ITSELF with either tool, on that tool's side.
  const side = sewers || tool === "sewer" ? "sewers" : water || tool === "pipe" ? "water" : null;
  if (!playing || !side) return null;
  const g = useWorldStore.getState().grid;
  const rows = pipeRows(g).filter((r) => (r.kind === "main") === (side === "water"));
  const pick = (to: "water" | "sewers") => { setWater(to === "water"); setSewers(to === "sewers"); };
  return (
    <div className={twMerge("w-72 border border-line-quiet bg-surface-1/95 p-2.5 text-xs text-fg shadow-lg backdrop-blur-sm", className)}>
      <div className="mb-1 flex items-center justify-between gap-2">
        <p className="flex items-center gap-2 font-display text-xs uppercase tracking-widest"><span aria-hidden className="h-3 w-0.5 bg-good dark:bg-good" />Pipes</p>
        <div className="flex border border-line-quiet" role="group" aria-label="Which pipes">
          <button type="button" aria-pressed={side === "water"} onClick={() => pick("water")} className={twMerge(SIDE, side === "water" && "bg-surface-3 dark:bg-surface-3")}>Water</button>
          <button type="button" aria-pressed={side === "sewers"} onClick={() => pick("sewers")} className={twMerge(SIDE, side === "sewers" && "bg-surface-3 dark:bg-surface-3")}>Sewers</button>
        </div>
      </div>
      {!rows.length && <p className="text-fg-muted">{side === "water" ? "No water mains yet." : "No sewers yet."}</p>}
      <div className="max-h-48 overflow-y-auto">{rows.map((r) => <Row key={r.key} r={r} w={g.w} />)}</div>
      <p className="mt-1.5 flex items-center gap-3 border-t border-line-quiet pt-1.5 text-[10px] text-fg-muted">
        {PIPE_KEY.map((k) => (
          <span key={k.tone} className="flex items-center gap-1"><span aria-hidden className={twMerge("w-4 border-t-2", k.line)} />{k.label}</span>
        ))}
      </p>
    </div>
  );
}
