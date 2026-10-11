/**
 * World v2 — A NAME TAG over each team leader out walking: who they are, their
 * trait and rank. HTML over the canvas, held to the walker as the camera
 * moves, like the event rings. Shown with the labels. @see stepLeaders
 */
import { useEffect, useRef } from "react";

import { EMPLOYEE_TRAITS } from "../../game/team-leaders.catalog";
import { useTeamLeadersEmployeesStore } from "../../state/team-leaders.store";
import { getTown, useWorldStore } from "../../state/world.store";
import { cellToWorld } from "../iso";

export function LeaderTags() {
  const leaders = useTeamLeadersEmployeesStore((s) => s.employees);
  const labels = useWorldStore((s) => s.labels);
  const els = useRef(new Map<number, HTMLDivElement>());
  useEffect(() => {
    let raf = 0;
    const frame = () => {
      raf = requestAnimationFrame(frame);
      const vp = useWorldStore.getState().viewport;
      const out = new Map(getTown().movers.filter((m) => m.job?.role === "leader").map((m) => [m.job!.site, m]));
      for (const [k, el] of els.current) {
        const m = out.get(k);
        if (!vp || !m) { el.style.visibility = "hidden"; continue; }
        const w = cellToWorld(m.x, m.y, m.z);
        const p = vp.toScreen(w.wx, w.wy);
        el.style.visibility = "visible";
        el.style.transform = `translate(${Math.round(p.x)}px, ${Math.round(p.y - 30 * vp.scale.x)}px) translate(-50%, -100%)`;
      }
    };
    frame();
    return () => cancelAnimationFrame(raf);
  }, []);
  if (!labels) return null;
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      {leaders.map((l, k) => (
        <div key={l.id} ref={(el) => { if (el) els.current.set(k, el); else els.current.delete(k); }}
          className="invisible absolute left-0 top-0 whitespace-nowrap border border-amber-500 bg-primary-50/90 px-1 text-[10px] text-primary-900 dark:border-amber-400 dark:bg-primary-900/90 dark:text-primary-100">
          <b>{l.name}</b> · {EMPLOYEE_TRAITS[l.traitId]?.name} · rank {l.rank}
        </div>
      ))}
    </div>
  );
}
