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
import { PROCESS_RATE, processorKind } from "../../game/processors";
import { SLOP_FROM } from "../../game/slop";
import { isPhone } from "../../hooks/use-phone";
import { useRef, useEffect, useMemo, useState, type ReactNode } from "react";
import { twMerge } from "tailwind-merge";

import { buildCost } from "../../game/build-cost";
import { featureGateOpen } from "../../game/projects";
import { addBeds, housedBy, housingCapacity } from "../../game/housing";
import { useGeneratorStore, type GeneratorId } from "../../state/generators.store";
import { useMoneyStore } from "../../state/money.store";
import { useSessionStore } from "../../state/session.store";
import { UNDO_WINDOW_MS, getArrivals, getNetwork, startFixture, useWorldStore } from "../../state/world.store";
import { groundMode } from "../render/ground-mode";
import { FARM, PLANTINGS, type Planting } from "../vegetation/tend";
import { formatCurrency } from "../../utils/money-utils";
import { VEHICLE } from "../agents/arrivals";
import { DESKS, liveSeating, workplaceKind } from "../agents/commute";
import type { ToolId } from "../edit/tools";
import { allStructureDefs, structureDef, type StructureDef } from "../structures/def";
import { KIND_COLOUR, saleName } from "./building-info";
import { useAiSingularityStore } from "../../state/ai-singularity.store";
import { runningAgents } from "../../state/agents.store";
import { useFounderStore } from "../../state/founder.store";
import { getAiRunner } from "../ai/ai-runner";
import { useTicking } from "../../hooks/use-ticking";
import { PilotBar } from "./pilot-bar";
import { useAiDriving, useAiModeOpen } from "../../hooks/use-ai-driving";
import { useTeamLeadersEmployeesStore } from "../../state/team-leaders.store";
import { hasRiver } from "../boats/river";
import { LAB_SHARE } from "../projects/labs";
import { AGENTS_A_RACK, agentsOpen } from "../../game/agents";
import { PUMP_HEAD } from "../../game/cooling";
import { MainCard } from "./main-card";
import { SewerCard } from "./sewer-card";
import { RoadCard } from "./road-card";
import { SuggestCard } from "./suggest-card";
import { InfoPop } from "../../ui/InfoPop";
import { INFINITY } from "../../utils/time-utils";
import {
  IconAdjustmentsHorizontal, IconArrowBackUp, IconBackhoe, IconBuildingSkyscraper, IconBulldozer, IconCoin, IconDroplet, IconFlower,
  IconMoodSmile, IconPlant2, IconPlugConnected, IconPointer, IconRoad, IconRobot, IconSubtask, IconTag, IconTree, IconTrees,
} from "@tabler/icons-react";
import { DockBar, DockButton, DockCard, DockTip, DockTool, DockTray, Part, Rule, Slide, usePresence } from "./dock";
import { BuildingThumb } from "./building-thumb";

