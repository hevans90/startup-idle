/**
 * THE PERMANENT BONUSES, on the founding screen: Equity's figure, and under it
 * — on a hover or a tap — what the tree, the juice and the mandates come to
 * together. @see FounderSelect
 */
import { percent, times } from "../game/wording";
import { usePrestigeStore } from "../state/prestige.store";
import { MANDATES, useValuationStore } from "../state/valuation.store";
import { useVapeAchievementsStore } from "../state/vape-achievements.store";
import { PopRow } from "../ui/console";
import { InfoPop } from "../ui/InfoPop";
import { formatCurrency } from "../utils/money-utils";
import { HudFigure } from "./founding-shell";

type Row = { label: string; value: string; tone: "good" | "bad" };

/** Every bonus that is not nothing, in the game's words. */
function useBonusRows(): Row[] {
  const modifiers = usePrestigeStore((s) => s.modifiers);
  const mandateLevels = useValuationStore((s) => s.mandateLevels);
  const juice = useVapeAchievementsStore();
  const mandate = (k: "moneyMultPerLevel" | "innovationMultPerLevel") =>
    MANDATES.reduce((acc, m) => acc + (mandateLevels[m.id] ?? 0) * (m[k] ?? 0), 0);
  const money = modifiers.moneyMult * modifiers.employeeOutputMult * (1 + juice.juiceMpsMultBonus) * (1 + mandate("moneyMultPerLevel"));
  const innovation = modifiers.innovationMult * modifiers.employeeOutputMult * (1 + juice.juiceInnovationMultBonus) * (1 + mandate("innovationMultPerLevel"));
  const rows: (Row | false)[] = [
    money !== 1 && { label: "Money", value: times(money), tone: "good" },
    innovation !== 1 && { label: "Innovation", value: times(innovation), tone: "good" },
    modifiers.valuationMult * (1 + juice.juiceValuationMultBonus) !== 1 && { label: "Valuation", value: times(modifiers.valuationMult * (1 + juice.juiceValuationMultBonus)), tone: "good" },
    modifiers.hireCostMult * (1 - juice.juiceHireCostReduction) !== 1 && (() => { const v = modifiers.hireCostMult * (1 - juice.juiceHireCostReduction); return { label: "Hires", value: times(v), tone: v < 1 ? "good" : "bad" } as Row; })(),
    modifiers.equityMult * (1 + juice.juiceEquityMultBonus) !== 1 && { label: "Equity", value: times(modifiers.equityMult * (1 + juice.juiceEquityMultBonus)), tone: "good" },
    modifiers.autoBuyMult !== 1 && { label: "Auto-buy", value: times(modifiers.autoBuyMult), tone: "good" },
    modifiers.managerSpeedMult !== 1 && { label: "Manager speed", value: times(modifiers.managerSpeedMult), tone: "good" },
    modifiers.satisfactionGainMult !== 1 && { label: "Morale recovery", value: times(modifiers.satisfactionGainMult), tone: modifiers.satisfactionGainMult > 1 ? "good" : "bad" },
    modifiers.singularityMult !== 1 && { label: "AI meter", value: times(modifiers.singularityMult), tone: "good" },
    modifiers.internOutputMult !== 1 && { label: "Interns", value: times(modifiers.internOutputMult), tone: "good" },
    modifiers.headcountPerEmployee > 0 && { label: "Money per employee", value: percent(modifiers.headcountPerEmployee * 100), tone: "good" },
    modifiers.freeStartingLevels > 0 && { label: "Free interns", value: `+${modifiers.freeStartingLevels}`, tone: "good" },
    modifiers.disableManagers && { label: "Managers", value: "off", tone: "bad" },
    modifiers.satisfactionNeutralized && { label: "Morale", value: "off", tone: "bad" },
  ];
  return rows.filter((r): r is Row => !!r);
}

/** EQUITY, and what has been bought with it under it. */
export function EquityFigure() {
  const equity = usePrestigeStore((s) => s.equity);
  const rows = useBonusRows();
  const figure = <HudFigure label="Equity" value={formatCurrency(equity, { showDollarSign: false })} className="text-warn" />;
  if (!rows.length) return figure;
  return (
    <InfoPop placement="bottom" title="Permanent bonuses" trigger={figure}>
      <div className="flex flex-col divide-y divide-line-quiet">
        {rows.map((r) => <PopRow key={r.label} label={r.label} value={r.value} valueClass={r.tone === "good" ? "text-good" : "text-bad"} />)}
      </div>
    </InfoPop>
  );
}
