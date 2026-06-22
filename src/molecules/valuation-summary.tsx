import { ReactNode } from "react";
import { twMerge } from "tailwind-merge";
import { useGeneratorStore } from "../state/generators.store";
import { formatCurrency } from "../utils/money-utils";
import { formatRate } from "../utils/rate-utils";

const mult = (m: number) => `×${m.toFixed(2)}`;
const isActive = (m: number) => Math.abs(m - 1) > 1e-9;

const Row = ({
  label,
  value,
  className,
  indent,
}: {
  label: ReactNode;
  value: ReactNode;
  className?: string;
  indent?: boolean;
}) => (
  <div
    className={twMerge(
      "flex items-baseline justify-between gap-4",
      indent && "pl-3",
      className,
    )}
  >
    <span className="truncate">{label}</span>
    <span className="shrink-0 tabular-nums">{value}</span>
  </div>
);

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
    <div className="flex w-64 flex-col gap-2 text-xs">
      <Row
        label="Valuation"
        value={`${formatRate(total).formatted}`}
        className="text-sm font-bold"
      />

      <div className="flex flex-col gap-0.5 border-t border-primary-400/40 pt-1.5 dark:border-primary-600/50">
        <Row label="Revenue engine" value={formatRate(base).formatted} />
        <Row
          indent
          label="from income"
          value={`${formatCurrency(mps)}/s`}
          className="opacity-70"
        />
      </div>

      {activeFactors.length > 0 && (
        <div className="flex flex-col gap-0.5 border-t border-primary-400/40 pt-1.5 dark:border-primary-600/50">
          <p className="text-[10px] uppercase tracking-wide opacity-50">
            Multipliers
          </p>
          {activeFactors.map((f) => (
            <Row
              key={f.label}
              indent
              label={f.label}
              value={mult(f.mult)}
              className="opacity-80"
            />
          ))}
        </div>
      )}
    </div>
  );
};
