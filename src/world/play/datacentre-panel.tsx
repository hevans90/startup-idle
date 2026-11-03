/**
 * World v2 — THE DATA CENTRE'S CONTROL ROOM, in the AI tab — which clicking
 * the Data Centre opens: where the singularity stands; the throttle — how many of the
 * company's AI agents are running, every one earning and pushing the
 * singularity on; training runs; the racks; and what the AI is turning into.
 * @see runningAgents, singularityRate, game/training, game/traits
 */
import { useRef } from "react";
import { twMerge } from "tailwind-merge";
import { LATTICE_AT } from "../../state/ai-singularity.store";
import { useFounderStore } from "../../state/founder.store";
import { useSessionStore } from "../../state/session.store";
import { Button, Empty, Label, Meter, Panel, Slider, Tile, useTakeoverGlitch } from "../../ui/console";
import { useAscensionUiStore } from "../../state/ascension-ui.store";
import { formatCurrency } from "../../utils/money-utils";
import { aiPace, getAiRunner } from "../ai/ai-runner";
import { FOCUSES } from "../ai/focus";
import { LATTICE_AGENTS, latticeNeeds } from "../ai/lattice";
import { INTERVAL } from "../ai/planner";
import { SHARE_MAX, SHARE_STEP, WALLET_MINUTES, walletCap } from "../ai/wallet";

import { agentBonus, agentsARack, agentsOpen } from "../../game/agents";
import { pumpUpkeep } from "../../game/cooling";
import { keystone } from "../../game/machine";
import { questFlag } from "../../game/quests/effects";
import { DATASETS, MAX_SKILL, dataset } from "../../game/training";
import { traitForecast } from "../../game/traits";
import { useTicking } from "../../hooks/use-ticking";
import { runningAgents, useAgentsStore } from "../../state/agents.store";
import {
  singularityMult,
  singularityRate,
  stageOf,
  useAiSingularityStore,
} from "../../state/ai-singularity.store";
import { useGenerationStore } from "../../state/generation.store";
import { useGeneratorStore } from "../../state/generators.store";
import { training, useTrainingStore } from "../../state/training.store";
import { useWorldStore } from "../../state/world.store";
import { walletLedger } from "../ai/wallet";
import { MAIN_END } from "../grid";
import { allTanks, hotAgents } from "../projects/cooling";
import { powered as rackPowered } from "../projects/racks";
import { showMe } from "./map-focus";

/** A rate a second as so much a minute, signed. */
const perMinute = (r: number) =>
  `${r >= 0 ? "+" : "−"}${Math.abs(r * 60).toFixed(2)}/min`;

export function DataCentre({ className }: { className?: string }) {
  useTicking(500);
  const agents = useAgentsStore((s) => s.agents);
  const setRunning = useAgentsStore((s) => s.setRunning);
  const value = useAiSingularityStore((s) => s.value);
  const waiting = useAscensionUiStore((s) => s.waiting);
  const built = agentsOpen();
  const running = runningAgents();
  const mult = singularityMult();
  // Nothing to sink from at nought; full, it waits and does not move.
  const rate =
    value >= 100
      ? 0
      : value <= 0
      ? Math.max(0, singularityRate(running, mult, agents))
      : singularityRate(running, mult, agents);
  const boost = Math.round((agentBonus(running) - 1) * 100);
  // THE METER, torn as the takeover goes on. @see useTakeoverGlitch
  const meter = useRef<HTMLDivElement>(null);
  useTakeoverGlitch(meter);
  return (
    <div className={twMerge("text-xs text-fg", className)}>
      {/* THE SINGULARITY: how far, and which way. */}
      <div ref={meter}>
        <Meter
          tone="ai"
          value={value / 100}
          label="The singularity"
          detail={
            <>
              {value.toFixed(1)}% · {perMinute(rate)}
            </>
          }
        />
      </div>
      {/* FULL, AND WAITING: begun when you are ready. @see useAscensionUiStore */}
      {value >= 100 && waiting && (
        <Button variant="primary" tone="ai" className="mt-2 w-full" onClick={() => useAscensionUiStore.getState().begin()}>
          The AI is waiting · Begin
        </Button>
      )}

      {built ? (
        <>
          {/* THE THROTTLE. */}
          <Panel tone="ai" title="The throttle" className={SECTION}>
            {agents > 0 ? (
              <>
                <label
                  className="flex justify-between tabular-nums"
                  htmlFor="dc-throttle"
                >
                  <span>Agents running</span>
                  <b>
                    {running} of {agents}
                  </b>
                </label>
                <Slider
                  id="dc-throttle"
                  label="Agents running"
                  tone="ai"
                  min={0}
                  max={agents}
                  step={1}
                  value={running}
                  onChange={setRunning}
                  className="my-1 w-full"
                />
                <p className="tabular-nums text-fg-muted">
                  {training()
                    ? "Training: no boost"
                    : `Income +${boost}%`}{" "}
                  · AI {perMinute(rate)}
                </p>
              </>
            ) : (
              <p className="text-fg-muted">
                No agents yet (Employees tab)
              </p>
            )}
          </Panel>

          <Lattice />
          <Focus />
          <Allowance />
          <Cooling />
          <Training />
          <Roster />
          <Forecast />
        </>
      ) : (
        <p className="mt-2 text-fg-muted">
          Build a Data Center to unlock AI management.
        </p>
      )}
    </div>
  );
}

