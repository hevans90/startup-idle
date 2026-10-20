/**
 * World v2 editor state.
 *
 * The SESSION is transient — tool, brush, camera, overlays, undo history. The
 * MAP is not: it autosaves to localStorage and comes back on reload, because
 * the housing a player builds gates who they can hire, and a map that vanished
 * would leave a save file holding employees with nowhere to live.
 * @see startAutosave, loadSaved
 */
import { aiActing, aiDistrict, aiHoldsRoads, inDistrict } from "../world/ai/district";
import { stageOf, useAiSingularityStore } from "./ai-singularity.store";
import Decimal from "break_infinity.js";
import {
  addBoat, createFleet, removeBoatNear, restoreFleet, type Fleet, type SavedBoat,
} from "../world/boats/fleet";
import { mapRiver, tileDepthOf } from "../world/boats/river";
import { createTraffic, type Traffic } from "../world/boats/traffic";
import { createExports, type Exports } from "../world/boats/exports";
import { createTown, type Town } from "../world/agents/town";
import { createArrivals, settleHousing, type Arrivals } from "../world/agents/arrivals";
import { createEvolution, serviceOf, type Evolution } from "../world/agents/services";
import { HACKATHON_PIZZA, type GameEvent } from "../world/events/events";
import { sendSludgeTrucks } from "../world/events/sludge";
import { useSlopPitStore } from "./slop-pit.store";
import { housedBy } from "../game/housing";
import { useGeneratorStore } from "./generators.store";
import { useMoneyStore } from "./money.store";
import { incomeNow } from "../world/projects/economy";
import { builtProjects, createWorks, nearestSpot, projectUnderWay, ruledOut, siteOf, startSiteCommand, type Works } from "../world/projects/works";
import { PROJECTS, alreadyEarned, featureGateOpen, projectDef, type FeatureId, type Priority, type ProjectId } from "../game/projects";
import { Viewport } from "pixi-viewport";
import { create } from "zustand";

import { waterMetaSaw } from "../world/debug/water-meta";
import { pointerSaw, type PointerAt } from "../world/debug/pointer-at";
import { createGrid, fillTerrain, idx, type Grid, structureAt } from "../world/grid";
import type { Cell } from "../world/iso";
import { derivedRamp, type SurfaceReader } from "../world/roads/ramp-derive";
import { DERELICT, SLOP_PIT, structureDef } from "../world/structures/def";
import { DRY } from "../world/water/materials";
import { facingFor, gamePipeRun, pipeGrade, PIPE_FACINGS } from "../world/water/pipes";
import {
  OPEN_EDGE_DEFAULT, POUR_AMOUNT, SOURCE_RATE, createWaterField, depthAt, drainAt, pourAt,
  setWaterEdge, syncGround, totalVolume,
  wetTiles, type WaterField,
} from "../world/water/field";
import { derivedSlope } from "../world/edit/slope";
import { RAMP } from "../world/iso";
import { demolishCommand, placeCommand, upgradeCommand, validatePlacement, type PlaceRules } from "../world/structures/place";

import {
  PatchBuilder, canRedo, canUndo, commit, createHistory, peekRedo, peekUndo,
  redo as redoCmd, redoLabel, touchedCells, touchesNetwork, touchesSurface,
  undo as undoCmd, undoLabel, type Command, type History,
} from "../world/edit/commands";
import {
  applyEdit, componentCount, createNetwork, netIdAt, rebuild as rebuildNet,
  type Network,
} from "../world/roads/network";
import {
  isWaterTool, isHeightTool, isPipeTool, isRoadTool, isSlopeTool, isSourceTool, isStructureTool,
  strokeCells,
  strokeFootprint,
  strokeLabel,
  type BrushId, type Stroke, type ToolId,
} from "../world/edit/tools";
import { heightDirtyCells, heightWrites } from "../world/edit/height-tools";
import {
  FIXTURE_IDS, FIXTURE_SIZE, applyFixture as applyFixtureTo, type FixtureId,
} from "../world/debug/fixtures";
import { clearSaved, hasSaved, onRunMap, saveNow, scheduleSave, suspendSaving } from "../world/io/world-save";
import { buildCost, pipeCost, roadCost, spendForBuild, upgradeCost } from "../game/build-cost";
import { useSessionStore } from "./session.store";
import { usePrestigeStore } from "./prestige.store";
import { buyable, landDiscount, landPrice, ownsTile, PARCELS, parcelOf, parcelRect, STARTING_PARCELS } from "../world/land";
import { formatCurrency } from "../utils/money-utils";
import { generatePlayableMap } from "../world/gen/generate-map";
import { DEFAULT_GEN, withDefaults, type GenParams } from "../world/gen/params";
import { forgetGenParams, loadGenParams, saveGenParams } from "../world/io/gen-settings";
import { founderIs } from "../game/founder-rules";
import { BOOTSTRAP_LAND } from "../game/founders.catalog";

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
  /**
   * The cursor-tracking CELL READOUT — what is actually under the pointer.
   *
   * On by default, because it is the thing you want nine times out of ten in
   * an editor. It is here so it can be turned OFF: it follows the cursor, so
   * it covers whatever you are trying to look at, which is precisely the
   * tiles you are hovering to inspect. @see CellReadout
   */
  readout: boolean;
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
  "landscapeTiles_059.png", // 3 sand
  // 4-6 grass under one, two and three trees. Derived frames, baked by
  // `bun run bake:trees` — a wood is a material, not a structure. @see WOODS
  "landscapeTiles_067_trees1.png",
  "landscapeTiles_067_trees2.png",
  "landscapeTiles_067_trees3.png",
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
export const SAND = 3;
/** Grass under one, two and three trees — thin wood to thick. */
export const WOODS = [4, 5, 6] as const;
export const VOID_MATERIAL = 0;
/** Kept in step with the generator's own default, which is where size lives. */
export const DEFAULT_SIZE = DEFAULT_GEN.size;

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
/** Half steps of water a tile needs standing on it to count as water, for a pipe to face. */
const WET_DEPTH = 1;

/** The live water field, for the renderer and the debug hook. */
export const getWater = () => water;

/**
 * THE BOATS on that water: live state like it, placed by a tool and not by an
 * edit, so not undoable — and a new map is a new harbour. @see world/boats
 */
let fleet: Fleet = createFleet();
export const getFleet = () => fleet;
/** And the boats coming down its rivers, from its seaports. @see world/boats/traffic */
let traffic: Traffic = createTraffic();
export const getTraffic = () => traffic;
/** And the cars and people on its roads. @see world/agents/town */
let town: Town = createTown();
export const getTown = () => town;
/** And the projects going up on it. @see world/projects/works */
let works: Works = createWorks();
export const getWorks = () => works;

