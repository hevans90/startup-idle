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
  IconAdjustmentsHorizontal, IconArrowBackUp, IconArrowBigDownLines, IconArrowBigUpLines, IconArrowForwardUp,
  IconBackhoe, IconBrush, IconBuildingMonument, IconBuildingSkyscraper, IconBulldozer, IconDroplet, IconDropletOff,
  IconEraser, IconFlower, IconFountain, IconLine, IconMap, IconMountain, IconPlayerPlayFilled, IconPlugConnected, IconPoint,
  IconPointer, IconRipple, IconRoad, IconRoadOff, IconSearch, IconShip, IconSquareDashed, IconStairs, IconStairsDown,
  IconSubtask, IconTree, IconTrees, IconWaveSine, IconArrowBarToDown, IconMinus, IconPlant2,
} from "@tabler/icons-react";
import { useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { twMerge } from "tailwind-merge";
import { useShallow } from "zustand/shallow";

import { useWorldStore, VOID_MATERIAL } from "../../state/world.store";
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

const GLASS = "border border-line bg-surface-0/85 shadow-2xl backdrop-blur-xl";
const FOCUS = "outline-none focus-visible:ring-2 focus-visible:ring-tone";
const toned = (tone: string) => ({ "--tone": tone }) as CSSProperties;

/** A bubble over what is hovered: what it is, its key, and what it does. */
function Tip({ name, hint, k }: { name: string; hint?: string; k?: string }) {
  return (
    <span role="tooltip" className="pointer-events-none absolute bottom-full left-1/2 z-30 mb-2 w-max max-w-52 -translate-x-1/2 translate-y-1 rounded-lg border border-line bg-surface-1 px-2.5 py-1.5 text-left text-[11px] leading-snug text-fg opacity-0 shadow-xl transition-all delay-0 duration-100 group-hover/tip:translate-y-0 group-hover/tip:opacity-100 group-hover/tip:delay-300 group-focus-visible/tip:opacity-100">
      <span className="flex items-center gap-2 font-semibold">{name}{k && <Key k={k} />}</span>
      {hint && <span className="mt-0.5 block text-fg-muted">{hint}</span>}
    </span>
  );
}
const Key = ({ k }: { k: string }) => <kbd className="rounded border border-line bg-surface-2 px-1 font-mono text-[10px] leading-4 text-fg-muted">{k.toUpperCase()}</kbd>;

/** A heading over a part of the tray, and a hair's rule between parts. */
const Part = ({ title, note, children, className }: { title: string; note?: ReactNode; children: ReactNode; className?: string }) => (
  <section className={twMerge("flex min-w-0 shrink-0 flex-col gap-1.5 border-line-quiet px-3 not-first:border-l first:pl-1 last:pr-1", className)}>
    <h3 className="flex h-4 items-center justify-between gap-3 text-[10px] tracking-[0.18em] text-fg-faint uppercase">
      {title}{note !== undefined && <span className="font-mono tracking-normal whitespace-nowrap text-fg-muted normal-case">{note}</span>}
    </h3>
    {children}
  </section>
);

/** A tool: a tile with its picture and name, lit in its group's colour while it is in hand. */
function ToolTile({ id }: { id: ToolId }) {
  const on = useWorldStore((s) => s.tool === id), t = TOOLS[id]!, Icon = TOOL_ICON[id] ?? IconBrush;
  return (
    <button type="button" aria-pressed={on} aria-label={t.name} onClick={() => pickTool(id)}
      className={twMerge("group/tip relative flex h-14 w-15 cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border text-[11px] transition-all duration-150 active:scale-95", FOCUS,
        on ? "border-tone bg-tone-fill text-fg shadow-[0_0_18px_-4px_var(--tone)]" : "border-transparent text-fg-muted hover:bg-surface-2 hover:text-fg")}>
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
              <span className={twMerge("rotate-45 rounded-[2px] transition-colors", radius === r ? "bg-tone shadow-[0_0_8px_var(--tone)]" : "bg-fg-faint")} style={{ width: 4 + r * 2.4, height: 4 + r * 2.4 }} />
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
      <span className={twMerge("relative h-9 w-full overflow-hidden rounded-xl border-2 transition-all", on ? "border-tone shadow-[0_0_14px_-3px_var(--tone)]" : "border-transparent group-hover/tip:border-line-strong")}
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
              on ? "border-tone bg-tone-fill text-fg shadow-[0_0_18px_-4px_var(--tone)]" : "border-transparent text-fg-muted hover:bg-surface-2 hover:text-fg")}>
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
  return url ? <img src={url} alt="" draggable={false} className="h-10 w-full object-contain drop-shadow-md" /> : <IconBuildingMonument size={26} stroke={1.2} className="h-10 text-fg-faint" />;
}

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
      <div className="flex min-w-0 items-center gap-1">
        <label className="flex h-6 shrink-0 items-center gap-1 rounded-lg bg-surface-1 px-2 text-fg-muted focus-within:shadow-[inset_0_0_0_1px_var(--tone)]">
          <IconSearch size={13} />
          <input value={find} onChange={(e) => setFind(e.target.value)} onKeyDown={(e) => { if (e.key === "Escape") { setFind(""); e.currentTarget.blur(); } }}
            aria-label="find a building" className="w-20 bg-transparent text-[11px] text-fg outline-none" />
        </label>
        <div className="dock-scroll flex min-w-0 gap-0.5 overflow-x-auto">
          {KINDS.map(([k]) => (
            <button key={k} type="button" aria-pressed={!q && tab === k} onClick={() => { setFind(""); setTab(k); }}
              className={twMerge("h-6 cursor-pointer rounded-lg px-2 text-[11px] whitespace-nowrap", FOCUS, !q && tab === k ? "bg-tone-fill text-fg" : "text-fg-muted hover:bg-surface-2 hover:text-fg")}>{k}</button>
          ))}
        </div>
      </div>
      {/* (A wheel runs along the row.) */}
      <div className="dock-scroll flex gap-1 overflow-x-auto overflow-y-hidden pb-1" onWheel={(e) => { if (!e.deltaX) e.currentTarget.scrollLeft += e.deltaY; }}>
        {shown.map((d) => {
          const on = chosen === d.id && tool === "placeStructure";
          return (
            <button key={d.id} type="button" aria-pressed={on} title={`${nameOf(d)} · ${d.footprint.w}×${d.footprint.h}`}
              onClick={() => { setChosen(d.id); pickTool("placeStructure"); }}
              className={twMerge("relative flex h-[68px] w-21 shrink-0 cursor-pointer flex-col items-center justify-end gap-0.5 rounded-xl border px-1 pb-1 text-[10px] transition-all active:scale-95", FOCUS,
                on ? "border-tone bg-tone-fill text-fg shadow-[0_0_18px_-4px_var(--tone)]" : "border-line-quiet bg-surface-1 text-fg-muted hover:border-line-strong hover:text-fg")}>
              {d.render.kind === "tiles" ? <Block def={d} /> : <Picture def={d} />}
              <span className="max-w-full truncate">{nameOf(d)}</span>
              <span className="absolute top-0.5 right-1 font-mono text-[9px] text-fg-faint">{d.footprint.w}×{d.footprint.h}</span>
            </button>
          );
        })}
      </div>
    </Part>
  );
}

