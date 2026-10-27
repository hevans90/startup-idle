import Decimal from "break_infinity.js";
import { holdWhileAway, nextQuestStep, stageFrom, useAiSingularityStore } from "../state/ai-singularity.store";
import { useGenerationStore } from "../state/generation.store";
import { useQuestStore } from "../state/quest.store";
import { CHAPTERS } from "./quests/chapters";
import { useFounderStore } from "../state/founder.store";
import { type GeneratorId, useGeneratorStore } from "../state/generators.store";
import { useInnovationStore } from "../state/innovation.store";
import { useMoneyStore } from "../state/money.store";
import { useSessionStore } from "../state/session.store";
import { useTrainingStore } from "../state/training.store";
import { useValuationStore } from "../state/valuation.store";

/** Hard cap on credited offline time (full credit up to here, nothing beyond). */
export const OFFLINE_CAP_MS = 2 * 24 * 60 * 60 * 1000; // 2 days
/** Below this, don't bother crediting or showing the popup. */
export const MIN_OFFLINE_MS = 10 * 1000; // 10 seconds
/** Cap on simulation chunks — bounds load cost; sets auto-buy compounding granularity. */
const MAX_STEPS = 1000;

export type OfflineSummary = {
  /** Real (uncapped) time away, for display. */
  elapsedMs: number;
  /** Whether time away exceeded the cap (so only part was credited). */
  wasCapped: boolean;
  /** Net money gained (after offline auto-buy spend). */
  money: Decimal;
  innovation: Decimal;
  valuation: Decimal;
  /** Percentage points the AI singularity advanced (ominous, not a "gain"). */
  aiSingularity: number;
  /** Employees auto-bought during the absence, per generator. */
  hires: Record<GeneratorId, number>;
  /** The arc's chapter the AI is waiting for you at, if one is due. @see chapterWaiting */
  chapter: { number: number; title: string } | null;
};

/**
 * THE CHAPTER WAITING FOR YOU: the one asked already, or the first unanswered
 * one the meter has reached — the first generation's arc only. The away hold
 * stops the meter at it. @see holdWhileAway, useQuestStore.step
 */
export function chapterWaiting(meter: number): OfflineSummary["chapter"] {
  if (useGenerationStore.getState().generation !== 1) return null;
  const q = useQuestStore.getState();
  const c = q.offer?.kind === "chapter"
    ? CHAPTERS.find((x) => x.id === q.offer!.id)
    : CHAPTERS.find((x) => !(x.id in q.chapters) && meter >= (x.at ?? stageFrom(x.stage)));
  return c ? { number: c.number, title: c.title } : null;
}

const countsByGenerator = (): Record<GeneratorId, number> => {
  const out: Record<GeneratorId, number> = {
    intern: 0,
    vibe_coder: 0,
    "10x_dev": 0,
  };
  for (const g of useGeneratorStore.getState().generators) out[g.id] = g.amount;
  return out;
};

/**
 * Credit progression for time the player was away and return a summary for the
 * "while you were away" popup, or null if there's nothing to show.
 *
 * Runs the REAL game tick (`tickGenerators` + `tickManagers`) forward in chunks
 * over the capped elapsed time — so offline earnings, auto-buy (compounding as
 * hires fund more hires), managers and satisfaction all advance exactly as they
 * would live. No efficiency fudge: full credit up to {@link OFFLINE_CAP_MS}.
 *
 * Must run once on load, BEFORE the live loop ticks, or the first live tick
 * would double-count the gap. Resets both stores' `globalLastTick` to now on the
 * way out so the live loop starts clean.
 */
export function computeOfflineProgress(
  nowMs: number = Date.now(),
): OfflineSummary | null {
  // The game hasn't started until a founder is chosen — no offline before then.
  if (useFounderStore.getState().selectedFounderId == null) {
    useSessionStore.getState().touch();
    return null;
  }

  const lastSeen = useSessionStore.getState().lastSeenAt;
  const rawElapsed = nowMs - lastSeen;
  // Guard clock skew / first run / trivially short absences.
  if (!Number.isFinite(rawElapsed) || rawElapsed < MIN_OFFLINE_MS) {
    useSessionStore.getState().touch();
    return null;
  }

  const wasCapped = rawElapsed > OFFLINE_CAP_MS;
  // Credit only up to the cap, but report the REAL time away for display.
  const creditedMs = Math.min(rawElapsed, OFFLINE_CAP_MS);
  const totalSec = creditedMs / 1000;

  const money0 = useMoneyStore.getState().money;
  const innovation0 = useInnovationStore.getState().innovation;
  const valuation0 = useValuationStore.getState().valuation;
  const aiSingularity0 = useAiSingularityStore.getState().value;
  const counts0 = countsByGenerator();

  // Replay in equal chunks. chunkMs stays >= 1000ms (the tick's minimum
  // interval) because numChunks never exceeds floor(totalSec) and totalSec >= 60.
  const numChunks = Math.min(MAX_STEPS, Math.max(1, Math.floor(totalSec)));
  const chunkMs = creditedMs / numChunks;
  // THE AI, AWAY, gets as far as the next quest step and waits there for you:
  // the agents' push and a training run finished meanwhile alike. @see holdWhileAway
  holdWhileAway(nextQuestStep(aiSingularity0));
  try {
    for (let i = 0; i < numChunks; i++) {
      const t = Date.now();
      useGeneratorStore.setState({ globalLastTick: t - chunkMs });
      useInnovationStore.setState({ globalLastTick: t - chunkMs });
      useGeneratorStore.getState().tickGenerators();
      useInnovationStore.getState().tickManagers();
    }
    useTrainingStore.getState().tick(nowMs);
  } finally {
    holdWhileAway(null);
  }

  // AND THE SEAPORTS, at the rate they were earning when the map last ran:
  // boats only move while it does, but the trade goes on. @see portIncomePerSecond
  const portRate = useSessionStore.getState().portIncomePerSecond;
  if (Number.isFinite(portRate) && portRate > 0) useMoneyStore.getState().increaseMoney(portRate * totalSec);

  // Start the live loop fresh from now (also folds the previously-uncapped
  // manager catch-up into this capped sim).
  const after = Date.now();
  useGeneratorStore.setState({ globalLastTick: after });
  useInnovationStore.setState({ globalLastTick: after });
  useSessionStore.getState().touch();

  const counts1 = countsByGenerator();
  const money = useMoneyStore.getState().money.sub(money0);
  const innovation = useInnovationStore.getState().innovation.sub(innovation0);
  const valuation = useValuationStore.getState().valuation.sub(valuation0);
  const aiSingularity = useAiSingularityStore.getState().value - aiSingularity0;
  const hires: Record<GeneratorId, number> = {
    intern: counts1.intern - counts0.intern,
    vibe_coder: counts1.vibe_coder - counts0.vibe_coder,
    "10x_dev": counts1["10x_dev"] - counts0["10x_dev"],
  };

  const gainedNothing =
    money.lte(0) &&
    innovation.lte(0) &&
    valuation.lte(0) &&
    aiSingularity <= 0 &&
    hires.intern === 0 &&
    hires.vibe_coder === 0 &&
    hires["10x_dev"] === 0;
  if (gainedNothing) return null;

  return {
    elapsedMs: rawElapsed,
    wasCapped,
    money,
    innovation,
    valuation,
    aiSingularity,
    hires,
    chapter: chapterWaiting(useAiSingularityStore.getState().value),
  };
}
