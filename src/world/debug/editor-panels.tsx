/**
 * World v2 editor — THE PANELS: what is shown, and the map itself. They open over the map's right edge from the tool
 * bar, and are shut until asked for; everything that paints is in the bar. Both stay mounted once opened, so that
 * nothing in one forgets itself while the other is up. @see ToolDock
 */
import { IconX } from "@tabler/icons-react";
import { useState } from "react";
import type { Overlays } from "../../state/world.store";
import { useWorldStore } from "../../state/world.store";
import { bandCount } from "../iso";
import { Calibration } from "./calibration";
import { LightSection, MapTab, Row, Section } from "./edit-panel";
import { Minimap } from "./minimap";
import { SeedControls } from "./seed-controls";

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

export type PanelId = "view" | "map";

export function EditorPanels({ open, close }: { open: PanelId | null; close: () => void }) {
  const [seen, setSeen] = useState<ReadonlySet<PanelId>>(new Set());
  if (open && !seen.has(open)) setSeen(new Set([...seen, open]));
  if (!seen.size) return null;
  return (
    <aside className={`${open ? "dock-panel-in" : "hidden"} absolute top-3 right-3 z-20 flex max-h-[calc(100%-13rem)] w-80 max-w-[calc(100vw-1.5rem)] flex-col overflow-hidden rounded-2xl border border-line bg-surface-0/90 text-xs text-fg backdrop-blur-xl`}>
      <header className="flex shrink-0 items-center justify-between border-b border-line-quiet px-4 py-2.5">
        <h2 className="font-display text-sm tracking-widest uppercase">{open ?? ""}</h2>
        <button type="button" aria-label="close" onClick={close} className="cursor-pointer rounded-lg p-1 text-fg-muted hover:bg-surface-2 hover:text-fg"><IconX size={16} /></button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pt-3">
        {seen.has("view") && (
          <div className={open === "view" ? "" : "hidden"}>
            <OverlaysSection />
            <LightSection />
            <Section title="minimap"><Minimap /></Section>
            <Stats />
            <Calibration />
          </div>
        )}
        {seen.has("map") && (
          <div className={open === "map" ? "" : "hidden"}>
            {/* The seed is the thing worth writing down. @see SeedControls */}
            <Section title="generate"><SeedControls /></Section>
            <MapTab />
          </div>
        )}
      </div>
    </aside>
  );
}
