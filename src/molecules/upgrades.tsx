import { useMemo } from "react";
import { GENERATOR_TYPES } from "../state/generators.store";
import { useMoneyStore } from "../state/money.store";
import {
  GeneratorEffect,
  Upgrade,
  useUpgradeStore,
} from "../state/upgrades.store";
import { Button } from "../ui/Button";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/Popover";
import { formatCurrency } from "../utils/money-utils";
import { RainbowText } from "../utils/vibe-utils";

/**
 * Which progression "set" an upgrade belongs to (by id prefix). Within a set we
 * only ever surface the next (cheapest available) upgrade, so a generator's
 * upgrades reveal one at a time instead of dumping the whole tier list at once.
 */
const upgradeSet = (u: Upgrade): string => {
  if (u.id.startsWith("10x_dev")) return "10x_dev";
  if (u.id.startsWith("vibe_coder")) return "vibe_coder";
  if (u.id.startsWith("cross")) return "cross";
  if (u.id.startsWith("intern")) return "intern";
  return u.id;
};

/**
 * Keep only the cheapest available upgrade per set. `availableUpgrades` is
 * already cost-sorted ascending, so the first one seen per set is the next to
 * reveal; the rest stay hidden until it's purchased.
 */
const nextPerSet = (available: Upgrade[]): Upgrade[] => {
  const seen = new Set<string>();
  const out: Upgrade[] = [];
  for (const u of available) {
    const set = upgradeSet(u);
    if (seen.has(set)) continue;
    seen.add(set);
    out.push(u);
  }
  return out;
};

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
      <table className="responsive-text-xs w-auto table-auto border-separate border-spacing-x-4">
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

export const Upgrades = ({ isMobile }: { isMobile: boolean }) => {
  const { availableUpgrades, unlockedUpgrades, unlockUpgrade } =
    useUpgradeStore();

  // Reveal only the next upgrade per set (the rest of the tier stays hidden).
  const visibleUpgrades = useMemo(
    () => nextPerSet(availableUpgrades),
    [availableUpgrades],
  );

  const { money } = useMoneyStore();

  return isMobile ? (
    <>
      <div className="flex flex-wrap gap-3 justify-center text-center">
        {visibleUpgrades.map((upg) => (
          <Button
            disabled={money.lt(upg.cost)}
            key={upg.id}
            className="flex flex-col gap-2 w-full p-4"
            onClick={() => unlockUpgrade(upg.id)}
          >
            <div className="responsive-text mb-1">
              <span className="underline-offset-2 underline">{upg.name}</span>:{" "}
              {formatCurrency(upg.cost)}
            </div>
            <div className="responsive-text-xs text-primary-500 dark:text-primary-300 grow">
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
            className="responsive-text-sm opacity-50 border-[1px] border-solid border-primary-500 p-2 flex flex-col gap-2 items-center px-4 "
          >
            {upg.name}
            <UpgradeSummary upg={upg} />
          </div>
        ))}
      </div>
    </>
  ) : (
    <>
      <div className="flex flex-col gap-3 justify-center items-center px-2">
        {visibleUpgrades.map((upg) => (
          <Popover key={upg.id} openOnHover={true} placement="bottom">
            <PopoverTrigger asChild>
              <Button
                disabled={money.lt(upg.cost)}
                key={upg.id}
                className="flex w-full p-4 responsive-text-sm"
                onClick={() => unlockUpgrade(upg.id)}
              >
                {upg.id.includes("vibe_coder") ? (
                  <>
                    <RainbowText text={upg.name} />
                    <span>: {formatCurrency(upg.cost)}</span>
                  </>
                ) : (
                  <>
                    {upg.name}: {formatCurrency(upg.cost)}
                  </>
                )}
              </Button>
            </PopoverTrigger>

            <PopoverContent className="bg-primary-100 dark:bg-primary-800 outline-none focus:ring-0 max-w-[39rem] border-primary-400 border-solid border-[1px] p-2 flex flex-col gap-2">
              <div className="responsive-text-xs text-primary-500 dark:text-primary-300 grow text-center">
                {upg.description}
              </div>
              <UpgradeSummary upg={upg} />
            </PopoverContent>
          </Popover>
        ))}
      </div>
      <div className="flex flex-wrap gap-3 text-center px-2">
        {unlockedUpgrades.map((upg) => (
          <Popover key={upg.id} openOnHover={true} placement="bottom">
            <PopoverTrigger asChild>
              <div
                key={upg.id}
                className="bg-primary-300 dark:bg-primary-700 cursor-help p-2 responsive-text-xs"
              >
                {upg.id.includes("vibe_coder") ? (
                  <RainbowText text={upg?.abbreviation ?? "UPG"} />
                ) : (
                  <>{upg?.abbreviation ?? "UPG"}</>
                )}
              </div>
            </PopoverTrigger>

            <PopoverContent className="bg-primary-100 dark:bg-primary-800 outline-none focus:ring-0 w-[26rem] border-primary-400 border-solid border-[1px] p-2 flex flex-col items-center gap-2">
              <span className="flex responsive-text-xs">
                {upg.id.includes("vibe_coder") ? (
                  <>
                    <RainbowText text={upg.name} />
                    <span>: {formatCurrency(upg.cost)}</span>
                  </>
                ) : (
                  <>
                    {upg.name}: {formatCurrency(upg.cost)}
                  </>
                )}
              </span>
              <div className="responsive-text-xs text-primary-500 dark:text-primary-300 grow text-center">
                {upg.description}
              </div>
              <UpgradeSummary upg={upg} />
            </PopoverContent>
          </Popover>
        ))}
      </div>
    </>
  );
};
