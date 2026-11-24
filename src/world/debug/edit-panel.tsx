/**
 * Editing chrome — what the editor's View and Map panels are made of, and the map's figures that the tool bar
 * shows beside the tools that change them. @see EditorPanels, ToolDock
 *
 * React, per the Pixi/React boundary: none of this lives in world space.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useShallow } from "zustand/shallow";

import {
  DEFAULT_SIZE, getFleet, useWorldStore,
} from "../../state/world.store";
import { deserializeWorld, serializeWorld, toJSON } from "../io/serialize";
import type { FixtureId } from "./fixtures";
import { waterMetaRead } from "./water-meta";
import { housingCapacity } from "../../game/housing";
import { giMs, giOptions, setGi, type GiOptions } from "../render/gi";

const BTN = "cursor-pointer rounded border px-2 py-1 font-mono leading-none";
const ON = "border-good bg-good/20 text-good";
const OFF = "border-line bg-surface-1 text-fg-muted hover:bg-surface-2 hover:text-fg";
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
  // A dock basin with lit quays: for looking at the night, its windows and the water. @see buildWaterfront
  ["waterfront", "waterfront"],
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
/**
 * The wet count and the volume, POLLED.
 *
 * Its own component and its own four-a-second timer, because both numbers
 * change every frame while water is moving and the panel around it is the
 * whole sidebar. As store state this re-rendered all of it sixty times a
 * second after a single pour. @see waterMetaSaw
 */
export function WaterMeta() {
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
export function Networks() {
  const n = useWorldStore((s) => s.netComponents);
  return <>{n} network{n === 1 ? "" : "s"}</>;
}
export function Sources() {
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
export function Beds() {
  const grid = useWorldStore((s) => s.grid), revision = useWorldStore((s) => s.revision);
  // Beds on the map, which is the ceiling on hiring. Off the grid for the same
  // reason the springs are: an edit mutates in place, so `revision` is the only
  // thing that can say it changed. @see housingCapacity
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const beds = useMemo(() => housingCapacity(grid), [grid, revision]);
  return <span title="beds: intern · vibe coder · 10x dev">{beds.intern} · {beds.vibe_coder} · {beds["10x_dev"]} beds</span>;
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
  const flag = (k: "on" | "glows" | "floors" | "water" | "walls" | "lamps" | "windows" | "headlights" | "only", label: string, title?: string) => (
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
        {flag("water", "water", "the water gives the light back")}
      </Row>
      <Row>
        <span className="mr-1 text-fg-faint">reach</span>
        {([3, 4, 5] as const).map((n) => (
          <button key={n} type="button" title="how many cascades: how far light reaches" onClick={() => put({ cascades: n })} className={`${BTN} ${o.cascades === n ? ON : OFF}`}>{n}</button>
        ))}
        <span className="mx-1 text-fg-faint">heights</span>
        {([1, 2, 4] as const).map((n) => (
          <button key={`h${n}`} type="button" title="how many heights the light is worked out at: 1 is the ground alone" onClick={() => put({ layers: n })} className={`${BTN} ${o.layers === n ? ON : OFF}`}>{n}</button>
        ))}
      </Row>
      <Row>
        <span className="mr-1 text-fg-faint">grid</span>
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
