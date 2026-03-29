import { useEffect, useMemo, useRef, useState } from "react";
import { ClassNameValue, twMerge } from "tailwind-merge";
import {
  collectNewsMessages,
  NEWS_ROTATION_MS,
} from "../game/game-stage-messages";
import { useGeneratorStore } from "../state/generators.store";
import {
  ManagerKeyValues,
  useInnovationStore,
} from "../state/innovation.store";
import { useMoneyStore } from "../state/money.store";
import { useUpgradeStore } from "../state/upgrades.store";

export const GameStageTicker = ({ className }: { className?: ClassNameValue }) => {
  const internAmount = useGeneratorStore(
    (s) => s.generators.find((g) => g.id === "intern")?.amount ?? 0
  );
  const vibeAmount = useGeneratorStore(
    (s) => s.generators.find((g) => g.id === "vibe_coder")?.amount ?? 0
  );
  const dev10xAmount = useGeneratorStore(
    (s) => s.generators.find((g) => g.id === "10x_dev")?.amount ?? 0
  );

  const hasPositiveMps = useGeneratorStore((s) => s.getMoneyPerSecond() > 0);
  const lowMps = useGeneratorStore((s) => s.getMoneyPerSecond() < 0.5);
  const lowMoney = useMoneyStore((s) => s.money.lt(50));

  const innovationBelowOne = useInnovationStore((s) => s.innovation.lt(1));
  const innovationEarly = useInnovationStore(
    (s) => s.innovation.gte(1) && s.innovation.lt(5)
  );
  const innovationFivePlus = useInnovationStore((s) => s.innovation.gte(5));

  const managersUnlocked = useInnovationStore((s) => s.unlocks.managers?.unlocked ?? false);
  const employeeMgmtUnlocked = useInnovationStore(
    (s) => s.unlocks.employeeManagement?.unlocked ?? false
  );
  const upgradeCount = useUpgradeStore((s) => s.unlockedUpgradeIds.length);
  const managerTierTotal = useInnovationStore((s) =>
    ManagerKeyValues.reduce(
      (sum, k) => sum + s.managers[k].tier.floor().toNumber(),
      0
    )
  );

  const isBrokeNews = lowMoney && lowMps && internAmount > 0;

  const messages = useMemo(
    () =>
      collectNewsMessages({
        internAmount,
        vibeAmount,
        dev10xAmount,
        hasPositiveMps,
        innovationBelowOne,
        innovationEarly,
        innovationFivePlus,
        isBrokeNews,
        managersUnlocked,
        employeeMgmtUnlocked,
        managerTierTotal,
        upgradeCount,
      }),
    [
      internAmount,
      vibeAmount,
      dev10xAmount,
      hasPositiveMps,
      innovationBelowOne,
      innovationEarly,
      innovationFivePlus,
      isBrokeNews,
      managersUnlocked,
      employeeMgmtUnlocked,
      managerTierTotal,
      upgradeCount,
    ]
  );

  const poolKey = useMemo(() => messages.join("\u241e"), [messages]);

  const messagesRef = useRef(messages);
  messagesRef.current = messages;

  const [index, setIndex] = useState(0);

  useEffect(() => {
    setIndex(0);
  }, [poolKey]);

  useEffect(() => {
    if (messagesRef.current.length <= 1) return;
    const id = window.setInterval(() => {
      setIndex((i) => {
        const len = messagesRef.current.length;
        if (len <= 1) return 0;
        return (i + 1) % len;
      });
    }, NEWS_ROTATION_MS);
    return () => window.clearInterval(id);
  }, [poolKey]);

  const current = messages[index] ?? "";

  return (
    <div
      className={twMerge(
        "flex h-8 items-center justify-center overflow-hidden border-b border-primary-300 dark:border-primary-600 bg-primary-100/95 dark:bg-primary-800/95 px-4 backdrop-blur-sm",
        className
      )}
      title={current}
      role="status"
      aria-live="polite"
      aria-atomic="true"
    >
      <p
        key={current}
        className="news-line-enter max-w-full truncate text-center text-xs tracking-tight text-primary-800 dark:text-primary-400"
      >
        {current}
      </p>
    </div>
  );
};
