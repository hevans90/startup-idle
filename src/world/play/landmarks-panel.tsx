/**
 * World v2 — THE LANDMARKS, on the map: two at a time — what is going up or
 * can be built now first, then what comes next in the game. Each the same
 * shape whatever its state: its building's picture; its tier, name and what
 * it does; and under them, its price and a button, how far it has got, or
 * what it waits on. @see LANDMARKS
 *
 * Folded away to one line when you want the map, and PULSING when something
 * has become ready you have not looked at yet; opening it marks that seen.
 * @see Session.seenProjects
 */
import { useEffect, useMemo, type ReactNode } from "react";
import { twMerge } from "tailwind-merge";

import {
  LANDMARKS, PRIORITY_NAMES, PROJECTS, buildersFor, projectCost, projectDef, type Priority, type ProjectDef,
} from "../../game/projects";
import { SLOP_FROM } from "../../game/slop";
import { useTicking } from "../../hooks/use-ticking";
import { KIND_PLURAL } from "../../molecules/leaders-panel";
import { useFounderStore } from "../../state/founder.store";
import { useGeneratorStore, type GeneratorId } from "../../state/generators.store";
import { useSessionStore } from "../../state/session.store";
import { getWorks, useWorldStore } from "../../state/world.store";
import { Badge, Button, Segmented } from "../../ui/console";
import { InfoPop } from "../../ui/InfoPop";
import { formatCurrency } from "../../utils/money-utils";
import { hasRiver } from "../boats/river";
import { builtProjects, materialCap, ruledOut, siteOf, STALL_GRACE, upgradeFrom } from "../projects/works";
import { structureDef } from "../structures/def";
import { opensText } from "./building-info";
import { GateChips } from "./gate-chips";
import { useGateUnlocks } from "./gates";
import { useLandmarkPicture } from "./landmark-picture";
import { SlopCard } from "./slop-card";

/** AT MOST TWO AT A TIME: what is going up or ready first, then what comes next in the game. */
const SHOWN = 2;

/** "45 seconds", "2 minutes". */
const formatDuration = (s: number) => (s < 90 ? `${s} seconds` : `${Math.round(s / 60)} minutes`);

/** Each landmark's next tier, and each wing not built: what this company could build, now or later. */
function nextUp(built: ReadonlySet<string>, offered: (p: ProjectDef) => boolean): ProjectDef[] {
  const out: ProjectDef[] = [];
  for (const l of LANDMARKS) {
    const tier = l.tiers.map((id) => projectDef(id)!).find((p) => !built.has(p.id));
    if (tier && offered(tier)) out.push(tier);
    for (const id of l.wings ?? []) {
      const w = projectDef(id)!;
      if (!built.has(id) && offered(w)) out.push(w);
    }
  }
  return out;
}

