/**
 * PROMOTION, on the Employees tab: an intern made a vibe coder for innovation,
 * once vibe coders can be hired. @see usePromotionStore
 */
import { twMerge } from "tailwind-merge";

import { useTicking } from "../hooks/use-ticking";
import { useInnovationStore } from "../state/innovation.store";
import { PROMOTION_SECONDS, PROMOTION_STEP, promotionCost, usePromotionStore } from "../state/promotion.store";
import { InfoPop } from "../ui/InfoPop";

const fmt = (n: number) => (n < 100 ? n.toFixed(n < 10 ? 2 : 1) : Math.round(n).toLocaleString());

/** Why the button is off, as the player reads it. */
const WHY = {
  none: "No interns to promote.",
  "no-room": "No free vibe coder beds: build or grow a vibe coder house.",
  innovation: "Not enough innovation yet.",
} as const;

export function PromotionRow({ isMobile }: { isMobile: boolean }) {
  useTicking(500);
  const promoted = usePromotionStore((s) => s.promoted);
  const promote = usePromotionStore((s) => s.promote);
  const blocked = usePromotionStore((s) => s.blocked)();
  useInnovationStore((s) => s.innovation);
  if (blocked === "closed") return null;
  const cost = promotionCost(promoted);
  return (
    <div className={twMerge(
      "flex items-center justify-between gap-2 border-t border-primary-300 px-2 py-1 dark:border-primary-700",
      isMobile && "min-w-48 flex-col border px-3 py-2",
    )}>
      <InfoPop className="grow" placement="left"
        trigger={<span className="responsive-text-sm text-pink-700 dark:text-pink-300">Promote</span>}
        title="Promote an intern to vibe coder">
        <p>An intern becomes a vibe coder, for {PROMOTION_SECONDS} s of the company's innovation rather than a hire's price.</p>
        <p>Each one this company makes costs {Math.round((PROMOTION_STEP - 1) * 100)}% more than the last. They need a vibe coder bed.</p>
        <p className="tabular-nums">Promoted so far: {promoted}.</p>
      </InfoPop>
      <span className="w-1/4 text-center responsive-text-sm tabular-nums">{promoted}</span>
      <button type="button" disabled={!!blocked} onClick={() => promote()}
        title={blocked ? WHY[blocked] : undefined}
        className={twMerge(
          "w-1/2 cursor-pointer border border-primary-400 px-2 py-1 responsive-text-xs hover:bg-primary-200",
          "disabled:cursor-default disabled:opacity-50 disabled:hover:bg-transparent dark:border-primary-600 dark:hover:bg-primary-800",
        )}>
        Promote: {fmt(cost)} innovation
      </button>
    </div>
  );
}
