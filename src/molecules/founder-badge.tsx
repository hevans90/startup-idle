import { useRef } from "react";
import { ClassNameValue, twMerge } from "tailwind-merge";
import { FOUNDERS } from "../game/founders.catalog";
import { termStatus } from "../game/term-sheets";
import { dealLines } from "../game/term-deal";
import { useSessionStore } from "../state/session.store";
import { FusedTraits } from "./fused-traits";
import { useTicking } from "../hooks/use-ticking";
import { useExitsStore } from "../state/exits.store";
import { useFounderStore } from "../state/founder.store";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/Popover";
import { PopCard, PopGroup, PopRow, POPOVER_BARE, useGlitch } from "../ui/console";

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
  const clauses = useSessionStore((s) => s.termClauses);
  // THE MODEL, playing: never quite still in the toolbar. @see useGlitch
  const self = useRef<HTMLSpanElement>(null);
  useGlitch(self, { active: founderId === "model", strength: 0.7, every: 4 });
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
          <span ref={self} className="flex min-w-0 items-center gap-2">
            <Icon size={18} className="shrink-0 opacity-80" />
            {/* The name where there is room for it; the icon alone, and the name on hover, where not. */}
            <span className="hidden max-w-[10rem] truncate text-sm font-medium whitespace-nowrap @2xl:inline">
              {founder.name}
            </span>
          </span>
        </div>
      </PopoverTrigger>

      <PopoverContent className={POPOVER_BARE}>
        <PopCard title={founder.name} icon={<Icon size={14} className="shrink-0" />} className="w-72"
          foot={<>Founded with <span className="text-money">${founder.startingCash}</span></>}>
          <p className="italic text-fg-muted">{founder.tagline}</p>
          <PopGroup label="Perks">
            {founder.perks(exitCount).map((perk) => <PopRow key={perk} wrap label={<span className="text-fg">{perk}</span>} />)}
          </PopGroup>
          {founder.rule && (
            <p className="border-l-2 border-info-line pl-2 text-info"><span className="font-bold">On the map:</span> {founder.rule}</p>
          )}
          <FusedTraits founder={founder.id} />
          {/* THE TERM SHEET SIGNED, and where it stands. @see game/term-sheets */}
          {term && (
            <PopGroup label="Term sheet">
              <PopRow strong label={term.sheet.investor} value={`+${Math.round(term.bonus * 100)}% Equity`} valueClass="text-good" />
              <PopRow wrap label={term.goal} />
              <PopRow wrap label={<span className={term.progress.met ? "text-good" : undefined}>{term.progress.text}</span>} />
            </PopGroup>
          )}
          {/* THE DEAL SIGNED, a clause a row. @see term-deal */}
          {clauses && (
            <PopGroup label="Signed terms">
              {dealLines(clauses).map((l) => <PopRow key={l.title} label={l.title} value={l.label} valueClass="text-fg" />)}
            </PopGroup>
          )}
        </PopCard>
      </PopoverContent>
    </Popover>
  );
};
