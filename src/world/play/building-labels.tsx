/**
 * World v2 — a LABEL over every building on the company's map: what it is and
 * how it is doing. Housing, who lives there, who is on the way and what they
 * earn; a project, how far it has got or what it opened; a seaport, the boats
 * calling. @see infoFor
 *
 * HTML over the canvas rather than text in it: crisp at every zoom, styled
 * like the rest of the game, light and dark. Each sits at the top middle of
 * what its building DREW, so a tower's label is over the tower, not over the
 * ground it stands on. @see drawnTop
 *
 * TWO SPEEDS. Where each label is follows the camera every frame, set straight
 * on the element; what it says changes slowly, and is rendered a few times a
 * second.
 *
 * BY ZOOM: nothing when the map is far away, one line when it is middling,
 * and everything close up. And NEVER ONE OVER ANOTHER: the nearest building's
 * label wins, and the ones it would cover wait for more room.
 */
import { useEffect, useRef, useState } from "react";
import { twMerge } from "tailwind-merge";

import { attendance } from "../../game/projects";
import { useGeneratorStore, type GeneratorId } from "../../state/generators.store";
import { getArrivals, getFleet, getTraffic, getWorks, useWorldStore } from "../../state/world.store";
import { formatCurrency } from "../../utils/money-utils";
import { drawnTop, shownStructures } from "../structures/layer";
import { infoFor, type BuildingInfo, type InfoContext } from "./building-info";

/** Below this zoom no labels; below the next, one line each. */
export const LABELS_FROM = 0.15;
export const DETAIL_FROM = 0.45;

const hex = (c: number) => `#${c.toString(16).padStart(6, "0")}`;

/** What the live game says, gathered once for every label. */
function gather(): InfoContext {
  const gens = useGeneratorStore.getState();
  const perHead: InfoContext["perHead"] = {};
  for (const g of gens.generators) {
    const id = g.id as GeneratorId;
    if (g.amount <= 0) continue;
    // What the whole kind makes, over the ones at their desks.
    const at = attendance(id, g.amount);
    const all = gens.getGeneratorMoneyPerSecond(id, g.amount);
    perHead[id] = at > 0 ? all / (g.amount * at) : all / g.amount;
  }
  const arriving = new Map<number, number>();
  for (const r of getArrivals().rides.values()) {
    for (const d of r.drops) arriving.set(d.structure, (arriving.get(d.structure) ?? 0) + d.n);
  }
  const alongside = new Map<number, number>();
  for (const b of getFleet().boats) {
    const port = b.route?.[0];
    if (port !== undefined && b.moor) alongside.set(port, (alongside.get(port) ?? 0) + 1);
  }
  const queued = new Map<number, number>();
  for (const [id, q] of getTraffic().queues) {
    const waiting = q.length - (alongside.get(id) ?? 0);
    if (waiting > 0) queued.set(id, waiting);
  }
  const stalled = new Set<number>();
  for (const [id, t] of getWorks().stalled) if (t > 0) stalled.add(id);
  return { perHead, arriving, alongside, queued, stalled, money: (n) => formatCurrency(n) };
}

export function BuildingLabels({ className }: { className?: string }) {
  const on = useWorldStore((s) => s.labels);
  const grid = useWorldStore((s) => s.grid);
  const [infos, setInfos] = useState<[number, BuildingInfo][]>([]);
  const [zoom, setZoom] = useState<"none" | "brief" | "full">("full");
  const els = useRef(new Map<number, HTMLDivElement>());

  // WHAT THEY SAY, a few times a second.
  useEffect(() => {
    if (!on) return;
    const read = () => {
      const ctx = gather();
      const out: [number, BuildingInfo][] = [];
      for (const s of useWorldStore.getState().grid.structures.values()) {
        const info = infoFor(s, ctx);
        if (info) out.push([s.id, info]);
      }
      setInfos(out);
    };
    read();
    const id = setInterval(read, 400);
    return () => clearInterval(id);
  }, [on, grid]);

  // WHERE THEY ARE, every frame.
  useEffect(() => {
    if (!on) return;
    let raf = 0;
    const frame = () => {
      raf = requestAnimationFrame(frame);
      const sl = shownStructures();
      const scale = useWorldStore.getState().viewport?.scale.x ?? 1;
      const z = scale < LABELS_FROM ? "none" : scale < DETAIL_FROM ? "brief" : "full";
      setZoom((was) => (was === z ? was : z));
      // NEAREST FIRST, and a label that would cover one already placed is
      // left out — it shows again closer in, where there is room. Read every
      // size before writing any place, so the page lays out once a frame.
      const grid = useWorldStore.getState().grid;
      const todo: { el: HTMLDivElement; x: number; y: number; w: number; h: number; band: number }[] = [];
      for (const [id, el] of els.current) {
        const s = grid.structures.get(id);
        const at = sl && s && z !== "none" ? drawnTop(sl, id) : null;
        if (!at || !s) { el.style.visibility = "hidden"; continue; }
        const w = el.offsetWidth, h = el.offsetHeight;
        todo.push({ el, x: Math.round(at.x - w / 2), y: Math.round(at.y - 4 - h), w, h, band: s.x + s.w + s.y + s.h });
      }
      todo.sort((p, q) => q.band - p.band);
      const placed: { x: number; y: number; w: number; h: number }[] = [];
      for (const t of todo) {
        const hit = placed.some((p) => t.x < p.x + p.w && p.x < t.x + t.w && t.y < p.y + p.h && p.y < t.y + t.h);
        if (hit) { t.el.style.visibility = "hidden"; continue; }
        placed.push(t);
        t.el.style.visibility = "visible";
        t.el.style.zIndex = String(t.band);
        t.el.style.transform = `translate(${t.x}px, ${t.y}px)`;
      }
    };
    frame();
    return () => cancelAnimationFrame(raf);
  }, [on]);

  if (!on || zoom === "none") return null;
  return (
    <div className={twMerge("pointer-events-none absolute inset-0 overflow-hidden", className)}>
      {infos.map(([id, info]) => (
        <div key={id}
          ref={(el) => { if (el) els.current.set(id, el); else els.current.delete(id); }}
          className="invisible absolute left-0 top-0 whitespace-nowrap border-l-2 bg-primary-50/90 px-1.5 py-0.5 text-[10px] leading-tight text-primary-900 shadow-sm dark:bg-primary-900/85 dark:text-primary-100"
          style={{ borderLeftColor: hex(info.accent) }}>
          {zoom === "brief" ? (
            <span className="tabular-nums">{info.headline}</span>
          ) : (
            <>
              <p className="font-bold">{info.title}</p>
              {info.lines.map((l, k) => (
                <p key={k} className={twMerge(
                  "tabular-nums",
                  l.tone === "good" && "text-emerald-700 dark:text-emerald-400",
                  l.tone === "warn" && "text-amber-700 dark:text-amber-400",
                  l.tone === "dim" && "text-primary-600 dark:text-primary-400",
                )}>{l.text}</p>
              ))}
            </>
          )}
        </div>
      ))}
    </div>
  );
}
