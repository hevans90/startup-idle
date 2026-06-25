import { useState } from "react";
import { twMerge } from "tailwind-merge";
import { FOUNDERS } from "../game/founders.catalog";
import { type PrestigeModifiers } from "../game/skill-tree";
import { useExitsStore } from "../state/exits.store";
import { useFounderStore } from "../state/founder.store";
import { usePrestigeStore } from "../state/prestige.store";
import { MANDATES, useValuationStore } from "../state/valuation.store";
import { useVapeAchievementsStore } from "../state/vape-achievements.store";
import { CURRENT_VERSION } from "../state/version.store";
import { BonusRow, BonusSection, fmtMult } from "../ui/BonusRow";
import { Button } from "../ui/Button";
import { formatCurrency } from "../utils/money-utils";
import { TenXDevText } from "../utils/ten-x-utils";
import { RainbowText } from "../utils/vibe-utils";
import { SkillTreeOverlay } from "./skill-tree/skill-tree-overlay";

// ─── local helpers ───────────────────────────────────────────────────────────

function treeRows(m: PrestigeModifiers) {
  type Row = { label: string; value: string; tone: "good" | "bad" };
  const rows: Row[] = [];

  const mult = (label: string, v: number, betterUp = true) => {
    if (v === 1) return;
    rows.push({
      label,
      value: fmtMult(v),
      tone: (betterUp ? v > 1 : v < 1) ? "good" : "bad",
    });
  };

  mult("Money output", m.moneyMult);
  mult("Innovation", m.innovationMult);
  mult("Valuation", m.valuationMult);
  mult("Employee output", m.employeeOutputMult);
  mult("Auto-buy speed", m.autoBuyMult);
  mult("Manager speed", m.managerSpeedMult);
  mult("Hire cost", m.hireCostMult, false);
  mult("Singularity rate", m.singularityMult);
  mult("Satisfaction gain", m.satisfactionGainMult);
  mult("Equity payout", m.equityMult);
  mult("Intern output", m.internOutputMult);

  if (m.headcountPerEmployee > 0)
    rows.push({
      label: "Headcount synergy",
      value: `+${(m.headcountPerEmployee * 100).toFixed(1)}%/emp`,
      tone: "good",
    });
  if (m.freeStartingLevels > 0)
    rows.push({
      label: "Free interns",
      value: `+${m.freeStartingLevels}/run`,
      tone: "good",
    });
  if (m.disableManagers)
    rows.push({ label: "Managers disabled", value: "✕", tone: "bad" });
  if (m.satisfactionNeutralized)
    rows.push({ label: "Satisfaction off", value: "✕", tone: "bad" });

  return rows;
}

// Split regex preserves matches via capture group so segments are either plain text or keywords.
const SPLIT_RE = /(vibe coders?|10x devs?)/gi;

function PerkText({ text }: { text: string }) {
  const segments = text.split(SPLIT_RE);
  return (
    <>
      {segments.map((seg, i) => {
        if (/^vibe coders?$/i.test(seg))
          return <RainbowText key={i} text={seg} inline />;
        if (/^10x devs?$/i.test(seg)) return <TenXDevText key={i} text={seg} />;
        return <span key={i}>{seg}</span>;
      })}
    </>
  );
}

// ─── main component ──────────────────────────────────────────────────────────

/**
 * Full-screen first-run takeover: pick a founder before the game (map, toolbar,
 * sidebar) appears. Selecting one applies its modifiers + starting cash and
 * flips `selectedFounderId`, after which `App` renders the normal game.
 */
