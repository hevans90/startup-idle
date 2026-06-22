import { useState } from "react";
import { twMerge } from "tailwind-merge";
import { FOUNDERS } from "../game/founders.catalog";
import { useFounderStore } from "../state/founder.store";
import { Button } from "../ui/Button";

/**
 * Full-screen first-run takeover: pick a founder before the game (map, toolbar,
 * sidebar) appears. Selecting one applies its modifiers + starting cash and
 * flips `selectedFounderId`, after which `App` renders the normal game.
 */
export const FounderSelect = () => {
  const chooseFounder = useFounderStore((s) => s.chooseFounder);
  const [selected, setSelected] = useState<string | null>(null);

  return (
    <div className="flex h-full w-full flex-col items-center overflow-y-auto bg-primary-100 px-4 py-8 text-primary-900 dark:bg-primary-900 dark:text-primary-50">
      <h1 className="text-3xl font-bold sm:text-4xl">Startup Idle</h1>
      <p className="mt-2 mb-6 text-center text-sm opacity-70">
        Which type of shitlord tech bro are you?
      </p>

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
