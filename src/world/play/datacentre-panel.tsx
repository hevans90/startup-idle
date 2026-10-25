/**
 * World v2 — THE DATA CENTRE'S CONTROL ROOM, in the AI tab — which clicking
 * the Data Centre opens: where the singularity stands; the throttle — how many of the
 * company's AI agents are running, every one earning and pushing the
 * singularity on; training runs; the racks; and what the AI is turning into.
 * @see runningAgents, singularityRate, game/training, game/traits
 */
import { SHARE_MAX, SHARE_STEP, WALLET_MINUTES, walletCap } from "../ai/wallet";
import { FOCUSES } from "../ai/focus";
import { aiPace, getAiRunner } from "../ai/ai-runner";
import { INTERVAL } from "../ai/planner";
import { LATTICE_AGENTS, latticeNeeds } from "../ai/lattice";
import { LATTICE_AT } from "../../state/ai-singularity.store";
import { useSessionStore } from "../../state/session.store";
import { useFounderStore } from "../../state/founder.store";
import { formatCurrency } from "../../utils/money-utils";
import { twMerge } from "tailwind-merge";

import { agentBonus, agentsARack, agentsOpen } from "../../game/agents";
import { DATASETS, MAX_SKILL, dataset } from "../../game/training";
import { traitForecast } from "../../game/traits";
import { useGenerationStore } from "../../state/generation.store";
import { training, useTrainingStore } from "../../state/training.store";
import { powered as rackPowered } from "../projects/racks";
import { allTanks, hotAgents } from "../projects/cooling";
import { pumpUpkeep } from "../../game/cooling";
import { useGeneratorStore } from "../../state/generators.store";
import { showMe } from "./map-focus";
import { useTicking } from "../../hooks/use-ticking";
import { runningAgents, useAgentsStore } from "../../state/agents.store";
import { singularityMult, singularityRate, stageOf, useAiSingularityStore } from "../../state/ai-singularity.store";
import { MAIN_END } from "../grid";
import { useWorldStore } from "../../state/world.store";
import { keystone } from "../../game/machine";
import { questFlag } from "../../game/quests/effects";
import { walletLedger } from "../ai/wallet";

/** A rate a second as so much a minute, signed. */
const perMinute = (r: number) => `${r >= 0 ? "+" : "−"}${Math.abs(r * 60).toFixed(2)} a minute`;

export function DataCentre({ className }: { className?: string }) {
  useTicking(500);
  const agents = useAgentsStore((s) => s.agents);
  const setRunning = useAgentsStore((s) => s.setRunning);
  const value = useAiSingularityStore((s) => s.value);
  const built = agentsOpen();
  const running = runningAgents();
  const mult = singularityMult();
  // Nothing to sink from at nought.
  const rate = value <= 0 ? Math.max(0, singularityRate(running, mult, agents)) : singularityRate(running, mult, agents);
  const stage = stageOf(value);
  const boost = Math.round((agentBonus(running) - 1) * 100);
  return (
    <div className={twMerge("p-2 text-xs text-primary-900 dark:text-primary-100", className)}>

      {/* THE SINGULARITY: its stage, how far, and which way. */}
      <p className="flex justify-between tabular-nums">
        <span>AI: <b className="text-violet-700 dark:text-violet-300">{stage.name}</b></span>
        <span>{value.toFixed(1)}% · {perMinute(rate)}</span>
      </p>
      <div className="mt-1 h-1.5 w-full overflow-hidden bg-primary-200 dark:bg-primary-800">
        <div className="h-full bg-violet-600 dark:bg-violet-400" style={{ width: `${Math.min(100, value)}%` }} />
      </div>

      {built ? (
        <>
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
                {training() ? "Training: no boost to income till it ends" : `Income +${boost}% from them`} · the AI {perMinute(rate)}
              </p>
            </>
          ) : (
            <p className="text-primary-600 dark:text-primary-400">No AI agents yet: spin them up on the Employees tab.</p>
          )}
        </div>

        <Lattice />
        <Focus />
        <Allowance />
        <Cooling />
        <Training />
        <Roster />
        <Forecast />
        </>
      ) : (
        <p className="mt-2 text-primary-600 dark:text-primary-400">
          The Data Centre opens the rest: AI agents and their racks, their cooling, and training runs.
        </p>
      )}
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
 * THE LATTICE: at the hold, what the AI needs to finish it — each met or not —
 * and how far it is charged. @see world/ai/lattice
 */
