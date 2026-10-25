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
import { idx, inBounds, structureAt, type Grid } from "../world/grid";
import { BLOCK, SITE, boxAround } from "../world/ai/arc-rules";
import { cellToWorld } from "../world/iso";
import { Tracker } from "./tracker";
import { runningAgents } from "../state/agents.store";
import { LATTICE_AGENTS, latticeNeeds } from "../world/ai/lattice";
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
    case "latticeCharged": {
      for (const s of g.structures.values()) if (s.def === "lattice") return { x: s.x + (s.w - 1) / 2, y: s.y + (s.h - 1) / 2 };
      return null;
    }
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

/** What the Lattice waits on, for its tracker. @see latticeNeeds */
function latticeLine(): { label: string; ok: boolean }[] {
  const running = runningAgents();
  const n = latticeNeeds(useWorldStore.getState().grid, running);
  return [
    { label: "It stands", ok: n.built },
    { label: `Agents ${Math.min(running, LATTICE_AGENTS)}/${LATTICE_AGENTS}`, ok: n.agents },
    { label: "Data Centre cooled", ok: n.dc },
    { label: "Lattice cooled", ok: n.water },
  ];
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
  const picking = useQuestStore((s) => s.picking);
  const block = useQuestStore((s) => s.block);
  const keep = useQuestStore((s) => s.keep);
  // PICKING ON THE MAP: the next look at a tile is the block, the building kept, or the site. @see useQuestStore.picking
  useEffect(() => useWorldStore.subscribe((st, was) => {
    if (!st.lookedAt || st.lookedAt === was.lookedAt) return;
    const q = useQuestStore.getState(), c = st.lookedAt;
    const say = (text: string) => useWorldStore.setState({ notice: { text, at: Date.now() } });
    if (q.picking === "block") {
      q.pickBlock({ x: c.x, y: c.y });
      q.setPicking(q.objective?.spec.kind === "selectBlock" && q.objective.spec.keep ? "keep" : null);
    } else if (q.picking === "keep") {
      const id = structureAt(st.grid, c.x, c.y), b = q.block && boxAround(q.block, BLOCK), s = st.grid.structures.get(id);
      if (!s || !b || s.x < b.x || s.y < b.y || s.x >= b.x + b.w || s.y >= b.y + b.h) { say("Pick a building in the block"); return; }
      q.keepBuilding(id);
      q.setPicking(null);
    } else if (q.picking === "site") {
      const b = boxAround({ x: c.x, y: c.y }, SITE);
      for (let y = b.y; y < b.y + b.h; y++) for (let x = b.x; x < b.x + b.w; x++) {
        if (!inBounds(st.grid, x, y) || structureAt(st.grid, x, y) >= 0) { say("Give it open ground: three tiles by three, nothing built"); return; }
      }
      q.giveSite({ x: c.x, y: c.y });
      q.setPicking(null);
    }
  }), []);
  /** What the tracker's button does, for an objective that asks for a place. */
  const start = (what: "block" | "keep" | "site") => { useWorldStore.getState().setTool("inspect"); useQuestStore.getState().setPicking(what); };
  const spec = objective?.spec;
  const action = !spec ? undefined
    : picking ? { label: picking === "block" ? "Click a block of your town" : picking === "keep" ? "Click the building to keep" : "Click open ground for it", onClick: () => useQuestStore.getState().setPicking(null), busy: true }
      : spec.kind === "selectBlock" ? (block && spec.keep && keep === null ? { label: "Pick the building to keep", onClick: () => start("keep") } : !block ? { label: "Pick the block", onClick: () => start("block") } : undefined)
        : spec.kind === "giveSite" ? { label: "Give it a site", onClick: () => start("site") } : undefined;
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
          <Tracker says={objective.spec.says} progress={objective.progress} left={objective.spec.window - objective.elapsed} action={action}
            needs={objective.spec.kind === "latticeCharged" ? latticeLine() : undefined} />
        )}
        {offer && q && (chapter || request) && (
          <Transmission
            className="quest-slide-in"
            kicker={chapter ? `Chapter ${chapter.number}` : "Between chapters"}
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
