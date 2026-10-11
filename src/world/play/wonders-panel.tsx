/**
 * World v2 — THE WONDERS, a menu of their own off the build bar: the great
 * late buildings, each a bonus for good while it stands. What each needs, its
 * site to choose, how it is going, or that it stands. Built by the project
 * machinery — crews, trucks, stalls — but kept out of the projects log: they
 * are not the next step, they are the reward. @see game/projects, ProjectCard
 */
import { useEffect } from "react";
import { twMerge } from "tailwind-merge";

import { PROJECTS, type ProjectDef } from "../../game/projects";
import { useGeneratorStore } from "../../state/generators.store";
import { useInnovationStore } from "../../state/innovation.store";
import { useSessionStore } from "../../state/session.store";
import { useWorldStore } from "../../state/world.store";
import { formatCurrency } from "../../utils/money-utils";
import { builtProjects, siteOf } from "../projects/works";
import { opensText } from "./building-info";
import { useTicking } from "../../hooks/use-ticking";
import { ProjectCard } from "./projects-panel";

export const WONDERS: readonly ProjectDef[] = PROJECTS.filter((p) => p.bonus);

const PANEL = "border border-primary-300 bg-primary-50/95 shadow-md dark:border-primary-700 dark:bg-primary-900/95";
const ROW = "flex flex-col gap-1 border-t border-primary-200 py-2 first:border-t-0 dark:border-primary-700";

export function WondersPanel({ className }: { className?: string }) {
  useTicking(250);
  const open = useWorldStore((s) => s.wondersOpen);
  const setOpen = useWorldStore((s) => s.setWondersOpen);
  const placing = useWorldStore((s) => s.placingProject);
  const grid = useWorldStore((s) => s.grid);
  const generators = useGeneratorStore((s) => s.generators);
  const unlocks = useInnovationStore((s) => s.unlocks);
  // OPENED, the hint about it has done its job. @see hints
  const markHintsDone = useSessionStore((s) => s.markHintsDone);
  useEffect(() => { if (open) markHintsDone(["wonders"]); }, [open, markHintsDone]);
  // CHOOSING A SITE needs the map: the menu steps aside.
  useEffect(() => {
    if (placing && WONDERS.some((w) => w.id === placing)) setOpen(false);
  }, [placing, setOpen]);
  if (!open) return null;
  const owned: Record<string, number> = {};
  for (const g of generators) owned[g.id] = g.amount;
  const unlocked = new Set(Object.entries(unlocks).filter(([, u]) => u?.unlocked).map(([k]) => k));
  const built = builtProjects(grid);
  return (
    <div className={twMerge(PANEL, "w-[min(22rem,calc(100vw-1rem))] p-2 text-xs text-primary-900 dark:text-primary-100", className)}>
      <div className="mb-1 flex items-baseline justify-between">
        <b className="text-[10px] uppercase tracking-wide text-primary-600 dark:text-primary-400">Wonders</b>
        <button type="button" onClick={() => setOpen(false)}
          className="cursor-pointer px-1 text-primary-500 hover:text-primary-900 dark:hover:text-primary-100" aria-label="Close">✕</button>
      </div>
      {WONDERS.map((w) => {
        const bonus = opensText(w).replace(/^Wonder: /, "");
        if (built.has(w.id)) {
          return (
            <div key={w.id} className={ROW}>
              <p className="flex justify-between"><b>{w.name}</b><span className="text-emerald-700 dark:text-emerald-400">Standing</span></p>
              <p className="text-emerald-700 dark:text-emerald-400">{bonus}</p>
            </div>
          );
        }
        if (siteOf(grid, w) || w.ready(owned, unlocked)) {
          return (
            <div key={w.id} className={ROW}>
              <ProjectCard next={w} className="w-full border-0 bg-transparent p-0 shadow-none dark:bg-transparent" />
            </div>
          );
        }
        return (
          <div key={w.id} className={twMerge(ROW, "text-primary-600 dark:text-primary-400")}>
            <p className="flex justify-between"><b className="text-primary-800 dark:text-primary-200">{w.name}</b><span>needs {w.readyWhen}</span></p>
            <p>{bonus} · from {formatCurrency(w.floor)}</p>
          </div>
        );
      })}
    </div>
  );
}
