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
  PRIORITY_NAMES, PROJECTS, buildersFor, type Priority, type ProjectDef,
} from "../../game/projects";
import { useFounderStore } from "../../state/founder.store";
import { useGeneratorStore } from "../../state/generators.store";
import { useInnovationStore } from "../../state/innovation.store";
import { useMoneyStore } from "../../state/money.store";
import { getWorks, useWorldStore } from "../../state/world.store";
import { formatCurrency } from "../../utils/money-utils";
import { builtProjects, materialCap, siteOf, STALL_GRACE } from "../projects/works";

const CARD =
  "w-72 border border-primary-400 bg-primary-50/95 p-2 text-xs text-primary-900 shadow "
  + "dark:border-primary-600 dark:bg-primary-900/95 dark:text-primary-100";
const BTN =
  "cursor-pointer border border-primary-400 px-2 py-1 hover:bg-primary-200 "
  + "dark:border-primary-600 dark:hover:bg-primary-800";
const ON = "bg-primary-300 dark:bg-primary-700";

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
  if (!active.length && !teaser) return null;
  return (
    <div className={twMerge("flex max-h-[70%] flex-col gap-2 overflow-y-auto", className)}>
      {active.map((p) => <ProjectCard key={p.id} next={p} unlocked={unlocked} />)}
      {teaser && <ProjectCard key={teaser.id} next={teaser} unlocked={unlocked} />}
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
  const money = useMoneyStore((s) => s.money);
  const owned: Record<string, number> = {};
  for (const g of generators) owned[g.id] = g.amount;
  const site = siteOf(grid, next);
  // Their name in the plural: "your interns", "your vibe coders".
  const who = next.builders.map((id) => `${generators.find((g) => g.id === id)?.name ?? id}s`).join(" and ");

  // NOT YET: what it is waiting for.
  if (!site && !next.ready(owned, unlocked)) {
    return (
      <div className={twMerge(CARD, className)}>
        <p className="text-[10px] font-bold uppercase tracking-wide text-primary-600 dark:text-primary-400">Next project</p>
        <p className="font-bold">{next.name}</p>
        <p className="mt-1 text-primary-700 dark:text-primary-300">Needs {next.readyWhen}.</p>
      </div>
    );
  }

  // READY: choose a site, or choosing one.
  if (!site) {
    const choosing = placing === next.id;
    return (
      <div className={twMerge(CARD, className)}>
        <p className="text-[10px] font-bold uppercase tracking-wide text-emerald-700 dark:text-emerald-400">New project</p>
        <p className="font-bold">{next.name}</p>
        <p className="mt-1">{next.pitch}</p>
        <p className="mt-1 text-primary-700 dark:text-primary-300">
          {next.founderBuilds
            ? "You build this one yourself, from salvaged materials: it costs nothing."
            : <>Materials {formatCurrency(next.cost)}, paid as {next.deliveries} loads arrive. Built by your {who},
              who stop working while they build.</>}
        </p>
        {choosing ? (
          <div className="mt-2 flex items-center justify-between gap-2">
            <span className="text-emerald-700 dark:text-emerald-400">Click a spot beside a road for its site.</span>
            <button type="button" className={BTN} onClick={() => placeProject(null)}>Cancel</button>
          </div>
        ) : (
          <button type="button" className={twMerge(BTN, "mt-2 w-full font-bold")} onClick={() => placeProject(next.id)}>
            Choose a site
          </button>
        )}
      </div>
    );
  }

  // GOING UP.
  const b = site.build!;
  const works = getWorks();
  const crew = works.crews.get(site.id) ?? { walking: 0, working: 0 };
  const loadPrice = b.cost / b.deliveries;
  const stalled = (works.stalled.get(site.id) ?? 0) > 0;
  const truck = (works.trucks.get(site.id) ?? 0) > 0;
  const caughtUp = b.done >= materialCap(b) - 1e-6;
  const away = next.builders.reduce((n, id) => n + (works.away[id] ?? 0), 0);
  const status = b.priority === 0
    ? "Paused. Everyone is back at their desk."
    : stalled
      ? `Stalled: ${formatCurrency(loadPrice)} needed for the next load.${(works.stalled.get(site.id) ?? 0) > STALL_GRACE ? " The crew has gone home." : ""}`
      : caughtUp && truck
        ? "Waiting for a load to arrive."
        : crew.working === 0 && crew.walking > 0
          ? "The crew is on its way."
          : "Building.";
  return (
    <div className={twMerge(CARD, className)}>
      <div className="flex items-baseline justify-between">
        <p className="font-bold">{next.name}</p>
        <span className="tabular-nums">{Math.floor((b.done / b.need) * 100)}%</span>
      </div>
      <Bar value={b.done / b.need} className="mt-1" />
      <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 tabular-nums">
        <dt className="text-primary-600 dark:text-primary-400">Crew</dt>
        <dd>{crew.working} at work{crew.walking ? `, ${crew.walking} on the way` : ""}</dd>
        {!next.founderBuilds && <>
          <dt className="text-primary-600 dark:text-primary-400">Away</dt>
          <dd>{away} {who} off their desks</dd>
        </>}
        <dt className="text-primary-600 dark:text-primary-400">Materials</dt>
        <dd>{b.delivered}/{b.deliveries} loads{truck ? ", one on the road" : ""}</dd>
      </dl>
      <p className={twMerge("mt-1", stalled && "text-red-700 dark:text-red-400")}>{status}</p>
      <div className="mt-2 flex gap-1" title="How much of the company works on it. Builders don't work at their desks.">
        {PRIORITY_NAMES.map((name, k) => (
          <button key={name} type="button" onClick={() => setPriority(site.id, k as Priority)}
            className={twMerge(BTN, "flex-1 px-1", b.priority === k && ON)}>
            {name}
          </button>
        ))}
      </div>
      <p className="mt-1 text-[11px] text-primary-600 dark:text-primary-400">
        {b.priority === 0
          ? "No one is building."
          : next.founderBuilds
            ? "You are building it yourself."
            : `${buildersFor(next, b.priority, owned, site.w * site.h)} of your ${who} build at ${PRIORITY_NAMES[b.priority].toLowerCase()} priority.`}
        {money.lt(loadPrice) && !stalled ? ` The next load costs ${formatCurrency(loadPrice)}.` : ""}
      </p>
    </div>
  );
}
