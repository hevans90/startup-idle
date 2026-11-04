/**
 * World v2 — a project's card: its picture, what it opens and costs, and a
 * site to choose — or, while it goes up, how far it has got, what is holding
 * it up, and how much of the company to give it. And the slop card. Shown by
 * the landmarks panel. @see LandmarksPanel, game/projects, stepWorks
 */

import { useTicking } from "../../hooks/use-ticking";
import { Button, Segmented } from "../../ui/console";
import { twMerge } from "tailwind-merge";

import {
  PRIORITY_NAMES, buildersFor, landmarkOf, projectCost, projectDef, type Priority, type ProjectDef,
} from "../../game/projects";
import { useGeneratorStore, type GeneratorId } from "../../state/generators.store";
import { KIND_PLURAL } from "../../molecules/leaders-panel";
import { getWorks, useWorldStore } from "../../state/world.store";
import { formatCurrency } from "../../utils/money-utils";
import { SLOP_FROM, SLOP_PER_CODER, slopMaking } from "../../game/slop";
import { useLandmarkPicture } from "./landmark-picture";
import { SEWER_RATE } from "../../game/mains";
import { PROCESS_RATE } from "../../game/processors";
import { InfoPop } from "../../ui/InfoPop";
import { tanksOf } from "../slop/tanks";
import { mainReports } from "../water/mains";
import { opensText } from "./building-info";
import { showMe } from "./map-focus";
import { materialCap, siteOf, STALL_GRACE, upgradeFrom } from "../projects/works";
import { structureDef } from "../structures/def";

/** The map's docks: a raised surface, a quiet line. */
const CARD = "w-72 border border-line-quiet bg-surface-1/95 p-2.5 text-xs text-fg shadow-lg backdrop-blur-sm";

/** "45 seconds", "2 minutes". */
const formatDuration = (s: number) =>
  s < 90 ? `${s} seconds` : `${Math.round(s / 60)} minutes`;


function Bar({ value, className }: { value: number; className?: string }) {
  return (
    <div className={twMerge("h-1 w-full bg-surface-3", className)}>
      <div className="h-full bg-good" style={{ width: `${Math.round(Math.min(1, value) * 100)}%` }} />
    </div>
  );
}

/** A tier's place in its landmark: "HQ · 2 of 4", "Data Centre wing". @see LANDMARKS */
export function tierLabel(p: ProjectDef): string {
  const l = landmarkOf(p.id), k = l.tiers.indexOf(p.id);
  return k < 0 ? `${l.name} wing` : l.tiers.length > 1 ? `${l.name} · ${k + 1} of ${l.tiers.length}` : "Landmark";
}

/** Tanks the slop card lists one by one; past this, it sums them up and lists only the worst. */
const SLOP_ROWS = 5, SLOP_WORST = 3;

/**
 * SLOP: what the vibe coders make a second, and each workplace's tank — how
 * full, whether a sewer takes from it, and whether it is spilling onto the
 * street. A press on one shows it on the map. With many workplaces it
 * CONDENSES: how many spill, fill and are sewered, and only the worst few
 * tanks. How it all works is on the title, on hover. @see world/slop/tanks
 */
export function SlopCard() {
  useTicking(500);
  const grid = useWorldStore((s) => s.grid);
  const tanks = tanksOf(grid);
  const drained = new Set([...mainReports().values()].flatMap((r) => (r.sewer && r.state === "flowing" ? r.sewer.sources : [])));
  const rows = [...tanks.entries()]
    .map(([id, t]) => ({ id, t, s: grid.structures.get(id), full: t.capacity > 0 ? t.level / t.capacity : 0, sewered: drained.has(id) }))
    .filter((r) => r.s);
  const spilling = rows.filter((r) => r.t.spilling).length;
  const sewered = rows.filter((r) => !r.t.spilling && r.sewered).length;
  const filling = rows.length - spilling - sewered;
  // THE WORST FIRST: spilling, then the fullest a sewer does not take from.
  const rank = (r: (typeof rows)[number]) => (r.t.spilling ? 2 : r.sewered ? -1 : r.full);
  const condensed = rows.length > SLOP_ROWS;
  const shown = condensed ? [...rows].sort((a, b) => rank(b) - rank(a)).filter((r) => !r.sewered || r.t.spilling).slice(0, SLOP_WORST) : rows;
  return (
    <div className={twMerge(SMALL, spilling ? "border-bad" : "")}>
      <InfoPop placement="right" className="justify-between gap-2" title="Slop" trigger={<>
        <b>Slop</b>
        <span className="tabular-nums text-fg-muted">{slopMaking().toFixed(2)} a second</span>
      </>}>
        <p>{SLOP_FROM}+ vibe coders each make {SLOP_PER_CODER}/s into their workplace's tank. Unhappy coders make more.</p>
        <p>A full tank spills: sludge on the street, or pollution in water.</p>
        <p>Sewers drain tanks, {SEWER_RATE}/s per bore: processors first ({PROCESS_RATE}/s each), the rest out to water.</p>
      </InfoPop>
      {condensed && (
        <div className="mt-1 flex flex-col gap-1">
          <span className="flex h-1 w-full bg-surface-3">
            <span className="block h-full bg-bad" style={{ width: `${(spilling / rows.length) * 100}%` }} />
            <span className="block h-full bg-warn" style={{ width: `${(filling / rows.length) * 100}%` }} />
            <span className="block h-full bg-good" style={{ width: `${(sewered / rows.length) * 100}%` }} />
          </span>
          <span className="flex justify-between tabular-nums text-fg-muted">
            <span className={spilling ? "text-bad" : ""}>{spilling} spilling</span>
            <span>{filling} filling</span>
            <span className={sewered ? "text-good" : ""}>{sewered} sewered</span>
          </span>
        </div>
      )}
      {shown.map(({ id, t, s, full, sewered: taken }) => (
        <button key={id} type="button" onClick={() => showMe({ x: s!.x + 1, y: s!.y + 1 })}
          className="mt-1 flex w-full cursor-pointer items-center gap-1.5 text-left">
          <span className="w-24 truncate">{structureDef(s!.def)?.name}</span>
          <span className="h-1 flex-1 bg-surface-3">
            <span className={twMerge("block h-full", t.spilling ? "bg-bad" : full > 0.75 ? "bg-warn" : "bg-good")} style={{ width: `${Math.min(100, full * 100)}%` }} />
          </span>
          <span className={twMerge("w-14 text-right tabular-nums", t.spilling ? "text-bad" : taken ? "text-good" : "text-fg-muted")}>
            {t.spilling ? "spilling" : taken ? "sewered" : `${Math.round(full * 100)}%`}
          </span>
        </button>
      ))}
    </div>
  );
}
const SMALL = "w-56 border border-line-quiet bg-surface-1/95 px-2.5 py-1.5 text-[11px] text-fg shadow-lg backdrop-blur-sm";

