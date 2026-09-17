import type { ReactNode } from "react";
import { getModifierBreakdown, type ModifierBreakdown } from "../game/modifier-explanations";
import { Popover, PopoverContent, PopoverTrigger } from "./Popover";

const TONE_CLS = {
  good: "text-emerald-600 dark:text-emerald-400",
  bad: "text-rose-500 dark:text-rose-400",
  neutral: "text-cyan-600 dark:text-cyan-400",
};

function BreakdownContent({ bd }: { bd: ModifierBreakdown }) {
  return (
    <div className="min-w-48 max-w-80 space-y-2 text-xs text-primary-900 dark:text-primary-100">
      <div className="flex items-baseline justify-between gap-2 border-b border-primary-300 pb-1.5 dark:border-primary-600">
        <span className="font-semibold leading-tight">{bd.label}</span>
        <span className="shrink-0 tabular-nums font-bold">{bd.total}</span>
      </div>
      {bd.description && (
        <p className="text-[10px] leading-snug opacity-60 whitespace-pre-line">{bd.description}</p>
      )}
      <div className="flex flex-col gap-0.5">
        {bd.rows.map((row, i) => (
          <div key={i} className="flex items-baseline justify-between gap-3">
            <span className="min-w-0 break-words opacity-70">{row.source}</span>
            {row.value && (
              <span className={`shrink-0 tabular-nums font-medium ${TONE_CLS[row.tone]}`}>
                {row.value}
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function LazyBreakdownContent({ modKey }: { modKey: string }) {
  let bd: ModifierBreakdown | null;
  try {
    bd = getModifierBreakdown(modKey);
  } catch {
    bd = null;
  }
  if (!bd) return null;
  return <BreakdownContent bd={bd} />;
}

function ModifierTagInner({ modKey, children }: { modKey: string; children: ReactNode }) {
  return (
    <Popover placement="bottom-start" floatOffset={6}>
      <PopoverTrigger asChild>
        <span className="cursor-help underline decoration-dashed decoration-1 underline-offset-2 outline-none">
          {children}
        </span>
      </PopoverTrigger>
      <PopoverContent className="z-[110] border border-primary-500 bg-primary-100 p-2.5 text-primary-900 shadow-xl outline-none focus:ring-0 dark:border-primary-500 dark:bg-primary-800 dark:text-primary-100">
        <LazyBreakdownContent modKey={modKey} />
      </PopoverContent>
    </Popover>
  );
}

export function ModifierTag({
  modKey,
  children,
}: {
  modKey?: string;
  children: ReactNode;
}) {
  if (!modKey) return <>{children}</>;
  return <ModifierTagInner modKey={modKey}>{children}</ModifierTagInner>;
}
