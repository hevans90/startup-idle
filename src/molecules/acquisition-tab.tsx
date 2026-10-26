import Decimal from "break_infinity.js";
import { useEffect, useState, type ReactNode } from "react";
import {
  accruedForEquity,
  ACQUISITION_THRESHOLD,
  canAcquire,
  equityForAccrued,
  offerPremiumNow,
  offerPremiumUntil,
  townBonusNow,
  performAcquisition,
} from "../game/acquisition";
import { termStatus } from "../game/term-sheets";
import { termSaleMult } from "../game/term-deal";
import { useTicking } from "../hooks/use-ticking";
import { SKILL_TREE } from "../game/skill-tree";
import { useShallow } from "zustand/shallow";
import { useGeneratorStore } from "../state/generators.store";
import { useMoneyStore } from "../state/money.store";
import { usePrestigeStore } from "../state/prestige.store";
import { useSessionStore } from "../state/session.store";
import { MANDATES, useValuationStore } from "../state/valuation.store";
import { Button, CountUp, Dialog, Panel, Section, Stat, StatGrid } from "../ui/console";
import { ModifierTag } from "../ui/ModifierTag";
import { formatCurrency } from "../utils/money-utils";
import { formatDuration } from "../utils/time-utils";
import { useSellTransition } from "./sell-transition";
import { MACHINE } from "../game/machine";
import { SkillTreeOverlay } from "./skill-tree/skill-tree-overlay";

// The business tree's nodes: the Machine is bought with Weights. @see game/machine
const TOTAL_NODES = SKILL_TREE.nodes.filter((n) => n.cluster !== MACHINE).length;
const plain = (n: Decimal) => formatCurrency(n, { showDollarSign: false });
const trim = (n: number) => Number(n.toFixed(2)).toString();

export type Chip = { label: string; value: string; good: boolean; modKey?: string };

/** A slim progress bar (0–1). */
const Bar = ({
  frac,
  tone = "emerald",
}: {
  frac: number;
  tone?: "emerald" | "cyan";
}) => (
  <div className="h-1.5 w-full overflow-hidden  bg-surface-3">
    <div
      className={
        tone === "cyan" ? "h-full bg-innovation" : "h-full bg-good"
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
        className={`px-1.5 py-0.5 text-[10px] tabular-nums ${
          c.good
            ? "bg-good/15 text-good"
            : "bg-bad/15 text-bad"
        }`}
      >
        {c.modKey
          ? <ModifierTag modKey={c.modKey}>{c.label}</ModifierTag>
          : c.label}
        {c.value && ` ${c.value}`}
      </span>
    ))}
  </div>
);

const SummaryRow = ({ label, value }: { label: string; value: ReactNode }) => (
  <div className="flex items-baseline justify-between gap-4">
    <span className="text-fg-muted">{label}</span>
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
    <Dialog title="Sell the company?" kicker="The sale" onClose={onCancel}
      actions={<>
        <Button variant="quiet" onClick={onCancel}>Cancel</Button>
        <Button variant="primary" tone="good" onClick={onConfirm}>Sell for +{plain(offer)} Equity</Button>
      </>}>
      <Section label="This company">
        <div className="flex flex-col gap-1 text-xs">
          <SummaryRow label="Lifespan" value={`${formatDuration(Date.now() - incorporatedAt)}`} />
          <SummaryRow label="Valuation accrued" value={<CountUp to={accrued} format={plain} role="valuation" />} />
          <SummaryRow label="Cash on hand" value={<CountUp to={money} format={(v) => formatCurrency(v)} role="money" />} />
          <SummaryRow label="Employees" value={<CountUp to={employees} format={(v) => String(Math.round(v))} />} />
        </div>
      </Section>
      <Section label="You'll gain">
        <div className="flex flex-col gap-1 text-xs">
          <SummaryRow label="Exits" value="+1" />
          <SummaryRow label="Equity" value={<CountUp to={offer} format={(v) => `+${plain(v)}`} role="good" className="font-display text-base" />} />
          {activeMandates.map((m) => (
            <SummaryRow key={m.id} label={m.name} value={`Lv ${mandateLevels[m.id]}`} />
          ))}
        </div>
      </Section>
      <p className="mt-2 text-[11px] text-fg-muted">
        Equity, skill tree and board mandates persist. Money, employees, upgrades, innovation, valuation and the company's map reset — the next company founds on new ground.
      </p>
    </Dialog>
  );
};

