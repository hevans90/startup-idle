import Decimal from "break_infinity.js";
import { useState } from "react";
import {
  ACQUISITION_THRESHOLD,
  equityForAccrued,
  performAcquisition,
} from "../game/acquisition";
import { SKILL_TREE } from "../game/skill-tree";
import { usePrestigeStore } from "../state/prestige.store";
import { useValuationStore } from "../state/valuation.store";
import { Button } from "../ui/Button";
import { InfoRow } from "../ui/InfoRow";
import { isLocalDev } from "../utils/dev-mode";
import { formatCurrency } from "../utils/money-utils";
import { SkillTreeOverlay } from "./skill-tree/skill-tree-overlay";

const plain = (n: Decimal) => formatCurrency(n, { showDollarSign: false });

/** Confirmation modal — acquisition is destructive (resets the whole run). */
const AcquireConfirm = ({
  offer,
  onConfirm,
  onCancel,
}: {
  offer: ReturnType<typeof equityForAccrued>;
  onConfirm: () => void;
  onCancel: () => void;
}) => (
  <div
    className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
    onClick={onCancel}
  >
    <div
      className="w-80 max-w-full rounded-lg border border-primary-500 bg-primary-100 p-5 text-primary-900 shadow-xl dark:bg-primary-800 dark:text-primary-100"
      onClick={(e) => e.stopPropagation()}
    >
      <h2 className="text-lg font-bold">Accept acquisition offer?</h2>
      <p className="mt-2 text-xs opacity-70">
        You'll sell the company and bank{" "}
        <span className="font-bold text-emerald-600 dark:text-emerald-400">
          +{plain(offer)} Equity
        </span>
        , then start a fresh company (you'll pick a new founder). Money,
        employees, upgrades, innovation and valuation reset. Your Equity and
        skill tree are kept.
      </p>
      <div className="mt-4 flex gap-2">
        <Button className="flex-1" onClick={onConfirm}>
          Sell company
        </Button>
        <Button className="flex-1 opacity-70" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  </div>
);

/**
 * Company Acquisition prestige tab: invest banked Equity in the skill tree, and
 * once you've accrued enough valuation, accept an acquisition offer to bank more
 * Equity and reset into a fresh company.
 */
export const AcquisitionTab = () => {
  const equity = usePrestigeStore((s) => s.equity);
  const exits = usePrestigeStore((s) => s.exits);
  const allocated = usePrestigeStore((s) => s.allocated.length);
  const accrued = useValuationStore((s) => s.accruedThisRun);

  const offer = equityForAccrued(accrued);
  const eligible = offer.gt(0);

  const [treeOpen, setTreeOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);

  return (
    <div className="flex flex-col items-center gap-4 p-4">
      <div className="w-64">
        <InfoRow
          label="Equity"
          value={plain(equity)}
          size="large"
        />
        <InfoRow label="Exits" value={String(exits)} size="small" />
        <InfoRow
          label="Nodes allocated"
          value={`${allocated} / ${SKILL_TREE.nodes.length}`}
          size="small"
        />
      </div>

      <Button className="w-64" onClick={() => setTreeOpen(true)}>
        Open acquisition tree
      </Button>

      <div className="w-64 border-t border-primary-300 pt-3 dark:border-primary-700">
        <p className="responsive-text-xs text-primary-500 dark:text-primary-400">
          This company
        </p>
        <InfoRow label="Accrued valuation" value={plain(accrued)} size="small" />
        <InfoRow
          label="Acquisition offer"
          value={eligible ? `+${plain(offer)} Equity` : "—"}
          size="small"
        />
      </div>

      <Button
        className="w-64"
        disabled={!eligible}
        onClick={() => setConfirming(true)}
      >
        {eligible
          ? "Accept acquisition offer"
          : `Accrue ${formatCurrency(ACQUISITION_THRESHOLD, {
              showDollarSign: false,
            })} valuation to acquire`}
      </Button>

      {isLocalDev() && (
        <Button
          className="w-64 text-xs"
          onClick={() => usePrestigeStore.getState().grantEquity(10)}
        >
          +10 Equity (dev)
        </Button>
      )}

      {treeOpen && <SkillTreeOverlay onClose={() => setTreeOpen(false)} />}
      {confirming && (
        <AcquireConfirm
          offer={offer}
          onCancel={() => setConfirming(false)}
          onConfirm={() => {
            performAcquisition();
            setConfirming(false);
            // founder is now null → the app drops to founder-select automatically.
          }}
        />
      )}
    </div>
  );
};
