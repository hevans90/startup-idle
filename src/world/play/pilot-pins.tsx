/**
 * World v2 — THE PILOT'S PINS: under AI mode, a pin on the map for every job
 * in its queue that has a place, coloured by its state — ready, saving or
 * waiting, blocked. A click opens its card: what, why, what it costs, and
 * where it stands. HTML over the canvas, held to its tile as the camera
 * moves. @see usePilotView, EventMarkers
 */
import { useEffect, useRef, useState } from "react";
import { twMerge } from "tailwind-merge";

import { useAiDriving } from "../../hooks/use-ai-driving";
import { usePilotView, type JobView, type PilotState } from "../../state/pilot-view.store";
import { useWorldStore } from "../../state/world.store";
import { Card } from "../../ui/console";
import { formatCurrency } from "../../utils/money-utils";
import { idx, inBounds } from "../grid";
import { cellToWorld } from "../iso";

const PIN: Record<PilotState, string> = {
  ready: "border-console bg-console/40", saving: "border-warn bg-warn/40", waiting: "border-warn bg-warn/20",
  blocked: "border-bad bg-bad/40", cancelled: "border-line bg-surface-3",
};
const WORDS: Record<PilotState, string> = { ready: "text-console", saving: "text-warn", waiting: "text-fg-muted", blocked: "text-bad", cancelled: "text-fg-faint" };

/** The jobs that get a pin: those with a place, one a tile, the best first. */
export function pinned(queue: readonly JobView[]): JobView[] {
  const taken = new Set<string>(), out: JobView[] = [];
  for (const j of queue) {
    if (!j.at || j.state === "cancelled") continue;
    const key = `${j.at.x},${j.at.y}`;
    if (taken.has(key)) continue;
    taken.add(key);
    out.push(j);
  }
  return out;
}

export function PilotPins() {
  const driving = useAiDriving();
  const queue = usePilotView((s) => s.queue);
  const playing = useWorldStore((s) => s.playing);
  const [open, setOpen] = useState<string | null>(null);
  const els = useRef(new Map<string, HTMLDivElement>());
  const pins = driving && playing ? pinned(queue) : [];
  const where = useRef(pins);
  where.current = pins;
  useEffect(() => {
    if (!driving) return;
    let raf = 0;
    const frame = () => {
      raf = requestAnimationFrame(frame);
      const st = useWorldStore.getState(), vp = st.viewport, g = st.grid;
      if (!vp) return;
      for (const j of where.current) {
        const el = els.current.get(j.id), at = j.at!;
        if (!el) continue;
        const h = inBounds(g, at.x, at.y) ? g.height[idx(g, at.x, at.y)] : 0;
        const w = cellToWorld(at.x, at.y, h), p = vp.toScreen(w.wx, w.wy);
        el.style.transform = `translate(${Math.round(p.x)}px, ${Math.round(p.y)}px)`;
      }
    };
    frame();
    return () => cancelAnimationFrame(raf);
  }, [driving]);
  if (!pins.length) return null;
  return (
    <div className="pointer-events-none absolute inset-0 z-10 overflow-hidden">
      {pins.map((j) => (
        <div key={j.id} ref={(el) => { if (el) els.current.set(j.id, el); else els.current.delete(j.id); }} className="absolute left-0 top-0">
          <button type="button" aria-label={`${j.says}: ${j.shown}`} aria-expanded={open === j.id} title={j.says}
            onClick={() => setOpen(open === j.id ? null : j.id)}
            className={twMerge("pointer-events-auto absolute -left-2 -top-2 h-4 w-4 rotate-45 cursor-pointer border-2 shadow", PIN[j.state], open === j.id && "ring-2 ring-fg")} />
          {open === j.id && (
            <div className="pointer-events-auto absolute left-4 top-0">
              <Card onClose={() => setOpen(null)} className="w-64" title={j.says}>
                <p className="text-fg-muted">{j.why}</p>
                <p className="flex items-baseline justify-between gap-2 tabular-nums">
                  <span>{j.cost > 0 ? <>{formatCurrency(j.cost, { showDollarSign: j.costs === "money" })}{j.costs === "innovation" && " innovation"}</> : "Free"}</span>
                  <span className={WORDS[j.state]}>{j.shown}</span>
                </p>
              </Card>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
