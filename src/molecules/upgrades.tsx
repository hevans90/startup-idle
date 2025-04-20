import { useMoneyStore } from "../state/money.store";
import {
  getUpgradeSummary,
  Upgrade,
  useUpgradeStore,
} from "../state/upgrades.store";
import { Button } from "../ui/Button";
import { formatCurrency } from "../utils/money-utils";

const UpgradeSummary = ({ upg }: { upg: Upgrade }) => (
  <div className="flex flex-col text-xs">{getUpgradeSummary(upg)}</div>
);

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
              {upg.name}: {formatCurrency(upg.cost)}
            </div>
            <div className="text-xs">{upg.description}</div>
            <UpgradeSummary upg={upg} />
          </Button>
        ))}
      </section>
      <section className="flex flex-wrap justify-center gap-2">
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
      </section>
    </>
  );
};
