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
 * NEVER ONE OVER ANOTHER, AND NOTHING LOST. Labels that would overlap on the
 * screen are COLLATED into one — "Interns: 7/12 in 3 homes, earn $12/s" — over
 * the middle of the buildings it speaks for. Zoom out and they gather into
 * fewer; zoom in and they come apart, down to one a building. @see collate
 *
 * Close in, everything; further out, a line a group. @see DETAIL_FROM
 *
 * THREE SPEEDS:
 *  - what each says, a few times a second;
 *  - which gather together, then too, and whenever the zoom has changed —
 *    worked out on the screen, from where each building's label would sit;
 *  - where they are, every frame, from points kept in the WORLD, so a pan
 *    moves them without measuring a building again.
 */
import { useEffect, useRef, useState } from "react";
import { twMerge } from "tailwind-merge";

import { attendance } from "../../game/projects";
import { useGeneratorStore, type GeneratorId } from "../../state/generators.store";
import { getArrivals, getExports, getFleet, getNetwork, getTraffic, getWorks, useWorldStore } from "../../state/world.store";
import { formatCurrency } from "../../utils/money-utils";
import { perMinute } from "../boats/exports";
import { liveCommutes } from "../agents/commute";
import { liveCoverage } from "../agents/services";
import { useSlopPitStore } from "../../state/slop-pit.store";
import { housedBy, residentsIn } from "../../game/housing";
import { drawnTop, shownStructures } from "../structures/layer";
import { gatherLabels, infoFor, type BuildingInfo, type InfoContext } from "./building-info";

/** Below this zoom, a line a group rather than everything. */
export const DETAIL_FROM = 0.45;
/** How often what the labels say, and how they gather, is worked out again, ms. */
const READ_EVERY = 400;
/** A change of zoom by more than this share gathers them again at once. */
const REZOOM = 0.04;

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
  // Alongside is at a berth and tied up; a boat held off the port waiting
  // for one is moored too, but it is waiting.
  const alongside = new Map<number, number>();
  for (const b of getFleet().boats) {
    const port = b.route?.[0];
    if (port !== undefined && b.berth !== undefined && (b.dockLeft ?? 0) > 0) alongside.set(port, (alongside.get(port) ?? 0) + 1);
  }
  const queued = new Map<number, number>();
  for (const [id, q] of getTraffic().queues) {
    const waiting = q.length - (alongside.get(id) ?? 0);
    if (waiting > 0) queued.set(id, waiting);
  }
  const stalled = new Set<number>();
  for (const [id, t] of getWorks().stalled) if (t > 0) stalled.add(id);
  const now = performance.now(), ex = getExports();
  const earning = new Map<number, number>();
  for (const id of ex.recent.keys()) earning.set(id, perMinute(ex, id, now));
  const st = useWorldStore.getState(), net = getNetwork();
  const residents = new Map<number, number>();
  for (const s of st.grid.structures.values()) if (housedBy(s.def)) residents.set(s.id, residentsIn(s));
  const commutes = net ? liveCommutes(st.grid, net) : new Map();
  const coverage = net ? liveCoverage(st.grid, net) : new Map();
  const pit = useSlopPitStore.getState();
  const slop = { fill: pit.fill, penalty: 1 - pit.getMoneyPenaltyMult() };
  return { perHead, arriving, alongside, queued, stalled, earning, residents, commutes, coverage, slop, money: (n) => formatCurrency(n) };
}

/** One label on the screen: the buildings it speaks for, and what it says. */
type Group = { key: string; ids: number[]; info: BuildingInfo };

export function BuildingLabels({ className }: { className?: string }) {
  const on = useWorldStore((s) => s.labels);
  const grid = useWorldStore((s) => s.grid);
  const [groups, setGroups] = useState<Group[]>([]);
  const [full, setFull] = useState(true);
  const els = useRef(new Map<string, HTMLDivElement>());
  /** Each group's point in the world, and the zoom they were gathered at. */
  const anchors = useRef(new Map<string, { x: number; y: number }>());
  const gatheredAt = useRef(0);

  useEffect(() => {
    if (!on) return;
    /** WHAT THEY SAY, AND HOW THEY GATHER, from where each building stands now. */
    const read = () => {
      const st = useWorldStore.getState();
      const vp = st.viewport, sl = shownStructures();
      if (!vp || !sl) return;
      const ctx = gather();
      const scale = vp.scale.x;
      const detail = scale >= DETAIL_FROM;
      const items: Parameters<typeof gatherLabels>[0][number][] = [];
      for (const s of st.grid.structures.values()) {
        const info = infoFor(s, ctx);
        const top = info && drawnTop(sl, s.id);
        if (!info || !top) continue;
        items.push({ id: s.id, x: top.x, y: top.y, band: s.x + s.w + s.y + s.h, info });
      }
      const out = gatherLabels(items, detail, ctx.money);
      const next = new Map<string, { x: number; y: number }>();
      const list: Group[] = out.map((g) => {
        const key = [...g.ids].sort((a, b) => a - b).join(",");
        // Kept in the world, so a pan needs only to project it.
        const w = vp.toWorld(g.x, g.y);
        next.set(key, { x: w.x, y: w.y });
        return { key, ids: g.ids, info: g.info };
      });
      anchors.current = next;
      gatheredAt.current = scale;
      setFull(detail);
      setGroups(list);
    };
    read();
    const id = setInterval(read, READ_EVERY);

    /** WHERE THEY ARE, every frame; and gathered again at once on a zoom. */
    let raf = 0;
    const frame = () => {
      raf = requestAnimationFrame(frame);
      const vp = useWorldStore.getState().viewport;
      if (!vp) return;
      if (Math.abs(vp.scale.x / (gatheredAt.current || 1) - 1) > REZOOM) read();
      for (const [key, el] of els.current) {
        const w = anchors.current.get(key);
        if (!w) { el.style.visibility = "hidden"; continue; }
        const p = vp.toScreen(w.x, w.y);
        el.style.visibility = "visible";
        el.style.transform = `translate(${Math.round(p.x)}px, ${Math.round(p.y - 4)}px) translate(-50%, -100%)`;
      }
    };
    frame();
    return () => { clearInterval(id); cancelAnimationFrame(raf); };
  }, [on, grid]);

  if (!on) return null;
  return (
    <div className={twMerge("pointer-events-none absolute inset-0 overflow-hidden", className)}>
      {groups.map(({ key, ids, info }) => (
        <div key={key}
          ref={(el) => { if (el) els.current.set(key, el); else els.current.delete(key); }}
          className={twMerge(
            "invisible absolute left-0 top-0 whitespace-nowrap border-l-2 bg-primary-50/90 px-1.5 py-0.5 text-[10px] leading-[13px] text-primary-900 shadow-sm dark:bg-primary-900/85 dark:text-primary-100",
            ids.length > 1 && "border-dashed",
          )}
          style={{ borderLeftColor: hex(info.accent) }}>
          {full ? (
            <>
              <p className="font-bold">{info.title}</p>
              {info.lines.map((l, k) => (
                <p key={k} className={twMerge(
                  "whitespace-pre tabular-nums",
                  l.tone === "good" && "text-emerald-700 dark:text-emerald-400",
                  l.tone === "warn" && "text-amber-700 dark:text-amber-400",
                  l.tone === "dim" && "text-primary-600 dark:text-primary-400",
                )}>{l.text}</p>
              ))}
            </>
          ) : (
            info.brief.map((b, k) => <p key={k} className="tabular-nums">{b}</p>)
          )}
        </div>
      ))}
    </div>
  );
}