export function LandmarksPanel({ className }: { className?: string }) {
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
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const river = useMemo(() => hasRiver(grid), [grid, grid.rev]);
  // Not for a founder held to one kind, what opens another; not a harbour
  // with no river; not a fork taken the other way. @see ruledOut
  const next = nextUp(built, (p) => !(only && p.unlocks) && !(p.needsMap === "river" && !river) && !ruledOut(grid, p));
  // ONE AT A TIME: while one goes up, nothing else is ready. @see projectUnderWay
  const going = PROJECTS.filter((p) => siteOf(grid, p));
  const busy = going.length > 0;
  const ready = busy ? [] : next.filter((p) => p.ready(owned, unlocked));
  // Waiting, in the game's order; not what waits on a building not yet standing, two steps off.
  const waiting = next
    .filter((p) => !ready.includes(p) && !going.includes(p) && !(p.gate.after && !built.has(p.gate.after)))
    .sort((a, b) => PROJECTS.indexOf(a) - PROJECTS.indexOf(b));
  const shown: { p: ProjectDef; state: "going" | "ready" | "waiting" }[] = [
    ...going.map((p) => ({ p, state: "going" as const })),
    ...ready.map((p) => ({ p, state: "ready" as const })),
    ...waiting.map((p) => ({ p, state: "waiting" as const })),
  ].slice(0, SHOWN);
  const fresh = ready.filter((p) => !seen.includes(p.id));
  const slop = (owned.vibe_coder ?? 0) >= SLOP_FROM;

  const freshKey = fresh.map((p) => p.id).join(",");
  useEffect(() => {
    if (isOpen && freshKey) markSeen(freshKey.split(","));
  }, [isOpen, freshKey, markSeen]);
  // FOLDED once the town has its first: open again only for something new. @see plans/polish.md (UI 3)
  const anyBuilt = built.size > 0;
  useEffect(() => {
    if (anyBuilt && !freshKey) setOpen(false);
    // On load only: after that it is the player's to fold.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (anyBuilt && freshKey) setOpen(true);
  }, [anyBuilt, freshKey, setOpen]);

  if (!shown.length && !slop) return null;
  const status = busy ? "Building" : ready.length ? `${ready.length} ready` : null;
  return (
    <div className={twMerge("flex max-w-[calc(100vw-1rem)] flex-col items-start gap-2", className)}>
      {slop && <SlopCard />}
      {shown.length > 0 && (
        <section className="w-80 max-w-full border border-line-quiet bg-surface-1/95 text-xs text-fg shadow-lg backdrop-blur-sm dark:bg-surface-1/95">
          <button type="button" onClick={() => setOpen(!isOpen)} data-hint="projects" aria-expanded={isOpen}
            className={twMerge(
              "flex w-full cursor-pointer items-center gap-2 px-2.5 py-2 text-left hover:bg-surface-2",
              !isOpen && fresh.length > 0 && "animate-pulse",
            )}
            title={isOpen ? "Fold the landmarks away" : "Open the landmarks"}>
            <span aria-hidden className="h-3 w-0.5 bg-console" />
            <span className="flex-1 font-display text-xs uppercase tracking-widest">Landmarks</span>
            {status && <Badge tone={busy ? "console" : "good"}>{fresh.length && !isOpen ? `${fresh.length} new` : status}</Badge>}
            <span aria-hidden className="w-3 text-center text-fg-muted">{isOpen ? "▾" : "▸"}</span>
          </button>
          {isOpen && (
            <ul className="border-t border-line-quiet">
              {shown.map(({ p, state }) => (
                <li key={p.id} className="border-t border-line-quiet first:border-t-0">
                  <Landmark p={p} state={state} />
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}

/**
 * ONE LANDMARK TIER, the same shape in every state: the picture and what it
 * is on top, and under them what to do about it.
 */
function Landmark({ p, state }: { p: ProjectDef; state: "going" | "ready" | "waiting" }) {
  const picture = useLandmarkPicture(p.structure);
  const waiting = state === "waiting";
  const or = p.rival ? projectDef(p.rival) : null;
  return (
    <div className={twMerge("flex flex-col gap-2 p-2.5", state === "ready" && "bg-good/5 dark:bg-good/10")}>
      <div className="flex gap-2.5">
        <div className="flex h-16 w-20 shrink-0 items-end justify-center overflow-hidden border border-line-quiet bg-surface-2 p-1 dark:bg-surface-2">
          {picture && (
            <img src={picture} alt="" className={twMerge("max-h-full max-w-full object-contain", waiting && "opacity-50 grayscale")} />
          )}
        </div>
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex items-center justify-between gap-2">
            <LandmarkName p={p} className={twMerge("text-sm font-bold", waiting && "text-fg-muted")} />
            {state === "ready" && <Badge tone="good">Ready</Badge>}
          </div>
          <p className={twMerge("truncate", waiting ? "text-fg-muted" : "text-good")}>{opensText(p)}</p>
          {or && <p className="truncate text-[11px] text-warn">Or the {or.name}, never both</p>}
        </div>
      </div>
      {state === "ready" && <ReadyFoot p={p} />}
      {state === "going" && <GoingFoot p={p} />}
      {waiting && (
        <Foot label="Needs">
          <GateChips project={p} className="min-w-0 flex-1" />
        </Foot>
      )}
    </div>
  );
}

/** Under a tier: a quiet label at the left, and what it says beside it. */
function Foot({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-14 shrink-0 text-[10px] uppercase tracking-widest text-fg-faint">{label}</span>
      {children}
    </div>
  );
}

/** Ready: what it costs and who builds it, and the button — a site to choose, or built where the last tier stands. */
function ReadyFoot({ p }: { p: ProjectDef }) {
  const grid = useWorldStore((s) => s.grid);
  const placing = useWorldStore((s) => s.placingProject);
  const placeProject = useWorldStore((s) => s.placeProject);
  const income = useGeneratorStore.getState().getMoneyPerSecond();
  const here = upgradeFrom(grid, p);
  const who = p.builders.map((id) => KIND_PLURAL[id as GeneratorId] ?? id).join(" and ");
  if (placing === p.id) {
    const near = structureDef(p.structure)?.placement?.nearRiver;
    return (
      <div className="flex items-center justify-between gap-2">
        <span className="text-good">{near ? `Beside a road, ${near} tiles from the river` : "Click a spot beside a road"}</span>
        <Button size="sm" variant="quiet" onClick={() => placeProject(null)}>Cancel</Button>
      </div>
    );
  }
  return (
    <div className="flex items-center justify-between gap-2">
      {p.founderBuilds ? <span /> : (
        <span className="min-w-0 tabular-nums"
          title={`About ${formatDuration(p.incomeSeconds)} of income, fixed when you start. Your ${who} build it, away from their desks.`}>
          <b className="text-money">{formatCurrency(projectCost(p, income))}</b>
          <span className="text-fg-muted"> · {who}</span>
        </span>
      )}
      <Button size="sm" variant="primary" className="shrink-0 font-bold" onClick={() => placeProject(p.id)}
        title={here ? `Built over the ${structureDef(here.def)?.name ?? "building"}, where it stands` : "Then click a spot beside a road"}>
        {here ? "Build" : "Choose site"}
      </Button>
    </div>
  );
}

/** Going up: how far, who and what is on site, what is wrong if anything, and how much of the company it takes. */
function GoingFoot({ p }: { p: ProjectDef }) {
  const grid = useWorldStore((s) => s.grid);
  const setPriority = useWorldStore((s) => s.setProjectPriority);
  const generators = useGeneratorStore((s) => s.generators);
  const site = siteOf(grid, p);
  if (!site?.build) return null;
  const owned: Record<string, number> = {};
  for (const g of generators) owned[g.id] = g.amount;
  const b = site.build;
  const works = getWorks();
  const crew = works.crews.get(site.id) ?? { walking: 0, working: 0 };
  const stalledFor = works.stalled.get(site.id) ?? 0;
  const truck = (works.trucks.get(site.id) ?? 0) > 0;
  const caughtUp = b.done >= materialCap(b) - 1e-6;
  const problem = b.priority === 0 ? null
    : stalledFor > 0 ? `Stalled: next load ${formatCurrency(b.cost / b.deliveries)}${stalledFor > STALL_GRACE ? ", crew gone home" : ""}`
      : caughtUp && truck ? "Waiting for a load"
        : crew.working === 0 && crew.walking > 0 ? "Crew on the way" : null;
  const who = p.builders.map((id) => KIND_PLURAL[id as GeneratorId] ?? id).join(" and ");
  const share = Math.min(1, b.done / b.need);
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2">
        <span className="h-1.5 flex-1 bg-surface-3">
          <span className="block h-full bg-good" style={{ width: `${Math.round(share * 100)}%` }} />
        </span>
        <span className="w-9 text-right font-bold tabular-nums">{Math.floor(share * 100)}%</span>
      </div>
      <div className="flex items-center justify-between gap-2 tabular-nums text-fg-muted">
        <span>{crew.working + crew.walking} building · {b.delivered}/{b.deliveries} loads</span>
        {problem && <span className={twMerge("truncate", stalledFor > 0 ? "text-bad" : "text-warn")}>{problem}</span>}
      </div>
      <div className="flex items-center justify-between gap-2"
        title={p.founderBuilds ? "You build it yourself."
          : `How much of the company builds: ${buildersFor(p, b.priority, owned, site.w * site.h)} of your ${who} now. Builders don't work at their desks.`}>
        <span className="text-[10px] uppercase tracking-widest text-fg-faint">Priority</span>
        <Segmented label={`${p.name}: priority`} value={String(b.priority)} onChange={(v) => setPriority(site.id, Number(v) as Priority)}
          options={PRIORITY_NAMES.map((name, k) => ({ value: String(k), label: name }))} />
      </div>
    </div>
  );
}

/** A tier's name, and on hover or a press what it does, in full. */
export function LandmarkName({ p, className }: { p: ProjectDef; className?: string }) {
  return (
    <InfoPop placement="right" className={twMerge("min-w-0", className)} title={p.name}
      trigger={<span className="truncate">{p.name}</span>}>
      <p>{p.pitch}</p>
    </InfoPop>
  );
}
