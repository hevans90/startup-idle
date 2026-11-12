/**
 * World v2 — THE SEWER BEFORE IT IS LAID: a card while the Sewer tool is
 * dragged, saying what the trunk will cost, what the ground makes of it —
 * spans, lift stations and what they cost to run — and what it carries to
 * its exit, or why it can't go. A line each; the detail on hover.
 * @see planSewer, plans/underground-sewers.md §3
 */
import { twMerge } from "tailwind-merge";

import { pumpUpkeep } from "../../game/cooling";
import { useGeneratorStore } from "../../state/generators.store";
import { mainWet, useWorldStore } from "../../state/world.store";
import { formatCurrency } from "../../utils/money-utils";
import { pipeCost } from "../../game/build-cost";
import { sewerFlow } from "../../game/mains";
import { structureDef } from "../structures/def";
import { lateralStrokePlan, sewerStrokePlan } from "../sewers/tool";

const CARD = "border border-line-quiet bg-surface-1/95 px-2.5 py-1.5 text-xs shadow-lg backdrop-blur-sm";

export function SewerCard() {
  const stroke = useWorldStore((s) => s.stroke);
  const playing = useWorldStore((s) => s.playing);
  if (!playing || !stroke || stroke.tool !== "sewer") return null;
  const g = useWorldStore.getState().grid;
  if (stroke.lateral) {
    // A LATERAL: what it drains, into what, for how much.
    const l = lateralStrokePlan(g, stroke, mainWet(g));
    if (!l) return null;
    if ("refused" in l.plan) return <p className={twMerge(CARD, "text-bad")}>{l.plan.refused}</p>;
    const names = l.plan.sources.map((id) => structureDef(g.structures.get(id)?.def ?? "")?.name).filter(Boolean);
    return (
      <div className={CARD}>
        <p className="flex justify-between gap-4 tabular-nums">
          <b>Connection · {l.plan.fresh} tiles</b><span>{formatCurrency(pipeCost(l.plan.fresh).toNumber())}</span>
        </p>
        {names.length > 0 && <p className="text-fg-muted">Drains the {names.join(", the ")}</p>}
        {l.plan.exit ? <p className="text-good" title={`Up to ${sewerFlow().toFixed(2)} slop a second`}>Into the sewer</p>
          : <p className="text-warn" title="Its slop goes nowhere till that sewer pours into water or feeds a processor">That sewer has no exit yet</p>}
      </div>
    );
  }
  const plan = sewerStrokePlan(g, stroke, mainWet(g));
  if (!plan) return null;
  if ("refused" in plan) return <p className={twMerge(CARD, "text-bad")}>{plan.refused}</p>;
  const upkeep = plan.lifts.length * pumpUpkeep(useGeneratorStore.getState().getMoneyPerSecond());
  const ground = [
    plan.spans ? `${plan.spans} span${plan.spans === 1 ? "" : "s"}` : "",
    plan.lifts.length ? `${plan.lifts.length} lift${plan.lifts.length === 1 ? "" : "s"} · ${formatCurrency(upkeep)}/s` : "",
  ].filter(Boolean).join(" · ");
  return (
    <div className={CARD}>
      <p className="flex justify-between gap-4 tabular-nums"
        title="Each tile costs more the deeper it is dug; a span three tiles; a lift station as a pump">
        <b>Sewer · {plan.fresh} tiles</b><span>{formatCurrency(plan.price)}</span>
      </p>
      {ground && (
        <p className="text-fg-muted" title="Spans cross dips on piers; a lift station pumps slop up where the pipe would lie too deep, and costs money a second to run">
          {ground}
        </p>
      )}
      {plan.problem ? <p className="text-bad">{plan.problem.reason}</p>
        : plan.exit ? <p className="text-good" title={`Carries up to ${plan.capacity.toFixed(2)} slop a second: the least anywhere on the way to its exit`}>Reaches its exit</p>
        : <p className="text-warn" title="Its manholes serve nothing till it pours into water or feeds a processor">No exit yet</p>}
    </div>
  );
}
