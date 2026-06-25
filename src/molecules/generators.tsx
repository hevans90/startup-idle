import { useFounderStore } from "../state/founder.store";
import { useGeneratorStore } from "../state/generators.store";
import { usePrestigeStore } from "../state/prestige.store";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/Popover";
import { fmtMult } from "../ui/BonusRow";
import { formatCurrency } from "../utils/money-utils";
import { TenXDevText } from "../utils/ten-x-utils";
import { RainbowText } from "../utils/vibe-utils";
import { GeneratorBuyButton } from "./generator-buy-button";

const PopRow = ({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color?: string;
}) => (
  <div className="flex items-center justify-between gap-3">
    <span
      className={`responsive-text-xs grow ${color ?? "text-primary-500 dark:text-primary-300"}`}
    >
      {label}
    </span>
    <span className={`responsive-text-xs ${color ?? ""}`}>{value}</span>
  </div>
);

export const Generators = ({ isMobile }: { isMobile: boolean }) => {
  const { generators } = useGeneratorStore();
  // Full multiplier chain (globals + founder passives), so the displayed output
  // matches actual earnings.
  const genMps = useGeneratorStore((s) => s.getGeneratorMoneyPerSecond);
  // Founder passives that touch money output (per-generator + headcount synergy).
  const founderGenMoneyMult = useFounderStore((s) => s.generatorMoneyMult);
  const headcountPerEmployee = useFounderStore((s) => s.headcountMoneyPerEmployee);
  // Founder "Bootstrapper"/"Hustler": shaves every generator's cost-growth
  // exponent. Applied in effectiveCostExponent (so real costs already reflect
  // it) but not in `gen.costExponent`, hence surfaced as its own row here.
  const costExponentReduction = useFounderStore((s) => s.costExponentReduction);
  // Skill-tree (Equity) modifiers — already baked into genMps; surfaced as rows.
  const prestige = usePrestigeStore((s) => s.modifiers);
  const totalEmployees = generators.reduce((n, g) => n + g.amount, 0);
  const headcountMult = 1 + headcountPerEmployee * totalEmployees;
  const equityHeadcountMult = 1 + prestige.headcountPerEmployee * totalEmployees;

  return isMobile ? (
    <div className="flex flex-row flex-wrap gap-2">
      {generators.map((gen) => (
        <div
          key={gen.id}
          className="min-w-48 flex flex-col gap-2 items-center border-[1px] border-primary-300 dark:border-primary-600 px-3 py-2"
        >
          {gen.name} - {gen.amount}
          <div className="flex items-center">
            <span className="responsive-text-xs text-primary-400">
              {formatCurrency(genMps(gen.id, gen.amount))}/s
            </span>
          </div>
          <GeneratorBuyButton id={gen.id} />
          <span className="responsive-text-xs text-primary-400">
            {formatCurrency(genMps(gen.id, 1))}/s
          </span>
        </div>
      ))}
    </div>
  ) : (
    <div className="flex flex-col">
      {generators.map((gen) => (
        <Popover key={gen.id} openOnHover={true} placement="left">
          <PopoverTrigger asChild>
            <div
              key={gen.id}
              className="flex responsive-text-sm justify-between items-center hover:cursor-help hover:bg-primary-300 dark:hover:bg-primary-800 py-1 px-2"
            >
              {gen.id === "vibe_coder" ? (
                <RainbowText className="grow" text={gen.name} />
              ) : gen.id === "10x_dev" ? (
                <TenXDevText text={gen.name} className="grow" />
              ) : (
                <span className="grow">{gen.name}</span>
              )}

              <span className="w-1/4 text-center">{gen.amount}</span>
              <GeneratorBuyButton
                id={gen.id}
                className="w-1/2 responsive-text-xs"
              />
            </div>
          </PopoverTrigger>

          <PopoverContent className="outline-none focus:ring-0 bg-primary-300 dark:bg-primary-800 p-2 flex flex-col gap-1 min-w-44">
            <PopRow label="total" value={`${formatCurrency(genMps(gen.id, gen.amount))}/s`} />
            <div className="border-b border-primary-400 pb-2">
              <PopRow label="per" value={`${formatCurrency(genMps(gen.id, 1))}/s`} />
            </div>
            <PopRow label="base production" value={formatCurrency(gen.baseProduction)} />
            <PopRow label="multiplier" value={fmtMult(gen.multiplier)} />
            {(founderGenMoneyMult[gen.id] ?? 1) !== 1 && (
              <PopRow
                label="founder"
                value={fmtMult(founderGenMoneyMult[gen.id] ?? 1)}
                color="text-emerald-700 dark:text-emerald-400"
              />
            )}
            {headcountMult !== 1 && (
              <PopRow
                label="founder headcount"
                value={fmtMult(headcountMult)}
                color="text-emerald-700 dark:text-emerald-400"
              />
            )}
            {prestige.moneyMult !== 1 && (
              <PopRow
                label="equity money"
                value={fmtMult(prestige.moneyMult)}
                color="text-cyan-700 dark:text-cyan-400"
              />
            )}
            {prestige.employeeOutputMult !== 1 && (
              <PopRow
                label="equity output"
                value={fmtMult(prestige.employeeOutputMult)}
                color="text-cyan-700 dark:text-cyan-400"
              />
            )}
            {equityHeadcountMult !== 1 && (
              <PopRow
                label="equity headcount"
                value={fmtMult(equityHeadcountMult)}
                color="text-cyan-700 dark:text-cyan-400"
              />
            )}
            {gen.id === "intern" && prestige.internOutputMult !== 1 && (
              <PopRow
                label="AGI-pilled"
                value={fmtMult(prestige.internOutputMult)}
                color="text-rose-600 dark:text-rose-400"
              />
            )}
            <PopRow label="cost multiplier" value={gen.costMultiplier.toFixed(2)} />
            <PopRow label="cost exponent" value={gen.costExponent.toFixed(2)} />
            {costExponentReduction !== 0 && (
              <PopRow
                label="founder exponent"
                value={`−${costExponentReduction.toFixed(3)}`}
                color="text-emerald-700 dark:text-emerald-400"
              />
            )}
            {prestige.hireCostMult !== 1 && (
              <PopRow
                label="equity cost"
                value={fmtMult(prestige.hireCostMult)}
                color="text-cyan-700 dark:text-cyan-400"
              />
            )}
          </PopoverContent>
        </Popover>
      ))}
    </div>
  );
};
