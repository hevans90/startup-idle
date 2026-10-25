/**
 * World v2 — WHAT A LOT HERE WOULD GET: with a lot in hand, the tile under the
 * pointer's desirability and what it is made of, beside the cursor. The heat
 * map says where; this says why. @see createDesireHeat, desireAt
 *
 * And with a café in hand, the workplaces next door whose desks it would
 * serve; with the Conference Centre, the seaports near it. @see CAFE_BOOST, convoyPays
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
import { CAFE_BOOST, CAFE_REACH, servedByCafe } from "../agents/desk-perks";
import { CONFERENCE_REACH, NEAR_CONFERENCE_PAYS, portsNear } from "../events/convoy";
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
  // A CAFÉ IN HAND: the workplaces next door it would serve. @see CAFE_BOOST
  const cafeOk = !!(def?.id === "cafe" && tool === "placeStructure" && hover && playing && validatePlacement(grid, def, hover.x, hover.y, playRules(grid)).ok);
  // THE CONFERENCE CENTRE IN HAND: the seaports near enough for convoys to pay treble. @see convoyPays
  const confOk = !!(def?.id === "conference" && tool === "placeStructure" && hover && playing && validatePlacement(grid, def, hover.x, hover.y, playRules(grid)).ok);
  const ports = confOk
    ? portsNear(grid, { id: -1, def: "conference", x: hover!.x, y: hover!.y, w: def!.footprint.w, h: def!.footprint.h }, (s) => !!structureDef(s.def)?.port)
    : [];
  const served = cafeOk ? servedByCafe(grid, { id: -1, def: "cafe", x: hover!.x, y: hover!.y, w: def!.footprint.w, h: def!.footprint.h }) : [];
  return (
    <div ref={ref} className={twMerge(
      "pointer-events-none invisible absolute left-0 top-0 -translate-x-1/2 -translate-y-full whitespace-nowrap",
      "border border-line-strong bg-surface-1/95 px-1.5 py-1 text-[10px] leading-[13px] text-fg shadow",
      "",
      !d && !cafeOk && !confOk && "hidden",
      className,
    )}>
      {cafeOk && (
        served.length
          ? <>
            <p className="font-bold">Desks next door +{Math.round(CAFE_BOOST * 100)}%</p>
            {served.map((w) => <p key={w.id} className="text-good">{structureDef(w.def)?.name ?? w.def}</p>)}
          </>
          : <p className="opacity-70">No workplace within {CAFE_REACH} tiles</p>
      )}
      {confOk && (
        ports.length
          ? <p className="font-bold">Convoys ×{NEAR_CONFERENCE_PAYS} at {ports.length} seaport{ports.length === 1 ? "" : "s"} nearby</p>
          : <p className="opacity-70">No seaport within {CONFERENCE_REACH} tiles</p>
      )}
      {d && (
        <>
          <p className="font-bold tabular-nums">
            Desirability {d.total > 0 ? "+" : ""}{d.total}
            {tier && <span className="font-normal text-good"> · grows to {tier}</span>}
          </p>
          {[...d.parts].sort((a, b) => b.points - a.points).map((p) => (
            <p key={p.why} className={twMerge("tabular-nums", p.points >= 0 ? "text-good" : "text-bad")}>
              {p.points > 0 ? "+" : ""}{p.points} {p.why}
            </p>
          ))}
        </>
      )}
    </div>
  );
}
