/**
 * World v2 — THE DATA CENTRE'S CONTROL ROOM, opened by clicking the Data
 * Centre: where the singularity stands; the throttle — how many of the
 * company's AI agents are running, every one earning and pushing the
 * singularity on; training runs; the racks; and what the AI is turning into.
 * @see runningAgents, singularityRate, game/training, game/traits
 */
import { twMerge } from "tailwind-merge";

import { agentBonus, agentsARack } from "../../game/agents";
import { DATASETS, TRAINING_SECONDS, dataset } from "../../game/training";
import { traitForecast } from "../../game/traits";
import { useGenerationStore } from "../../state/generation.store";
import { useInnovationStore } from "../../state/innovation.store";
import { useTrainingStore } from "../../state/training.store";
import { powered as rackPowered } from "../projects/racks";
import { allTanks, hotAgents } from "../projects/cooling";
import { pumpUpkeep } from "../../game/cooling";
import { useGeneratorStore } from "../../state/generators.store";
import { showMe } from "./map-focus";
import { useTicking } from "../../hooks/use-ticking";
import { runningAgents, useAgentsStore } from "../../state/agents.store";
import { singularityMult, singularityRate, stageOf, useAiSingularityStore } from "../../state/ai-singularity.store";
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
  const mult = singularityMult();
  // Nothing to sink from at nought.
  const rate = value <= 0 ? Math.max(0, singularityRate(running, mult, agents)) : singularityRate(running, mult, agents);
  const stage = stageOf(value);
  const boost = Math.round((agentBonus(running) - 1) * 100);
  return (
    <div className={twMerge(PANEL, "max-h-[70vh] w-[min(20rem,calc(100vw-1rem))] overflow-y-auto p-2 text-xs text-primary-900 dark:text-primary-100", className)}>
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

      <Cooling />
      <Training />
      <Roster />
      <Forecast />
    </div>
  );
}

const SECTION = "mt-3 border-t border-primary-200 pt-2 dark:border-primary-700";
const TITLE = "mb-1 text-[10px] font-bold uppercase tracking-wide text-primary-600 dark:text-primary-400";
const BTN = twMerge(
  "flex w-full cursor-pointer flex-col items-start border border-primary-400 px-2 py-1 text-left hover:bg-primary-200",
  "disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent dark:border-primary-600 dark:hover:bg-primary-800",
);

/**
 * COOLING: every building that drinks, how well it is cooled and what it
 * wants; how many agents are running hot for want of water; the pump houses
 * and what they cost to run. @see game/cooling
 */
function Cooling() {
  const grid = useWorldStore((s) => s.grid);
  const tanks = [...allTanks().entries()].map(([id, t]) => ({ id, t, s: grid.structures.get(id) })).filter((r) => r.s);
  if (!tanks.length) return null;
  const hot = Math.round(hotAgents());
  const pumps = [...grid.structures.values()].filter((s) => s.def === "pump" && !s.build).length;
  const upkeep = pumpUpkeep(useGeneratorStore.getState().getMoneyPerSecond());
  const name = (def: string) => ({ datacentre: "Data Centre", "ai-node": "AI node", "gpu-farm": "GPU farm", "compute-spire": "Compute spire" } as Record<string, string>)[def] ?? def;
  return (
    <div className={SECTION}>
      <p className={TITLE}>Cooling</p>
      {hot > 0 && (
        <p className="mb-1 text-amber-700 dark:text-amber-400">
          Running hot: {hot} agent{hot === 1 ? "" : "s"} at half power. Pipe water in from a river or lake with the Pipe tool.
        </p>
      )}
      <div className="flex max-h-32 flex-col overflow-y-auto">
        {tanks.map(({ id, t, s }) => (
          <button key={id} type="button" onClick={() => showMe({ x: s!.x, y: s!.y })}
            className="cursor-pointer px-1 py-0.5 text-left hover:bg-primary-200 dark:hover:bg-primary-800">
            <span className="flex justify-between gap-2">
              <span>{name(t.def)} · <span className={t.share > 0.95 ? "text-emerald-700 dark:text-emerald-400" : "text-amber-700 dark:text-amber-400"}>
                {Math.round(t.share * 100)}% cooled</span></span>
              <span className="tabular-nums">{t.demand.toFixed(2)} a second</span>
            </span>
            <span className="mt-0.5 block h-1 w-full overflow-hidden bg-primary-200 dark:bg-primary-800">
              <span className="block h-full bg-sky-600 dark:bg-sky-400" style={{ width: `${Math.min(100, (t.level / t.capacity) * 100)}%` }} />
            </span>
          </button>
        ))}
      </div>
      {pumps > 0 && (
        <p className="mt-1 tabular-nums text-primary-600 dark:text-primary-400">
          {pumps} pump house{pumps === 1 ? "" : "s"} · ${Math.round(upkeep).toLocaleString()} a second each while pumping
        </p>
      )}
    </div>
  );
}

