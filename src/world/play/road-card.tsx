/**
 * World v2 — THE ROAD BEFORE IT IS BUILT, AND WHILE: a card with the Road
 * tool in hand. Dragging, what the road will cost in all, in how many loads
 * and about how long — or why it can't go. Not dragging, the jobs under way,
 * and one that has stopped for want of its next load. A line each.
 * @see roads/jobs, plans/road-building.md
 */
import { twMerge } from "tailwind-merge";

import { roadCost } from "../../game/build-cost";
import { useWorldStore } from "../../state/world.store";
import { formatCurrency } from "../../utils/money-utils";
import { strokeCells } from "../edit/tools";
import { freshIn, liveRoadJobs, jobSeconds, loadPrice, loadsFor, orderRoad } from "../roads/jobs";

const CARD = "border border-line-quiet bg-surface-1/95 px-2.5 py-1.5 text-xs shadow-lg";

export function RoadCard() {
  const stroke = useWorldStore((s) => s.stroke);
  const tool = useWorldStore((s) => s.tool);
  const on = useWorldStore((s) => s.playing && s.roadWorks);
  useWorldStore((s) => s.roadRev);
  if (!on || tool !== "paintRoad") return null;
  const g = useWorldStore.getState().grid;
  if (stroke && stroke.tool === "paintRoad" && stroke.brush === "line") {
    const got = orderRoad(g, strokeCells(g, stroke));
    if ("nothing" in got) return null;
    if ("refused" in got) return <p className={twMerge(CARD, "text-bad")}>{got.refused.brief}</p>;
    const tiles = freshIn(got.job), bridge = got.job.cells.filter((c) => c.deck).length;
    return (
      <div className={CARD}>
        <p className="flex justify-between gap-4 tabular-nums" title="Paid a load at a time as each is sent, not now">
          <b>Road · {tiles} tiles{bridge ? ` · ${bridge} bridge` : ""}</b><span>{formatCurrency(roadCost(tiles).toNumber())}</span>
        </p>
        <p className="text-fg-muted tabular-nums" title="Longer if the lorries have far to come, or the money runs short">
          {loadsFor(tiles)} loads · about {Math.round(jobSeconds(got.job))}s
        </p>
      </div>
    );
  }
  if (!g.roadJobs.length) return null;
  const live = liveRoadJobs(g).length, waiting = g.roadJobs.length - live, stopped = g.roadJobs.find((j) => j.stalled > 0);
  return (
    <div className={CARD}>
      <p className="tabular-nums" title="Delete over one cancels what is not open of it">
        <b>Road works · {live}</b>{waiting ? <span className="text-fg-muted"> · {waiting} waiting</span> : null}
      </p>
      {stopped && <p className="text-warn tabular-nums" title="It goes on when there is money for the load">Stopped · next load {formatCurrency(loadPrice(stopped))}</p>}
    </div>
  );
}
