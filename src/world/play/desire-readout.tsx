/**
 * World v2 — WHAT A LOT HERE WOULD GET: with a lot in hand, the tile under the
 * pointer's desirability and what it is made of, beside the cursor. The heat
 * map says where; this says why. @see createDesireHeat, desireAt
 */
import { useRef } from "react";
import { twMerge } from "tailwind-merge";

import { housedBy } from "../../game/housing";
import { useTicking } from "../../hooks/use-ticking";
import { useSlopPitStore } from "../../state/slop-pit.store";
import { getNetwork, playRules, useWorldStore } from "../../state/world.store";
import { useCellAnchorFollow } from "../anchors/use-cell-anchor";
import { liveDesireMaps, desireAt } from "../agents/desirability";
import { GROW_AT } from "../agents/mood-rules";
import { structureDef } from "../structures/def";
import { validatePlacement } from "../structures/place";

/** The tier a desirability is enough to grow a house to. */
const growsTo = (total: number) =>
  total >= GROW_AT.landmark ? "a tower" : total >= GROW_AT.t2 ? "III" : total >= GROW_AT.t1 ? "II" : null;

export function DesireReadout({ className }: { className?: string }) {
  useTicking(250);
  const ref = useRef<HTMLDivElement>(null);
  useCellAnchorFollow(ref, { lift: 2 });
  const { tool, structureDefId, hover, grid, playing } = useWorldStore.getState();
  const def = structureDef(structureDefId);
  const who = tool === "placeStructure" && def ? housedBy(def.id)?.id : undefined;
  const net = getNetwork();
  const ok = !!(who && hover && net && playing && def && validatePlacement(grid, def, hover.x, hover.y, playRules(grid)).ok);
  const d = ok ? desireAt(grid, liveDesireMaps(grid, net!), hover!.x, hover!.y, who!, useSlopPitStore.getState().fill / 100) : null;
  const tier = d ? growsTo(d.total) : null;
  return (
    <div ref={ref} className={twMerge(
      "pointer-events-none invisible absolute left-0 top-0 -translate-x-1/2 -translate-y-full whitespace-nowrap",
      "border border-primary-500 bg-primary-50/95 px-1.5 py-1 text-[10px] leading-[13px] text-primary-900 shadow",
      "dark:bg-primary-900/95 dark:text-primary-100",
      !d && "hidden",
      className,
    )}>
      {d && (
        <>
          <p className="font-bold tabular-nums">
            Desirability {d.total > 0 ? "+" : ""}{d.total}
            {tier && <span className="font-normal text-emerald-700 dark:text-emerald-400"> · grows to {tier}</span>}
          </p>
          {[...d.parts].sort((a, b) => b.points - a.points).map((p) => (
            <p key={p.why} className={twMerge("tabular-nums", p.points >= 0 ? "text-emerald-700 dark:text-emerald-400" : "text-red-700 dark:text-red-400")}>
              {p.points > 0 ? "+" : ""}{p.points} {p.why}
            </p>
          ))}
        </>
      )}
    </div>
  );
}
