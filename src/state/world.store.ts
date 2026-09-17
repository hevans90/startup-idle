/**
 * World v2 editor state. Transient — nothing here is persisted yet; the map
 * format lands with the serialization step.
 */
import { Viewport } from "pixi-viewport";
import { create } from "zustand";

import { waterMetaSaw } from "../world/debug/water-meta";
import { pointerSaw, type PointerAt } from "../world/debug/pointer-at";
import { createGrid, fillTerrain, idx, type Grid, structureAt } from "../world/grid";
import type { Cell } from "../world/iso";
import { derivedRamp, type SurfaceReader } from "../world/roads/ramp-derive";
import { structureDef } from "../world/structures/def";
import { DRY } from "../world/water/materials";
import { facingFor, pipeGrade, PIPE_FACINGS } from "../world/water/pipes";
import {
  OPEN_EDGE_DEFAULT, POUR_AMOUNT, SOURCE_RATE, createWaterField, drainAt, pourAt,
  setWaterEdge, syncGround, totalVolume,
  wetTiles, type WaterField,
} from "../world/water/field";
import { derivedSlope } from "../world/edit/slope";
import { RAMP } from "../world/iso";
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
  isWaterTool, isHeightTool, isPipeTool, isRoadTool, isSlopeTool, isSourceTool, isStructureTool,
  strokeFootprint,
  strokeLabel,
  type BrushId, type Stroke, type ToolId,
} from "../world/edit/tools";
import { heightDirtyCells, heightWrites } from "../world/edit/height-tools";
import {
  FIXTURE_IDS, FIXTURE_SIZE, applyFixture as applyFixtureTo, type FixtureId,
} from "../world/debug/fixtures";

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
  /**
   * See THROUGH the ground, to the pipework buried in it.
   *
   * Not a debug readout like the others — it is the only way to look at a
   * buried run at all. A pipe under a hill is drawn as a ghost of itself
   * ordinarily, which says it is there and not much else; with this on the
   * ground goes translucent and the run, and the water standing in it, are
   * drawn at full strength through the hill they are under.
   */
  xray: boolean;
  /**
   * The SIDES of the water — the vertical faces at an edge of a body.
   *
   * On by default and not really an overlay, but it lives here because it is
   * the same kind of thing: a switch for looking. A face is right at a kerb
   * or the rim of the map and contentious at a lip, where it is the water's
   * own cross-section and stands as tall as the water is deep — so being able
   * to take them away and see what is left is how that argument gets settled.
   */
  faces: boolean;
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
 * The map's water, outside the store for a stronger version of the same reason.
 *
 * Depth is a float that changes every frame. Putting it in state would mean a
 * re-render per frame, and putting it in the GRID would mean the undo system
 * carrying a snapshot of a simulation. The store mirrors the wet-tile count
 * and the volume, which is all the readout needs.
 *
 * WATER EDITS ARE NOT UNDOABLE, in either direction, and this said they were.
 * A pour calls `pourAt` on the live field and patches the `fluid` LAYER; undo
 * reverses the layer — the record of what was poured where, which is what a
 * saved map needs — and does not touch the depth. Measured: a pour took the
 * volume from 26.9 to 122.9 and undo left it at 122.9; a drain took 218.9 to
 * 122.9 and undo left it at 122.9.
 *
 * Whether that should change is a question about the editor, not a bug in it,
 * and the answer is not obviously yes: undoing a pour a second later means
 * taking water out of a pool it has since spread into, so any version of it is
 * an approximation. @see stroke, where the pour is made.
 */
let water: WaterField | null = null;

