/**
 * World v2 — THE PROFILE STRIP: a pipe seen from the side, under its card.
 * The ground as a filled shape, the pipe as a line along or under it; for a
 * water main, its source's level, the line the water can rise to and the
 * building's floor; for a sewer, its piers where it spans and its lift
 * stations. The stretch at fault is drawn over in red. No words on it: what
 * is wrong is the card's to say, and the strip's tooltip repeats it.
 * @see PipeProfile, plans/pipe-network.md §8
 */
import { twMerge } from "tailwind-merge";

import type { PipeProfile } from "../pipes/profile";

const W = 280, H = 60, PAD = 6;

export function PipeProfileStrip({ profile, className }: { profile: PipeProfile | null; className?: string }) {
  if (!profile || profile.cells.length < 2) return null;
  const p = profile, n = p.cells.length;
  const levels = [...p.ground, ...p.pipe, ...(p.head ?? []).filter((h): h is number => h !== null), ...(p.source !== null ? [p.source] : []), ...(p.floor !== null ? [p.floor] : [])];
  const lo = Math.min(...levels) - 1, hi = Math.max(...levels) + 1;
  const x = (k: number) => PAD + (k / (n - 1)) * (W - 2 * PAD);
  const y = (v: number) => PAD + ((hi - v) / (hi - lo)) * (H - 2 * PAD);
  const line = (vs: readonly number[], from = 0) => vs.map((v, k) => `${x(from + k).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  /** The head line in the stretches where water reaches. */
  const heads: number[][] = [];
  if (p.head) {
    let run: number[] = [], at = 0;
    p.head.forEach((h, k) => {
      if (h === null) { if (run.length > 1) heads.push([at, ...run]); run = []; return; }
      if (!run.length) at = k;
      run.push(h);
    });
    if (run.length > 1) heads.push([at, ...run]);
  }
  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={p.kind === "main" ? "The main from the side" : "The sewer from the side"}
      className={twMerge("mt-1 h-[60px] w-full border-t border-line-quiet dark:border-line-quiet", className)}>
      {p.reason && <title>{p.reason}</title>}
      {/* THE GROUND, filled to the bottom. */}
      <polygon points={`${x(0)},${H} ${line(p.ground)} ${x(n - 1)},${H}`} className="fill-surface-3 dark:fill-surface-3" />
      <polyline points={line(p.ground)} fill="none" strokeWidth={1} className="stroke-fg-muted dark:stroke-fg-muted" />
      {/* A SEWER'S PIERS where it spans, and its manholes: a line from the ground to the pipe. */}
      {p.spans?.map((on, k) => on && <line key={`s${k}`} x1={x(k)} x2={x(k)} y1={y(p.pipe[k])} y2={y(p.ground[k])} strokeWidth={1} className="stroke-fg-muted dark:stroke-fg-muted" />)}
      {p.marks.filter((m) => m.kind === "manhole").map((m) => (
        <line key={`m${m.at}`} x1={x(m.at)} x2={x(m.at)} y1={y(p.ground[m.at])} y2={y(p.pipe[m.at])} strokeWidth={2} className="stroke-fg dark:stroke-fg" />
      ))}
      {/* THE FLOOR it must reach, and the water at its source. */}
      {p.floor !== null && <line x1={x(0)} x2={x(n - 1)} y1={y(p.floor)} y2={y(p.floor)} strokeWidth={1} strokeDasharray="2 3" className="stroke-fg-muted dark:stroke-fg-muted" />}
      {p.source !== null && <line x1={0} x2={x(0) + 8} y1={y(p.source)} y2={y(p.source)} strokeWidth={2} className="stroke-info dark:stroke-info" />}
      {/* THE PIPE. */}
      <polyline points={line(p.pipe)} fill="none" strokeWidth={p.kind === "sewer" ? 2 : 1.5} strokeLinejoin="round" className={p.kind === "sewer" ? "stroke-warn dark:stroke-warn" : "stroke-fg dark:stroke-fg"} />
      {/* THE LINE THE WATER CAN RISE TO. */}
      {heads.map(([at, ...vs]) => <polyline key={`h${at}`} points={line(vs, at)} fill="none" strokeWidth={1.5} className="stroke-good dark:stroke-good" />)}
      {/* THE STRETCH AT FAULT, over all of it. */}
      {p.bad.map(([a, b]) => (
        <polyline key={`b${a}`} points={line((p.kind === "main" && p.head ? p.head.map((h, k) => h ?? p.pipe[k]) : p.pipe).slice(a, b + 1), a)} fill="none" strokeWidth={3} strokeLinecap="round"
          className="stroke-bad dark:stroke-bad" />
      ))}
      {/* A PUMP, a wedge at its foot; a LIFT STATION, a wedge pointing up; the EXIT, a dot. */}
      {p.marks.map((m) => {
        const cx = x(m.at), cy = y(m.kind === "pump" && p.head?.[m.at] != null ? p.head[m.at]! : p.pipe[m.at]);
        if (m.kind === "pump" || m.kind === "lift") return <polygon key={`${m.kind}${m.at}`} points={`${cx - 4},${cy + 5} ${cx + 4},${cy + 5} ${cx},${cy - 3}`} className="fill-good dark:fill-good" />;
        if (m.kind === "exit") return <circle key={`e${m.at}`} cx={cx} cy={cy} r={2.5} className="fill-fg dark:fill-fg" />;
        return null;
      })}
    </svg>
  );
}
