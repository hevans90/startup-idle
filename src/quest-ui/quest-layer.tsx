/**
 * QUEST UI — THE ARC ON THE MAP: the transmission when something is asked,
 * sliding in at the head of the map's cards; the tracker while an objective
 * runs, above it; and a violet ring on the map where an
 * objective has a place — the Data Centre to cool, the block picked, the site
 * given. Answering plays the decision tone; a transmission arriving, its own.
 * Loaded lazily, only once the arc has something to show. @see QuestArc
 */
import { useEffect, useRef } from "react";

import { sfx } from "../audio/sound";
import { CHAPTERS, REQUESTS } from "../game/quests/chapters";
import { CHAPTER_WAIT, REQUEST_WAIT, offered, useQuestStore, type Running } from "../state/quest.store";
import { useWorldStore } from "../state/world.store";
import { idx, inBounds, type Grid } from "../world/grid";
import { cellToWorld } from "../world/iso";
import { Tracker } from "./tracker";
import { Transmission } from "./transmission";

/** Where an objective is on the map, if it has a place. */
function targetOf(o: Running, g: Grid): { x: number; y: number } | null {
  const q = useQuestStore.getState();
  switch (o.spec.kind) {
    case "coolDataCentre": {
      for (const s of g.structures.values()) if (s.def === "datacentre" && !s.build) return { x: s.x + (s.w - 1) / 2, y: s.y + (s.h - 1) / 2 };
      return null;
    }
    case "selectBlock": return q.block;
    case "giveSite": return q.site;
    default: return null;
  }
}

/** A violet ring where the objective is, kept on its tile as the map moves. */
function QuestMarker({ at }: { at: { x: number; y: number } }) {
  const el = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let raf = 0;
    const frame = () => {
      raf = requestAnimationFrame(frame);
      const vp = useWorldStore.getState().viewport, g = useWorldStore.getState().grid;
      if (!vp || !el.current) return;
      const cx = Math.round(at.x), cy = Math.round(at.y);
      const h = inBounds(g, cx, cy) ? g.height[idx(g, cx, cy)] : 0;
      const w = cellToWorld(at.x, at.y, h);
      const p = vp.toScreen(w.wx, w.wy);
      el.current.style.transform = `translate(${Math.round(p.x)}px, ${Math.round(p.y)}px) translate(-50%, -50%)`;
    };
    frame();
    return () => cancelAnimationFrame(raf);
  }, [at.x, at.y]);
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      {/* The ping inside the placed ring, so its transform does not undo the placing. */}
      <div ref={el} className="absolute left-0 top-0 h-20 w-20">
        <div className="h-full w-full animate-ping rounded-full border-4 border-violet-500/80 dark:border-violet-400/80" />
      </div>
    </div>
  );
}

/** The ring on the map, where the objective under way has a place. */
export function QuestMarkers() {
  const objective = useQuestStore((s) => s.objective);
  const grid = useWorldStore((s) => s.grid);
  const target = objective ? targetOf(objective, grid) : null;
  return target ? <QuestMarker at={target} /> : null;
}

/** The tracker and the transmission, at the head of the map's column of cards. */
export function QuestLayer() {
  const offer = useQuestStore((s) => s.offer);
  const objective = useQuestStore((s) => s.objective);
  const at = useQuestStore((s) => s.disposition);
  const flags = useQuestStore((s) => s.flags);
  // A TRANSMISSION ARRIVING: its tone, once.
  const heard = useRef<string | null>(null);
  useEffect(() => {
    if (!offer || heard.current === offer.id) return;
    heard.current = offer.id;
    sfx("transmission");
  }, [offer]);
  const q = offer ? offered(offer) : null;
  const chapter = offer?.kind === "chapter" ? CHAPTERS.find((c) => c.id === offer.id) : null;
  const request = offer?.kind === "request" ? REQUESTS.find((r) => r.id === offer.id) : null;
  return (
    <>
        {objective && (
          <Tracker says={objective.spec.says} progress={objective.progress} left={objective.spec.window - objective.elapsed} />
        )}
        {offer && q && (chapter || request) && (
          <Transmission
            className="quest-slide-in"
            kicker={chapter ? `Chapter ${CHAPTERS.indexOf(chapter) + 1}` : "Between chapters"}
            title={chapter ? chapter.title : "A request"}
            lines={chapter ? chapter.transmission(new Set(flags)) : [request!.text]}
            options={q.options}
            preferred={q.preferred}
            at={at}
            left={(offer.kind === "chapter" ? CHAPTER_WAIT : REQUEST_WAIT) - offer.waited}
            onChoose={(i) => { sfx("decision"); useQuestStore.getState().choose(i); }}
          />
        )}
    </>
  );
}
