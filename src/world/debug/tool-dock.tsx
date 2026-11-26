/**
 * World v2 editor — THE TOOL BAR, along the bottom of the map.
 *
 * Two storeys. The bar itself never changes: the groups of tools, undo and redo, the game's rules, and the panels.
 * Over it the TRAY of the group in hand: its tools, what they paint with, and the brush they share. Clicking the
 * group in hand again shuts the tray and leaves the tool.
 *
 * What there is comes from the toolbox, as the keys do. @see edit/toolbox
 */
import {
  IconAdjustmentsHorizontal, IconBuildingCommunity, IconFlask, IconFolder, IconArrowBackUp, IconArrowBigDownLines, IconArrowBigUpLines, IconArrowForwardUp,
  IconBackhoe, IconBrush, IconBuildingMonument, IconBuildingSkyscraper, IconBulldozer, IconDroplet, IconDropletOff,
  IconEraser, IconFlower, IconFountain, IconLine, IconMap, IconMountain, IconPlayerPlayFilled, IconPlugConnected, IconPoint,
  IconPointer, IconRipple, IconRoad, IconRoadOff, IconSearch, IconShip, IconSquareDashed, IconStairs, IconStairsDown,
  IconSubtask, IconTree, IconTrees, IconWaveSine, IconArrowBarToDown, IconMinus, IconPlant2,
} from "@tabler/icons-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { twMerge } from "tailwind-merge";
import { useShallow } from "zustand/shallow";

import { startFixture, useWorldStore, VOID_MATERIAL } from "../../state/world.store";
import { GROUPS, TOOLS, groupOf, pickGroup, pickTool, type GroupId } from "../edit/toolbox";
import type { BrushId, ToolId } from "../edit/tools";
import { workplaceKind } from "../agents/commute";
import { processorKind } from "../../game/processors";
import { housedBy } from "../../game/housing";
import { useLandmarkPicture } from "../play/landmark-picture";
import { KIND_COLOUR } from "../play/building-info";
import { allStructureDefs, type StructureDef } from "../structures/def";
import { TERRAIN_NAMES, terrainName } from "../terrain-names";
import { PLANTINGS, type Planting } from "../vegetation/tend";
import { fluidChoices } from "../water/materials";
import { Beds, Networks, Sources, WaterMeta } from "./edit-panel";
import type { PanelId } from "./editor-panels";
import { FIXTURES, fixtureAddress, type FixtureKind } from "./fixture-list";
import { FIXTURE_SIZE } from "./fixtures";
import { Part, Rule, Tip, toned } from "../play/dock";

type IconOf = typeof IconBrush;
const TOOL_ICON: Partial<Record<ToolId, IconOf>> = {
  inspect: IconPointer, paintTerrain: IconBrush, erase: IconEraser, raise: IconArrowBigUpLines, lower: IconArrowBigDownLines,
  flatten: IconMinus, smooth: IconWaveSine, paintRoad: IconRoad, eraseRoad: IconRoadOff, slope: IconStairs, unslope: IconStairsDown,
  pourWater: IconDroplet, drainWater: IconDropletOff, spring: IconFountain, sink: IconArrowBarToDown, pipe: IconPlugConnected,
  sewer: IconSubtask, dredge: IconBackhoe, boat: IconShip, plant: IconTree, placeStructure: IconBuildingSkyscraper, demolish: IconBulldozer,
};
const GROUP_ICON: Record<GroupId, IconOf> = {
  look: IconPointer, land: IconMountain, roads: IconRoad, water: IconRipple, nature: IconTrees, build: IconBuildingSkyscraper,
};
const PLANT: Record<Planting, [string, IconOf]> = {
  woods: ["Woods", IconTrees], row: ["Trees", IconTree], hedge: ["Hedge", IconPlant2], bed: ["Flowers", IconFlower],
};
const BRUSH: [BrushId, string, IconOf, string][] = [
  ["point", "Freehand", IconPoint, "1"], ["rect", "Area", IconSquareDashed, "2"], ["line", "Line", IconLine, "3"],
];
/** The ground's swatch: its colour, and something of its grain. */
const GROUND: Record<string, [string, string]> = {
  grass: ["#6f9a4b", "#5d863e"], dirt: ["#8a6444", "#755237"], sand: ["#dcc98f", "#cbb679"],
  wood1: ["#5f8c4b", "#34602f"], wood2: ["#527f42", "#2a5427"], wood3: ["#456f39", "#21471f"],
};
const GROUND_NAME: Record<string, string> = { wood1: "Light wood", wood2: "Wood", wood3: "Deep wood" };

