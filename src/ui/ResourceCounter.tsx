import { ReactNode } from "react";
import { ClassNameValue, twMerge } from "tailwind-merge";

import type { Role } from "./theme/tokens";
import { FOCUS, POPOVER } from "./console";
import { Popover, PopoverContent, PopoverTrigger } from "./Popover";

/**
 * A resource in the HUD: what it is in small capitals, its value in the
 * console's display face and its resource's colour, its rate beside it — a
 * cell between hairlines, at a steady width so a changing digit count does not
 * shift the bar. Optionally a button (to its tab) and a hover popover (its
 * breakdown). @see Toolbar, plans/ui-overhaul.md §3.1
 */
export const ResourceCounter = ({
  label,
  value,
  rate,
  role,
  onClick,
  popover,
  title,
  className,
  rateClassName,
}: {
  /** What it is: "Money". */
  label?: string;
  value: ReactNode;
  /** Per-second, beside the value. */
  rate?: ReactNode;
  /** Its resource: the colour it is shown in. */
  role?: Role;
  /** If set, the cell is a button. */
  onClick?: () => void;
  /** If set, hovering the cell opens a popover with this content. */
  popover?: ReactNode;
  title?: string;
  className?: ClassNameValue;
  /** Classes for the per-second line: to hide it where room is short, say. */
  rateClassName?: ClassNameValue;
}) => {
  const cls = twMerge(
    "flex h-full min-w-[8.5rem] flex-col justify-center gap-0.5 px-3 text-left leading-none",
    onClick && twMerge("cursor-pointer hover:bg-surface-2", FOCUS),
    !onClick && popover && "cursor-help hover:bg-surface-2",
    className,
  );

  const body = (
    <>
      {label && <span className="text-[9px] uppercase tracking-[0.18em] text-fg-faint">{label}</span>}
      <span className="flex items-baseline gap-2 whitespace-nowrap">
        <span className="font-display text-base tabular-nums" style={role ? { color: `var(--ui-${role})` } : undefined}>{value}</span>
        {rate != null && (
          <span className={twMerge("text-[11px] tabular-nums text-fg-muted", rateClassName)}>{rate}</span>
        )}
      </span>
    </>
  );

  const cell = onClick ? (
    <button type="button" onClick={onClick} title={title} className={cls}>
      {body}
    </button>
  ) : (
    <div title={title} className={cls} tabIndex={popover ? 0 : undefined}>
      {body}
    </div>
  );

  if (!popover) return cell;

  return (
    <Popover openOnHover={true} persistOnHoverContent={true} placement="bottom">
      <PopoverTrigger asChild>{cell}</PopoverTrigger>
      <PopoverContent className={POPOVER}>{popover}</PopoverContent>
    </Popover>
  );
};
