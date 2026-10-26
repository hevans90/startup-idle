/**
 * THE AI TAB: the company's AI, during a run — which generation it is, the
 * Weights banked and the modules slotted (spent between companies, on the
 * founder screen), and the Data Centre's control room: the singularity, the
 * throttle, cooling, training, the racks and the training log. Clicking the
 * Data Centre on the map opens it. @see DataCentre, ModelShop
 */
import { useRef } from "react";

import { MODULES } from "../game/modules";
import { useGenerationStore } from "../state/generation.store";
import { DataCentre } from "../world/play/datacentre-panel";
import { QuestDossier } from "../quest-ui/arc";
import { stageOf, useAiSingularityStore } from "../state/ai-singularity.store";
import { Stat, StatGrid, useTakeoverGlitch } from "../ui/console";

export function AiTab() {
  const g = useGenerationStore();
  const slotted = MODULES.filter((m) => g.slotted.includes(m.id));
  // ITS OWN TAB, torn as the takeover goes on. @see useTakeoverGlitch
  const box = useRef<HTMLDivElement>(null);
  useTakeoverGlitch(box);
  const value = useAiSingularityStore((s) => s.value);
  const stage = stageOf(value);
  return (
    <div ref={box} className="flex flex-col gap-3 p-2 text-xs text-fg">
      <StatGrid>
        <Stat label="Generation" value={g.generation} />
        <Stat label="Weights" value={g.weights} role="weights" title="Spent on modules between companies, on the founder screen" />
        <Stat label="Stage" value={stage.name} role="ai" sub={`${value.toFixed(1)}%`} />
      </StatGrid>
      {slotted.length > 0 && (
        <p className="text-fg-muted">
          Slotted: {slotted.map((m) => `${m.name} ${g.modules[m.id] ?? 0}`).join(" · ")}
        </p>
      )}
      {/* THE ARC at a glance. @see Dossier */}
      <QuestDossier />
      <DataCentre />
    </div>
  );
}
