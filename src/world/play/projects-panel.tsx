/**
 * World v2 — the company's projects, as a log on the map.
 *
 * A card a project: what it opens and costs and a site to choose, or — while
 * it goes up — how far it has got, what is holding it up, and how much of the
 * company to give it. @see game/projects, stepWorks
 */
import { useEffect, useMemo, type ReactNode } from "react";

import { useTicking } from "../../hooks/use-ticking";
import { Button, Segmented } from "../../ui/console";
import { twMerge } from "tailwind-merge";

import {
  PRIORITY_NAMES, PROJECTS, buildersFor, projectCost, type Priority, type ProjectDef,
} from "../../game/projects";
import { useFounderStore } from "../../state/founder.store";
import { useGeneratorStore, type GeneratorId } from "../../state/generators.store";
import { KIND_PLURAL } from "../../molecules/leaders-panel";
import { useSessionStore } from "../../state/session.store";
import { getWorks, useWorldStore } from "../../state/world.store";
import { formatCurrency } from "../../utils/money-utils";
import { SLOP_FROM, SLOP_PER_CODER, TANK_SECONDS, slopMaking } from "../../game/slop";
import { SEWER_RATE } from "../../game/mains";
import { PROCESS_RATE } from "../../game/processors";
import { InfoPop } from "../../ui/InfoPop";
import { tanksOf } from "../slop/tanks";
import { mainReports } from "../water/mains";
import { opensText } from "./building-info";
import { GateChips } from "./gate-chips";
import { useGateUnlocks } from "./gates";
import { showMe } from "./map-focus";
import { builtProjects, materialCap, siteOf, STALL_GRACE } from "../projects/works";
import { hasRiver } from "../boats/river";
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

/**
 * THE PROJECTS LOG, like a quest log: what is IN PROGRESS, what can be
 * started, and what is UP NEXT and waiting on what — folded away to one line
 * when you want the map, and PULSING when something has become available that
 * you have not looked at yet. Opening it marks what it shows as seen; the
 * seen list and whether it is open are kept with the company.
 * @see Session.seenProjects
 *
 * The slop card goes beside it, not in it: it is not a project.
 */