/** THE TRAY: the tools of the group in hand, and what they paint with. */
function Tray({ id }: { id: GroupId }) {
  const tool = useWorldStore((s) => s.tool), g = GROUPS.find((x) => x.id === id)!;
  const tools = <div className="flex gap-0.5">{g.tools.map((t) => <ToolTile key={t} id={t} />)}</div>;
  return (
    <div key={id} style={toned(g.tone)} className={twMerge("dock-tray-in pointer-events-auto flex max-w-full rounded-2xl p-2.5", GLASS, "shadow-[0_-1px_0_0_var(--tone)_inset,0_20px_40px_-12px_rgb(0_0_0/0.5)]",
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

const Rule = () => <span className="mx-1 h-8 w-px shrink-0 bg-line-quiet" />;

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
  // A tool from another group, picked by its key, opens the tray it is in.
  const [was, setWas] = useState(g.id);
  if (was !== g.id) { setWas(g.id); setShut(false); }
  const toggle = (p: PanelId) => setPanel(panel === p ? null : p);
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-3 z-20 flex flex-col items-center gap-2 px-3 text-fg select-none">
      {!shut && g.id !== "look" && <Tray id={g.id} />}
      <div className={twMerge("pointer-events-auto flex max-w-full items-center rounded-2xl p-1.5", GLASS)} role="toolbar" aria-label="map tools">
        <History />
        <Rule />
        {GROUPS.map((x) => {
          const on = x.id === g.id, Icon = GROUP_ICON[x.id];
          return (
            <button key={x.id} type="button" aria-label={x.name} aria-pressed={on} style={toned(x.tone)}
              onClick={() => { if (on) setShut(!shut); else pickGroup(x.id); }}
              className={twMerge("group/tip relative flex h-12 w-16 cursor-pointer flex-col items-center justify-center gap-0.5 rounded-xl text-[11px] transition-all duration-150 active:scale-95 max-md:w-11", FOCUS,
                on ? "-translate-y-0.5 bg-tone-fill text-fg" : "text-fg-muted hover:-translate-y-0.5 hover:bg-surface-2 hover:text-fg")}>
              <Icon size={21} stroke={1.7} className={on ? "text-tone drop-shadow-[0_0_6px_var(--tone)]" : "transition-colors group-hover/tip:text-tone"} />
              <span className="max-md:hidden">{x.name}</span>
              <span className={twMerge("absolute -bottom-px h-0.5 rounded-full bg-tone transition-all duration-200", on ? "w-8 shadow-[0_0_8px_var(--tone)]" : "w-0")} />
              {(shut || x.id === "look" || !on) && <Tip name={x.name} k={`⇧${x.key}`} />}
            </button>
          );
        })}
        <Rule />
        <BarButton name="Play rules" hint="Housing needs a road and costs money; the night falls" on={playing} onClick={() => setPlaying(!playing)}><IconPlayerPlayFilled size={17} /></BarButton>
        <BarButton name="View" on={panel === "view"} onClick={() => toggle("view")}><IconAdjustmentsHorizontal size={20} /></BarButton>
        <BarButton name="Map" on={panel === "map"} onClick={() => toggle("map")}><IconMap size={20} /></BarButton>
        <Hover />
      </div>
    </div>
  );
}
