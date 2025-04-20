import { GENERATOR_TYPES } from "../state/generators.store";
import { useMoneyStore } from "../state/money.store";
import { Upgrade, useUpgradeStore } from "../state/upgrades.store";
import { Button } from "../ui/Button";
import { formatCurrency } from "../utils/money-utils";

const UpgradeSummary = ({ upg }: { upg: Upgrade }) => {
  const genName = GENERATOR_TYPES.find(
    (gen) => gen.id === upg.effects.genId
  )?.name;

  const renderEffect = (
    effect: (typeof upg.effects.changes)[number],
    index: number,
    total: number
  ) => {
    let content;

    switch (effect.type) {
      case "multiplier":
        content = (
          <>
            multiplier:{" "}
            <span className="text-green-700 dark:text-green-400">
              x{effect.value}
            </span>
          </>
        );
        break;

      case "costMultiplier": {
        const discount = Math.round((1 - effect.value) * 100);
        const isGood = discount > 0;
        content = (
          <>
            cost:{" "}
            <span
              className={
                isGood
                  ? "text-green-700 dark:text-green-400"
                  : "text-red-700 dark:text-red-400"
              }
            >
              {isGood ? "-" : "+"}
              {Math.abs(discount)}%
            </span>
          </>
        );
        break;
      }

      case "costExponent": {
        const isGood = effect.delta < 0;
        const sign = effect.delta > 0 ? "+" : "";
        content = (
          <>
            exponent:{" "}
            <span
              className={
                isGood
                  ? "text-green-700 dark:text-green-400"
                  : "text-red-700 dark:text-red-400"
              }
            >
              {sign}
              {effect.delta.toFixed(2)}
            </span>
          </>
        );
        break;
      }

      default:
        return null;
    }

    return (
      <span key={index} className="flex items-center gap-2">
        {content}
        {index < total - 1 && <span className="text-muted-foreground">|</span>}
      </span>
    );
  };

  return (
    <div className="flex w-full justify-center gap-2 text-xs flex-wrap">
      <span className="font-extrabold">{genName}</span>
      <span className="text-muted-foreground">|</span>
      {upg.effects.changes.map((effect, index) =>
        renderEffect(effect, index, upg.effects.changes.length)
      )}
    </div>
  );
};

export const Upgrades = () => {
  const { availableUpgrades, unlockedUpgrades, unlockUpgrade } =
    useUpgradeStore();

  const { money } = useMoneyStore();

  return (
    <>
      <div className="flex flex-wrap gap-3 justify-center text-center">
        {availableUpgrades.map((upg) => (
          <Button
            disabled={money.lt(upg.cost)}
            key={upg.id}
            className="flex flex-col gap-2"
            onClick={() => unlockUpgrade(upg.id)}
          >
            <div className="text-md mb-1">
              {upg.name}: {formatCurrency(upg.cost)}
            </div>
            <div className="text-xs">{upg.description}</div>
            <UpgradeSummary upg={upg} />
          </Button>
        ))}
      </div>
      <div className="flex flex-wrap justify-center gap-2 mt-6">
        {unlockedUpgrades.map((upg) => (
          <div
            key={upg.id}
            className="text-sm opacity-50 border-[1px] border-solid border-primary-500 p-2 flex flex-col gap-2 items-center"
            title={upg.description}
          >
            {upg.name}
            <UpgradeSummary upg={upg} />
          </div>
        ))}
      </div>
    </>
  );
};