/** The live water field, for the renderer and the debug hook. */
export const getWater = () => water;

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
  /** Bands currently drawn, for the debug readout. */
  drawnBands: number;
  /** Tiles holding water, and the total volume — mirrored for the readout. */
  /**
   * Whether water runs off the edge of the map.
   *
   * A map is a piece of somewhere larger, so on by default — walled in, a
   * spring fills the world and the only way out is a hole you dug. Mirrored
   * into the store because the field it lives on is outside the store.
   */
  openEdge: boolean;
  /**
   * Step the water with the WebGPU compute passes instead of the CPU solver.
   *
   * A switch, not a comparison — see `debug/gpu-water-toggle`. Off by default
   * and never persisted: the CPU solver is the reference and the fallback, and
   * a map that loaded onto the device path without anybody asking would be a
   * map whose water nobody chose.
   */
  gpuWater: boolean;
  overlays: Overlays;
  /** Material index → atlas frame name. Index 0 is VOID. */
  palette: (string | null)[];

  // ── editing ───────────────────────────────────────────────────────────
  tool: ToolId;
  /** Which {@link import("../world/structures/def").StructureDef} the place tool builds. */
  structureDefId: string;
  /** Layer index the fluid brush paints. See `world/pools/materials`. */
  fluidMaterial: number;
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
  /** Where the pointer is, latched rather than stored. @see pointerSaw */
  setPointer: (p: PointerAt | null) => void;
  setDrawnBands: (n: number) => void;
  /** Re-read the water totals from the live field. Called by the scene's tick. */
  /**
   * The wet count and the volume. Given the device's own tally when the
   * compute solver is running, and walked out of the columns when it is not.
   * @see createMeta
   */
  refreshWaterMeta: (counted?: { wet: number; water: number }) => void;
  /** The live water field. Outside state deliberately — see `water`. */
  getWaterField: () => WaterField | null;
  toggleOverlay: (k: keyof Overlays) => void;
  setOpenEdge: (open: boolean) => void;
  setTool: (t: ToolId) => void;
  setStructureDef: (id: string) => void;
  setFluidMaterial: (index: number) => void;
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
  /** @see WorldState.gpuWater */
  setGpuWater: (on: boolean) => void;
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

/**
 * The fixture named in `?fixture=`, if it names one.
 *
 * So a rig survives a RELOAD. Applying one from the panel is a click, but a
 * fixture is most useful when you are going round a loop — change a constant,
 * refresh, look again — and re-clicking it every lap both wastes the lap and
 * quietly changes what you are looking at, because the water is a few hundred
 * frames further on each time you get there. Named in the URL, every refresh
 * starts from exactly the same scene.
 *
 * Unknown names are ignored rather than thrown on: this is a debug affordance
 * and a typo in a query string should give you the ordinary editor, not a
 * blank screen.
 */
function fixtureFromUrl(): FixtureId | null {
  if (typeof location === "undefined") return null;
  const want = new URLSearchParams(location.search).get("fixture");
  return want && FIXTURE_IDS.includes(want as FixtureId) ? (want as FixtureId) : null;
}

const START_FIXTURE = fixtureFromUrl();
const START_SIZE = (START_FIXTURE && FIXTURE_SIZE[START_FIXTURE]) ?? DEFAULT_SIZE;

const INITIAL_GRID = freshGrid(START_SIZE, START_SIZE);
if (START_FIXTURE) applyFixtureTo(INITIAL_GRID, START_FIXTURE, GRASS);
// built for the starting grid too, so `network` is never null and no call site
// has to special-case the first render
network = createNetwork(INITIAL_GRID);
water = createWaterField(INITIAL_GRID);