const GLASS = "border border-line bg-surface-0/85 backdrop-blur-xl";
const TRAY = twMerge("dock-tray-in pointer-events-auto flex max-w-full rounded-2xl p-2.5", GLASS);
const FOCUS = "outline-none focus-visible:ring-2 focus-visible:ring-tone";

/** A tool: a tile with its picture and name, lit in its group's colour while it is in hand. */
function ToolTile({ id }: { id: ToolId }) {
  const on = useWorldStore((s) => s.tool === id), t = TOOLS[id]!, Icon = TOOL_ICON[id] ?? IconBrush;
  return (
    <button type="button" aria-pressed={on} aria-label={t.name} onClick={() => pickTool(id)}
      className={twMerge("group/tip relative flex h-14 w-15 cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border text-[11px] transition-all duration-150 active:scale-95", FOCUS,
        on ? "border-tone bg-tone-fill text-fg" : "border-transparent text-fg-muted hover:bg-surface-2 hover:text-fg")}>
      <Icon size={20} stroke={1.7} className={on ? "text-tone" : undefined} />
      {t.name}
      {t.key && <span className="absolute top-0.5 right-1 font-mono text-[9px] text-fg-faint">{t.key.toUpperCase()}</span>}
      <Tip name={t.name} hint={t.hint} k={t.key} />
    </button>
  );
}

/** One of a few, in a run of them. */
function Choice({ on, onClick, name, k, children, wide }: { on: boolean; onClick: () => void; name: string; k?: string; children: ReactNode; wide?: boolean }) {
  return (
    <button type="button" aria-pressed={on} aria-label={name} onClick={onClick}
      className={twMerge("group/tip relative flex h-7 cursor-pointer items-center justify-center gap-1.5 rounded-lg px-2 text-[11px] transition-colors", !wide && "w-9 px-0", FOCUS,
        on ? "bg-tone-fill text-fg shadow-[inset_0_0_0_1px_var(--tone)]" : "text-fg-muted hover:bg-surface-3 hover:text-fg")}>
      {children}
      {!wide && <Tip name={name} k={k} />}
    </button>
  );
}
const Run = ({ children }: { children: ReactNode }) => <div className="flex w-max items-center gap-0.5 rounded-xl bg-surface-1 p-0.5">{children}</div>;

/** THE BRUSH: its shape, and its size drawn to scale. */
function BrushPart() {
  const { brush, radius, setBrush, setRadius } = useWorldStore(useShallow((s) => ({ brush: s.brush, radius: s.brushRadius, setBrush: s.setBrush, setRadius: s.setBrushRadius })));
  return (
    <Part title="Brush" note={`${radius * 2 + 1}×${radius * 2 + 1}`}>
      <div className="flex flex-col gap-0.5">
        <Run>{BRUSH.map(([id, name, Icon, k]) => <Choice key={id} name={name} k={k} on={brush === id} onClick={() => setBrush(id)}><Icon size={17} stroke={1.8} /></Choice>)}</Run>
        <Run>
          {[0, 1, 2, 3, 4].map((r) => (
            <button key={r} type="button" aria-label={`${r * 2 + 1}×${r * 2 + 1}`} aria-pressed={radius === r} onClick={() => setRadius(r)}
              className={twMerge("group/tip relative grid h-6 w-[21.6px] cursor-pointer place-items-center rounded-lg hover:bg-surface-3", FOCUS)}>
              <span className={twMerge("rotate-45 rounded-[2px] transition-colors", radius === r ? "bg-tone" : "bg-fg-faint")} style={{ width: 4 + r * 2.4, height: 4 + r * 2.4 }} />
              <Tip name={`${r * 2 + 1}×${r * 2 + 1}`} k="[ ]" />
            </button>
          ))}
        </Run>
      </div>
    </Part>
  );
}

