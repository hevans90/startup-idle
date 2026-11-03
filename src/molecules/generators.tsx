import { useFounderStore } from "../state/founder.store";
import { IconCode, IconHeadphones, IconSchool, IconUser } from "@tabler/icons-react";
import { KIND_COLOUR } from "../game/kind-colours";
import { useGeneratorStore, type GeneratorId } from "../state/generators.store";
import { usePrestigeStore } from "../state/prestige.store";
import { twMerge } from "tailwind-merge";
import { FOCUS, Panel, PopCard, PopGroup, PopRow, POPOVER_BARE } from "../ui/console";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/Popover";
import { times } from "../game/wording";
import { formatCurrency } from "../utils/money-utils";
import { TenXDevText } from "../utils/ten-x-utils";
import { RainbowText } from "../utils/vibe-utils";
import { GeneratorBuyButton } from "./generator-buy-button";
import { AgentsRow } from "./agents-row";


/** WHO THEY ARE, AT A GLANCE: their kind's icon on their map colour. @see KIND_COLOUR */
const KIND_ICON: Record<string, typeof IconSchool> = { intern: IconSchool, vibe_coder: IconHeadphones, "10x_dev": IconCode };
function KindMark({ id }: { id: string }) {
  const Icon = KIND_ICON[id] ?? IconUser;
  const c = KIND_COLOUR[id as GeneratorId];
  const hex = c === undefined ? "var(--ui-fg-muted)" : `#${c.toString(16).padStart(6, "0")}`;
  return (
    <span aria-hidden className="mr-1 flex h-6 w-6 shrink-0 items-center justify-center border"
      style={{ borderColor: hex, color: hex, background: `color-mix(in oklab, ${hex} 14%, transparent)` }}>
      <Icon size={14} stroke={1.8} />
    </span>
  );
}

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
              <KindMark id={gen.id} />
              {/* WHAT THEY ALL EARN under their name, not a column of its own:
                  at three-digit exponents the row had no room for both. */}
              <span className="flex min-w-0 grow flex-col">
                {gen.id === "vibe_coder" ? (
                  <RainbowText className="truncate" text={gen.name} />
                ) : gen.id === "10x_dev" ? (
                  <TenXDevText text={gen.name} className="truncate" />
                ) : (
                  <span className="truncate">{gen.name}</span>
                )}
                <span className="truncate text-xs tabular-nums text-fg-muted" title="What they all earn">
                  {formatCurrency(genMps(gen.id, gen.amount))}/s
                </span>
              </span>

              <span className="shrink-0 text-right tabular-nums">{gen.amount}</span>
              <GeneratorBuyButton
                id={gen.id}
                className="ml-1 w-auto min-w-28 shrink-0 whitespace-nowrap px-2 responsive-text-xs"
              />
            </div>
          </PopoverTrigger>

          <PopoverContent className={POPOVER_BARE}>
            <PopCard title={gen.name} value={`${formatCurrency(genMps(gen.id, gen.amount))}/s`} tone="money" className="w-72"
              foot={<>Each earns {formatCurrency(genMps(gen.id, 1))}/s.</>}>
              <PopGroup label="Money">
            <PopRow label="Base" value={formatCurrency(gen.baseProduction)} />
            <PopRow label="Upgrades" value={times(gen.multiplier)} />
            {(founderGenMoneyMult[gen.id] ?? 1) !== 1 && (
              <PopRow
                label="Founder"
                value={times(founderGenMoneyMult[gen.id] ?? 1)}
                valueClass="text-good"
              />
            )}
            {headcountMult !== 1 && (
              <PopRow
                label="Founder, per employee"
                value={times(headcountMult)}
                valueClass="text-good"
              />
            )}
            {prestige.moneyMult !== 1 && (
              <PopRow
                label="Skill tree: money"
                value={times(prestige.moneyMult)}
                valueClass="text-innovation"
              />
            )}
            {prestige.employeeOutputMult !== 1 && (
              <PopRow
                label="Skill tree: output"
                value={times(prestige.employeeOutputMult)}
                valueClass="text-innovation"
              />
            )}
            {equityHeadcountMult !== 1 && (
              <PopRow
                label="Skill tree, per employee"
                value={times(equityHeadcountMult)}
                valueClass="text-innovation"
              />
            )}
            {gen.id === "intern" && prestige.internOutputMult !== 1 && (
              <PopRow
                label="AGI-Pilled"
                value={times(prestige.internOutputMult)}
                valueClass="text-bad"
              />
            )}
              </PopGroup>
              <PopGroup label="Hires">
            <PopRow label="Cost multiplier" value={times(gen.costMultiplier)} />
            <PopRow label="Cost exponent" value={gen.costExponent.toFixed(3)} />
            {costExponentReduction !== 0 && (
              <PopRow
                label="Founder exponent"
                value={`−${Number(costExponentReduction.toFixed(3))}`}
                valueClass="text-good"
              />
            )}
            {prestige.hireCostMult !== 1 && (
              <PopRow
                label="Skill tree"
                value={times(prestige.hireCostMult)}
                valueClass="text-good"
              />
            )}
              </PopGroup>
            </PopCard>
          </PopoverContent>
        </Popover>
      ))}
      <AgentsRow />
    </div>
    </Panel>
  );
};
