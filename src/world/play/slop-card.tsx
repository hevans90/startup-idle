/**
 * World v2 — THE SLOP CARD, on the map beside the landmarks: what the vibe
 * coders make and each workplace's tank. @see LandmarksPanel, world/slop/tanks
 */
import { twMerge } from "tailwind-merge";

import { useTicking } from "../../hooks/use-ticking";
import { SEWER_RATE } from "../../game/mains";
import { PROCESS_RATE } from "../../game/processors";
import { SLOP_FROM, SLOP_PER_CODER, slopMaking } from "../../game/slop";
import { useWorldStore } from "../../state/world.store";
import { InfoPop } from "../../ui/InfoPop";
import { tanksOf } from "../slop/tanks";
import { structureDef } from "../structures/def";
import { mainReports } from "../water/mains";
import { showMe } from "./map-focus";

/** Tanks the slop card lists one by one; past this, it sums them up and lists only the worst. */
const SLOP_ROWS = 5, SLOP_WORST = 3;

/**
 * SLOP: what the vibe coders make a second, and each workplace's tank — how
 * full, whether a sewer takes from it, and whether it is spilling onto the
 * street. A press on one shows it on the map. With many workplaces it
 * CONDENSES: how many spill, fill and are sewered, and only the worst few
 * tanks. How it all works is on the title, on hover. @see world/slop/tanks
 */
export function SlopCard() {
  useTicking(500);
  const grid = useWorldStore((s) => s.grid);
  const tanks = tanksOf(grid);
  const drained = new Set([...mainReports().values()].flatMap((r) => (r.sewer && r.state === "flowing" ? r.sewer.sources : [])));
  const rows = [...tanks.entries()]
    .map(([id, t]) => ({ id, t, s: grid.structures.get(id), full: t.capacity > 0 ? t.level / t.capacity : 0, sewered: drained.has(id) }))
    .filter((r) => r.s);
  const spilling = rows.filter((r) => r.t.spilling).length;
  const sewered = rows.filter((r) => !r.t.spilling && r.sewered).length;
  const filling = rows.length - spilling - sewered;
  // THE WORST FIRST: spilling, then the fullest a sewer does not take from.
  const rank = (r: (typeof rows)[number]) => (r.t.spilling ? 2 : r.sewered ? -1 : r.full);
  const condensed = rows.length > SLOP_ROWS;
  const shown = condensed ? [...rows].sort((a, b) => rank(b) - rank(a)).filter((r) => !r.sewered || r.t.spilling).slice(0, SLOP_WORST) : rows;
  return (
    <div className={twMerge(SMALL, spilling ? "border-bad" : "")}>
      <InfoPop placement="right" className="justify-between gap-2" title="Slop" trigger={<>
        <b>Slop</b>
        <span className="tabular-nums text-fg-muted">{slopMaking().toFixed(2)} a second</span>
      </>}>
        <p>{SLOP_FROM}+ vibe coders each make {SLOP_PER_CODER}/s into their workplace's tank. Unhappy coders make more.</p>
        <p>A full tank spills: sludge on the street, or pollution in water.</p>
        <p>Sewers drain tanks, {SEWER_RATE}/s per bore: processors first ({PROCESS_RATE}/s each), the rest out to water.</p>
      </InfoPop>
      {condensed && (
        <div className="mt-1 flex flex-col gap-1">
          <span className="flex h-1 w-full bg-surface-3">
            <span className="block h-full bg-bad" style={{ width: `${(spilling / rows.length) * 100}%` }} />
            <span className="block h-full bg-warn" style={{ width: `${(filling / rows.length) * 100}%` }} />
            <span className="block h-full bg-good" style={{ width: `${(sewered / rows.length) * 100}%` }} />
          </span>
          <span className="flex justify-between tabular-nums text-fg-muted">
            <span className={spilling ? "text-bad" : ""}>{spilling} spilling</span>
            <span>{filling} filling</span>
            <span className={sewered ? "text-good" : ""}>{sewered} sewered</span>
          </span>
        </div>
      )}
      {shown.map(({ id, t, s, full, sewered: taken }) => (
        <button key={id} type="button" onClick={() => showMe({ x: s!.x + 1, y: s!.y + 1 })}
          className="mt-1 flex w-full cursor-pointer items-center gap-1.5 text-left">
          <span className="w-24 truncate">{structureDef(s!.def)?.name}</span>
          <span className="h-1 flex-1 bg-surface-3">
            <span className={twMerge("block h-full", t.spilling ? "bg-bad" : full > 0.75 ? "bg-warn" : "bg-good")} style={{ width: `${Math.min(100, full * 100)}%` }} />
          </span>
          <span className={twMerge("w-14 text-right tabular-nums", t.spilling ? "text-bad" : taken ? "text-good" : "text-fg-muted")}>
            {t.spilling ? "spilling" : taken ? "sewered" : `${Math.round(full * 100)}%`}
          </span>
        </button>
      ))}
    </div>
  );
}
const SMALL = "w-56 border border-line-quiet bg-surface-1/95 px-2.5 py-1.5 text-[11px] text-fg shadow-lg backdrop-blur-sm";
