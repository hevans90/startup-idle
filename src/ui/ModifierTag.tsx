import type { ReactNode } from "react";
import { getModifierBreakdown, type ModifierBreakdown } from "../game/modifier-explanations";
import { PopCard, PopGroup, PopRow, POPOVER_BARE } from "./console";
import { Popover, PopoverContent, PopoverTrigger } from "./Popover";

const TONE_CLS = {
  good: "text-good",
  bad: "text-bad",
  neutral: "text-innovation",
};

/** Where a modifier comes from: its total in the header, its sources as rows, what it means at the foot. */
function BreakdownContent({ bd }: { bd: ModifierBreakdown }) {
  return (
    <PopCard title={bd.label} value={bd.total} className="w-72"
      foot={bd.description ? <span className="whitespace-pre-line">{bd.description}</span> : undefined}>
      <PopGroup label="From">
        {bd.rows.map((row, i) => <PopRow key={i} wrap label={row.source} value={row.value || undefined} valueClass={TONE_CLS[row.tone]} />)}
      </PopGroup>
    </PopCard>
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
        <span className="cursor-help underline decoration-line-strong decoration-dotted decoration-1 underline-offset-[3px] outline-none hover:decoration-fg-muted">
          {children}
        </span>
      </PopoverTrigger>
      <PopoverContent className={POPOVER_BARE}>
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
