/**
 * Editing chrome — tool, brush, material, history and file controls: the pieces the editor's sidebar is made of,
 * a tab's worth each, and what stands in its head. @see editor-sidebar
 *
 * React, per the Pixi/React boundary: none of this lives in world space.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useShallow } from "zustand/shallow";

import {
  DEFAULT_SIZE, getFleet, useWorldStore, VOID_MATERIAL,
} from "../../state/world.store";
import { deserializeWorld, serializeWorld, toJSON } from "../io/serialize";
import type { FixtureId } from "./fixtures";
import { waterMetaRead } from "./water-meta";
import type { BrushId, ToolId } from "../edit/tools";
import { allStructureDefs } from "../structures/def";
import { fluidChoices } from "../water/materials";
import { housingCapacity } from "../../game/housing";
import { buildCost } from "../../game/build-cost";
import { giMs, giOptions, setGi, type GiOptions } from "../render/gi";

/** A building's price for its tooltip, as play rules would charge it. @see buildCost */
const priceOf = (defId: string) => {
  const p = buildCost(defId);
  return p ? ` · $${Math.round(p.toNumber()).toLocaleString()} in play` : " · not for sale in play";
};

const BTN = "cursor-pointer rounded border px-2 py-1 font-mono leading-none";
const ON = "border-good bg-good/20 text-good";
const OFF = "border-line bg-surface-1 text-fg-muted hover:bg-surface-2 hover:text-fg";
const DEAD = "cursor-default rounded border px-2 py-1 font-mono leading-none border-line-quiet bg-surface-1 text-fg-faint";

/** Every tool by what it is called here and the key that picks it: the header says which is in hand. @see use-edit-keys */
const TOOL_NAMES: Partial<Record<ToolId, [string, string?]>> = {
  paintTerrain: ["paint", "b"], erase: ["erase", "e"], inspect: ["look", "v"],
  raise: ["raise", "r"], lower: ["lower", "f"], flatten: ["flatten"], smooth: ["smooth"],
  paintRoad: ["pave", "p"], eraseRoad: ["unpave", "o"], slope: ["slope", "u"], unslope: ["unslope", "i"],
  pourWater: ["pour", "j"], drainWater: ["drain", "k"], spring: ["spring", "l"], sink: ["sink", ";"], pipe: ["pipe", "'"], boat: ["boat", "h"],
  placeStructure: ["build", "n"], demolish: ["demolish", "x"],
};
/** Awkward terrain on demand, so a picking bug is reproducible. */
const FIXTURES: [FixtureId, string][] = [
  ["flat", "flat"],
  ["ziggurat", "ziggurat"],
  ["occluder", "occluder"],
  ["rampFan", "ramp fan"],
  ["roadShapes", "road shapes"],
  ["avenue", "avenue"],
  ["plaza", "plaza"],
  ["splitTrap", "split trap"],
  // The river fixture worth looking at: fed the way a map's rivers are now —
  // over the boundary, at a level — and built on the slack grade and the deep
  // channel that generated maps actually have. Named for what it is rather
  // than inheriting "river", so the button and the fixture agree; the old
  // `river` is still there for `?fixture=river` and still has its own tests.
  // @see buildInlet
  ["inlet", "inlet"],
  // Both storeys running at once: a road over a river. @see buildCrossing
  ["crossing", "crossing"],
  ["cascade", "cascade"],
  // Farms, hedges, rows, beds, stumps: what the player does to what grows. @see buildFarms
  ["farms", "farms"],
  // The farms with their wood dry and sick, and a farm against it: a wildfire waiting to happen. @see buildWildfire
  ["wildfire", "wildfire"],
  ["ground", "ground"],
  ["lake", "lake"],
  ["islands", "islands"],
  ["plunge", "plunge"],
  ["waterfall", "waterfall"],
  ["brink", "brink (5²)"],
  ["terrain", "terrain"],
  ["rough", "rough"],
];
const STEPS: [number, string][] = [
  [1, "×0.5"],
  [2, "×1"],
];
// (Rect and line need a DRAG: a single click leaves anchor === head and covers one cell — said in the tooltip.)
const BRUSHES: [BrushId, string, string][] = [
  ["point", "point", "1"],
  ["rect", "rect", "2 · drag"],
  ["line", "line", "3 · drag"],
];
const SIZES: [number, string][] = [
  [0, "1"],
  [1, "3"],
  [2, "5"],
];