/** A patch of colour to paint with. */
function Swatch({ on, onClick, name, colours }: { on: boolean; onClick: () => void; name: string; colours: [string, string] }) {
  return (
    <button type="button" aria-pressed={on} aria-label={name} onClick={onClick} className={twMerge("group/tip relative flex w-17 cursor-pointer flex-col items-center gap-1 rounded-xl text-[10px]", FOCUS, on ? "text-fg" : "text-fg-muted hover:text-fg")}>
      <span className={twMerge("relative h-9 w-full overflow-hidden rounded-xl border-2 transition-all", on ? "border-tone" : "border-transparent group-hover/tip:border-line-strong")}
        style={{ background: `radial-gradient(circle at 25% 30%, ${colours[1]} 0 14%, transparent 15%), radial-gradient(circle at 70% 65%, ${colours[1]} 0 18%, transparent 19%), radial-gradient(circle at 85% 20%, ${colours[1]} 0 9%, transparent 10%), linear-gradient(160deg, ${colours[0]}, ${colours[1]})` }} />
      <span className="max-w-full truncate">{name}</span>
    </button>
  );
}

function GroundPart() {
  const { material, palette, setMaterial } = useWorldStore(useShallow((s) => ({ material: s.material, palette: s.palette, setMaterial: s.setMaterial })));
  return (
    <Part title="Ground">
      <div className="flex gap-1">
        {palette.map((frame, i) => {
          if (i === VOID_MATERIAL) return null;
          const n = (frame && terrainName(frame)) ?? frame ?? "?";
          return (
            <Swatch key={i} on={material === i} colours={GROUND[n] ?? ["#8a8475", "#6d685b"]}
              name={GROUND_NAME[n] ?? ((TERRAIN_NAMES as readonly string[]).includes(n) ? n[0].toUpperCase() + n.slice(1) : n.replace(/^[A-Za-z]+_/, "").replace(/\.png$/, ""))}
              onClick={() => { setMaterial(i); if (useWorldStore.getState().tool !== "paintTerrain") pickTool("paintTerrain"); }} />
          );
        })}
      </div>
    </Part>
  );
}

function HeightPart() {
  const { step, setStep } = useWorldStore(useShallow((s) => ({ step: s.heightStep, setStep: s.setHeightStep })));
  return (
    <Part title="Step">
      <Run>
        <Choice wide name="half a step" on={step === 1} onClick={() => setStep(1)}>½</Choice>
        <Choice wide name="a step" on={step === 2} onClick={() => setStep(2)}>1</Choice>
        <Choice wide name="two steps" on={step === 4} onClick={() => setStep(4)}>2</Choice>
      </Run>
    </Part>
  );
}

const css = (c: number) => `#${c.toString(16).padStart(6, "0")}`;
function FluidPart() {
  const { fluid, setFluid, openEdge, setOpenEdge } = useWorldStore(useShallow((s) => ({ fluid: s.fluidMaterial, setFluid: s.setFluidMaterial, openEdge: s.openEdge, setOpenEdge: s.setOpenEdge })));
  return (
    <>
      <Part title="Fluid">
        <div className="flex gap-1">
          {fluidChoices().map(({ index, material }) => (
            <Swatch key={index} on={fluid === index} name={material.name[0].toUpperCase() + material.name.slice(1)} onClick={() => setFluid(index)}
              colours={[css(material.colour), `color-mix(in oklab, ${css(material.colour)} 70%, black)`]} />
          ))}
        </div>
      </Part>
      <Part title="Map edge">
        <Run>
          <Choice wide name="open" on={openEdge} onClick={() => setOpenEdge(true)}>Open</Choice>
          <Choice wide name="walled" on={!openEdge} onClick={() => setOpenEdge(false)}>Walled</Choice>
        </Run>
      </Part>
    </>
  );
}
const WaterNote = () => <><WaterMeta /><Sources /></>;

function PlantPart() {
  const { planting, setPlanting } = useWorldStore(useShallow((s) => ({ planting: s.planting, setPlanting: s.setPlanting })));
  return (
    <div className="flex gap-1">
      {PLANTINGS.map((p) => {
        const [name, Icon] = PLANT[p], on = planting === p;
        return (
          <button key={p} type="button" aria-pressed={on} onClick={() => setPlanting(p)}
            className={twMerge("flex h-14 w-18 cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border text-[11px] transition-all active:scale-95", FOCUS,
              on ? "border-tone bg-tone-fill text-fg" : "border-transparent text-fg-muted hover:bg-surface-2 hover:text-fg")}>
            <Icon size={21} stroke={1.6} className={on ? "text-tone" : undefined} />{name}
          </button>
        );
      })}
    </div>
  );
}

