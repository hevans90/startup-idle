/**
 * THE AI TAB: the company's AI, during a run — which generation it is, the
 * Weights banked and the modules slotted (spent between companies, on the
 * founder screen), and the Data Centre's control room: the singularity, the
 * throttle, cooling, training, the racks and the training log. Clicking the
 * Data Centre on the map opens it. @see DataCentre, ModelShop
 */
import { MODULES } from "../game/modules";
import { useGenerationStore } from "../state/generation.store";
import { DataCentre } from "../world/play/datacentre-panel";
import { QuestDossier } from "../quest-ui/arc";

export function AiTab() {
  const g = useGenerationStore();
  const slotted = MODULES.filter((m) => g.slotted.includes(m.id));
  return (
    <div className="flex flex-col text-xs text-fg">
      <div className="flex items-baseline justify-between gap-2 border-b border-line-quiet p-2">
        <p className="font-display text-sm uppercase tracking-wider">Generation {g.generation}</p>
        <p className="tabular-nums" title="Spent on modules between companies, on the founder screen">
          <b className="text-weights">{g.weights}</b> Weights
        </p>
      </div>
      {slotted.length > 0 && (
        <p className="border-b border-line-quiet px-2 py-1 text-fg-muted">
          Slotted: {slotted.map((m) => `${m.name} ${g.modules[m.id] ?? 0}`).join(" · ")}
        </p>
      )}
      {/* THE ARC at a glance. @see Dossier */}
      <QuestDossier />
      <DataCentre />
    </div>
  );
}