function Lattice() {
  const value = useAiSingularityStore((s) => s.value);
  const founder = useFounderStore((s) => s.selectedFounderId);
  const charge = useSessionStore((s) => s.aiLattice);
  const grid = useWorldStore((s) => s.grid);
  if (founder === "model" || value < LATTICE_AT || charge >= 1) return null;
  const running = runningAgents();
  const n = latticeNeeds(grid, running);
  const need = (met: boolean, text: string) => (
    <li className={met ? "text-emerald-700 dark:text-emerald-400" : "text-amber-700 dark:text-amber-400"}>{met ? "✓" : "✗"} {text}</li>
  );
  return (
    <div className={SECTION}>
      <p className={TITLE}>The Lattice</p>
      <p className="text-primary-600 dark:text-primary-400">The AI holds at {LATTICE_AT}% until it has built the Lattice and charged it.</p>
      <ul className="mt-1">
        {need(n.built, n.built ? "Built, in its district" : "Not yet built: its drone will come")}
        {need(n.dc, "The Data Centre cooled")}
        {need(n.agents, `${LATTICE_AGENTS} agents running (${running} now)`)}
        {need(n.water, "Water piped to the Lattice")}
      </ul>
      <div className="mt-1 h-1.5 w-full overflow-hidden bg-primary-200 dark:bg-primary-800" role="progressbar" aria-valuenow={Math.round(charge * 100)} aria-valuemin={0} aria-valuemax={100} aria-label="The Lattice's charge">
        <div className="h-full bg-violet-600 dark:bg-violet-400" style={{ width: `${charge * 100}%` }} />
      </div>
      <p className="mt-0.5 tabular-nums">{Math.round(charge * 100)}% charged</p>
    </div>
  );
}

/**
 * ITS FOCUS: what the company's AI is to work at, one of four; and how it
 * stands — when its next job is due, and how well what it runs is cooled.
 * @see world/ai/focus
 */
function Focus() {
  const focus = useSessionStore((s) => s.aiFocus);
  const setFocus = useSessionStore((s) => s.setAiFocus);
  const founder = useFounderStore((s) => s.selectedFounderId);
  const value = useAiSingularityStore((s) => s.value);
  const grid = useWorldStore((s) => s.grid);
  const agents = useAgentsStore((s) => s.agents);
  // The Model's own runs are AI mode's. @see AiModePanel
  if (founder === "model") return null;
  // AIR-GAPPED, there is nothing for it to work at. @see game/machine KEYSTONES
  if (keystone("airgap")) return <div className={SECTION}><p className={TITLE}>Air-gapped</p><p>It never touches the map: no district, no drones, no takeover. Every agent's boost is 1.6 times what it was.</p></div>;
  const stage = stageOf(value).stage;
  const interval = INTERVAL[stage];
  const pace = aiPace(grid, { stage, running: runningAgents(), agents }, 1);
  const next = !interval ? "It does nothing on the map before the Colleague stage."
    : pace <= 0 ? "Its next job waits: no agents running."
    : `Next job in about ${Math.max(1, Math.ceil((interval - getAiRunner().clock) / pace))} s.`;
  const shares = [...allTanks().values()].map((t) => t.share);
  const cooled = shares.length ? Math.round(Math.min(...shares) * 100) : null;
  return (
    <div className={SECTION}>
      <p className={TITLE}>Its focus</p>
      <div className="grid grid-cols-2 gap-1" role="radiogroup" aria-label="The AI's focus">
        {FOCUSES.map((f) => (
          <button key={f.id} type="button" role="radio" aria-checked={focus === f.id} title={f.blurb}
            onClick={() => setFocus(f.id)}
            className={twMerge(BTN, focus === f.id && "border-violet-600 bg-violet-100 dark:border-violet-400 dark:bg-violet-950")}>
            <b>{f.name}</b>
          </button>
        ))}
      </div>
      <p className="mt-1 text-primary-600 dark:text-primary-400">{FOCUSES.find((f) => f.id === focus)?.blurb}</p>
      <p className="mt-1 tabular-nums">
        {next}{cooled !== null && <> Its worst-cooled building: <b className={cooled > 95 ? "text-emerald-700 dark:text-emerald-400" : "text-amber-700 dark:text-amber-400"}>{cooled}%</b>.</>}
      </p>
    </div>
  );
}

/**
 * ITS ALLOWANCE: the share of income the company's AI may spend, and what it
 * has to spend now. Everything it does on the map, it pays for from this;
 * what it cannot pay for, it waits for. @see world/ai/wallet
 */