/** A small line icon, in the current colour. */
const Icon = ({ children }: { children: ReactNode }) => (
  <svg viewBox="0 0 16 16" className="h-3.5 w-3.5 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.5"
    strokeLinecap="round" strokeLinejoin="round" aria-hidden>{children}</svg>
);
const ICONS: Record<string, ReactNode> = {
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
  "no-services": { icon: ICONS.noServices, title: "Nowhere good enough", why: "They only move in somewhere desirable enough: needs met, water or a wonder nearby raise it." },
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
const ROAD_TOOLS = new Set<ToolId>(["paintRoad", "demolish"]);

type IconOf = typeof IconPointer;
const TOOLS: { id: ToolId; label: string; hint: string; tone: string; Icon: IconOf }[] = [
  { id: "inspect", tone: "#8b9bb0", Icon: IconPointer, label: "Look", hint: "Pan and look round the town; click a building to open it" },
  { id: "paintRoad", tone: "#b9a4f2", Icon: IconRoad, label: "Road", hint: "Drag to lay road" },
  { id: "pipe", tone: "#3fa9e0", Icon: IconPlugConnected, label: "Pipe", hint: "Drag from water to the Data Centre or an AI building to lay a water main; or click, click to pin corners, and click the end. Right-click takes a corner back" },
  { id: "sewer", tone: "#b08a5a", Icon: IconSubtask, label: "Sewer", hint: "Drag from water or a processor to lay a sewer underground; from a workplace's slop port to a manhole, a connection. Or click and pin corners. Click one laid to open it" },
  { id: "placeStructure", tone: "#e8a83e", Icon: IconBuildingSkyscraper, label: "Build", hint: "Build beside a road, a park anywhere; drag along a street for a row of lots; click a seaport to upgrade it" },
  { id: "dredge", tone: "#4cc3c0", Icon: IconBackhoe, label: "Dredge", hint: "Drag along a river to deepen it, for bigger ships" },
  { id: "plant", tone: "#62b85f", Icon: IconTree, label: "Plant", hint: "Drag to plant a wood, a row of trees, a hedge or flowers" },
  { id: "demolish", tone: "#e0705a", Icon: IconBulldozer, label: "Demolish", hint: "Click a building to take it down; drag along a road or pipe to delete it, or over trees to fell them" },
];

/** What the Plant tool plants, in its row. @see vegetation/tend */
const PLANT: Record<Planting, [string, IconOf]> = { woods: ["Woods", IconTrees], row: ["Trees", IconTree], hedge: ["Hedge", IconPlant2], bed: ["Flowers", IconFlower] };

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
  // Ports once their project has opened them. @see featureGateOpen
  const ports = all.filter((d) => d.def.port).sort((a, b) => a.price - b.price);
  if (ports.length && featureGateOpen("ports")) out.push({ title: "Ports", colour: 0x4a90c8, items: ports });
  // SLOP PROCESSORS, each kind once its project has opened it. @see game/processors
  const processors = all.filter((d) => { const k = processorKind(d.def.id); return k !== null && featureGateOpen(k); });
  if (processors.length) out.push({ title: "Slop", colour: 0x7a5230, items: processors });
  // FARMS, once the Agritech Lab has opened them, where the ground is one surface and fields can be. @see vegetation/tend
  const farms = all.filter((d) => d.def.id === FARM);
  if (groundMode() === "smooth" && farms.length && featureGateOpen("farms")) out.push({ title: "Land", colour: 0x8a9a3a, items: farms });
  // FLOOD WALLS, once the Climate Lab has opened them, on a map with a river to flood. @see LEVEE
  const walls = all.filter((d) => d.def.id === "levee");
  if (river && walls.length && featureGateOpen("floodwalls")) out.push({ title: "Defences", colour: 0x8a8475, items: walls });
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
  if (def.port) return `${def.port.berths} berth${def.port.berths > 1 ? "s" : ""}`;
  if (def.id === "levee") return "drag along a bank";
  if (def.id === FARM) return "fields around it";
  if (def.id === "lab") return `innovation +${LAB_SHARE * 100}%`;
  if (def.id === "rack") return `${AGENTS_A_RACK} agents · near the Data Centre`;
  if (def.id === "pump") return `lifts water ${PUMP_HEAD / 2} slabs · by the water`;
  if (processorKind(def.id)) return `takes ${PROCESS_RATE} slop a second · by sewer`;
  return "";
}


const hex = (c: number) => `#${c.toString(16).padStart(6, "0")}`;

const BUILD_TONE = "#e8a83e";