/** Each of the control room's parts: a panel in the AI's violet. */
const SECTION = "mt-3";

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
    <li className={met ? "text-good" : "text-warn"}>
      {met ? "✓" : "✗"} {text}
    </li>
  );
  return (
    <Panel tone="ai" title={`The Lattice · holds at ${LATTICE_AT}%`} className={SECTION}>
      <ul>
        {need(
          n.built,
          n.built
            ? "Built"
            : "Not built yet",
        )}
        {need(n.dc, "Data Centre cooled")}
        {need(n.agents, `${LATTICE_AGENTS} agents (${running})`)}
        {need(n.water, "Water piped")}
      </ul>
      <Meter
        tone="ai"
        value={charge}
        label="Charge"
        detail={`${Math.round(charge * 100)}%`}
        className="mt-1"
      />
    </Panel>
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
  if (keystone("airgap"))
    return (
      <Panel tone="ai" title="Air-gapped" className={SECTION}>
        <p>Off the map · agents ×1.6</p>
      </Panel>
    );
  const stage = stageOf(value).stage;
  const interval = INTERVAL[stage];
  const pace = aiPace(grid, { stage, running: runningAgents(), agents }, 1);
  const next = !interval
    ? "Idle till the Colleague"
    : pace <= 0
      ? "Waiting: no agents running"
      : `Next job ${Math.max(1, Math.ceil((interval - getAiRunner().clock) / pace))} s`;
  const shares = [...allTanks().values()].map((t) => t.share);
  const cooled = shares.length ? Math.round(Math.min(...shares) * 100) : null;
  return (
    <Panel tone="ai" title="Its focus" className={SECTION}>
      <div
        className="grid grid-cols-2 gap-1"
        role="radiogroup"
        aria-label="The AI's focus"
      >
        {FOCUSES.map((f) => (
          <Tile
            key={f.id}
            role="radio"
            aria-checked={focus === f.id}
            selected={focus === f.id}
            title={f.blurb}
            onClick={() => setFocus(f.id)}
            className="px-2 py-1.5"
          >
            <b>{f.name}</b>
          </Tile>
        ))}
      </div>
      <p className="mt-1 tabular-nums text-fg-muted">
        {next}
        {cooled !== null && (
          <>
            {" · cooled "}
            <b className={cooled > 95 ? "text-good" : "text-warn"}>{cooled}%</b>
          </>
        )}
      </p>
    </Panel>
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
    <Panel tone="ai" title="Its allowance" className={SECTION}>
      <label
        className="flex justify-between tabular-nums"
        htmlFor="dc-allowance"
      >
        <span>Share of income</span>
        <b>{Math.round(share * 100)}%</b>
      </label>
      <Slider
        id="dc-allowance"
        label="Share of income it may spend"
        tone="ai"
        min={0}
        max={SHARE_MAX}
        step={SHARE_STEP}
        value={share}
        onChange={(v) => set({ aiShare: v })}
        className="my-1 w-full"
      />
      <p className="tabular-nums text-fg-muted" title={`Holds ${WALLET_MINUTES} minutes of its share. It pays for what it builds from this, from the Colleague on.`}>
        {formatCurrency(wallet)} / {formatCurrency(cap)}
      </p>
      {/* ITS LEDGER, kept for you since the sandbox. @see walletLedger, chapter "ledger" */}
      {questFlag("ledger:logged") && (
        <div className="mt-1">
          <Label>Its ledger</Label>
          {walletLedger().length === 0 && (
            <Empty>Nothing spent yet.</Empty>
          )}
          <div className="flex flex-col divide-y divide-line-quiet">
            {walletLedger().map((l, i) => (
              <p
                key={i}
                className="flex justify-between gap-2 py-1 tabular-nums"
              >
                <span className="truncate text-fg-muted">{l.what}</span>
                <span className="text-money">{formatCurrency(l.price)}</span>
              </p>
            ))}
          </div>
        </div>
      )}
    </Panel>
  );
}

