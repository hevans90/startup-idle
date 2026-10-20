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
import { Fragment, useEffect, useMemo, useState, type ReactNode } from "react";
import { twMerge } from "tailwind-merge";

import { buildCost } from "../../game/build-cost";
import { featureGateOpen } from "../../game/projects";
import { addBeds, housedBy, housingCapacity } from "../../game/housing";
import { useGeneratorStore, type GeneratorId } from "../../state/generators.store";
import { useMoneyStore } from "../../state/money.store";
import { useSessionStore } from "../../state/session.store";
import { UNDO_WINDOW_MS, getArrivals, getNetwork, parcelPrice, useWorldStore } from "../../state/world.store";
import { formatCurrency } from "../../utils/money-utils";
import { VEHICLE } from "../agents/arrivals";
import { DESKS, liveSeating, workplaceKind } from "../agents/commute";
import { RANGE, serviceOf } from "../agents/services";
import type { ToolId } from "../edit/tools";
import { allStructureDefs, type StructureDef } from "../structures/def";
import { KIND_COLOUR, saleName } from "./building-info";
import { useAiSingularityStore } from "../../state/ai-singularity.store";
import { runningAgents } from "../../state/agents.store";
import { useFounderStore } from "../../state/founder.store";
import { getAiRunner } from "../ai/ai-runner";
import { useTicking } from "../../hooks/use-ticking";
import { WondersPanel } from "./wonders-panel";
import { AiModePanel } from "./ai-mode-panel";
import { PARCELS } from "../land";
import { hasRiver } from "../boats/river";
import { LAB_SHARE } from "../projects/labs";
import { AGENTS_A_RACK, agentsOpen } from "../../game/agents";
import { PUMP_HEAD } from "../../game/cooling";
import { InfoPop } from "../../ui/InfoPop";

/** A small line icon, in the current colour. */
const Icon = ({ children }: { children: ReactNode }) => (
  <svg viewBox="0 0 16 16" className="h-3.5 w-3.5 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.5"
    strokeLinecap="round" strokeLinejoin="round" aria-hidden>{children}</svg>
);
const ICONS: Record<string, ReactNode> = {
  inspect: <Icon><path d="M3 2l9 5-4 1-1 4z" /></Icon>,
  paintRoad: <Icon><path d="M5 2L3 14M11 2l2 12M8 3v2M8 7v2M8 11v2" /></Icon>,
  eraseRoad: <Icon><path d="M5 2L3 14M11 2l2 12M6 6l4 4M10 6l-4 4" /></Icon>,
  pipe: <Icon><path d="M2 6h7a3 3 0 0 1 3 3v5M2 10h7M8 14h8" /></Icon>,
  placeStructure: <Icon><path d="M2 8l6-5 6 5M4 7v7h8V7M7 14v-4h2v4" /></Icon>,
  demolish: <Icon><path d="M3 4h10M6 4V2h4v2M4 4l1 10h6l1-10" /></Icon>,
  buyLand: <Icon><path d="M4 14V2M4 2.5h8l-2 2.5 2 2.5H4" /></Icon>,
  labels: <Icon><path d="M2 3h7l5 5-5 5-7-7z" /><circle cx="5.5" cy="6.5" r="1" /></Icon>,
  wonders: <Icon><path d="M8 1.5l1.8 3.9 4.2.5-3.1 2.9.8 4.2L8 11l-3.7 2 .8-4.2L2 5.9l4.2-.5z" /></Icon>,
  mood: <Icon><circle cx="8" cy="8" r="6" /><path d="M5.5 9.5c.7 1 1.5 1.5 2.5 1.5s1.8-.5 2.5-1.5M6 6.5h.01M10 6.5h.01" /></Icon>,
  earnings: <Icon><path d="M8 1.5v13M11 4.5H6.5a2 2 0 000 4h3a2 2 0 010 4H5" /></Icon>,
  undo: <Icon><path d="M5 3L2 6l3 3M2 6h7a4 4 0 010 8H6" /></Icon>,
  // The people row. @see Stat
  people: <Icon><circle cx="6" cy="5" r="2" /><path d="M2.5 13c0-2.2 1.6-3.5 3.5-3.5S9.5 10.8 9.5 13M10.5 3.5a2 2 0 010 3.5M12 9.8c1 .5 1.5 1.6 1.5 3.2" /></Icon>,
  desk: <Icon><path d="M2 6h12M3.5 6v7M12.5 6v7M3.5 9.5h4M7.5 6v7" /></Icon>,
  bus: <Icon><rect x="2.5" y="3" width="11" height="8" rx="1" /><path d="M2.5 7.5h11M5 11v1.5M11 11v1.5" /></Icon>,
  waiting: <Icon><path d="M4 2h8M4 14h8M5 2c0 3 6 3.5 6 6s-6 3-6 6M11 2c0 3-6 3.5-6 6s6 3 6 6" /></Icon>,
  noLot: <Icon><path d="M2 8l6-5 6 5M4 7v7h8V7" /><path d="M6 9l4 4M10 9l-4 4" /></Icon>,
  noRoad: <Icon><path d="M5 2L3 14M11 2l2 12M6 6l4 4M10 6l-4 4" /></Icon>,
  noServices: <Icon><path d="M3 6h8v4a3 3 0 01-3 3H6a3 3 0 01-3-3zM11 7h1.5a1.5 1.5 0 010 3H11M5 2.5v2M8 2.5v2" /></Icon>,
  unhappy: <Icon><circle cx="8" cy="8" r="6" /><path d="M5.5 11c.7-1 1.5-1.5 2.5-1.5s1.8.5 2.5 1.5M6 6.5h.01M10 6.5h.01" /></Icon>,
};

