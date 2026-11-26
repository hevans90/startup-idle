import { lazy, Suspense, useEffect, useState } from "react";
import { FOUNDERS } from "../game/founders.catalog";
import { useExitsStore } from "../state/exits.store";
import { useFounderStore } from "../state/founder.store";
import { usePrestigeStore } from "../state/prestige.store";
import { Dialog } from "../ui/console";
import { FounderHero, FounderProfile, FounderTile } from "./founder-card";
import { HudButton, HudFigure } from "./founding-shell";
import { EquityFigure } from "./permanent-bonuses";
import { FoundingShell } from "./founding-shell";
import { TermSheetSelect } from "./term-sheet-select";
import { dealEffects } from "../game/term-deal";
import { useMoneyStore } from "../state/money.store";
import { formatCurrency } from "../utils/money-utils";
import { fusedInto } from "../game/fusion";
import { useGenerationStore } from "../state/generation.store";
import { ModelShop } from "./model-shop";
import { AscensionRecap } from "./ascension-recap";
import { Credits } from "./credits";
import { Lineage } from "./lineage";
import { SkillTreeOverlay } from "./skill-tree/skill-tree-overlay";
import { useSessionStore } from "../state/session.store";
import { gpuForPixi } from "../world/render/use-gpu";
import { loadCompanyMap } from "../world/play/company-map-loader";

/**
 * STEP TWO of founding: choosing the land the company is founded on. In its
 * own chunk, with the map generator it runs. @see MapSetup
 */
const loadMapSetup = () => import("../world/play/map-setup");
const MapSetup = lazy(loadMapSetup);

/**
 * THE MAP, MADE READY WHILE FOUNDING: its chunk fetched and the GPU device
 * opened while the player picks, so the map draws as soon as the term sheet is
 * signed rather than starting to load then. @see loadCompanyMap, usePixiGpu
 */
const READY_AFTER_MS = 500;
function useMapMadeReady(): void {
  useEffect(() => {
    // (The next step's code, at once: fetched only when a founder was picked, it was found gone after a deploy.)
    loadMapSetup().catch(() => {});
    const id = window.setTimeout(() => {
      loadCompanyMap().catch(() => {});
      void gpuForPixi();
    }, READY_AFTER_MS);
    return () => window.clearTimeout(id);
  }, []);
}

// ─── main component ───────────────────────────────────────────────────────────