/**
 * The cells a drag of LOTS covers, or null for a drag that is not one: the
 * build tool, a lot in hand, not a project's site, and a drag rather than a
 * click. A straight line from where it went down to where it is. @see endStroke
 */
/**
 * THE GAME'S PLACEMENT RULES: frontage, and the company's own land. The
 * editor has none of them. @see PlaceRules, world/land
 */
/**
 * THE COMPANY'S LAND, on the company's map: the editor's map is nobody's to
 * own, and its play mode builds anywhere. Null for all of it. @see world/land
 */
export const companyLand = (): number[] | null => (onRunMap() ? useSessionStore.getState().land : null);

export function playRules(g: Grid): PlaceRules {
  const land = companyLand();
  return { needsRoad: true, ...(land ? { owned: (x: number, y: number) => ownsTile(g, land, x, y) } : {}) };
}

export function lotLine(st: { tool: string; structureDefId: string; placingProject: unknown; grid: Grid }, s0: Stroke): Cell[] | null {
  if (st.tool !== "placeStructure" || st.placingProject) return null;
  if (!housedBy(st.structureDefId) && st.structureDefId !== "levee") return null;
  if (s0.anchor.x === s0.head.x && s0.anchor.y === s0.head.y) return null;
  return strokeCells(st.grid, { ...s0, brush: "line" });
}

/**
 * UNDO IN THE GAME: the last build — one placement, a road stroke, or a
 * dragged row of lots — taken back with its money, for a short while after,
 * and only while nothing else has been done to the map since.
 */
export const UNDO_WINDOW_MS = 15_000;
let buildCmds: Command[] = [];
let batching = false;
function recordBuild(cmd: Command, refund: number) {
  const st = useWorldStore.getState();
  if (!st.playing) return;
  const now = Date.now();
  if (batching && st.lastBuild) {
    buildCmds.push(cmd);
    useWorldStore.setState({ lastBuild: { at: now, refund: st.lastBuild.refund + refund } });
  } else {
    buildCmds = [cmd];
    useWorldStore.setState({ lastBuild: { at: now, refund } });
  }
}

/** Sludge trucks on their way to the pit, or back. @see sendSludgeTrucks */
let haulersOut = 0;
export const sludgeTrucksOut = () => haulersOut;
export const sludgeTruckBack = () => { haulersOut = Math.max(0, haulersOut - 1); };
/** How many trucks a call sends, and what the call costs: seconds of income, never under a floor. */
export const SLUDGE_TRUCKS = 3;
/** What clearing a derelict building costs: fifteen seconds of income. @see DERELICT */
export const clearingPrice = () => Math.max(200, Math.round(incomeNow() * 15));
/** What the next parcel of land costs. @see landPrice */
export const parcelPrice = () => {
  // Counted from what a company starts with, its founders' extra included,
  // and cheaper for those who have learned where to buy. @see EXTRA_PARCELS, CHEAP_LAND_MULT
  const m = usePrestigeStore.getState().modifiers;
  const bought = Math.max(0, (useSessionStore.getState().land?.length ?? 0) - STARTING_PARCELS - m.startingParcels);
  // THE BOOTSTRAPPER pays over the odds for it. @see BOOTSTRAP_LAND
  // HILLY LAND comes cheap. @see landDiscount
  const hills = 1 - landDiscount(useWorldStore.getState().grid);
  return Math.round(landPrice(bought, incomeNow()) * m.landCostMult * hills * (founderIs("bootstrapper") ? BOOTSTRAP_LAND : 1));
};
export const sludgeTruckPrice = () => Math.max(200, Math.round(incomeNow() * 20));
/** What each choice an event offers costs in money, for those that cost any. Sludge trucks are paid for apart. */
const CHOICE_PRICE: Record<string, () => number> = { host: () => pizzaPrice() };
/** What a hackathon's pizza costs: seconds of income, never under a floor. @see HACKATHON_PIZZA */
export const pizzaPrice = () => Math.max(50, Math.round(incomeNow() * HACKATHON_PIZZA));

/** When a spot for the slop pit was last looked for. @see openSlopPit */
let slopTriedAt = -Infinity;

/** How the town's houses are growing and declining. @see world/agents/services */
let evolution: Evolution = createEvolution();
export const getEvolution = () => evolution;

/** What the ports have earned. @see world/boats/exports */
let exports_: Exports = createExports();
export const getExports = () => exports_;

