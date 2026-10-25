import { useShallow } from "zustand/shallow";
import { useInnovationStore } from "../state/innovation.store";
import { useValuationStore } from "../state/valuation.store";
import { ModifierTag } from "../ui/ModifierTag";
import { formatCurrency } from "../utils/money-utils";
import { Locked, Panel, Stat, StatGrid } from "../ui/console";
import { useGlobalSettingsStore } from "../state/global-settings.store";
import { ValuationMandatesPanel } from "./innovation/valuation-mandates-panel";

export const ValuationTab = () => {
  const managersUnlocked = useInnovationStore(
    (s) => s.unlocks.managers?.unlocked,
  );
  const setTab = useGlobalSettingsStore((s) => s.setSidebarTab);
  const valuation = useValuationStore((s) => s.valuation);
  const board = useValuationStore(useShallow((s) => s.getEconomyMultipliers()));

  if (!managersUnlocked) {
    return (
      <div className="p-2 pt-4">
        <Locked needs="Unlock Managers on the Innovation tab to accrue valuation and buy board mandates" onShow={() => setTab("innovation")} />
      </div>
    );
  }

  return (
    <div className="flex w-full flex-col gap-3 p-2">
      <StatGrid>
        <Stat label="Valuation" value={formatCurrency(valuation, { showDollarSign: false })} role="valuation" />
        <Stat label={<ModifierTag modKey="mandateMoney">Money</ModifierTag>} value={`×${board.money.toFixed(2)}`} role="money" />
        <Stat label={<ModifierTag modKey="mandateInnovation">Innovation</ModifierTag>} value={`×${board.innovation.toFixed(2)}`} role="innovation" />
      </StatGrid>
      <Panel title="Board mandates" help="Valuation accrues from revenue (boosted by Sales). Buy mandates for global bonuses.">
        <ValuationMandatesPanel />
      </Panel>
    </div>
  );
};