/** TRAINING RUNS: one at a time, on a dataset, for innovation. @see game/training */
function Training() {
  const current = useTrainingStore((s) => s.current);
  const start = useTrainingStore((s) => s.start);
  useInnovationStore((s) => s.innovation);
  const blocked = useTrainingStore.getState().blocked();
  const cost = useTrainingStore.getState().cost();
  const on = dataset(current?.dataset);
  return (
    <div className={SECTION}>
      <p className={TITLE}>Training</p>
      {current && on ? (
        <>
          <p className="flex justify-between"><span>Training on <b>{on.name}</b></span><span className="tabular-nums">{clock(current.endsAt)}</span></p>
          <p className="text-emerald-700 dark:text-emerald-400">{on.boost}</p>
          <p className="italic text-primary-600 dark:text-primary-400">“{on.memo}”</p>
          <div className="mt-1 h-1 w-full overflow-hidden bg-primary-200 dark:bg-primary-800">
            <div className="h-full bg-violet-600 dark:bg-violet-400"
              style={{ width: `${Math.min(100, 100 - ((current.endsAt - Date.now()) / (TRAINING_SECONDS * 1000)) * 100)}%` }} />
          </div>
        </>
      ) : (
        <>
          <p className="mb-1 tabular-nums text-primary-600 dark:text-primary-400">
            {Math.round(TRAINING_SECONDS / 60)} minutes, {fmt(cost)} innovation · then the AI jumps
          </p>
          <div className="flex flex-col gap-1">
            {DATASETS.map((d) => (
              <button key={d.id} type="button" className={BTN} disabled={!!blocked} onClick={() => start(d.id)}
                title={blocked === "innovation" ? "Not enough innovation yet" : undefined}>
                <span className="flex w-full justify-between"><b>{d.name}</b><span className="tabular-nums text-violet-700 dark:text-violet-300">+{d.jump}%</span></span>
                <span className="text-primary-600 dark:text-primary-400">{d.boost}</span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

/** THE AGENT ROSTER: every rack, powered or not, and how many it runs; a click to look. */
function Roster() {
  const grid = useWorldStore((s) => s.grid);
  const racks = [...grid.structures.values()].filter((s) => s.def === "rack" && !s.build);
  if (!racks.length) return null;
  // The running agents fill the powered racks first. @see agentsAtWork
  let left = runningAgents();
  const rows = [...racks]
    .map((s) => ({ s, on: rackPowered(grid, s) }))
    .sort((a, b) => Number(b.on) - Number(a.on))
    .map((r) => { const n = Math.min(agentsARack(), left); left -= n; return { ...r, n }; });
  return (
    <div className={SECTION}>
      <p className={TITLE}>Racks</p>
      <div className="flex max-h-28 flex-col overflow-y-auto">
        {rows.map(({ s, on, n }, k) => (
          <button key={s.id} type="button" onClick={() => showMe({ x: s.x, y: s.y })}
            className="flex cursor-pointer justify-between px-1 py-0.5 text-left hover:bg-primary-200 dark:hover:bg-primary-800">
            <span>Rack {k + 1} · <span className={on ? "text-emerald-700 dark:text-emerald-400" : "text-amber-700 dark:text-amber-400"}>{on ? "powered" : "half power"}</span></span>
            <span className="tabular-nums">{n}/{agentsARack()} running</span>
          </button>
        ))}
      </div>
    </div>
  );
}

/** WHAT YOU ARE BREEDING: the likeliest traits at the Ascension, from the behaviour log. @see traitForecast */
function Forecast() {
  const log = useGenerationStore((s) => s.log);
  const forecast = traitForecast(log);
  return (
    <div className={SECTION}>
      <p className={TITLE}>Training log</p>
      {forecast.map(({ trait, odds }) => (
        <p key={trait.id} className="flex justify-between gap-2">
          <span title={trait.memo}><b>{trait.name}</b> <span className="italic text-primary-600 dark:text-primary-400">{trait.memo}</span></span>
          <span className="shrink-0 tabular-nums">{Math.round(odds * 100)}%</span>
        </p>
      ))}
    </div>
  );
}

const fmt = (n: number) => (n < 100 ? n.toFixed(n < 10 ? 2 : 1) : Math.round(n).toLocaleString());
/** Time left until a moment, m:ss. */
const clock = (at: number) => {
  const s = Math.max(0, Math.ceil((at - Date.now()) / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};