/** Why people hired are still waiting to move in: an icon and what it means. */
const BLOCKED: Record<string, { icon: ReactNode; title: string; why: string }> = {
  "no-lot": { icon: ICONS.noLot, title: "No free lot", why: "Every lot is taken. Build more housing for them to move into." },
  "no-road": { icon: ICONS.noRoad, title: "No road in", why: "There's no road from the edge of the map to a free lot." },
  "no-services": { icon: ICONS.noServices, title: "Nowhere good enough", why: "10x devs only move in where desirability is at least 10: a café, a park, water or a wonder nearby raise it." },
  unhappy: { icon: ICONS.unhappy, title: "Unhappy homes", why: "The free lots are too miserable. Services nearby, and fewer derelicts, cheer them up." },
};

/**
 * A FIGURE IN THE PEOPLE ROW: an icon and a number, explained on hover. The
 * row used to spell each one out — "4 waiting (their homes are miserable)" —
 * which was a sentence a district and wrapped onto lines of its own.
 */
function Stat({ icon, value, tone, title, children }: {
  icon: ReactNode; value?: ReactNode; tone?: string; title: string; children: ReactNode;
}) {
  return (
    <InfoPop className={tone} title={title}
      trigger={<>{icon}{value !== undefined && <span>{value}</span>}</>}>
      <p>{children}</p>
    </InfoPop>
  );
}

/** The tools the AI takes over at the Overseer stage. */
const ROAD_TOOLS = new Set<ToolId>(["paintRoad", "eraseRoad"]);

const TOOLS: { id: ToolId; label: string; hint: string }[] = [
  { id: "inspect", label: "Look", hint: "Pan and look round the town; click a building to open it" },
  { id: "paintRoad", label: "Road", hint: "Drag to lay road" },
  { id: "eraseRoad", label: "Lift", hint: "Drag to take road or pipe up" },
  { id: "pipe", label: "Pipe", hint: "Drag to lay pipe: from water to the Data Centre, to cool it" },
  { id: "placeStructure", label: "Build", hint: "Build beside a road; drag along a street for a row of lots; click a seaport to upgrade it" },
  { id: "demolish", label: "Demolish", hint: "Click a building to take it down" },
  { id: "buyLand", label: "Land", hint: "Click land beside yours to buy it" },
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
function sections(hireable: ReadonlySet<string>, river: boolean): Section[] {
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
      // The 10x devs' R&D lab. @see world/projects/labs
      ...(who === "10x_dev" ? all.filter((d) => d.def.id === "lab") : []),
    ];
    if (items.length) out.push({ title: KIND_TITLE[who], colour: KIND_COLOUR[who], items });
  }
  // AI RACKS, once the Data Centre stands. @see game/agents
  // And the pump house that cools them, by the water. @see PUMP
  const racks = all.filter((d) => d.def.id === "rack" || d.def.id === "pump");
  if (racks.length && agentsOpen() && hireable.has("10x_dev")) out.push({ title: "AI agents", colour: 0x6c7cff, items: racks });
  // Services and ports once their projects have opened them. @see featureGateOpen
  const services = all.filter((d) => serviceOf(d.def.id)).sort((a, b) => a.price - b.price);
  if (services.length && featureGateOpen("services")) out.push({ title: "Services", colour: 0x2f8f6b, items: services });
  const ports = all.filter((d) => d.def.port).sort((a, b) => a.price - b.price);
  if (ports.length && featureGateOpen("ports")) out.push({ title: "Ports", colour: 0x4a90c8, items: ports });
  // FLOOD WALLS, on a map with a river to flood. @see LEVEE
  const walls = all.filter((d) => d.def.id === "levee");
  if (river && walls.length) out.push({ title: "Defences", colour: 0x8a8475, items: walls });
  return out;
}

