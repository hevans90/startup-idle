/**
 * World v2 — WHAT A LOT HERE WOULD GET: with a lot in hand, the tile under the
 * pointer's desirability and what it is made of, beside the cursor. The heat
 * map says where; this says why. @see createDesireHeat, desireAt
 *
 * And with the Conference Centre in hand, the seaports near it. @see convoyPays
 */
import { useRef } from "react";
import { twMerge } from "tailwind-merge";

import { housedBy } from "../../game/housing";
import { useTicking } from "../../hooks/use-ticking";
import { getNetwork, playRules, useWorldStore } from "../../state/world.store";
import { useCellAnchorFollow } from "../anchors/use-cell-anchor";
import { liveDesireMaps, desireAt } from "../agents/desirability";
import { GROW_AT, NEED_WHY, type MoodParts } from "../agents/mood-rules";
import { needsAt } from "../agents/needs";
import type { GeneratorId } from "../../state/generators.store";
import { CONFERENCE_REACH, NEAR_CONFERENCE_PAYS, portsNear } from "../events/convoy";
import { structureDef } from "../structures/def";
import { validatePlacement } from "../structures/place";
import { change } from "../../game/wording";

/** The tier a lot this desirable, with these needs met, would grow to, if any. */
function growsTo(who: GeneratorId, d: MoodParts): string | null {
  const met = d.parts.filter((p) => (Object.values(NEED_WHY) as string[]).includes(p.why)).length;
  const can = (t: "t1" | "t2" | "landmark") => d.total >= GROW_AT[t] && met >= needsAt(who, t);
  return can("landmark") ? "a tower" : can("t2") ? "III" : can("t1") ? "II" : null;
}

export function DesireReadout({ className }: { className?: string }) {
  useTicking(250);
  const ref = useRef<HTMLDivElement>(null);
  useCellAnchorFollow(ref, { lift: 2 });
  const { tool, structureDefId, hover, grid, playing } = useWorldStore.getState();
  const def = structureDef(structureDefId);
  const who = tool === "placeStructure" && def ? housedBy(def.id)?.id : undefined;
  const net = getNetwork();
  const ok = !!(who && hover && net && playing && def && validatePlacement(grid, def, hover.x, hover.y, playRules(grid)).ok);
  const d = ok ? desireAt(grid, liveDesireMaps(grid, net!), hover!.x, hover!.y, who!) : null;
  const tier = d ? growsTo(who!, d) : null;
  // THE CONFERENCE CENTRE IN HAND: the seaports near enough for convoys to pay treble. @see convoyPays
  const confOk = !!(def?.id === "conference" && tool === "placeStructure" && hover && playing && validatePlacement(grid, def, hover.x, hover.y, playRules(grid)).ok);
  const ports = confOk
    ? portsNear(grid, { id: -1, def: "conference", x: hover!.x, y: hover!.y, w: def!.footprint.w, h: def!.footprint.h }, (s) => !!structureDef(s.def)?.port)
    : [];
  return (
    <div ref={ref} className={twMerge(
      "pointer-events-none invisible absolute left-0 top-0 -translate-x-1/2 -translate-y-full whitespace-nowrap",
      "border border-line-strong border-t-2 border-t-console bg-surface-3 px-2 py-1.5 text-[10px] leading-[13px] text-fg shadow-xl",
      !d && !confOk && "hidden",
      className,
    )}>
      {confOk && (
        ports.length
          ? <p className="font-bold">Convoys ×{NEAR_CONFERENCE_PAYS} at {ports.length} seaport{ports.length === 1 ? "" : "s"} nearby</p>
          : <p className="opacity-70">No seaport within {CONFERENCE_REACH} tiles</p>
      )}
      {d && (
        <>
          <p className="font-bold tabular-nums">
            Desirability {change("desirability", d.total)}
            {tier && <span className="font-normal text-good"> · grows to {tier}</span>}
          </p>
          {[...d.parts].sort((a, b) => b.points - a.points).map((p) => (
            <p key={p.why} className={twMerge("tabular-nums", p.points >= 0 ? "text-good" : "text-bad")}>
              {p.why[0].toUpperCase() + p.why.slice(1)} {change("desirability", p.points)}
            </p>
          ))}
        </>
      )}
    </div>
  );
}
