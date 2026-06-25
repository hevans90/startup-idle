import { ClassNameValue, twMerge } from "tailwind-merge";
import { FOUNDERS } from "../game/founders.catalog";
import { useExitsStore } from "../state/exits.store";
import { useFounderStore } from "../state/founder.store";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/Popover";

/**
 * Toolbar badge showing the chosen founder; hovering reveals their tagline,
 * perks and starting cash. Hidden until a founder is picked.
 */
export const FounderBadge = ({ className }: { className?: ClassNameValue }) => {
  const founderId = useFounderStore((s) => s.selectedFounderId);
  const exitCount = useExitsStore((s) => s.exits[founderId ?? ""]?.count ?? 0);
  const founder = FOUNDERS.find((f) => f.id === founderId);
  if (!founder) return null;

  const Icon = founder.icon;

  return (
    <Popover openOnHover={true} persistOnHoverContent={true} placement="bottom">
      <PopoverTrigger asChild>
        <div
          className={twMerge(
            "flex items-center gap-2 rounded px-2 py-1 cursor-help hover:bg-primary-300 dark:hover:bg-primary-700",
            className,
          )}
        >
          <Icon size={18} className="shrink-0 opacity-80" />
          <span className="text-sm font-medium whitespace-nowrap">
            {founder.name}
          </span>
        </div>
      </PopoverTrigger>

      <PopoverContent className="w-60 bg-primary-100 dark:bg-primary-800 text-primary-900 dark:text-primary-100 border-primary-500 border-[1px] p-4 outline-none focus:ring-0">
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

        <div className="mt-2 border-t border-primary-400/40 pt-2 text-xs text-emerald-700 dark:text-emerald-400">
          Founded with ${founder.startingCash}
        </div>
      </PopoverContent>
    </Popover>
  );
};