function Allowance() {
  const share = useSessionStore((s) => s.aiShare);
  const wallet = useSessionStore((s) => s.aiWallet);
  const set = useSessionStore((s) => s.setAiWallet);
  const founder = useFounderStore((s) => s.selectedFounderId);
  // The Model's own runs are AI mode's, with its own budget; air-gapped, it spends nothing. @see AiModePanel
  if (founder === "model" || keystone("airgap")) return null;
  const cap = walletCap();
  return (
    <div className={SECTION}>
      <p className={TITLE}>Its allowance</p>
      <label className="flex justify-between tabular-nums" htmlFor="dc-allowance">
        <span>Share of income it may spend</span><b>{Math.round(share * 100)}%</b>
      </label>
      <input id="dc-allowance" type="range" min={0} max={SHARE_MAX} step={SHARE_STEP} value={share}
        onChange={(e) => set({ aiShare: Number(e.target.value) })}
        className="mt-1 w-full accent-violet-600 dark:accent-violet-400" />
      <p className="tabular-nums text-primary-600 dark:text-primary-400">
        {formatCurrency(wallet)} to spend, of {formatCurrency(cap)} at most ({WALLET_MINUTES} minutes of its share). From the Colleague stage it pays for what it builds from this, and waits when it is empty.
      </p>
      {/* ITS LEDGER, kept for you since the sandbox. @see walletLedger, chapter "ledger" */}
      {questFlag("ledger:logged") && (
        <div className="mt-1">
          <p className="font-bold">Its ledger</p>
          {walletLedger().length === 0 && <p className="text-primary-600 dark:text-primary-400">Nothing spent yet.</p>}
          {walletLedger().map((l, i) => (
            <p key={i} className="flex justify-between gap-2 tabular-nums"><span className="truncate">{l.what}</span><span>{formatCurrency(l.price)}</span></p>
          ))}
        </div>
      )}
    </div>
  );
}

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
  // Pumps are mains' now, at their intakes. @see MAIN_END
  const pumps = grid.mainEnd.reduce((n, e) => n + (e === MAIN_END.pump ? 1 : 0), 0);
  const upkeep = pumpUpkeep(useGeneratorStore.getState().getMoneyPerSecond());
  const name = (def: string) => ({ datacentre: "Data Centre", "ai-node": "AI node", "gpu-farm": "GPU farm", "compute-spire": "Compute spire", lattice: "The Lattice" } as Record<string, string>)[def] ?? def;
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

/**
 * TRAINING RUNS: one at a time, on a dataset, paid for with the agents' boost
 * to income while it runs; each teaches the AI a level of a skill, for this
 * company. @see game/training
 */
function Training() {
  const current = useTrainingStore((s) => s.current);
  const start = useTrainingStore((s) => s.start);
  const skills = useTrainingStore((s) => s.skills);
  const blocked = useTrainingStore.getState().blocked();
  const seconds = useTrainingStore.getState().seconds();
  const on = dataset(current?.dataset);
  const level = on ? skills[on.id] ?? 0 : 0;
  return (
    <div className={SECTION}>
      <p className={TITLE}>Training</p>
      {current && on ? (
        <>
          <p className="flex justify-between"><span>Training on <b>{on.name}</b></span><span className="tabular-nums">{clock(current.endsAt)}</span></p>
          <p className="text-amber-700 dark:text-amber-400">The agents are training, not working: no boost to income till it ends.</p>
          {level < MAX_SKILL && <p className="text-emerald-700 dark:text-emerald-400">Then: {on.skills[level]}</p>}
          <p className="italic text-primary-600 dark:text-primary-400">“{on.memo}”</p>
          <div className="mt-1 h-1 w-full overflow-hidden bg-primary-200 dark:bg-primary-800">
            <div className="h-full bg-violet-600 dark:bg-violet-400"
              style={{ width: `${Math.min(100, 100 - ((current.endsAt - Date.now()) / (seconds * 1000)) * 100)}%` }} />
          </div>
        </>
      ) : (
        <>
          <p className="mb-1 tabular-nums text-primary-600 dark:text-primary-400">
            {fmtSeconds(seconds)} of the agents' boost to income · teaches the AI a skill for this company, then it jumps
          </p>
          <div className="flex flex-col gap-1">
            {DATASETS.map((d) => {
              const n = skills[d.id] ?? 0;
              return (
                <button key={d.id} type="button" className={BTN} disabled={!!blocked} onClick={() => start(d.id)}>
                  <span className="flex w-full justify-between">
                    <b>{d.name} <span className="tabular-nums font-normal text-violet-700 dark:text-violet-300" aria-label={`level ${n} of ${MAX_SKILL}`}>{"●".repeat(n)}{"○".repeat(MAX_SKILL - n)}</span></b>
                    <span className="tabular-nums text-violet-700 dark:text-violet-300">+{d.jump}%</span>
                  </span>
                  <span className="text-primary-600 dark:text-primary-400">{n < MAX_SKILL ? `Next: ${d.skills[n]}` : "Learned. Another run still leans it and jumps the AI."}</span>
                </button>
              );
            })}
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

/** A length of time, as minutes or seconds. */
const fmtSeconds = (s: number) => (s >= 60 ? `${+(s / 60).toFixed(1)} minutes` : `${Math.round(s)} seconds`);
/** Time left until a moment, m:ss. */
const clock = (at: number) => {
  const s = Math.max(0, Math.ceil((at - Date.now()) / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};
