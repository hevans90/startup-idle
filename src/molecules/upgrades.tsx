import { useMoneyStore } from "../state/money.store";
import { useUpgradeStore } from "../state/upgrades.store";
import { Button } from "../ui/Button";

export const Upgrades = () => {
  const { availableUpgrades, unlockedUpgrades, unlockUpgrade } =
    useUpgradeStore();

  const { money } = useMoneyStore();

  return (
    <>
      <section className="flex flex-col gap-3 items-center text-center">
        {availableUpgrades.map((upg) => (
          <Button
            disabled={money.lt(upg.cost)}
            key={upg.id}
            className="flex flex-col gap-2"
            onClick={() => unlockUpgrade(upg.id)}
          >
            <div className="text-md">
              {upg.name}: ${upg.cost}
            </div>
            <div className="text-xs">{upg.description}</div>
          </Button>
        ))}
      </section>
      <section className="flex flex-wrap gap-2">
        {unlockedUpgrades.map((upg) => (
          <div
            key={upg.id}
            className="text-sm opacity-50 border-[1px] border-solid border-primary-500 p-2"
            title={upg.description}
          >
            {upg.name}
          </div>
        ))}
      </section>
    </>
  );
};
