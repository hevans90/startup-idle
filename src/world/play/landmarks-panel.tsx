/**
 * World v2 — THE LANDMARKS, on the map: each landmark's next tier and each
 * wing not yet built. What can be built now is a card of its own — its
 * building's picture, what it does, what it costs — and what waits is a
 * dimmed line under them, saying what it waits on. While one goes up, it is
 * all the cards show. @see LANDMARKS, ProjectCard
 *
 * Folded away to one line when you want the map, and PULSING when something
 * has become ready you have not looked at yet; opening it marks that seen.
 * @see Session.seenProjects
 */
import { useEffect, useMemo } from "react";
import { twMerge } from "tailwind-merge";

import { LANDMARKS, PROJECTS, projectDef, type ProjectDef } from "../../game/projects";
import { useTicking } from "../../hooks/use-ticking";
import { useFounderStore } from "../../state/founder.store";
import { useGeneratorStore } from "../../state/generators.store";
import { useSessionStore } from "../../state/session.store";
import { useWorldStore } from "../../state/world.store";
import { SLOP_FROM } from "../../game/slop";
import { hasRiver } from "../boats/river";
import { builtProjects, ruledOut, siteOf } from "../projects/works";
import { GateChips } from "./gate-chips";
import { useGateUnlocks } from "./gates";
import { useLandmarkPicture } from "./landmark-picture";
import { InfoPop } from "../../ui/InfoPop";
import { opensText } from "./building-info";
import { ProjectCard, SlopCard, tierLabel } from "./projects-panel";

const PANEL = "border border-line-quiet bg-surface-1/95 text-xs text-fg shadow-lg backdrop-blur-sm";
/** A card inside the panel: no frame or shadow of its own. */
const IN_PANEL = "w-full border-0 bg-transparent p-0 shadow-none dark:bg-transparent";

/** AT MOST TWO AT A TIME: what is going up or ready first, then what comes next in the game. */
const SHOWN = 2;

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
  // ONE AT A TIME: while one goes up, it is all the cards show. @see projectUnderWay
  const going = PROJECTS.filter((p) => siteOf(grid, p));
  const busy = going.length > 0;
  const ready = busy ? [] : next.filter((p) => p.ready(owned, unlocked));
  // Not what waits on a building not yet standing: two steps off.
  const waitingAll = next.filter((p) => !ready.includes(p) && !going.includes(p) && !(p.gate.after && !built.has(p.gate.after)))
    .sort((a, b) => PROJECTS.indexOf(a) - PROJECTS.indexOf(b));
  const readyShown = ready.slice(0, Math.max(0, SHOWN - going.length));
  const waiting = waitingAll.slice(0, Math.max(0, SHOWN - going.length - readyShown.length));
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

  if (!next.length && !busy && !slop) return null;
  return (
    <div className={twMerge("flex max-w-[calc(100vw-1rem)] flex-col items-start gap-2", className)}>
      {slop && <SlopCard />}
      {(next.length > 0 || busy) && (
        <div className={twMerge(PANEL, "flex min-h-0 w-full flex-col")}>
          <button type="button" onClick={() => setOpen(!isOpen)} data-hint="projects"
            className={twMerge(
              "flex w-full cursor-pointer items-center gap-2 px-2 py-1.5 text-left hover:bg-surface-2",
              !isOpen && fresh.length > 0 && "animate-pulse",
            )}
            title={isOpen ? "Fold the landmarks away" : "Open the landmarks"}>
            <span className="flex flex-1 items-center gap-2 font-display text-xs uppercase tracking-widest">
              <span aria-hidden className="h-3 w-0.5 bg-console" />Landmarks
            </span>
            {fresh.length > 0 && !isOpen && (
              <span className="bg-good px-1.5 text-[10px] font-bold uppercase text-white dark:bg-good">{fresh.length} new</span>
            )}
            <span className="tabular-nums text-fg-muted">
              {busy ? "building" : ready.length > 0 ? `${ready.length} ready` : ""}
            </span>
            <span aria-hidden className="text-fg-muted">{isOpen ? "▾" : "▸"}</span>
          </button>
          {isOpen && (
            <div className="flex min-h-0 flex-col gap-2 overflow-y-auto border-t border-line-quiet p-2">
              {going.map((p) => <ProjectCard key={p.id} next={p} className={IN_PANEL} />)}
              {/* READY: a card each, side by side. */}
              {readyShown.length > 0 && (
                <div className="flex gap-2 overflow-x-auto">
                  {readyShown.map((p) => <ProjectCard key={p.id} next={p} className="w-56 shrink-0 shadow-none" />)}
                </div>
              )}
              {/* WAITING, dimmed: what each waits on. */}
              {waiting.length > 0 && (
                <ul className="flex flex-col gap-1.5">
                  {waiting.map((p) => <Waiting key={p.id} p={p} />)}
                </ul>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** A tier not ready: its picture small, its name, what it does, and its gate. */
function Waiting({ p }: { p: ProjectDef }) {
  const picture = useLandmarkPicture(p.structure);
  return (
    <li className="flex items-center gap-2 text-fg-muted">
      <span className="flex h-8 w-10 shrink-0 items-end justify-center opacity-70 grayscale">
        {picture && <img src={picture} alt="" className="max-h-8 max-w-10 object-contain" />}
      </span>
      <span className="min-w-0 flex-1">
        <LandmarkName p={p} className="text-fg" />
        <span className="block truncate text-[11px]">{opensText(p)}</span>
        <GateChips project={p} />
      </span>
    </li>
  );
}

/** A tier's name, and on hover or a press what it does, in full. */
export function LandmarkName({ p, className }: { p: ProjectDef; className?: string }) {
  return (
    <InfoPop placement="right" className={className} title={p.name}
      trigger={<span className="truncate">{p.name}</span>}>
      <p className="text-[10px] uppercase tracking-widest text-fg-faint">{tierLabel(p)}</p>
      <p>{p.pitch}</p>
    </InfoPop>
  );
}
