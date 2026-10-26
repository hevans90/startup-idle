import { IconBuildingCommunity } from "@tabler/icons-react";
import { useMemo } from "react";
import { PROJECTS } from "../game/projects";
import { nextPerSet } from "../game/upgrade-sets";
import { GENERATOR_TYPES } from "../state/generators.store";
import { useMoneyStore } from "../state/money.store";
import {
  GeneratorEffect,
  Upgrade,
  useUpgradeStore,
} from "../state/upgrades.store";
import { twMerge } from "tailwind-merge";
import { FOCUS, Label, Panel, PopCard, PopGroup, POPOVER_BARE, Tile } from "../ui/console";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/Popover";
import { formatCurrency } from "../utils/money-utils";
import { TenXDevText } from "../utils/ten-x-utils";
import { RainbowText } from "../utils/vibe-utils";

function GenLabel({
  id,
  text,
  inline = false,
  static: isStatic = false,
}: {
  id: string;
  text: string;
  inline?: boolean;
  static?: boolean;
}) {
  if (id.includes("vibe_coder")) return <RainbowText text={text} inline={inline} />;
  if (id.includes("10x_dev")) return <TenXDevText text={text} static={isStatic} />;
  return <>{text}</>;
}

/** The projects on the map an upgrade opens the way to. @see ProjectDef.gate */
const opensOf = (upg: Upgrade) => PROJECTS.filter((p) => p.gate.upgrade === upg.id).map((p) => p.name);

/** A small building in the button's corner: this upgrade opens a project on the map. (Its button wants `relative`.) */
const OpensMark = ({ upg }: { upg: Upgrade }) => {
  const names = opensOf(upg);
  if (!names.length) return null;
  return (
    <IconBuildingCommunity
      size={14}
      aria-label={`Opens ${names.join(", ")}`}
      className="pointer-events-none absolute right-1 bottom-1 text-warn"
    />
  );
};

/** What it opens, by name beside the building: in the popover, and on a phone's card. */
const OpensLine = ({ upg }: { upg: Upgrade }) => {
  const names = opensOf(upg);
  if (!names.length) return null;
  return (
    <div className="flex items-center gap-1.5 text-warn">
      <IconBuildingCommunity size={13} className="shrink-0" />
      <span>Opens <b>{names.join(", ")}</b> on the map</span>
    </div>
  );
};

const UpgradeSummary = ({ upg }: { upg: Upgrade }) => {
  const renderEffect = (effect: GeneratorEffect) => {
    switch (effect.type) {
      case "multiplier":
        return (
          <>
            Output{" "}
            <span className="text-good">
              ×{effect.value}
            </span>
          </>
        );

      case "costMultiplier": {
        const discount = Math.round((1 - effect.value) * 100);
        const isGood = discount > 0;
        return (
          <>
            Cost{" "}
            <span
              className={
                isGood
                  ? "text-good"
                  : "text-bad"
              }
            >
              {isGood ? "-" : "+"}
              {Math.abs(discount)}%
            </span>
          </>
        );
      }

      case "costExponent": {
        const isGood = effect.delta < 0;
        const sign = effect.delta > 0 ? "+" : "";
        return (
          <>
            Cost growth{" "}
            <span
              className={
                isGood
                  ? "text-good"
                  : "text-bad"
              }
            >
              {sign}
              {effect.delta.toFixed(2)}
            </span>
          </>
        );
      }

      default:
        return null;
    }
  };

  // A row a kind it changes: who, then what — each change on its own line.
  return (
    <PopGroup label="Effects">
      {upg.effects.map((effectBlock, i) => {
        const genName = GENERATOR_TYPES.find((gen) => gen.id === effectBlock.genId)?.name || effectBlock.genId;
        return (
          <div key={i} className="flex items-baseline justify-between gap-4 py-1">
            <span className="font-bold text-fg"><GenLabel id={effectBlock.genId} text={genName} /></span>
            <span className="flex flex-col items-end tabular-nums text-fg-muted">
              {effectBlock.changes.map((effect, index) => <span key={index}>{renderEffect(effect)}</span>)}
            </span>
          </div>
        );
      })}
    </PopGroup>
  );
};

export const Upgrades = () => {
  const { availableUpgrades, unlockedUpgrades, unlockUpgrade } =
    useUpgradeStore();

  // Reveal only the next upgrade per set (the rest of the tier stays hidden).
  const visibleUpgrades = useMemo(
    () => nextPerSet(availableUpgrades),
    [availableUpgrades],
  );

  const { money } = useMoneyStore();

  return (
    // A GRID OF CORNERS CARDS, what can be afforded lit; what is bought, below, by its initials.
    <Panel title="Upgrades" className="mx-2" controls={<Label>{unlockedUpgrades.length} bought</Label>}>
      {visibleUpgrades.length > 0 ? (
        <div className="grid grid-cols-2 gap-2">
          {visibleUpgrades.map((upg) => {
            const can = money.gte(upg.cost);
            return (
              <Popover key={upg.id} openOnHover={true} placement="bottom">
                <PopoverTrigger asChild>
                  <Tile lit={can} disabled={!can} onClick={() => unlockUpgrade(upg.id)}
                    className="flex w-full flex-col items-start gap-0.5 p-2 text-xs">
                    <GenLabel id={upg.id} text={upg.name} />
                    <span className={twMerge("tabular-nums", can ? "text-money" : "text-fg-faint")}>{formatCurrency(upg.cost)}</span>
                    <OpensMark upg={upg} />
                  </Tile>
                </PopoverTrigger>
                <PopoverContent className={POPOVER_BARE}>
                  <PopCard title={<GenLabel id={upg.id} text={upg.name} />} value={formatCurrency(upg.cost)} tone={can ? "money" : "console"} className="w-80"
                    foot={opensOf(upg).length ? <OpensLine upg={upg} /> : undefined}>
                    <p className="text-fg-muted">{upg.description}</p>
                    <UpgradeSummary upg={upg} />
                  </PopCard>
                </PopoverContent>
              </Popover>
            );
          })}
        </div>
      ) : <p className="text-xs text-fg-muted">Nothing more to buy yet.</p>}
      {unlockedUpgrades.length > 0 && (
        <div className="flex flex-wrap gap-1.5 border-t border-line-quiet pt-2 text-center">
          {unlockedUpgrades.map((upg) => (
            <Popover key={upg.id} openOnHover={true} placement="bottom">
              <PopoverTrigger asChild>
                <div tabIndex={0} className={twMerge("cursor-help border border-line-quiet bg-surface-2 px-1.5 py-0.5 text-[11px]", FOCUS)}>
                  <GenLabel id={upg.id} text={upg?.abbreviation ?? "UPG"} static />
                </div>
              </PopoverTrigger>
              <PopoverContent className={POPOVER_BARE}>
                <PopCard title={<GenLabel id={upg.id} text={upg.name} static />} value="Bought" tone="good" className="w-80"
                  foot={<>Paid {formatCurrency(upg.cost)}.</>}>
                  <p className="text-fg-muted">{upg.description}</p>
                  <UpgradeSummary upg={upg} />
                </PopCard>
              </PopoverContent>
            </Popover>
          ))}
        </div>
      )}
    </Panel>
  );
};
