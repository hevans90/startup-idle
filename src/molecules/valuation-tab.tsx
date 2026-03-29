import { getValuationEconomyMultipliers } from "../game/economy-multipliers";
import { useInnovationStore } from "../state/innovation.store";
import { InfoRow } from "../ui/InfoRow";
import { SystemPanel } from "../ui/SystemPanel";
import { ValuationMandatesPanel } from "./innovation/valuation-mandates-panel";

export const ValuationTab = () => {
  const managersUnlocked = useInnovationStore(
    (s) => s.unlocks.managers?.unlocked
  );
  const board = getValuationEconomyMultipliers();

  if (!managersUnlocked) {
    return (
      <div className="p-4 text-center text-sm text-primary-600 dark:text-primary-300">
        Unlock <span className="font-medium">Managers</span> on the Innovation
        tab to accrue valuation and buy board mandates.
      </div>
    );
  }

  return (
    <div className="p-2 pt-4 w-full flex flex-col gap-4 items-center">
      <div className="w-64">
        <InfoRow
          label="Board mandates ($ / IPS)"
          value={`x${board.money.toFixed(2)} / x${board.innovation.toFixed(2)}`}
          size="small"
        />
      </div>
      <SystemPanel
        title="Board & valuation"
        help="Valuation accrues from revenue (boosted by Sales). Buy mandates for global bonuses."
        className="w-full"
      >
        <ValuationMandatesPanel />
      </SystemPanel>
    </div>
  );
};
