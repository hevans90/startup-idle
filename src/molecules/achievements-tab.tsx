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
import { useMemo } from "react";
import toast from "react-hot-toast";
import { twMerge } from "tailwind-merge";
import { ACHIEVEMENT_CATALOG } from "../game/achievements.catalog";
import { JUICE_SHOP_UPGRADES } from "../game/achievements.juice-shop";
import { useVapeAchievementsStore } from "../state/vape-achievements.store";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/Popover";
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
  const hasVibeArmy = unlockedIds.includes("vibe_army");
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
    <div className="flex h-full w-full flex-col overflow-hidden p-2 text-sm">
      {/* Vape shop — locked behind vibe_army achievement; pinned, never scrolls */}
      <div className="relative shrink-0 pb-3">
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
        <div className="mt-2 flex flex-wrap gap-2">
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

        {/* Lock overlay — until vibe_army (100 vibe coders) is earned */}
        {!hasVibeArmy && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-primary-900/40 backdrop-blur-xl dark:bg-primary-950/50">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="drop-shadow-md"
            >
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
              <path d="M7 11V7a5 5 0 0 1 10 0v4" />
            </svg>
            <span className="px-4 text-center text-[11px] font-semibold leading-snug drop-shadow-sm">
              Hire 100 vibe coders to unlock the shop
            </span>
          </div>
        )}
      </div>

      {/* Achievements — header pinned, grid scrolls */}
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="mb-2 flex shrink-0 items-baseline justify-between gap-2">
          <p className="text-xs font-bold uppercase tracking-wide text-primary-600 dark:text-primary-400">
            Achievements
          </p>
          <span className="text-xs tabular-nums opacity-70">
            {unlockedCount} / {ACHIEVEMENT_CATALOG.length} unlocked
          </span>
        </div>
        <div className="grid min-h-0 flex-1 auto-rows-min grid-cols-2 gap-1 overflow-y-auto">
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
