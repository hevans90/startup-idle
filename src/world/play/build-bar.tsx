/**
 * World v2 — what a PLAYER builds with, on the company's map.
 *
 * The editor's panel has every tool there is — terrain, water, pipes, fixtures
 * — because it is for authoring maps. A player gets the town: look round, lay
 * and lift road, put up a building, take one down. Everything is under the
 * game's rules, so a building needs frontage and is paid for, and clicking a
 * seaport upgrades it. @see WorldState.playing, commitStructure
 *
 * ONE PANEL: the beds along its top, the tools along its bottom, and the
 * build picker opening above it.
 *  - THE BEDS, because they are why you build: each district's people against
 *    its beds, so the cap on hiring is something you can see before you run
 *    into it — with who is on their way in, and why anyone hired is still
 *    waiting. @see housingCapacity, stepArrivals
 *  - THE PICKER, by what a thing is for: housing by district, then ports.
 *    Housing is ZONED — building it lays out a LOT, which new hires move into
 *    when they arrive — and only for people the company can hire: no lots for
 *    vibe coders before the studio opens. @see world/agents/arrivals
 */
import { Fragment, useMemo, useState, type ReactNode } from "react";
import { twMerge } from "tailwind-merge";

import { buildCost } from "../../game/build-cost";
import { addBeds, housedBy, housingCapacity } from "../../game/housing";
import { useGeneratorStore, type GeneratorId } from "../../state/generators.store";
import { useMoneyStore } from "../../state/money.store";
import { useSessionStore } from "../../state/session.store";
import { getArrivals, useWorldStore } from "../../state/world.store";
import { formatCurrency } from "../../utils/money-utils";
import { VEHICLE } from "../agents/arrivals";
import { workplaceKind } from "../agents/commute";
import { RANGE, serviceOf } from "../agents/services";
import type { ToolId } from "../edit/tools";
import { allStructureDefs, type StructureDef } from "../structures/def";
import { KIND_COLOUR, saleName } from "./building-info";

/** A small line icon, in the current colour. */
const Icon = ({ children }: { children: ReactNode }) => (
  <svg viewBox="0 0 16 16" className="h-3.5 w-3.5 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.5"
    strokeLinecap="round" strokeLinejoin="round" aria-hidden>{children}</svg>
);
const ICONS: Record<string, ReactNode> = {
  inspect: <Icon><path d="M3 2l9 5-4 1-1 4z" /></Icon>,
  paintRoad: <Icon><path d="M5 2L3 14M11 2l2 12M8 3v2M8 7v2M8 11v2" /></Icon>,
  eraseRoad: <Icon><path d="M5 2L3 14M11 2l2 12M6 6l4 4M10 6l-4 4" /></Icon>,
  placeStructure: <Icon><path d="M2 8l6-5 6 5M4 7v7h8V7M7 14v-4h2v4" /></Icon>,
  demolish: <Icon><path d="M3 4h10M6 4V2h4v2M4 4l1 10h6l1-10" /></Icon>,
  labels: <Icon><path d="M2 3h7l5 5-5 5-7-7z" /><circle cx="5.5" cy="6.5" r="1" /></Icon>,
};

const TOOLS: { id: ToolId; label: string; hint: string }[] = [
  { id: "inspect", label: "Look", hint: "Pan and look round the town; click a building to open it" },
  { id: "paintRoad", label: "Road", hint: "Drag to lay road" },
  { id: "eraseRoad", label: "Lift", hint: "Drag to take road up" },
  { id: "placeStructure", label: "Build", hint: "Zone a lot or build a port beside a road; click a seaport to upgrade it" },
  { id: "demolish", label: "Demolish", hint: "Click a building to take it down" },
];

const KINDS: GeneratorId[] = ["intern", "vibe_coder", "10x_dev"];
const KIND_TITLE: Record<GeneratorId, string> = { intern: "Interns", vibe_coder: "Vibe coders", "10x_dev": "10x devs" };

type ForSale = { def: StructureDef; price: number };
type Section = { title: string; colour?: number; items: ForSale[] };

/**
 * What is for sale at today's prices, a row a section: for each kind of
 * employee the company can hire, its lot and its office; then services; then
 * ports. @see buildCost
 */