/** What a building is for, for the picker's tabs: the first that says yes. */
const KINDS: [string, (d: StructureDef) => boolean][] = [
  ["Homes", (d) => d.render.kind === "tiles" || housedBy(d.id) !== null],
  ["Work", (d) => workplaceKind(d.id) !== null || ["lab", "rack", "gpu-farm"].includes(d.id)],
  ["Services", (d) => ["cafe", "club", "coworking", "cinema", "doctor", "climbing", "gym", "park"].includes(d.id)],
  ["Ports", (d) => !!d.port || d.id === "harbour"],
  ["Industry", (d) => processorKind(d.id) !== null || ["farm", "pump", "levee", "derelict"].includes(d.id)],
  ["AI", (d) => ["ai-node", "compute-spire", "drone-hangar", "monolith", "lattice"].includes(d.id)],
  ["Landmarks", () => true],
];
const kindOf = (d: StructureDef) => KINDS.find(([, is]) => is(d))![0];
const NAMES: Record<string, string> = { intern: "Intern", vibe_coder: "Vibe coder", "10x_dev": "10x dev" };
/** A building's name; a home's kit by whose it is and how grown. */
function nameOf(d: StructureDef): string {
  const m = /^(intern|vibe_coder|10x_dev)\.(t(\d)|landmark)$/.exec(d.name);
  return m ? `${NAMES[m[1]]} ${m[3] ? Number(m[3]) + 1 : "★"}` : d.name[0].toUpperCase() + d.name.slice(1);
}

/** A home, as a little block in its district's colour: as many floors as it is grown. */
function Block({ def }: { def: StructureDef }) {
  const m = /^(intern|vibe_coder|10x_dev)\.(?:t(\d)|landmark)$/.exec(def.name);
  const n = m ? (m[2] ? Number(m[2]) + 2 : 5) : 2, hh = 5, c = css(KIND_COLOUR[(m?.[1] ?? "intern") as keyof typeof KIND_COLOUR] ?? 0x8a8475), h = n * hh;
  return (
    <svg viewBox="0 0 44 44" className="h-10 w-11" aria-hidden>
      <g transform={`translate(22 ${34 - h})`} stroke="rgb(0 0 0 / .35)" strokeWidth=".6">
        <path d={`M-14 0 L0 7 V${7 + h} L-14 ${h} Z`} fill={`color-mix(in oklab, ${c} 78%, black)`} />
        <path d={`M14 0 L0 7 V${7 + h} L14 ${h} Z`} fill={`color-mix(in oklab, ${c} 55%, black)`} />
        <path d="M0 -7 L14 0 L0 7 L-14 0 Z" fill={`color-mix(in oklab, ${c} 85%, white)`} />
        {Array.from({ length: n }, (_, i) => <path key={i} stroke="rgb(255 244 200 / .75)" strokeWidth="1.4" strokeDasharray="2.5 2.2" d={`M-12 ${4 + i * hh} L-2 ${9 + i * hh} M2 ${9 + i * hh} L12 ${4 + i * hh}`} />)}
      </g>
    </svg>
  );
}
function Picture({ def }: { def: StructureDef }) {
  const url = useLandmarkPicture(def.id);
  return url ? <img src={url} alt="" draggable={false} className="h-10 w-full object-contain" /> : <IconBuildingMonument size={26} stroke={1.2} className="h-10 text-fg-faint" />;
}

