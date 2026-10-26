import Decimal from "break_infinity.js";

import { memo } from "react";
import {
  getManagerCost,
  getManagerRefund,
  ManagerKeys,
  ManagerState,
} from "../../state/innovation.store";
import { IconButton, Tooltip } from "../../ui/console";
import { ModifierTag } from "../../ui/ModifierTag";
import { formatCurrency } from "../../utils/money-utils";

interface ManagerRowProps {
  managerName: ManagerKeys;
  managerData: ManagerState;
  innovation: Decimal;
  onAssign: () => void;
  onUnassign: () => void;
}

const BONUS: Record<string, { label: string; modKey: string }> = {
  innovation: { label: "Innovation rate", modKey: "managerInnovation" },
  employee: { label: "Employee output", modKey: "managerMoney" },
  sales: { label: "Valuation rate", modKey: "managerSalesValuation" },
};

/**
 * A MANAGER: its name and tier, how far to the next, what it gives and how
 * that grows, and innovation assigned or taken back — the cost and refund on
 * the buttons' tooltips (on a wrapper: a disabled button hears no pointer).
 * Everything else on the row: nothing hidden on hover.
 */
const ManagerRow: React.FC<ManagerRowProps> = memo(
  ({ managerName, managerData, innovation, onAssign, onUnassign }) => {
    const { assignment, progress, tier, estimateToNextTier, bonusType, bonusMultiplier, bonusMultiplierGrowthPerTier } = managerData;
    const { totalCost, count: numberToAssign } = getManagerCost(managerName);
    const { totalRefund } = getManagerRefund(managerName);
    const bonus = BONUS[bonusType] ?? BONUS.innovation;
    const pct = Math.min(100, Math.max(0, progress.toNumber()));

    return (
      <div className="grid grid-cols-[1fr_auto] items-center gap-3 border-b border-line-quiet py-2.5 last:border-b-0">
        <div className="flex min-w-0 flex-col gap-1.5">
          <div className="flex items-baseline justify-between gap-2">
            <span className="font-display text-sm uppercase tracking-wider">{managerName}</span>
            <span className="text-[11px] tabular-nums text-fg-muted">
              Tier <b className="text-fg">{tier.toNumber()}</b> · {assignment.toFixed(0)} assigned
            </span>
          </div>
          <div role="progressbar" aria-label={`${managerName}: to the next tier`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct)} className="h-1 bg-surface-3">
            <div className="h-full bg-innovation transition-[width] duration-300" style={{ width: `${pct}%` }} />
          </div>
          <div className="flex justify-between gap-2 text-[11px] text-fg-muted">
            <span><ModifierTag modKey={bonus.modKey}>{bonus.label}</ModifierTag> <b className="tabular-nums text-fg">×{bonusMultiplier?.toFixed(3)}</b> · ×{bonusMultiplierGrowthPerTier?.toFixed(2)}/tier</span>
            <span className="shrink-0 tabular-nums" title="Time to the next tier at this assignment">{estimateToNextTier === "-" || estimateToNextTier === "∞" ? "idle" : `next in ${estimateToNextTier}`}</span>
          </div>
        </div>
        <div className="flex gap-1">
          <Tooltip content={<>Take back: +{totalRefund.toFixed(2)} innovation</>}>
            <span className="inline-flex"><IconButton label={`Take innovation back from ${managerName}`} onClick={onUnassign} disabled={assignment.equals(0)} className="h-8 w-8 border border-line">−</IconButton></span>
          </Tooltip>
          <Tooltip content={<>Assign{numberToAssign > 1 && ` ${numberToAssign}`}: {formatCurrency(totalCost, { showDollarSign: false })} innovation</>}>
            <span className="inline-flex"><IconButton label={`Assign innovation to ${managerName}`} onClick={onAssign} disabled={totalCost.gte(innovation)} className="h-8 w-8 border border-line">+</IconButton></span>
          </Tooltip>
        </div>
      </div>
    );
  }
);

export default ManagerRow;
