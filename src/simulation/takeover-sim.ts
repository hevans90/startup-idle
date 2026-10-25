/**
 * THE TAKEOVER, RUN HEADLESS: the company's AI let loose on the singularity
 * fixture's town for so many seconds at one stage, one focus, leant toward one
 * family of trait — its real planner, drones, wallet, cooling, mains and
 * water, a second at a time — and what it did measured against the plan's
 * guards. @see takeover.test.ts, plans/ai-takeover.md §8
 */
import Decimal from "break_infinity.js";

import { isDrinker } from "../game/cooling";
import type { Family } from "../game/traits";
import type { DatasetId } from "../game/training";
import { useAgentsStore } from "../state/agents.store";
import { STAGES, useAiSingularityStore, type Stage } from "../state/ai-singularity.store";
import { useFounderStore } from "../state/founder.store";
import { emptyLog, useGenerationStore } from "../state/generation.store";
import { useMoneyStore } from "../state/money.store";
import { useGeneratorStore } from "../state/generators.store";
import { useSessionStore, type AiFocus } from "../state/session.store";
import { useWorldStore } from "../state/world.store";
import { createAiRunner, stepAi, warnMs } from "../world/ai/ai-runner";
import { walletCap } from "../world/ai/wallet";
import { SHORT } from "../world/ai/cooling-ai";
import { aiDistrict, inDistrict } from "../world/ai/district";
import { MAX_RESERVOIRS, reservoirs } from "../world/ai/reservoir";
import { applyFixture } from "../world/debug/fixtures";
import { createGrid, type Grid } from "../world/grid";
import { resetCooling, stepCooling, tankFor } from "../world/projects/cooling";
import { runMains } from "../world/water/mains";
import { runSources, stepWater } from "../world/water/field";
import { resetAllGameStores } from "./reset-game-stores";

export type TakeoverRun = {
  stage: Stage; focus: AiFocus; family?: Family; seconds: number; agents?: number;
  /** Interns hired: the income its allowance is a share of. */
  interns?: number;
  /** Water steps a second: the mains and the water run this many times, each a share of the second. */
  waterSteps?: number;
};

export type TakeoverReport = {
  /** Jobs done, and of what kind; and how many put up something that drinks — a building, or a takeover. */
  jobs: number;
  kinds: Record<string, number>;
  grew: number;
  /** The longest stretch, seconds, with under `SHORT` of its drinkers cooled; when it was first all cooled, and the longest stretch after that. */
  dryest: number;
  cooledAt: number | null;
  relapse: number;
  /** The share of its drinkers cooled at the end. */
  cooledEnd: number;
  /** What it spent of the company's money, and what its wallet held at the start and was given since. */
  spent: number;
  allowed: number;
  /** Jobs on the map done outside its district, pipes and desk work aside. */
  outside: number;
  /** Takeovers done without their warning first. */
  unwarned: number;
  reservoirs: number;
};

/** The dataset that leans the AI toward each family, and how; the temper family by being run throttled. */
const LEAN: Partial<Record<Family, DatasetId>> = { planner: "town", optimiser: "money", shepherd: "people", elemental: "river", recursive: "itself" };

/** Seconds before its tanks, which start full, say anything about its water. */
const SETTLE = 300;

/** The town, entered into play, the company set up for its AI. */
function town(run: TakeoverRun): Grid {
  resetAllGameStores();
  resetCooling();
  const g = createGrid(64, 64, 1);
  applyFixture(g, "singularity", 1);
  useWorldStore.getState().loadGrid(g, [null]);
  useWorldStore.getState().setPlaying(true);
  useFounderStore.getState().chooseFounder("neet");
  const from = STAGES.find((s) => s.stage === run.stage)!.from;
  useAiSingularityStore.setState({ value: from + 1 });
  useAgentsStore.setState({ agents: run.agents ?? 24, running: null });
  useMoneyStore.setState({ money: new Decimal(1e12) });
  // A WORKFORCE, for an income to give it a share of; its wallet full to start. @see walletCap
  useGeneratorStore.getState().increaseGenerator("intern", run.interns ?? 200);
  useSessionStore.setState({ aiFocus: run.focus, aiShare: 0.2 });
  useSessionStore.setState({ aiWallet: walletCap() });
  const log = emptyLog();
  const d = run.family ? LEAN[run.family] : undefined;
  if (d) log.datasets[d] = 12;
  if (run.family === "temper") log.throttled = 1e6;
  useGenerationStore.setState({ log });
  return useWorldStore.getState().grid;
}

