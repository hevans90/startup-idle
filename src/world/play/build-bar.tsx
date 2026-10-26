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
import { isPhone } from "../../hooks/use-phone";
import { Fragment, useRef, useEffect, useMemo, useState, type ReactNode } from "react";
import { twMerge } from "tailwind-merge";

import { buildCost } from "../../game/build-cost";
import { featureGateOpen } from "../../game/projects";
import { addBeds, housedBy, housingCapacity } from "../../game/housing";
import { useGeneratorStore, type GeneratorId } from "../../state/generators.store";
import { useMoneyStore } from "../../state/money.store";
import { useSessionStore } from "../../state/session.store";
import { UNDO_WINDOW_MS, getArrivals, getNetwork, useWorldStore } from "../../state/world.store";
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
import { hasRiver } from "../boats/river";
import { LAB_SHARE } from "../projects/labs";
import { AGENTS_A_RACK, agentsOpen } from "../../game/agents";
import { PUMP_HEAD } from "../../game/cooling";
import { MainCard } from "./main-card";
import { InfoPop } from "../../ui/InfoPop";
import { FOCUS, Kbd, Segmented, Tile } from "../../ui/console";

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
  labels: <Icon><path d="M2 3h7l5 5-5 5-7-7z" /><circle cx="5.5" cy="6.5" r="1" /></Icon>,
  wonders: <Icon><path d="M8 1.5l1.8 3.9 4.2.5-3.1 2.9.8 4.2L8 11l-3.7 2 .8-4.2L2 5.9l4.2-.5z" /></Icon>,
  water: <Icon><path d="M8 2.5c2.5 3 4 5.2 4 7a4 4 0 0 1-8 0c0-1.8 1.5-4 4-7z" /></Icon>,
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

/** The tools the AI takes over in its district at the Overseer stage. @see aiHoldsRoads */
const ROAD_TOOLS = new Set<ToolId>(["paintRoad", "eraseRoad"]);

