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

export function AiTab() {
  const g = useGenerationStore();
  const slotted = MODULES.filter((m) => g.slotted.includes(m.id));
  return (
    <div className="flex flex-col text-xs text-primary-900 dark:text-primary-100">
      <div className="flex items-baseline justify-between gap-2 border-b border-primary-300 p-2 dark:border-primary-700">
        <p className="text-sm font-bold">Generation {g.generation}</p>
        <p className="tabular-nums" title="Spent on modules between companies, on the founder screen">
          <b className="text-violet-700 dark:text-violet-300">{g.weights}</b> Weights
        </p>
      </div>
      {slotted.length > 0 && (
        <p className="border-b border-primary-300 px-2 py-1 text-primary-600 dark:border-primary-700 dark:text-primary-400">
          Slotted: {slotted.map((m) => `${m.name} ${g.modules[m.id] ?? 0}`).join(" · ")}
        </p>
      )}
      <DataCentre />
    </div>
  );
}
