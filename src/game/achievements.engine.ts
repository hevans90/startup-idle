import toast from "react-hot-toast";
import {
  ACHIEVEMENT_CATALOG,
  type AchievementContext,
  type AchievementDef,
} from "./achievements.catalog";
import { useAiSingularityStore } from "../state/ai-singularity.store";
import { useGeneratorStore } from "../state/generators.store";
import { ManagerKeyValues, useInnovationStore } from "../state/innovation.store";
import { useMoneyStore } from "../state/money.store";
import { usePrestigeStore } from "../state/prestige.store";
import { useUpgradeStore } from "../state/upgrades.store";
import { useValuationStore } from "../state/valuation.store";
import { useVapeAchievementsStore } from "../state/vape-achievements.store";

export function buildAchievementContext(): AchievementContext {
  const gens = useGeneratorStore.getState().generators;
  const intern = gens.find((g) => g.id === "intern")?.amount ?? 0;
  const vibe = gens.find((g) => g.id === "vibe_coder")?.amount ?? 0;
  const dev10 = gens.find((g) => g.id === "10x_dev")?.amount ?? 0;
  const innovationState = useInnovationStore.getState();
  const unlocks = innovationState.unlocks;
  const managerTierTotal = ManagerKeyValues.reduce(
    (sum, k) => sum + innovationState.managers[k].tier.floor().toNumber(),
    0,
  );

  const prestigeState = usePrestigeStore.getState();
  const valuationState = useValuationStore.getState();
  const totalMandateLevels = Object.values(valuationState.mandateLevels).reduce(
    (sum, lv) => sum + lv,
    0,
  );

  return {
    internCount: intern,
    vibeCoderCount: vibe,
    dev10xCount: dev10,
    money: useMoneyStore.getState().money.toNumber(),
    mps: useGeneratorStore.getState().getMoneyPerSecond(),
    innovation: innovationState.innovation.toNumber(),
    valuation: valuationState.valuation.toNumber(),
    managersUnlocked: unlocks.managers?.unlocked ?? false,
    employeeManagementUnlocked: unlocks.employeeManagement?.unlocked ?? false,
    purchasedUpgradeCount: useUpgradeStore.getState().unlockedUpgradeIds.length,
    managerTierTotal,
    aiSingularity: useAiSingularityStore.getState().value,
    exits: prestigeState.exits,
    allocatedNodes: prestigeState.allocated.length,
    totalMandateLevels,
    juiceUpgradeCount: useVapeAchievementsStore.getState().purchasedJuiceUpgradeIds.length,
  };
}

/** Achievements whose condition passes and are not in `unlockedIds` (for tests / batching). */
export function achievementsNewlyMet(
  ctx: AchievementContext,
  unlockedIds: ReadonlySet<string>,
): AchievementDef[] {
  return ACHIEVEMENT_CATALOG.filter(
    (ach) => !unlockedIds.has(ach.id) && ach.check(ctx),
  );
}

/**
 * Checks catalog against ctx; unlocks grant juice once. Shows toast per new unlock.
 */
export function evaluateAchievements(
  ctx: AchievementContext = buildAchievementContext(),
): void {
  const unlocked = new Set(
    useVapeAchievementsStore.getState().unlockedAchievementIds,
  );

  for (const ach of achievementsNewlyMet(ctx, unlocked)) {
    const isNew = useVapeAchievementsStore
      .getState()
      .recordAchievementUnlock(ach.id, ach.juiceReward);
    if (isNew) {
      unlocked.add(ach.id);
      toast.success(`${ach.name} — +${ach.juiceReward} vape juice`, {
        duration: 4000,
      });
    }
  }
}
