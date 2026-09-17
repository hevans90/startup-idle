/**
 * World v2 editor state. Transient — nothing here is persisted yet; the map
 * format lands with the serialization step.
 */
import { Viewport } from "pixi-viewport";
import { create } from "zustand";

import { createGrid, fillTerrain, type Grid , structureAt } from "../world/grid";
import type { Cell } from "../world/iso";
import { derivedRamp, type SurfaceReader } from "../world/roads/ramp-derive";
import { structureDef } from "../world/structures/def";
import { demolishCommand, placeCommand } from "../world/structures/place";

import {
  PatchBuilder, canRedo, canUndo, commit, createHistory, peekRedo, peekUndo,
  redo as redoCmd, redoLabel, touchedCells, touchesNetwork, touchesSurface,
  undo as undoCmd, undoLabel, type History,
} from "../world/edit/commands";
import {
  applyEdit, componentCount, createNetwork, netIdAt, rebuild as rebuildNet,
  type Network,
} from "../world/roads/network";
import {
  isHeightTool, isRoadTool, isStructureTool, strokeFootprint, strokeLabel,
  type BrushId, type Stroke, type ToolId,
} from "../world/edit/tools";
import { heightDirtyCells, heightWrites } from "../world/edit/height-tools";
import { applyFixture as applyFixtureTo, type FixtureId } from "../world/debug/fixtures";

export type Overlays = {
  grid: boolean;
  bands: boolean;
  height: boolean;
  origin: boolean;
  /** One hue per road component — how a split network becomes visible. */
  net: boolean;
  /** Connection mask as colour, for reading the autotiler's decision. */
  mask: boolean;
  /** Paved cells whose art is substituted or missing — the labelling to-do list. */
  gaps: boolean;
};

/**
 * Terrain materials, index 0 reserved for VOID.
 *
 * MUTABLE and saved with the map: the tile browser can paint any of ~940 atlas
 * frames, so the palette grows as frames are used rather than being a fixed
 * list. Because the file carries it, indices keep their meaning across saves —
 * see io/serialize.
 */
export const INITIAL_TERRAIN_PALETTE: (string | null)[] = [
  null,
  "landscapeTiles_067.png", // 1 grass
  "landscapeTiles_083.png", // 2 dirt
];

/**
 * The `paved` layer is a material index like `terrain`, but the ROAD TILE is
 * chosen by the autotiler from the connection mask, not by this value — so one
 * id is all a single road style needs. A second style (city pavement) would be
 * a second id pointing at a different table.
 */
export const PAVED_MATERIAL = 1;

export const GRASS = 1;
export const DIRT = 2;
export const VOID_MATERIAL = 0;
export const DEFAULT_SIZE = 64;

/**
 * History lives OUTSIDE the store: it is mutated in place (arrays pushed and
 * popped), so putting it in state would mean either cloning it on every edit
 * or storing something whose identity lies. The store mirrors its depths and
 * labels instead, which is all the UI needs.
 */
let history: History = createHistory();
const historyMeta = () => ({
  undoDepth: history.past.length,
  redoDepth: history.future.length,
  undoName: undoLabel(history),
  redoName: redoLabel(history),
});
/**
 * The road graph, also OUTSIDE the store and for the same reason as `history`:
 * it is mutated in place, so holding it in state would mean cloning it on every
 * edit or storing something whose identity lies. The store mirrors the component
 * count, which is all the UI needs.
 */
let network: Network | null = null;

/**
 * Cells the renderer has not reconciled yet, ACCUMULATED across edits.
 *
 * Outside the store for the same reason as `history` and `network`: it is
 * mutated in place. But the reason it accumulates rather than being replaced is
 * React batching — several commits inside one task collapse into a single
 * re-render, and a `lastTouched` that each commit OVERWROTE left the renderer
 * seeing only the final one's cells. Every earlier edit was then in the grid
 * and absent from the screen.
 *
 * Normal interaction never hits that (a pointer event per task), but a fixture,
 * a scripted edit or any future bulk operation does — and the failure is
 * silent, which is the worst kind.
 */
const dirty = new Set<number>();

/** Take the accumulated dirty cells and reset. Called by the renderer. */
export function drainDirty(grid: Grid): Cell[] {
  const out = touchedCells(grid, [...dirty]);
  dirty.clear();
  return out;
}
export const getNetwork = () => network;
export const netComponentAt = (x: number, y: number) => {
  const g = useWorldStore.getState().grid;
  return network ? netIdAt(network, g, x, y) : -1;
};
const netMeta = () => ({ netComponents: network ? componentCount(network) : 0 });

