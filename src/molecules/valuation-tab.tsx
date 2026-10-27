import { useShallow } from "zustand/shallow";
import { useValuationStore } from "../state/valuation.store";
import { ModifierTag } from "../ui/ModifierTag";
import { formatCurrency } from "../utils/money-utils";
import { Panel, Stat, StatGrid } from "../ui/console";
import { ValuationMandatesPanel } from "./innovation/valuation-mandates-panel";

export const ValuationTab = () => {
  const valuation = useValuationStore((s) => s.valuation);
  const board = useValuationStore(useShallow((s) => s.getEconomyMultipliers()));

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