export const FounderSelect = () => {
  const chooseFounder = useFounderStore((s) => s.chooseFounder);
  const [selected, setSelected] = useState<string | null>(null);

  const equity = usePrestigeStore((s) => s.equity);
  const exits = usePrestigeStore((s) => s.exits);
  const founderExits = useExitsStore((s) => s.exits);
  const bestExitValuation = useExitsStore((s) => s.bestExitValuation);
  const allocated = usePrestigeStore((s) => s.allocated.length);
  const modifiers = usePrestigeStore((s) => s.modifiers);

  const mandateLevels = useValuationStore((s) => s.mandateLevels);
  const activeMandates = MANDATES.filter((m) => mandateLevels[m.id] > 0);

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
  const hasVape =
    juiceMpsBonus > 0 ||
    juiceInnovBonus > 0 ||
    juiceValuationBonus > 0 ||
    juiceHireCostReduction > 0 ||
    juiceEquityBonus > 0;

  const [treeOpen, setTreeOpen] = useState(false);
  const showPrestige = exits > 0 || equity.gt(0);
  const hasPoints = equity.gt(0);

  const rows = treeRows(modifiers);
  const hasTree = rows.length > 0;
  const hasBonuses = hasTree || activeMandates.length > 0 || hasVape;

  return (
    <div className="flex h-full w-full flex-col items-center overflow-y-auto bg-primary-100 px-4 py-8 text-primary-900 dark:bg-primary-900 dark:text-primary-50">
      <h1 className="text-3xl font-bold sm:text-4xl">Startup Idle</h1>
      <p className="mt-2 text-center text-sm opacity-70">
        Which type of shitlord tech bro are you?
      </p>

      {showPrestige && (
        <div className="mt-4 mb-2 flex items-center gap-4 rounded-lg border border-primary-300 bg-primary-200/60 px-4 py-2 dark:border-primary-700 dark:bg-primary-800/60">
          <div className="text-sm tabular-nums">
            <span className="opacity-60">Equity</span>{" "}
            <span className="font-bold text-amber-600 dark:text-amber-400">
              {formatCurrency(equity, { showDollarSign: false })}
            </span>
            <span className="ml-3 opacity-60">Exits {exits}</span>
          </div>
          <Button
            type="button"
            onClick={() => setTreeOpen(true)}
            className={twMerge(
              "text-sm transition-shadow",
              hasPoints &&
                "animate-pulse ring-2 ring-amber-400 shadow-[0_0_18px_3px_rgba(251,191,36,0.6)]",
            )}
          >
            {hasPoints ? "Spend Equity →" : "Acquisition tree"}
          </Button>
        </div>
      )}

      <div className="mb-6" />

      {treeOpen && <SkillTreeOverlay onClose={() => setTreeOpen(false)} />}

      <div className="grid w-full max-w-5xl grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 [grid-auto-rows:1fr]">
        {FOUNDERS.map((f) => {
          const Icon = f.icon;
          const isSel = selected === f.id;
          const exitRecord = founderExits[f.id];
          const exitCount = exitRecord?.count ?? 0;
          const hasExits = exitCount > 0;
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
                  ? twMerge(
                      "cursor-pointer",
                      isSel
                        ? "border-emerald-600 bg-emerald-500/5"
                        : "border-primary-300 hover:border-primary-400 dark:border-primary-700 dark:hover:border-primary-500",
                    )
                  : "cursor-not-allowed border-primary-300/40 dark:border-primary-700/40",
              )}
            >
              {/* Header */}
              <div className="flex items-start gap-2">
                <Icon size={26} stroke={1.6} className="mt-0.5 shrink-0" />
                <div className="min-w-0 flex-1">
                  <div className="font-bold leading-tight">{f.name}</div>
                  <div className="text-xs italic opacity-60">{f.tagline}</div>
                </div>
                {isUnlocked && hasExits && (
                  <div className="shrink-0 bg-amber-500/15 px-2 py-0.5 text-[10px] font-bold tabular-nums text-amber-600 dark:text-amber-400">
                    {exitCount}×
                  </div>
                )}
              </div>

              {/* Perks — flex-1 so this section fills the variable space */}
              <ul className="mt-3 flex flex-1 flex-col gap-1 text-xs tabular-nums opacity-90">
                {f.perks(exitCount).map((p, i) => (
                  <li key={i}>
                    • <PerkText text={p} />
                  </li>
                ))}
              </ul>

              {/* Starting cash */}
              <div className="mt-4 border-t border-primary-300 pt-2 text-xs font-semibold tabular-nums text-emerald-700 dark:border-primary-700 dark:text-emerald-400">
                Starts with ${f.startingCash}
              </div>

              {/* Per-exit scaling */}
              <div className="mt-2 border border-violet-400/20 bg-violet-500/5 px-2 py-1.5 text-[10px] leading-snug text-violet-600 dark:text-violet-400">
                <span className="font-semibold">
                  {f.scalingModifier.label}:
                </span>{" "}
                {f.scalingModifier.perExitDescription}
              </div>

              {/* Lock overlay */}
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
                    <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
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

      {showPrestige && (
        <div className="mt-6 w-full max-w-5xl border border-primary-300 bg-primary-200/60 p-4 dark:border-primary-700 dark:bg-primary-800/60">
          <p className="mb-3 text-[10px] font-semibold uppercase tracking-wide opacity-50">
            Permanent bonuses
          </p>

          {hasBonuses ? (
            <div className="flex flex-wrap gap-x-8 gap-y-4">
              {hasTree && (
                <BonusSection title={`Skill tree · ${allocated} nodes`}>
                  {rows.map((r) => (
                    <BonusRow
                      key={r.label}
                      label={r.label}
                      value={r.value}
                      tone={r.tone}
                    />
                  ))}
                </BonusSection>
              )}

              {activeMandates.length > 0 && (
                <BonusSection title="Board mandates">
                  {activeMandates.map((mandate) => {
                    const lv = mandateLevels[mandate.id];
                    const parts: string[] = [];
                    if (mandate.moneyMultPerLevel > 0)
                      parts.push(
                        `+${(lv * mandate.moneyMultPerLevel * 100).toFixed(0)}% money`,
                      );
                    if (mandate.innovationMultPerLevel > 0)
                      parts.push(
                        `+${(lv * mandate.innovationMultPerLevel * 100).toFixed(0)}% innovation`,
                      );
                    const detail = parts.length > 0 ? ` · ${parts.join(", ")}` : "";
                    return (
                      <BonusRow
                        key={mandate.id}
                        label={mandate.name}
                        value={`Lv ${lv}${detail}`}
                        tone="neutral"
                      />
                    );
                  })}
                </BonusSection>
              )}

              {hasVape && (
                <BonusSection title="Vape shop">
                  {juiceMpsBonus > 0 && (
                    <BonusRow
                      label="Money output"
                      value={`+${(juiceMpsBonus * 100).toFixed(0)}%`}
                      tone="good"
                    />
                  )}
                  {juiceInnovBonus > 0 && (
                    <BonusRow
                      label="Innovation"
                      value={`+${(juiceInnovBonus * 100).toFixed(0)}%`}
                      tone="good"
                    />
                  )}
                  {juiceValuationBonus > 0 && (
                    <BonusRow
                      label="Valuation rate"
                      value={`+${(juiceValuationBonus * 100).toFixed(0)}%`}
                      tone="good"
                    />
                  )}
                  {juiceHireCostReduction > 0 && (
                    <BonusRow
                      label="Hire cost"
                      value={`−${(juiceHireCostReduction * 100).toFixed(0)}%`}
                      tone="good"
                    />
                  )}
                  {juiceEquityBonus > 0 && (
                    <BonusRow
                      label="Equity payout"
                      value={`+${(juiceEquityBonus * 100).toFixed(0)}%`}
                      tone="good"
                    />
                  )}
                </BonusSection>
              )}
            </div>
          ) : (
            <p className="text-xs opacity-50">
              No bonuses yet — spend your Equity in the acquisition tree.
            </p>
          )}
        </div>
      )}

      <Button
        type="button"
        disabled={selected == null}
        className="mt-8 px-6 py-3 text-base font-bold disabled:opacity-40"
        onClick={() => selected && chooseFounder(selected)}
      >
        Found your startup →
      </Button>

      <span className="mt-6 self-start text-[11px] tabular-nums opacity-30">
        v{CURRENT_VERSION}
      </span>
    </div>
  );
};
