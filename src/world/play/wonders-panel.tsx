/**
 * World v2 — THE WONDERS, a menu of their own off the build bar: the great
 * late buildings, each a bonus for good while it stands. What each needs, its
 * site to choose, how it is going, or that it stands. Built by the project
 * machinery — crews, trucks, stalls — but kept out of the projects log: they
 * are not the next step, they are the reward. @see game/projects, ProjectCard
 */
import { useEffect } from "react";
import { twMerge } from "tailwind-merge";
import { Badge, IconButton } from "../../ui/console";

import { PROJECTS, type ProjectDef } from "../../game/projects";
import { useGeneratorStore } from "../../state/generators.store";
import { useSessionStore } from "../../state/session.store";
import { useWorldStore } from "../../state/world.store";
import { formatCurrency } from "../../utils/money-utils";
import { builtProjects, projectUnderWay, ruledOut, siteOf } from "../projects/works";
import { opensText } from "./building-info";
import { useTicking } from "../../hooks/use-ticking";
import { ProjectCard } from "./projects-panel";
import { GateChips } from "./gate-chips";
import { useGateUnlocks } from "./gates";

export const WONDERS: readonly ProjectDef[] = PROJECTS.filter((p) => p.bonus);

const PANEL = "border border-line-quiet bg-surface-1/95 shadow-lg backdrop-blur-sm";
const ROW = "flex flex-col gap-1 border-t border-line-quiet py-2 first:border-t-0";

export function WondersPanel({ className }: { className?: string }) {
  useTicking(250);
  const open = useWorldStore((s) => s.wondersOpen);
  const setOpen = useWorldStore((s) => s.setWondersOpen);
  const placing = useWorldStore((s) => s.placingProject);
  const grid = useWorldStore((s) => s.grid);
  const generators = useGeneratorStore((s) => s.generators);
  const unlocked = useGateUnlocks();
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
  const built = builtProjects(grid);
  // ONE PROJECT AT A TIME, wonders with the rest. @see projectUnderWay
  const busy = projectUnderWay(grid);
  return (
    <div className={twMerge(PANEL, "w-[min(22rem,calc(100vw-1rem))] p-2.5 text-xs text-fg", className)}>
      <div className="mb-1 flex items-baseline justify-between">
        <p className="flex items-center gap-2 font-display text-xs uppercase tracking-widest">
          <span aria-hidden className="h-3 w-0.5 bg-good" />Wonders
        </p>
        <IconButton label="Close" onClick={() => setOpen(false)}>✕</IconButton>
      </div>
      {WONDERS.map((w) => {
        const bonus = opensText(w);
        if (built.has(w.id)) {
          return (
            <div key={w.id} className={ROW}>
              <p className="flex items-center justify-between"><b>{w.name}</b><Badge tone="good">Standing</Badge></p>
              <p className="text-good">{bonus}</p>
            </div>
          );
        }
        if (siteOf(grid, w)) {
          return (
            <div key={w.id} className={ROW}>
              <ProjectCard next={w} className="w-full border-0 bg-transparent p-0 shadow-none dark:bg-transparent" />
            </div>
          );
        }
        // A FORK TAKEN the other way: what it would have been, struck out. @see ruledOut
        const rival = ruledOut(grid, w);
        if (rival) {
          return (
            <div key={w.id} className={twMerge(ROW, "text-fg-muted")}>
              <p className="flex items-center justify-between"><b className="line-through">{w.name}</b><Badge tone="bad">{rival.name} instead</Badge></p>
            </div>
          );
        }
        // Hidden while another project is under way. @see projectUnderWay
        if (busy) return null;
        const or = w.rival && PROJECTS.find((p) => p.id === w.rival);
        const fork = or && <p className="text-warn">Or the {or.name}, never both</p>;
        if (w.ready(owned, unlocked)) {
          return (
            <div key={w.id} className={ROW}>
              <ProjectCard next={w} className="w-full border-0 bg-transparent p-0 shadow-none dark:bg-transparent" />
              {fork}
            </div>
          );
        }
        return (
          <div key={w.id} className={twMerge(ROW, "text-fg-muted")}>
            <p className="flex justify-between"><b className="text-fg">{w.name}</b><span>{bonus}</span></p>
            {/* HOW MANY IT NEEDS, a bar a kind, with how many more on hover. @see GateChips */}
            <GateChips project={w} />
            <p>From <span className="tabular-nums text-money">{formatCurrency(w.floor)}</span></p>
            {fork}
          </div>
        );
      })}
    </div>
  );
}