/** The share of its drinkers with their water. */
function cooledShare(g: Grid): number {
  let n = 0, met = 0;
  for (const s of g.structures.values()) {
    if (s.build || !isDrinker(s.def)) continue;
    n++;
    if ((tankFor(s.id)?.share ?? 1) >= SHORT) met++;
  }
  return n ? met / n : 1;
}

export function simulateTakeover(run: TakeoverRun, rand: () => number = Math.random): TakeoverReport {
  town(run);
  const runner = createAiRunner();
  const startMoney = useMoneyStore.getState().money.toNumber();
  const report: TakeoverReport = { jobs: 0, kinds: {}, grew: 0, dryest: 0, cooledAt: null, relapse: 0, cooledEnd: 0, spent: 0, allowed: useSessionStore.getState().aiWallet, outside: 0, unwarned: 0, reservoirs: 0 };
  /** When each takeover was first announced, by its tile. */
  const announced = new Map<string, number>();
  let dry = 0, now = 1_000_000;
  for (let s = 0; s < run.seconds; s++) {
    const st = useWorldStore.getState(), g = st.grid, f = st.getWaterField();
    const agents = useAgentsStore.getState().agents;
    // ITS ALLOWANCE this second: its share of income. @see accrueWallet
    report.allowed += Math.max(0, useGeneratorStore.getState().getMoneyPerSecond()) * useSessionStore.getState().aiShare;
    const did = stepAi(runner, g, { stage: run.stage, running: agents, agents }, 1, now, rand);
    for (const p of runner.pending) {
      const key = `${p.action.at.x},${p.action.at.y}`;
      if (!announced.has(key)) announced.set(key, now);
    }
    const district = aiDistrict(g, run.stage);
    for (const a of did) {
      report.jobs++;
      report.kinds[a.kind] = (report.kinds[a.kind] ?? 0) + 1;
      if ((a.kind === "place" && isDrinker(a.def)) || a.kind === "convert") report.grew++;
      if (a.kind === "convert") {
        const at = announced.get(`${a.at.x},${a.at.y}`);
        if (at === undefined || now - at < warnMs()) report.unwarned++;
      }
      const onMap = a.kind === "place" || a.kind === "convert" || a.kind === "road" || a.kind === "lift" || a.kind === "flatten" || a.kind === "reservoir";
      const at = a.kind === "road" || a.kind === "flatten" ? a.from : "at" in a ? a.at : null;
      if (onMap && at && !inDistrict(district, at.x, at.y)) report.outside++;
    }
    stepCooling(g, agents, false, 1);
    const n = run.waterSteps ?? 1;
    // As the scene runs a frame of water: the springs, the mains, the flow. @see world-scene
    if (f) for (let k = 0; k < n; k++) { runSources(f, g, 1 / n); runMains(f, g, 1 / n); stepWater(f, 1 / n); }
    const share = cooledShare(g);
    dry = share < SHORT ? dry + 1 : 0;
    report.dryest = Math.max(report.dryest, dry);
    // Tanks start full: cooled only counts once they have had time to run down, if they were going to.
    if (report.cooledAt === null && share >= 1 && s >= SETTLE) report.cooledAt = s;
    else if (report.cooledAt !== null) report.relapse = Math.max(report.relapse, dry);
    report.cooledEnd = share;
    now += 1000;
  }
  report.spent = startMoney - useMoneyStore.getState().money.toNumber();
  report.reservoirs = reservoirs().length;
  return report;
}

/** Out of play again, with a fresh map and stores — the town the sim used left for nothing else. */
export function endTakeover(): void {
  useWorldStore.getState().setPlaying(false);
  useWorldStore.getState().loadGrid(createGrid(64, 64), [null]);
  resetCooling();
  resetAllGameStores();
}

export { MAX_RESERVOIRS };