export const getHistory = () => history;
export const historyCanUndo = () => canUndo(history);
export const historyCanRedo = () => canRedo(history);

type WorldState = {
  grid: Grid;
  scale: number;
  viewport: Viewport | null;
  /** Cell under the pointer, or null when off-map. */
  hover: Cell | null;
  /**
   * Last pointer position in WORLD space, and the fractional cell it maps to.
   * Kept so the calibration overlay can show where picking thinks the cursor
   * is, and so changing the offset can re-pick without needing a mouse move.
   */
  pointer: { wx: number; wy: number; fx: number; fy: number } | null;
  /** Bands currently drawn, for the debug readout. */
  drawnBands: number;
  overlays: Overlays;
  /** Material index → atlas frame name. Index 0 is VOID. */
  palette: (string | null)[];

  // ── editing ───────────────────────────────────────────────────────────
  tool: ToolId;
  /** Which {@link import("../world/structures/def").StructureDef} the place tool builds. */
  structureDefId: string;
  brush: BrushId;
  /** Brush radius in cells: 0 = one tile, 1 = 3×3, 2 = 5×5. */
  brushRadius: number;
  /** Terrain palette index the paint tool writes. */
  material: number;
  /**
   * Half steps a raise/lower applies. 2 is a full slab; 1 is the half step the
   * artset also has, and the smallest change the height field can express.
   */
  heightStep: number;
  /** The drag in progress, or null. */
  stroke: Stroke | null;
  /**
   * Bumped whenever cells change. The renderer watches this and reconciles
   * `lastTouched` — so an edit costs one sprite update per cell rather than a
   * rebuild, and nothing polls per frame.
   */
  revision: number;
  lastTouched: Cell[];
  /** Connected components in the road graph. Mirrored, like the history depths. */
  netComponents: number;
  /** Mirrored depths so the UI can render without reaching into `history`. */
  undoDepth: number;
  redoDepth: number;
  undoName: string | null;
  redoName: string | null;
  /**
   * Live nudge to the pick offset, in px. Only for the calibration panel: the
   * shipped value is derived (see iso.worldToCell), and this exists to PROVE it
   * against the art rather than to be trusted long-term.
   */
  pickNudge: number;
  setViewport: (v: Viewport) => void;
  setHover: (c: Cell | null) => void;
  setPointer: (p: WorldState["pointer"]) => void;
  setDrawnBands: (n: number) => void;
  toggleOverlay: (k: keyof Overlays) => void;
  setTool: (t: ToolId) => void;
  setStructureDef: (id: string) => void;
  /** Place or demolish at one cell. Called by `endStroke` for the structure tools. */
  commitStructure: (c: Cell) => void;
  setBrush: (b: BrushId) => void;
  setBrushRadius: (r: number) => void;
  setMaterial: (m: number) => void;
  setHeightStep: (n: number) => void;
  /**
   * Palette index for a frame, appending it if new. Does NOT change the
   * selected material — the ramp tool needs an index without stealing the
   * paint tool's selection.
   */
  frameIndex: (frame: string) => number;
  /**
   * Index for a frame, appending it to the palette if new, and select it.
   * Returns the index. Deliberately NOT named `use…`: it is a store action,
   * and the hook prefix makes lint treat every call site as a hook call.
   */
  selectFrame: (frame: string) => number;
  beginStroke: (c: Cell) => void;
  updateStroke: (c: Cell) => void;
  /** Commits the drag as ONE undoable command. */
  endStroke: () => void;
  cancelStroke: () => void;
  doUndo: () => void;
  doRedo: () => void;
  loadGrid: (g: Grid, palette?: (string | null)[]) => void;
  setPickNudge: (n: number) => void;
  resize: (w: number, h: number) => void;
  /** Replace the terrain with a named test shape. Clears history, like a load. */
  applyFixture: (id: FixtureId) => void;
};

/**
 * Mark cells the renderer must re-sync, and return them for `lastTouched`.
 *
 * Undoing a HILL has to re-sync the cells that looked onto it as well, or their
 * columns are left standing over ground that moved.
 */
/**
 * Reads the state an edit WILL produce, for deriving the ramp layer.
 *
 * Straight through the builder, so the derivation sees the road it is part of.
 */
const readerFor = (b: PatchBuilder, grid: Grid): SurfaceReader => ({
  inBounds: (x, y) => x >= 0 && y >= 0 && x < grid.w && y < grid.h,
  paved: (x, y) => b.peek("paved", x, y) !== VOID_MATERIAL,
  height: (x, y) => b.peek("height", x, y),
});

