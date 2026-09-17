/**
 * Editing chrome — tool, brush, material, history and file controls.
 *
 * React, per the Pixi/React boundary: none of this lives in world space.
 */
import { useRef } from "react";

import {
  DEFAULT_SIZE, useWorldStore, VOID_MATERIAL,
} from "../../state/world.store";
import { deserializeWorld, serializeWorld, toJSON } from "../io/serialize";
import type { FixtureId } from "./fixtures";
import type { BrushId, ToolId } from "../edit/tools";
import { allStructureDefs } from "../structures/def";

const BTN = "cursor-pointer rounded border px-2 py-1 font-mono";
const ON = "border-emerald-500 bg-emerald-500/20 text-emerald-300";
const OFF = "border-gray-700 bg-gray-900 text-gray-300 hover:bg-gray-800";

const TOOLS: [ToolId, string][] = [
  ["paintTerrain", "paint (b)"],
  ["erase", "erase (e)"],
  ["inspect", "look (v)"],
];
/** Separate row: these write `height`, not a material. */
const HEIGHT_UI: [ToolId, string][] = [
  ["raise", "raise (r)"],
  ["lower", "lower (f)"],
  ["flatten", "flatten"],
  ["smooth", "smooth"],
];
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
];
const STEPS: [number, string][] = [
  [1, "×0.5"],
  [2, "×1"],
];
// Named so it is obvious which shapes need a DRAG: with rect or line a single
// click leaves anchor === head and therefore covers one cell, which reads as
// "the brush doesn't work" unless the label says so.
const BRUSHES: [BrushId, string][] = [
  ["point", "point (1)"],
  ["rect", "drag rect (2)"],
  ["line", "drag line (3)"],
];
const SIZES: [number, string][] = [
  [0, "1×1"],
  [1, "3×3"],
  [2, "5×5"],
];