/** New hires on their way to the map, and moving in. @see world/agents/arrivals */
let arrivals: Arrivals = createArrivals();
export const getArrivals = () => arrivals;

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
  /** The building under the pointer that opens something when clicked, by id; null for none. @see opensSomething */
  hoverOpen: number | null;
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
   * Step the water with the WebGPU compute passes instead of the host solver.
   *
   * ON BY DEFAULT NOW, and the reason it was not is worth keeping: the host
   * solver is the REFERENCE — the one the render tests hold to account and the
   * one every comparison is measured against — so putting a map on the device
   * path without anybody asking meant water nobody had chosen. What changed is
   * that the two are now held to each other rather than taken on trust.
   * `__waterCompare` diffs the paths pixel for pixel, `?gpucheck` diffs the
   * solvers pass by pass, and the reference is a toggle away.
   *
   * What it buys is the difference between a map that is pleasant at any size
   * and one that is not. On a settling 128² map the host solver spends about
   * 14ms a frame against the device's 0.2, and the gap is all in the first
   * seconds after a generate — which is exactly when somebody is looking.
   *
   * STILL NOT PERSISTED, and it degrades rather than fails: with no WebGPU, a
   * device that never arrived, or one that has been lost, the effect that
   * builds the solver falls straight through to the host path and the flag is
   * inert. So this is a preference for the better path where there is one, not
   * a claim that there is one.
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
  /**
   * The seed the current map was generated from, or null if it was authored,
   * loaded from a file, or built by a fixture.
   *
   * Kept so the editor can SHOW it: a map you like is worth being able to write
   * down, and a map that generated badly is worth being able to report. Not
   * persisted in the store — the map itself is saved, so the seed is a label on
   * it rather than the way it is restored.
   */
  seed: number | null;
  /**
   * What KIND of map the next generate makes.
   *
   * The other half of the seed, and held separately for the same reason it is
   * a separate input: the seed picks which map, these pick its weather. Kept
   * across generates so a player can hold one and move the other, which is the
   * only way to see what a knob does. @see GenParams
   */
  gen: GenParams;
  /**
   * Whether the game's rules apply, rather than the editor's.
   *
   * Off is the authoring surface: every tool, no costs, build anywhere. On is
   * the game — housing needs frontage and has to be paid for. One flag rather
   * than two routes, so the same scene, the same store and the same renderer
   * serve both and there is no second code path to keep in step.
   */
  playing: boolean;
  setPlaying: (on: boolean) => void;
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
  /**
   * Bumped when a boat is put on or taken off. Boats are not edits and bump no
   * `revision`, but they are in the map file, so autosave watches this too.
   * @see startAutosave
   */
  boatRev: number;
  /**
   * A PROJECT whose site is being chosen: the build tool is in hand with its
   * building, and the next click lays out its site rather than buying
   * anything. Null otherwise. @see startProject, game/projects
   */
  placingProject: ProjectId | null;
  /** Bumped when a site is laid out, a load arrives, or a project opens: worth saving. */
  projectRev: number;
  /**
   * The cell last CLICKED with the look tool, and a count so clicking the
   * same cell twice is still news. @see CompanyMap, which opens what a
   * clicked building is for
   */
  lookedAt: { x: number; y: number; n: number } | null;
  lookAt: (cell: { x: number; y: number }) => void;
  /** Choose a site for a project: the next click lays it out. Null puts the choice down. */
  placeProject: (id: ProjectId | null) => void;
  /** How much of the company works on a site. @see PRIORITY_SHARE */
  setProjectPriority: (structureId: number, priority: Priority) => void;
  /**
   * Stand up, finished, every project a company has already earned what it
   * opens: one that employed vibe coders before projects existed gets its
   * studio, on the best spot near the middle of its map. @see game/projects
   */
  foundEarnedProjects: (owned: Partial<Record<string, number>>, features?: ReadonlySet<FeatureId>) => void;
  /**
   * EVERYONE HOME: whoever should live on the map moved in at once — after
   * time away, or into housing from before lots. @see settleHousing
   */
  settleHousing: (owned: Partial<Record<string, number>>, remote: Partial<Record<string, number>>) => void;
  /**
   * What the game last refused, and when: a build that could not go there, or
   * could not be paid for. Shown over the build bar for a moment. Null for
   * nothing to say. @see BuildBar
   */
  notice: { text: string; at: number } | null;
  /**
   * THE LAST BUILD, in the game, while it can still be taken back: what it
   * cost, and when. @see undoLastBuild
   */
  lastBuild: { at: number; refund: number } | null;
  /** Take back the last build, if it is recent and nothing has been done since, and refund it. */
  undoLastBuild: () => void;
  /** What is happening to the town, and coming. @see world/events */
  events: GameEvent[];
  setEvents: (events: GameEvent[]) => void;
  /** Answer an event with one of its choices. @see slopChoices */
  respondToEvent: (id: number, choice: string) => void;
  /** Whether houses are tinted by how happy they are. @see moodTint */
  moodOverlay: boolean;
  setMoodOverlay: (on: boolean) => void;
  /** Whether the streets are tinted by what they earn. @see liveStreetEarnings */
  earningsOverlay: boolean;
  setEarningsOverlay: (on: boolean) => void;
  /** Whether the wonders menu is open. @see WondersPanel */
  wondersOpen: boolean;
  setWondersOpen: (open: boolean) => void;
  /** What the AI did while nobody was watching, to say once; null when said. @see catchUpAi */
  aiReport: string[] | null;
  setAiReport: (report: string[] | null) => void;
  /** The AI's latest memos to the company, newest last. @see world/ai/memos */
  aiMemos: { text: string; at: number }[];
  pushAiMemo: (text: string) => void;
  dismissAiMemos: () => void;
  /** Whether each building wears a label of what it is and how it is doing. @see BuildingLabels */
  labels: boolean;
  setLabels: (on: boolean) => void;
  /**
   * Put the slop pit on the map, beside the studio, if it is not there yet.
   * Not something to undo, or to pay for. @see SLOP_PIT
   */
  openSlopPit: () => void;
  /**
   * Whether the map is out of sight — on a phone's other tab — and not worth
   * drawing. The town goes on; only the drawing stops.
   */
  mapHidden: boolean;
  setMapHidden: (hidden: boolean) => void;
  /** Buy the parcel of land a cell is in, if it is for sale and affordable. @see world/land */
  buyParcel: (c: Cell) => void;
  /**
   * Old buildings on the land a new company has yet to buy: one on about half
   * its parcels, by the road, the same each time for the same `seed`. Not an
   * edit to undo. @see DERELICT
   */
  placeDerelicts: (land: readonly number[], seed: number) => void;
  /** A café by the road on the company's own land, free: a founding gift. @see foundingCafe */
  foundCafe: () => void;
  /** Housing whose residents changed: redrawn, and saved. @see stepArrivals */
  housingMoved: (ids: readonly number[]) => void;
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
  setHoverOpen: (id: number | null) => void;
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
  loadGrid: (g: Grid, palette?: (string | null)[], boats?: readonly SavedBoat[]) => void;
  /**
   * Found a company on fresh ground: terrain and a road, from a seed.
   *
   * Goes through `loadGrid` like a loaded file does, so the history, the water
   * field and the road network are all rebuilt for the new map rather than
   * carrying over from the old one.
   */
  /**
   * A new map from the generator. With `params`, by those settings rather
   * than the editor's own — the land a player chose when founding. @see MapSetup
   */
  generateWorld: (seed: number, size?: number, params?: GenParams) => void;
  /** Change one generation parameter. Does NOT regenerate — press generate. */
  setGenParam: (key: keyof GenParams, value: number) => void;
  /** Put every generation parameter back to its default. */
  resetGenParams: () => void;
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
  /**
   * THE SURFACE, not the ground under it, for the same reason `edgeHeight`
   * wants the surface: a span over a river is paved ground at a level of its
   * own, and the terrain beneath it is the riverbed.
   *
   * Asked for the terrain, this derived a RAMP at every tile of every bridge
   * — the derivation compares a paved cell against its paved neighbours and
   * saw a road stepping up and down a channel bed — and it did it on POURING
   * WATER, because a water tool touches the surface and every surface edit
   * re-derives the ramps around it. What that looked like was a road with
   * slopes cut across it appearing the moment you poured anywhere near it.
   *
   * Read off the GRID rather than the builder: `deck` is not a `LayerKey`,
   * and nothing in an edit command changes one, so the grid is current.
   * @see Grid.deck, surfaceHeightAt
   */
  height: (x, y) => {
    const i = idx(grid, x, y);
    return grid.deck[i] !== 0 ? grid.deckZ[i] : b.peek("height", x, y);
  },
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

/**
 * Whether the cell readout starts on: `?readout=0` to hide it, `1` to show.
 *
 * WRITTEN AS A VALUE rather than as a bare presence flag like `?gpucheck`,
 * because unlike those this one is ON by default — a flag whose presence
 * turns something on says nothing about turning it off, and off is the
 * interesting request here. Absent leaves it on, and anything unparseable
 * leaves it on too: a typo in a query string should not quietly take a
 * readout away. @see Overlays.readout
 */
