/**
 * World v2 — EVENTS, as the player meets them: a card each, with what is
 * coming and when, what can be done and what it costs, and a way to look at
 * it; and a ring pulsing on the map where it is. @see world/events
 */
import { useEffect, useRef, useState } from "react";
import { twMerge } from "tailwind-merge";

import { useTicking } from "../../hooks/use-ticking";
import { useSessionStore } from "../../state/session.store";
import { useWorldStore } from "../../state/world.store";
import { cellToWorld, HH, HW } from "../iso";
import { idx, inBounds } from "../grid";
import type { GameEvent } from "../events/events";

const CARD =
  "w-[min(24rem,calc(100vw-1rem))] border px-3 py-2 text-xs shadow-md "
  + "bg-primary-50/95 text-primary-900 dark:bg-primary-900/95 dark:text-primary-100";
const BTN =
  "flex cursor-pointer flex-col items-start border border-primary-400 px-2 py-1 text-left hover:bg-primary-200 "
  + "disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent dark:border-primary-600 dark:hover:bg-primary-800";

const clock = (ms: number) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

/** Centre the camera on a tile. */
function showMe(where: { x: number; y: number }) {
  const vp = useWorldStore.getState().viewport;
  if (!vp) return;
  vp.moveCenter((where.x - where.y) * HW, (where.x + where.y) * HH);
  vp.emit("moved", { viewport: vp, type: "drag" } as never);
}

function EventCard({ e }: { e: GameEvent }) {
  const respond = useWorldStore((s) => s.respondToEvent);
  const setOff = useSessionStore((s) => s.setMapEventsOff);
  const tone = e.phase === "over" ? "border-primary-300 opacity-70 dark:border-primary-700"
    : e.phase === "active" ? "border-red-500 dark:border-red-400" : "border-amber-500 dark:border-amber-400";
  const chosen = e.choices.find((c) => c.id === e.chosen);
  return (
    <div role="alert" className={twMerge(CARD, tone)}>
      <div className="flex items-baseline justify-between gap-2">
        <b>{e.title}</b>
        {e.phase === "warning" && e.strikesAt !== null && (
          <span className="tabular-nums text-amber-700 dark:text-amber-400">in {clock(e.strikesAt - Date.now())}</span>
        )}
      </div>
      <p className="mt-0.5 text-primary-700 dark:text-primary-300">{e.phase === "over" ? e.outcome : e.text}</p>
      {e.phase !== "over" && (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {e.choices.map((c) => (
            <button key={c.id} type="button" disabled={!!c.unavailable}
              onClick={() => respond(e.id, c.id)}
              className={twMerge(BTN, e.chosen === c.id && "bg-primary-200 dark:bg-primary-800")}
              title={c.unavailable}>
              <span className="font-bold">{c.label}</span>
              <span className="text-[10px] text-primary-600 dark:text-primary-400">{c.unavailable ?? c.cost}</span>
            </button>
          ))}
        </div>
      )}
      <div className="mt-1 flex items-center justify-between text-[10px] text-primary-600 dark:text-primary-400">
        <span>{chosen ? `You chose: ${chosen.label.toLowerCase()}` : ""}</span>
        <span className="flex gap-2">
          <button type="button" onClick={() => setOff(true)} className="cursor-pointer underline"
            title="No more floods or overflows. Back on in Settings.">no events</button>
          <button type="button" onClick={() => showMe(e.where)} className="cursor-pointer underline">Show me</button>
        </span>
      </div>
    </div>
  );
}

/** Every event under way or just over, newest first. */
export function EventCards() {
  useTicking(500);
  const events = useWorldStore((s) => s.events);
  if (!events.length) return null;
  return (
    <div className="flex flex-col gap-2">
      {[...events].reverse().map((e) => <EventCard key={e.id} e={e} />)}
    </div>
  );
}

/**
 * A RING ON THE MAP where each event is, pulsing, held to its tile as the
 * camera moves. HTML over the canvas, like the labels. @see BuildingLabels
 */
export function EventMarkers() {
  const events = useWorldStore((s) => s.events);
  const live = events.filter((e) => e.phase !== "over");
  const els = useRef(new Map<number, HTMLDivElement>());
  const [, force] = useState(0);
  useEffect(() => {
    let raf = 0;
    const frame = () => {
      raf = requestAnimationFrame(frame);
      const vp = useWorldStore.getState().viewport;
      if (!vp) return;
      for (const e of useWorldStore.getState().events) {
        const el = els.current.get(e.id);
        if (!el) continue;
        // ON THE GROUND THERE, not at sea level: a tile's height lifts it.
        const g = useWorldStore.getState().grid;
        const h = inBounds(g, e.where.x, e.where.y) ? g.height[idx(g, e.where.x, e.where.y)] : 0;
        const w = cellToWorld(e.where.x, e.where.y, h);
        const p = vp.toScreen(w.wx, w.wy);
        el.style.transform = `translate(${Math.round(p.x)}px, ${Math.round(p.y)}px) translate(-50%, -50%)`;
      }
    };
    frame();
    force((n) => n + 1);
    return () => cancelAnimationFrame(raf);
  }, []);
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      {/* THE PING ON A RING INSIDE the one that is placed: the animation
          is a transform, and on the placed one it overrode the placing and
          sent the ring pulsing from the corner of the screen. */}
      {live.map((e) => (
        <div key={e.id} ref={(el) => { if (el) els.current.set(e.id, el); else els.current.delete(e.id); }}
          className="absolute left-0 top-0 h-16 w-16">
          <div className={twMerge(
            "h-full w-full animate-ping rounded-full border-4",
            e.phase === "active" ? "border-red-500/80 dark:border-red-400/80" : "border-amber-400/80 dark:border-amber-300/80",
          )} />
        </div>
      ))}
    </div>
  );
}