/** Live readout of what the allocated tree is doing right now. */
export function modifierChips(
  m: ReturnType<typeof usePrestigeStore.getState>["modifiers"],
): Chip[] {
  const chips: Chip[] = [];
  const mult = (label: string, v: number, modKey?: string, betterUp = true) => {
    if (v !== 1)
      chips.push({
        label,
        value: `×${trim(v)}`,
        good: betterUp ? v > 1 : v < 1,
        modKey,
      });
  };
  mult("Money", m.moneyMult, "prestigeMoney");
  mult("Innovation", m.innovationMult, "prestigeInnovation");
  mult("Valuation", m.valuationMult, "prestigeValuation");
  mult("Output", m.employeeOutputMult, "prestigeEmployeeOutput");
  mult("Auto-buy", m.autoBuyMult, "prestigeAutoBuy");
  mult("Managers", m.managerSpeedMult, "prestigeManagerSpeed");
  mult("Hire cost", m.hireCostMult, "prestigeHireCost", false);
  mult("Singularity", m.singularityMult, "prestigeSingularity");
  mult("Satisfaction", m.satisfactionGainMult, "prestigeSatisfactionGain");
  mult("Equity", m.equityMult, "prestigeEquity");
  if (m.headcountPerEmployee > 0) {
    chips.push({
      label: "Synergy",
      value: `+${trim(m.headcountPerEmployee * 100)}%/emp`,
      good: true,
      modKey: "headcountMoney",
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
      modKey: "prestigeInternOutput",
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
  const { equity, exits, respecPoints, allocated, modifiers } = usePrestigeStore(
    useShallow((s) => ({
      equity: s.equity,
      exits: s.exits,
      respecPoints: s.respecPoints,
      allocated: s.allocated.length,
      modifiers: s.modifiers,
    })),
  );
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
  // AN ACQUIRER'S OFFER, looked at from the map: straight to the confirmation. @see answerOffer
  useEffect(() => {
    const ask = () => { if (canAcquire()) setConfirming(true); };
    window.addEventListener("startup:confirm-sale", ask);
    return () => window.removeEventListener("startup:confirm-sale", ask);
  }, []);
  useTicking(1000);
  const premium = offerPremiumNow();
  const premiumUntil = offerPremiumUntil();
  const term = termStatus();
  // WITH AN ACQUIRER'S PREMIUM, while their offer is on the table. @see OFFER_PREMIUM
  const paid = premium > 1 ? offer.mul(premium).floor() : offer;

  return (
    <div className="flex w-full flex-col gap-3 p-2">
      {/* WHAT IS BANKED: Equity, the exits made, the respecs to spend. */}
      <StatGrid className="w-full">
        <Stat label="Banked equity" value={plain(equity)} role="good" />
        <Stat label="Exits" value={exits} />
        <Stat label="Respecs" value={respecPoints} role={respecPoints > 0 ? "bad" : undefined} />
      </StatGrid>

      {/* Skill tree */}
      <Panel
        title="Acquisition tree"
        className="w-full"
        help="Spend Equity in a passive tree of permanent bonuses. Respec with Exits."
      >
        <div className="flex flex-col gap-2">
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

          <Button variant="primary" className="mt-1 w-full" onClick={() => setTreeOpen(true)}>
            Open acquisition tree
          </Button>
        </div>
      </Panel>

      {/* Sell the company */}
      <Panel
        title="Sell the company"
        className="w-full"
        help="Accrued valuation determines your acquisition payout (diminishing returns). Selling banks Equity and starts a fresh company."
      >
        <div className="flex flex-col gap-2">
          <div className="flex items-baseline justify-between text-xs">
            <span className="opacity-70">Accrued valuation</span>
            <span className="tabular-nums">{plain(accrued)}</span>
          </div>
          <div className="flex items-baseline justify-between">
            <span className="text-xs opacity-70">Acquisition offer</span>
            <span
              className={`text-lg font-bold tabular-nums ${
                eligible
                  ? "text-good"
                  : "opacity-40"
              }`}
            >
              {eligible ? `+${plain(paid)} Equity` : "—"}
            </span>
          </div>
          {eligible && premium > 1 && premiumUntil !== null && (
            <p className="text-[11px] tabular-nums text-warn">
              An acquirer's premium of +{Math.round((premium - 1) * 100)}% (against +{plain(offer)} without),
              for {formatDuration(Math.max(0, premiumUntil - Date.now()))} more
            </p>
          )}
          {/* THE INVESTOR'S SHARE AND TERMS, off the top of the sale. @see termSaleMult */}
          {termSaleMult() < 1 && (
            <p className="text-[11px] tabular-nums text-warn"
              title="The term sheet's stake, its liquidation preference and the board, as the deal was signed.">
              After the investor's terms you keep {Math.round(termSaleMult() * 100)}%
            </p>
          )}
          {townBonusNow() > 0 && (
            <p className="text-[11px] tabular-nums text-good"
              title="Houses grown, services and wonders on your map. Up to +50%.">
              Includes a town bonus of +{Math.round(townBonusNow() * 100)}%
            </p>
          )}
          {term && (
            <p className={`text-[11px] tabular-nums ${term.progress.met ? "text-good" : "opacity-70"}`}
              title={`${term.sheet.investor}'s term sheet: +${Math.round(term.bonus * 100)}% Equity if it is met when you sell.`}>
              Term sheet: {term.goal} · {term.progress.text}
              {term.progress.met ? ` · includes +${Math.round(term.bonus * 100)}%` : ""}
            </p>
          )}
          <Bar frac={frac} />
          <p className="text-[11px] tabular-nums opacity-60">
            {eligible
              ? `+1 Equity in ${plain(toNext)} more valuation`
              : `${plain(toNext)} valuation to your first offer`}
          </p>

          <Button
            variant="primary"
            className="mt-1 w-full"
            disabled={!eligible}
            onClick={() => setConfirming(true)}
          >
            {eligible
              ? `Sell for +${plain(paid)} Equity`
              : "Not enough valuation yet"}
          </Button>
        </div>
      </Panel>


      {treeOpen && <SkillTreeOverlay onClose={() => setTreeOpen(false)} />}
      {confirming && (
        <AcquireConfirm
          offer={paid}
          onCancel={() => setConfirming(false)}
          onConfirm={() => {
            triggerSell(() => performAcquisition());
          }}
        />
      )}
    </div>
  );
};