function sections(hireable: ReadonlySet<string>): Section[] {
  const all: ForSale[] = allStructureDefs()
    .map((def) => ({ def, price: buildCost(def.id)?.toNumber() ?? -1 }))
    .filter((d) => d.price >= 0);
  const out: Section[] = [];
  for (const who of KINDS) {
    if (!hireable.has(who)) continue;
    // Their lot — one; it grows — then their office.
    const items = [
      ...all.filter((d) => housedBy(d.def.id)?.id === who),
      ...all.filter((d) => workplaceKind(d.def.id) === who),
    ];
    if (items.length) out.push({ title: KIND_TITLE[who], colour: KIND_COLOUR[who], items });
  }
  const services = all.filter((d) => serviceOf(d.def.id)).sort((a, b) => a.price - b.price);
  if (services.length) out.push({ title: "Services", colour: 0x2f8f6b, items: services });
  const ports = all.filter((d) => d.def.port).sort((a, b) => a.price - b.price);
  if (ports.length) out.push({ title: "Ports", colour: 0x4a90c8, items: ports });
  return out;
}

/** A tile's name in its row, which already says whose: "Lot", "Office", "Seaport II". */
const tileName = (def: StructureDef) =>
  housedBy(def.id) ? "Lot" : workplaceKind(def.id) ? "Office"
    : def.port ? saleName(def).replace(/^Seaport/, "Port") : saleName(def);

/** What a tile is, in a few words. */
function tileNote(def: StructureDef): string {
  const h = housedBy(def.id);
  if (h) return `${h.slots} beds · grows`;
  if (workplaceKind(def.id)) return "workplace";
  if (serviceOf(def.id)) return `serves ${RANGE} tiles`;
  if (def.port) return `${def.port.berths} berth${def.port.berths > 1 ? "s" : ""}`;
  return "";
}

const hex = (c: number) => `#${c.toString(16).padStart(6, "0")}`;

const PANEL = "border border-primary-300 bg-primary-50/95 shadow-md dark:border-primary-700 dark:bg-primary-900/95";
const TOOL =
  "flex cursor-pointer items-center gap-1 px-2 py-1 text-xs text-primary-800 hover:bg-primary-200 "
  + "dark:text-primary-200 dark:hover:bg-primary-800";
const TOOL_ON = "bg-primary-800 text-primary-50 hover:bg-primary-800 dark:bg-primary-200 dark:text-primary-900 dark:hover:bg-primary-200";

