/**
 * World v2 — "+$X" rising off a seaport each time it is paid for a call, so
 * the trade on the river reads as money without a glance at a counter.
 * @see recordCall
 *
 * HTML over the canvas, like the labels: each starts at the top of what the
 * port drew, is kept as a point in the world so it pans with the map, and
 * rises and fades over a second and a half.
 */
import { useEffect, useRef, useState } from "react";

import { getExports, useWorldStore } from "../../state/world.store";
import { formatCurrency } from "../../utils/money-utils";
import { drawnTop, shownStructures } from "../structures/layer";

/** How long one rises for, ms, and how far, px. */
const LIFE = 1600;
const RISE = 28;

type Float = { key: number; amount: number; at: number; wx: number; wy: number };

export function PortIncome() {
  const [floats, setFloats] = useState<Float[]>([]);
  const els = useRef(new Map<number, HTMLSpanElement>());
  const live = useRef<Float[]>([]);

  useEffect(() => {
    let raf = 0, next = 1;
    const frame = () => {
      raf = requestAnimationFrame(frame);
      const vp = useWorldStore.getState().viewport, sl = shownStructures();
      const now = performance.now();
      const fresh = getExports().fresh.splice(0);
      let changed = false;
      if (vp && sl) {
        for (const p of fresh) {
          const top = drawnTop(sl, p.port);
          if (!top) continue;
          const w = vp.toWorld(top.x, top.y);
          live.current.push({ key: next++, amount: p.amount, at: now, wx: w.x, wy: w.y });
          changed = true;
        }
      }
      const kept = live.current.filter((f) => now - f.at < LIFE);
      if (kept.length !== live.current.length) changed = true;
      live.current = kept;
      if (changed) setFloats([...kept]);
      if (!vp) return;
      for (const f of kept) {
        const el = els.current.get(f.key);
        if (!el) continue;
        const k = (now - f.at) / LIFE, p = vp.toScreen(f.wx, f.wy);
        el.style.opacity = String(1 - k * k);
        el.style.transform = `translate(${Math.round(p.x)}px, ${Math.round(p.y - 8 - RISE * k)}px) translate(-50%, -100%)`;
      }
    };
    frame();
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      {floats.map((f) => (
        <span key={f.key}
          ref={(el) => { if (el) els.current.set(f.key, el); else els.current.delete(f.key); }}
          className="absolute left-0 top-0 whitespace-nowrap text-xs font-bold tabular-nums text-emerald-600 opacity-0 drop-shadow dark:text-emerald-300">
          +{formatCurrency(f.amount)}
        </span>
      ))}
    </div>
  );
}
