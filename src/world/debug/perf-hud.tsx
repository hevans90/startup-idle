/**
 * The frame's cost, top left, over the map.
 *
 * A readout rather than a profiler: it is here so that a change to the water
 * can be judged against what it costs while you are looking at it, instead of
 * by going away and running a bench. What the four numbers mean, and which of
 * them is not a measurement, is in `perf.ts`.
 */
import { useEffect, useState } from "react";

import { perfRead, type PerfRead } from "./perf";
import { stampsNow } from "./gpu-stamps";

/** Four a second. Faster than that and the digits are unreadable anyway. */
const EVERY = 250;

const ms = (v: number) => v.toFixed(2).padStart(5, " ");

/** Green while there is room in a sixty hertz frame, amber close, red over. */
const bar = (v: number) =>
  v > 16.7 ? "text-red-400 dark:text-red-400"
    : v > 11 ? "text-amber-400 dark:text-amber-400"
      : "text-emerald-400 dark:text-emerald-400";

type Gpu = { of: Record<string, number>; total: number; frames: number };

export function PerfHud() {
  const [p, setP] = useState<PerfRead | null>(null);
  /**
   * WHAT THE GPU SPENT, which is the half `frame - js` cannot separate from
   * waiting. Here rather than on the water toggle because the render is timed
   * whichever solver is running, and putting it with the water implied it was
   * the water's. @see holdStamps
   */
  const [g, setG] = useState<Gpu | null>(null);
  useEffect(() => {
    const t = setInterval(() => {
      setP(perfRead());
      setG(stampsNow()?.says() ?? null);
    }, EVERY);
    return () => clearInterval(t);
  }, []);
  if (!p) return null;

  const row = (name: string, v: number, tint = "text-gray-200 dark:text-gray-200") => (
    <div className="flex justify-between gap-3">
      <span className="text-gray-400 dark:text-gray-500">{name}</span>
      <span className={`tabular-nums ${tint}`}>{ms(v)}</span>
    </div>
  );

  return (
    <div
      className="pointer-events-none absolute left-2 top-2 z-10 rounded
        border border-gray-700 bg-gray-900/80 px-2 py-1.5 font-mono text-[11px]
        leading-tight text-gray-200
        dark:border-gray-700 dark:bg-gray-900/80 dark:text-gray-200"
    >
      <div className="mb-1 flex justify-between gap-3">
        <span className="text-gray-400 dark:text-gray-500">fps</span>
        <span className={`tabular-nums ${bar(p.frame)}`}>
          {p.fps.toFixed(0).padStart(5, " ")}
        </span>
      </div>
      {row("solve", p.solve)}
      {row("build", p.build)}
      {row("present*", p.present)}
      <div className="my-1 border-t border-gray-700 dark:border-gray-700" />
      {/* `present` is left out of this on purpose: it is mostly the wait on
          the compositor, so counting it would make a quiet frame look busy.
          See `perf.ts` — it goes DOWN as the frame fills up. */}
      {row("js", p.js, bar(p.js))}
      {row("frame", p.frame, bar(p.frame))}
      {g && g.frames > 0 && (
        <>
          <div className="my-1 border-t border-gray-700 dark:border-gray-700" />
          {row("gpu", g.total, bar(g.total))}
          {/* Biggest first, and only what clears the browser's own hundred
              microsecond quantisation — below that a row is noise. */}
          {Object.entries(g.of)
            .sort((a, b) => b[1] - a[1])
            .filter(([, v]) => v >= 0.1)
            .slice(0, 5)
            .map(([name, v]) => (
              <div key={name} className="flex justify-between gap-3 pl-2">
                <span className="text-gray-500 dark:text-gray-600">{name}</span>
                <span className="tabular-nums text-gray-400 dark:text-gray-500">
                  {ms(v)}
                </span>
              </div>
            ))}
        </>
      )}
    </div>
  );
}
