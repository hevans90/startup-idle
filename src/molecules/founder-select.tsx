import { type ReactNode, useState } from "react";
import { twMerge } from "tailwind-merge";
import { FOUNDERS } from "../game/founders.catalog";
import { type PrestigeModifiers } from "../game/skill-tree";
import { useFounderStore } from "../state/founder.store";
import { usePrestigeStore } from "../state/prestige.store";
import { MANDATES, useValuationStore } from "../state/valuation.store";
import { useVapeAchievementsStore } from "../state/vape-achievements.store";
import { Button } from "../ui/Button";
import { formatCurrency } from "../utils/money-utils";
import { SkillTreeOverlay } from "./skill-tree/skill-tree-overlay";

// ─── local helpers ───────────────────────────────────────────────────────────

const BonusSection = ({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) => (
  <div className="flex min-w-40 flex-1 flex-col gap-2">
    <p className="text-[10px] font-semibold uppercase tracking-wider opacity-40">
      {title}
    </p>
    <div className="flex flex-col gap-1 text-xs">{children}</div>
  </div>
);

const BonusRow = ({
  label,
  value,
  tone = "good",
}: {
  label: string;
  value: string;
  tone?: "good" | "bad" | "neutral";
}) => (
  <div className="flex items-baseline justify-between gap-3">
    <span className="truncate opacity-60">{label}</span>
    {value && (
      <span
        className={`shrink-0 font-medium tabular-nums ${
          tone === "good"
            ? "text-emerald-600 dark:text-emerald-400"
            : tone === "bad"
              ? "text-rose-500 dark:text-rose-400"
              : "text-cyan-600 dark:text-cyan-400"
        }`}
      >
        {value}
      </span>
    )}
  </div>
);

function treeRows(m: PrestigeModifiers) {
  type Row = { label: string; value: string; tone: "good" | "bad" };
  const rows: Row[] = [];

  const mult = (label: string, v: number, betterUp = true) => {
    if (v === 1) return;
    rows.push({
      label,
      value: `×${v.toFixed(2)}`,
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
  const allocated = usePrestigeStore((s) => s.allocated.length);
  const modifiers = usePrestigeStore((s) => s.modifiers);

  const mandateLevels = useValuationStore((s) => s.mandateLevels);
  const activeMandates = MANDATES.filter((m) => mandateLevels[m.id] > 0);

  const juiceMpsBonus = useVapeAchievementsStore((s) => s.juiceMpsMultBonus);
  const juiceInnovBonus = useVapeAchievementsStore(
    (s) => s.juiceInnovationMultBonus,
  );
  const hasVape = juiceMpsBonus > 0 || juiceInnovBonus > 0;

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

      <div className="grid w-full max-w-5xl grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {FOUNDERS.map((f) => {
          const Icon = f.icon;
          const isSel = selected === f.id;
          return (
            <button
              key={f.id}
              type="button"
              onClick={() => setSelected(f.id)}
              className={twMerge(
                "flex cursor-pointer flex-col gap-2 rounded-lg border-2 p-4 text-left transition-colors",
                isSel
                  ? "border-emerald-500 bg-emerald-500/10"
                  : "border-primary-300 hover:border-primary-400 dark:border-primary-700 dark:hover:border-primary-500",
              )}
            >
              <div className="flex items-center gap-2">
                <Icon size={28} stroke={1.6} className="shrink-0" />
                <div className="min-w-0">
                  <div className="font-bold leading-tight">{f.name}</div>
                  <div className="text-xs italic opacity-70">{f.tagline}</div>
                </div>
              </div>
              <ul className="flex flex-col gap-1 text-xs tabular-nums opacity-90">
                {f.perks.map((p, i) => (
                  <li key={i}>• {p}</li>
                ))}
              </ul>
              <div className="mt-auto border-t border-primary-300 pt-2 text-xs font-semibold tabular-nums text-emerald-700 dark:border-primary-700 dark:text-emerald-400">
                Starts with ${f.startingCash}
              </div>
            </button>
          );
        })}
      </div>

      {showPrestige && (
        <div className="mt-6 w-full max-w-5xl rounded-lg border border-primary-300 bg-primary-200/60 p-4 dark:border-primary-700 dark:bg-primary-800/60">
          <p className="mb-3 text-[10px] font-semibold uppercase tracking-wider opacity-40">
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
                        `+${(lv * mandate.innovationMultPerLevel * 100).toFixed(0)}% innov.`,
                      );
                    return (
                      <div
                        key={mandate.id}
                        className="flex items-baseline justify-between gap-3 text-xs"
                      >
                        <span className="truncate opacity-60">
                          {mandate.name}
                        </span>
                        <span className="shrink-0 tabular-nums">
                          <span className="font-medium text-cyan-600 dark:text-cyan-400">
                            Lv {lv}
                          </span>
                          {parts.length > 0 && (
                            <span className="ml-1.5 opacity-50">
                              {parts.join(", ")}
                            </span>
                          )}
                        </span>
                      </div>
                    );
                  })}
                </BonusSection>
              )}

              {hasVape && (
                <BonusSection title="Vape shop">
                  {juiceMpsBonus > 0 && (
                    <BonusRow
                      label="Money output"
                      value={`+${(juiceMpsBonus * 100).toFixed(1)}%`}
                      tone="good"
                    />
                  )}
                  {juiceInnovBonus > 0 && (
                    <BonusRow
                      label="Innovation"
                      value={`+${(juiceInnovBonus * 100).toFixed(1)}%`}
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
    </div>
  );
};
