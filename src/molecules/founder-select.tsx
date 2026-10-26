import { lazy, Suspense, useState } from "react";
import { twMerge } from "tailwind-merge";
import { FOUNDERS } from "../game/founders.catalog";
import { useExitsStore } from "../state/exits.store";
import { useFounderStore } from "../state/founder.store";
import { usePrestigeStore } from "../state/prestige.store";
import { MANDATES, useValuationStore } from "../state/valuation.store";
import { useVapeAchievementsStore } from "../state/vape-achievements.store";
import { CURRENT_VERSION } from "../state/version.store";
import { fmtMult } from "../ui/BonusRow";
import { Button, Dialog, Tile } from "../ui/console";
import { FoundingShell } from "./founding-shell";
import { TermSheetSelect } from "./term-sheet-select";
import { FusedTraits } from "./fused-traits";
import { fusedInto } from "../game/fusion";
import { trait } from "../game/traits";
import { useGenerationStore } from "../state/generation.store";
import { ModelShop } from "./model-shop";
import { ModifierTag } from "../ui/ModifierTag";
import { formatCurrency } from "../utils/money-utils";
import { TenXDevText } from "../utils/ten-x-utils";
import { RainbowText } from "../utils/vibe-utils";
import { SkillTreeOverlay } from "./skill-tree/skill-tree-overlay";
import { useSessionStore } from "../state/session.store";

/**
 * STEP TWO of founding: choosing the land the company is founded on. In its
 * own chunk, with the map generator it runs. @see MapSetup
 */