export function readoutFromUrl(search?: string): boolean {
  const from = search ?? (typeof location === "undefined" ? null : location.search);
  if (from === null) return true;
  const want = new URLSearchParams(from).get("readout");
  if (want === null) return true;
  return want !== "0" && want !== "false" && want !== "off";
}

const START_READOUT = readoutFromUrl();

const START_FIXTURE = fixtureFromUrl();
/**
 * Whether this session opened on a `?fixture=`. Then the fixture IS the map:
 * the saved one is not loaded over it, and nothing is saved, so looking at a
 * rig can never write over the map somebody built. @see startAutosave
 */
export const startedOnFixture = () => START_FIXTURE !== null;
/** The fixture this session opened on, if any. */
export const startFixture = () => START_FIXTURE;
/**
 * The generator's settings as they were left. @see loadGenParams
 *
 * Read once, here, rather than in the initialiser below, because the SIZE is
 * one of them and the first grid is built before the store exists.
 */
const START_GEN = loadGenParams();
const START_SIZE = (START_FIXTURE && FIXTURE_SIZE[START_FIXTURE]) ?? START_GEN.size;

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
  hoverOpen: null,
  drawnBands: 0,
  openEdge: OPEN_EDGE_DEFAULT,
  gpuWater: true,
  overlays: {
    grid: true, bands: false, height: false, origin: true, faces: true,
    net: false, mask: false, gaps: false, xray: false,
    readout: START_READOUT,
  },
  seed: null,
  gen: START_GEN,
  playing: false,
  setPlaying: (playing) => set({ playing }),
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
  boatRev: 0,
  placingProject: null,
  projectRev: 0,
  lookedAt: null,
  lookAt: (cell) => set({ lookedAt: { x: cell.x, y: cell.y, n: (get().lookedAt?.n ?? 0) + 1 } }),
  placeProject: (id) => {
    const p = id ? projectDef(id) : null;
    // ONE PROJECT AT A TIME, in the game. @see projectUnderWay
    const busy = p && get().playing ? projectUnderWay(get().grid) : null;
    if (busy && busy.id !== p!.id) {
      set({ notice: { text: `One project at a time: ${busy.name} first`, at: Date.now() } });
      return;
    }
    // A FORK taken the other way. @see ruledOut
    const rival = p && get().playing ? ruledOut(get().grid, p) : null;
    if (rival) {
      set({ notice: { text: `${p!.name} or ${rival.name}: you chose ${rival.name}`, at: Date.now() } });
      return;
    }
    if (p) set({ placingProject: id, tool: "placeStructure", structureDefId: p.structure, brush: "point", brushRadius: 0 });
    else set({ placingProject: null, tool: "inspect" });
  },
  labels: true,
  setLabels: (on) => set({ labels: on }),
  events: [],
  setEvents: (events) => set({ events }),
  respondToEvent: (id, choice) => {
    const st = get();
    const ev = st.events.find((e) => e.id === id);
    if (!ev || ev.phase === "over") return;
    if (ev.kind === "slop-overflow") {
      if (choice === "drain") useSlopPitStore.getState().drain();
      if (choice === "trucks") {
        const pit = [...st.grid.structures.values()].find((s) => s.def === "slop-pit");
        if (!pit || haulersOut > 0 || !network) return;
        const price = sludgeTruckPrice();
        if (useMoneyStore.getState().money.lt(price)) {
          set({ notice: { text: `Not enough money for the sludge trucks: ${formatCurrency(price)}`, at: Date.now() } });
          return;
        }
        useMoneyStore.getState().spendMoney(price);
        haulersOut += sendSludgeTrucks(town, st.grid, network, pit, SLUDGE_TRUCKS);
      }
    }
    // A CHOICE PAID FOR IS KEPT: nobody gets their money back by changing their mind.
    if (ev.chosen && CHOICE_PRICE[ev.chosen]) return;
    const priced = CHOICE_PRICE[choice];
    if (priced && ev.kind !== "slop-overflow") {
      const price = priced();
      if (useMoneyStore.getState().money.lt(price)) {
        set({ notice: { text: `Not enough money: ${formatCurrency(price)}`, at: Date.now() } });
        return;
      }
      useMoneyStore.getState().spendMoney(price);
    }
    set({ events: get().events.map((e) => (e.id === id ? { ...e, chosen: choice } : e)) });
  },
  moodOverlay: false,
  setMoodOverlay: (moodOverlay) => set({ moodOverlay }),
  earningsOverlay: false,
  setEarningsOverlay: (earningsOverlay) => set({ earningsOverlay }),
  wondersOpen: false,
  setWondersOpen: (wondersOpen) => set({ wondersOpen }),
  aiReport: null,
  setAiReport: (aiReport) => set({ aiReport }),
  aiMemos: [],
  pushAiMemo: (text) => set((s) => ({ aiMemos: [...s.aiMemos, { text, at: Date.now() }].slice(-3) })),
  dismissAiMemos: () => set({ aiMemos: [] }),
  notice: null,
  lastBuild: null,
  undoLastBuild: () => {
    const st = get();
    if (!st.lastBuild || Date.now() - st.lastBuild.at > UNDO_WINDOW_MS) return;
    // Only if the top of the history is still that build, all of it.
    if (!buildCmds.length || peekUndo(history) !== buildCmds[buildCmds.length - 1]) { set({ lastBuild: null }); return; }
    for (let k = buildCmds.length - 1; k >= 0; k--) {
      if (peekUndo(history) !== buildCmds[k]) break;
      get().doUndo();
    }
    useMoneyStore.getState().increaseMoney(st.lastBuild.refund);
    buildCmds = [];
    set({ lastBuild: null });
  },
  mapHidden: false,
  setMapHidden: (mapHidden) => set({ mapHidden }),
  foundCafe: () => {
    const st = get();
    const def = structureDef("cafe");
    const spot = def && nearestSpot(st.grid, def, playRules(st.grid));
    const cmd = spot && placeCommand(st.grid, def!, spot.x, spot.y, playRules(st.grid));
    if (!cmd) return;
    commit(st.grid, history, cmd);
    if (water && touchesSurface(cmd)) syncGround(water, st.grid);
    if (network && touchesNetwork(cmd)) rebuildNet(network, st.grid);
    history = createHistory();
    set({ revision: get().revision + 1, ...historyMeta(), ...netMeta() });
  },
  placeDerelicts: (land, seed) => {
    const st = get();
    let r = seed >>> 0;
    const rand = () => { r = (r + 0x6d2b79f5) >>> 0; let t = r; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    let changed = false;
    for (let p = 0; p < PARCELS * PARCELS; p++) {
      if (land.includes(p) || rand() < 0.5) continue;
      const rect = parcelRect(st.grid, p);
      const rules = { needsRoad: true, owned: (x: number, y: number) => parcelOf(st.grid, x, y) === p };
      // A few tries at random spots in the parcel; none by a road and it has none.
      for (let k = 0; k < 40; k++) {
        const x = rect.x0 + Math.floor(rand() * (rect.x1 - rect.x0)), y = rect.y0 + Math.floor(rand() * (rect.y1 - rect.y0));
        const cmd = placeCommand(st.grid, DERELICT, x, y, rules);
        if (!cmd) continue;
        commit(st.grid, history, cmd);
        if (water && touchesSurface(cmd)) syncGround(water, st.grid);
        if (network && touchesNetwork(cmd)) rebuildNet(network, st.grid);
        changed = true;
        break;
      }
    }
    if (changed) {
      history = createHistory();
      set({ revision: get().revision + 1, ...historyMeta(), ...netMeta() });
    }
  },
  buyParcel: (c) => {
    const st = get();
    const land = companyLand();
    if (!st.playing || !land) return;
    const p = parcelOf(st.grid, c.x, c.y);
    if (land.includes(p)) return;
    if (!buyable(land, p)) {
      set({ notice: { text: "Buy the land next to yours first", at: Date.now() } });
      return;
    }
    const price = parcelPrice();
    if (useMoneyStore.getState().money.lt(price)) {
      set({ notice: { text: `Not enough money for this land: ${formatCurrency(price)}`, at: Date.now() } });
      return;
    }
    useMoneyStore.getState().spendMoney(price);
    useSessionStore.getState().setLand([...land, p].sort((a, b) => a - b));
    set({ revision: st.revision + 1 });
  },
  openSlopPit: () => {
    const st = get();
    for (const s of st.grid.structures.values()) if (s.def === SLOP_PIT.id) return;
    // Looking for a spot walks the whole map: not every frame, if there is none.
    const now = Date.now();
    if (now - slopTriedAt < 5000) return;
    slopTriedAt = now;
    const studio = [...st.grid.structures.values()].find((s) => s.def === "studio");
    const spot = nearestSpot(st.grid, SLOP_PIT, {}, studio ? { x: studio.x + 1, y: studio.y + 1 } : undefined);
    const cmd = spot && placeCommand(st.grid, SLOP_PIT, spot.x, spot.y, {});
    if (!cmd) return;
    const touched = commit(st.grid, history, cmd);
    if (water && touchesSurface(cmd)) syncGround(water, st.grid);
    if (network && touchesNetwork(cmd)) rebuildNet(network, st.grid);
    history = createHistory();
    set({ revision: st.revision + 1, lastTouched: markDirty(st.grid, touched, true), ...historyMeta(), ...netMeta() });
  },
  settleHousing: (owned, remote) => {
    // A FIXTURE'S HOUSES ARE AS IT BUILT THEM. It is a rig, not the company's
    // town, and spreading the company's six interns over it emptied every
    // house in the gallery back to a lot. @see startedOnFixture, buildProjects
    if (startedOnFixture()) return;
    get().housingMoved(settleHousing(get().grid, owned, remote));
  },
  housingMoved: (ids) => {
    if (!ids.length) return;
    const st = get();
    const cells: number[] = [];
    for (const id of ids) {
      const s = st.grid.structures.get(id);
      if (s) cells.push(idx(st.grid, s.x, s.y));
    }
    set({ revision: st.revision + 1, lastTouched: markDirty(st.grid, cells, false) });
  },
  foundEarnedProjects: (owned, features = new Set()) => {
    const st = get();
    const built = builtProjects(st.grid);
    const rules = st.playing ? playRules(st.grid) : {};
    let changed = false;
    for (const p of PROJECTS) {
      if (!alreadyEarned(p, owned, features) || built.has(p.id) || siteOf(st.grid, p)) continue;
      const def = structureDef(p.structure);
      // On its own land if it fits there; anywhere on the road if not.
      const spot = def && (nearestSpot(st.grid, def, rules) ?? (st.playing ? nearestSpot(st.grid, def, { needsRoad: true }) : null));
      const cmd = spot && placeCommand(st.grid, def!, spot.x, spot.y, rules);
      if (!cmd) continue;
      commit(st.grid, history, cmd);
      if (water && touchesSurface(cmd)) syncGround(water, st.grid);
      if (network && touchesNetwork(cmd)) rebuildNet(network, st.grid);
      changed = true;
    }
    // Not something to undo: the company already had it.
    if (changed) {
      history = createHistory();
      set({ revision: get().revision + 1, projectRev: get().projectRev + 1, ...historyMeta(), ...netMeta() });
    }
  },
  setProjectPriority: (structureId, priority) => {
    const b = get().grid.structures.get(structureId)?.build;
    if (!b) return;
    b.priority = priority;
    set({ projectRev: get().projectRev + 1 });
  },
  lastTouched: [],
  // Counted, not assumed: a `?fixture=` builds its roads into the first grid
  // and never goes through `loadGrid`, so a nought here stayed nought.
  ...netMeta(),
  undoDepth: 0,
  redoDepth: 0,
  undoName: null,
  redoName: null,
  pickNudge: 0,
  setViewport: (viewport) => set({ viewport }),
  setHover: (hover) => set({ hover }),
  setHoverOpen: (hoverOpen) => { if (get().hoverOpen !== hoverOpen) set({ hoverOpen }); },
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
    fleet = createFleet();
    traffic = createTraffic();
    town = createTown();
    works = createWorks();
    arrivals = createArrivals();
    exports_ = createExports();
    evolution = createEvolution();
    setWaterEdge(water, get().openEdge);          // a new field, the same world
    dirty.clear();
    set({
      grid, hover: null, hoverOpen: null, stroke: null,
      revision: 0, lastTouched: [], ...historyMeta(), ...netMeta(),
    });
  },

  // Any other tool, or any other building, puts down a site being chosen.
  setTool: (tool) => set({ tool, stroke: null, placingProject: null }),
  setStructureDef: (structureDefId) => set({ structureDefId, placingProject: null }),
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
    // What a road stroke cost, for taking it back. @see undoLastBuild
    let roadPaid = 0;
    // A STRUCTURE is placed at one cell by one command, so it skips the stroke
    // machinery — brush size and drag shape mean nothing to it.
    // LOTS GO DOWN IN A LINE: dragged along a street, a lot on every cell of
    // the drag that will take one, each paid for, until the money runs out.
    // @see lotLine
    if (s0.tool === "buyLand") {
      set({ stroke: null });
      get().buyParcel(s0.head);
      return;
    }
    if (isStructureTool(s0.tool)) {
      const line = lotLine(st, s0);
      if (!line) { get().commitStructure(s0.head); return; }
      let placed = 0;
      // A fresh build to take back: the row, not the row and what came before.
      buildCmds = [];
      set({ lastBuild: null });
      batching = true;
      for (const c of line) {
        const before = get().grid.structures.size;
        get().commitStructure(c);
        if (get().grid.structures.size > before) placed++;
        else if (/Not enough money/.test(get().notice?.text ?? "")) break;
      }
      batching = false;
      // Some cells along a street will not take a lot — a road, a building —
      // and that is not news if others did.
      if (placed > 0 && !/Not enough money/.test(get().notice?.text ?? "")) set({ notice: null });
      return;
    }
    // A BOAT goes on the water under the click, or the one there comes off.
    // Live state like the water: not an edit, and nothing to undo. @see fleet
    if (s0.tool === "boat") {
      const cols = water?.columns;
      if (cols && !removeBoatNear(fleet, s0.head.x, s0.head.y)) {
        addBoat(fleet, cols, s0.head.x, s0.head.y);
      }
      set({ stroke: null, boatRev: st.boatRev + 1 });
      return;
    }

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
    } else if (isPipeTool(s0.tool) && st.playing) {
      // THE PIPE TOOL, in the game: a run on the company's own land, paid a
      // tile at a time for the new tiles, all or none, every end facing what
      // it should. @see gamePipeRun, pipeCost
      const land = companyLand();
      if (land && cells.some((c) => !ownsTile(st.grid, land, c.x, c.y))) {
        set({ stroke: null, notice: { text: "Not your land: buy it first", at: Date.now() } });
        return;
      }
      const from = s0.anchor;
      // Water as it stands now, where the map is running it. @see depthAt
      const wet = (x: number, y: number) => st.grid.pool[idx(st.grid, x, y)] > 0 || (!!water && depthAt(water, x, y) > WET_DEPTH);
      // In order along the stroke: a route as given, a line from where it went down.
      const ordered = s0.path ? cells : [...cells].sort((a, b) => Math.abs(a.x - from.x) + Math.abs(a.y - from.y) - Math.abs(b.x - from.x) - Math.abs(b.y - from.y));
      const run = gamePipeRun(st.grid, ordered, wet);
      if ("refused" in run) { set({ stroke: null, notice: { text: run.refused, at: Date.now() } }); return; }
      const fresh = run.filter((c) => !st.grid.pipe[idx(st.grid, c.x, c.y)]).length;
      const price = pipeCost(fresh);
      if (fresh > 0 && !spendForBuild(price)) {
        set({ stroke: null, notice: { text: `Not enough money for ${fresh} tiles of pipe: ${formatCurrency(price.toNumber())}`, at: Date.now() } });
        return;
      }
      for (const c of run) {
        const had = st.grid.pipe[idx(st.grid, c.x, c.y)];
        b.set("pipe", c.x, c.y, c.facing);
        b.set("fluid", c.x, c.y, st.fluidMaterial);
        if (!had) b.set("pipeZ", c.x, c.y, c.z);
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
      // ROAD COSTS MONEY in the game, a tile at a time — new tiles only, and
      // the whole stroke or none of it. Lifting road is free. @see roadCost
      // AND ONLY ON THE COMPANY'S OWN LAND, laid or lifted. @see world/land
      const land = companyLand();
      if (st.playing && land && cells.some((c) => !ownsTile(st.grid, land, c.x, c.y))) {
        set({ stroke: null, notice: { text: "Not your land: buy it first", at: Date.now() } });
        return;
      }
      // THE AI'S STREETS, from the Overseer on: its district's roads are its
      // to lay and lift, and the player's road tools stop at its edge.
      // Not on The Model's own runs, nor for the AI itself. @see aiDistrict
      if (st.playing && !aiActing() && aiHoldsRoads()) {
        const d = aiDistrict(st.grid, stageOf(useAiSingularityStore.getState().value).stage);
        if (cells.some((c) => inDistrict(d, c.x, c.y))) {
          set({ stroke: null, notice: { text: "The AI manages the streets in its district", at: Date.now() } });
          return;
        }
      }
      if (st.playing && s0.tool === "paintRoad") {
        const fresh = cells.filter((c) => st.grid.paved[c.y * st.grid.w + c.x] === VOID_MATERIAL).length;
        const price = roadCost(fresh);
        if (fresh > 0 && !spendForBuild(price)) {
          set({ stroke: null, notice: { text: `Not enough money for ${fresh} tiles of road: ${formatCurrency(price.toNumber())}`, at: Date.now() } });
          return;
        }
        if (fresh > 0) roadPaid = price.toNumber();
      }
      for (const c of cells) b.set("paved", c.x, c.y, value);
      // THE LIFT TOOL LIFTS PIPE TOO, in the game: its water goes back on the
      // ground. @see spillOrphaned
      if (st.playing && s0.tool === "eraseRoad") {
        for (const c of cells) if (st.grid.pipe[idx(st.grid, c.x, c.y)]) b.set("pipe", c.x, c.y, 0);
      }
    } else {
      const value = s0.tool === "erase" ? VOID_MATERIAL : st.material;
      for (const c of cells) b.set("terrain", c.x, c.y, value);
    }
    // A TERRAIN SLOPE already placed follows the ground it is on. Placing one
    // stays deliberate — nothing here creates a slope that was not asked for —
    // but leaving an existing one at its old direction and rise after the
    // ground moved under it draws a tilt the heightmap does not have.
    //
    // ONLY WHERE THE GROUND OR THE ROAD COULD HAVE MOVED: a slope follows the
    // heights, and a paved cell is left to the road. Every other tool changes
    // neither, and asked anyway this walked the footprint and its neighbours
    // to find nothing — on a pour dragged over a 128 tile map, part of a 30 ms
    // hitch on letting go. @see derivedSlope
    if (!isSlopeTool(s0.tool) && (isHeightTool(s0.tool) || isRoadTool(s0.tool))) {
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
    //
    // NOT FOR WATER, which it used to be: a road ramp is a function of the
    // paved layer and the heights, and pouring or draining writes neither — it
    // writes `fluid`. Asked anyway, a pour over a 128 tile map re-derived every
    // cell's ramp and its neighbours' to get the same answers, 12 to 32 ms of
    // the hitch on letting go. @see rampNeed
    if (!isSlopeTool(s0.tool) && (isRoadTool(s0.tool) || isHeightTool(s0.tool))) {
      const read = readerFor(b, st.grid);
      for (const c of heightDirtyCells(st.grid, cells)) {
        b.set("ramp", c.x, c.y, derivedRamp(read, c.x, c.y));
      }
    }

    const cmd = b.build(strokeLabel(s0, cells.length));
    if (!cmd) { set({ stroke: null }); return; }   // no-op click adds no history
    const touched = commit(st.grid, history, cmd);
    if (roadPaid > 0) recordBuild(cmd, roadPaid);
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
    // A PROJECT'S SITE, being laid out: placed like its building, with the
    // build record on it, and nothing paid — materials are paid for as they
    // are sent. @see startSiteCommand
    const project = st.placingProject ? projectDef(st.placingProject) : null;
    if (project && st.tool === "placeStructure" && st.structureDefId === project.structure) {
      const busy = st.playing ? projectUnderWay(st.grid) : null;
      if (busy) {
        set({ stroke: null, placingProject: null, tool: "inspect", notice: { text: `One project at a time: ${busy.name} first`, at: Date.now() } });
        return;
      }
      const siteRules = {
        ...(st.playing ? playRules(st.grid) : {}),
        ...(water && (structureDef(project.structure)?.placement?.riverside || structureDef(project.structure)?.placement?.nearRiver)
          ? { rivers: mapRiver(st.grid, tileDepthOf(water.columns)) } : {}),
      };
      // Priced off the income now, in play; the editor never charges.
      const cmd = startSiteCommand(st.grid, project, c.x, c.y, siteRules, Date.now(), st.playing ? incomeNow() : 0);
      if (!cmd) {
        const def = structureDef(project.structure);
        const why = def ? validatePlacement(st.grid, def, c.x, c.y, siteRules).reason : undefined;
        set({ stroke: null, ...(st.playing ? { notice: { text: why ? `Can't build here: ${why}` : "Can't build here", at: Date.now() } } : {}) });
        return;
      }
      const touched = commit(st.grid, history, cmd);
      if (water && touchesSurface(cmd)) syncGround(water, st.grid);
      if (network && touchesNetwork(cmd)) rebuildNet(network, st.grid);
      set({
        stroke: null, placingProject: null, tool: "inspect",
        revision: st.revision + 1, projectRev: st.projectRev + 1,
        lastTouched: markDirty(st.grid, touched, true),
        ...historyMeta(), ...netMeta(),
      });
      return;
    }
    const def = structureDef(st.structureDefId);
    const demolishing = st.tool === "demolish";
    // THE GAME'S RULES, NOT THE EDITOR'S. Frontage is a rule of play; the
    // editor has to stay able to author a building anywhere. @see PlaceRules
    // CLICKING A BUILDING THAT HAS A NEXT TIER upgrades it, whatever is
    // selected: a seaport grows into the next seaport where it stands. @see upgradeCommand
    const under = structureAt(st.grid, c.x, c.y);
    const upgrade = !demolishing && under >= 0
      ? structureDef(structureDef(st.grid.structures.get(under)?.def ?? "")?.upgradesTo ?? "")
      : null;
    const target = upgrade ?? def;
    const rules = {
      ...(st.playing ? playRules(st.grid) : {}),
      // THE RIVERS AS THEY STAND, for a building that must be on a bank. A
      // fact about the building, so the editor obeys it too. @see riverside
      ...(water && (target?.placement?.riverside || target?.placement?.nearRiver)
        ? { rivers: mapRiver(st.grid, tileDepthOf(water.columns)) } : {}),
    };
    const cmd = demolishing
      ? demolishCommand(st.grid, under)
      : upgrade
        ? upgradeCommand(st.grid, under, rules)
        : def && placeCommand(st.grid, def, c.x, c.y, rules);
    // A REFUSAL SAYS WHY, in the game: a click that does nothing and says
    // nothing reads as broken. @see WorldState.notice
    const refuse = (text: string) => { set({ stroke: null, ...(st.playing ? { notice: { text, at: Date.now() } } : {}) }); };
    // What this build cost, for taking it back. @see undoLastBuild
    let paid = 0;
    if (!cmd) {
      const why = !demolishing && !upgrade && def ? validatePlacement(st.grid, def, c.x, c.y, rules).reason : undefined;
      refuse(why ? `Can't build here: ${why}` : "Can't build here");
      return;
    }
    // ONLY ON THE COMPANY'S OWN LAND does anything come down, either. @see world/land
    const land = companyLand();
    if (st.playing && demolishing && land && !ownsTile(st.grid, land, c.x, c.y)) { refuse("Not your land: buy it first"); return; }
    // THE SLOP PIT is not the company's to fill in: it is where the slop goes.
    if (st.playing && demolishing && st.grid.structures.get(under)?.def === SLOP_PIT.id) { refuse("The slop pit stays: drain it instead"); return; }
    // A DERELICT costs to clear. @see DERELICT
    if (st.playing && demolishing && st.grid.structures.get(under)?.def === "derelict") {
      const price = new Decimal(clearingPrice());
      if (!spendForBuild(price)) { refuse(`Not enough money to clear it: ${formatCurrency(price.toNumber())}`); return; }
    }
    // NOR SERVICES OR PORTS before the projects that open them. @see featureGateOpen
    if (st.playing && !demolishing && target) {
      if (serviceOf(target.id) && !featureGateOpen("services")) { refuse("Services need the Town Hall"); return; }
      if (target.port && !featureGateOpen("ports")) { refuse("Seaports need the Harbour Office"); return; }
    }
    // NO LOTS FOR PEOPLE THE COMPANY CANNOT HIRE: nobody would come to them.
    const lotFor = st.playing && !demolishing && !upgrade && def ? housedBy(def.id)?.id : undefined;
    if (lotFor && !useGeneratorStore.getState().generators.some((g) => g.id === lotFor)) { refuse("Nobody to live there yet"); return; }
    // AND IT HAS TO BE PAID FOR, before anything is committed. Checked and
    // charged together so a refusal cannot leave the money spent — the same
    // order the hiring gate needs, and for the same reason.
    if (st.playing && !demolishing && target) {
      // An upgrade costs the step up, not the whole building again. @see upgradeCost
      const price = upgrade
        ? upgradeCost(st.grid.structures.get(under)!.def, upgrade.id)
        : buildCost(target.id);
      if (!spendForBuild(price)) { refuse(price ? `Not enough money: ${formatCurrency(price.toNumber())}` : "Not for sale"); return; }
      paid = price!.toNumber();
    }
    // HOUSING IN THE GAME IS A LOT: zoned, and empty until somebody arrives
    // to live there. @see world/agents/arrivals
    if (st.playing && !demolishing && !upgrade && def && housedBy(def.id)) {
      for (const s of cmd.structures?.added ?? []) s.residents = 0;
    }
    const touched = commit(st.grid, history, cmd);
    if (paid > 0) recordBuild(cmd, paid);
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

  setGenParam: (key, value) => {
    const gen = withDefaults({ ...get().gen, [key]: value });
    set({ gen });
    saveGenParams(gen);
  },

  resetGenParams: () => {
    // FORGOTTEN rather than overwritten with today's defaults, so a default
    // that changes later still reaches somebody who asked for the defaults.
    forgetGenParams();
    set({ gen: { ...DEFAULT_GEN } });
  },

  // The size comes from the generation settings unless a caller names one —
  // a fixture or a test, which wants the size it asked for and not the panel's.
  generateWorld: (seed, size = get().gen.size, params) => {
    const n = params?.size ?? size;
    const grid = freshGrid(n, n);
    // GRASS, not the current material: a new company should not found on
    // whatever the last thing painted in the editor happened to be.
    const report = generatePlayableMap(grid, {
      seed, material: GRASS, dirt: DIRT, sand: SAND, woods: WOODS,
      params: params ?? get().gen,
    });
    get().loadGrid(grid, [...INITIAL_TERRAIN_PALETTE]);
    // AFTER `loadGrid`, which resets the rest of the map's state — set before,
    // it would be cleared by the load it is describing. The REPORTED seed, not
    // the asked-for one: a reroll for playability returns a different number
    // and the panel must show the map you are actually looking at.
    set({ seed: report.seed });
    if (import.meta.env.DEV) {
      console.info(
        `WORLD: founded on seed ${report.seed} — ${report.road} cells of street`
        + ` along ${report.axis} at height ${report.roadHeight},`
        + ` ${report.frontage} buildable frontage,`
        + ` ${report.river} cells of river feeding ${report.wet} wet`
        + ` from ${report.springs} springs, ${report.wooded} wooded`,
      );
    }
  },

  loadGrid: (grid, palette, boats) => {
    // A map is in memory that belongs to somebody again. @see retireRunSave
    suspendSaving(false);
    history = createHistory();
    network = createNetwork(grid);
    water = createWaterField(grid);
    fleet = createFleet();
    traffic = createTraffic();
    town = createTown();
    works = createWorks();
    arrivals = createArrivals();
    exports_ = createExports();
    evolution = createEvolution();
    // The file's boats, on the file's water. @see restoreFleet
    if (boats?.length) restoreFleet(fleet, water.columns, boats);
    setWaterEdge(water, get().openEdge);          // a new field, the same world
    dirty.clear();   // the scene rebuilds wholesale on a new grid identity
    // A saved map's terrain indices only mean anything against the palette it
    // was saved with, so the file's palette replaces the live one wholesale.
    // Clamp `material` too: the loaded palette can be shorter than the old.
    const next = palette ?? get().palette;
    set({
      grid, palette: [...next], material: Math.min(get().material, next.length - 1),
      hover: null, stroke: null, seed: null,
      revision: 0, lastTouched: [], ...historyMeta(), ...netMeta(),
    });
  },
}));

