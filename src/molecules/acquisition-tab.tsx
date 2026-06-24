import Decimal from "break_infinity.js";
import { useState } from "react";
import {
  accruedForEquity,
  ACQUISITION_THRESHOLD,
  equityForAccrued,
  performAcquisition,
} from "../game/acquisition";
import { SKILL_TREE } from "../game/skill-tree";
import { useGeneratorStore } from "../state/generators.store";
import { useMoneyStore } from "../state/money.store";
import { usePrestigeStore } from "../state/prestige.store";
import { useSessionStore } from "../state/session.store";
import { MANDATES, useValuationStore } from "../state/valuation.store";
import { Button } from "../ui/Button";
import { SystemPanel } from "../ui/SystemPanel";
import { isLocalDev } from "../utils/dev-mode";
import { formatCurrency } from "../utils/money-utils";
import { formatDuration } from "../utils/time-utils";
import { useSellTransition } from "./sell-transition";
import { SkillTreeOverlay } from "./skill-tree/skill-tree-overlay";

const TOTAL_NODES = SKILL_TREE.nodes.length;
const plain = (n: Decimal) => formatCurrency(n, { showDollarSign: false });
const trim = (n: number) => Number(n.toFixed(2)).toString();

export type Chip = { label: string; value: string; good: boolean };

/** A slim progress bar (0–1). */
const Bar = ({
  frac,
  tone = "emerald",
}: {
  frac: number;
  tone?: "emerald" | "cyan";
}) => (
  <div className="h-1.5 w-full overflow-hidden rounded bg-primary-300 dark:bg-primary-700">
    <div
      className={
        tone === "cyan" ? "h-full bg-cyan-500" : "h-full bg-emerald-500"
      }
      style={{ width: `${Math.max(0, Math.min(1, frac)) * 100}%` }}
    />
  </div>
);

export const ChipRow = ({ chips }: { chips: Chip[] }) => (
  <div className="flex flex-wrap gap-1">
    {chips.map((c) => (
      <span
        key={c.label}
        className={`rounded px-1.5 py-0.5 text-[10px] tabular-nums ${
          c.good
            ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
            : "bg-rose-500/15 text-rose-700 dark:text-rose-300"
        }`}
      >
        {c.label} {c.value}
      </span>
    ))}
  </div>
);

const SummaryRow = ({ label, value }: { label: string; value: string }) => (
  <div className="flex items-baseline justify-between gap-4">
    <span className="opacity-70">{label}</span>
    <span className="font-medium tabular-nums">{value}</span>
  </div>
);

/**
 * Confirmation modal — acquisition is destructive (resets the whole run). Shows
 * what this company achieved and what prestiging will bank.
 */
const AcquireConfirm = ({
  offer,
  onConfirm,
  onCancel,
}: {
  offer: Decimal;
  onConfirm: () => void;
  onCancel: () => void;
}) => {
  const accrued = useValuationStore((s) => s.accruedThisRun);
  const money = useMoneyStore((s) => s.money);
  const incorporatedAt = useSessionStore((s) => s.incorporatedAt);
  const employees = useGeneratorStore((s) =>
    s.generators.reduce((n, g) => n + g.amount, 0),
  );
  const mandateLevels = useValuationStore((s) => s.mandateLevels);
  const activeMandates = MANDATES.filter((m) => mandateLevels[m.id] > 0);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onCancel}
    >
      <div
        className="w-96 max-w-full rounded-lg border border-primary-500 bg-primary-100 p-5 text-primary-900 shadow-xl dark:bg-primary-800 dark:text-primary-100"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-bold">Sell the company?</h2>

        <p className="mt-2 mb-1 text-[10px] uppercase tracking-wide opacity-50">
          This company
        </p>
        <div className="flex flex-col gap-1 text-xs">
          <SummaryRow
            label="Lifespan"
            value={`${formatDuration(Date.now() - incorporatedAt)}`}
          />
          <SummaryRow label="Valuation accrued" value={plain(accrued)} />
          <SummaryRow label="Cash on hand" value={formatCurrency(money)} />
          <SummaryRow label="Employees" value={String(employees)} />
        </div>

        <p className="mt-3 mb-1 text-[10px] uppercase tracking-wide opacity-50">
          You'll gain
        </p>
        <div className="flex flex-col gap-1 text-xs">
          <SummaryRow label="Exits" value="+1" />
          <SummaryRow label="Equity" value={`+${plain(offer)}`} />
          {activeMandates.map((m) => (
            <SummaryRow
              key={m.id}
              label={m.name}
              value={`Lv ${mandateLevels[m.id]}`}
            />
          ))}
          <p className="mt-1 text-[11px] opacity-60">
            Equity, skill tree and board mandates persist. Money, employees,
            upgrades, innovation and valuation reset.
          </p>
        </div>

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
};

/** Live readout of what the allocated tree is doing right now. */
export function modifierChips(
  m: ReturnType<typeof usePrestigeStore.getState>["modifiers"],
): Chip[] {
  const chips: Chip[] = [];
  const mult = (label: string, v: number, betterUp = true) => {
    if (v !== 1)
      chips.push({
        label,
        value: `×${trim(v)}`,
        good: betterUp ? v > 1 : v < 1,
      });
  };
  mult("Money", m.moneyMult);
  mult("Innov", m.innovationMult);
  mult("Valuation", m.valuationMult);
  mult("Output", m.employeeOutputMult);
  mult("Auto", m.autoBuyMult);
  mult("Mgrs", m.managerSpeedMult);
  mult("Hire cost", m.hireCostMult, false);
  mult("Singularity", m.singularityMult);
  mult("Satisfaction", m.satisfactionGainMult);
  mult("Equity", m.equityMult);
  if (m.headcountPerEmployee > 0) {
    chips.push({
      label: "Synergy",
      value: `+${trim(m.headcountPerEmployee * 100)}%/emp`,
      good: true,
    });
  }
  if (m.disableManagers)
    chips.push({ label: "No managers", value: "", good: false });
  if (m.satisfactionNeutralized)
    chips.push({ label: "No satisfaction", value: "", good: false });
  if (m.internOutputMult !== 1)
    chips.push({
      label: "Weak interns",
      value: `×${trim(m.internOutputMult)}`,
      good: false,
    });
  if (m.freeStartingLevels > 0)
    chips.push({
      label: "Free interns",
      value: `+${m.freeStartingLevels}/run`,
      good: true,
    });
  return chips;
}

