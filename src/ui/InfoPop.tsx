/**
 * A SMALL THING, EXPLAINED ON HOVER — or on a tap, which is what a phone has
 * instead. An icon and a figure in a row, a title and a line or two in the
 * popover. The game's rows of figures use it so they can be short: the
 * sentence is in here, not in the row. @see Popover
 */
import type { ReactNode } from "react";
import { twMerge } from "tailwind-merge";

import { FOCUS, PopCard, POPOVER_BARE } from "./console";
import { Popover, PopoverContent, PopoverTrigger } from "./Popover";


export function InfoPop({ trigger, title, children, className, placement = "top" }: {
  trigger: ReactNode;
  title: ReactNode;
  children?: ReactNode;
  className?: string;
  placement?: "top" | "bottom" | "left" | "right";
}) {
  return (
    <Popover openOnHover openOnClick persistOnHoverContent placement={placement} floatOffset={8}>
      <PopoverTrigger asChild>
        <span tabIndex={0} className={twMerge("flex cursor-help items-center gap-0.5", FOCUS, className)}>
          {trigger}
        </span>
      </PopoverTrigger>
      <PopoverContent className={POPOVER_BARE}>
        <PopCard title={title}>
          {children && <div className="flex flex-col gap-1.5 leading-snug text-fg-muted">{children}</div>}
        </PopCard>
      </PopoverContent>
    </Popover>
  );
}