/**
 * Start saving the map as it changes, and stop when the returned function is
 * called.
 *
 * SUBSCRIBED RATHER THAN SPRINKLED. Every mutator here already bumps
 * `revision` — that is what tells the renderer something moved — so one
 * subscription catches every edit, every undo, every load and every resize,
 * and no future mutator can forget to save. The alternative is a `scheduleSave`
 * call at each of the seven places that mutate, and the eighth one added later
 * without it.
 *
 * EXPLICIT AND NOT AT MODULE SCOPE, so importing this store in a test does not
 * start a timer or reach for `localStorage`. The editor turns it on.
 */
export function startAutosave(): () => void {
  // `?nosave`: a session that must not write the map — a benchmark resizing
  // and flooding scratch maps, say, which would otherwise overwrite the one
  // somebody has spent an evening building. It still LOADS the saved map.
  if (typeof location !== "undefined" && new URLSearchParams(location.search).has("nosave")) {
    return () => {};
  }
  // A FIXTURE SESSION is a rig, not the map. @see startedOnFixture
  if (startedOnFixture()) return () => {};
  const input = () => ({
    grid: useWorldStore.getState().grid,
    // The paved palette is a placeholder the editor has never filled; passed as
    // the file wants it rather than inventing a second shape here.
    palette: { terrain: useWorldStore.getState().palette, paved: [null] },
    water: water ?? undefined,
    fleet,
  });
  // THE GRID'S IDENTITY AS WELL AS ITS REVISION, and the second one alone was
  // a bug. `loadGrid` resets `revision` to zero, so generating a fresh map on
  // a session that had not edited anything went from nought to nought and read
  // as "nothing happened" — the new map was never written, and only the seed
  // being persisted stopped that being data loss. A new grid is always a save.
  let seenRev = useWorldStore.getState().revision;
  let seenGrid = useWorldStore.getState().grid;
  let seenBoats = useWorldStore.getState().boatRev;
  let seenProjects = useWorldStore.getState().projectRev;
  const stop = useWorldStore.subscribe((s) => {
    if (s.revision === seenRev && s.grid === seenGrid && s.boatRev === seenBoats && s.projectRev === seenProjects) return;
    seenProjects = s.projectRev;
    seenRev = s.revision;
    seenGrid = s.grid;
    seenBoats = s.boatRev;
    scheduleSave(input);
  });
  // AND WHATEVER IS ALREADY HERE, if nothing has been saved yet.
  //
  // The map is generated in the editor's first render and this subscription is
  // made in an effect, which runs after — so the baseline above is already the
  // NEW map and the change that produced it is invisible. Watching harder does
  // not help; the event happened before anyone was listening. Writing once at
  // start is what closes it, and it is skipped when a save already exists so a
  // loaded map is not immediately rewritten.
  if (!hasSaved()) scheduleSave(input);
  // THE LAST WRITE BEFORE THE TAB GOES, which is the one that actually matters:
  // a debounce that never fires is a lost map. Same triggers the session store
  // uses for presence. @see App.tsx
  //
  // AND IT WRITES THE WORLD AS IT STANDS, not only a save an edit left queued.
  // Pouring is not an edit, so it bumps no revision and queues nothing: fill a
  // lake after your last edit, close the tab, and this flushed nothing at all —
  // the map came back with the water as it was at that edit, however long ago.
  // Water moves on its own; leaving is always worth a snapshot.
  const flush = () => { scheduleSave(input); saveNow(); };
  const onHide = () => { if (document.visibilityState === "hidden") flush(); };
  document.addEventListener("visibilitychange", onHide);
  window.addEventListener("pagehide", flush);
  return () => {
    stop();
    document.removeEventListener("visibilitychange", onHide);
    window.removeEventListener("pagehide", flush);
    flush();
  };
}

/** Throw the saved map away. A deliberate act — see the reset button. */
export const forgetSavedWorld = () => clearSaved();