/** A section's heading, and what follows it laid out in a wrapping row. */
export function Section({ title, note, children }: { title: string; note?: ReactNode; children: ReactNode }) {
  return (
    <section className="mb-4">
      <h3 className="mb-1.5 flex items-baseline justify-between text-[10px] tracking-widest text-fg-faint uppercase">
        <span>{title}</span>
        {note !== undefined && <span className="font-mono tracking-normal text-fg-muted normal-case">{note}</span>}
      </h3>
      {children}
    </section>
  );
}
export const Row = ({ children }: { children: ReactNode }) => <div className="mb-1 flex flex-wrap items-center gap-1">{children}</div>;
/** A tool's button: its name, its key small beside it, lit while it is the one in hand. */
function Tool({ id, title }: { id: ToolId; title?: string }) {
  const tool = useWorldStore((s) => s.tool), setTool = useWorldStore((s) => s.setTool);
  const [name, key] = TOOL_NAMES[id] ?? [id];
  return (
    <button type="button" onClick={() => setTool(id)} title={title} className={`${BTN} ${tool === id ? ON : OFF}`}>
      {name}{key && <span className="ml-1.5 opacity-50">{key}</span>}
    </button>
  );
}

/**
 * The wet count and the volume, POLLED.
 *
 * Its own component and its own four-a-second timer, because both numbers
 * change every frame while water is moving and the panel around it is the
 * whole sidebar. As store state this re-rendered all of it sixty times a
 * second after a single pour. @see waterMetaSaw
 */
function WaterMeta() {
  const [m, setM] = useState(waterMetaRead);
  useEffect(() => {
    const t = setInterval(() => setM(waterMetaRead()), 250);
    return () => clearInterval(t);
  }, []);
  return <>{m.wet} wet · {m.volume}</>;
}

/**
 * WHAT AN EDIT CHANGES, EACH ITS OWN: the panel is the whole sidebar, several hundred buttons, and it read the
 * map's revision and the undo stack — so every stroke rendered all of it again, in the frame the stroke had the
 * map to redraw in. These read them; the panel does not.
 */
