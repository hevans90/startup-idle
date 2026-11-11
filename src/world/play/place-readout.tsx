/**
 * World v2 — WHAT THE CLICK WOULD DO, under the pointer with a building in
 * hand: its price, and if it cannot go there, why — one line, in the
 * glossary's words. Over a building with a next tier, the upgrade's.
 * @see validatePlacement, planUpgrade, plans/polish.md (UI 9)
 */
import { useRef } from "react";
import { twMerge } from "tailwind-merge";

import { buildCost, canAfford, upgradeCost } from "../../game/build-cost";
import { useTicking } from "../../hooks/use-ticking";
import { playRules, useWorldStore } from "../../state/world.store";
import { formatCurrency } from "../../utils/money-utils";
import { useCellAnchorFollow } from "../anchors/use-cell-anchor";
import { structureAt } from "../grid";
import { structureDef } from "../structures/def";
import { planUpgrade, validatePlacement } from "../structures/place";

/** Why a building cannot go here, as the player reads it. @see validatePlacement */
const REFUSAL: Record<string, string> = {
  "off map": "Off the map",
  "no ground": "No ground here",
  "out of bounds": "Not your land",
  occupied: "Something stands here",
  "on a road": "On a road",
  "in the river": "In the river",
  "no road access": "Needs a road beside it",
  "too far from a river": "Too far from the river",
  "not on a river bank": "Needs a river bank",
  "not beside water": "Needs water beside it",
  "uneven ground": "Ground too uneven",
  "quay off the water": "Quay must be on the water",
  "too high above the water": "Too high above the water",
  "no road at the gate": "Needs a road behind it",
  blocked: "Can't build here",
};

export function PlaceReadout({ className }: { className?: string }) {
  useTicking(250);
  const ref = useRef<HTMLDivElement>(null);
  useCellAnchorFollow(ref);
  const { tool, structureDefId, hover, grid, playing, placingProject } = useWorldStore.getState();
  const def = structureDef(structureDefId);
  let line: { text: string; price: string | null; tone: "ok" | "bad" } | null = null;
  if (tool === "placeStructure" && def && hover && playing && placingProject) {
    // A LANDMARK'S SITE: nothing paid to lay it out — its loads are paid as
    // they are sent — so no price, and never "not enough money". @see startSiteCommand
    const check = validatePlacement(grid, def, hover.x, hover.y, playRules(grid));
    line = check.ok ? { text: def.name, price: null, tone: "ok" } : { text: REFUSAL[check.reason ?? "blocked"] ?? REFUSAL.blocked, price: null, tone: "bad" };
  } else if (tool === "placeStructure" && def && hover && playing) {
    const rules = playRules(grid);
    // OVER A BUILDING WITH A NEXT TIER, the click upgrades it. @see planUpgrade
    const under = structureAt(grid, hover.x, hover.y);
    const plan = under >= 0 ? planUpgrade(grid, under, rules) : null;
    const price = plan ? upgradeCost(plan.from.def, plan.to.id) : buildCost(def.id);
    const check = plan ?? validatePlacement(grid, def, hover.x, hover.y, rules);
    const what = plan ? `Upgrade to ${plan.to.name}` : def.name;
    // Every reason at once, for a seaport, which has several ways to be wrong.
    const why = (check.reasons.length ? check.reasons : [check.reason ?? "blocked"]).map((r) => REFUSAL[r] ?? REFUSAL.blocked);
    line = !check.ok ? { text: [...new Set(why)].join(" · "), price: price && formatCurrency(price), tone: "bad" }
      : !canAfford(price) ? { text: `${what} · not enough money`, price: price && formatCurrency(price), tone: "bad" }
      : { text: what, price: price && formatCurrency(price), tone: "ok" };
  }
  return (
    <div ref={ref} className={twMerge(
      "pointer-events-none invisible absolute left-0 top-0 -translate-x-1/2 translate-y-4 whitespace-nowrap",
      "border border-line-strong bg-surface-3 px-1.5 py-0.5 text-[10px] leading-[13px] tabular-nums shadow-md",
      !line && "hidden",
      className,
    )}>
      {line && <p className={line.tone === "bad" ? "text-bad" : "text-fg"}>
        {line.text}{line.price && <span className="text-money"> · {line.price}</span>}
      </p>}
    </div>
  );
}
