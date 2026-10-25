/**
 * A SMALL THING, EXPLAINED ON HOVER — or on a tap, which is what a phone has
 * instead. An icon and a figure in a row, a title and a line or two in the
 * popover. The game's rows of figures use it so they can be short: the
 * sentence is in here, not in the row. @see Popover
 */
import type { ReactNode } from "react";
import { twMerge } from "tailwind-merge";

import { Popover, PopoverContent, PopoverTrigger } from "./Popover";

export const POP =
  "z-[110] max-w-60 border border-line-strong bg-surface-1 px-2 py-1.5 text-xs text-fg shadow-xl outline-none "
  + "";

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
        <span tabIndex={0} className={twMerge("flex cursor-help items-center gap-0.5 outline-none", className)}>
          {trigger}
        </span>
      </PopoverTrigger>
      <PopoverContent className={POP}>
        <p className="font-bold">{title}</p>
        {children && <div className="flex flex-col gap-1 text-fg-muted">{children}</div>}
      </PopoverContent>
    </Popover>
  );
}
