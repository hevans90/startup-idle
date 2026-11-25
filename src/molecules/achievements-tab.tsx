import { IconLock, IconTrophy } from "@tabler/icons-react";
import { lazy, Suspense, useMemo } from "react";
import { twMerge } from "tailwind-merge";
import { ACHIEVEMENT_CATALOG } from "../game/achievements.catalog";
import { useVapeAchievementsStore } from "../state/vape-achievements.store";
import { FOCUS, Locked, Panel, PopCard, POPOVER_BARE } from "../ui/console";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/Popover";

const StillPanel = lazy(() => import("./still/still-panel").then((m) => ({ default: m.StillPanel })));

export const AchievementsTab = () => {
  const unlockedIds = useVapeAchievementsStore((s) => s.unlockedAchievementIds);
  const hasVibeArmy = unlockedIds.includes("vibe_army");
  const unlockedSet = useMemo(() => new Set(unlockedIds), [unlockedIds]);
  const unlockedCount = useMemo(
    () => ACHIEVEMENT_CATALOG.filter((a) => unlockedSet.has(a.id)).length,
    [unlockedSet],
  );

  return (
    <div className="flex w-full flex-col gap-3 p-2 text-sm">
      {/* THE SHOP: what juice is poured into; locked behind vibe_army (100 vibe coders). */}
      {hasVibeArmy
        ? <Suspense fallback={<Panel title="Vape shop" tone="juice">{null}</Panel>}><StillPanel /></Suspense>
        : <Panel title="Vape shop" tone="juice"><Locked needs="Hire 100 vibe coders to open the shop" /></Panel>}

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
                <PopoverContent className={POPOVER_BARE}>
                  <PopCard title={hiddenLocked ? "Hidden achievement" : a.name} value={`+${a.juiceReward}`} tone={done ? "good" : "juice"}
                    icon={done ? <IconTrophy size={13} /> : <IconLock size={13} />}
                    foot={done ? "Earned." : `Earn it for ${a.juiceReward} juice.`}>
                    {!hiddenLocked && <p className="text-fg-muted">{a.description}</p>}
                  </PopCard>
                </PopoverContent>
              </Popover>
            );
          })}
        </div>
      </Panel>
    </div>
  );
};