const TOOLS: { id: ToolId; label: string; hint: string }[] = [
  { id: "inspect", label: "Look", hint: "Pan and look round the town; click a building to open it" },
  { id: "paintRoad", label: "Road", hint: "Drag to lay road" },
  { id: "eraseRoad", label: "Lift", hint: "Drag to take road up — or pipe, with Pipe chosen beside it" },
  { id: "pipe", label: "Pipe", hint: "Drag from water to the Data Centre or an AI building to lay a water main: it finds its own way" },
  { id: "placeStructure", label: "Build", hint: "Build beside a road; drag along a street for a row of lots; click a seaport to upgrade it" },
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
  // (A pump is a main's, at its intake now: no pump house to place. @see MainCard)
  const racks = all.filter((d) => d.def.id === "rack");
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


const hex = (c: number) => `#${c.toString(16).padStart(6, "0")}`;

const PANEL = "border border-line-quiet bg-surface-1/95 shadow-lg backdrop-blur-sm";
const TOOL =
  `flex cursor-pointer items-center gap-1 whitespace-nowrap px-2 py-1 text-xs text-fg hover:bg-surface-2 pointer-coarse:min-h-11 pointer-coarse:min-w-11 pointer-coarse:justify-center ${FOCUS}`;
/** In hand, or on: lit in the console's own colour, underlined. */
const TOOL_ON = "bg-surface-3 text-console shadow-[inset_0_-2px_0_var(--ui-console)] hover:bg-surface-3";

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
  // AI MODE, a view on The Model's runs: its switch here, its settings above. @see AiModePanel
  const model = useFounderStore((s) => s.selectedFounderId) === "model";
  const aiMode = useSessionStore((s) => s.aiMode);
  const setAiMode = useSessionStore((s) => s.setAiMode);
  const money = useMoneyStore((s) => s.money);
  const generators = useGeneratorStore((s) => s.generators);
  const [picking, setPicking] = useState(false);
  const phone = isPhone();
  const [viewsOpen, setViewsOpen] = useState(false);
  // A refusal is comms' now, shown by the pointer. @see NoticeToast
  const [, setNow] = useState(0);
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
  const waterOverlay = useWorldStore((s) => s.waterOverlay);
  const setWaterOverlay = useWorldStore((s) => s.setWaterOverlay);
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

  // THE AI AT WORK: from the Colleague on, while agents run; at the Overseer its district's streets are its own. @see stepAi, aiHoldsRoads
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
  // PIPE, once there is a Data Centre to cool. @see game/cooling
  const pipesOpen = agentsOpen();
  const liftPipe = useWorldStore((s) => s.liftPipe);
  const setLiftPipe = useWorldStore((s) => s.setLiftPipe);
  // THE TOOLS ON OFFER, and their keys: 1 to 6, as shown on each. Not while typing in a field, nor with a modifier.
  const shown = useMemo(() => TOOLS.filter((t) => t.id !== "pipe" || pipesOpen), [pipesOpen]);
  const keyed = useRef(choose);
  keyed.current = choose;
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const el = e.target as HTMLElement | null;
      if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) return;
      const n = Number(e.key);
      if (!Number.isInteger(n) || n < 1 || n > shown.length) return;
      e.preventDefault();
      keyed.current(shown[n - 1].id);
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [shown]);

  const views = (
    <>
      <button type="button" title="The wonders: great buildings, each a bonus for good" data-hint="wonders"
        onClick={() => { setWondersOpen(!wondersOpen); setPicking(false); }}
        className={twMerge(TOOL, wondersOpen && TOOL_ON)}>
        {ICONS.wonders}
        <span className="@max-6xl:hidden">Wonders</span>
      </button>
      <button type="button" title="Tint every house by how happy its people are" data-hint="mood"
        onClick={() => setMoodOverlay(!moodOverlay)} className={twMerge(TOOL, moodOverlay && TOOL_ON)}>
        {ICONS.mood}
        <span className="@max-6xl:hidden">Mood</span>
      </button>
      <button type="button" title="Tint every street by what it earns, and list the best"
        onClick={() => setEarningsOverlay(!earningsOverlay)} className={twMerge(TOOL, earningsOverlay && TOOL_ON)}>
        {ICONS.earnings}
        <span className="@max-6xl:hidden">Earnings</span>
      </button>
      {pipesOpen && (
        <button type="button" title="Show every water main by what it is doing, each tank, and the water: on too while the Pipe tool is in hand"
          onClick={() => setWaterOverlay(!waterOverlay)} className={twMerge(TOOL, (waterOverlay || tool === "pipe") && TOOL_ON)}>
          {ICONS.water}
          <span className="@max-6xl:hidden">Water</span>
        </button>
      )}
      {model && (
        <button type="button" title="AI mode: The Model builds the town itself" aria-pressed={aiMode}
          onClick={() => setAiMode({ aiMode: !aiMode })} className={twMerge(TOOL, aiMode && TOOL_ON, aiMode && "text-ai")}>
          <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-ai" />
          <span className="@max-6xl:hidden">AI mode</span>
        </button>
      )}
      <button type="button" title="Show or hide what each building is and how it is doing"
        onClick={() => setLabels(!labels)} className={twMerge(TOOL, labels && TOOL_ON)}>
        {ICONS.labels}
        <span className="@max-6xl:hidden">Labels</span>
      </button>
    </>
  );

  return (
    <div className={twMerge("flex flex-col items-center gap-1.5 text-fg", className)}>
      <WondersPanel />
      <AiModePanel />
      <MainCard />
      {/* LIFT: road, or pipe — never both at once. @see liftPipe */}
      {tool === "eraseRoad" && pipesOpen && (
        <div className={twMerge(PANEL, "flex items-center gap-2 px-2 py-1 text-xs")}>
          <span className="text-fg-muted">Lift</span>
          <Segmented label="What Lift takes up" value={liftPipe ? "pipe" : "road"} onChange={(v) => setLiftPipe(v === "pipe")}
            options={[{ value: "road", label: "Road" }, { value: "pipe", label: "Pipe" }]} />
        </div>
      )}
      {picking && !wondersOpen && (
        // ALL OF IT AT ONCE: a row a section, a tile a thing, nothing to scroll.
        <div className={twMerge(PANEL, "grid max-w-[calc(100vw-1rem)] grid-cols-[auto_1fr] sm:w-max items-center gap-x-2 gap-y-1 p-2")}>
          {sale.map((sec) => (
            <Fragment key={sec.title}>
              <p className="flex items-center gap-1.5 text-[10px] uppercase tracking-widest text-fg-muted">
                {sec.colour !== undefined && <span className="h-2 w-2 shrink-0" style={{ background: hex(sec.colour) }} />}
                {sec.title}
              </p>
              <div className="flex flex-wrap gap-1 sm:flex-nowrap">
                {sec.items.map(({ def, price }) => {
                  const afford = money.gte(price);
                  const on = def.id === structureDefId;
                  return (
                    <Tile key={def.id} selected={on} lit={afford && !on} title={`${saleName(def)} · ${def.footprint.w}×${def.footprint.h}`}
                      onClick={() => { setStructureDef(def.id); setPicking(false); }}
                      className={twMerge("flex w-32 flex-col px-1.5 py-1 text-xs", !afford && "text-fg-muted")}>
                      <span className="flex items-baseline justify-between gap-1">
                        <b className="truncate">{tileName(def)}</b>
                        <span className={twMerge("tabular-nums", !afford && "text-bad")}>{formatCurrency(price)}</span>
                      </span>
                      <span className="truncate text-[10px] text-fg-muted">{tileNote(def)}</span>
                    </Tile>
                  );
                })}
              </div>
            </Fragment>
          ))}
        </div>
      )}

      <div className={twMerge(PANEL, "flex max-w-full flex-col")}>
        {/* THE PEOPLE: a chip a district, its figures as icons. @see Stat */}
        <div className="flex flex-wrap justify-center gap-x-4 gap-y-0.5 border-b border-line-quiet px-2 py-1 text-[11px] tabular-nums">
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
                <Stat icon={ICONS.people} value={`${g.amount}/${have}`} tone={full ? "text-bad" : undefined}
                  title={`${name}: ${g.amount} employed, ${have} beds`}>
                  {full
                    ? "Every bed is taken, so you can't hire more until you build housing for them."
                    : "People employed against beds, on lots on the map and off it. A new hire works once they've moved in."}
                </Stat>
                {deskless[id] ? (
                  <Stat icon={ICONS.desk} value={deskless[id]} tone="text-warn" title={`${deskless[id]} without a desk`}>
                    Every desk is taken, so they work at a third of the pace. An office adds desks.
                  </Stat>
                ) : null}
                {st?.riding ? (
                  <Stat icon={ICONS.bus} value={`+${st.riding}`} tone="text-good" title={`${st.riding} on the way`}>
                    Hired, and coming in by {by}.
                  </Stat>
                ) : null}
                {st?.waiting ? (
                  <Stat icon={ICONS.waiting} value={st.waiting}
                    tone={blocked ? "text-warn" : "text-fg-muted"}
                    title={blocked ? `${st.waiting} waiting: ${blocked.title.toLowerCase()}` : `${st.waiting} waiting`}>
                    {blocked ? blocked.why : "Hired, and waiting for their ride in."}
                  </Stat>
                ) : null}
                {blocked ? (
                  <Stat icon={blocked.icon} tone="text-warn" title={blocked.title}>{blocked.why}</Stat>
                ) : null}
              </span>
            );
          })}
        </div>

        {phone && viewsOpen && <div className="flex items-stretch overflow-x-auto border-b border-line-quiet">{views}</div>}
        {/* THE TOOLS: a rail that scrolls, on a phone. */}
        <div className="flex items-stretch overflow-x-auto">
          {shown.map((t, k) => (
            <button key={t.id} type="button" title={`${aiRoads && ROAD_TOOLS.has(t.id) ? `${t.hint} — outside the AI's district: its streets are its own now` : t.hint} (${k + 1})`}
              onClick={() => choose(t.id)} aria-pressed={tool === t.id} aria-keyshortcuts={String(k + 1)}
              data-hint={t.id === "placeStructure" ? "build" : undefined}
              className={twMerge(TOOL, tool === t.id && TOOL_ON, "disabled:cursor-default disabled:opacity-40")}>
              {ICONS[t.id]}
              <span className="@max-3xl:hidden">{t.label}</span>
              <span className="@max-5xl:hidden"><Kbd>{k + 1}</Kbd></span>
              {t.id === "placeStructure" && chosen && tool === t.id && (
                <span className="ml-0.5 border-l border-current/30 pl-1 opacity-80">{saleName(chosen.def)}</span>
              )}
            </button>
          ))}
          {/* THE AI IS BUILDING: its latest memo on hover. @see stepAi */}
          {aiBuilding && (
            <span title={aiMemo ?? "The AI is working on the town."}
              className="flex items-center gap-1 px-2 text-[10px] uppercase tracking-widest text-ai">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-ai" />
              <span className="@max-3xl:hidden">The AI is building</span>
            </span>
          )}
          {canUndo && (
            <button type="button" title="Take back the last build and get its money back"
              onClick={undoLastBuild} className={twMerge(TOOL, "text-warn")}>
              {ICONS.undo}
              <span>Undo +{formatCurrency(lastBuild!.refund)}</span>
            </button>
          )}
          {/* VIEWS from here: what you see, not what you hold — on a phone, behind a button. */}
          <span className="mx-0.5 my-1 w-px bg-surface-3" />
          {phone ? (
            <button type="button" aria-expanded={viewsOpen} title="What the map shows" onClick={() => setViewsOpen(!viewsOpen)}
              className={twMerge(TOOL, viewsOpen && TOOL_ON)}>
              {ICONS.labels}<span>Views</span>
            </button>
          ) : views}
        </div>
      </div>
    </div>
  );
}
