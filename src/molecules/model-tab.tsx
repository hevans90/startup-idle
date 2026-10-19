/**
 * THE MODEL TAB: the second prestige, between Ascensions. Which generation
 * this is, the Weights to spend, the slots and the modules for them, the
 * founders fused with the AI, and the generations past.
 * @see game/ascension, game/modules
 */
import { twMerge } from "tailwind-merge";

import { FOUNDERS } from "../game/founders.catalog";
import { FUSIONS } from "../game/fusion";
import { MODULES, buyModule, toggleSlot } from "../game/modules";
import { trait } from "../game/traits";
import { slotCount, useGenerationStore } from "../state/generation.store";

const SECTION = "border-t border-primary-300 p-2 dark:border-primary-700";
const TITLE = "mb-1 text-[10px] font-bold uppercase tracking-wide text-primary-600 dark:text-primary-400";

export function ModelTab() {
  const g = useGenerationStore();
  const slots = slotCount();
  const founderName = (id: string) => FOUNDERS.find((f) => f.id === id)?.name ?? id;
  return (
    <div className="flex flex-col text-xs text-primary-900 dark:text-primary-100">
      <div className="flex items-baseline justify-between p-2">
        <p className="text-sm font-bold">Generation {g.generation}</p>
        <p className="tabular-nums"><b className="text-violet-700 dark:text-violet-300">{g.weights}</b> Weights</p>
      </div>

      {/* THE SLOTS: one an Ascension. */}
      <div className={SECTION}>
        <p className={TITLE}>Slots · {g.slotted.length}/{slots}</p>
        {slots === 0 && <p className="text-primary-600 dark:text-primary-400">The first slot opens at the first Ascension.</p>}
        <div className="flex flex-col gap-1">
          {MODULES.map((m) => {
            const level = g.modules[m.id] ?? 0;
            const on = g.slotted.includes(m.id);
            const next = level < 3 ? m.costs[level] : null;
            return (
              <div key={m.id} className={twMerge("border px-2 py-1", on ? "border-violet-500 bg-violet-500/10" : "border-primary-300 dark:border-primary-700")}>
                <p className="flex justify-between"><b>{m.name}</b><span className="tabular-nums">{"●".repeat(level)}{"○".repeat(3 - level)}</span></p>
                <p className="text-primary-600 dark:text-primary-400">{level ? m.levels[level - 1] : m.levels[0]}</p>
                <div className="mt-1 flex gap-1">
                  {next !== null && (
                    <button type="button" disabled={g.weights < next} onClick={() => buyModule(m.id)}
                      className="cursor-pointer border border-primary-400 px-2 py-0.5 hover:bg-primary-200 disabled:cursor-default disabled:opacity-40 dark:border-primary-600 dark:hover:bg-primary-800">
                      {level ? "Upgrade" : "Buy"}: {next} Weights
                    </button>
                  )}
                  {level > 0 && (
                    <button type="button" disabled={!on && g.slotted.length >= slots} onClick={() => toggleSlot(m.id, slots)}
                      className="cursor-pointer border border-primary-400 px-2 py-0.5 hover:bg-primary-200 disabled:cursor-default disabled:opacity-40 dark:border-primary-600 dark:hover:bg-primary-800">
                      {on ? "Take out" : "Slot in"}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
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
