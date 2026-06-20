import { useMemo } from "react";
import toast from "react-hot-toast";
import { ACHIEVEMENT_CATALOG } from "../game/achievements.catalog";
import { JUICE_SHOP_UPGRADES } from "../game/achievements.juice-shop";
import { useVapeAchievementsStore } from "../state/vape-achievements.store";
import { Button } from "../ui/Button";
import { InfoRow } from "../ui/InfoRow";
import { formatCurrency } from "../utils/money-utils";

export const AchievementsTab = () => {
  const vapeJuice = useVapeAchievementsStore((s) => s.vapeJuice);
  const unlockedIds = useVapeAchievementsStore((s) => s.unlockedAchievementIds);
  const purchasedIds = useVapeAchievementsStore(
    (s) => s.purchasedJuiceUpgradeIds,
  );
  const unlockedSet = useMemo(() => new Set(unlockedIds), [unlockedIds]);
  const purchasedSet = useMemo(() => new Set(purchasedIds), [purchasedIds]);
  const unlockedCount = useMemo(
    () => ACHIEVEMENT_CATALOG.filter((a) => unlockedSet.has(a.id)).length,
    [unlockedSet],
  );
  const tryPurchaseJuiceUpgrade = useVapeAchievementsStore(
    (s) => s.tryPurchaseJuiceUpgrade,
  );

  return (
    <div className="flex w-full flex-col gap-4 p-2 text-sm">
      <InfoRow
        label="Vape juice"
        value={formatCurrency(vapeJuice, {
          showDollarSign: false,
          exponentBreakpoint: 1e9,
        })}
        size="small"
      />
      <p className="text-xs opacity-80">
        Complete achievements to earn juice. Spend it on permanent bonuses
        below.
      </p>

      <div>
        <p className="mb-2 text-xs font-bold uppercase tracking-wide text-primary-600 dark:text-primary-400">
          Juice shop
        </p>
        <ul className="flex flex-col gap-2">
          {JUICE_SHOP_UPGRADES.map((u) => {
            const bought = purchasedSet.has(u.id);
            const canBuy = !bought && vapeJuice.gte(u.cost);
            return (
              <li
                key={u.id}
                className="border border-primary-400 dark:border-primary-600 p-2 flex flex-col gap-1"
              >
                <span className="font-medium">{u.name}</span>
                <span className="text-xs opacity-80">{u.description}</span>
                <Button
                  type="button"
                  className="mt-1 text-xs"
                  disabled={bought || !canBuy}
                  onClick={() => {
                    if (tryPurchaseJuiceUpgrade(u.id)) {
                      toast.success(`${u.name} purchased`);
                    }
                  }}
                >
                  {bought ? "Owned" : `${u.cost} juice`}
                </Button>
              </li>
            );
          })}
        </ul>
      </div>

      <div>
        <div className="mb-2 flex items-baseline justify-between gap-2">
          <p className="text-xs font-bold uppercase tracking-wide text-primary-600 dark:text-primary-400">
            Achievements
          </p>
          <span className="text-xs tabular-nums opacity-70">
            {unlockedCount} / {ACHIEVEMENT_CATALOG.length} unlocked
          </span>
        </div>
        <ul className="flex max-h-[min(50vh,28rem)] flex-col gap-1 overflow-y-auto pr-1">
          {ACHIEVEMENT_CATALOG.map((a) => {
            const done = unlockedSet.has(a.id);
            const hiddenLocked = a.isHidden && !done;
            return (
              <li
                key={a.id}
                className="border border-primary-300/80 px-2 py-1.5 text-xs dark:border-primary-600/80"
              >
                <div className="flex justify-between gap-2">
                  <span className="font-medium">
                    {hiddenLocked ? "???" : a.name}
                    {done ? " ✓" : ""}
                  </span>
                  {!done && !hiddenLocked && (
                    <span className="shrink-0 opacity-70">
                      +{a.juiceReward}
                    </span>
                  )}
                  {done && (
                    <span className="shrink-0 text-emerald-600 dark:text-emerald-400">
                      +{a.juiceReward}
                    </span>
                  )}
                </div>
                {!hiddenLocked && (
                  <p className="mt-0.5 opacity-75">{a.description}</p>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
};
