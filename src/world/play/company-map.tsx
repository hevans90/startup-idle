/**
 * World v2 — the company's map, in the game.
 *
 * Where the old procedural city used to be: the company's own town, made new
 * for every company, built on by the player under the game's rules, and
 * telling the economy its beds. @see useFoundWorld, BuildBar
 *
 * The default export, so the game can load it lazily: the map engine is most
 * of the bundle, and the founder screen does not need it.
 */
import { TopStreets } from "./top-streets";
import { DesireReadout } from "./desire-readout";
import { useEffect } from "react";

import { projectForStructure } from "../../game/projects";
import { useResizeToWrapper } from "../../hooks/use-resize-to-wrapper";
import { useGlobalSettingsStore } from "../../state/global-settings.store";
import { useWorldStore } from "../../state/world.store";
import { structureOf } from "../grid";
import { useFoundWorld, WorldCanvas } from "../world-canvas";
import { BuildBar } from "./build-bar";
import { BuildingLabels } from "./building-labels";
import { PortIncome } from "./port-income";
import { ProjectsPanel } from "./projects-panel";
import { EventMarkers } from "./event-cards";
import { CommsDock } from "../../ui/comms/comms-dock";
import { startCommsBridge } from "../../ui/comms/bridge";
import { LeaderTags } from "./leader-tags";
import { PerfHud } from "../debug/perf-hud";
import { Anchored } from "./anchored";
import { MainInfo } from "./main-card";
import { QuestArcMarkers } from "../../quest-ui/arc";

/** The frame meter over the play view, with `?perf`: what each part of a frame costs. @see PerfHud */
const SHOW_PERF = typeof location !== "undefined" && new URLSearchParams(location.search).has("perf");
// The stores on `window` in development, as the editor has them. @see expose-store
import "../debug/expose-store";
import "../debug/town-perf";

export default function CompanyMap({ hidden = false }: { hidden?: boolean }) {
  const { ref: wrapperRef, setRef, size } = useResizeToWrapper();
  // OUT OF SIGHT, on a phone's other tab: not drawn, though the town goes on.
  useEffect(() => { useWorldStore.getState().setMapHidden(hidden); }, [hidden]);
  useFoundWorld("run", true);
  /**
   * BUILDINGS ARE THE WAY IN: with the look tool in hand, clicking a finished
   * project's building opens what it is for — the HQ the innovation tab, the
   * studio the employees. A drag pans the map and opens nothing.
   * @see ProjectDef.opens, WorldState.lookedAt
   */
  // INTO COMMS: the world's refusals, its events and the AI's asks. @see startCommsBridge
  useEffect(() => startCommsBridge(), []);
  useEffect(() => useWorldStore.subscribe((st, was) => {
    if (!st.lookedAt || st.lookedAt === was.lookedAt) return;
    const s = structureOf(st.grid, st.lookedAt.x, st.lookedAt.y);
    const p = s && !s.build ? projectForStructure(s.def) : null;
    if (p?.opens) useGlobalSettingsStore.getState().setSidebarTab(p.opens);
  }), []);
  return (
    <div ref={setRef} className="@container absolute inset-0 min-h-0 bg-surface-0">
      <WorldCanvas wrapperRef={wrapperRef} size={size} />
      <BuildingLabels />
      {SHOW_PERF && <PerfHud />}
      <DesireReadout />
      <PortIncome />
      {/* THE WORK, top left: the projects, then the streets that earn most. @see plans/ui-overhaul.md §3.2 */}
      <div className="absolute left-2 top-9 z-10 flex max-h-[calc(100%-9rem)] flex-col items-start gap-2 overflow-y-auto max-md:top-2 max-md:max-w-[calc(100%-1rem)]">
        <ProjectsPanel />
        <TopStreets />
      </div>
      <EventMarkers />
      {/* THE ARC's ring on the map, where an objective has a place. @see QuestArcMarkers */}
      <QuestArcMarkers />
      <LeaderTags />
      {/* COMMS: the objective, what the AI asks, events, reports, a hint — three at most, the rest in the log. @see CommsDock */}
      <div className="absolute right-2 top-9 z-20 max-md:top-2">
        <CommsDock />
      </div>
      {/* WHAT WAS LOOKED AT, beside it: a water main's card. @see Anchored */}
      <LookedCard />
      <BuildBar className="absolute bottom-3 left-1/2 z-10 max-w-[calc(100%-1rem)] -translate-x-1/2 items-center" />
    </div>
  );
}

/** The card for what the Look tool last clicked, beside it on the map. */
function LookedCard() {
  const looked = useWorldStore((s) => s.lookedAt);
  const tool = useWorldStore((s) => s.tool);
  return <Anchored at={looked && tool === "inspect" ? looked : null}><MainInfo /></Anchored>;
}