export function BuildBar({ className }: { className?: string }) {
  const tool = useWorldStore((s) => s.tool);
  const structureDefId = useWorldStore((s) => s.structureDefId);
  const setTool = useWorldStore((s) => s.setTool);
  const setStructureDef = useWorldStore((s) => s.setStructureDef);
  const setBrush = useWorldStore((s) => s.setBrush);
  const setBrushRadius = useWorldStore((s) => s.setBrushRadius);
  const grid = useWorldStore((s) => s.grid);
  const revision = useWorldStore((s) => s.revision);
  const labels = useWorldStore((s) => s.labels);
  const setLabels = useWorldStore((s) => s.setLabels);
  const money = useMoneyStore((s) => s.money);
  const generators = useGeneratorStore((s) => s.generators);
  const [picking, setPicking] = useState(false);

  // Who the company can hire: the generators it has unlocked. @see getUnlockedGeneratorIds
  const hireable = new Set(generators.map((g) => g.id));
  // Not memoised: prices follow the economy. @see buildCost
  const sale = sections(hireable);
  // As the economy counts beds: built on the map, and off it. Worked out here
  // rather than asked of the economy, whose reader is registered after the
  // first render and answers "unlimited" until it is. @see useFoundWorld
  const remote = useSessionStore((s) => s.remoteBeds);
  // Beds change with what is built, so with the revision as well as the grid.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const beds = useMemo(() => addBeds(housingCapacity(grid), remote ?? {}), [grid, revision, remote]);

  const choose = (id: ToolId) => {
    setTool(id);
    // Road goes down in a line, as a road does; everything else is a click.
    setBrush(id === "paintRoad" || id === "eraseRoad" ? "line" : "point");
    setBrushRadius(0);
    setPicking(id === "placeStructure" ? !(tool === id && picking) : false);
    // Something on offer in hand, not whatever was last: a lot for people the
    // company cannot hire yet is not.
    const offer = sale.flatMap((s) => s.items);
    if (id === "placeStructure" && offer.length && !offer.some((d) => d.def.id === structureDefId)) {
      setStructureDef(offer[0].def.id);
    }
  };
  const chosen = sale.flatMap((s) => s.items).find((d) => d.def.id === structureDefId);

  return (
    <div className={twMerge("flex flex-col items-center gap-1.5 text-primary-900 dark:text-primary-100", className)}>
      {picking && (
        // ALL OF IT AT ONCE: a row a section, a tile a thing, nothing to scroll.
        <div className={twMerge(PANEL, "grid max-w-[calc(100vw-1rem)] grid-cols-[auto_1fr] sm:w-max items-center gap-x-2 gap-y-1 p-2")}>
          {sale.map((sec) => (
            <Fragment key={sec.title}>
              <p className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wide text-primary-600 dark:text-primary-400">
                {sec.colour !== undefined && <span className="h-2 w-2 shrink-0" style={{ background: hex(sec.colour) }} />}
                {sec.title}
              </p>
              <div className="flex flex-wrap gap-1 sm:flex-nowrap">
                {sec.items.map(({ def, price }) => {
                  const afford = money.gte(price);
                  const on = def.id === structureDefId;
                  return (
                    <button key={def.id} type="button" title={`${saleName(def)} · ${def.footprint.w}×${def.footprint.h}`}
                      onClick={() => { setStructureDef(def.id); setPicking(false); }}
                      className={twMerge(
                        "flex w-32 cursor-pointer flex-col border border-primary-200 px-1.5 py-0.5 text-left text-xs hover:border-primary-500 dark:border-primary-700 dark:hover:border-primary-400",
                        on && "border-primary-700 bg-primary-200 dark:border-primary-200 dark:bg-primary-800",
                        !afford && "opacity-50",
                      )}>
                      <span className="flex items-baseline justify-between gap-1">
                        <b className="truncate">{tileName(def)}</b>
                        <span className={twMerge("tabular-nums", !afford && "text-red-700 dark:text-red-400")}>{formatCurrency(price)}</span>
                      </span>
                      <span className="truncate text-[10px] text-primary-600 dark:text-primary-400">{tileNote(def)}</span>
                    </button>
                  );
                })}
              </div>
            </Fragment>
          ))}
        </div>
      )}

      <div className={twMerge(PANEL, "flex flex-col")}>
        {/* THE BEDS: people against beds, a chip a district. */}
        <div className="flex flex-wrap justify-center gap-x-3 gap-y-0.5 border-b border-primary-200 px-2 py-1 text-[11px] tabular-nums dark:border-primary-700"
          title="People employed against beds — on lots zoned on the map, plus people living off it. You can't hire past your beds. A new hire works once they've arrived and moved in.">
          {KINDS.filter((id) => hireable.has(id)).map((id) => {
            const g = generators.find((x) => x.id === id)!;
            const have = beds[id] ?? 0;
            const full = g.amount >= have;
            const st = getArrivals().status[id];
            const by = { bus: "by bus", car: "by car", limo: "by limo" }[VEHICLE[id]];
            return (
              <span key={id} className="flex items-center gap-1">
                <span className="h-2 w-2" style={{ background: hex(KIND_COLOUR[id]) }} />
                <span className={full ? "text-red-700 dark:text-red-400" : undefined}>
                  {KIND_TITLE[id]} {g.amount}/{have}
                </span>
                {st?.riding ? <span className="text-emerald-700 dark:text-emerald-400" title={`On the way ${by}`}>+{st.riding} {by}</span> : null}
                {st?.waiting ? (
                  <span className={st.blocked ? "text-amber-700 dark:text-amber-400" : "text-primary-600 dark:text-primary-400"}>
                    {st.waiting} waiting{st.blocked === "no-lot" ? " for a lot" : st.blocked === "no-road" ? " (no road in)" : st.blocked === "no-services" ? " (want a café & park)" : ""}
                  </span>
                ) : null}
              </span>
            );
          })}
        </div>

        {/* THE TOOLS. */}
        <div className="flex items-stretch">
          {TOOLS.map((t) => (
            <button key={t.id} type="button" title={t.hint} onClick={() => choose(t.id)}
              className={twMerge(TOOL, tool === t.id && TOOL_ON)}>
              {ICONS[t.id]}
              <span>{t.label}</span>
              {t.id === "placeStructure" && chosen && tool === t.id && (
                <span className="ml-0.5 border-l border-current/30 pl-1 opacity-80">{saleName(chosen.def)}</span>
              )}
            </button>
          ))}
          <span className="mx-0.5 my-1 w-px bg-primary-300 dark:bg-primary-700" />
          <button type="button" title="Show or hide what each building is and how it is doing"
            onClick={() => setLabels(!labels)} className={twMerge(TOOL, labels && TOOL_ON)}>
            {ICONS.labels}
            <span>Labels</span>
          </button>
        </div>
      </div>
    </div>
  );
}
