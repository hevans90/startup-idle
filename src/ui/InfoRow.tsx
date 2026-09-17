import { twMerge } from "tailwind-merge";
import { ModifierTag } from "./ModifierTag";

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
  <div className="w-full flex items-center gap-3 justify-between">
    <span
      className={twMerge(
        "text-primary-700 dark:text-primary-300",
        size === "small" && "responsive-text-xs grow",
        size === "large" && "responsive-text"
      )}
    >
      <ModifierTag modKey={modKey}>{label}</ModifierTag>
    </span>
    <span
      className={twMerge(
        size === "small" && "responsive-text-xs",
        size === "large" && "responsive-text"
      )}
    >
      {value}
    </span>
  </div>
);