/** The head of a picker: what to find, and its tabs. */
function PickerHead<T extends string>({ tabs, tab, setTab, find, setFind, what }: { tabs: readonly T[]; tab: T; setTab: (t: T) => void; find: string; setFind: (s: string) => void; what: string }) {
  return (
    <div className="flex min-w-0 items-center gap-1">
      <label className="flex h-6 shrink-0 items-center gap-1 rounded-lg bg-surface-1 px-2 text-fg-muted focus-within:shadow-[inset_0_0_0_1px_var(--tone)]">
        <IconSearch size={13} />
        <input value={find} onChange={(e) => setFind(e.target.value)} onKeyDown={(e) => { if (e.key === "Escape") { setFind(""); e.currentTarget.blur(); } }}
          aria-label={what} className="w-20 bg-transparent text-[11px] text-fg outline-none" />
      </label>
      <div className="dock-scroll flex min-w-0 gap-0.5 overflow-x-auto">
        {tabs.map((k) => (
          <button key={k} type="button" aria-pressed={!find.trim() && tab === k} onClick={() => { setFind(""); setTab(k); }}
            className={twMerge("h-6 cursor-pointer rounded-lg px-2 text-[11px] whitespace-nowrap", FOCUS, !find.trim() && tab === k ? "bg-tone-fill text-fg" : "text-fg-muted hover:bg-surface-2 hover:text-fg")}>{k}</button>
        ))}
      </div>
    </div>
  );
}
/** And its row, which a wheel runs along. */
const PickerRow = ({ children }: { children: ReactNode }) => (
  <div className="dock-scroll flex gap-1 overflow-x-auto overflow-y-hidden pb-1" onWheel={(e) => { if (!e.deltaX) e.currentTarget.scrollLeft += e.deltaY; }}>{children}</div>
);
const CARD = "relative flex h-[68px] w-21 shrink-0 cursor-pointer flex-col items-center justify-end gap-0.5 rounded-xl border px-1 pb-1 text-[10px] transition-all active:scale-95";
const CARD_ON = "border-tone bg-tone-fill text-fg", CARD_OFF = "border-line-quiet bg-surface-1 text-fg-muted hover:border-line-strong hover:text-fg";

function BuildPart() {
  const { chosen, setChosen, tool } = useWorldStore(useShallow((s) => ({ chosen: s.structureDefId, setChosen: s.setStructureDef, tool: s.tool })));
  // (Homes by whose they are, then how grown: the table has them in neither order.)
  const defs = useMemo(() => { const at = (d: StructureDef) => Object.keys(NAMES).findIndex((k) => d.name.startsWith(`${k}.`)); return [...allStructureDefs()].sort((a, b) => at(a) < 0 || at(b) < 0 ? 0 : at(a) - at(b) || Number(a.name.endsWith("landmark")) - Number(b.name.endsWith("landmark")) || a.name.localeCompare(b.name)); }, []);
  const [tab, setTab] = useState(() => { const d = defs.find((x) => x.id === chosen); return d ? kindOf(d) : "Homes"; });
  const [find, setFind] = useState("");
  const q = find.trim().toLowerCase();
  const shown = defs.filter((d) => (q ? nameOf(d).toLowerCase().includes(q) || d.id.includes(q) : kindOf(d) === tab));
  return (
    <Part title="Buildings" note={<Beds />} className="w-[46rem] shrink">
      <PickerHead tabs={KINDS.map(([k]) => k)} tab={tab} setTab={setTab} find={find} setFind={setFind} what="find a building" />
      <PickerRow>
        {shown.map((d) => {
          const on = chosen === d.id && tool === "placeStructure";
          return (
            <button key={d.id} type="button" aria-pressed={on} title={`${nameOf(d)} · ${d.footprint.w}×${d.footprint.h}`}
              onClick={() => { setChosen(d.id); pickTool("placeStructure"); }}
              className={twMerge(CARD, FOCUS, on ? CARD_ON : CARD_OFF)}>
              {d.render.kind === "tiles" ? <Block def={d} /> : <Picture def={d} />}
              <span className="max-w-full truncate">{nameOf(d)}</span>
              <span className="absolute top-0.5 right-1 font-mono text-[9px] text-fg-faint">{d.footprint.w}×{d.footprint.h}</span>
            </button>
          );
        })}
      </PickerRow>
    </Part>
  );
}

const FIXTURE_TONE = "#e0709a";
const FIXTURE_ICON: Record<FixtureKind, IconOf> = {
  Towns: IconBuildingCommunity, Water: IconRipple, Harbours: IconShip, Roads: IconRoad, Land: IconMountain, Works: IconSubtask,
};
const FIXTURE_KINDS = Object.keys(FIXTURES) as FixtureKind[];