/** One project's card: its site to choose, or how it is going. */
export function ProjectCard({ next, className }: { next: ProjectDef; className?: string }) {
  const grid = useWorldStore((s) => s.grid);
  const placing = useWorldStore((s) => s.placingProject);
  const placeProject = useWorldStore((s) => s.placeProject);
  const setPriority = useWorldStore((s) => s.setProjectPriority);
  const generators = useGeneratorStore((s) => s.generators);
  const owned: Record<string, number> = {};
  for (const g of generators) owned[g.id] = g.amount;
  const site = siteOf(grid, next);
  const picture = useLandmarkPicture(next.structure);
  // Their name in the plural: "your interns", "your vibe coders".
  const who = next.builders.map((id) => KIND_PLURAL[id as GeneratorId] ?? id).join(" and ");

  // READY: its picture, what it opens, what it costs, and a site to choose —
  // or, a landmark's next tier, built where the last one stands.
  if (!site) {
    const choosing = placing === next.id;
    const income = useGeneratorStore.getState().getMoneyPerSecond();
    const here = upgradeFrom(grid, next);
    const or = next.rival ? projectDef(next.rival) : null;
    return (
      <div className={twMerge(CARD, className)}>
        <div className="mb-1 flex h-24 items-end justify-center">
          {picture && <img src={picture} alt="" className="max-h-24 max-w-full object-contain" />}
        </div>
        <p className="text-[10px] uppercase tracking-widest text-fg-faint">{tierLabel(next)}</p>
        <p className="font-bold">{next.name}</p>
        <p className="text-fg-muted">{opensText(next)}</p>
        {or && <p className="text-warn">Or the {or.name}, never both</p>}
        <p className="tabular-nums text-fg-muted"
          title={next.founderBuilds ? undefined
            : `About ${formatDuration(next.incomeSeconds)} of income, fixed when you choose the site. Builders leave their desks while they build.`}>
          {next.founderBuilds ? "Free · you build it" : `${formatCurrency(projectCost(next, income))} · built by ${who}`}
        </p>
        {choosing ? (
          <div className="mt-1.5 flex items-center justify-between gap-2">
            <span className="text-good">
              {structureDef(next.structure)?.placement?.nearRiver
                ? `Beside a road, within ${structureDef(next.structure)!.placement!.nearRiver} tiles of the river`
                : "Click beside a road"}
            </span>
            <Button size="sm" variant="quiet" onClick={() => placeProject(null)}>Cancel</Button>
          </div>
        ) : (
          <Button variant="primary" className="mt-2 w-full font-bold" onClick={() => placeProject(next.id)}
            title={here ? `Built over the ${structureDef(here.def)?.name ?? "building"}, where it stands` : undefined}>
            {here ? "Build" : "Choose a site"}
          </Button>
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
      <p className="mt-1 tabular-nums text-fg-muted">
        {crew.working + crew.walking} building · {b.delivered}/{b.deliveries} loads
      </p>
      {problem && <p className={stalledFor > 0 ? "text-bad" : "text-fg-muted"}>{problem}</p>}
      <div className="mt-2 flex items-center justify-between gap-2"
        title={next.founderBuilds ? "You build it yourself."
          : `How much of the company builds: ${buildersFor(next, b.priority, owned, site.w * site.h)} of your ${who} now. Builders don't work at their desks.`}>
        <span className="text-[10px] uppercase tracking-widest text-fg-faint">Priority</span>
        <Segmented label={`${next.name}: priority`} value={String(b.priority)} onChange={(v) => setPriority(site.id, Number(v) as Priority)}
          options={PRIORITY_NAMES.map((name, k) => ({ value: String(k), label: name }))} />
      </div>
    </div>
  );
}
