/**
 * World v2 — THE BEST STREETS, while the Earnings overlay is on: the three
 * that earn most, each known by its biggest earner, and a click to look at
 * it. @see liveStreetEarnings
 */
import { twMerge } from "tailwind-merge";

import { useTicking } from "../../hooks/use-ticking";
import { useWorldStore } from "../../state/world.store";
import { formatCurrency } from "../../utils/money-utils";
import { showMe } from "./map-focus";
import { liveStreetEarnings, liveStreets, streetName } from "./street-earnings";

const SHOWN = 3;

export function TopStreets({ className }: { className?: string }) {
  useTicking(2000);
  const on = useWorldStore((s) => s.earningsOverlay);
  if (!on) return null;
  const ranked = liveStreetEarnings().slice(0, SHOWN);
  const live = liveStreets();
  return (
    <div className={twMerge(
      "w-64 border border-primary-300 bg-primary-50/95 p-2 text-xs text-primary-900 shadow-md",
      "dark:border-primary-700 dark:bg-primary-900/95 dark:text-primary-100",
      className,
    )}>
      <b className="text-[10px] uppercase tracking-wide text-primary-600 dark:text-primary-400">Best streets</b>
      {!ranked.length && <p className="opacity-70">Nothing earning on the map yet.</p>}
      {ranked.map((r, k) => {
        const tiles = live?.streets.tiles[r.street] ?? [];
        const mid = tiles[Math.floor(tiles.length / 2)];
        const w = live?.g.w ?? 1;
        return (
          <button key={r.street} type="button"
            onClick={() => mid !== undefined && showMe({ x: mid % w, y: Math.floor(mid / w) })}
            className="flex w-full cursor-pointer justify-between gap-2 py-0.5 text-left hover:bg-primary-200 dark:hover:bg-primary-800">
            <span className="truncate">{k + 1}. {streetName(r).replace(/^the street by the /, "By the ")}</span>
            <span className="shrink-0 tabular-nums text-amber-700 dark:text-amber-400">{formatCurrency(r.perSecond)}/s</span>
          </button>
        );
      })}
    </div>
  );
}