/** THE FIXTURES, to open one; and from one, the editor's own map again. @see fixtureAddress */
function FixtureTray() {
  const now = startFixture();
  const [tab, setTab] = useState<FixtureKind>(() => FIXTURE_KINDS.find((k) => FIXTURES[k].some(([id]) => id === now)) ?? "Towns");
  const [find, setFind] = useState("");
  const q = find.trim().toLowerCase();
  const shown = FIXTURE_KINDS.flatMap((k) => FIXTURES[k].filter(([id, name]) => (q ? name.toLowerCase().includes(q) || id.toLowerCase().includes(q) : k === tab)).map(([id, name]) => ({ id, name, Icon: FIXTURE_ICON[k] })));
  return (
    <div style={toned(FIXTURE_TONE)} className={twMerge(TRAY, "max-xl:overflow-x-auto")}>
      <Part title="Fixtures" className="w-[46rem] shrink">
        <PickerHead tabs={FIXTURE_KINDS} tab={tab} setTab={setTab} find={find} setFind={setFind} what="find a fixture" />
        <PickerRow>
          {now && !q && (
            <button type="button" onClick={() => location.assign(fixtureAddress(location.href, null))} className={twMerge(CARD, FOCUS, CARD_OFF, "border-dashed")}>
              <IconFolder size={24} stroke={1.5} className="mb-1.5" /><span>My map</span>
            </button>
          )}
          {shown.map(({ id, name, Icon }) => {
            const on = id === now;
            return (
              <button key={id} type="button" aria-label={name} aria-pressed={on} onClick={() => location.assign(fixtureAddress(location.href, id))} className={twMerge(CARD, FOCUS, on ? CARD_ON : CARD_OFF)}>
                <Icon size={24} stroke={1.5} className={twMerge("mb-1.5", on && "text-tone")} />
                <span className="max-w-full truncate">{name}</span>
                {FIXTURE_SIZE[id] && <span className="absolute top-0.5 right-1 font-mono text-[9px] text-fg-faint">{FIXTURE_SIZE[id]}²</span>}
              </button>
            );
          })}
        </PickerRow>
      </Part>
    </div>
  );
}

/** THE TRAY: the tools of the group in hand, and what they paint with. */
function Tray({ id }: { id: GroupId }) {
  const tool = useWorldStore((s) => s.tool), g = GROUPS.find((x) => x.id === id)!;
  const tools = <div className="flex gap-0.5">{g.tools.map((t) => <ToolTile key={t} id={t} />)}</div>;
  return (
    <div key={id} style={toned(g.tone)} className={twMerge(TRAY,
      // (Bubbles stand out over its top, so nothing may clip it but a window too narrow.)
      "dock-scroll max-xl:overflow-x-auto")}>
      <Part title={g.name} note={id === "roads" ? <Networks /> : id === "water" ? <WaterNote /> : undefined}>{id === "nature" ? <PlantPart /> : tools}</Part>
      {id === "land" && <GroundPart />}
      {(tool === "raise" || tool === "lower") && <HeightPart />}
      {id === "water" && <FluidPart />}
      {id === "build" && <BuildPart />}
      {TOOLS[tool]?.takes === "brush" && <BrushPart />}
    </div>
  );
}

/** A button of the bar's own: undo, a panel, the rules. */
function BarButton({ on, dead, onClick, name, k, hint, tone, children }: { on?: boolean; dead?: boolean; onClick: () => void; name: string; k?: string; hint?: string; tone?: string; children: ReactNode }) {
  return (
    <button type="button" aria-label={name} aria-pressed={on} disabled={dead} onClick={onClick} style={toned(tone ?? "var(--ui-console)")}
      className={twMerge("group/tip relative grid size-10 shrink-0 place-items-center rounded-xl transition-all", FOCUS,
        dead ? "text-fg-faint opacity-40" : "cursor-pointer active:scale-90", !dead && (on ? "bg-tone-fill text-tone" : "text-fg-muted hover:bg-surface-2 hover:text-fg"))}>
      {children}
      <Tip name={name} k={k} hint={hint} />
    </button>
  );
}
function History() {
  const { undoDepth, redoDepth, undoName, redoName, doUndo, doRedo } = useWorldStore(useShallow((s) => ({
    undoDepth: s.undoDepth, redoDepth: s.redoDepth, undoName: s.undoName, redoName: s.redoName, doUndo: s.doUndo, doRedo: s.doRedo,
  })));
  return (
    <>
      <BarButton name="Undo" k="⌘Z" hint={undoName ?? undefined} dead={!undoDepth} onClick={doUndo}><IconArrowBackUp size={20} /></BarButton>
      <BarButton name="Redo" k="⇧⌘Z" hint={redoName ?? undefined} dead={!redoDepth} onClick={doRedo}><IconArrowForwardUp size={20} /></BarButton>
    </>
  );
}
/** Where the pointer is on the map: its own, since it moves with every move of the mouse. */
function Hover() {
  const hover = useWorldStore((s) => s.hover);
  return <span className={twMerge("w-16 text-center font-mono text-[11px] tabular-nums max-xl:hidden", hover ? "text-fg-muted" : "text-fg-faint")}>{hover ? `${hover.x}, ${hover.y}` : "—"}</span>;
}