export const FounderSelect = () => {
  useMapMadeReady();
  const chooseFounder = useFounderStore((s) => s.chooseFounder);
  // BOOK 5 IS PLAYED AS THE MODEL: its only founder. @see BOOK5_CHAPTERS
  const asModel = useGenerationStore((s) => s.book) === 5;
  const [selected, setSelected] = useState<string | null>(asModel ? "model" : null);
  // THE CREDITS, once, after book 5's Ascension, before its recap. @see Credits
  const [credited, setCredited] = useState(false);
  // FOUNDING IS THREE STEPS: who, where, then on what terms. @see MapSetup, TermSheetSelect
  const [step, setStep] = useState<"founder" | "land" | "terms">("founder");
  const [land, setLand] = useState<{ seed: number; params: Record<string, number> } | null>(null);
  const setMapChoice = useSessionStore((s) => s.setMapChoice);
  const setTermSheet = useSessionStore((s) => s.setTermSheet);
  const setTermClauses = useSessionStore((s) => s.setTermClauses);
  const announce = useGenerationStore((s) => s.announce);
  const generation = useGenerationStore((s) => s.generation);

  const equity = usePrestigeStore((s) => s.equity);
  const exits = usePrestigeStore((s) => s.exits);
  const founderExits = useExitsStore((s) => s.exits);
  const bestExitValuation = useExitsStore((s) => s.bestExitValuation);

  const [treeOpen, setTreeOpen] = useState(false);
  const [shopOpen, setShopOpen] = useState(false);
  const [lineageOpen, setLineageOpen] = useState(false);
  const past = useGenerationStore((s) => s.past.length);
  const weights = useGenerationStore((s) => s.weights);
  const showPrestige = exits > 0 || equity.gt(0);
  // (Enough for the tree's next node: a dot by its button.)
  const hasPoints = usePrestigeStore((s) => s.equity.gte(s.getNextCost()));
  // A founder fused with the AI is always playable; the Model, from the first Ascension. Run locally, everyone is.
  const roster = FOUNDERS.filter((f) => !asModel || f.id === "model").map((f) => ({
    f, exits: founderExits[f.id]?.count ?? 0,
    unlocked: import.meta.env.DEV || !f.unlockCondition || f.unlockCondition.check(exits, bestExitValuation) || fusedInto(f.id).length > 0 || (f.id === "model" && generation > 1),
  }));
  // (Someone is always chosen: the first who can be.)
  const chosen = roster.find((r) => r.f.id === selected && r.unlocked) ?? roster.find((r) => r.unlocked) ?? null;
  const pick = chosen?.f.id ?? null;

  if (step === "land" && pick) {
    return (
      <Suspense fallback={<div className="h-full w-full bg-surface-1" />}>
        <MapSetup
          founder={FOUNDERS.find((f) => f.id === pick)?.name ?? "you"}
          onBack={() => setStep("founder")}
          onFound={(choice) => { setLand({ seed: choice.seed, params: { ...choice.params } }); setStep("terms"); }}
        />
      </Suspense>
    );
  }
  if (step === "terms" && pick && land) {
    return (
      <TermSheetSelect seed={land.seed} founder={FOUNDERS.find((f) => f.id === pick)?.name ?? "The founder"} onBack={() => setStep("land")}
        onSign={(id, clauses) => {
          // The land first, so the company's map is made from it when it mounts.
          setMapChoice(land);
          setTermSheet(id);
          setTermClauses(clauses);
          // A SWEETENER is spent on the deal it sweetened. @see SWEETENER
          useExitsStore.getState().setSweetener(false);
          // Announced; a new company is under way.
          useGenerationStore.setState({ announce: null });
          chooseFounder(pick);
          // THE INVESTMENT, wired in at signing, on top of the founder's own cash. @see term-deal
          const cash = dealEffects(clauses).cash;
          if (cash > 0) useMoneyStore.getState().increaseMoney(cash);
        }} />
    );
  }

  return (
    <FoundingShell
      step="founder"
      title="Choose a founder"
      next={{ label: "Continue →", disabled: pick == null, onClick: () => pick && setStep("land") }}
      meta={<>
        {showPrestige && <EquityFigure />}
        {(generation > 1 || weights > 0) && <HudFigure label="Weights" value={formatCurrency(weights, { showDollarSign: false })} className="text-weights" />}
        {generation > 1 && <HudFigure label="Gen" value={generation} />}
      </>}
      foot={<>
        {showPrestige && (
          <HudButton onClick={() => setTreeOpen(true)}>
            Skill tree{hasPoints && <span aria-label="Equity to spend" className="inline-block size-1.5 rounded-full bg-warn" />}
          </HudButton>
        )}
        {(generation > 1 || weights > 0) && <HudButton tone="ai" onClick={() => setShopOpen(true)}>Machine</HudButton>}
        {past > 0 && <HudButton onClick={() => setLineageOpen(true)}>Lineage</HudButton>}
      </>}
    >
      {treeOpen && <SkillTreeOverlay onClose={() => setTreeOpen(false)} />}
      {shopOpen && (
        // THE MACHINE, between companies: Weights spent before the next run. @see ModelShop
        <Dialog title="The Machine" kicker="Weights" tone="ai" wide="xl" onClose={() => setShopOpen(false)}>
          <div className="max-h-[78vh] overflow-y-auto">
            <ModelShop />
          </div>
        </Dialog>
      )}

      {/* THE ASCENSION JUST MADE, recapped once; the lineage, any time. @see ascend */}
      {announce && announce.book === 5 && !credited && <Credits gone={announce} onDone={() => setCredited(true)} />}
      {announce && (announce.book !== 5 || credited) && <AscensionRecap gone={announce} onLineage={() => setLineageOpen(true)} onDone={() => useGenerationStore.setState({ announce: null })} />}
      {lineageOpen && <Lineage onClose={() => setLineageOpen(false)} />}

      {/* THE ROSTER; the one chosen at the centre; their profile beside. */}
      <div className="my-auto grid w-full min-w-0 items-center gap-8 pb-[6vh] lg:grid-cols-[17rem_1fr_22rem] xl:grid-cols-[19rem_1fr_26rem]">
        <ul role="listbox" aria-label="Founders" className="flex flex-col gap-2 max-lg:-mx-4 max-lg:snap-x max-lg:flex-row max-lg:overflow-x-auto max-lg:px-4 max-lg:pb-2 max-lg:[&>li]:w-56 max-lg:[&>li]:shrink-0 max-lg:[&>li]:snap-start">
          {roster.map((r, i) => (
            <FounderTile key={r.f.id} founder={r.f} index={i} exits={r.exits} unlocked={r.unlocked} selected={r.f.id === pick} onSelect={() => setSelected(r.f.id)} />
          ))}
        </ul>
        {chosen && <FounderHero key={`h-${chosen.f.id}`} founder={chosen.f} exits={chosen.exits} />}
        {chosen && <FounderProfile key={`p-${chosen.f.id}`} founder={chosen.f} exits={chosen.exits} />}
      </div>
    </FoundingShell>
  );
};