/**
 * COOLING: every building that drinks, how well it is cooled and what it
 * wants; how many agents are running hot for want of water; the pump houses
 * and what they cost to run. @see game/cooling
 */
function Cooling() {
  const grid = useWorldStore((s) => s.grid);
  const tanks = [...allTanks().entries()]
    .map(([id, t]) => ({ id, t, s: grid.structures.get(id) }))
    .filter((r) => r.s);
  if (!tanks.length) return null;
  const hot = Math.round(hotAgents());
  // Pumps are mains' now, at their intakes. @see MAIN_END
  const pumps = grid.mainEnd.reduce(
    (n, e) => n + (e === MAIN_END.pump ? 1 : 0),
    0,
  );
  const upkeep = pumpUpkeep(useGeneratorStore.getState().getMoneyPerSecond());
  const name = (def: string) =>
    (
      ({
        datacentre: "Data Centre",
        "ai-node": "AI node",
        "gpu-farm": "GPU farm",
        "compute-spire": "Compute spire",
        lattice: "The Lattice",
      }) as Record<string, string>
    )[def] ?? def;
  return (
    <Panel tone="ai" title="Cooling" className={SECTION}>
      {hot > 0 && (
        <p className="mb-1 text-warn">
          Running hot: {hot} agent{hot === 1 ? "" : "s"} at half power. Pipe
          water in from a river or lake with the Pipe tool.
        </p>
      )}
      <div className="flex max-h-32 flex-col divide-y divide-line-quiet overflow-y-auto">
        {tanks.map(({ id, t, s }) => (
          <button
            key={id}
            type="button"
            onClick={() => showMe({ x: s!.x, y: s!.y })}
            className="cursor-pointer px-1 py-1 text-left hover:bg-surface-2"
          >
            <span className="flex justify-between gap-2">
              <span>
                {name(t.def)} ·{" "}
                <span className={t.share > 0.95 ? "text-good" : "text-warn"}>
                  {Math.round(t.share * 100)}% cooled
                </span>
              </span>
              <span className="tabular-nums">
                {t.demand.toFixed(2)}/s
              </span>
            </span>
            <span className="mt-0.5 block h-1 w-full overflow-hidden bg-surface-2">
              <span
                className="block h-full bg-info"
                style={{
                  width: `${Math.min(100, (t.level / t.capacity) * 100)}%`,
                }}
              />
            </span>
          </button>
        ))}
      </div>
      {pumps > 0 && (
        <p className="mt-1 tabular-nums text-fg-muted">
          {pumps} pump{pumps === 1 ? "" : "s"} · {formatCurrency(Math.round(upkeep))}/s each
        </p>
      )}
    </Panel>
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
  const level = on ? (skills[on.id] ?? 0) : 0;
  return (
    <Panel tone="ai" title="Training" className={SECTION}>
      {current && on ? (
        <>
          <p className="flex justify-between">
            <span>
              Training on <b>{on.name}</b>
            </span>
            <span className="tabular-nums">{clock(current.endsAt)}</span>
          </p>
          <p className="text-warn">No agent boost till it ends</p>
          {level < MAX_SKILL && (
            <p className="text-good">Then: {on.skills[level]}</p>
          )}
          <div className="mt-1 h-1 w-full overflow-hidden bg-surface-2">
            <div
              className="h-full bg-ai"
              style={{
                width: `${Math.min(100, 100 - ((current.endsAt - Date.now()) / (seconds * 1000)) * 100)}%`,
              }}
            />
          </div>
        </>
      ) : (
        <>
          <p className="mb-1 tabular-nums text-fg-muted" title="Costs the agents' boost to income while it runs; teaches a skill for this company">
            {fmtSeconds(seconds)} · costs the agent boost
          </p>
          <div className="flex flex-col gap-1">
            {DATASETS.map((d) => {
              const n = skills[d.id] ?? 0;
              return (
                <Tile
                  key={d.id}
                  lit={!blocked}
                  disabled={!!blocked}
                  onClick={() => start(d.id)}
                  title={n < MAX_SKILL ? `Next: ${d.skills[n]}` : "Learned"}
                  className="flex w-full flex-col items-start gap-0.5 px-2 py-1.5"
                >
                  <span className="flex w-full justify-between">
                    <b>
                      {d.name}{" "}
                      <span
                        className="tabular-nums font-normal text-ai"
                        aria-label={`level ${n} of ${MAX_SKILL}`}
                      >
                        {"●".repeat(n)}
                        {"○".repeat(MAX_SKILL - n)}
                      </span>
                    </b>
                    <span className="tabular-nums text-ai">+{d.jump}%</span>
                  </span>
                </Tile>
              );
            })}
          </div>
        </>
      )}
    </Panel>
  );
}

/** THE AGENT ROSTER: every rack, powered or not, and how many it runs; a click to look. */
function Roster() {
  const grid = useWorldStore((s) => s.grid);
  const racks = [...grid.structures.values()].filter(
    (s) => s.def === "rack" && !s.build,
  );
  if (!racks.length) return null;
  // The running agents fill the powered racks first. @see agentsAtWork
  let left = runningAgents();
  const rows = [...racks]
    .map((s) => ({ s, on: rackPowered(grid, s) }))
    .sort((a, b) => Number(b.on) - Number(a.on))
    .map((r) => {
      const n = Math.min(agentsARack(), left);
      left -= n;
      return { ...r, n };
    });
  const each = agentsARack();
  const halves = rows.filter((r) => !r.on).length;
  return (
    <Panel tone="ai" title={`Racks · ${rows.reduce((a, r) => a + r.n, 0)}/${rows.length * each} running${halves ? ` · ${halves} at half power` : ""}`} className={SECTION}>
      {/* A TILE A RACK: a pip an agent, lit when running; its edge, its power. A click to look. */}
      <div className="flex flex-wrap gap-1">
        {rows.map(({ s, on, n }, k) => (
          <button
            key={s.id}
            type="button"
            title={`Rack ${k + 1} · ${on ? "powered" : "half power"} · ${n}/${each}`}
            aria-label={`Rack ${k + 1}, ${on ? "powered" : "half power"}, ${n} of ${each} running`}
            onClick={() => showMe({ x: s.x, y: s.y })}
            className={`grid cursor-pointer grid-cols-2 gap-0.5 border bg-surface-1 p-1 hover:bg-surface-2 ${on ? "border-line" : "border-warn"}`}
          >
            {Array.from({ length: each }, (_, i) => (
              <span key={i} className={`size-1.5 ${i < n ? "bg-ai" : "bg-surface-3"}`} />
            ))}
          </button>
        ))}
      </div>
    </Panel>
  );
}

/** WHAT YOU ARE BREEDING: the likeliest traits at the Ascension, from the behaviour log. @see traitForecast */
function Forecast() {
  const log = useGenerationStore((s) => s.log);
  const forecast = traitForecast(log);
  return (
    <Panel tone="ai" title="Training log" className={SECTION}>
      {forecast.map(({ trait, odds }) => (
        <p key={trait.id} className="flex flex-col gap-1 py-1">
          <span className="flex justify-between gap-2">
            <b title={trait.memo}>{trait.name}</b>
            <span className="shrink-0 tabular-nums text-ai">
              {Math.round(odds * 100)}%
            </span>
          </span>
          <span className="block h-0.5 bg-surface-3">
            <span
              className="block h-full bg-ai"
              style={{ width: `${Math.round(odds * 100)}%` }}
            />
          </span>
        </p>
      ))}
    </Panel>
  );
}

/** A length of time, as minutes or seconds. */
const fmtSeconds = (s: number) =>
  s >= 60 ? `${+(s / 60).toFixed(1)} minutes` : `${Math.round(s)} seconds`;
/** Time left until a moment, m:ss. */
const clock = (at: number) => {
  const s = Math.max(0, Math.ceil((at - Date.now()) / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};