function Networks() {
  const n = useWorldStore((s) => s.netComponents);
  return <>{n} network{n === 1 ? "" : "s"}</>;
}
function Sources() {
  const grid = useWorldStore((s) => s.grid), revision = useWorldStore((s) => s.revision);
  // Counted off the grid rather than mirrored into the store: a spring is an
  // ordinary layer write, so `revision` already says when it can have changed.
  const { springs, sinks, pipes } = useMemo(() => {
    let springs = 0, sinks = 0, pipes = 0;
    for (const r of grid.source) {
      if (r > 0) springs++;
      else if (r < 0) sinks++;
    }
    for (let i = 0; i < grid.main.length; i++) if (grid.main[i] || grid.mainEnd[i]) pipes++;
    return { springs, sinks, pipes };
    // `revision` is the dependency that matters and the one the rule cannot
    // see: an edit mutates the grid's typed arrays in place, so the object it
    // is watching never changes identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [grid, revision]);
  return (
    <>
      {springs > 0 && ` · ${springs} spring${springs === 1 ? "" : "s"}`}
      {sinks > 0 && ` · ${sinks} sink${sinks === 1 ? "" : "s"}`}
      {pipes > 0 && ` · ${pipes} pipe${pipes === 1 ? "" : "s"}`}
    </>
  );
}
function Beds() {
  const grid = useWorldStore((s) => s.grid), revision = useWorldStore((s) => s.revision);
  // Beds on the map, which is the ceiling on hiring. Off the grid for the same
  // reason the springs are: an edit mutates in place, so `revision` is the only
  // thing that can say it changed. @see housingCapacity
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const beds = useMemo(() => housingCapacity(grid), [grid, revision]);
  return <span title="beds: intern · vibe coder · 10x dev">{beds.intern} · {beds.vibe_coder} · {beds["10x_dev"]} beds</span>;
}
/** Undo and redo, for the panel's head: each says what it would undo when hovered. */
export function History() {
  const { undoDepth, redoDepth, undoName, redoName, doUndo, doRedo } = useWorldStore(useShallow((s) => ({
    undoDepth: s.undoDepth, redoDepth: s.redoDepth, undoName: s.undoName, redoName: s.redoName, doUndo: s.doUndo, doRedo: s.doRedo,
  })));
  return (
    <>
      <button type="button" onClick={doUndo} disabled={!undoDepth} title={undoName ? `undo: ${undoName} (⌘Z)` : "undo (⌘Z)"} className={undoDepth ? `${BTN} ${OFF}` : DEAD}>
        undo{undoDepth ? <span className="ml-1.5 opacity-50">{undoDepth}</span> : null}
      </button>
      <button type="button" onClick={doRedo} disabled={!redoDepth} title={redoName ? `redo: ${redoName} (⇧⌘Z)` : "redo (⇧⌘Z)"} className={redoDepth ? `${BTN} ${OFF}` : DEAD}>
        redo{redoDepth ? <span className="ml-1.5 opacity-50">{redoDepth}</span> : null}
      </button>
    </>
  );
}

/**
 * THE NIGHT'S LIGHT, a spike, switched here: on or off, each kind of light, what stops it, how far and how finely
 * it is worked out, how strong it is — and the night itself, held at midnight to look at it. @see render/gi
 */
export function LightSection() {
  const [o, setO] = useState<GiOptions>(() => ({ ...giOptions() }));
  const [night, setNight] = useState(false);
  const [ms, setMs] = useState(NaN);
  useEffect(() => { const t = setInterval(() => setMs(giMs()), 500); return () => clearInterval(t); }, []);
  const put = (p: Partial<GiOptions>) => setO(setGi(p));
  const flag = (k: "on" | "glows" | "floors" | "walls" | "lamps" | "windows" | "headlights" | "only", label: string, title?: string) => (
    <button key={k} type="button" title={title} onClick={() => put({ [k]: !o[k] })} className={`${BTN} ${o[k] ? ON : OFF}`}>{label}</button>
  );
  return (
    <Section title="night light" note={Number.isFinite(ms) && o.on ? `${ms.toFixed(2)} ms` : undefined}>
      <Row>
        <button type="button" title="hold the map at midnight (needs play rules, and day and night on in settings)"
          onClick={() => { const w = window as unknown as { __dayPhase?: number }; if (night) delete w.__dayPhase; else w.__dayPhase = 0; setNight(!night); }}
          className={`${BTN} ${night ? ON : OFF}`}>midnight</button>
        {flag("on", "cascades", "work the night's light out on the map; off, the flat night and its glows")}
        {flag("floors", "floors", "lit buildings show their own windows, a floor at a time")}
        {flag("glows", "glows", "draw the old glow sprites too")}
        {flag("walls", "walls", "buildings stop light")}
        {flag("only", "light only", "show the light alone")}
      </Row>
      <Row>
        {flag("lamps", "lamps")}
        {flag("windows", "windows")}
        {flag("headlights", "headlights")}
      </Row>
      <Row>
        <span className="mr-1 text-fg-faint">reach</span>
        {([3, 4, 5] as const).map((n) => (
          <button key={n} type="button" title="how many cascades: how far light reaches" onClick={() => put({ cascades: n })} className={`${BTN} ${o.cascades === n ? ON : OFF}`}>{n}</button>
        ))}
        <span className="mx-1 text-fg-faint">grid</span>
        {([2, 1] as const).map((n) => (
          <button key={n} type="button" title="probe spacing: half a tile, or a quarter" onClick={() => put({ spacing: n })} className={`${BTN} ${o.spacing === n ? ON : OFF}`}>{n === 2 ? "coarse" : "fine"}</button>
        ))}
      </Row>
      <Row>
        <span className="mr-1 text-fg-faint">strength</span>
        <button type="button" onClick={() => put({ gain: Math.max(0.1, +(o.gain - 0.1).toFixed(2)) })} className={`${BTN} ${OFF}`}>−</button>
        <span className="w-6 text-center font-mono">{o.gain.toFixed(1)}</span>
        <button type="button" onClick={() => put({ gain: +(o.gain + 0.1).toFixed(2) })} className={`${BTN} ${OFF}`}>+</button>
      </Row>
    </Section>
  );
}

/** THE TOOL IN HAND, for the panel's head: whichever tab is open, it says what a click on the map will do. */
export function ToolInHand() {
  const tool = useWorldStore((s) => s.tool);
  const [name, key] = TOOL_NAMES[tool] ?? [tool];
  return <span className="font-mono text-good">{name}{key && <span className="ml-1.5 opacity-50">{key}</span>}</span>;
}

/** The game's rules or the editor's: on, a building needs a road and has to be paid for. @see playing */
export function PlayRules() {
  const playing = useWorldStore((s) => s.playing), setPlaying = useWorldStore((s) => s.setPlaying);
  return (
    <button type="button" onClick={() => setPlaying(!playing)} title="play rules: housing needs road frontage and costs money; the night falls"
      className={`${BTN} ${playing ? ON : OFF}`}>play rules</button>
  );
}

/** THE BRUSH, for the panel's head: its shape and its size, which every painting tool shares. */
export function BrushBar() {
  const { brush, brushRadius, setBrush, setBrushRadius } = useWorldStore(useShallow((s) => ({ brush: s.brush, brushRadius: s.brushRadius, setBrush: s.setBrush, setBrushRadius: s.setBrushRadius })));
  return (
    <div className="flex items-center gap-1">
      <span className="mr-1 text-[10px] tracking-widest text-fg-faint uppercase">brush</span>
      {BRUSHES.map(([id, label, hint]) => (
        <button key={id} type="button" title={hint} onClick={() => setBrush(id)} className={`${BTN} ${brush === id ? ON : OFF}`}>{label}</button>
      ))}
      <span className="mx-0.5 text-fg-faint">·</span>
      {SIZES.map(([r, label]) => (
        <button key={r} type="button" title={`${label}×${label}`} onClick={() => setBrushRadius(r)} className={`${BTN} ${brushRadius === r ? ON : OFF}`}>{label}</button>
      ))}
    </div>
  );
}

/** LAND: what it is made of, and how high it stands. */
export function LandTab() {
  const { material, palette, heightStep, setMaterial, setHeightStep } = useWorldStore(useShallow((s) => ({
    material: s.material, palette: s.palette, heightStep: s.heightStep, setMaterial: s.setMaterial, setHeightStep: s.setHeightStep,
  })));
  return (
    <>
      <Section title="ground">
        <Row><Tool id="paintTerrain" /><Tool id="erase" /><Tool id="inspect" /></Row>
        <div className="grid grid-cols-3 gap-1">
          {palette.map((frame, i) =>
            i === VOID_MATERIAL ? null : (
              <button key={i} type="button" onClick={() => setMaterial(i)}
                className={`${BTN} truncate ${material === i ? ON : OFF}`}>
                {frame?.replace(/^[A-Za-z]+_/, "").replace(/\.png$/, "") ?? "?"}
              </button>
            ),
          )}
        </div>
      </Section>
      <Section title="height">
        <Row><Tool id="raise" /><Tool id="lower" /><Tool id="flatten" /><Tool id="smooth" /></Row>
        <Row>
          <span className="mr-1 text-fg-faint">step</span>
          {STEPS.map(([n, label]) => (
            <button key={n} type="button" onClick={() => setHeightStep(n)} className={`${BTN} ${heightStep === n ? ON : OFF}`}>{label}</button>
          ))}
        </Row>
      </Section>
    </>
  );
}

/** ROADS: laid, taken up, and sloped. */
export function RoadsTab() {
  return (
    <Section title="roads" note={<Networks />}>
      <Row><Tool id="paintRoad" /><Tool id="eraseRoad" /></Row>
      <Row><Tool id="slope" /><Tool id="unslope" /></Row>
    </Section>
  );
}

/** WATER: poured and drained, its springs and sinks, its pipes and boats, and what it is. */
export function WaterTab() {
  const { fluidMaterial, setFluidMaterial, openEdge, setOpenEdge } = useWorldStore(useShallow((s) => ({
    fluidMaterial: s.fluidMaterial, setFluidMaterial: s.setFluidMaterial, openEdge: s.openEdge, setOpenEdge: s.setOpenEdge,
  })));
  return (
    <>
      <Section title="water" note={<><WaterMeta /><Sources /></>}>
        <Row><Tool id="pourWater" /><Tool id="drainWater" /></Row>
        <Row><Tool id="spring" /><Tool id="sink" /></Row>
        <Row>
          <Tool id="pipe" title="a water main: drag from water to a building that drinks" />
          <Tool id="boat" title="click on water to put a boat on it; click a boat to take it off" />
        </Row>
      </Section>
      <Section title="fluid">
        <Row>
          {fluidChoices().map(({ index, material }: { index: number; material: { name: string } }) => (
            <button key={index} type="button" onClick={() => setFluidMaterial(index)} className={`${BTN} ${fluidMaterial === index ? ON : OFF}`}>{material.name}</button>
          ))}
        </Row>
      </Section>
      <Section title="map edge">
        <Row>
          <button type="button" onClick={() => setOpenEdge(!openEdge)} title="whether water runs off the edge of the map" className={`${BTN} ${openEdge ? ON : OFF}`}>open edge</button>
        </Row>
      </Section>
    </>
  );
}

/** BUILD: what stands on the map, put up and taken down. */
export function BuildTab() {
  const { structureDefId, setStructureDef } = useWorldStore(useShallow((s) => ({ structureDefId: s.structureDefId, setStructureDef: s.setStructureDef })));
  return (
    <Section title="buildings" note={<Beds />}>
      <Row><Tool id="placeStructure" /><Tool id="demolish" /></Row>
      <div className="grid grid-cols-2 gap-1">
        {allStructureDefs().map((d) => (
          <button key={d.id} type="button" onClick={() => setStructureDef(d.id)}
            title={`${d.name} · ${d.footprint.w}×${d.footprint.h} · ${d.render.kind}${priceOf(d.id)}`}
            className={`${BTN} truncate text-left ${structureDefId === d.id ? ON : OFF}`}>{d.name}</button>
        ))}
      </div>
    </Section>
  );
}

/** THE MAP ITSELF: kept and brought back, made blank at a size, or set up as one of the fixtures. */
export function MapTab() {
  const fileRef = useRef<HTMLInputElement>(null);
  const { palette, grid, loadGrid, resize, applyFixture, getWaterField, setGenParam } = useWorldStore(useShallow((s) => ({
    palette: s.palette, grid: s.grid, loadGrid: s.loadGrid, resize: s.resize, applyFixture: s.applyFixture, getWaterField: s.getWaterField, setGenParam: s.setGenParam,
  })));

  const save = () => {
    // With the live field, so the file keeps the water that is on the map and
    // not the water the map was authored with. Pouring is not an edit — it
    // goes into the running world rather than into the grid — so without this
    // a map you have spent ten minutes filling saves as the dry basin it was.
    const json = toJSON(
      serializeWorld(grid, { terrain: palette, paved: [null] }, getWaterField() ?? undefined, getFleet()),
    );
    const url = URL.createObjectURL(new Blob([json], { type: "application/json" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `world-${grid.w}x${grid.h}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const load = async (f: File) => {
    try {
      const { grid: g, palette: p, boats } = deserializeWorld(JSON.parse(await f.text()));
      loadGrid(g, p.terrain, boats);
    } catch (err) {
      // surfaced rather than swallowed: a bad file should say why
      window.alert(`Could not load map: ${(err as Error).message}`);
    }
  };

  return (
    <>
      <Section title="file">
        <Row>
          <button type="button" onClick={save} className={`${BTN} ${OFF}`}>save</button>
          <button type="button" onClick={() => fileRef.current?.click()} className={`${BTN} ${OFF}`}>load</button>
          <button type="button" onClick={() => resize(grid.w, grid.h)} title="a blank map at this size" className={`${BTN} ${OFF}`}>reset</button>
        </Row>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void load(f);
            e.target.value = ""; // so the same file can be re-loaded
          }}
        />
      </Section>
      {/* A BLANK map at this size, for authoring — and the generator's size is
          set to match, or pressing generate afterwards would quietly hand back
          a map of a different size from the one just chosen. @see GenParams */}
      <Section title="blank map">
        <Row>
          {[16, 32, DEFAULT_SIZE, 96].map((n) => (
            <button key={n} type="button" onClick={() => { resize(n, n); setGenParam("size", n); }} className={`${BTN} ${grid.w === n ? ON : OFF}`}>{n}²</button>
          ))}
        </Row>
      </Section>
      <Section title="fixtures">
        <div className="grid grid-cols-3 gap-1">
          {FIXTURES.map(([id, label]) => (
            <button key={id} type="button" title={label} onClick={() => applyFixture(id)} className={`${BTN} truncate ${OFF}`}>{label}</button>
          ))}
        </div>
      </Section>
    </>
  );
}
