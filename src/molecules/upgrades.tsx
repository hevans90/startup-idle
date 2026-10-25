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
import { FOCUS, Frame, Label, Panel, POPOVER } from "../ui/console";
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
    <div className="responsive-text-xs flex items-center justify-center gap-1 text-warn">
      <IconBuildingCommunity size={12} className="shrink-0" />
      <b>{names.join(", ")}</b>
    </div>
  );
};

const UpgradeSummary = ({ upg }: { upg: Upgrade }) => {
  const renderEffect = (effect: GeneratorEffect) => {
    switch (effect.type) {
      case "multiplier":
        return (
          <>
            mult:{" "}
            <span className="text-good">
              x{effect.value}
            </span>
          </>
        );

      case "costMultiplier": {
        const discount = Math.round((1 - effect.value) * 100);
        const isGood = discount > 0;
        return (
          <>
            cost:{" "}
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
            exponent:{" "}
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

  return (
    <div className="flex items-center justify-center">
      <table className="responsive-text-xs w-auto table-auto border-separate border-spacing-x-4">
        <tbody>
          {upg.effects.map((effectBlock, i) => {
            const genName =
              GENERATOR_TYPES.find((gen) => gen.id === effectBlock.genId)
                ?.name || effectBlock.genId;

            return (
              <tr key={i} className="border-b last:border-none">
                <td className="font-bold whitespace-nowrap text-fg">
                  <GenLabel id={effectBlock.genId} text={genName} />
                </td>
                {effectBlock.changes.map((effect, index) => (
                  <td key={index} className="text-left">
                    {renderEffect(effect)}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
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
                <Frame kind="corners" lit={can} illuminate={can} assemble={false} className={twMerge("w-full", !can && "opacity-60")}>
                  <PopoverTrigger asChild>
                    <button type="button" disabled={!can} onClick={() => unlockUpgrade(upg.id)}
                      className={twMerge("relative flex w-full cursor-pointer flex-col items-start gap-0.5 p-2 text-left text-xs disabled:cursor-not-allowed", FOCUS, can ? "text-fg" : "text-fg-muted")}>
                      <GenLabel id={upg.id} text={upg.name} />
                      <span className="tabular-nums text-money">{formatCurrency(upg.cost)}</span>
                      <OpensMark upg={upg} />
                    </button>
                  </PopoverTrigger>
                </Frame>
                <PopoverContent className={twMerge(POPOVER, "flex max-w-[39rem] flex-col gap-2 p-2")}>
                  <div className="responsive-text-xs grow text-center text-fg-muted">{upg.description}</div>
                  <UpgradeSummary upg={upg} />
                  <OpensLine upg={upg} />
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
              <PopoverContent className={twMerge(POPOVER, "flex w-[26rem] flex-col items-center gap-2 p-2")}>
                <span className="flex responsive-text-xs">
                  <GenLabel id={upg.id} text={upg.name} static />
                  <span>: {formatCurrency(upg.cost)}</span>
                </span>
                <div className="responsive-text-xs grow text-center text-fg-muted">{upg.description}</div>
                <UpgradeSummary upg={upg} />
              </PopoverContent>
            </Popover>
          ))}
        </div>
      )}
    </Panel>
  );
};
