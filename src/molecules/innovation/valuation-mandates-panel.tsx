import { MANDATES, useValuationStore } from "../../state/valuation.store";
import { Button } from "../../ui/Button";
import { InfoRow } from "../../ui/InfoRow";
import { formatCurrency } from "../../utils/money-utils";

export const ValuationMandatesPanel = () => {
  const valuation = useValuationStore((s) => s.valuation);
  const mandateLevels = useValuationStore((s) => s.mandateLevels);
  const purchaseMandate = useValuationStore((s) => s.purchaseMandate);
  const canAffordMandate = useValuationStore((s) => s.canAffordMandate);
  const getMandateCost = useValuationStore((s) => s.getMandateCost);

  return (
    <div className="flex flex-col gap-3 w-full text-sm">
      <div className="px-1">
        <InfoRow
          label="Valuation"
          value={formatCurrency(valuation, { showDollarSign: false })}
          size="small"
        />
        <p className="text-xs opacity-70 text-left mt-1">
          Passive valuation from revenue (scaled by Sales manager tier). Spend
          it on board mandates for permanent global bonuses.
        </p>
      </div>

      <div className="flex flex-col gap-2 px-2 pb-2">
        {MANDATES.map((m) => {
          const level = mandateLevels[m.id];
          const cost = getMandateCost(m.id);
          const affordable = canAffordMandate(m.id);
          const maxed = level >= m.maxLevel;
          return (
            <div
              key={m.id}
              className="border border-primary-400 dark:border-primary-600 p-2 flex flex-col gap-1"
            >
              <div className="flex justify-between gap-2">
                <span className="font-medium">{m.name}</span>
                <span className="text-xs opacity-70">
                  Lv {level}/{m.maxLevel}
                </span>
              </div>
              <p className="text-xs opacity-80 text-left">{m.description}</p>
              <Button
                className="text-xs mt-1"
                disabled={maxed || !affordable}
                onClick={() => purchaseMandate(m.id)}
              >
                {maxed
                  ? "Maxed"
                  : `Buy (${formatCurrency(cost, { showDollarSign: false })})`}
              </Button>
            </div>
          );
        })}
      </div>
    </div>
  );
};
