/**
 * World v2 — "+$X" rising off a seaport each time it is paid for a call, and
 * off every WORKPLACE every few seconds for what the people at its desks
 * earned in them — so the town reads as money, and which building carries the
 * company is something you see, not something you work out from a counter.
 * @see recordCall, liveSeating
 *
 * HTML over the canvas, like the labels: each starts at the top of what the
 * port drew, is kept as a point in the world so it pans with the map, and
 * rises and fades over a second and a half.
 */
import { useEffect, useRef, useState } from "react";

import { getExports, useWorldStore } from "../../state/world.store";
import { payday } from "./payday";
import { formatCurrency } from "../../utils/money-utils";
import { drawnTop, shownStructures } from "../structures/layer";
import { cellToWorld } from "../iso";

/** How long one rises for, ms, and how far, px. */
const LIFE = 1600;
const RISE = 28;
/** How often each workplace says what it earned, ms. */
const PAYDAY = 5000;
/** The most rising at once; and how far off the screen, px, one still starts. */
const MAX_FLOATS = 24;
const MARGIN = 80;

type Float = { key: number; amount: number; at: number; wx: number; wy: number };

export function PortIncome() {
  const [floats, setFloats] = useState<Float[]>([]);
  const els = useRef(new Map<number, HTMLSpanElement>());
  const live = useRef<Float[]>([]);

  useEffect(() => {
    let raf = 0, next = 1, paidAt = performance.now();
    const frame = () => {
      raf = requestAnimationFrame(frame);
      const vp = useWorldStore.getState().viewport, sl = shownStructures();
      const now = performance.now();
      const fresh: { port: number; amount: number }[] = getExports().fresh.splice(0);
      if (now - paidAt >= PAYDAY) {
        for (const p of payday(now - paidAt)) fresh.push({ port: p.structure, amount: p.amount });
        paidAt = now;
      }
      let changed = false;
      if (vp && sl && fresh.length) {
        // ON THE SCREEN, AND A FEW: placed by the tile first, which is cheap,
        // and only those in view measured — the biggest first, up to `MAX_FLOATS`
        // in the air. Every workplace on a big town measured and floated at
        // once held the page for a fifth of a second every payday.
        const grid = useWorldStore.getState().grid, scale = useWorldStore.getState().scale;
        const seen = fresh.filter((p) => {
          const s = grid.structures.get(p.port);
          if (!s) return false;
          const { wx, wy } = cellToWorld(s.x + s.w / 2, s.y + s.h / 2, 0, scale);
          const at = vp.toScreen(wx, wy);
          return at.x > -MARGIN && at.y > -MARGIN && at.x < vp.screenWidth + MARGIN && at.y < vp.screenHeight + MARGIN;
        }).sort((x, y) => y.amount - x.amount).slice(0, Math.max(0, MAX_FLOATS - live.current.length));
        for (const p of seen) {
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
          className="absolute left-0 top-0 whitespace-nowrap text-xs font-bold tabular-nums text-good opacity-0 drop-shadow">
          +{formatCurrency(f.amount)}
        </span>
      ))}
    </div>
  );
}
