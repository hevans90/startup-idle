import {
  IconAtom,
  IconBattery,
  IconBolt,
  IconBox,
  IconCloud,
  IconCpu,
  IconDiamond,
  IconDroplet,
  IconFlame,
  IconHexagon,
  IconLock,
  IconSparkles,
  IconStack2,
  IconTrophy,
  type Icon as TablerIcon,
} from "@tabler/icons-react";
import Decimal from "break_infinity.js";
import { useMemo } from "react";
import toast from "react-hot-toast";
import { twMerge } from "tailwind-merge";
import { ACHIEVEMENT_CATALOG } from "../game/achievements.catalog";
import { JUICE_SHOP_UPGRADES } from "../game/achievements.juice-shop";
import { useVapeAchievementsStore } from "../state/vape-achievements.store";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/Popover";
import { isLocalDev } from "../utils/dev-mode";
import { formatCurrency } from "../utils/money-utils";

/** A distinct vape-themed glyph per juice-shop upgrade. */
const UPGRADE_ICONS: Record<string, TablerIcon> = {
  juice_coil_polish: IconBolt,
  juice_wick_soak: IconDroplet,
  juice_cloud_chaser: IconCloud,
  juice_deep_steep: IconFlame,
  juice_sub_ohm: IconBattery,
  juice_max_vg: IconSparkles,
  juice_nicotine_shot: IconAtom,
  juice_ceramic_coil: IconDiamond,
  juice_triple_coil: IconStack2,
  juice_squonk_mod: IconBox,
  juice_mesh_coil: IconHexagon,
  juice_dna_chip: IconCpu,
};

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
    <div className="flex w-full flex-col gap-3 p-2 text-sm">
      {/* Dev-only (localhost) juice grant for testing the vape upgrades. */}
      {isLocalDev() && (
        <button
          type="button"
          onClick={() =>
            useVapeAchievementsStore.setState({ vapeJuice: new Decimal(1e9) })
          }
          className="cursor-pointer rounded border border-dashed border-amber-500 px-2 py-1 text-xs text-amber-600 dark:text-amber-400"
        >
          🧪 dev: grant 1B juice
        </button>
      )}

      {/* Juice balance + shop header */}
      <div className="flex items-baseline justify-between">
        <p className="text-xs font-bold uppercase tracking-wide text-primary-600 dark:text-primary-400">
          Vape shop
        </p>
        <span className="tabular-nums text-sm font-bold text-violet-600 dark:text-violet-400">
          {formatCurrency(vapeJuice, {
            showDollarSign: false,
            exponentBreakpoint: 1e9,
          })}{" "}
          <span className="text-xs font-normal opacity-60">juice</span>
        </span>
      </div>

      {/* Upgrade grid */}
      <div className="flex flex-wrap gap-2">
        {JUICE_SHOP_UPGRADES.map((u) => {
          const bought = purchasedSet.has(u.id);
          const canBuy = !bought && vapeJuice.gte(u.cost);
          const Icon = UPGRADE_ICONS[u.id] ?? IconSparkles;
          return (
            <Popover key={u.id} openOnHover placement="top">
              <PopoverTrigger asChild>
                <button
                  type="button"
                  aria-disabled={!canBuy}
                  onClick={() => {
                    if (canBuy && tryPurchaseJuiceUpgrade(u.id)) {
                      toast.success(`${u.name} purchased`);
                    }
                  }}
                  className={twMerge(
                    "flex h-16 w-16 flex-col items-center justify-center gap-1 rounded border p-1 transition-colors",
                    bought
                      ? "border-emerald-500/60 bg-emerald-500/15 text-emerald-600 dark:text-emerald-300"
                      : canBuy
                        ? "cursor-pointer border-primary-400 hover:bg-primary-100 dark:border-primary-600 dark:hover:bg-primary-700"
                        : "cursor-not-allowed border-primary-300 text-primary-400 opacity-60 dark:border-primary-700",
                  )}
                >
                  <Icon size={22} stroke={1.6} />
                  <span className="text-[10px] font-medium tabular-nums">
                    {bought ? "Owned" : u.cost}
                  </span>
                </button>
              </PopoverTrigger>
              <PopoverContent className="bg-primary-100 dark:bg-primary-800 outline-none focus:ring-0 max-w-[18rem] border-primary-400 border-solid border-[1px] p-2 flex flex-col gap-1">
                <span className="text-sm font-medium">{u.name}</span>
                <span className="text-xs opacity-80">{u.description}</span>
                {u.minigameDescription && (
                  <span className="text-[11px] text-violet-400/80">
                    🎮 {u.minigameDescription}
                  </span>
                )}
                <span
                  className={twMerge(
                    "text-xs font-medium",
                    bought
                      ? "text-emerald-600 dark:text-emerald-400"
                      : canBuy
                        ? ""
                        : "text-primary-500",
                  )}
                >
                  {bought ? "✓ Owned" : `Cost: ${u.cost} juice`}
                </span>
              </PopoverContent>
            </Popover>
          );
        })}
      </div>

      {/* Achievements — compact grid, strong locked/unlocked contrast. */}
      <div>
        <div className="mb-2 flex items-baseline justify-between gap-2">
          <p className="text-xs font-bold uppercase tracking-wide text-primary-600 dark:text-primary-400">
            Achievements
          </p>
          <span className="text-xs tabular-nums opacity-70">
            {unlockedCount} / {ACHIEVEMENT_CATALOG.length} unlocked
          </span>
        </div>
        <div className="grid grid-cols-2 gap-1">
          {ACHIEVEMENT_CATALOG.map((a) => {
            const done = unlockedSet.has(a.id);
            const hiddenLocked = a.isHidden && !done;
            const label = hiddenLocked ? "???" : a.name;
            return (
              <Popover key={a.id} openOnHover placement="top">
                <PopoverTrigger asChild>
                  <div
                    className={twMerge(
                      "flex cursor-help items-center gap-1 rounded border px-1.5 py-1 text-[11px] leading-tight",
                      done
                        ? "border-emerald-500/50 bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
                        : "border-dashed border-primary-300 text-primary-500 opacity-70 dark:border-primary-600 dark:text-primary-400",
                    )}
                  >
                    {done ? (
                      <IconTrophy size={13} className="shrink-0" />
                    ) : (
                      <IconLock size={13} className="shrink-0" />
                    )}
                    <span className="truncate">{label}</span>
                    <span className="ml-auto shrink-0 tabular-nums opacity-80">
                      +{a.juiceReward}
                    </span>
                  </div>
                </PopoverTrigger>
                <PopoverContent className="bg-primary-100 dark:bg-primary-800 outline-none focus:ring-0 max-w-[18rem] border-primary-400 border-solid border-[1px] p-2 flex flex-col gap-1">
                  <span className="text-sm font-medium">
                    {hiddenLocked ? "Hidden achievement" : a.name}
                    {done ? " ✓" : ""}
                  </span>
                  {!hiddenLocked && (
                    <span className="text-xs opacity-80">{a.description}</span>
                  )}
                  <span
                    className={twMerge(
                      "text-xs font-medium",
                      done
                        ? "text-emerald-600 dark:text-emerald-400"
                        : "text-primary-500",
                    )}
                  >
                    {done ? "Earned" : "Reward"}: +{a.juiceReward} juice
                  </span>
                </PopoverContent>
              </Popover>
            );
          })}
        </div>
      </div>
    </div>
  );
};
