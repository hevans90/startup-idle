import { GENERATOR_TYPES } from "../state/generators.store";
import { useMoneyStore } from "../state/money.store";
import {
  GeneratorEffect,
  Upgrade,
  useUpgradeStore,
} from "../state/upgrades.store";
import { Button } from "../ui/Button";
import { formatCurrency } from "../utils/money-utils";

const UpgradeSummary = ({ upg }: { upg: Upgrade }) => {
  const renderEffect = (effect: GeneratorEffect) => {
    switch (effect.type) {
      case "multiplier":
        return (
          <>
            mult:{" "}
            <span className="text-green-700 dark:text-green-400">
              x{effect.value}
            </span>
          </>
        );

      case "costMultiplier": {
        const discount = Math.round((1 - effect.value) * 100);
        const isGood = discount > 0;
        return (
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
      }

      case "costExponent": {
        const isGood = effect.delta < 0;
        const sign = effect.delta > 0 ? "+" : "";
        return (
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
      }

      default:
        return null;
    }
  };

  return (
    <div className="flex items-center justify-center">
      <table className="text-xs w-auto table-auto border-separate border-spacing-x-4">
        <tbody>
          {upg.effects.map((effectBlock, i) => {
            const genName =
              GENERATOR_TYPES.find((gen) => gen.id === effectBlock.genId)
                ?.name || effectBlock.genId;

            return (
              <tr key={i} className="border-b last:border-none">
                <td className="font-bold whitespace-nowrap text-primary-900 dark:text-primary-50">
                  {genName}
                </td>
                {effectBlock.changes.map((effect, index) => (
                  <td key={index} className="text-left">
                    {renderEffect(effect)}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
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
            className="flex flex-col gap-2 max-w-[28rem] p-4"
            onClick={() => unlockUpgrade(upg.id)}
          >
            <div className="text-md mb-1">
              <span className="underline-offset-2 underline">{upg.name}</span>:{" "}
              {formatCurrency(upg.cost)}
            </div>
            <div className="text-xs text-primary-500 dark:text-primary-300 grow">
              {upg.description}
            </div>
            <UpgradeSummary upg={upg} />
          </Button>
        ))}
      </div>
      <div className="flex flex-wrap justify-center gap-2 mt-6">
        {unlockedUpgrades.map((upg) => (
          <div
            key={upg.id}
            className="text-sm opacity-50 border-[1px] border-solid border-primary-500 p-2 flex flex-col gap-2 items-center px-4 "
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
