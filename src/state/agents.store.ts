/**
 * THE AI AGENTS RUNNING, and spinning up another. Kept with the run: a sale
 * starts the next company with none. @see game/agents
 */
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { agentBonus, agentCost, agentsOpen, rackRoom } from "../game/agents";
import { useFounderStore } from "./founder.store";
import { useInnovationStore } from "./innovation.store";

/**
 * WHAT THE NEXT AGENT IS WORTH, as factors on income: what it adds, and what
 * spending its price in innovation takes off — innovation is itself a
 * multiplier on everything, `1 + log10(innovation + 1)`, so an agent bought
 * with the last of it can cost more than it gives. Their product is the
 * trade: above one, the agent is worth it. @see getMultiplier
 */
export function agentTrade(agents: number): { gain: number; loss: number; net: number } {
  const gain = agentBonus(agents + 1) / agentBonus(agents);  // `agents` is the running count. @see runningAgents
  const have = useInnovationStore.getState().innovation.toNumber();
  const logMult = useFounderStore.getState().innovationLogMult;
  const mult = (x: number) => 1 + logMult * Math.log10(Math.max(0, x) + 1);
  const loss = mult(have - agentCost(agents)) / mult(have);
  return { gain, loss, net: gain * loss };
}

type AgentsState = {
  agents: number;
  /**
   * THE THROTTLE: how many of them are running, or null for all of them. An
   * agent not running earns nothing and pushes the singularity not at all.
   * Set at the Data Centre. @see runningAgents, DataCentrePanel
   */
  running: number | null;
  setRunning: (n: number | null) => void;
  /** Why another cannot be spun up now, or null if it can. */
  blocked: () => "closed" | "no-room" | "innovation" | null;
  /** Spin up one more, for its price in innovation. Whether it happened. */
  spinUp: () => boolean;
  reset: () => void;
};

export const useAgentsStore = create<AgentsState>()(
  persist(
    (set, get) => ({
      agents: 0,
      blocked: () => {
        if (!agentsOpen()) return "closed";
        if (get().agents >= rackRoom()) return "no-room";
        if (useInnovationStore.getState().innovation.lt(agentCost(get().agents))) return "innovation";
        return null;
      },
      spinUp: () => {
        if (get().blocked()) return false;
        useInnovationStore.getState().spendInnovation(agentCost(get().agents));
        set((s) => ({ agents: s.agents + 1 }));
        return true;
      },
      running: null,
      setRunning: (n) => set((s) => ({ running: n === null || n >= s.agents ? null : Math.max(0, Math.floor(n)) })),
      reset: () => set({ agents: 0, running: null }),
    }),
    {
      name: "agents",
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({ agents: s.agents, running: s.running }),
    },
  ),
);

/** The agents running now: all of them, unless the Data Centre has throttled some. */
export function runningAgents(): number {
  const { agents, running } = useAgentsStore.getState();
  return running === null ? agents : Math.min(running, agents);
}
