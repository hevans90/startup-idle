import type { ReactNode } from "react";
import { ModifierTag } from "./ModifierTag";

export type BonusTone = "good" | "bad" | "neutral";

/** ×1.25, ×2, etc. — trailing zeros stripped, always Unicode × symbol. */
export const fmtMult = (n: number) => `×${Number(n.toFixed(2))}`;

/** Signed percentage with 1 decimal place. */
export const fmtPct = (v: number) =>
  `${v > 0 ? "+" : ""}${Number(v.toFixed(1))}%`;

const VALUE_CLS: Record<BonusTone, string> = {
  good: "text-good",
  bad: "text-bad",
  neutral: "text-innovation",
};

export const BonusRow = ({
  label,
  value,
  tone = "good",
  modKey,
}: {
  label: string;
  value: string;
  tone?: BonusTone;
  modKey?: string;
}) => (
  <div className="flex items-baseline justify-between gap-3 border-b border-line-quiet py-0.5 last:border-b-0">
    <span className="truncate text-fg-muted">
      <ModifierTag modKey={modKey}>{label}</ModifierTag>
    </span>
    {value && (
      <span className={`shrink-0 font-medium tabular-nums ${VALUE_CLS[tone]}`}>
        {value}
      </span>
    )}
  </div>
);

export const BonusSection = ({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) => (
  <div className="flex min-w-40 flex-1 flex-col gap-2">
    <p className="text-[10px] uppercase tracking-widest text-fg-faint">
      {title}
    </p>
    <div className="flex flex-col gap-1 text-xs">{children}</div>
  </div>
);