export function ProjectsPanel({ className }: { className?: string }) {
  useTicking(250);
  const grid = useWorldStore((s) => s.grid);
  const generators = useGeneratorStore((s) => s.generators);
  const only = useFounderStore((s) => s.onlyGenerator);
  const unlocked = useGateUnlocks();
  const isOpen = useSessionStore((s) => s.projectsOpen);
  const setOpen = useSessionStore((s) => s.setProjectsOpen);
  const seen = useSessionStore((s) => s.seenProjects);
  const markSeen = useSessionStore((s) => s.markProjectsSeen);
  const owned: Record<string, number> = {};
  for (const g of generators) owned[g.id] = g.amount;
  const built = builtProjects(grid);
  // A founder held to one kind of employee hires nothing a project opens:
  // those projects are not theirs to build. @see getUnlockedGeneratorIds
  // And a project that needs something the map has not got — a harbour on a
  // map with no river — is not offered at all. @see ProjectDef.needsMap
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const river = useMemo(() => hasRiver(grid), [grid, grid.rev]);
  // Wonders have a menu of their own. @see WondersPanel
  const open = PROJECTS.filter((p) => !p.bonus && !built.has(p.id) && !(only && p.unlocks) && !(p.needsMap === "river" && !river));
  // ONE PROJECT AT A TIME: while one is under way — a wonder too — it is all
  // the log shows, and the rest wait for it to stand. @see projectUnderWay
  const going = PROJECTS.filter((p) => !built.has(p.id) && siteOf(grid, p));
  const busy = going.length > 0;
  const available = busy ? [] : open.filter((p) => p.ready(owned, unlocked));
  const next = busy ? [] : open.filter((p) => !available.includes(p));
  const fresh = available.filter((p) => !seen.includes(p.id));
  const slop = (owned.vibe_coder ?? 0) >= SLOP_FROM;

  // OPEN, what it shows has been seen.
  const freshKey = fresh.map((p) => p.id).join(",");
  useEffect(() => {
    if (isOpen && freshKey) markSeen(freshKey.split(","));
  }, [isOpen, freshKey, markSeen]);

  // FOLDED AWAY ONCE THE TOWN HAS ITS FIRST PROJECT: it starts closed over
  // the map, and opens itself only when a project becomes ready that has not
  // been seen — a choice to make. @see plans/polish.md (UI 3)
  const anyBuilt = built.size > 0;
  useEffect(() => {
    if (anyBuilt && !freshKey) setOpen(false);
    // On load only: after that it is the player's to fold.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (anyBuilt && freshKey) setOpen(true);
  }, [anyBuilt, freshKey, setOpen]);

  if (!open.length && !busy && !slop) return null;
  return (
    <div className={twMerge("flex max-h-[75%] w-72 flex-col gap-2", className)}>
      {slop && <SlopCard />}
      {(open.length > 0 || busy) && (
        <div className={twMerge(CARD, "flex min-h-0 w-full flex-col p-0")}>
          <button type="button" onClick={() => setOpen(!isOpen)} data-hint="projects"
            className={twMerge(
              "flex w-full cursor-pointer items-center gap-2 px-2 py-1.5 text-left hover:bg-surface-2",
              !isOpen && fresh.length > 0 && "animate-pulse",
            )}
            title={isOpen ? "Fold the projects log away" : "Open the projects log"}>
            <span className="flex flex-1 items-center gap-2 font-display text-xs uppercase tracking-widest">
              <span aria-hidden className="h-3 w-0.5 bg-console" />Projects
            </span>
            {fresh.length > 0 && !isOpen && (
              <span className="bg-good px-1.5 text-[10px] font-bold uppercase text-white">
                {fresh.length} new
              </span>
            )}
            <span className="tabular-nums text-fg-muted">
              {going.length > 0 && `${going.length} building`}
              {going.length > 0 && available.length > 0 && " · "}
              {available.length > 0 && `${available.length} ready`}
            </span>
            <span aria-hidden className="text-fg-muted">{isOpen ? "▾" : "▸"}</span>
          </button>
          {isOpen && (
            <div className="flex min-h-0 flex-col gap-2 overflow-y-auto border-t border-line-quiet p-2">
              {/* What can be started, first and untitled: the cards say it. */}
              {available.map((p) => <ProjectCard key={p.id} next={p} className={IN_LOG} />)}
              {busy && <LogSection title="In progress">
                {going.map((p) => <ProjectCard key={p.id} next={p} className={IN_LOG} />)}
              </LogSection>}
              {next.length > 0 && <LogSection title="Up next">
                {next.map((p) => (
                  <div key={p.id} className="flex items-start justify-between gap-2 text-fg-muted">
                    <span>{p.name}</span>
                    <GateChips project={p} />
                  </div>
                ))}
              </LogSection>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** A card inside the log: no frame or shadow of its own, a rule above it. */
const IN_LOG = "w-full border-0 bg-transparent p-0 shadow-none dark:bg-transparent";

function LogSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <p className="text-[10px] uppercase tracking-widest text-fg-muted">{title}</p>
      {children}
    </section>
  );
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
        <p>From {SLOP_FROM} vibe coders on, each makes {SLOP_PER_CODER} slop a second into a tank at their workplace: half that when they are happy, twice it when they are miserable, and a fifth more under Hackathon Culture.</p>
        <p>A tank holds {Math.round(TANK_SECONDS / 60)} minutes of what its workplace makes. Full, it spills at its slop port: sludge on the street, which homes hate and vibe coders leave their desks to mop, or pollution in water.</p>
        <p>A sewer drains every tank whose slop port it reaches, by itself on a tile beside the port, up to {SEWER_RATE} a second for each width of bore. Refineries and the other processors take theirs first, {PROCESS_RATE} a second each; the rest goes out of an outfall into the water, and fouls it.</p>
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
  // Their name in the plural: "your interns", "your vibe coders".
  const who = next.builders.map((id) => KIND_PLURAL[id as GeneratorId] ?? id).join(" and ");

  // READY: what it opens, what it costs, and a site to choose.
  if (!site) {
    const choosing = placing === next.id;
    const income = useGeneratorStore.getState().getMoneyPerSecond();
    return (
      <div className={twMerge(CARD, className)}>
        <p className="font-bold">{next.name}</p>
        <p className="text-fg-muted">{opensText(next)}</p>
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
          <Button variant="primary" className="mt-2 w-full font-bold" onClick={() => placeProject(next.id)}>
            Choose a site
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
