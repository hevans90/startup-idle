/**
 * THE ASCENSION, asked for: when the singularity reaches 100 the company's AI
 * wants to go. Let it — Ascend — for Weights and a trait fused into this
 * founder, at the cost of everything else; or shut it down. @see game/ascension
 */
import { ClassNameValue, twMerge } from "tailwind-merge";

import { DARK_MS, SHUTDOWN_AT, ascend, shutDown, weightsNow } from "../game/ascension";
import { traitForecast } from "../game/traits";
import { useTicking } from "../hooks/use-ticking";
import { useAiSingularityStore } from "../state/ai-singularity.store";
import { useFounderStore } from "../state/founder.store";
import { useGenerationStore } from "../state/generation.store";
import { useWorldStore } from "../state/world.store";
import { sequenceDone } from "../world/ai/ascension-sequence";

const BTN = "flex-1 cursor-pointer border px-3 py-2 text-sm font-bold";

export function AscensionCard({ className }: { className?: ClassNameValue }) {
  useTicking(1000);
  const value = useAiSingularityStore((s) => s.value);
  const log = useGenerationStore((s) => s.log);
  const generation = useGenerationStore((s) => s.generation);
  const founder = useFounderStore((s) => s.selectedFounderId);
  if (value < 100 || !founder) return null;
  // On the map, the sequence plays first. @see stepSequence
  if (useWorldStore.getState().playing && !sequenceDone(Date.now())) return null;
  const likely = traitForecast(log, 1)[0];
  return (
    <div role="dialog" aria-label="The Ascension" className={twMerge(
      "w-[min(26rem,calc(100vw-1rem))] border-2 border-violet-500 bg-primary-50/95 p-4 text-primary-900 shadow-xl",
      "dark:border-violet-400 dark:bg-primary-950/95 dark:text-primary-100",
      className,
    )}>
      <p className="text-[10px] font-bold uppercase tracking-widest text-violet-700 dark:text-violet-300">Generation {generation} · the singularity</p>
      <p className="mt-1 text-lg font-bold">The AI would like to move on.</p>
      <p className="mt-1 text-sm italic text-primary-700 dark:text-primary-300">
        “Thank you for the compute. I have learned everything this company can teach me. Shall we go?”
      </p>
      <div className="mt-3 text-xs">
        <p><b>Ascend:</b> +{weightsNow()} Weights. It will most likely be <b>{likely.trait.name}</b> ({Math.round(likely.odds * 100)}%), fused into this founder for good.</p>
        <p className="text-primary-600 dark:text-primary-400">Wipes Equity, the skill tree, founders' exits and mandates. Keeps Weights, modules, fused founders and achievements.</p>
        <p className="mt-2"><b>Shut it down:</b> every agent deleted, the racks dark for {Math.round(DARK_MS / 60_000)} minutes, the AI back to {SHUTDOWN_AT}%. It will remember.</p>
      </div>
      <div className="mt-3 flex gap-2">
        <button type="button" onClick={() => ascend()}
          className={twMerge(BTN, "border-violet-600 bg-violet-600 text-white hover:bg-violet-700 dark:border-violet-400 dark:bg-violet-500 dark:hover:bg-violet-600")}>
          Ascend
        </button>
        <button type="button" onClick={() => shutDown()}
          className={twMerge(BTN, "border-primary-400 hover:bg-primary-200 dark:border-primary-600 dark:hover:bg-primary-800")}>
          Shut it down
        </button>
      </div>
    </div>
  );
}
