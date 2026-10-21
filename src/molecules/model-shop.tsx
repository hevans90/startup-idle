/**
 * THE MODEL'S SHOP: the second prestige's spending, between companies — on
 * the founder screen, before a run starts. Which generation this is, the
 * Weights to spend — in the Machine, the skill tree's AI cluster — the
 * founders fused with the AI, and the generations past. @see game/ascension, game/machine
 */
import { FOUNDERS } from "../game/founders.catalog";
import { FUSIONS } from "../game/fusion";
import { machineGraph } from "../game/machine";
import { trait } from "../game/traits";
import { useGenerationStore } from "../state/generation.store";

const MACHINE_SIZE = machineGraph().nodes.length;

const SECTION = "border-t border-primary-300 p-2 dark:border-primary-700";
const TITLE = "mb-1 text-[10px] font-bold uppercase tracking-wide text-primary-600 dark:text-primary-400";

export function ModelShop({ onOpenTree }: { onOpenTree?: () => void }) {
  const g = useGenerationStore();
  const owned = g.machine.length;
  const founderName = (id: string) => FOUNDERS.find((f) => f.id === id)?.name ?? id;
  return (
    <div className="flex flex-col text-xs text-primary-900 dark:text-primary-100">
      <div className="flex items-baseline justify-between p-2">
        <p className="text-sm font-bold">Generation {g.generation}</p>
        <p className="tabular-nums"><b className="text-violet-700 dark:text-violet-300">{g.weights}</b> Weights</p>
      </div>

      {/* THE MACHINE: where Weights go — the skill tree's AI cluster. @see game/machine */}
      <div className={SECTION}>
        <p className={TITLE}>The Machine · {owned} of {MACHINE_SIZE} nodes</p>
        <p className="text-primary-600 dark:text-primary-400">
          {g.generation > 1
            ? "Spend Weights in the Machine: the AI's own cluster of the skill tree, below the rest. A ring more of it shows each Ascension."
            : "The Machine, the AI's own cluster of the skill tree, opens at the first Ascension."}
        </p>
        {onOpenTree && (
          <button type="button" onClick={onOpenTree}
            className="mt-1 cursor-pointer border border-primary-400 px-2 py-0.5 hover:bg-primary-200 dark:border-primary-600 dark:hover:bg-primary-800">
            Open the skill tree
          </button>
        )}
      </div>

      {/* THE FOUNDERS FUSED WITH THE AI. */}
      {Object.keys(g.fused).length > 0 && (
        <div className={SECTION}>
          <p className={TITLE}>Fused founders</p>
          {Object.entries(g.fused).map(([f, traits]) => (
            <div key={f} className="mb-1">
              <p className="font-bold">{founderName(f)}</p>
              {traits.map((t, k) => <p key={k}><span className="text-violet-700 dark:text-violet-300">{trait(t).name}</span>: {FUSIONS[t].text}</p>)}
            </div>
          ))}
        </div>
      )}

      {/* THE GENERATIONS PAST. */}
      {g.past.length > 0 && (
        <div className={SECTION}>
          <p className={TITLE}>Generations</p>
          {[...g.past].reverse().map((p) => (
            <p key={p.generation} className="flex justify-between gap-2">
              <span>{p.generation}. <b>{trait(p.trait).name}</b>{p.mutated ? " (mutated)" : ""} → {founderName(p.founder)}</span>
              <span className="tabular-nums">+{p.weights}</span>
            </p>
          ))}
        </div>
      )}
    </div>
  );
}