/** A tile's name in its row, which already says whose: "Lot", "Office", "Seaport II". */
const tileName = (def: StructureDef) =>
  housedBy(def.id) ? "Lot" : workplaceKind(def.id) ? "Office" : def.id === "lab" ? "Lab" : def.id === "rack" ? "Rack" : def.id === "pump" ? "Pump"
    : def.port ? saleName(def).replace(/^Seaport/, "Port") : saleName(def);

/** What a tile is, in a few words. */
function tileNote(def: StructureDef): string {
  const h = housedBy(def.id);
  if (h) return `${h.slots} beds · grows`;
  if (workplaceKind(def.id)) return `${DESKS[def.id] ?? 0} desks`;
  if (serviceOf(def.id)) return `serves ${RANGE} tiles`;
  if (def.port) return `${def.port.berths} berth${def.port.berths > 1 ? "s" : ""}`;
  if (def.id === "levee") return "drag along a bank";
  if (def.id === "lab") return `innovation +${LAB_SHARE * 100}%`;
  if (def.id === "rack") return `${AGENTS_A_RACK} agents · near the Data Centre`;
  if (def.id === "pump") return `lifts water ${PUMP_HEAD / 2} slabs · by the water`;
  return "";
}

/** How long a refusal stays up, ms. */
const NOTICE_MS = 3500;

const hex = (c: number) => `#${c.toString(16).padStart(6, "0")}`;

