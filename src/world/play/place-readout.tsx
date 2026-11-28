/**
 * World v2 — WHAT THE CLICK WOULD DO, under the pointer with a building in
 * hand: its price, and if it cannot go there, why — one line, in the
 * glossary's words. Over a building with a next tier, the upgrade's. With
 * the road tool, only why a hill refuses the road being dragged.
 * @see validatePlacement, planUpgrade, plans/polish.md (UI 9)
 */
import { useRef } from "react";
import { twMerge } from "tailwind-merge";

import { buildCost, canAfford, upgradeCost } from "../../game/build-cost";
import { useTicking } from "../../hooks/use-ticking";
import Decimal from "break_infinity.js";
import { lotLine, playRules, useWorldStore } from "../../state/world.store";
import { formatCurrency } from "../../utils/money-utils";
import { useCellAnchorFollow } from "../anchors/use-cell-anchor";
import { structureAt, type Grid } from "../grid";
import { keptDryBy } from "../events/flood-reach";
import { structureDef } from "../structures/def";
import { gradeStroke } from "../roads/grade";
import { plannedGrid } from "../roads/jobs";
import { planUpgrade, validatePlacement } from "../structures/place";
import { claimable } from "../vegetation/tend";

/** Why a building cannot go here, as the player reads it. @see validatePlacement */
const REFUSAL: Record<string, string> = {
  "off map": "Off the map",
  "no ground": "No ground here",
  "out of bounds": "Not your land",
  occupied: "Something stands here",
  "on a road": "On a road",
  "in the river": "In the river",
  "in the water": "In the water",
  "no road access": "Needs a road beside it",
  "too far from a river": "Too far from the river",
  "not on a river bank": "Needs a river bank",
  "not beside water": "Needs water beside it",
  "uneven ground": "Ground too uneven",
  "quay off the water": "Quay must be on the water",
  "too high above the water": "Too high above the water",
  "no road at the gate": "Needs a road behind it",
  "No manhole in reach": "No manhole in reach",
  blocked: "Can't build here",
};

/** The homes a row of walls would keep dry, asked again only when the row or the map changes. @see keptDryBy */
let dry: { grid: Grid | null; key: string; n: number } = { grid: null, key: "", n: 0 };
function wallsKeepDry(grid: Grid, cells: readonly { x: number; y: number }[]): number {
  const key = `${grid.rev}|${cells.map((c) => `${c.x},${c.y}`).join(";")}`;
  if (dry.grid !== grid || dry.key !== key) dry = { grid, key, n: keptDryBy(grid, cells) };
  return dry.n;
}

export function PlaceReadout({ className }: { className?: string }) {
  useTicking(250);
  const ref = useRef<HTMLDivElement>(null);
  useCellAnchorFollow(ref);
  const { tool, structureDefId, hover, grid, playing, placingProject, stroke, brushRadius, roadWorks } = useWorldStore.getState();
  const def = structureDef(structureDefId);
  let line: { text: string; price: string | null; tone: "ok" | "bad" } | null = null;
  if (tool === "placeStructure" && def && hover && playing && placingProject) {
    // A LANDMARK'S SITE: nothing paid to lay it out — its loads are paid as
    // they are sent — so no price, and never "not enough money". @see startSiteCommand
    const check = validatePlacement(grid, def, hover.x, hover.y, playRules(grid));
    line = check.ok ? { text: def.name, price: null, tone: "ok" } : { text: REFUSAL[check.reason ?? "blocked"] ?? REFUSAL.blocked, price: null, tone: "bad" };
  } else if (tool === "placeStructure" && def?.id === "levee" && hover && playing) {
    // A ROW OF FLOOD WALLS: how many go up, their price, and the homes they keep out of the flood line. @see keptDryBy
    const rules = playRules(grid);
    const cells = (stroke && lotLine(useWorldStore.getState(), stroke)) || [hover];
    const ok = cells.filter((c) => validatePlacement(grid, def, c.x, c.y, rules).ok);
    if (!ok.length) {
      const check = validatePlacement(grid, def, hover.x, hover.y, rules);
      line = { text: REFUSAL[check.reason ?? "blocked"] ?? REFUSAL.blocked, price: null, tone: "bad" };
    } else {
      const price = (buildCost(def.id) ?? new Decimal(0)).times(ok.length);
      const safe = wallsKeepDry(grid, ok);
      const what = `${def.name} · ${ok.length}${safe ? ` · ${safe} home${safe === 1 ? "" : "s"} safe` : ""}`;
      line = canAfford(price) ? { text: what, price: formatCurrency(price), tone: "ok" } : { text: `${what} · not enough money`, price: formatCurrency(price), tone: "bad" };
    }
  } else if (tool === "placeStructure" && def && hover && playing) {
    const rules = playRules(grid);
    // OVER A BUILDING WITH A NEXT TIER, the click upgrades it. @see planUpgrade
    const under = structureAt(grid, hover.x, hover.y);
    const plan = under >= 0 ? planUpgrade(grid, under, rules) : null;
    const price = plan ? upgradeCost(plan.from.def, plan.to.id) : buildCost(def.id);
    const check = plan ?? validatePlacement(grid, def, hover.x, hover.y, rules);
    // A port by its name as the picker has it, capital first.
    const named = (d: { name: string }) => d.name.replace(/^seaport/, "Seaport");
    // A FARM: the fields it would take round it. @see claimable
    const fields = !plan && def.id === "farm" ? claimable(grid, useWorldStore.getState().palette, { x: hover.x, y: hover.y, ...def.footprint }).length : -1;
    const what = plan ? `Upgrade to ${named(plan.to)}` : fields >= 0 ? `${named(def)} · ${fields} field${fields === 1 ? "" : "s"}` : named(def);
    // Every reason at once, for a seaport, which has several ways to be wrong.
    const why = (check.reasons.length ? check.reasons : [check.reason ?? "blocked"]).map((r) => REFUSAL[r] ?? REFUSAL.blocked);
    line = !check.ok ? { text: [...new Set(why)].join(" · "), price: price && formatCurrency(price), tone: "bad" }
      : !canAfford(price) ? { text: `${what} · not enough money`, price: price && formatCurrency(price), tone: "bad" }
      : { text: what, price: price && formatCurrency(price), tone: "ok" };
  } else if (tool === "paintRoad" && stroke && playing) {
    // A ROAD THE HILL REFUSES, said while it is dragged and not only once it is let go. @see gradeRoad
    // (In the game, on the map as it will be: against the roads still being built too. @see plannedGrid)
    const grade = gradeStroke(roadWorks ? plannedGrid(grid) : grid, stroke, brushRadius);
    if (grade?.blocked.length) line = { text: grade.brief, price: null, tone: "bad" };
  }
  return (
    <div ref={ref} className={twMerge(
      "pointer-events-none invisible absolute left-0 top-0 -translate-x-1/2 translate-y-4 whitespace-nowrap",
      "border border-line-strong bg-surface-3 px-1.5 py-0.5 text-[10px] leading-[13px] tabular-nums",
      !line && "hidden",
      className,
    )}>
      {line && <p className={line.tone === "bad" ? "text-bad" : "text-fg"}>
        {line.text}{line.price && <span className="text-money"> · {line.price}</span>}
      </p>}
    </div>
  );
}
