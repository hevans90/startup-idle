import { ClassNameValue, twMerge } from "tailwind-merge";
import { FOUNDERS } from "../game/founders.catalog";
import { termStatus } from "../game/term-sheets";
import { FusedTraits } from "./fused-traits";
import { useTicking } from "../hooks/use-ticking";
import { useExitsStore } from "../state/exits.store";
import { useFounderStore } from "../state/founder.store";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/Popover";
import { POPOVER } from "../ui/console";

/**
 * Toolbar badge showing the chosen founder; hovering reveals their tagline,
 * perks, rule on the map, the run's term sheet and starting cash. Hidden until a founder is picked.
 */
export const FounderBadge = ({ className }: { className?: ClassNameValue }) => {
  const founderId = useFounderStore((s) => s.selectedFounderId);
  const exitCount = useExitsStore((s) => s.exits[founderId ?? ""]?.count ?? 0);
  const founder = FOUNDERS.find((f) => f.id === founderId);
  // Ticking, so the term sheet's clock moves while the popover is open.
  useTicking(1000);
  const term = termStatus();
  if (!founder) return null;

  const Icon = founder.icon;

  return (
    <Popover openOnHover={true} persistOnHoverContent={true} placement="bottom">
      <PopoverTrigger asChild>
        <div
          className={twMerge(
            "flex cursor-help items-center gap-2 px-2 py-1 hover:bg-surface-2",
            className,
          )}
        >
          <Icon size={18} className="shrink-0 opacity-80" />
          {/* The name where there is room for it; the icon alone, and the name on hover, where not. */}
          <span className="hidden max-w-[10rem] truncate text-sm font-medium whitespace-nowrap @2xl:inline">
            {founder.name}
          </span>
        </div>
      </PopoverTrigger>

      <PopoverContent className={twMerge(POPOVER, "w-60")}>
        <div className="flex items-center gap-2">
          <Icon size={20} className="shrink-0" />
          <span className="font-bold">{founder.name}</span>
        </div>
        <p className="mt-0.5 text-xs italic opacity-60">{founder.tagline}</p>

        <ul className="mt-2 flex flex-col gap-1 text-xs">
          {founder.perks(exitCount).map((perk) => (
            <li key={perk} className="flex gap-1.5">
              <span className="opacity-50">•</span>
              <span>{perk}</span>
            </li>
          ))}
        </ul>

        {founder.rule && (
          <p className="mt-2 text-xs text-info">
            <span className="font-semibold">On the map:</span> {founder.rule}
          </p>
        )}
        <FusedTraits founder={founder.id} />

        {/* THE TERM SHEET SIGNED, and where it stands. @see game/term-sheets */}
        {term && (
          <div className="mt-2 border-t border-line-quiet pt-2 text-xs">
            <p className="font-semibold">{term.sheet.investor}: +{Math.round(term.sheet.bonus * 100)}% Equity</p>
            <p>{term.sheet.goal}</p>
            <p className={twMerge("tabular-nums", term.progress.met ? "text-good" : "text-fg-muted")}>
              {term.progress.text}
            </p>
          </div>
        )}

        <div className="mt-2 border-t border-line-quiet pt-2 text-xs text-money">
          Founded with ${founder.startingCash}
        </div>
      </PopoverContent>
    </Popover>
  );
};
