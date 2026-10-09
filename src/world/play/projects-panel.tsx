/**
 * World v2 — the company's next project, as a card on the map.
 *
 * One card, for the next thing the company could build: what it needs before
 * it can start, then a button to choose its site, then — while it goes up —
 * how far it has got, who is on it, what has been delivered, what is holding
 * it up, and how much of the company to give it. @see game/projects, stepWorks
 */
import { useEffect, useState } from "react";
import { twMerge } from "tailwind-merge";

import {
  PRIORITY_NAMES, PROJECTS, buildersFor, projectCost, type Priority, type ProjectDef,
} from "../../game/projects";
import { useFounderStore } from "../../state/founder.store";
import { useGeneratorStore } from "../../state/generators.store";
import { useInnovationStore } from "../../state/innovation.store";
import { getWorks, useWorldStore } from "../../state/world.store";
import { formatCurrency } from "../../utils/money-utils";
import { SLOP_PIT_UNLOCK_COUNT, useSlopPitStore } from "../../state/slop-pit.store";
import { opensText } from "./building-info";
import { builtProjects, materialCap, siteOf, STALL_GRACE } from "../projects/works";

const CARD =
  "w-72 border border-primary-400 bg-primary-50/95 p-2 text-xs text-primary-900 shadow "
  + "dark:border-primary-600 dark:bg-primary-900/95 dark:text-primary-100";
const BTN =
  "cursor-pointer border border-primary-400 px-2 py-1 hover:bg-primary-200 "
  + "dark:border-primary-600 dark:hover:bg-primary-800";
const ON = "bg-primary-300 dark:bg-primary-700";

/** "45 seconds", "2 minutes". */
const formatDuration = (s: number) =>
  s < 90 ? `${s} seconds` : `${Math.round(s / 60)} minutes`;

/** Re-render a few times a second: the work moves on its own. */
function useTicking(ms: number) {
  const [, setN] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setN((n) => n + 1), ms);
    return () => clearInterval(id);
  }, [ms]);
}

function Bar({ value, className }: { value: number; className?: string }) {
  return (
    <div className={twMerge("h-2 w-full bg-primary-200 dark:bg-primary-800", className)}>
      <div className="h-full bg-emerald-600 dark:bg-emerald-400" style={{ width: `${Math.round(Math.min(1, value) * 100)}%` }} />
    </div>
  );
}

/**
 * THE COMPANY'S PROJECTS: a card for each going up or ready to start — they
 * can run side by side, crews and all — and one for the next that is not
 * ready yet, saying what it waits for.
 */
export function ProjectsPanel({ className }: { className?: string }) {
  useTicking(250);
  const grid = useWorldStore((s) => s.grid);
  const generators = useGeneratorStore((s) => s.generators);
  const only = useFounderStore((s) => s.onlyGenerator);
  const unlocks = useInnovationStore((s) => s.unlocks);
  const owned: Record<string, number> = {};
  for (const g of generators) owned[g.id] = g.amount;
  const unlocked = new Set(Object.entries(unlocks).filter(([, u]) => u?.unlocked).map(([k]) => k));
  const built = builtProjects(grid);
  // A founder held to one kind of employee hires nothing a project opens:
  // those projects are not theirs to build. @see getUnlockedGeneratorIds
  const open = PROJECTS.filter((p) => !built.has(p.id) && !(only && p.unlocks));
  const active = open.filter((p) => siteOf(grid, p) || p.ready(owned, unlocked));
  const teaser = open.find((p) => !active.includes(p));
  const pit = (owned.vibe_coder ?? 0) >= SLOP_PIT_UNLOCK_COUNT;
  if (!active.length && !teaser && !pit) return null;
  return (
    <div className={twMerge("flex max-h-[70%] flex-col gap-2 overflow-y-auto", className)}>
      {pit && <SlopPitCard />}
      {active.map((p) => <ProjectCard key={p.id} next={p} unlocked={unlocked} />)}
      {teaser && <ProjectCard key={teaser.id} next={teaser} unlocked={unlocked} />}
    </div>
  );
}

/**
 * THE SLOP PIT'S CARD: how full it is, what it is costing, and the drain —
 * which costs the vibe coders' morale. @see state/slop-pit.store
 */
function SlopPitCard() {
  const fill = useSlopPitStore((s) => s.fill);
  const penalty = 1 - useSlopPitStore.getState().getMoneyPenaltyMult();
  return (
    <div className={CARD}>
      <div className="flex items-baseline justify-between">
        <b>Slop pit</b>
        <span className="tabular-nums">{Math.floor(fill)}%</span>
      </div>
      <div className="mt-1 h-2 w-full bg-primary-200 dark:bg-primary-800">
        <div className={twMerge("h-full", fill > 50 ? "bg-red-600 dark:bg-red-400" : "bg-lime-600 dark:bg-lime-400")}
          style={{ width: `${Math.min(100, fill)}%` }} />
      </div>
      <p className={twMerge("mt-1", penalty > 0 ? "text-red-700 dark:text-red-400" : "text-primary-600 dark:text-primary-400")}>
        {penalty > 0 ? `Income −${Math.round(penalty * 100)}%` : "No harm until half full"}
      </p>
      <button type="button" disabled={fill < 1} onClick={() => useSlopPitStore.getState().drain()}
        className={twMerge(BTN, "mt-1.5 w-full disabled:cursor-default disabled:opacity-40")}
        title="Empties the pit. The vibe coders hate it.">
        Drain · −40 vibe coder morale
      </button>
    </div>
  );
}

