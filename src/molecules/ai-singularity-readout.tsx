import { useEffect, useRef } from "react";
import { ClassNameValue, twMerge } from "tailwind-merge";

import { useTicking } from "../hooks/use-ticking";
import { runningAgents, useAgentsStore } from "../state/agents.store";
import { singularityMult, singularityRate, stageOf, useAiSingularityStore } from "../state/ai-singularity.store";
import { useGlobalSettingsStore } from "../state/global-settings.store";
import { FOCUS, Meter, useTakeoverGlitch } from "../ui/console";

/**
 * THE SINGULARITY, in the HUD: its stage and how far through, which way it is
 * going, in the AI's violet; a click opens the AI tab. Shown once there is
 * anything to show — an agent spun up, or the meter carried over from the
 * last company. @see useAiSingularityStore, plans/ui-overhaul.md §3.1
 */
export const AiSingularityReadout = ({ className }: { className?: ClassNameValue }) => {
  useTicking(1000);
  const value = useAiSingularityStore((s) => s.value);
  const agents = useAgentsStore((s) => s.agents);
  const setTab = useGlobalSettingsStore((s) => s.setSidebarTab);
  // TORN as the takeover goes on, and hard as it crosses into a new stage. @see useTakeoverGlitch
  const box = useRef<HTMLButtonElement>(null);
  const kick = useTakeoverGlitch(box);
  const now = stageOf(Math.min(100, Math.max(0, value))).stage;
  const was = useRef(now);
  useEffect(() => {
    if (was.current !== now) kick({ strength: 1.4, burst: 0.6 });
    was.current = now;
  }, [now, kick]);
  const pct = Math.min(100, Math.max(0, value));
  if (pct <= 0 && agents <= 0) return null;
  const rate = singularityRate(runningAgents(), singularityMult(), agents);
  const stage = stageOf(pct);
  return (
    <button ref={box} type="button" onClick={() => setTab("ai")} title="The AI: open its tab" className={twMerge("w-44 shrink-0 cursor-pointer flex-col justify-center text-left hover:bg-surface-2", FOCUS, className)}>
      <Meter tone="ai" value={pct / 100} label={`AI · ${stage.name}`}
        detail={<>{pct.toFixed(1)}% <span className={rate > 0 ? "text-ai" : "text-fg-faint"}>{rate > 0 ? "▲" : pct > 0 ? "▼" : ""}</span></>} />
    </button>
  );
};
