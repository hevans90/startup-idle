import { twMerge } from "tailwind-merge";
import { ModifierTag } from "./ModifierTag";

/** A figure in a list: what it is, muted, on the left; its value on the right; a hairline between rows. */
export const InfoRow = ({
  label,
  value,
  size = "small",
  modKey,
}: {
  label: string;
  value: string;
  size?: "large" | "small";
  modKey?: string;
}) => (
  <div className={twMerge(
    "flex w-full items-baseline justify-between gap-3 border-b border-line-quiet py-1 last:border-b-0",
    size === "small" ? "text-xs" : "text-sm",
  )}>
    <span className="min-w-0 text-fg-muted">
      <ModifierTag modKey={modKey}>{label}</ModifierTag>
    </span>
    <span className={twMerge("shrink-0 tabular-nums text-fg", size === "large" && "font-display text-base")}>{value}</span>
  </div>
);
