import { useState } from "react";
import { twMerge } from "tailwind-merge";
import { FOUNDERS } from "../game/founders.catalog";
import { useFounderStore } from "../state/founder.store";
import { usePrestigeStore } from "../state/prestige.store";
import { Button } from "../ui/Button";
import { formatCurrency } from "../utils/money-utils";
import { SkillTreeOverlay } from "./skill-tree/skill-tree-overlay";

/**
 * Full-screen first-run takeover: pick a founder before the game (map, toolbar,
 * sidebar) appears. Selecting one applies its modifiers + starting cash and
 * flips `selectedFounderId`, after which `App` renders the normal game.
 */
export const FounderSelect = () => {
  const chooseFounder = useFounderStore((s) => s.chooseFounder);
  const [selected, setSelected] = useState<string | null>(null);

  const equity = usePrestigeStore((s) => s.equity);
  const exits = usePrestigeStore((s) => s.exits);
  const [treeOpen, setTreeOpen] = useState(false);
  // Show the prestige controls only once you've been acquired at least once
  // (keeps the very first run's screen clean). Glow when there's Equity to spend.
  const showPrestige = exits > 0 || equity.gt(0);
  const hasPoints = equity.gt(0);

  return (
    <div className="flex h-full w-full flex-col items-center overflow-y-auto bg-primary-100 px-4 py-8 text-primary-900 dark:bg-primary-900 dark:text-primary-50">
      <h1 className="text-3xl font-bold sm:text-4xl">Startup Idle</h1>
      <p className="mt-2 text-center text-sm opacity-70">
        Which type of shitlord tech bro are you?
      </p>

      {showPrestige && (
        <div className="mt-4 mb-2 flex items-center gap-4 rounded-lg border border-primary-300 bg-primary-200/60 px-4 py-2 dark:border-primary-700 dark:bg-primary-800/60">
          <div className="text-sm tabular-nums">
            <span className="opacity-60">Equity</span>{" "}
            <span className="font-bold text-amber-600 dark:text-amber-400">
              {formatCurrency(equity, { showDollarSign: false })}
            </span>
            <span className="ml-3 opacity-60">Exits {exits}</span>
          </div>
          <Button
            type="button"
            onClick={() => setTreeOpen(true)}
            className={twMerge(
              "text-sm transition-shadow",
              hasPoints &&
                "animate-pulse ring-2 ring-amber-400 shadow-[0_0_18px_3px_rgba(251,191,36,0.6)]",
            )}
          >
            {hasPoints ? "Spend Equity →" : "Acquisition tree"}
          </Button>
        </div>
      )}

      <div className="mb-6" />

      {treeOpen && <SkillTreeOverlay onClose={() => setTreeOpen(false)} />}

      <div className="grid w-full max-w-5xl grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {FOUNDERS.map((f) => {
          const Icon = f.icon;
          const isSel = selected === f.id;
          return (
            <button
              key={f.id}
              type="button"
              onClick={() => setSelected(f.id)}
              className={twMerge(
                "flex cursor-pointer flex-col gap-2 rounded-lg border-2 p-4 text-left transition-colors",
                isSel
                  ? "border-emerald-500 bg-emerald-500/10"
                  : "border-primary-300 hover:border-primary-400 dark:border-primary-700 dark:hover:border-primary-500",
              )}
            >
              <div className="flex items-center gap-2">
                <Icon size={28} stroke={1.6} className="shrink-0" />
                <div className="min-w-0">
                  <div className="font-bold leading-tight">{f.name}</div>
                  <div className="text-xs italic opacity-70">{f.tagline}</div>
                </div>
              </div>
              <ul className="flex flex-col gap-1 text-xs tabular-nums opacity-90">
                {f.perks.map((p, i) => (
                  <li key={i}>• {p}</li>
                ))}
              </ul>
              <div className="mt-auto border-t border-primary-300 pt-2 text-xs font-semibold tabular-nums text-emerald-700 dark:border-primary-700 dark:text-emerald-400">
                Starts with ${f.startingCash}
              </div>
            </button>
          );
        })}
      </div>

      <Button
        type="button"
        disabled={selected == null}
        className="mt-8 px-6 py-3 text-base font-bold disabled:opacity-40"
        onClick={() => selected && chooseFounder(selected)}
      >
        Found your startup →
      </Button>
    </div>
  );
};
