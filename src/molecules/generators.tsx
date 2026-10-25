import { useFounderStore } from "../state/founder.store";
import { useGeneratorStore } from "../state/generators.store";
import { usePrestigeStore } from "../state/prestige.store";
import { twMerge } from "tailwind-merge";
import { FOCUS, Panel, POPOVER } from "../ui/console";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/Popover";
import { fmtMult } from "../ui/BonusRow";
import { formatCurrency } from "../utils/money-utils";
import { TenXDevText } from "../utils/ten-x-utils";
import { RainbowText } from "../utils/vibe-utils";
import { GeneratorBuyButton } from "./generator-buy-button";
import { AgentsRow } from "./agents-row";

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
      className={`responsive-text-xs grow ${color ?? "text-fg-muted"}`}
    >
      {label}
    </span>
    <span className={`responsive-text-xs ${color ?? ""}`}>{value}</span>
  </div>
);

export const Generators = () => {
  const generators = useGeneratorStore((s) => s.generators);
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

  return (
    <Panel title="Employees" className="mx-2">
    <div className="-mx-2 flex flex-col">
      {/* NOBODY TO HIRE YET: the first hire waits on the founder's garage,
          built on the map. @see game/projects */}
      {generators.length === 0 && (
        <p className="px-2 py-3 text-sm text-fg-muted">
          No one to hire yet. Build your Founder's Garage on the map, and you can hire your first intern.
        </p>
      )}
      {generators.map((gen) => (
        <Popover key={gen.id} openOnHover={true} placement="left">
          <PopoverTrigger asChild>
            <div
              key={gen.id}
              tabIndex={0}
              className={twMerge("flex responsive-text-sm items-center gap-1 px-2 py-1 hover:cursor-help hover:bg-surface-2", FOCUS)}
            >
              {gen.id === "vibe_coder" ? (
                <RainbowText className="grow" text={gen.name} />
              ) : gen.id === "10x_dev" ? (
                <TenXDevText text={gen.name} className="grow" />
              ) : (
                <span className="grow">{gen.name}</span>
              )}

              <span className="w-12 text-right tabular-nums">{gen.amount}</span>
              <span className="w-20 text-right text-xs tabular-nums text-fg-muted" title="What they all earn">
                {formatCurrency(genMps(gen.id, gen.amount))}/s
              </span>
              <GeneratorBuyButton
                id={gen.id}
                className="ml-2 w-2/5 responsive-text-xs"
              />
            </div>
          </PopoverTrigger>

          <PopoverContent className={twMerge(POPOVER, "flex min-w-44 flex-col gap-1 p-2")}>
            <PopRow label="total" value={`${formatCurrency(genMps(gen.id, gen.amount))}/s`} />
            <div className="border-b border-line pb-2">
              <PopRow label="per" value={`${formatCurrency(genMps(gen.id, 1))}/s`} />
            </div>
            <PopRow label="base production" value={formatCurrency(gen.baseProduction)} />
            <PopRow label="multiplier" value={fmtMult(gen.multiplier)} />
            {(founderGenMoneyMult[gen.id] ?? 1) !== 1 && (
              <PopRow
                label="founder"
                value={fmtMult(founderGenMoneyMult[gen.id] ?? 1)}
                color="text-good"
              />
            )}
            {headcountMult !== 1 && (
              <PopRow
                label="founder headcount"
                value={fmtMult(headcountMult)}
                color="text-good"
              />
            )}
            {prestige.moneyMult !== 1 && (
              <PopRow
                label="equity money"
                value={fmtMult(prestige.moneyMult)}
                color="text-innovation"
              />
            )}
            {prestige.employeeOutputMult !== 1 && (
              <PopRow
                label="equity output"
                value={fmtMult(prestige.employeeOutputMult)}
                color="text-innovation"
              />
            )}
            {equityHeadcountMult !== 1 && (
              <PopRow
                label="equity headcount"
                value={fmtMult(equityHeadcountMult)}
                color="text-innovation"
              />
            )}
            {gen.id === "intern" && prestige.internOutputMult !== 1 && (
              <PopRow
                label="AGI-pilled"
                value={fmtMult(prestige.internOutputMult)}
                color="text-bad"
              />
            )}
            <PopRow label="cost multiplier" value={gen.costMultiplier.toFixed(2)} />
            <PopRow label="cost exponent" value={gen.costExponent.toFixed(2)} />
            {costExponentReduction !== 0 && (
              <PopRow
                label="founder exponent"
                value={`−${costExponentReduction.toFixed(3)}`}
                color="text-good"
              />
            )}
            {prestige.hireCostMult !== 1 && (
              <PopRow
                label="equity cost"
                value={fmtMult(prestige.hireCostMult)}
                color="text-innovation"
              />
            )}
          </PopoverContent>
        </Popover>
      ))}
      <AgentsRow />
    </div>
    </Panel>
  );
};
