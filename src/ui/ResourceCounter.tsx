import { ReactNode } from "react";
import { ClassNameValue, twMerge } from "tailwind-merge";
import { Popover, PopoverContent, PopoverTrigger } from "./Popover";

/**
 * A top-bar resource cell: a bold value with its per-second rate stacked
 * beneath, at a fixed min-width so changing digit counts don't shift the bar.
 * Optionally clickable and/or backed by a hover popover.
 */
export const ResourceCounter = ({
  value,
  rate,
  onClick,
  popover,
  title,
  className,
  rateClassName,
}: {
  value: ReactNode;
  /** Per-second line shown beneath the value. */
  rate?: ReactNode;
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
    "flex min-w-[6.5rem] flex-col items-center rounded px-2 leading-tight",
    onClick && "cursor-pointer hover:bg-primary-300 dark:hover:bg-primary-700",
    !onClick && popover && "cursor-help",
    className,
  );

  const body = (
    <>
      <span className="max-w-full truncate font-bold tabular-nums whitespace-nowrap">{value}</span>
      {rate != null && (
        <span className={twMerge("max-w-full truncate text-xs tabular-nums whitespace-nowrap opacity-60", rateClassName)}>
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
      <PopoverContent className="bg-primary-100 dark:bg-primary-800 text-primary-900 dark:text-primary-100 border-primary-500 border-[1px] p-4 outline-none focus:ring-0">
        {popover}
      </PopoverContent>
    </Popover>
  );
};