const markDirty = (grid: Grid, touched: number[], surface: boolean) => {
  const cells = surface
    ? heightDirtyCells(grid, touchedCells(grid, touched))
    : touchedCells(grid, touched);
  for (const c of cells) dirty.add(c.y * grid.w + c.x);
  return cells;
};

function freshGrid(w: number, h: number): Grid {
  const g = createGrid(w, h);
  fillTerrain(g, GRASS); // flat grass at height 0 — the starting state, not an assumption
  return g;
}

const INITIAL_GRID = freshGrid(DEFAULT_SIZE, DEFAULT_SIZE);
// built for the starting grid too, so `network` is never null and no call site
// has to special-case the first render
network = createNetwork(INITIAL_GRID);

export const useWorldStore = create<WorldState>()((set, get) => ({
  grid: INITIAL_GRID,
  scale: 1,
  viewport: null,
  hover: null,
  pointer: null,
  drawnBands: 0,
  overlays: { grid: true, bands: false, height: false, origin: true, net: false, mask: false, gaps: false },
  palette: [...INITIAL_TERRAIN_PALETTE],
  tool: "paintTerrain",
  structureDefId: "kit:intern.t0",
  brush: "point",
  brushRadius: 0,
  material: DIRT,
  heightStep: 2,
  stroke: null,
  revision: 0,
  lastTouched: [],
  netComponents: 0,
  undoDepth: 0,
  redoDepth: 0,
  undoName: null,
  redoName: null,
  pickNudge: 0,
  setViewport: (viewport) => set({ viewport }),
  setHover: (hover) => set({ hover }),
  setPointer: (pointer) => set({ pointer }),
  setDrawnBands: (drawnBands) => set({ drawnBands }),
  toggleOverlay: (k) =>
    set((st) => ({ overlays: { ...st.overlays, [k]: !st.overlays[k] } })),
  setPickNudge: (pickNudge) => set({ pickNudge }),
  applyFixture: (id) => {
    const { grid } = get();
    // A FRESH grid, not the current one mutated in place: the scene's build
    // effect keys on grid identity, so reusing the object would change the data
    // and render none of it. A fixture rewrites every cell, so a rebuild is
    // also the right cost — this is the load path, not the edit path.
    const next = createGrid(grid.w, grid.h);
    applyFixtureTo(next, id, GRASS);
    get().loadGrid(next);
  },

  resize: (w, h) => {
    history = createHistory();
    const grid = freshGrid(w, h);
    network = createNetwork(grid);
    dirty.clear();
    set({
      grid, hover: null, pointer: null, stroke: null,
      revision: 0, lastTouched: [], ...historyMeta(), ...netMeta(),
    });
  },

  setTool: (tool) => set({ tool, stroke: null }),
  setStructureDef: (structureDefId) => set({ structureDefId }),
  setBrush: (brush) => set({ brush, stroke: null }),
  setBrushRadius: (brushRadius) => set({ brushRadius }),
  setMaterial: (material) => set({ material }),
  setHeightStep: (heightStep) => set({ heightStep }),

  frameIndex: (frame) => {
    const { palette } = get();
    const existing = palette.indexOf(frame);
    if (existing > 0) return existing;
    const next = palette.length;
    set({ palette: [...palette, frame] });
    return next;
  },

  selectFrame: (frame) => {
    const i = get().frameIndex(frame);
    set({ material: i });
    return i;
  },

  beginStroke: (c) =>
    set((st) => ({ stroke: { tool: st.tool, brush: st.brush, anchor: c, head: c } })),

  updateStroke: (c) =>
    set((st) => (st.stroke ? { stroke: { ...st.stroke, head: c } } : {})),

  cancelStroke: () => set({ stroke: null }),

  endStroke: () => {
    const st = get();
    const s0 = st.stroke;
    if (!s0) return;
    // A STRUCTURE is placed at one cell by one command, so it skips the stroke
    // machinery — brush size and drag shape mean nothing to it.
    if (isStructureTool(s0.tool)) { get().commitStructure(s0.head); return; }

    const cells = strokeFootprint(st.grid, s0, st.brushRadius);
    const b = new PatchBuilder(st.grid);
    // The tool decides which cells; this decides what to write.
    if (isHeightTool(s0.tool)) {
      for (const wr of heightWrites(st.grid, cells, s0.tool, { step: st.heightStep })) {
        b.set("height", wr.x, wr.y, wr.value);
      }
    } else if (isRoadTool(s0.tool)) {
      const value = s0.tool === "eraseRoad" ? VOID_MATERIAL : PAVED_MATERIAL;
      for (const c of cells) b.set("paved", c.x, c.y, value);
    } else {
      const value = s0.tool === "erase" ? VOID_MATERIAL : st.material;
      for (const c of cells) b.set("terrain", c.x, c.y, value);
    }
    // RAMPS ARE DERIVED, and derived INSIDE this command so undo reverses the
    // road and the ramp together. `b.peek` reads the staged edit rather than
    // the grid, which has not been written yet.
    if (isRoadTool(s0.tool) || isHeightTool(s0.tool)) {
      const read = readerFor(b, st.grid);
      for (const c of heightDirtyCells(st.grid, cells)) {
        b.set("ramp", c.x, c.y, derivedRamp(read, c.x, c.y));
      }
    }

    const cmd = b.build(strokeLabel(s0, cells.length));
    if (!cmd) { set({ stroke: null }); return; }   // no-op click adds no history
    const touched = commit(st.grid, history, cmd);
    // The graph reconciles to the grid AFTER the write. Only painting road is
    // purely additive; everything else can remove a link, and union-find has no
    // split, so it refloods.
    if (network && touchesNetwork(cmd)) {
      applyEdit(network, st.grid, touchedCells(st.grid, touched), s0.tool !== "paintRoad");
    }
    // A height change alters how the NEIGHBOURS render — a column belongs to
    // the taller cell but exists because of the shorter one — so the dirty set
    // is widened before the renderer sees it. Terrain edits are local.
    set({
      stroke: null,
      revision: st.revision + 1,
      // a ramp changes the surface height across the cell, so the neighbours
      // that look onto it need re-syncing just as a height edit does
      lastTouched: markDirty(st.grid, touched, isHeightTool(s0.tool) || isRoadTool(s0.tool)),
      ...historyMeta(), ...netMeta(),
    });
  },

  /**
   * Place or demolish at one cell, as a single undoable command.
   *
   * Separate from `endStroke` rather than a branch inside it: nothing about a
   * structure edit goes through `strokeFootprint`, and the two share only the
   * commit-and-mark tail. The network is refloodable from here too — levelling
   * a footprint can sever a road that ran across it.
   */
  commitStructure: (c) => {
    const st = get();
    const def = structureDef(st.structureDefId);
    const cmd = st.tool === "demolish"
      ? demolishCommand(st.grid, structureAt(st.grid, c.x, c.y))
      : def && placeCommand(st.grid, def, c.x, c.y);
    if (!cmd) { set({ stroke: null }); return; }
    const touched = commit(st.grid, history, cmd);
    if (network && touchesNetwork(cmd)) rebuildNet(network, st.grid);
    set({
      stroke: null,
      revision: st.revision + 1,
      // levelling moves the surface, so the neighbours re-render too
      lastTouched: markDirty(st.grid, touched, true),
      ...historyMeta(), ...netMeta(),
    });
  },

  doUndo: () => {
    const st = get();
    // asked BEFORE the undo, because afterwards the command has moved branches
    const pending = peekUndo(history);
    const surface = pending !== null && touchesSurface(pending);
    const touched = undoCmd(st.grid, history);
    if (!touched) return;
    // An undo REMOVES whatever was added, so it always refloods.
    if (network && pending && touchesNetwork(pending)) rebuildNet(network, st.grid);
    set({
      revision: st.revision + 1,
      lastTouched: markDirty(st.grid, touched, surface),
      ...historyMeta(), ...netMeta(),
    });
  },

  doRedo: () => {
    const st = get();
    const pending = peekRedo(history);
    const surface = pending !== null && touchesSurface(pending);
    const touched = redoCmd(st.grid, history);
    if (!touched) return;
    if (network && pending && touchesNetwork(pending)) rebuildNet(network, st.grid);
    set({
      revision: st.revision + 1,
      lastTouched: markDirty(st.grid, touched, surface),
      ...historyMeta(), ...netMeta(),
    });
  },

  loadGrid: (grid, palette) => {
    history = createHistory();
    network = createNetwork(grid);
    dirty.clear();   // the scene rebuilds wholesale on a new grid identity
    // A saved map's terrain indices only mean anything against the palette it
    // was saved with, so the file's palette replaces the live one wholesale.
    // Clamp `material` too: the loaded palette can be shorter than the old.
    const next = palette ?? get().palette;
    set({
      grid, palette: [...next], material: Math.min(get().material, next.length - 1),
      hover: null, pointer: null, stroke: null,
      revision: 0, lastTouched: [], ...historyMeta(), ...netMeta(),
    });
  },
}));
