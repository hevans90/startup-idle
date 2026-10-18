/**
 * THE AI AGENTS, on the Employees tab: how many are running against the room
 * the racks have, what the next costs in innovation, and a button to spin it
 * up. Shown once the Data Centre stands. @see game/agents
 */
import { twMerge } from "tailwind-merge";

import {
  AGENT_BOOST, RACK_RANGE, agentsARack, UNPOWERED_SHARE, agentBonus, agentCost, agentsAtWork, agentsOpen, rackRoom,
} from "../game/agents";
import { useTicking } from "../hooks/use-ticking";
import { agentTrade, runningAgents, useAgentsStore } from "../state/agents.store";
import { useInnovationStore } from "../state/innovation.store";
import { InfoPop } from "../ui/InfoPop";

const fmt = (n: number) => (n < 100 ? n.toFixed(n < 10 ? 2 : 1) : Math.round(n).toLocaleString());

/** Why the button is off, as the player reads it. */
const WHY = {
  "no-room": "Every rack is full: build another in Build's AI agents row.",
  innovation: "Not enough innovation yet.",
  closed: "The Data Centre has to stand first.",
  dark: "The racks are dark after the shutdown.",
} as const;

export function AgentsRow({ isMobile }: { isMobile: boolean }) {
  useTicking(500);
  const agents = useAgentsStore((s) => s.agents);
  const spinUp = useAgentsStore((s) => s.spinUp);
  const blocked = useAgentsStore((s) => s.blocked)();
  useInnovationStore((s) => s.innovation);
  if (!agentsOpen()) return null;
  const room = rackRoom();
  const cost = agentCost(agents);
  // THE ONES RUNNING: the Data Centre may have throttled some. @see runningAgents
  const running = runningAgents();
  const { powered, unpowered } = agentsAtWork(running);
  const boost = Math.round((agentBonus(running) - 1) * 100);
  // WHAT THE NEXT IS WORTH: what it adds, against what its innovation takes
  // off the innovation multiplier. @see agentTrade
  const trade = agentTrade(agents);
  const pct = (k: number) => `${k >= 1 ? "+" : "−"}${Math.abs((k - 1) * 100).toFixed(1)}%`;
  const roomText = (Number.isFinite(room) ? `${agents}/${room}` : `${agents}`) + (running < agents ? ` · ${running} on` : "");
  return (
    <div className={twMerge(
      "flex items-center justify-between gap-2 border-t border-primary-300 px-2 py-1 dark:border-primary-700",
      isMobile && "min-w-48 flex-col border px-3 py-2",
    )}>
      <InfoPop className="grow" placement="left"
        trigger={<span className="responsive-text-sm text-indigo-600 dark:text-indigo-300">AI agents</span>}
        title={`AI agents: income +${boost}%`}>
        <p>Each agent running at full power adds {Math.round(AGENT_BOOST * 100)}% to all income; they cost innovation, not money.</p>
        <p>They run in racks on the map, {agentsARack()} to a rack. A rack within {RACK_RANGE} tiles of the Data Centre is powered; further off, its agents work at {Math.round(UNPOWERED_SHARE * 100)}%.</p>
        <p className="tabular-nums">Running: {powered} powered{unpowered ? `, ${unpowered} at half power` : ""}.</p>
        <p className="tabular-nums">
          The next: {pct(trade.gain)} income from the agent, {pct(trade.loss)} from spending the innovation
          (innovation multiplies income too): <b className={trade.net >= 1 ? "text-emerald-700 dark:text-emerald-400" : "text-red-700 dark:text-red-400"}>{pct(trade.net)} in all</b>.
        </p>
      </InfoPop>
      <span className="w-1/4 text-center responsive-text-sm tabular-nums">{roomText}</span>
      <button type="button" disabled={!!blocked} onClick={() => spinUp()}
        title={blocked ? WHY[blocked] : undefined}
        className={twMerge(
          "w-1/2 cursor-pointer border border-primary-400 px-2 py-1 responsive-text-xs hover:bg-primary-200",
          "disabled:cursor-default disabled:opacity-50 disabled:hover:bg-transparent dark:border-primary-600 dark:hover:bg-primary-800",
        )}>
        Spin up: {fmt(cost)} innovation
        {!blocked && <span className={trade.net >= 1 ? "text-emerald-700 dark:text-emerald-400" : "text-red-700 dark:text-red-400"}> ({pct(trade.net)})</span>}
      </button>
    </div>
  );
}
