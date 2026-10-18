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
import { AiReport } from "./ai-report";
import { AiMemos } from "./ai-memos";
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
import { HintCard } from "./hint-card";
import { EventCards, EventMarkers } from "./event-cards";
import { LeaderTags } from "./leader-tags";
// The stores on `window` in development, as the editor has them. @see expose-store
import "../debug/expose-store";

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
  useEffect(() => useWorldStore.subscribe((st, was) => {
    if (!st.lookedAt || st.lookedAt === was.lookedAt) return;
    const s = structureOf(st.grid, st.lookedAt.x, st.lookedAt.y);
    const p = s && !s.build ? projectForStructure(s.def) : null;
    // THE DATA CENTRE opens its control room, on the map. @see DataCentrePanel
    if (p?.id === "datacentre") st.setDataCentreOpen(true);
    if (p?.opens) useGlobalSettingsStore.getState().setSidebarTab(p.opens);
  }), []);
  return (
    <div ref={setRef} className="@container absolute inset-0 min-h-0 bg-primary-900">
      <WorldCanvas wrapperRef={wrapperRef} size={size} />
      <BuildingLabels />
      <DesireReadout />
      <PortIncome />
      <TopStreets className="absolute bottom-24 right-2 z-10" />
      <ProjectsPanel className="absolute left-2 top-24 z-10 max-md:top-2 max-md:max-w-[calc(100%-1rem)]" />
      <EventMarkers />
      <LeaderTags />
      <div className="absolute left-[19.5rem] right-2 top-14 z-20 flex flex-col items-start gap-2 max-md:left-2 max-md:top-auto max-md:bottom-28"><HintCard /><AiReport /><AiMemos /><EventCards /></div>
      <BuildBar className="absolute bottom-3 left-1/2 z-10 max-w-[calc(100%-1rem)] -translate-x-1/2 items-center" />
    </div>
  );
}
