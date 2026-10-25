import { useGeneratorStore } from "../state/generators.store";
import { PopCard, PopGroup, PopRow } from "../ui/console";
import { ModifierTag } from "../ui/ModifierTag";
import { formatCurrency } from "../utils/money-utils";
import { formatRate } from "../utils/rate-utils";

const mult = (m: number) => `×${m.toFixed(2)}`;
const isActive = (m: number) => Math.abs(m - 1) > 1e-9;

/**
 * Breakdown of where valuation/sec comes from, laid out like the money and
 * innovation popovers: a bold total, the revenue "engine" it's built from, then
 * the multipliers scaling it.
 */
export const ValuationSummary = () => {
  // Subscribe to a PRIMITIVE so the popover refreshes, then read the (fresh)
  // breakdown imperatively — selecting the object trips React's getSnapshot loop.
  useGeneratorStore((s) => s.getValuationPerSecond());
  const { total, base, mps, factors } = useGeneratorStore
    .getState()
    .getValuationBreakdown();
  const activeFactors = factors.filter((f) => isActive(f.mult));

  return (
    <PopCard title="Valuation" value={formatRate(total).formatted} tone="valuation" className="w-72">
      <PopGroup>
        <PopRow strong label="Revenue engine" value={formatRate(base).formatted} />
        <PopRow indent label="from income" value={`${formatCurrency(mps)}/s`} />
      </PopGroup>
      {activeFactors.length > 0 && (
        <PopGroup label="Multipliers">
          {activeFactors.map((f) => (
            <PopRow key={f.label}
              label={f.modKey ? <ModifierTag modKey={f.modKey}>{f.label}</ModifierTag> : f.label}
              value={mult(f.mult)} />
          ))}
        </PopGroup>
      )}
    </PopCard>
  );
};