export function ToolDock({ panel, setPanel }: { panel: PanelId | null; setPanel: (p: PanelId | null) => void }) {
  const tool = useWorldStore((s) => s.tool), playing = useWorldStore((s) => s.playing), setPlaying = useWorldStore((s) => s.setPlaying);
  const g = groupOf(tool);
  const [shut, setShut] = useState(false);
  const [fixtures, setFixtures] = useState(false);
  // A tool from another group, picked by its key, opens the tray it is in.
  const [was, setWas] = useState(g.id);
  if (was !== g.id) { setWas(g.id); setShut(false); setFixtures(false); }
  // Shift and 7, after the groups' own: the fixtures.
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      if (e.shiftKey && e.code === "Digit7" && !e.metaKey && !e.ctrlKey && !e.altKey) { e.preventDefault(); setFixtures((f) => !f); }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);
  const toggle = (p: PanelId) => setPanel(panel === p ? null : p);
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-3 z-20 flex flex-col items-center gap-2 px-3 text-fg select-none">
      {fixtures ? <FixtureTray /> : !shut && g.id !== "look" && <Tray id={g.id} />}
      <div className={twMerge("pointer-events-auto flex max-w-full items-center rounded-2xl p-1.5", GLASS)} role="toolbar" aria-label="map tools">
        <History />
        <Rule />
        {GROUPS.map((x) => {
          const on = x.id === g.id, Icon = GROUP_ICON[x.id];
          return (
            <button key={x.id} type="button" aria-label={x.name} aria-pressed={on} style={toned(x.tone)}
              onClick={() => { if (fixtures) { setFixtures(false); setShut(false); if (!on) pickGroup(x.id); } else if (on) setShut(!shut); else pickGroup(x.id); }}
              className={twMerge("group/tip relative flex h-12 w-16 cursor-pointer flex-col items-center justify-center gap-0.5 rounded-xl text-[11px] transition-all duration-150 active:scale-95 max-md:w-11", FOCUS,
                on ? "-translate-y-0.5 bg-tone-fill text-fg" : "text-fg-muted hover:-translate-y-0.5 hover:bg-surface-2 hover:text-fg")}>
              <Icon size={21} stroke={1.7} className={on ? "text-tone" : "transition-colors group-hover/tip:text-tone"} />
              <span className="max-md:hidden">{x.name}</span>
              <span className={twMerge("absolute -bottom-px h-0.5 rounded-full bg-tone transition-all duration-200", on ? "w-8" : "w-0")} />
              {(shut || fixtures || x.id === "look" || !on) && <Tip name={x.name} k={`⇧${x.key}`} />}
            </button>
          );
        })}
        <Rule />
        <BarButton name="Play rules" hint="Housing needs a road and costs money; the night falls" on={playing} onClick={() => setPlaying(!playing)}><IconPlayerPlayFilled size={17} /></BarButton>
        <BarButton name="Fixtures" k="⇧7" tone={FIXTURE_TONE} on={fixtures} onClick={() => setFixtures(!fixtures)}><IconFlask size={20} /></BarButton>
        <BarButton name="View" on={panel === "view"} onClick={() => toggle("view")}><IconAdjustmentsHorizontal size={20} /></BarButton>
        <BarButton name="Map" on={panel === "map"} onClick={() => toggle("map")}><IconMap size={20} /></BarButton>
        <Hover />
      </div>
    </div>
  );
}