/**
 * Company Acquisition prestige tab: a dashboard for the prestige loop — bank
 * Equity, see what your skill tree is doing, and sell the company for more.
 */
export const AcquisitionTab = () => {
  const equity = usePrestigeStore((s) => s.equity);
  const exits = usePrestigeStore((s) => s.exits);
  const respecPoints = usePrestigeStore((s) => s.respecPoints);
  const allocated = usePrestigeStore((s) => s.allocated.length);
  const modifiers = usePrestigeStore((s) => s.modifiers);
  const accrued = useValuationStore((s) => s.accruedThisRun);

  const offer = equityForAccrued(accrued);
  const offerNum = offer.toNumber();
  const eligible = offer.gt(0);

  // Progress toward the next Equity point (first offer is at the threshold).
  const nextTarget =
    offerNum > 0
      ? accruedForEquity(offerNum + 1)
      : new Decimal(ACQUISITION_THRESHOLD);
  const prevTarget = offerNum > 0 ? accruedForEquity(offerNum) : new Decimal(0);
  const span = nextTarget.sub(prevTarget);
  const frac = span.lte(0) ? 1 : accrued.sub(prevTarget).div(span).toNumber();
  const toNext = Decimal.max(0, nextTarget.sub(accrued));

  const chips = modifierChips(modifiers);

  const { triggerSell } = useSellTransition();
  const [treeOpen, setTreeOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);

  return (
    <div className="flex w-full flex-col items-center gap-4 p-3">
      {/* Hero: banked Equity */}
      <div className="flex w-full flex-col items-center gap-1 pb-3 dark:border-primary-700">
        <span className="text-[10px] uppercase tracking-wide opacity-60">
          Banked Equity
        </span>
        <span className="text-3xl font-bold tabular-nums text-emerald-600 dark:text-emerald-400">
          {plain(equity)}
        </span>
        <div className="flex gap-4 text-xs opacity-70 tabular-nums">
          <span>Exits {exits}</span>
          <span>
            Respecs{" "}
            <span className="font-semibold text-rose-500 dark:text-rose-400">
              {respecPoints}
            </span>
          </span>
        </div>
      </div>

      {/* Skill tree */}
      <SystemPanel
        title="Acquisition tree"
        className="w-full"
        help="Spend Equity in a passive tree of permanent bonuses. Respec with Exits."
      >
        <div className="flex flex-col gap-2 px-2 pb-2">
          <div className="flex items-baseline justify-between text-xs">
            <span className="opacity-70">Nodes allocated</span>
            <span className="tabular-nums">
              {allocated} <span className="opacity-50">/ {TOTAL_NODES}</span>
            </span>
          </div>
          <Bar frac={allocated / TOTAL_NODES} tone="cyan" />

          {chips.length > 0 ? (
            <>
              <span className="mt-1 text-[10px] uppercase tracking-wide opacity-50">
                Active bonuses
              </span>
              <ChipRow chips={chips} />
            </>
          ) : (
            <p className="text-[11px] opacity-60">
              No nodes allocated yet — open the tree to spend your Equity.
            </p>
          )}

          <Button className="mt-1 w-full" onClick={() => setTreeOpen(true)}>
            Open acquisition tree
          </Button>
        </div>
      </SystemPanel>

      {/* Sell the company */}
      <SystemPanel
        title="Sell the company"
        className="w-full"
        help="Accrued valuation determines your acquisition payout (diminishing returns). Selling banks Equity and starts a fresh company."
      >
        <div className="flex flex-col gap-2 px-2 pb-2">
          <div className="flex items-baseline justify-between text-xs">
            <span className="opacity-70">Accrued valuation</span>
            <span className="tabular-nums">{plain(accrued)}</span>
          </div>
          <div className="flex items-baseline justify-between">
            <span className="text-xs opacity-70">Acquisition offer</span>
            <span
              className={`text-lg font-bold tabular-nums ${
                eligible
                  ? "text-emerald-600 dark:text-emerald-400"
                  : "opacity-40"
              }`}
            >
              {eligible ? `+${plain(offer)} Equity` : "—"}
            </span>
          </div>
          <Bar frac={frac} />
          <p className="text-[11px] tabular-nums opacity-60">
            {eligible
              ? `+1 Equity in ${plain(toNext)} more valuation`
              : `${plain(toNext)} valuation to your first offer`}
          </p>

          <Button
            className="mt-1 w-full"
            disabled={!eligible}
            onClick={() => setConfirming(true)}
          >
            {eligible
              ? `Sell for +${plain(offer)} Equity`
              : "Not enough valuation yet"}
          </Button>
        </div>
      </SystemPanel>

      {isLocalDev() && (
        <Button
          className="w-full text-xs opacity-80"
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
            triggerSell(() => performAcquisition());
          }}
        />
      )}
    </div>
  );
};
