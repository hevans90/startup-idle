import { useState } from "react";
import { twMerge } from "tailwind-merge";
import { FOUNDERS } from "../game/founders.catalog";
import { useExitsStore } from "../state/exits.store";
import { useFounderStore } from "../state/founder.store";
import { usePrestigeStore } from "../state/prestige.store";
import { MANDATES, useValuationStore } from "../state/valuation.store";
import { useVapeAchievementsStore } from "../state/vape-achievements.store";
import { CURRENT_VERSION } from "../state/version.store";
import { fmtMult } from "../ui/BonusRow";
import { Button } from "../ui/Button";
import { ModifierTag } from "../ui/ModifierTag";
import { formatCurrency } from "../utils/money-utils";
import { TenXDevText } from "../utils/ten-x-utils";
import { RainbowText } from "../utils/vibe-utils";
import { SkillTreeOverlay } from "./skill-tree/skill-tree-overlay";

// ─── local helpers ────────────────────────────────────────────────────────────

const SPLIT_RE = /(vibe coders?|10x devs?)/gi;

function PerkText({ text }: { text: string }) {
  return (
    <>
      {text.split(SPLIT_RE).map((seg, i) => {
        if (/^vibe coders?$/i.test(seg))
          return <RainbowText key={i} text={seg} inline />;
        if (/^10x devs?$/i.test(seg)) return <TenXDevText key={i} text={seg} />;
        return <span key={i}>{seg}</span>;
      })}
    </>
  );
}

function toneClass(tone: "good" | "bad" | "neutral"): string {
  if (tone === "good") return "text-emerald-600 dark:text-emerald-400";
  if (tone === "bad") return "text-rose-500 dark:text-rose-400";
  return "text-cyan-600 dark:text-cyan-400";
}

function PanelRow({
  label,
  value,
  tone = "good",
  modKey,
  sub,
}: {
  label: string;
  value: string;
  tone?: "good" | "bad" | "neutral";
  modKey?: string;
  sub?: string;
}) {
  return (
    <div className="py-1.5">
      <div className="flex items-center justify-between gap-3">
        <span className="truncate opacity-50">
          {modKey ? <ModifierTag modKey={modKey}>{label}</ModifierTag> : label}
        </span>
        <span
          className={twMerge(
            "shrink-0 font-semibold tabular-nums",
            toneClass(tone),
          )}
        >
          {value}
        </span>
      </div>
      {sub && <p className="mt-0.5 text-[10px] opacity-35">{sub}</p>}
    </div>
  );
}

// ─── main component ───────────────────────────────────────────────────────────