export function BuildBar({ className }: { className?: string }) {
  const tool = useWorldStore((s) => s.tool);
  const structureDefId = useWorldStore((s) => s.structureDefId);
  const planting = useWorldStore((s) => s.planting);
  const setPlanting = useWorldStore((s) => s.setPlanting);
  const setTool = useWorldStore((s) => s.setTool);
  const setStructureDef = useWorldStore((s) => s.setStructureDef);
  const setBrush = useWorldStore((s) => s.setBrush);
  const setBrushRadius = useWorldStore((s) => s.setBrushRadius);
  const grid = useWorldStore((s) => s.grid);
  const revision = useWorldStore((s) => s.revision);
  const labels = useWorldStore((s) => s.labels);
  const setLabels = useWorldStore((s) => s.setLabels);
  // AI MODE, a view on The Model's runs: its switch here, and while it drives the tools give way to its bar. @see PilotBar
  const aiMode = useSessionStore((s) => s.aiMode);
  const setAiMode = useSessionStore((s) => s.setAiMode);
  const open = useAiModeOpen();
  const driving = useAiDriving();
  // ITS HANDS ON THE MAP: with any of the desks that build switched off, the tools are the player's again. @see steerAi
  const desksOff = useSessionStore((s) => s.aiDesksOff) ?? [];
  const handsOff = driving && !["town", "landmarks", "water", "harbour"].some((d) => desksOff.includes(d));
  // HANDS OFF, the moment it drives: whatever was in hand is put down. @see useAiDriving
  useEffect(() => {
    if (!handsOff) return;
    const st = useWorldStore.getState();
    st.cancelStroke();
    st.placeProject(null);
    st.setTool("inspect");
    useTeamLeadersEmployeesStore.getState().setPlacing(null);
    setPicking(false);
  }, [handsOff]);
  const money = useMoneyStore((s) => s.money);
  const generators = useGeneratorStore((s) => s.generators);
  const [picking, setPicking] = useState(false);
  const picker = usePresence(picking && !handsOff);
  const plants = usePresence(tool === "plant" && !handsOff);
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
  const moodOverlay = useWorldStore((s) => s.moodOverlay);
  const setMoodOverlay = useWorldStore((s) => s.setMoodOverlay);
  const earningsOverlay = useWorldStore((s) => s.earningsOverlay);
  const setEarningsOverlay = useWorldStore((s) => s.setEarningsOverlay);
  const waterOverlay = useWorldStore((s) => s.waterOverlay);
  const setWaterOverlay = useWorldStore((s) => s.setWaterOverlay);
  const sewerView = useWorldStore((s) => s.sewerView);
  const setSewerView = useWorldStore((s) => s.setSewerView);

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
    setBrush(id === "paintRoad" || id === "pipe" || id === "sewer" || id === "demolish" || id === "dredge" ? "line" : "point");
    // (Planting as what is planted lays out: an area or a line.)
    if (id === "plant") setPlanting(useWorldStore.getState().planting);
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
  // PIPE once there is a Data Centre to cool; SEWER once the vibe coders
  // make slop. @see game/cooling, game/slop
  // (In the `harbour` fixture, from the first: it is where the works are looked at, and it has no Data Centre to wait for.)
  const mainsOpen = agentsOpen() || startFixture() === "harbour";
  const sewersOpen = (generators.find((g) => g.id === "vibe_coder")?.amount ?? 0) >= SLOP_FROM;
  // THE TOOLS ON OFFER, and their keys: 1 to 5, as shown on each. Not while typing in a field, nor with a modifier.
  // DREDGING opens with the first port big enough for a coaster. @see SHIP_CLASSES
  const dredgeOpen = useWorldStore((s) => { void s.revision; for (const b of s.grid.structures.values()) if ((structureDef(b.def)?.port?.berths ?? 0) >= 2 && !b.build) return true; return false; });
  // PLANTING where trees are the fields': on the continuous surface. @see vegetation/fields
  const smooth = groundMode() === "smooth";
  const shown = useMemo(() => TOOLS.filter((t) => (t.id !== "pipe" || mainsOpen) && (t.id !== "sewer" || sewersOpen) && (t.id !== "dredge" || dredgeOpen) && (t.id !== "plant" || smooth)), [mainsOpen, sewersOpen, dredgeOpen, smooth]);
  const keyed = useRef(choose);
  keyed.current = choose;
  const pickingNow = useRef(picking);
  pickingNow.current = picking;
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const el = e.target as HTMLElement | null;
      if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) return;
      // ESCAPE PUTS DOWN: the picker shut first, then the tool in hand for the pointer — not mid-stroke, nor under a dialog.
      if (e.key === "Escape") {
        const st = useWorldStore.getState();
        if (handsOff || st.stroke || document.querySelector('[aria-modal="true"]')) return;
        if (pickingNow.current) { setPicking(false); return; }
        if (st.tool !== "inspect") keyed.current("inspect");
        return;
      }
      const n = Number(e.key);
      if (handsOff || !Number.isInteger(n) || n < 1 || n > shown.length) return;
      e.preventDefault();
      keyed.current(shown[n - 1].id);
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [shown, handsOff]);

  const views = (
    <>
      <DockButton name="Morale" hint="Tint every house by its morale" data-hint="mood" on={moodOverlay} onClick={() => setMoodOverlay(!moodOverlay)}>
        <IconMoodSmile size={18} stroke={1.7} />
      </DockButton>
      <DockButton name="Earnings" hint="Tint every street by what it earns, and list the best" on={earningsOverlay} onClick={() => setEarningsOverlay(!earningsOverlay)}>
        <IconCoin size={18} stroke={1.7} />
      </DockButton>
      {(mainsOpen || sewersOpen) && (
        <DockButton name="Pipes" hint="Every pipe by what it is doing, and a list of them: water or sewers. On too with the Pipe or Sewer tool in hand"
          on={waterOverlay || sewerView || tool === "pipe" || tool === "sewer"}
          onClick={() => { const on = waterOverlay || sewerView; setWaterOverlay(!on && mainsOpen); setSewerView(!on && !mainsOpen); }}>
          <IconDroplet size={18} stroke={1.7} />
        </DockButton>
      )}
      {open && (
        <DockButton name="AI mode" hint="The AI plays the company itself" tone="var(--ui-ai)" on={aiMode} onClick={() => setAiMode({ aiMode: !aiMode })}>
          <IconRobot size={18} stroke={1.7} />
        </DockButton>
      )}
      <DockButton name="Labels" hint="Show or hide what each building is and how it is doing" on={labels} onClick={() => setLabels(!labels)}>
        <IconTag size={18} stroke={1.7} />
      </DockButton>
    </>
  );

  return (
    <div className={twMerge("flex flex-col items-center gap-2 text-fg", className)}>
      <MainCard />
      <SewerCard />
      <RoadCard />
      <SuggestCard />
      <DockTip />
      {/* THE DOCK: its trays and its bar, which the bubble stands over. @see DockTip */}
      <div data-dock-stack className="flex max-w-full flex-col items-center gap-2">
      {picker.shown && (
        // ALL OF IT AT ONCE: a row a section, a card a thing, its picture and its price.
        <DockTray from='[data-tool="placeStructure"]' tone={BUILD_TONE} leaving={picker.leaving}
          className="dock-scroll flex-col gap-2 max-sm:max-h-[50vh] max-sm:overflow-y-auto">
          {(() => { let i = 0; return sale.map((sec) => (
            <Part key={sec.title} className="border-l-0 px-1"
              title={<span className="flex items-center gap-1.5">{sec.colour !== undefined && <span className="size-2 shrink-0" style={{ background: hex(sec.colour) }} />}{sec.title}</span>}>
              <div className="flex flex-wrap gap-1.5 sm:flex-nowrap">
                {sec.items.map(({ def, price }) => {
                  const afford = money.gte(price);
                  const on = def.id === structureDefId;
                  const home = !!housedBy(def.id);
                  return (
                    <DockCard key={def.id} on={on} i={i++} title={`${saleName(def)} · ${def.footprint.w}×${def.footprint.h}`}
                      onClick={() => { setStructureDef(def.id); setPicking(false); }}
                      className={twMerge("flex w-44 items-center gap-2 p-1 pr-2 text-xs", !afford && !on && "text-fg-muted")}>
                      <span className={twMerge("grid size-9 shrink-0 place-items-center overflow-hidden transition-[opacity,transform] duration-200 group-hover:scale-110", !afford && "opacity-55")}>
                        <BuildingThumb def={def} home={home} colour={home ? sec.colour : undefined} className="size-9" />
                      </span>
                      <span className="flex min-w-0 flex-1 flex-col">
                        <span className="flex items-baseline justify-between gap-1">
                          <b className="truncate font-display text-[11px] font-normal tracking-[0.1em] uppercase">{tileName(def)}</b>
                          <span className={twMerge("font-mono text-[11px] tabular-nums", afford ? "text-money" : "text-bad")}>{formatCurrency(price)}</span>
                        </span>
                        <span className="truncate text-[10px] text-fg-muted">{tileNote(def)}</span>
                        {/* HOW NEAR: what there is of its price, while it is out of reach. */}
                        {!afford && (
                          <span aria-hidden className="mt-0.5 h-0.5 overflow-hidden bg-line-quiet">
                            <span className="block h-full origin-left bg-tone transition-transform duration-500" style={{ transform: `scaleX(${Math.min(1, Math.max(0, money.toNumber() / price))})` }} />
                          </span>
                        )}
                      </span>
                    </DockCard>
                  );
                })}
              </div>
            </Part>
          )); })()}
        </DockTray>
      )}
      {plants.shown && (
        // WHAT THE PLANT TOOL PLANTS. @see vegetation/tend
        <DockTray from='[data-tool="plant"]' tone="#62b85f" leaving={plants.leaving}>
          <div className="flex gap-1">
            {PLANTINGS.map((what, i) => {
              const [name, Icon] = PLANT[what], on = planting === what;
              return (
                <DockCard key={what} on={on} i={i} onClick={() => setPlanting(what)}
                  className={twMerge("flex h-8 items-center gap-1.5 px-2.5 font-display text-[10px] tracking-[0.14em] uppercase", on ? "text-fg" : "text-fg-muted group-hover:text-fg")}>
                  <Icon size={16} stroke={1.6} className={twMerge("transition-colors", on ? "text-tone" : "group-hover:text-tone")} />{name}
                </DockCard>
              );
            })}
          </div>
        </DockTray>
      )}

      <DockBar ai={driving} aria-label="build tools">
        {/* THE PEOPLE: a chip a district, its figures as icons. @see Stat */}
        {KINDS.some((id) => hireable.has(id)) && <><div className="flex shrink-0 items-center gap-3 px-1.5 font-mono text-[11px] tabular-nums">
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
                <span className="size-1.5" style={{ background: hex(KIND_COLOUR[id]) }} />
                <Stat icon={ICONS.people} value={`${g.amount}/${have === Infinity ? INFINITY : have}`} tone={full ? "text-bad" : undefined}
                  title={`${name}: ${g.amount} employed, ${have === Infinity ? INFINITY : have} beds`}>
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
        </div><Rule /></>}

        {/* THE TOOLS: a rail that scrolls, on a phone. */}
        <div className="dock-scroll flex min-w-0 items-center max-md:overflow-x-auto">
          {/* UNDER AI MODE, no tools: what the pilot is doing, and a pause. @see PilotBar */}
          {driving && <PilotBar className="flex-1 md:w-[34rem]" />}
          {!handsOff && (<>
          <Slide>
          {shown.map((t, k) => {
            const on = tool === t.id;
            return (
              <DockTool key={t.id} name={t.label} tone={t.tone} k={String(k + 1)} on={on} onClick={() => choose(t.id)}
                hint={aiRoads && ROAD_TOOLS.has(t.id) ? `${t.hint} — outside the AI's district: its streets are its own now` : t.hint}
                label={t.id === "placeStructure" && chosen && on ? saleName(chosen.def) : undefined}
                aria-keyshortcuts={String(k + 1)} data-tool={t.id} data-hint={t.id === "placeStructure" ? "build" : undefined}>
                <t.Icon size={18} stroke={1.7} />
              </DockTool>
            );
          })}
          </Slide>
          {/* THE AI IS BUILDING: its latest memo on hover. @see stepAi */}
          {aiBuilding && (
            <span title={aiMemo ?? "The AI is working on the town."} aria-label="The AI is building" className="grid size-9 shrink-0 place-items-center">
              <span className="size-1.5 animate-pulse bg-ai" />
            </span>
          )}
          {canUndo && (
            <DockTool name="Undo" label={`+${formatCurrency(lastBuild!.refund)}`} always hint="Take back the last build and get its money back"
              tone="var(--ui-warn)" on={false} onClick={undoLastBuild} className="text-warn"
              meter={<span key={lastBuild!.at} aria-hidden className="absolute inset-x-2 -bottom-px h-px origin-left bg-tone"
                style={{ animation: `dock-drain ${Math.max(0, lastBuild!.at + UNDO_WINDOW_MS - Date.now())}ms linear forwards` }} />}>
              <IconArrowBackUp size={18} stroke={1.7} />
            </DockTool>
          )}
          </>)}
          {/* VIEWS from here: what you see, not what you hold — on a phone, behind a button. */}
          <Rule />
          {phone ? (
            <DockButton name="Views" hint="What the map shows" aria-expanded={viewsOpen} on={viewsOpen} onClick={() => setViewsOpen(!viewsOpen)}>
              <IconAdjustmentsHorizontal size={18} stroke={1.7} />
            </DockButton>
          ) : views}
          {phone && viewsOpen && views}
        </div>
      </DockBar>
      </div>
    </div>
  );
}