const PANEL = "border border-primary-300 bg-primary-50/95 shadow-md dark:border-primary-700 dark:bg-primary-900/95";
const TOOL =
  "flex cursor-pointer items-center gap-1 whitespace-nowrap px-2 py-1 text-xs text-primary-800 hover:bg-primary-200 pointer-coarse:min-h-11 pointer-coarse:min-w-11 pointer-coarse:justify-center "
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
  // WHAT WAS LAST REFUSED, for a few seconds. @see WorldState.notice
  const notice = useWorldStore((s) => s.notice);
  const [, setNow] = useState(0);
  useEffect(() => {
    if (!notice) return;
    const id = setTimeout(() => setNow(Date.now()), NOTICE_MS + 50);
    return () => clearTimeout(id);
  }, [notice]);
  const showNotice = notice && Date.now() - notice.at < NOTICE_MS;
  // THE LAST BUILD, while it can be taken back. @see undoLastBuild
  const lastBuild = useWorldStore((s) => s.lastBuild);
  const undoLastBuild = useWorldStore((s) => s.undoLastBuild);
  useEffect(() => {
    if (!lastBuild) return;
    const id = setTimeout(() => setNow(Date.now()), Math.max(0, lastBuild.at + UNDO_WINDOW_MS - Date.now()) + 50);
    return () => clearTimeout(id);
  }, [lastBuild]);
  const canUndo = lastBuild && Date.now() - lastBuild.at < UNDO_WINDOW_MS;
  const wondersOpen = useWorldStore((s) => s.wondersOpen);
  const moodOverlay = useWorldStore((s) => s.moodOverlay);
  const setMoodOverlay = useWorldStore((s) => s.setMoodOverlay);
  const earningsOverlay = useWorldStore((s) => s.earningsOverlay);
  const setEarningsOverlay = useWorldStore((s) => s.setEarningsOverlay);
  const setWondersOpen = useWorldStore((s) => s.setWondersOpen);

  // Who the company can hire: the generators it has unlocked. @see getUnlockedGeneratorIds
  const hireable = new Set(generators.map((g) => g.id));
  // Not memoised: prices follow the economy. @see buildCost
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const river = useMemo(() => hasRiver(grid), [grid, grid.rev]);
  const sale = sections(hireable, river);
  // As the economy counts beds: built on the map, and off it. Worked out here
  // rather than asked of the economy, whose reader is registered after the
  // first render and answers "unlimited" until it is. @see useFoundWorld
  const remote = useSessionStore((s) => s.remoteBeds);
  // Beds change with what is built, so with the revision as well as the grid.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const beds = useMemo(() => addBeds(housingCapacity(grid), remote ?? {}), [grid, revision, remote]);
  // WITHOUT A DESK, by kind: who the workplaces could not seat. @see seat
  const net = getNetwork();
  const deskless: Partial<Record<GeneratorId, number>> = {};
  if (net) {
    for (const [house, c] of liveSeating(grid, net).commutes) {
      const kind = housedBy(grid.structures.get(house)?.def ?? "")?.id;
      if (kind && c.deskless) deskless[kind] = (deskless[kind] ?? 0) + c.deskless;
    }
  }

  // THE AI AT WORK: from the Colleague on, while agents run; at the Overseer it lays every road. @see stepAi
  useTicking(1000);
  const aiValue = useAiSingularityStore((s) => s.value);
  const notModel = useFounderStore((s) => s.selectedFounderId) !== "model";
  const aiBuilding = notModel && aiValue >= 40 && runningAgents() > 0;
  const aiRoads = notModel && aiValue >= 80;
  const aiLog = getAiRunner().log;
  const aiMemo = aiLog[aiLog.length - 1]?.text;
  const choose = (id: ToolId) => {
    setTool(id);
    // Road goes down in a line, as a road does; everything else is a click.
    setBrush(id === "paintRoad" || id === "eraseRoad" || id === "pipe" ? "line" : "point");
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
  // LAND FOR SALE, while any is left: the next parcel's price. @see world/land
  const land = useSessionStore((s) => s.land);
  const forSale = !!land && land.length < PARCELS * PARCELS;
  // PIPE, once there is a Data Centre to cool. @see game/cooling
  const pipesOpen = agentsOpen();
  const landNext = parcelPrice();

  return (
    <div className={twMerge("flex flex-col items-center gap-1.5 text-primary-900 dark:text-primary-100", className)}>
      {showNotice && (
        <p role="status" className="border border-red-300 bg-red-50/95 px-2 py-1 text-xs text-red-800 shadow dark:border-red-800 dark:bg-red-950/90 dark:text-red-200">
          {notice!.text}
        </p>
      )}
      <WondersPanel />
      <AiModePanel />
      {picking && !wondersOpen && (
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

      <div className={twMerge(PANEL, "flex max-w-full flex-col")}>
        {/* THE PEOPLE: a chip a district, its figures as icons. @see Stat */}
        <div className="flex flex-wrap justify-center gap-x-4 gap-y-0.5 border-b border-primary-200 px-2 py-1 text-[11px] tabular-nums dark:border-primary-700">
          {KINDS.filter((id) => hireable.has(id)).map((id) => {
            const g = generators.find((x) => x.id === id)!;
            const have = beds[id] ?? 0;
            const full = g.amount >= have;
            const st = getArrivals().status[id];
            const by = { bus: "bus", car: "car", limo: "limo" }[VEHICLE[id]];
            const name = KIND_TITLE[id];
            const blocked = st?.blocked ? BLOCKED[st.blocked] : null;
            return (
              <span key={id} className="flex items-center gap-1.5">
                <span className="h-2 w-2" style={{ background: hex(KIND_COLOUR[id]) }} />
                <Stat icon={ICONS.people} value={`${g.amount}/${have}`} tone={full ? "text-red-700 dark:text-red-400" : undefined}
                  title={`${name}: ${g.amount} employed, ${have} beds`}>
                  {full
                    ? "Every bed is taken, so you can't hire more until you build housing for them."
                    : "People employed against beds, on lots on the map and off it. A new hire works once they've moved in."}
                </Stat>
                {deskless[id] ? (
                  <Stat icon={ICONS.desk} value={deskless[id]} tone="text-amber-700 dark:text-amber-400" title={`${deskless[id]} without a desk`}>
                    Every desk is taken, so they work at a third of the pace. An office adds desks.
                  </Stat>
                ) : null}
                {st?.riding ? (
                  <Stat icon={ICONS.bus} value={`+${st.riding}`} tone="text-emerald-700 dark:text-emerald-400" title={`${st.riding} on the way`}>
                    Hired, and coming in by {by}.
                  </Stat>
                ) : null}
                {st?.waiting ? (
                  <Stat icon={ICONS.waiting} value={st.waiting}
                    tone={blocked ? "text-amber-700 dark:text-amber-400" : "text-primary-600 dark:text-primary-400"}
                    title={blocked ? `${st.waiting} waiting: ${blocked.title.toLowerCase()}` : `${st.waiting} waiting`}>
                    {blocked ? blocked.why : "Hired, and waiting for their ride in."}
                  </Stat>
                ) : null}
                {blocked ? (
                  <Stat icon={blocked.icon} tone="text-amber-700 dark:text-amber-400" title={blocked.title}>{blocked.why}</Stat>
                ) : null}
              </span>
            );
          })}
        </div>

        {/* THE TOOLS. */}
        <div className="flex items-stretch overflow-x-auto">
          {TOOLS.filter((t) => (t.id !== "buyLand" || forSale) && (t.id !== "pipe" || pipesOpen)).map((t) => (
            <button key={t.id} type="button" title={aiRoads && ROAD_TOOLS.has(t.id) ? "Your input is no longer required for roads." : t.hint}
              onClick={() => choose(t.id)} disabled={aiRoads && ROAD_TOOLS.has(t.id)}
              data-hint={t.id === "placeStructure" ? "build" : t.id === "buyLand" ? "land" : undefined}
              className={twMerge(TOOL, tool === t.id && TOOL_ON, "disabled:cursor-default disabled:opacity-40")}>
              {ICONS[t.id]}
              <span className="@max-3xl:hidden">{t.label}</span>
              {t.id === "placeStructure" && chosen && tool === t.id && (
                <span className="ml-0.5 border-l border-current/30 pl-1 opacity-80">{saleName(chosen.def)}</span>
              )}
              {t.id === "buyLand" && (
                <span className={twMerge("tabular-nums", money.lt(landNext) && "text-red-700 dark:text-red-400")}>{formatCurrency(landNext)}</span>
              )}
            </button>
          ))}
          {/* THE AI IS BUILDING: its latest memo on hover. @see stepAi */}
          {aiBuilding && (
            <span title={aiMemo ?? "The AI is working on the town."}
              className="flex items-center gap-1 px-2 text-[10px] font-bold uppercase tracking-wide text-violet-700 dark:text-violet-300">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-violet-600 dark:bg-violet-400" />
              <span className="@max-3xl:hidden">The AI is building</span>
            </span>
          )}
          {canUndo && (
            <button type="button" title="Take back the last build and get its money back"
              onClick={undoLastBuild} className={twMerge(TOOL, "text-amber-800 dark:text-amber-300")}>
              {ICONS.undo}
              <span>Undo +{formatCurrency(lastBuild!.refund)}</span>
            </button>
          )}
          <span className="mx-0.5 my-1 w-px bg-primary-300 dark:bg-primary-700" />
          <button type="button" title="The wonders: great buildings, each a bonus for good" data-hint="wonders"
            onClick={() => { setWondersOpen(!wondersOpen); setPicking(false); }}
            className={twMerge(TOOL, wondersOpen && TOOL_ON)}>
            {ICONS.wonders}
            <span className="@max-3xl:hidden">Wonders</span>
          </button>
          <button type="button" title="Tint every house by how happy its people are" data-hint="mood"
            onClick={() => setMoodOverlay(!moodOverlay)} className={twMerge(TOOL, moodOverlay && TOOL_ON)}>
            {ICONS.mood}
            <span className="@max-3xl:hidden">Mood</span>
          </button>
          <button type="button" title="Tint every street by what it earns, and list the best"
            onClick={() => setEarningsOverlay(!earningsOverlay)} className={twMerge(TOOL, earningsOverlay && TOOL_ON)}>
            {ICONS.earnings}
            <span className="@max-3xl:hidden">Earnings</span>
          </button>
          <button type="button" title="Show or hide what each building is and how it is doing"
            onClick={() => setLabels(!labels)} className={twMerge(TOOL, labels && TOOL_ON)}>
            {ICONS.labels}
            <span className="@max-3xl:hidden">Labels</span>
          </button>
        </div>
      </div>
    </div>
  );
}