/** One project's card: what it waits for, its site to choose, or how it is going. */
function ProjectCard({ next, unlocked, className }: { next: ProjectDef; unlocked: ReadonlySet<string>; className?: string }) {
  const grid = useWorldStore((s) => s.grid);
  const placing = useWorldStore((s) => s.placingProject);
  const placeProject = useWorldStore((s) => s.placeProject);
  const setPriority = useWorldStore((s) => s.setProjectPriority);
  const generators = useGeneratorStore((s) => s.generators);
  const owned: Record<string, number> = {};
  for (const g of generators) owned[g.id] = g.amount;
  const site = siteOf(grid, next);
  // Their name in the plural: "your interns", "your vibe coders".
  const who = next.builders.map((id) => `${generators.find((g) => g.id === id)?.name ?? id}s`).join(" and ");

  const TAG = "text-[10px] font-bold uppercase tracking-wide";

  // NOT YET: one line, what it waits for.
  if (!site && !next.ready(owned, unlocked)) {
    return (
      <div className={twMerge(CARD, "w-auto self-start whitespace-nowrap text-primary-700 dark:text-primary-300", className)}>
        <span className={twMerge(TAG, "mr-1 text-primary-500")}>Next</span>
        <b className="text-primary-900 dark:text-primary-100">{next.name}</b> · needs {next.readyWhen}
      </div>
    );
  }

  // READY: what it opens, what it costs, and a site to choose.
  if (!site) {
    const choosing = placing === next.id;
    const income = useGeneratorStore.getState().getMoneyPerSecond();
    return (
      <div className={twMerge(CARD, className)}>
        <p><span className={twMerge(TAG, "mr-1 text-emerald-700 dark:text-emerald-400")}>New</span><b>{next.name}</b></p>
        <p className="text-primary-700 dark:text-primary-300">{opensText(next)}</p>
        <p className="tabular-nums text-primary-600 dark:text-primary-400"
          title={next.founderBuilds ? undefined
            : `About ${formatDuration(next.incomeSeconds)} of income, fixed when you choose the site. Builders leave their desks while they build.`}>
          {next.founderBuilds ? "Free · you build it" : `${formatCurrency(projectCost(next, income))} · built by ${who}`}
        </p>
        {choosing ? (
          <div className="mt-1.5 flex items-center justify-between gap-2">
            <span className="text-emerald-700 dark:text-emerald-400">Click beside a road</span>
            <button type="button" className={BTN} onClick={() => placeProject(null)}>Cancel</button>
          </div>
        ) : (
          <button type="button" className={twMerge(BTN, "mt-1.5 w-full font-bold")} onClick={() => placeProject(next.id)}>
            Choose a site
          </button>
        )}
      </div>
    );
  }

  // GOING UP: progress, one line of who and what, what is wrong if anything, and the priority.
  const b = site.build!;
  const works = getWorks();
  const crew = works.crews.get(site.id) ?? { walking: 0, working: 0 };
  const loadPrice = b.cost / b.deliveries;
  const stalledFor = works.stalled.get(site.id) ?? 0;
  const truck = (works.trucks.get(site.id) ?? 0) > 0;
  const caughtUp = b.done >= materialCap(b) - 1e-6;
  const problem = b.priority === 0 ? null
    : stalledFor > 0 ? `Stalled: next load ${formatCurrency(loadPrice)}${stalledFor > STALL_GRACE ? ", crew gone home" : ""}`
      : caughtUp && truck ? "Waiting for a load"
        : crew.working === 0 && crew.walking > 0 ? "Crew on the way" : null;
  return (
    <div className={twMerge(CARD, className)}>
      <div className="flex items-baseline justify-between">
        <b>{next.name}</b>
        <span className="tabular-nums">{Math.floor((b.done / b.need) * 100)}%</span>
      </div>
      <Bar value={b.done / b.need} className="mt-1" />
      <p className="mt-1 tabular-nums text-primary-700 dark:text-primary-300">
        {crew.working + crew.walking} building · {b.delivered}/{b.deliveries} loads
      </p>
      {problem && <p className={stalledFor > 0 ? "text-red-700 dark:text-red-400" : "text-primary-600 dark:text-primary-400"}>{problem}</p>}
      <div className="mt-1.5 flex gap-1"
        title={next.founderBuilds ? "You build it yourself."
          : `How much of the company builds: ${buildersFor(next, b.priority, owned, site.w * site.h)} of your ${who} now. Builders don't work at their desks.`}>
        {PRIORITY_NAMES.map((name, k) => (
          <button key={name} type="button" onClick={() => setPriority(site.id, k as Priority)}
            className={twMerge(BTN, "flex-1 px-1", b.priority === k && ON)}>
            {name}
          </button>
        ))}
      </div>
    </div>
  );
}