export const useWorldStore = create<WorldState>()((set, get) => ({
  grid: INITIAL_GRID,
  scale: 1,
  viewport: null,
  hover: null,
  drawnBands: 0,
  openEdge: OPEN_EDGE_DEFAULT,
  gpuWater: false,
  overlays: {
    grid: true, bands: false, height: false, origin: true, faces: true,
    net: false, mask: false, gaps: false, xray: false,
  },
  palette: [...INITIAL_TERRAIN_PALETTE],
  tool: "paintTerrain",
  structureDefId: "kit:intern.t0",
  fluidMaterial: 1,
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
  // A LATCH, not a `set`: this fires on every pointer move with a fresh
  // object, and a store write is a React root pass. @see pointerSaw
  setPointer: (pointer) => pointerSaw(pointer),
  setDrawnBands: (drawnBands) => set({ drawnBands }),
  getWaterField: () => water,
  refreshWaterMeta: (counted) => {
    if (!water) return;
    // COUNTED ON THE DEVICE WHERE THERE IS ONE. Both of these used to be
    // walked out of the whole depth map every tick — four thousand tile means
    // and sixty five thousand column reads, for two integers in the corner of
    // the screen. The solver has the depths in registers while it is applying
    // them, so it counts there and the answer rides back in the reduction that
    // already comes down. @see createMeta
    const wet = counted ? counted.wet : wetTiles(water);
    const volume = Math.round(totalVolume(water, get().grid, counted?.water));
    // A LATCH AND NOT A `set`. Both of these change every frame while water is
    // moving, and a store write is a React root pass — which on a profile of
    // one pour was the biggest single thing in the trace. @see waterMetaSaw
    waterMetaSaw({ wet, volume });
  },
  toggleOverlay: (k) =>
    set((st) => ({ overlays: { ...st.overlays, [k]: !st.overlays[k] } })),
  setOpenEdge: (open) => {
    if (water) setWaterEdge(water, open);
    set({ openEdge: open });
  },
  setPickNudge: (pickNudge) => set({ pickNudge }),
  setGpuWater: (gpuWater) => set({ gpuWater }),
  applyFixture: (id) => {
    const { grid } = get();
    // A FRESH grid, not the current one mutated in place: the scene's build
    // effect keys on grid identity, so reusing the object would change the data
    // and render none of it. A fixture rewrites every cell, so a rebuild is
    // also the right cost — this is the load path, not the edit path.
    // Some fixtures are a SIZE as much as a shape — see `FIXTURE_SIZE`.
    const n = FIXTURE_SIZE[id];
    const next = createGrid(n ?? grid.w, n ?? grid.h);
    applyFixtureTo(next, id, GRASS);
    get().loadGrid(next);
  },

  resize: (w, h) => {
    history = createHistory();
    const grid = freshGrid(w, h);
    network = createNetwork(grid);
    water = createWaterField(grid);
    setWaterEdge(water, get().openEdge);          // a new field, the same world
    dirty.clear();
    set({
      grid, hover: null, stroke: null,
      revision: 0, lastTouched: [], ...historyMeta(), ...netMeta(),
    });
  },

  setTool: (tool) => set({ tool, stroke: null }),
  setStructureDef: (structureDefId) => set({ structureDefId }),
  setFluidMaterial: (fluidMaterial) => set({ fluidMaterial }),
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
    } else if (isSlopeTool(s0.tool)) {
      // The brush says WHERE; the ground says which way and how far.
      for (const c of cells) {
        b.set("ramp", c.x, c.y,
          s0.tool === "unslope" ? RAMP.NONE : derivedSlope(st.grid, c.x, c.y));
      }
    } else if (isSourceTool(s0.tool)) {
      // A rate, and a layer write like any other brush — which is what makes a
      // spring undoable and saveable while the water it produces is neither.
      for (const c of cells) {
        b.set("source", c.x, c.y, s0.tool === "spring" ? SOURCE_RATE : -SOURCE_RATE);
        if (s0.tool === "spring") b.set("fluid", c.x, c.y, st.fluidMaterial);
      }
    } else if (isPipeTool(s0.tool)) {
      // A facing, not a rate. Placed pointing at the LOWEST neighbour, which is
      // the side it would actually drip off — a pipe pointing into a hillside
      // is not a thing anyone means to place — and a second click on a cell
      // that already has one turns it to the next facing instead of placing it
      // again, which is the only way to say "not that side" with one tool.
      for (const c of cells) {
        const had = st.grid.pipe[idx(st.grid, c.x, c.y)];
        const next = had
          ? PIPE_FACINGS[(PIPE_FACINGS.indexOf(had as 1 | 2 | 4 | 8) + 1) % PIPE_FACINGS.length]
          : facingFor(st.grid, c.x, c.y);
        b.set("pipe", c.x, c.y, next);
        b.set("fluid", c.x, c.y, st.fluidMaterial);
        // A new length of pipe CONTINUES the grade of the run it is joining,
        // and only drops to the ground where the ground has fallen below it.
        // That one rule is the whole of laying a buried main: a run lies on
        // the ground while the ground behaves, burrows under anything that
        // rises in front of it, and comes back up to daylight wherever the
        // ground falls away. Nothing to set, nothing to choose — which is the
        // only version of this that survives being drawn with a mouse.
        //
        // Re-clicking an existing pipe turns it and leaves its level alone: a
        // pipe already laid has a grade, and cycling which way it opens is not
        // a reason to re-lay it.
        if (!had) b.set("pipeZ", c.x, c.y, pipeGrade(st.grid, c.x, c.y));
      }
    } else if (isWaterTool(s0.tool)) {
      // Water is LIVE state, not a layer, so pouring is not a cell patch — see
      // `water/field`. The `fluid` layer still records what was poured where,
      // which is what a saved map needs; the depth is the simulation's.
      const w = water;
      for (const c of cells) {
        if (s0.tool === "drainWater") {
          if (w) drainAt(w, c.x, c.y, Infinity);
          b.set("fluid", c.x, c.y, DRY);
        } else {
          if (w) pourAt(w, c.x, c.y, POUR_AMOUNT, st.fluidMaterial);
          b.set("fluid", c.x, c.y, st.fluidMaterial);
        }
      }
    } else if (isRoadTool(s0.tool)) {
      const value = s0.tool === "eraseRoad" ? VOID_MATERIAL : PAVED_MATERIAL;
      for (const c of cells) b.set("paved", c.x, c.y, value);
    } else {
      const value = s0.tool === "erase" ? VOID_MATERIAL : st.material;
      for (const c of cells) b.set("terrain", c.x, c.y, value);
    }
    // A TERRAIN SLOPE already placed follows the ground it is on. Placing one
    // stays deliberate — nothing here creates a slope that was not asked for —
    // but leaving an existing one at its old direction and rise after the
    // ground moved under it draws a tilt the heightmap does not have.
    if (!isSlopeTool(s0.tool)) {
      for (const c of heightDirtyCells(st.grid, cells)) {
        const i = c.y * st.grid.w + c.x;
        if (st.grid.ramp[i] === RAMP.NONE || st.grid.paved[i] !== VOID_MATERIAL) continue;
        b.set("ramp", c.x, c.y, derivedSlope(st.grid, c.x, c.y));
      }
    }

    // RAMPS ARE DERIVED, and derived INSIDE this command so undo reverses the
    // road and the ramp together. `b.peek` reads the staged edit rather than
    // the grid, which has not been written yet.
    // A slope tool writes `ramp` itself, so it must not then be overwritten by
    // the road derivation — which would clear it, there being no road here.
    if (!isSlopeTool(s0.tool)
        && (isRoadTool(s0.tool) || isHeightTool(s0.tool) || isWaterTool(s0.tool))) {
      const read = readerFor(b, st.grid);
      for (const c of heightDirtyCells(st.grid, cells)) {
        b.set("ramp", c.x, c.y, derivedRamp(read, c.x, c.y));
      }
    }

    const cmd = b.build(strokeLabel(s0, cells.length));
    if (!cmd) { set({ stroke: null }); return; }   // no-op click adds no history
    const touched = commit(st.grid, history, cmd);
    // The columns stand on the terrain, so the terrain moving moves them. Done
    // after the commit, on the grid the command actually produced.
    if (water && touchesSurface(cmd)) syncGround(water, st.grid);
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
    // The bed stands on what is built as well as on the terrain — a placed
    // structure lifts it, a demolish drops it back. @see syncGround
    if (water && touchesSurface(cmd)) syncGround(water, st.grid);
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
    if (water && pending && touchesSurface(pending)) syncGround(water, st.grid);
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
    if (water && pending && touchesSurface(pending)) syncGround(water, st.grid);
    set({
      revision: st.revision + 1,
      lastTouched: markDirty(st.grid, touched, surface),
      ...historyMeta(), ...netMeta(),
    });
  },

  loadGrid: (grid, palette) => {
    history = createHistory();
    network = createNetwork(grid);
    water = createWaterField(grid);
    setWaterEdge(water, get().openEdge);          // a new field, the same world
    dirty.clear();   // the scene rebuilds wholesale on a new grid identity
    // A saved map's terrain indices only mean anything against the palette it
    // was saved with, so the file's palette replaces the live one wholesale.
    // Clamp `material` too: the loaded palette can be shorter than the old.
    const next = palette ?? get().palette;
    set({
      grid, palette: [...next], material: Math.min(get().material, next.length - 1),
      hover: null, stroke: null,
      revision: 0, lastTouched: [], ...historyMeta(), ...netMeta(),
    });
  },
}));
