import type { ReactNode } from "react";

export type BonusTone = "good" | "bad" | "neutral";

/** ×1.25, ×2, etc. — trailing zeros stripped, always Unicode × symbol. */
export const fmtMult = (n: number) => `×${Number(n.toFixed(2))}`;

/** Signed percentage with 1 decimal place. */
export const fmtPct = (v: number) =>
  `${v > 0 ? "+" : ""}${Number(v.toFixed(1))}%`;

const VALUE_CLS: Record<BonusTone, string> = {
  good: "text-emerald-600 dark:text-emerald-400",
  bad: "text-rose-500 dark:text-rose-400",
  neutral: "text-cyan-600 dark:text-cyan-400",
};

export const BonusRow = ({
  label,
  value,
  tone = "good",
}: {
  label: string;
  value: string;
  tone?: BonusTone;
}) => (
  <div className="flex items-baseline justify-between gap-3">
    <span className="truncate opacity-60">{label}</span>
    {value && (
      <span
        className={`shrink-0 font-medium tabular-nums ${VALUE_CLS[tone]}`}
      >
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
    <p className="text-[10px] font-semibold uppercase tracking-wide opacity-50">
      {title}
    </p>
    <div className="flex flex-col gap-1 text-xs">{children}</div>
  </div>
);
