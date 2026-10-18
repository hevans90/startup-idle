/**
 * World v2 — THE DATA CENTRE'S CONTROL ROOM, opened by clicking the Data
 * Centre: where the singularity stands, and the throttle — how many of the
 * company's AI agents are running. Every one running earns, and every one
 * pushes the singularity on. @see runningAgents, singularityRate
 */
import { twMerge } from "tailwind-merge";

import { agentBonus } from "../../game/agents";
import { useTicking } from "../../hooks/use-ticking";
import { runningAgents, useAgentsStore } from "../../state/agents.store";
import { singularityRate, stageOf, useAiSingularityStore } from "../../state/ai-singularity.store";
import { usePrestigeStore } from "../../state/prestige.store";
import { useWorldStore } from "../../state/world.store";

const PANEL = "border border-primary-300 bg-primary-50/95 shadow-md dark:border-primary-700 dark:bg-primary-900/95";

/** A rate a second as so much a minute, signed. */
const perMinute = (r: number) => `${r >= 0 ? "+" : "−"}${Math.abs(r * 60).toFixed(2)} a minute`;

export function DataCentrePanel({ className }: { className?: string }) {
  useTicking(500);
  const open = useWorldStore((s) => s.dataCentreOpen);
  const setOpen = useWorldStore((s) => s.setDataCentreOpen);
  const agents = useAgentsStore((s) => s.agents);
  const setRunning = useAgentsStore((s) => s.setRunning);
  const value = useAiSingularityStore((s) => s.value);
  if (!open) return null;
  const running = runningAgents();
  const mult = usePrestigeStore.getState().modifiers.singularityMult;
  // Nothing to sink from at nought.
  const rate = value <= 0 ? Math.max(0, singularityRate(running, mult)) : singularityRate(running, mult);
  const stage = stageOf(value);
  const boost = Math.round((agentBonus(running) - 1) * 100);
  return (
    <div className={twMerge(PANEL, "w-[min(20rem,calc(100vw-1rem))] p-2 text-xs text-primary-900 dark:text-primary-100", className)}>
      <div className="mb-1 flex items-baseline justify-between">
        <b className="text-[10px] uppercase tracking-wide text-primary-600 dark:text-primary-400">Data Centre</b>
        <button type="button" onClick={() => setOpen(false)}
          className="cursor-pointer px-1 text-primary-500 hover:text-primary-900 dark:hover:text-primary-100" aria-label="Close">✕</button>
      </div>

      {/* THE SINGULARITY: its stage, how far, and which way. */}
      <p className="flex justify-between tabular-nums">
        <span>AI: <b className="text-violet-700 dark:text-violet-300">{stage.name}</b></span>
        <span>{value.toFixed(1)}% · {perMinute(rate)}</span>
      </p>
      <div className="mt-1 h-1.5 w-full overflow-hidden bg-primary-200 dark:bg-primary-800">
        <div className="h-full bg-violet-600 dark:bg-violet-400" style={{ width: `${Math.min(100, value)}%` }} />
      </div>

      {/* THE THROTTLE. */}
      <div className="mt-3 border-t border-primary-200 pt-2 dark:border-primary-700">
        {agents > 0 ? (
          <>
            <label className="flex justify-between tabular-nums" htmlFor="dc-throttle">
              <span>Agents running</span><b>{running} of {agents}</b>
            </label>
            <input id="dc-throttle" type="range" min={0} max={agents} step={1} value={running}
              onChange={(e) => setRunning(Number(e.target.value))}
              className="mt-1 w-full accent-violet-600 dark:accent-violet-400" />
            <p className="tabular-nums text-primary-600 dark:text-primary-400">
              Income +{boost}% from them · the AI {perMinute(rate)}
            </p>
          </>
        ) : (
          <p className="text-primary-600 dark:text-primary-400">No AI agents yet: spin them up on the Employees tab.</p>
        )}
      </div>
    </div>
  );
}
