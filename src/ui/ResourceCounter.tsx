import { ReactNode } from "react";
import { ClassNameValue, twMerge } from "tailwind-merge";

import type { Role } from "./theme/tokens";
import { FOCUS, POPOVER } from "./console";
import { Popover, PopoverContent, PopoverTrigger } from "./Popover";

/**
 * A resource in the HUD: its value in the console's display face, in its
 * resource's colour, its rate under it, at a steady width so a changing digit
 * count does not shift the bar. Optionally a button (to its tab) and a hover
 * popover (its breakdown). @see Toolbar, plans/ui-overhaul.md §3.1
 */
export const ResourceCounter = ({
  value,
  rate,
  role,
  onClick,
  popover,
  title,
  className,
  rateClassName,
}: {
  value: ReactNode;
  /** Per-second line shown beneath the value. */
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
    "flex min-w-[7.5rem] flex-col items-center px-2 leading-tight",
    onClick && twMerge("cursor-pointer hover:bg-surface-2", FOCUS),
    !onClick && popover && "cursor-help",
    className,
  );

  const body = (
    <>
      <span className="max-w-full truncate whitespace-nowrap font-display text-base tabular-nums leading-none" style={role ? { color: `var(--ui-${role})` } : undefined}>{value}</span>
      {rate != null && (
        <span className={twMerge("max-w-full truncate whitespace-nowrap text-[11px] tabular-nums text-fg-muted", rateClassName)}>
          {rate}
        </span>
      )}
    </>
  );

  const cell = onClick ? (
    <button type="button" onClick={onClick} title={title} className={cls}>
      {body}
    </button>
  ) : (
    <div title={title} className={cls}>
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
