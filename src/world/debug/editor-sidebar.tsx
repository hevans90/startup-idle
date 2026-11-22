/**
 * World v2 editor — THE SIDEBAR.
 *
 * It was one column of everything, a screen and a half long: the tool you wanted was a scroll away from the brush
 * it paints with, and undo was under the lights. Now what every tool shares stands still at the top — the tool in
 * hand, undo and redo, the rules, the brush — and the rest is a tab each for what you are doing: the land, the
 * roads, the water, what is built, what is shown, the map itself. Every tab stays mounted, hidden, so nothing in
 * one forgets itself while another is open. @see edit-panel
 */
import { useState } from "react";
import type { Overlays } from "../../state/world.store";
import { useWorldStore } from "../../state/world.store";
import { bandCount } from "../iso";
import { Calibration } from "./calibration";
import { BrushBar, BuildTab, History, LandTab, LightSection, MapTab, PlayRules, RoadsTab, Row, Section, ToolInHand, WaterTab } from "./edit-panel";
import { Minimap } from "./minimap";
import { SeedControls } from "./seed-controls";

const TABS = ["land", "roads", "water", "build", "view", "map"] as const;
type Tab = (typeof TABS)[number];
const KEPT = "world-editor-tab";
/** The tab last open, where the browser will say; the land's, where it will not. */
function keptTab(): Tab {
  try { const t = localStorage.getItem(KEPT); if (t && (TABS as readonly string[]).includes(t)) return t as Tab; } catch { /* no storage: the first tab */ }
  return "land";
}

const OVERLAYS: (keyof Overlays)[] = ["labels", "grid", "bands", "height", "origin", "net", "mask", "lanes", "xray", "faces", "readout"];
const CHIP = "cursor-pointer rounded border px-2 py-1 font-mono leading-none";

/** The overlays, each on or off. */
function OverlaysSection() {
  const overlays = useWorldStore((s) => s.overlays), toggleOverlay = useWorldStore((s) => s.toggleOverlay);
  return (
    <Section title="overlays">
      <Row>
        {OVERLAYS.map((k) => (
          <button key={k} type="button" onClick={() => toggleOverlay(k)}
            className={`${CHIP} ${overlays[k] ? "border-good bg-good/20 text-good" : "border-line bg-surface-1 text-fg-muted hover:bg-surface-2 hover:text-fg"}`}>{k}</button>
        ))}
      </Row>
    </Section>
  );
}

/** The map in numbers: its size, how much of it is drawn, how high it stands. */
function Stats() {
  const grid = useWorldStore((s) => s.grid), drawnBands = useWorldStore((s) => s.drawnBands);
  const total = bandCount(grid.w, grid.h);
  return (
    <Section title="map">
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 font-mono">
        <dt className="text-fg-muted">size</dt><dd>{grid.w}×{grid.h} <span className="text-fg-muted">· {(grid.w * grid.h).toLocaleString()} cells</span></dd>
        <dt className="text-fg-muted">bands</dt>
        <dd className={drawnBands < total ? "text-good" : "text-fg"}>{drawnBands}<span className="text-fg-muted"> of {total} drawn</span></dd>
        <dt className="text-fg-muted">height</dt><dd>{grid.minHeight}…{grid.maxHeight}</dd>
      </dl>
    </Section>
  );
}

/** Where the pointer is on the map, for the panel's foot: its own, since it moves with every move of the mouse. */
function Hover() {
  const hover = useWorldStore((s) => s.hover);
  return <span className={`font-mono ${hover ? "text-fg" : "text-fg-faint"}`}>{hover ? `${hover.x},${hover.y}` : "—"}</span>;
}

export function EditorSidebar() {
  const [tab, setTab] = useState<Tab>(keptTab);
  const open = (t: Tab) => { setTab(t); try { localStorage.setItem(KEPT, t); } catch { /* not kept */ } };
  const pane = (t: Tab) => (tab === t ? "" : "hidden");
  return (
    <aside className="flex w-80 shrink-0 flex-col border-l border-line-quiet bg-surface-0 text-xs text-fg">
      {/* WHAT EVERY TOOL SHARES, standing still: the tool in hand, undo and redo, the rules, the brush. */}
      <header className="shrink-0 border-b border-line-quiet px-3 pt-3 pb-2">
        <div className="mb-2 flex items-center gap-1">
          <div className="mr-auto truncate"><ToolInHand /></div>
          <History />
          <PlayRules />
        </div>
        <BrushBar />
      </header>
      <nav className="flex shrink-0 border-b border-line-quiet" role="tablist">
        {TABS.map((t) => (
          <button key={t} type="button" role="tab" aria-selected={tab === t} onClick={() => open(t)}
            className={`flex-1 cursor-pointer border-b-2 px-1 py-2 font-mono ${tab === t ? "border-good text-good" : "border-transparent text-fg-muted hover:bg-surface-1 hover:text-fg"}`}>{t}</button>
        ))}
      </nav>
      <div className="min-h-0 flex-1 overflow-y-auto px-3 pt-3">
        <div className={pane("land")}><LandTab /></div>
        <div className={pane("roads")}><RoadsTab /></div>
        <div className={pane("water")}><WaterTab /></div>
        <div className={pane("build")}><BuildTab /></div>
        <div className={pane("view")}>
          <OverlaysSection />
          <LightSection />
          <Section title="minimap"><Minimap /></Section>
          <Stats />
          <Calibration />
        </div>
        <div className={pane("map")}>
          {/* The seed is the thing worth writing down. @see SeedControls */}
          <Section title="generate"><SeedControls /></Section>
          <MapTab />
        </div>
      </div>
      <footer className="flex shrink-0 items-center justify-between border-t border-line-quiet px-3 py-1.5 text-fg-muted"
        title="Left-drag paints; while a paint tool is in hand, pan with the middle or right button. A whole drag is one step of undo.">
        <span>cell <Hover /></span>
        <span className="font-mono text-fg-faint">⌘Z · ⇧⌘Z</span>
      </footer>
    </aside>
  );
}