export const FounderSelect = () => {
  const chooseFounder = useFounderStore((s) => s.chooseFounder);
  const [selected, setSelected] = useState<string | null>(null);

  const equity = usePrestigeStore((s) => s.equity);
  const exits = usePrestigeStore((s) => s.exits);
  const modifiers = usePrestigeStore((s) => s.modifiers);

  const founderExits = useExitsStore((s) => s.exits);
  const bestExitValuation = useExitsStore((s) => s.bestExitValuation);

  const mandateLevels = useValuationStore((s) => s.mandateLevels);
  const activeMandates = MANDATES.filter((m) => mandateLevels[m.id] > 0);
  const mandateMoneyMult = activeMandates.reduce(
    (acc, m) => acc + mandateLevels[m.id] * (m.moneyMultPerLevel ?? 0),
    0,
  );
  const mandateInnovMult = activeMandates.reduce(
    (acc, m) => acc + mandateLevels[m.id] * (m.innovationMultPerLevel ?? 0),
    0,
  );

  const juiceMpsBonus = useVapeAchievementsStore((s) => s.juiceMpsMultBonus);
  const juiceInnovBonus = useVapeAchievementsStore(
    (s) => s.juiceInnovationMultBonus,
  );
  const juiceValuationBonus = useVapeAchievementsStore(
    (s) => s.juiceValuationMultBonus,
  );
  const juiceHireCostReduction = useVapeAchievementsStore(
    (s) => s.juiceHireCostReduction,
  );
  const juiceEquityBonus = useVapeAchievementsStore(
    (s) => s.juiceEquityMultBonus,
  );

  const combinedMoneyMult =
    modifiers.moneyMult *
    modifiers.employeeOutputMult *
    (1 + juiceMpsBonus) *
    (1 + mandateMoneyMult);
  const combinedInnovMult =
    modifiers.innovationMult *
    modifiers.employeeOutputMult *
    (1 + juiceInnovBonus) *
    (1 + mandateInnovMult);
  const combinedValMult = modifiers.valuationMult * (1 + juiceValuationBonus);
  const combinedHireCost =
    modifiers.hireCostMult * (1 - juiceHireCostReduction);
  const combinedEquityMult = modifiers.equityMult * (1 + juiceEquityBonus);

  const [treeOpen, setTreeOpen] = useState(false);
  const showPrestige = exits > 0 || equity.gt(0);
  const hasPoints = equity.gt(0);
  const hasBonuses =
    combinedMoneyMult !== 1 ||
    combinedInnovMult !== 1 ||
    combinedValMult !== 1 ||
    combinedHireCost !== 1 ||
    combinedEquityMult !== 1 ||
    modifiers.autoBuyMult !== 1 ||
    modifiers.managerSpeedMult !== 1 ||
    modifiers.satisfactionGainMult !== 1 ||
    modifiers.singularityMult !== 1 ||
    modifiers.internOutputMult !== 1 ||
    modifiers.headcountPerEmployee > 0 ||
    modifiers.freeStartingLevels > 0 ||
    modifiers.disableManagers ||
    modifiers.satisfactionNeutralized;

  return (
    <div className="flex h-full w-full overflow-hidden bg-primary-100 text-primary-900 dark:bg-primary-900 dark:text-primary-50">
      {treeOpen && <SkillTreeOverlay onClose={() => setTreeOpen(false)} />}

      {/* ── Left: founder card grid ──────────────────────────── */}
      <div className="flex min-w-0 flex-1 flex-col overflow-y-auto px-6 py-8">
        <div className="mb-6 text-center">
          <h1 className="text-3xl font-bold sm:text-4xl">Startup Idle</h1>
          <p className="mt-2 text-sm opacity-70">
            Which type of shitlord tech bro are you?
          </p>
        </div>

        <div className="mx-auto w-full max-w-4xl flex-1">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3 [grid-auto-rows:1fr]">
            {FOUNDERS.map((f) => {
              const Icon = f.icon;
              const isSel = selected === f.id;
              const exitRecord = founderExits[f.id];
              const exitCount = exitRecord?.count ?? 0;
              const isUnlocked =
                !f.unlockCondition ||
                f.unlockCondition.check(exits, bestExitValuation);

              return (
                <button
                  key={f.id}
                  type="button"
                  disabled={!isUnlocked}
                  onClick={() => isUnlocked && setSelected(f.id)}
                  className={twMerge(
                    "relative flex h-full flex-col overflow-hidden border p-4 text-left transition-colors",
                    isUnlocked
                      ? isSel
                        ? "cursor-pointer border-emerald-600 bg-emerald-500/5"
                        : "cursor-pointer border-primary-300 hover:border-primary-400 dark:border-primary-700 dark:hover:border-primary-500"
                      : "cursor-not-allowed border-primary-300/40 dark:border-primary-700/40",
                  )}
                >
                  <div className="flex items-start gap-2">
                    <Icon size={26} stroke={1.6} className="mt-0.5 shrink-0" />
                    <div className="min-w-0 flex-1">
                      <div className="font-bold leading-tight">{f.name}</div>
                      <div className="text-xs italic opacity-60">
                        {f.tagline}
                      </div>
                    </div>
                    {isUnlocked && exitCount > 0 && (
                      <div className="shrink-0 bg-amber-500/15 px-2 py-0.5 text-[10px] font-bold tabular-nums text-amber-600 dark:text-amber-400">
                        {exitCount}×
                      </div>
                    )}
                  </div>

                  <ul className="mt-3 flex flex-1 flex-col gap-1 text-xs tabular-nums opacity-90">
                    {f.perks(exitCount).map((p, i) => (
                      <li key={i}>
                        • <PerkText text={p} />
                      </li>
                    ))}
                  </ul>

                  <div className="mt-4 border-t border-primary-300 pt-2 text-xs font-semibold tabular-nums text-emerald-700 dark:border-primary-700 dark:text-emerald-400">
                    Starts with ${f.startingCash}
                  </div>

                  <div className="mt-2 border border-violet-400/20 bg-violet-500/5 px-2 py-1.5 text-[10px] leading-snug text-violet-600 dark:text-violet-400">
                    <span className="font-semibold">
                      {f.scalingModifier.label}:
                    </span>{" "}
                    {f.scalingModifier.perExitDescription}
                  </div>

                  {!isUnlocked && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-primary-900/40 backdrop-blur dark:bg-primary-950/50">
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        width="28"
                        height="28"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.8"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        className="drop-shadow-md"
                      >
                        <rect
                          x="3"
                          y="11"
                          width="18"
                          height="11"
                          rx="2"
                          ry="2"
                        />
                        <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                      </svg>
                      <span className="px-4 text-center text-[11px] font-semibold leading-snug drop-shadow-sm">
                        {f.unlockCondition!.label}
                      </span>
                    </div>
                  )}
                </button>
              );
            })}
          </div>

          <div className="mt-8 flex flex-col items-center gap-3">
            <Button
              type="button"
              disabled={selected == null}
              className="px-6 py-3 text-base font-bold disabled:opacity-40"
              onClick={() => selected && chooseFounder(selected)}
            >
              Found your startup →
            </Button>
            <span className="text-[11px] tabular-nums opacity-25">
              v{CURRENT_VERSION}
            </span>
          </div>
        </div>
      </div>

      {/* ── Right: permanent bonuses panel ───────────────────── */}
      {showPrestige && (
        <aside className="hidden lg:flex w-72 xl:w-80 shrink-0 flex-col overflow-y-auto border-l border-primary-300/60 bg-primary-100/80 dark:border-primary-700/50 dark:bg-primary-800/50">
          {/* sticky header */}
          <div className="sticky top-0 z-10 flex items-center border-b border-primary-300/60 bg-primary-100/95 px-4 py-3 backdrop-blur-sm dark:border-primary-700/50 dark:bg-primary-800/95">
            <span className="text-[10px] font-bold uppercase tracking-widest opacity-35">
              Permanent Bonuses
            </span>
          </div>

          {/* equity + skill tree CTA */}
          <div className="flex items-center justify-between gap-3 border-b border-primary-300/40 px-4 py-4 dark:border-primary-700/40">
            <div>
              <p className="text-[9px] font-medium uppercase tracking-wider opacity-40">
                Equity
              </p>
              <p className="mt-0.5 text-xl font-black tabular-nums text-amber-600 dark:text-amber-400 leading-none">
                {formatCurrency(equity, { showDollarSign: false })}
              </p>
              <p className="mt-1 text-[9px] tabular-nums opacity-30">
                {exits} exit{exits !== 1 ? "s" : ""}
              </p>
            </div>
            <Button
              type="button"
              onClick={() => setTreeOpen(true)}
              className={twMerge(
                "shrink-0 text-xs transition-shadow",
                hasPoints &&
                  "animate-pulse ring-2 ring-amber-400 shadow-[0_0_18px_3px_rgba(251,191,36,0.6)]",
              )}
            >
              {hasPoints ? "Spend →" : "Skill tree"}
            </Button>
          </div>

          {/* bonus table */}
          <div className="flex flex-1 flex-col px-4 py-5">
            {!hasBonuses ? (
              <p className="mt-4 text-center text-xs leading-relaxed opacity-35">
                No bonuses yet.
                <br />
                Spend equity in the
                <br />
                acquisition tree.
              </p>
            ) : (
              <div className="flex flex-col divide-y divide-black/[0.06] dark:divide-white/[0.06] text-[11px]">
                {combinedMoneyMult !== 1 && (
                  <PanelRow
                    label="Money output"
                    value={fmtMult(combinedMoneyMult)}
                    tone="good"
                    modKey="moneyOutput"
                  />
                )}
                {combinedInnovMult !== 1 && (
                  <PanelRow
                    label="Innovation rate"
                    value={fmtMult(combinedInnovMult)}
                    tone="good"
                    modKey="innovationRate"
                  />
                )}
                {combinedValMult !== 1 && (
                  <PanelRow
                    label="Valuation rate"
                    value={fmtMult(combinedValMult)}
                    tone="good"
                    modKey="valuationRate"
                  />
                )}
                {combinedHireCost !== 1 && (
                  <PanelRow
                    label="Hire cost"
                    value={fmtMult(combinedHireCost)}
                    tone={combinedHireCost < 1 ? "good" : "bad"}
                    modKey="hireCost"
                  />
                )}
                {combinedEquityMult !== 1 && (
                  <PanelRow
                    label="Equity payout"
                    value={fmtMult(combinedEquityMult)}
                    tone="good"
                    modKey="equityPayout"
                  />
                )}
                {modifiers.autoBuyMult !== 1 && (
                  <PanelRow
                    label="Auto-buy speed"
                    value={fmtMult(modifiers.autoBuyMult)}
                    tone="good"
                    modKey="prestigeAutoBuy"
                  />
                )}
                {modifiers.managerSpeedMult !== 1 && (
                  <PanelRow
                    label="Manager speed"
                    value={fmtMult(modifiers.managerSpeedMult)}
                    tone="good"
                    modKey="prestigeManagerSpeed"
                  />
                )}
                {modifiers.satisfactionGainMult !== 1 && (
                  <PanelRow
                    label="Satisfaction gain"
                    value={fmtMult(modifiers.satisfactionGainMult)}
                    tone={modifiers.satisfactionGainMult > 1 ? "good" : "bad"}
                    modKey="prestigeSatisfactionGain"
                  />
                )}
                {modifiers.singularityMult !== 1 && (
                  <PanelRow
                    label="Singularity rate"
                    value={fmtMult(modifiers.singularityMult)}
                    tone="good"
                    modKey="prestigeSingularity"
                  />
                )}
                {modifiers.internOutputMult !== 1 && (
                  <PanelRow
                    label="Intern output"
                    value={fmtMult(modifiers.internOutputMult)}
                    tone="good"
                    modKey="prestigeInternOutput"
                  />
                )}
                {modifiers.headcountPerEmployee > 0 && (
                  <PanelRow
                    label="Headcount synergy"
                    value={`+${(modifiers.headcountPerEmployee * 100).toFixed(1)}%/emp`}
                    tone="good"
                    modKey="headcountMoney"
                  />
                )}
                {modifiers.freeStartingLevels > 0 && (
                  <PanelRow
                    label="Free interns"
                    value={`+${modifiers.freeStartingLevels}/run`}
                    tone="good"
                  />
                )}
                {modifiers.disableManagers && (
                  <PanelRow label="Managers disabled" value="✕" tone="bad" />
                )}
                {modifiers.satisfactionNeutralized && (
                  <PanelRow label="Satisfaction off" value="✕" tone="bad" />
                )}
              </div>
            )}
          </div>
        </aside>
      )}
    </div>
  );
};
