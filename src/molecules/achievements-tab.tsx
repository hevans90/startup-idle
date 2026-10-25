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
import { report } from "../state/comms.store";
import { twMerge } from "tailwind-merge";
import { ACHIEVEMENT_CATALOG } from "../game/achievements.catalog";
import { JUICE_SHOP_UPGRADES } from "../game/achievements.juice-shop";
import { useVapeAchievementsStore } from "../state/vape-achievements.store";
import { FOCUS, Locked, Num, Panel, POPOVER, Tile } from "../ui/console";
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

  const shop = (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(4rem,1fr))] gap-2">
      {JUICE_SHOP_UPGRADES.map((u) => {
        const bought = purchasedSet.has(u.id);
        const canBuy = hasVibeArmy && !bought && vapeJuice.gte(u.cost);
        const Icon = UPGRADE_ICONS[u.id] ?? IconSparkles;
        return (
          <Popover key={u.id} openOnHover placement="top">
            <PopoverTrigger asChild>
              <Tile lit={canBuy} aria-disabled={!canBuy}
                onClick={() => { if (canBuy && tryPurchaseJuiceUpgrade(u.id)) report(`${u.name} purchased`); }}
                className={twMerge("flex aspect-square flex-col items-center justify-center gap-1 p-1",
                  bought ? "border-good-line bg-good-soft text-good hover:bg-good-soft" : !canBuy && "cursor-not-allowed text-fg-muted")}>
                <Icon size={22} stroke={1.6} />
                <span className="text-[10px] tabular-nums">{bought ? "Owned" : u.cost}</span>
              </Tile>
            </PopoverTrigger>
            <PopoverContent className={twMerge(POPOVER, "flex max-w-[18rem] flex-col gap-1 p-2.5")}>
              <span className="text-sm font-bold">{u.name}</span>
              <span className="text-xs text-fg-muted">{u.description}</span>
              {u.minigameDescription && <span className="text-[11px] text-juice">🎮 {u.minigameDescription}</span>}
              <span className={twMerge("text-xs", bought ? "text-good" : canBuy ? "text-juice" : "text-fg-muted")}>
                {bought ? "✓ Owned" : `${u.cost} juice`}
              </span>
            </PopoverContent>
          </Popover>
        );
      })}
    </div>
  );

  return (
    <div className="flex w-full flex-col gap-3 p-2 text-sm">
      {/* THE SHOP: what juice buys; locked behind vibe_army (100 vibe coders). */}
      <Panel title="Vape shop" tone="juice"
        controls={<Num role="juice" className="font-display text-sm">{formatCurrency(vapeJuice, { showDollarSign: false, exponentBreakpoint: 1e9 })} <span className="text-[10px] text-fg-muted">juice</span></Num>}>
        {hasVibeArmy ? shop : <Locked needs="Hire 100 vibe coders to open the shop">{shop}</Locked>}
      </Panel>

      {/* THE ACHIEVEMENTS: earned, in good's colour; to come, dashed; hidden ones a "???". */}
      <Panel title="Achievements" controls={<span className="text-[11px] tabular-nums text-fg-muted">{unlockedCount} / {ACHIEVEMENT_CATALOG.length}</span>}>
        <div className="grid grid-cols-2 gap-1">
          {ACHIEVEMENT_CATALOG.map((a) => {
            const done = unlockedSet.has(a.id);
            const hiddenLocked = a.isHidden && !done;
            const label = hiddenLocked ? "???" : a.name;
            return (
              <Popover key={a.id} openOnHover placement="top">
                <PopoverTrigger asChild>
                  <div tabIndex={0}
                    className={twMerge(
                      "flex cursor-help items-center gap-1.5 border px-2 py-1 text-[11px] leading-tight", FOCUS,
                      done ? "border-good-line bg-good-soft text-good" : "border-dashed border-line-quiet text-fg-muted",
                    )}>
                    {done ? <IconTrophy size={13} className="shrink-0" /> : <IconLock size={13} className="shrink-0 opacity-60" />}
                    <span className="truncate">{label}</span>
                    <span className="ml-auto shrink-0 tabular-nums opacity-80">+{a.juiceReward}</span>
                  </div>
                </PopoverTrigger>
                <PopoverContent className={twMerge(POPOVER, "flex max-w-[18rem] flex-col gap-1 p-2.5")}>
                  <span className="text-sm font-bold">{hiddenLocked ? "Hidden achievement" : a.name}{done ? " ✓" : ""}</span>
                  {!hiddenLocked && <span className="text-xs text-fg-muted">{a.description}</span>}
                  <span className={twMerge("text-xs", done ? "text-good" : "text-fg-muted")}>{done ? "Earned" : "Reward"}: +{a.juiceReward} juice</span>
                </PopoverContent>
              </Popover>
            );
          })}
        </div>
      </Panel>
    </div>
  );
};
