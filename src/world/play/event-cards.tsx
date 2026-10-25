/**
 * World v2 — EVENTS, as the player meets them: a card each, with what is
 * coming and when, what can be done and what it costs, and a way to look at
 * it; and a ring pulsing on the map where it is. @see world/events
 */
import { useEffect, useRef, useState } from "react";
import { twMerge } from "tailwind-merge";

import { useTicking } from "../../hooks/use-ticking";
import { useSessionStore } from "../../state/session.store";
import { clock, showMe } from "./map-focus";
import { useWorldStore } from "../../state/world.store";
import { cellToWorld } from "../iso";
import { idx, inBounds } from "../grid";
import type { GameEvent } from "../events/events";
import { clearOfferPremium, offerPremium, setOfferPremium } from "../../game/acquisition";
import { useGlobalSettingsStore } from "../../state/global-settings.store";
import { Button, Card, FOCUS } from "../../ui/console";

/**
 * AN ACQUIRER'S OFFER, answered: looking at it puts their premium on the sale
 * for as long as the offer is on the table, and opens the sale — with its
 * confirmation, so nothing is sold by one click on the map. Holding out lets
 * the premium go. @see offerPremium, AcquisitionTab
 */
function answerOffer(e: GameEvent, choice: string) {
  if (e.kind !== "offer") return;
  if (choice === "hold") { clearOfferPremium(); return; }
  if (choice !== "accept") return;
  const until = e.endsAt ?? (e.strikesAt ?? Date.now()) + 120_000;
  setOfferPremium(offerPremium(), until);
  useGlobalSettingsStore.getState().setSidebarTab("acquisition");
  window.dispatchEvent(new CustomEvent("startup:show-company"));
  window.dispatchEvent(new CustomEvent("startup:confirm-sale"));
}

/** AN EVENT, as a card in comms: what is coming and when, what can be done and what it costs, and a way to look. @see CommsDock */
export function EventCard({ e }: { e: GameEvent }) {
  useTicking(500);
  const respond = useWorldStore((s) => s.respondToEvent);
  const setOff = useSessionStore((s) => s.setMapEventsOff);
  const chosen = e.choices.find((c) => c.id === e.chosen);
  return (
    <Card tone={e.phase === "over" ? "console" : e.phase === "active" ? "bad" : "warn"} className={twMerge("w-[min(24rem,calc(100vw-1rem))]", e.phase === "over" && "opacity-70")}
      title={<span className="flex items-baseline justify-between gap-2"><span>{e.title}</span>
        {e.phase === "warning" && e.strikesAt !== null && <span className="tabular-nums text-warn">in {clock(e.strikesAt - Date.now())}</span>}</span>}>
      <div role="alert" className="flex flex-col gap-1.5">
        <p className="text-fg-muted">{e.phase === "over" ? e.outcome : e.text}</p>
        {e.phase !== "over" && (
          <div className="flex flex-wrap gap-1">
            {e.choices.map((c) => (
              <Button key={c.id} size="sm" variant={e.chosen === c.id ? "primary" : "secondary"} disabled={!!c.unavailable} title={c.unavailable}
                onClick={() => { respond(e.id, c.id); answerOffer(e, c.id); }} className="flex flex-col items-start text-left pointer-coarse:min-h-11">
                <span className="font-bold">{c.label}</span>
                <span className="text-[10px] text-fg-muted">{c.unavailable ?? c.cost}</span>
              </Button>
            ))}
          </div>
        )}
        <div className="flex items-center justify-between text-[10px] text-fg-muted">
          <span>{chosen ? `You chose: ${chosen.label.toLowerCase()}` : ""}</span>
          <span className="flex gap-2">
            <button type="button" onClick={() => setOff(true)} className={`cursor-pointer underline hover:text-fg ${FOCUS}`}
              title="No more floods or overflows. Back on in Settings.">no events</button>
            <button type="button" onClick={() => showMe(e.where)} className={`cursor-pointer underline hover:text-fg ${FOCUS}`}>Show me</button>
          </span>
        </div>
      </div>
    </Card>
  );
}

/** The events comms shows: under way or just over, newest first — the slop pit's overflow is on the pit's own card. */
export const liveEvents = (events: readonly GameEvent[]) => [...events].filter((e) => e.kind !== "slop-overflow").reverse();

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
            e.phase === "active" ? "border-bad/80" : "border-warn/80",
          )} />
        </div>
      ))}
    </div>
  );
}