const MapSetup = lazy(() => import("../world/play/map-setup"));

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
  if (tone === "good") return "text-good";
  if (tone === "bad") return "text-bad";
  return "text-innovation";
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
  // FOUNDING IS THREE STEPS: who, where, then on what terms. @see MapSetup, TermSheetSelect
  const [step, setStep] = useState<"founder" | "land" | "terms">("founder");
  const [land, setLand] = useState<{ seed: number; params: Record<string, number> } | null>(null);
  const setMapChoice = useSessionStore((s) => s.setMapChoice);
  const setTermSheet = useSessionStore((s) => s.setTermSheet);
  const announce = useGenerationStore((s) => s.announce);
  const generation = useGenerationStore((s) => s.generation);

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
  const [shopOpen, setShopOpen] = useState(false);
  const weights = useGenerationStore((s) => s.weights);
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

  if (step === "land" && selected) {
    return (
      <Suspense fallback={<div className="h-full w-full bg-surface-1" />}>
        <MapSetup
          founder={FOUNDERS.find((f) => f.id === selected)?.name ?? "you"}
          onBack={() => setStep("founder")}
          onFound={(choice) => { setLand({ seed: choice.seed, params: { ...choice.params } }); setStep("terms"); }}
        />
      </Suspense>
    );
  }
  if (step === "terms" && selected && land) {
    return (
      <TermSheetSelect seed={land.seed} onBack={() => setStep("land")}
        onSign={(id) => {
          // The land first, so the company's map is made from it when it mounts.
          setMapChoice(land);
          setTermSheet(id);
          // Announced; a new company is under way.
          useGenerationStore.setState({ announce: null });
          chooseFounder(selected);
        }} />
    );
  }

  return (
    <FoundingShell
      step="founder"
      title="Startup Idle"
      subtitle="Which type of shitlord tech bro are you?"
      next={{ label: "Next: choose your land →", disabled: selected == null, onClick: () => selected && setStep("land") }}
      foot={<>v{CURRENT_VERSION}</>}
      // THE PERMANENT BONUSES, beside it on a wide screen.
      aside={showPrestige ? (
        <aside className="relative hidden w-72 shrink-0 flex-col overflow-y-auto border-l border-line-quiet bg-surface-1 lg:flex xl:w-80">
          {/* sticky header */}
          <div className="sticky top-0 z-10 flex min-h-10 items-center border-b border-line-quiet bg-surface-2/60 px-4 backdrop-blur-sm">
            <h2 className="flex items-center gap-2 font-display text-xs uppercase tracking-widest">
              <span aria-hidden className="h-3 w-0.5 bg-console" />Permanent bonuses
            </h2>
          </div>

          {/* equity + skill tree CTA */}
          <div className="flex items-center justify-between gap-3 border-b border-line/40 px-4 py-4">
            <div>
              <p className="text-[10px] font-medium uppercase tracking-wider opacity-40">
                Equity
              </p>
              <p className="mt-0.5 text-xl font-black tabular-nums text-warn leading-none">
                {formatCurrency(equity, { showDollarSign: false })}
              </p>
              <p className="mt-1 text-[10px] tabular-nums opacity-30">
                {exits} exit{exits !== 1 ? "s" : ""}
              </p>
            </div>
            <Button
              type="button"
              onClick={() => setTreeOpen(true)}
              className={twMerge(
                "shrink-0 text-xs transition-shadow",
                hasPoints &&
                  "animate-pulse ring-2 ring-warn shadow-[0_0_18px_3px_var(--ui-warn-soft)]",
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
              <div className="flex flex-col divide-y divide-line-quiet text-[11px]">
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
      ) : undefined}
    >
      {treeOpen && <SkillTreeOverlay onClose={() => setTreeOpen(false)} />}
      {shopOpen && (
        // THE MODEL'S SHOP, between companies: Weights spent before the next run. @see ModelShop
        <Dialog title="The Model" kicker="Weights" tone="ai" wide onClose={() => setShopOpen(false)}>
          <div className="-mx-5 max-h-[70vh] overflow-y-auto pb-1">
            <ModelShop onOpenTree={() => { setShopOpen(false); setTreeOpen(true); }} />
          </div>
        </Dialog>
      )}

      {/* THE ASCENSION JUST MADE, said once. @see ascend */}
      {announce && (
        <div className="mx-auto mb-4 w-full max-w-[110rem] border border-ai-line bg-ai-soft px-3 py-2 text-sm text-ai">
          Generation {announce.generation} ascended: the AI became <b>{trait(announce.trait).name}</b>
          {announce.mutated ? " (it mutated)" : ""}, fused into <b>{FOUNDERS.find((x) => x.id === announce.founder)?.name ?? announce.founder}</b>.
          {" "}+{announce.weights} Weights. Generation {announce.generation + 1} begins.
        </div>
      )}

      {/* WEIGHTS, to spend before the next company starts. @see ModelShop */}
      {(generation > 1 || weights > 0) && (
        <div className="mx-auto mb-4 flex w-full max-w-[110rem] items-center justify-between gap-3 border border-ai-line bg-ai-soft px-3 py-2 text-sm">
          <span>
            Generation {generation} · <b className="tabular-nums text-weights">{weights}</b> Weights
          </span>
          <Button size="sm" className="shrink-0" onClick={() => setShopOpen(true)}>Spend Weights →</Button>
        </div>
      )}

      {/* AS MANY ACROSS AS FIT, a card at least 15rem wide: every founder in a row on a wide screen. */}
      <div className="mx-auto w-full max-w-[110rem]">
          <div className="grid grid-cols-[repeat(auto-fill,minmax(15rem,1fr))] gap-3 [grid-auto-rows:1fr]">
            {FOUNDERS.map((f) => {
              const Icon = f.icon;
              const isSel = selected === f.id;
              const exitRecord = founderExits[f.id];
              const exitCount = exitRecord?.count ?? 0;
              // A founder fused with the AI is always playable. @see game/fusion
              const isUnlocked =
                !f.unlockCondition ||
                f.unlockCondition.check(exits, bestExitValuation) ||
                fusedInto(f.id).length > 0 ||
                // THE MODEL, from the first Ascension. @see plans/singularity.md §4b
                (f.id === "model" && generation > 1);

              return (
                <Tile
                  key={f.id}
                  disabled={!isUnlocked}
                  aria-pressed={isSel}
                  selected={isSel}
                  onClick={() => isUnlocked && setSelected(f.id)}
                  className="flex h-full w-full flex-col overflow-hidden p-4"
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
                      <div className="shrink-0 bg-warn/15 px-2 py-0.5 text-[10px] font-bold tabular-nums text-warn">
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

                  {f.rule && (
                    <p className="mt-2 border border-info/30 bg-info/10 px-2 py-1 text-[11px] leading-snug text-info">
                      <span className="font-semibold">On the map:</span> {f.rule}
                    </p>
                  )}
                  <FusedTraits founder={f.id} />

                  <div className="mt-4 border-t border-line pt-2 text-xs font-semibold tabular-nums text-good">
                    Starts with ${f.startingCash}
                  </div>

                  <div className="mt-2 border border-ai/20 bg-ai/5 px-2 py-1.5 text-[10px] leading-snug text-ai">
                    <span className="font-semibold">
                      {f.scalingModifier.label}:
                    </span>{" "}
                    {f.scalingModifier.perExitDescription}
                  </div>

                  {!isUnlocked && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-surface-1/40 backdrop-blur">
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
                </Tile>
              );
            })}
          </div>

      </div>
    </FoundingShell>
  );
};
