/**
 * World v2 — what a PLAYER builds with, on the company's map.
 *
 * The editor's panel has every tool there is — terrain, water, pipes, fixtures
 * — because it is for authoring maps. A player gets the town: look round, lay
 * and lift road, put up a building, take one down. Everything is under the
 * game's rules, so a building needs frontage and is paid for, and clicking a
 * seaport upgrades it. @see WorldState.playing, commitStructure
 *
 * AND THE BEDS, beside the tools, because they are why you build: each
 * district's beds against the people working in it, so the cap on hiring is
 * something you can see before you run into it — and who is on their way in,
 * and why anyone hired is still waiting. @see housingCapacity, stepArrivals
 *
 * HOUSING IS ZONED: building it lays out a LOT, which new hires move into
 * when they arrive. @see world/agents/arrivals
 */
import { useMemo, useState } from "react";

import { VEHICLE } from "../agents/arrivals";
import { twMerge } from "tailwind-merge";

import { buildCost } from "../../game/build-cost";
import { addBeds, housedBy, housingCapacity } from "../../game/housing";
import { useSessionStore } from "../../state/session.store";
import { useGeneratorStore } from "../../state/generators.store";
import { useMoneyStore } from "../../state/money.store";
import { getArrivals, useWorldStore } from "../../state/world.store";
import { formatCurrency } from "../../utils/money-utils";
import type { ToolId } from "../edit/tools";
import { saleName } from "./building-info";
import { allStructureDefs, type StructureDef } from "../structures/def";

const TOOLS: { id: ToolId; label: string; hint: string }[] = [
  { id: "inspect", label: "Look", hint: "Pan and look round the town" },
  { id: "paintRoad", label: "Road", hint: "Drag to lay road" },
  { id: "eraseRoad", label: "Lift road", hint: "Drag to take road up" },
  { id: "placeStructure", label: "Build", hint: "Click beside a road to build or zone a lot; click a seaport to upgrade it" },
  { id: "demolish", label: "Demolish", hint: "Click a building to take it down" },
];

/** What is for sale, cheapest first, at today's prices. @see buildCost */
const forSale = (): { def: StructureDef; price: number }[] =>
  allStructureDefs()
    .map((def) => ({ def, price: buildCost(def.id)?.toNumber() ?? -1 }))
    .filter((d) => d.price >= 0)
    .sort((a, b) => a.price - b.price);

const BTN =
  "cursor-pointer px-2 py-1 text-xs border border-primary-400 dark:border-primary-600 "
  + "bg-primary-100 hover:bg-primary-200 text-primary-900 "
  + "dark:bg-primary-900 dark:hover:bg-primary-800 dark:text-primary-100";
const ON = "bg-primary-300 dark:bg-primary-700 border-primary-600 dark:border-primary-300";

export function BuildBar({ className }: { className?: string }) {
  const tool = useWorldStore((s) => s.tool);
  const structureDefId = useWorldStore((s) => s.structureDefId);
  const setTool = useWorldStore((s) => s.setTool);
  const setStructureDef = useWorldStore((s) => s.setStructureDef);
  const setBrush = useWorldStore((s) => s.setBrush);
  const setBrushRadius = useWorldStore((s) => s.setBrushRadius);
  const grid = useWorldStore((s) => s.grid);
  const revision = useWorldStore((s) => s.revision);
  const money = useMoneyStore((s) => s.money);
  const generators = useGeneratorStore((s) => s.generators);
  const [picking, setPicking] = useState(false);
  const labels = useWorldStore((s) => s.labels);
  const setLabels = useWorldStore((s) => s.setLabels);

  // Not memoised: prices follow the economy. @see buildCost
  const sale = forSale();
  // Beds change with what is built, so with the revision as well as the grid.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  // As the economy counts them: built on the map, and off it. Worked out here
  // rather than asked of the economy, whose reader is registered after the
  // first render and answers "unlimited" until it is. @see useFoundWorld
  const remote = useSessionStore((s) => s.remoteBeds);
  const beds = useMemo(() => addBeds(housingCapacity(grid), remote ?? {}), [grid, revision, remote]);

  const choose = (id: ToolId) => {
    setTool(id);
    // Road goes down in a line, as a road does; everything else is a click.
    setBrush(id === "paintRoad" || id === "eraseRoad" ? "line" : "point");
    setBrushRadius(0);
    setPicking(id === "placeStructure");
  };
  const chosen = sale.find((d) => d.def.id === structureDefId);

  return (
    <div className={twMerge("flex flex-col items-start gap-1 text-primary-900 dark:text-primary-100", className)}>
      {picking && (
        <div className="max-h-64 w-64 overflow-y-auto border border-primary-400 bg-primary-50/95 p-1 shadow dark:border-primary-600 dark:bg-primary-900/95">
          {sale.map(({ def, price }) => {
            const afford = money.gte(price);
            const h = housedBy(def.id);
            return (
              <button key={def.id} type="button"
                onClick={() => { setStructureDef(def.id); setPicking(false); }}
                className={twMerge(
                  "flex w-full items-center justify-between gap-2 px-2 py-1 text-left text-xs hover:bg-primary-200 dark:hover:bg-primary-800",
                  def.id === structureDefId && "bg-primary-200 dark:bg-primary-800",
                  !afford && "opacity-50",
                )}>
                <span>
                  {saleName(def)}
                  <span className="ml-1 text-primary-600 dark:text-primary-400">
                    {h ? `${h.slots} beds` : def.port ? `${def.port.berths} berth${def.port.berths > 1 ? "s" : ""}` : ""}
                    {` · ${def.footprint.w}×${def.footprint.h}`}
                  </span>
                </span>
                <span className="tabular-nums">{formatCurrency(price)}</span>
              </button>
            );
          })}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-1">
        {TOOLS.map((t) => (
          <button key={t.id} type="button" title={t.hint} onClick={() => choose(t.id)}
            className={twMerge(BTN, tool === t.id && ON)}>
            {t.id === "placeStructure" && chosen && tool === t.id ? `Build: ${saleName(chosen.def)}` : t.label}
          </button>
        ))}
        <button type="button" title="Show or hide what each building is and how it is doing"
          onClick={() => setLabels(!labels)} className={twMerge(BTN, labels && ON)}>
          Labels
        </button>
      </div>
      <div className="flex gap-3 bg-primary-50/80 px-2 py-1 text-[11px] tabular-nums dark:bg-primary-900/90"
        title="Beds — on lots zoned on the map, plus people living off it — against people employed. You cannot hire past your beds. A new hire works once they have arrived and moved in.">
        {generators.filter((g) => g.amount > 0 || beds[g.id as keyof typeof beds] > 0).map((g) => {
          const have = beds[g.id as keyof typeof beds] ?? 0;
          const full = g.amount >= have;
          const st = getArrivals().status[g.id as keyof typeof VEHICLE];
          const by = { bus: "by bus", car: "by car", limo: "by limo" }[VEHICLE[g.id as keyof typeof VEHICLE]];
          return (
            <span key={g.id} className={full ? "text-red-700 dark:text-red-400" : undefined}>
              {g.name}: {g.amount}/{have} beds
              {st?.riding ? <span className="text-emerald-700 dark:text-emerald-400"> · {st.riding} on the way {by}</span> : null}
              {st?.waiting ? (
                <span className={st.blocked ? "text-amber-700 dark:text-amber-400" : undefined}>
                  {" · "}{st.waiting} waiting{st.blocked === "no-lot" ? " for a lot" : st.blocked === "no-road" ? ": no road in to their lot" : ""}
                </span>
              ) : null}
            </span>
          );
        })}
      </div>
    </div>
  );
}