export function EditPanel() {
  const fileRef = useRef<HTMLInputElement>(null);
  const {
    tool, brush, brushRadius, material, palette, grid, undoDepth, redoDepth,
    undoName, redoName, heightStep, setTool, setBrush, setBrushRadius,
    setMaterial, setHeightStep, doUndo, doRedo, loadGrid, resize, applyFixture,
    netComponents, structureDefId, setStructureDef,
  } = useWorldStore();

  const save = () => {
    const json = toJSON(serializeWorld(grid, { terrain: palette, paved: [null] }));
    const url = URL.createObjectURL(new Blob([json], { type: "application/json" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `world-${grid.w}x${grid.h}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const load = async (f: File) => {
    try {
      const { grid: g, palette: p } = deserializeWorld(JSON.parse(await f.text()));
      loadGrid(g, p.terrain);
    } catch (err) {
      // surfaced rather than swallowed: a bad file should say why
      window.alert(`Could not load map: ${(err as Error).message}`);
    }
  };

  return (
    <>
      <p className="mt-4 mb-1 text-gray-400">tool</p>
      <div className="flex flex-wrap gap-1">
        {TOOLS.map(([id, label]) => (
          <button key={id} type="button" onClick={() => setTool(id)}
            className={`${BTN} ${tool === id ? ON : OFF}`}>{label}</button>
        ))}
      </div>

      <p className="mt-3 mb-1 text-gray-400">height</p>
      <div className="flex flex-wrap gap-1">
        {HEIGHT_UI.map(([id, label]) => (
          <button key={id} type="button" onClick={() => setTool(id)}
            className={`${BTN} ${tool === id ? ON : OFF}`}>{label}</button>
        ))}
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-1">
        <span className="mr-1 text-gray-500 dark:text-gray-500">step</span>
        {STEPS.map(([n, label]) => (
          <button key={n} type="button" onClick={() => setHeightStep(n)}
            className={`${BTN} ${heightStep === n ? ON : OFF}`}>{label}</button>
        ))}
      </div>

      <p className="mt-3 mb-1 text-gray-400">road</p>
      <div className="flex flex-wrap items-center gap-1">
        <button type="button" onClick={() => setTool("paintRoad")}
          className={`${BTN} ${tool === "paintRoad" ? ON : OFF}`}>pave (p)</button>
        <button type="button" onClick={() => setTool("eraseRoad")}
          className={`${BTN} ${tool === "eraseRoad" ? ON : OFF}`}>unpave (o)</button>
        <span className="ml-1 text-gray-500 dark:text-gray-500">
          {netComponents} network{netComponents === 1 ? "" : "s"}
        </span>
      </div>

      <p className="mt-3 mb-1 text-gray-400">structures</p>
      <div className="flex flex-wrap items-center gap-1">
        <button type="button" onClick={() => setTool("placeStructure")}
          className={`${BTN} ${tool === "placeStructure" ? ON : OFF}`}>build (n)</button>
        <button type="button" onClick={() => setTool("demolish")}
          className={`${BTN} ${tool === "demolish" ? ON : OFF}`}>demolish (x)</button>
      </div>
      <div className="mt-1 flex flex-wrap gap-1">
        {allStructureDefs().map((d) => (
          <button key={d.id} type="button" onClick={() => setStructureDef(d.id)}
            title={`${d.footprint.w}×${d.footprint.h} · ${d.render.kind}`}
            className={`${BTN} ${structureDefId === d.id ? ON : OFF}`}>{d.name}</button>
        ))}
      </div>

      <p className="mt-3 mb-1 text-gray-400">brush</p>
      <div className="flex flex-wrap gap-1">
        {BRUSHES.map(([id, label]) => (
          <button key={id} type="button" onClick={() => setBrush(id)}
            className={`${BTN} ${brush === id ? ON : OFF}`}>{label}</button>
        ))}
      </div>

      <p className="mt-3 mb-1 text-gray-400">brush size</p>
      <div className="flex flex-wrap gap-1">
        {SIZES.map(([r, label]) => (
          <button key={r} type="button" onClick={() => setBrushRadius(r)}
            className={`${BTN} ${brushRadius === r ? ON : OFF}`}>{label}</button>
        ))}
      </div>

      <p className="mt-3 mb-1 text-gray-400">material</p>
      <div className="flex flex-wrap gap-1">
        {palette.map((frame, i) =>
          i === VOID_MATERIAL ? null : (
            <button key={i} type="button" onClick={() => setMaterial(i)}
              className={`${BTN} ${material === i ? ON : OFF}`}>
              {frame?.replace(/^[A-Za-z]+_/, "").replace(/\.png$/, "") ?? "?"}
            </button>
          ),
        )}
      </div>

      <p className="mt-3 mb-1 text-gray-400">history</p>
      <div className="flex flex-wrap gap-1">
        <button type="button" onClick={doUndo} disabled={!undoDepth}
          title={undoName ?? undefined}
          className={`${BTN} ${undoDepth ? OFF : "border-gray-800 bg-gray-900 text-gray-600"}`}>
          undo {undoDepth ? `(${undoDepth})` : ""}
        </button>
        <button type="button" onClick={doRedo} disabled={!redoDepth}
          title={redoName ?? undefined}
          className={`${BTN} ${redoDepth ? OFF : "border-gray-800 bg-gray-900 text-gray-600"}`}>
          redo {redoDepth ? `(${redoDepth})` : ""}
        </button>
      </div>
      {undoName && (
        <p className="mt-1 truncate font-mono text-gray-500" title={undoName}>
          last: {undoName}
        </p>
      )}

      <p className="mt-3 mb-1 text-gray-400">map</p>
      <div className="flex flex-wrap gap-1">
        <button type="button" onClick={save} className={`${BTN} ${OFF}`}>save</button>
        <button type="button" onClick={() => fileRef.current?.click()} className={`${BTN} ${OFF}`}>
          load
        </button>
        <button type="button" onClick={() => resize(grid.w, grid.h)} className={`${BTN} ${OFF}`}>
          reset
        </button>
      </div>
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

      <p className="mt-3 mb-1 text-gray-400">size</p>
      <div className="flex flex-wrap gap-1">
        {[16, 32, DEFAULT_SIZE, 96].map((n) => (
          <button key={n} type="button" onClick={() => resize(n, n)}
            className={`${BTN} ${grid.w === n ? ON : OFF}`}>{n}²</button>
        ))}
      </div>

      <p className="mt-3 mb-1 text-gray-400">terrain fixture</p>
      <div className="flex flex-wrap gap-1">
        {FIXTURES.map(([id, label]) => (
          <button key={id} type="button" onClick={() => applyFixture(id)}
            className={`${BTN} ${OFF}`}>{label}</button>
        ))}
      </div>
    </>
  );
}
