/**
 * World v2 — the Pixi scene.
 *
 * Imperative by design: bands and per-cell sprite handles are built and
 * reconciled directly, with React only mounting the container. Same pattern as
 * v1's `GroundRoadLayer`, but the state it draws from is mutable.
 */
import { fouledHouses, stepPollution } from "./water/pollution";
import { founderIs } from "../game/founder-rules";
import { useThemeStore } from "../state/theme.store";
import { latticeForm } from "../game/quests/finale";
import { BLOCK, SITE, boxAround, clearBlock } from "./ai/arc-rules";
import { useQuestStore } from "../state/quest.store";
import { questWorld } from "./ai/quest-world";
import { walletCap } from "./ai/wallet";
import { HUSTLER_EVENTS } from "../game/founders.catalog";
import { housedBy, residentsIn } from "../game/housing";
import { useInnovationStore } from "../state/innovation.store";
import { createDesireHeat, type DesireHeat } from "./render/desire-heat";
import { createStreetHeat, type StreetHeat } from "./render/street-heat";
import { STAGE_COLOUR, createAiLayer, type AiLayer } from "./ai/ai-layer";
import { inherited } from "./ai/planner";
import { aiFixturePreview, sequenceIntensity, stepSequence } from "./ai/ascension-sequence";
import { catchUpAi, droneAt, getAiRunner, stepAi, stepMemos, vetoAt } from "./ai/ai-runner";
import { VETO_REPLIES } from "./ai/memos";
import { useGenerationStore } from "../state/generation.store";
import { currentPlan, pendingPipe, stepAutopilot } from "./ai/autopilot";
import { useFounderStore } from "../state/founder.store";
import { showMe } from "./play/map-focus";
import { runningAgents, setThrottled, useAgentsStore } from "../state/agents.store";
import { setLatticeReader, stageOf, useAiSingularityStore } from "../state/ai-singularity.store";
import { latticeDone, stepLattice } from "./ai/lattice";
import { liveStreetEarnings, liveStreets, streetName } from "./play/street-earnings";
import { liveDesireMaps } from "./agents/desirability";
import { canAcquire, offerPremium, pendingEquity } from "../game/acquisition";
import { heldHidden } from "./render/hold";
import type { Renderer } from "pixi.js";
import { nappeStepsAt } from "./render/nappe";
import { extend, useApplication, useTick } from "@pixi/react";
import {
  Container, Graphics, RenderTexture, UPDATE_PRIORITY,
  type FederatedPointerEvent,
} from "pixi.js";
import { useCallback, useEffect, useRef, useState } from "react";

import { loadIsometricAtlasTextures } from "../iso/atlas/load-isometric-atlases";
import { demolishLifts, getTownServices, mainWet, drainDirty, playRules, startedOnFixture, startFixture, lotLine, getArrivals, getEvolution, getExports, getFleet, getNetwork, getTown, getTraffic, getWorks, useWorldStore } from "../state/world.store";
import { perfAdd, perfCount, perfFrame } from "./debug/perf";
import { section } from "../hitches";
import {
  bandShown, createBandLayer, destroyBandLayer, setGroundAlpha, setVisibleBands, visibleBandCount,
  type BandLayer,
} from "./render/bands";
import { boundsCentre, fitScale, visibleBandRange, worldBounds } from "./render/camera";
import { buildTerrain, createTerrainLayer, flushTerrain, meshDraws, type TerrainLayer } from "./render/terrain";
import { destroyGroundMesh } from "./render/ground-mesh";
import { buildCliffs, createCliffLayer, syncCliff, type CliffLayer } from "./render/cliffs";
import { buildPaved, createPavedLayer, dressPaved, lodPaved, recountInexact, refreshLooks, syncPaved, type PavedLayer } from "./render/paved";
import { lodFor } from "./render/road-paint";
import { lookDirtyCells } from "./roads/looks";
import {
  createWaterLayer, destroyWaterLayer, drawWater, type WaterLayer,
} from "./render/water";
import {
  attachQuadGather, createGpuWaterLayer, destroyGpuWaterLayer, deviceSinks,
  cullFor, destroyQuadGather, drawGpuWater, gatherQuads, setInstanceCap, showGpuWater, waterOnGpu,
  cheapGradient, zoomedOut,
  type GpuWaterLayer,
} from "./render/water-gpu";
import { checkWaterOverPaving, compareWaterPaths } from "./debug/water-compare";
import { compareSheetPaths } from "./debug/sheet-compare";
import {
  accountDecks, gpuOf, readFloatRows, silenceDecks, type DeckAccount,
} from "./debug/device-read";
import { atBrink } from "./render/corner-rule";
import { FALL_MIN } from "../fluid/falls";
import { crossingPoured } from "./debug/world-scenes";
import {
  clearStructureLayer, createStructureLayer, hasAnimated, refreshStructuresAt, setShownStructures,
  syncStructures, tickStructures, type StructureLayer,
} from "./structures/layer";
import type { RenderCtx } from "./structures/render";
import { AI_BUILDINGS, structureDef } from "./structures/def";
import { planUpgrade, strokeFootprint as structureFootprint, validatePlacement } from "./structures/place";
// Registers the `tiles` strategy. Imported for the side effect: the registry is
// what the layer looks a definition up in, and nothing else references it.
import { setCollapsed } from "./structures/tiles-renderer";
import { buildRoadTable, roadSpriteFor } from "./roads/table";
import { isPaved, maskAt, maskDirtyCells } from "./roads/mask";
import { netIdAt } from "./roads/network";
import { loadIsometricAtlasTextures as _loader } from "../iso/atlas/load-isometric-atlases";
import {
  drawBandStripes, drawGrid, drawHeightTint, drawHover, drawNetComponents,
  drawOrigin, drawPickCrosshair, drawRoadGaps, drawRoadMask,
} from "./render/overlays";
import { drawLaneGraph } from "./render/lane-overlay";
import { buildLaneGraph, type LaneGraph } from "./agents/lanes/graph";

/**
 * How solid the ground stays in x-ray.
 *
 * Faint enough to see a pipe through a hillside, solid enough that the map is
 * still a map — at a tenth you are looking at a wireframe and cannot tell
 * where anything is, and at a half a deep run is still lost behind the cliff
 * columns, which stack and so multiply their own alpha.
 */
const XRAY_GROUND = 0.26;
/** A workplace's tint, by the share of its desks taken: dim when empty, as drawn when full. */
const deskTint = (share: number) => {
  const k = Math.round(255 * (0.55 + 0.45 * Math.max(0, Math.min(1, share))));
  return (k << 16) | (k << 8) | Math.min(255, k + 12);
};
/**
 * Milliseconds a frame the CPU water solver is given, when there is no WebGPU
 * device: half a 60 Hz frame, the rest for drawing it. @see maxStep
 */
const CPU_SOLVE_MS = 8;
/**
 * A damaged building's tint, by what did it: mud from a flood, scorched warm
 * by heat, greyed out by the inspector — so the causes look apart even
 * without their glows. @see damage, conditionsOf
 */
const DAMAGED_TINT: Record<DamageCause, number> = { flood: 0x9a8466, heat: 0xe0a080, closed: 0xa4a8ae, fire: 0x6a5c55, power: 0x707888, quake: 0xb8a690 };
import { createBuildCursor, type BuildCursor, type Validator } from "./edit/cursor";
import { createBoatLayer, type BoatLayer } from "./boats/boats-render";
import { createTownLayer, type TownLayer } from "./agents/town-render";
import { seatsByCell, stepTown, trafficOf, type Seat } from "./agents/town";
import { createEmergency, stepEmergency } from "./agents/emergency";
import { moveOut, stepArrivals } from "./agents/arrivals";
import { liveCoverage, stepEvolution, townChanged, withTier } from "./agents/services";
import { stepTown as stepTownServices } from "./agents/town-services";
import { ladderOf, stepLadder } from "./agents/unlocks";
import { liveBeauty } from "./agents/beauty";
import { WORKPLACES, liveSeating, workplaceKind } from "./agents/commute";
import { liveMoods, moodTint, setFlooded, setFouled, setSludged, stepMood, type Unrest } from "./agents/mood";
import { createLeaders, liveLeadership, stepLeaders } from "./agents/leaders";
import { CONVOY_PAYS, convoyPays, loadPriceMult, setConvoyIn, setStrike } from "./events/convoy";
import { useTeamLeadersEmployeesStore } from "../state/team-leaders.store";
import { CLEANERS_PER_TILE, createCleanup, setCleanupAway, stepCleanup } from "./events/cleanup";
import { usePrestigeStore } from "../state/prestige.store";
import { dryUp, mopAll, ring, sludgeAt, sludgedHouses } from "./events/sludge";
import { emptyFull, slopSpike, stepSlop, tanksOf } from "./slop/tanks";
import { slopRate } from "../game/slop";
import { convoyTally, tallyCall, townMood } from "./events/town-events";
import { createDirector, dueFollowUp, eventStarted, pickEvent, queueFollowUp, tickDirector } from "./events/director";
import { EVENT_DEFS } from "./events/defs";
import { HACKATHON_CODERS } from "./events/defs/hackathon";
import { FLOOD_MS } from "./events/defs/flood";
import {
  droughtDrop, evacuatedAway, floodBaseline, floodedNow, floodMisery, floodPeak, portShut, riseAt, riverHead, setFloodState, soakAway, type FloodBase, type FloodShield,
} from "./events/flood";
import { burn, closeFor, damage, damageCause, damagedNow, firstOverheated, isDamaged, stepRepairs, type DamageCause } from "./events/damage";
import { FIRE_MS, FIRE_SPREAD, HOSE_OUT_MS } from "./events/defs/fire";
import { spreadTargets } from "./events/fire-spread";
import { answerFor, startEvent, stepEvents, type TownView } from "./events/events";
import { busiestJunction, setClosed, tileOf } from "./events/closures";
import { POACH_LEAST, POACH_SHARE, MATCH_SHARE } from "./events/defs/poaching";
import { STRIKE_HOMES, STRIKE_MOOD } from "./events/defs/tenants";
import { getGeneratorCost } from "../utils/generator-utils";
import { AI_TAGS, CARDS, card as cultureCard, rankNow } from "../game/culture";
import { LEVEE_RUSH, leveeCells } from "./events/levee";
import { perMinute, recordCall } from "./boats/exports";
import { buildCost, portCallFee, setRoadsFree } from "../game/build-cost";
import { useMoneyStore } from "../state/money.store";
import { useGeneratorStore, type GeneratorId } from "../state/generators.store";
import { ROUTE_BONUS } from "./events/defs/convoy";
import { fusionNow } from "../game/fusion";
import { skillOf, training, useTrainingStore } from "../state/training.store";
import { useSessionStore } from "../state/session.store";
import { sitesOf, stepWorks } from "./projects/works";
import { announceOpened, ownedNow, payForLoad } from "./projects/economy";
import { stepFleet, wantFleet } from "./boats/fleet";
import { stepTraffic, trafficSteer } from "./boats/traffic";
import "./structures/seaport-renderer";
import "./structures/project-renderer";
import { isStructureTool, strokeFootprint, type Stroke } from "./edit/tools";
import { setPanButtons } from "../utils/viewport-controls";
import { syncCell } from "./render/terrain";
import { footprintCells, idx, inBounds, structureAt, surfaceHeightAt, surfaceSampler, type Grid, type Structure } from "./grid";
import { HEIGHT_UNIT, HH, HW, bandOf, cellToWorld, pickCell, worldToCellF } from "./iso";
import { pourAt, runSources, stepWater, syncGround } from "./water/field";
import { applyPinned, runPerfScene } from "./debug/perf-scene";
import { runPipes } from "./water/pipes";
import { allTanks, hoseFor, onMains, setHeat, stepCooling, tankFor, wateredShare } from "./projects/cooling";
import { HEAT_THIRST, OVERHEAT_SHARE } from "./events/defs/heatwave";
import { CLEAN_RECORD } from "./events/defs/inspector";
import { removeConditions } from "../game/conditions";
import { digReservoir, siteFor } from "./ai/reservoir";
import { isDrinker } from "../game/cooling";
import { pumpUpkeep } from "../game/cooling";
import { createGpuDripLayer, destroyGpuDripLayer, drawGpuDrips, type GpuDripLayer } from "./render/drips-gpu";
import {
  createFallLayer, destroyFallLayer, drawFalls, type FallLayer,
} from "./render/falls-render";
import { createSpike, spikeExpected } from "./render/compute-spike";
import {
  createGpuWater, setDepthBand, setFallList, setReadback, setSkip,
  setWholeMap, type GpuWater,
} from "../fluid/gpu/solver";
import {
  SPRAY_BOUNDS, WIND_BOUNDS, checkPour, checkPourLive, compareFrames, flat,
} from "../fluid/gpu/compare-frames";
import { cpuWaterSaw, gpuWaterHeldBack, gpuWaterSaw, sayWaterSolver } from "./debug/gpu-water-stat";
import { flushStamps, holdStamps, stampsNow } from "./debug/gpu-stamps";
import {
  createGpuFallLayer, destroyGpuFallLayer, drawGpuFalls, type GpuFallLayer,
} from "./render/falls-gpu";
import { COLUMNS_PER_TILE } from "./water/field";
import { pointerRead, type PointerAt } from "./debug/pointer-at";
import { clickTakesOver, takesClick } from "./play/opens";
import { drawOpenHighlight } from "./render/open-highlight";
import { createJuice, type Juice } from "./render/juice";
import { createDisasterFx, type DisasterFx } from "./render/disaster-fx";
import { aiDistrict } from "./ai/district";
import { PLACE_UP, POINT_INSET, createCutaway, occludersOf, type Rect } from "./render/cutaway";

/** How see-through a building out of the way is, when it is not drawn in floors to collapse. */
const CUT_FADE = 0.28;
const CUT_OUTLINE = 0xe8eef4;
import { ambience, sfx } from "../audio/sound";

/** The time of day, 0–1 from midnight; `__dayPhase` holds it, in development, to look at an hour. @see dayPhase */
/** Seconds between Ship It Fridays' release parties, about. */
const SHIP_EVERY = 5;
const phaseNow = () => (import.meta.env.DEV ? (window as unknown as { __dayPhase?: number }).__dayPhase : undefined) ?? dayPhase(Date.now());

/** Movers on the map at which the town sounds as busy as it gets. */
const TOWN_FULL = 80;
import { HOLO_BLOCKED, HOLO_OK, PLAN_HOLOGRAMS, createHolograms, partsOf, createTileHolograms, type HoloSpec, type Holograms, type TileHolo, type TileHolograms } from "./render/holograms";
import { drawnBounds } from "./structures/layer";
import { heldDevice } from "./debug/gpu-device";
import { deviceLost, deviceWhy, onDeviceLost } from "./render/device";
import { rendererAsked } from "./render/use-gpu";
import { roomForUniforms } from "./render/uniform-room";
import {
  compareAccelerate, compareCliffs, pour as pourScene,
  scene as accelScene, spanned, spannedDry, spannedFull, spray,
} from "../fluid/gpu/compare-pass";
import { checkLive } from "../fluid/gpu/check-live";
import { holdDevice } from "./debug/gpu-device";
import { activeBox, MAX_SUBSTEPS, maxStep, substepsFor } from "../fluid/columns";
import { busyness, darkness, dayPhase, drawRain, HEAT_GRADE, mixColour, NIGHT_DARK, NIGHT_GRADE } from "./daylight";
import { inForce } from "../game/culture";
import { cultureNow } from "../game/culture-now";
import { createCultureProps, type CultureProps } from "./render/culture-props";
import { SHOP_LOOK, createShopfronts, type Shopfronts } from "./render/shopfronts";
import { createStreetProps, type StreetProps } from "./render/street-props";
import { createWoods, type Woods } from "./render/woods";
import { createSignals, type Signals } from "./render/signals";
import { createBusStops, type BusStops } from "./render/bus-stops";
import { shopName } from "./agents/shop-names";
import { createLights, type Lights } from "./render/lights";
import { keystone, notable } from "../game/machine";
import { inAiDistrictNow } from "./ai/district";
import { serviceOf } from "./agents/services";

/** The services a Holo-Concierge stands at: those in the AI's district. @see game/machine "concierge" */
const conciergesOf = (g: import("./grid").Grid) =>
  [...g.structures.values()].filter((s) => !s.build && serviceOf(s.def) && inAiDistrictNow(g, s.x, s.y)).map((s) => ({ x: s.x, y: s.y + s.h }));
import { breakableCell, planMain, previewMain, previewSewer, routeMain, runMains, setBackedUp, setBurst } from "./water/mains";
import { BLACKOUT_RADIUS } from "./events/defs/blackout";
import { QUAKE_DAMAGED, QUAKE_MS } from "./events/defs/earthquake";
import { createMainsLayer, type MainsLayer } from "./render/mains-layer";
import { createSewerLayer, type SewerLayer } from "./render/sewer-layer";

/** The main being dragged with the Pipe tool, in the game: its route, and whether it will carry water. @see MainCard */
function mainPreview(): [readonly { x: number; y: number }[] | null, boolean] {
  const st = useWorldStore.getState(), s0 = st.stroke;
  // A LATERAL with the Sewer tool is drawn as a main is. @see planLateral
  if (s0?.tool === "sewer" && s0.lateral) {
    const l = lateralStrokePlan(st.grid, s0, mainWet(st.grid));
    return l?.route ? [l.route, !("refused" in l.plan)] : [null, true];
  }
  if (!st.playing || !s0 || s0.tool !== "pipe") return [null, true];
  const wet = mainWet(st.grid), sewer = !!s0.sewer;
  const route = routeMain(st.grid, s0.anchor, s0.head, wet, sewer);
  if (!route) return [null, true];
  const plan = planMain(st.grid, route, wet, false, sewer);
  if ("refused" in plan) return [route, false];
  return [route, !(sewer ? previewSewer(st.grid, plan.cells) : previewMain(st.grid, st.getWaterField(), plan.cells)).problem];
}
/** The sewer being dragged with the Sewer tool, as it would be laid; null if it can't be. @see sewerStrokePlan */
function sewerGhost(): SewerPlan | null {
  const st = useWorldStore.getState(), s0 = st.stroke;
  if (!s0 || s0.tool !== "sewer" || s0.lateral) return null;
  const p = sewerStrokePlan(st.grid, s0, mainWet(st.grid));
  return p && !("refused" in p) ? p : null;
}
import { lateralStrokePlan, sewerStrokePlan } from "./sewers/tool";
import { busiestNode } from "./sewers/flow";
import type { SewerPlan } from "./sewers/lay";
import { useGlobalSettingsStore } from "../state/global-settings.store";

// Required: <pixiContainer> is only a known element once Container is
// registered with @pixi/react, and without it `rootRef` never populates.
extend({ Container });

/**
 * Built once: the label files never change at runtime. Thick roads only — the
 * thin family is largely unlabelled, so asking for it would produce holes.
 */
const ROAD_TABLE = buildRoadTable("landscape");

/** Tiles round the pointer's cell a building may stand and still be drawn under it. */
const NEAR_HOVER = 8;

/**
 * The structure drawn under a point on the screen, the frontmost if several
 * overlap there — by the bounds of what its renderer drew. Null for none.
 */
function structureHitAt(sl: StructureLayer | null, gx: number, gy: number, only?: (s: Structure) => boolean): Structure | null {
  if (!sl) return null;
  let best: Structure | null = null, bestBand = -Infinity;
  for (const m of sl.mounted.values()) {
    if (only && !only(m.s)) continue;
    const h = m.handle as { sprites?: Container[]; columns?: Container[]; g?: Container };
    const drawn = h.sprites ?? h.columns ?? (h.g ? [h.g] : []);
    const band = m.s.x + m.s.w - 1 + m.s.y + m.s.h - 1;
    if (band <= bestBand) continue;
    if (drawn.some((d) => d.getBounds().rectangle.contains(gx, gy))) { best = m.s; bestBand = band; }
  }
  return best;
}

/**
 * Turn off the renderer's garbage collector. One switch: Pixi's older texture
 * and renderable collectors are only wrappers round it now, and setting them
 * warns that they are deprecated. @see the note where the scene is built
 */
function stopGarbageCollection(renderer: unknown) {
  const r = renderer as { gc?: { enabled: boolean } };
  if (r.gc) r.gc.enabled = false;
}

/** How well the Data Centre is cooled and how full its tank, for the AI layer. @see AiView */
function dcCooling(g: Grid): { cooled: number; tank: number } {
  for (const s of g.structures.values()) {
    if (s.def !== "datacentre" || s.build) continue;
    const t = tankFor(s.id);
    return t ? { cooled: t.share, tank: t.capacity > 0 ? t.level / t.capacity : 1 } : { cooled: 1, tank: 1 };
  }
  return { cooled: 1, tank: 1 };
}

/** A number for each masterplan seen, to tell a new one from the last. */
const planIds = new WeakMap<object, number>();
let planSeq = 0;
const planId = (plan: object) => {
  let id = planIds.get(plan);
  if (id === undefined) { id = ++planSeq; planIds.set(plan, id); }
  return id;
};

/** Pump houses paid from the company's money, a second's upkeep at a time. @see pumpUpkeep */
const PAID_PUMPS = {
  pay: (seconds: number) => {
    const cost = pumpUpkeep(useGeneratorStore.getState().getMoneyPerSecond()) * seconds;
    const money = useMoneyStore.getState();
    if (money.money.lt(cost)) return false;
    money.spendMoney(cost);
    return true;
  },
};

/** A look-tool press let go within this many px of where it went down is a click, not a pan. */
const LOOK_CLICK_SLOP = 5;

export function WorldScene({ screenSize }: { screenSize: { width: number; height: number } }) {
  const rootRef = useRef<Container>(null);
  const blRef = useRef<BandLayer | null>(null);
  const tlRef = useRef<TerrainLayer | null>(null);
  const clRef = useRef<CliffLayer | null>(null);
  const plRef = useRef<PavedLayer | null>(null);
  const slRef = useRef<StructureLayer | null>(null);
  const flRef = useRef<WaterLayer | null>(null);
  // The water's mesh is built in a vertex shader unless `?cpuwater=1` asks for
  // the CPU builder. Only one of the two ever exists: they draw into the same
  // band containers, and both would draw the same water twice.
  const gpuRef = useRef<GpuWaterLayer | null>(null);
  // THERE IS NO SECOND MESH ANY MORE, and that is the whole of the bridge
  // work. A deck used to be a field of its own with a layer of its own
  // drawn over the first, and two meshes is two meshes however carefully
  // they are levelled — the join at the mouth of a span was visible because
  // it WAS a join. A column has slots in it now and one mesh spans all of
  // them: the road's water and the deck's water average into the same
  // corner vertices, so there is nothing to line up. @see cornerValues

  // Drops in the air, which are neither path's business: a drop is at a point
  // between two places rather than on a column, and both mesh builders are
  // functions of the columns.
  const drRef = useRef<GpuDripLayer | null>(null);
  const faRef = useRef<FallLayer | null>(null);
  /** The falls' sheets when the device builds them. @see createGpuFallLayer */
  const gfRef = useRef<GpuFallLayer | null>(null);
  /**
   * The water stepped by the compute passes, when the switch is on.
   *
   * Built on demand rather than with the scene: it holds a copy of the whole
   * field on the device, and a map nobody has switched over should not be
   * paying for one. @see createGpuWater
   */
  const solverRef = useRef<GpuWater | null>(null);
  /** Which field the solver was built for. @see solverRef */
  const solverField = useRef<unknown>(null);
  /**
   * The renderer, for the one question Pixi's own surface does not answer:
   * which GPU texture stands behind a `TextureSource`. The solver fills those
   * textures itself. @see deviceSinks
   */
  const rendererRef = useRef<unknown>(null);
  // held so an edit can re-texture just the cells that changed
  const texRef = useRef<Awaited<ReturnType<typeof _loader>> | null>(null);
  const cursorRef = useRef<BuildCursor | null>(null);
  /** Holograms: what a placement would put down, and what AI mode's drones are about to. @see createHolograms */
  const holoRef = useRef<Holograms | null>(null);
  /** A building dropping into place, a house hopping as it grows, dust where one came down. @see createJuice */
  const juiceRef = useRef<Juice | null>(null);
  /** Disasters on the map: steam, haze, glows, the road works' barrier. @see createDisasterFx */
  const disasterFxRef = useRef<DisasterFx | null>(null);
  const disasterClock = useRef(0);
  /** The culture deck's cards, seen by the buildings. @see createCultureProps */
  const propsRef = useRef<CultureProps | null>(null);
  /** The town's shops' fronts, and what of them moves. @see createShopfronts */
  const shopsRef = useRef<Shopfronts | null>(null);
  /** What a fine street puts on its pavements. @see createStreetProps */
  const streetPropsRef = useRef<StreetProps | null>(null);
  /** The woods' trees, stood on shaded grass. @see createWoods */
  const woodsRef = useRef<Woods | null>(null);
  /** The traffic lights at the lights junctions. @see createSignals */
  const signalsRef = useRef<Signals | null>(null);
  /** The bus shelters at the routes' stops. @see createBusStops */
  const busStopsRef = useRef<BusStops | null>(null);
  /** The seats last given the town. */
  const seatsRef = useRef<Seat[] | null>(null);
  /** Seconds to Ship It Fridays' next release party. @see SHIP_EVERY */
  const shipIn = useRef(0);
  const soundClock = useRef(0);
  const holoScanRef = useRef<Graphics | null>(null);
  const tileHoloRef = useRef<TileHolograms | null>(null);
  const placeHolos = useRef<HoloSpec[]>([]);
  /** The masterplan's buildings shown as holograms, so its flat ghost leaves them out. */
  const planHoloKeys = useRef<ReadonlySet<string>>(new Set());
  const aiHolos = useRef<HoloSpec[]>([]);
  /** Show the holograms asked for now: the build tool's and AI mode's. */
  const showHolos = useCallback(() => {
    const h = holoRef.current, bl = blRef.current, tex = texRef.current;
    if (!h || !bl || !tex) return;
    h.set([...placeHolos.current, ...aiHolos.current], { bands: bl, textures: tex, grid: useWorldStore.getState().grid, scale: useWorldStore.getState().scale });
  }, []);
  /** The AI on the map: the Data Centre's glow, the links, the holograms. @see createAiLayer */
  const aiLayerRef = useRef<AiLayer | null>(null);
  /** Seconds of play since the arc last stepped. @see useQuestStore.step */
  const questClock = useRef(0);
  /** The earnings overlay. @see createStreetHeat */
  const streetHeatRef = useRef<StreetHeat | null>(null);
  /** The placing heat map. @see createDesireHeat */
  const heatRef = useRef<DesireHeat | null>(null);
  /** The boats, drawn among the movers of the bands. @see world/boats */
  const boatRef = useRef<BoatLayer | null>(null);
  /** The water mains, drawn. @see createMainsLayer */
  const mainsRef = useRef<MainsLayer | null>(null);
  /** The sewers under the ground, and what of them shows at the surface. @see createSewerLayer */
  const sewersRef = useRef<SewerLayer | null>(null);
  /** The cars and people, drawn among the movers too. @see world/agents */
  const townRef = useRef<TownLayer | null>(null);
  /** The works' revision last told to the store, so autosave hears of progress. */
  const worksRevRef = useRef(0);
  /**
   * When the ports' rate a second was last kept — starting a minute ahead,
   * so the first one is measured over a whole minute of calls and not the
   * empty one after a load. @see portIncomePerSecond
   */
  const portRateAt = useRef(performance.now() + 55_000);
  /** How long each miserable house has been so. @see stepMood */
  const unrestRef = useRef<Unrest>(new Map());
  /** The events director's clock, the sludge's, and the next event's number. @see stepEvents */
  const eventClock = useRef(0);
  const sludgeClock = useRef(0);
  /** Seconds since the houses by fouled water were last looked for. @see fouledHouses */
  const fouledClock = useRef(0);
  const eventIds = useRef(1);
  /** The crew mopping up sludge. @see stepCleanup */
  const cleanup = useRef(createCleanup());
  /** The team leaders out and about. @see stepLeaders */
  const leaders = useRef(createLeaders());
  // WHEN THE NEXT EVENT IS DUE, and for a flood the water against each
  // building before it, how far the river is risen, and what it has reached.
  // @see world/events/flood
  const director = useRef(createDirector(useSessionStore.getState().eventDirector));
  const pacingSaved = useRef(0);
  const floodBase = useRef<FloodBase | null>(null);
  /** Whether the AI has been caught up on time away, and when it last said where it was. @see catchUpAi */
  const aiPrimed = useRef(false);
  const aiSaved = useRef(0);
  /** The kinds a flood's evacuation has put out of their homes. @see EVACUEE_MORALE */
  const evacuees = useRef(new Set<GeneratorId>());
  const floodRise = useRef(0);
  const floodShield = useRef<FloodShield>(null);
  const floodClock = useRef(0);
  const floodedCount = useRef(0);
  /** The busiest junction, worked out again only when the map or who lives where changes. @see busiestJunction */
  const junctionAt = useRef<{ key: string; at: { x: number; y: number } | null }>({ key: "", at: null });
  /** What a heatwave ridden out has overheated. @see HEATWAVE */
  const overheated = useRef(new Set<number>());
  /** The building a fire is at while one is under way, and what it has spread to (null: not yet). @see FIRE */
  const fireAt = useRef<{ id: number; spread: number[] | null } | null>(null);
  /** A blackout's district, as it was when it struck; and the earthquake already felt, by event id. @see BLACKOUT, EARTHQUAKE */
  const blackoutIds = useRef<{ event: number; ids: number[] } | null>(null);
  const quakeFelt = useRef<number | null>(null);
  /** The buildings an earthquake damaged, for their dust; and the shake's offset on the camera. */
  const quakeDust = useRef<number[]>([]);
  const shake = useRef({ x: 0, y: 0 });
  /**
   * Bumped when the async scene build finishes. The cursor cannot exist before
   * the band layer does, so the effects that drive it need a reason to re-run
   * once it appears rather than waiting for the next pointer move.
   */
  const [sceneEpoch, setSceneEpoch] = useState(0);
  /**
   * BUMPED WHEN THE WATER FIELD IS REPLACED UNDER THE SAME GRID, which is
   * what the first deck on a map does: a field's storeys are fixed when it is
   * made, so `growStoreys` makes a new one, and nothing here noticed. The
   * scene is built on grid identity, and the grid had not changed — so the
   * water layer kept one storey's textures and copied two storeys into them
   * every frame, and the device solver, torn down by the tick for holding the
   * old field, was never built again: the map ran on the host for the rest of
   * the session, and only a reload put it back. @see WaterField.fieldRev
   */
  const [fieldEpoch, setFieldEpoch] = useState(0);
  /** The column field the scene was last built for. @see fieldEpoch */
  const sceneField = useRef<unknown>(null);
  /** The field a rebuild has been asked for, so it is asked once. */
  const rebuildAsked = useRef<unknown>(null);
  const grid = useWorldStore((s) => s.grid);
  const scale = useWorldStore((s) => s.scale);
  const { app } = useApplication();
  // THE MAP'S WELL follows the theme: the light console's grey, or the dark's. @see plans/ui-overhaul.md open question 6
  const theme = useThemeStore((t) => t.theme);
  useEffect(() => { if (app?.renderer) app.renderer.background.color = theme === "light" ? 0xc7cbd1 : 0x101418; }, [app, theme]);
  // NOT DRAWN while out of sight: the stage goes dark, the ticks go on. @see mapHidden
  const mapHidden = useWorldStore((s) => s.mapHidden);
  useEffect(() => { app.stage.visible = !mapHidden; }, [app, mapHidden]);
  // THE LATTICE'S HOLD on the meter, where the company's AI is at work to
  // build it: not in the editor, a fixture, or The Model's own runs. @see LATTICE_AT
  useEffect(() => setLatticeReader(() =>
    !useWorldStore.getState().playing || startedOnFixture() || useFounderStore.getState().selectedFounderId === "model" || latticeDone()
    // Air-gapped, it builds no Lattice to wait on. @see game/machine KEYSTONES
    || keystone("airgap")), []);
  // NIGHT over the map in the game: one translucent sheet the size of the
  // screen, darker as the day turns. @see world/daylight
  const night = useRef<Graphics | null>(null);
  const nightKey = useRef("");
  const lightsRef = useRef<Lights | null>(null);
  const lightsAt = useRef<{ grid: unknown; rev: number; crunch: boolean }>({ grid: null, rev: -1, crunch: false });
  // AND RAIN over it while a flood is coming or here. @see drawRain
  const rain = useRef<Graphics | null>(null);
  useEffect(() => {
    const g = new Graphics(), r = new Graphics();
    g.eventMode = "none";
    r.eventMode = "none";
    g.zIndex = 1e9;
    r.zIndex = 1e9 + 1;
    // MULTIPLIED IN: a grade over everything, the water's own shaders included. @see NIGHT_GRADE
    g.blendMode = "multiply";
    app.stage.sortableChildren = true;
    app.stage.addChild(g, r);
    night.current = g;
    rain.current = r;
    // THE TOWN'S LIGHTS, over the night and under the rain. @see createLights
    lightsRef.current = createLights(app.stage, 1e9 + 0.5);
    return () => {
      for (const x of [g, r]) { x.parent?.removeChild(x); x.destroy(); }
      night.current = null;
      lightsRef.current?.destroy();
      lightsRef.current = null;
      rain.current = null;
    };
  }, [app]);

  // Build the scene whenever the grid identity changes (new/resized map).
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    let cancelled = false;

    loadIsometricAtlasTextures().then((textures) => {
      if (cancelled || !rootRef.current) return;
      texRef.current = textures;
      const bl = createBandLayer(grid.w, grid.h);
      const tl = createTerrainLayer(grid, useWorldStore.getState().palette, scale);
      const cl = createCliffLayer(grid, useWorldStore.getState().palette, scale);
      // The shaded ground draws its own walls.
      cl.skip = (g, x, y) => meshDraws(tl, g, x, y);
      const pl = createPavedLayer(grid, ROAD_TABLE, scale);
      const sl = createStructureLayer();
      const water = useWorldStore.getState().getWaterField();
      sceneField.current = water?.columns ?? null;
      // THE MESH KNOWS ABOUT STOREYS, so a map with bridges on it draws on
      // the device like any other. The SOLVER still does not — see the effect
      // that builds it — which is the one thing left holding a bridged map on
      // the host. @see createGpuWaterLayer
      const onGpu = waterOnGpu();
      rendererRef.current = app?.renderer ?? null;
      // THE RENDERER'S DEVICE, for the water solver to run on. It was handed
      // over inside the development-only block of console hooks, so a
      // production build — and any page where something in that block threw
      // first — never had one, and the CPU stepped the water every frame on
      // a machine with a perfectly good GPU. @see heldDevice
      holdDevice((app?.renderer as unknown as { gpu?: { device: GPUDevice } } | undefined)?.gpu?.device ?? null);
      // NO GARBAGE COLLECTION. Pixi's frees the GPU data of anything it has
      // not drawn for a minute — and the map is cached in render groups, a
      // chunk of bands each, whose instructions still point at that data when
      // the chunk comes back on screen. Zoomed in with the tab left open, then
      // zoomed out: "[Buffer] used in submit while destroyed", every frame.
      // Reproduced by setting `renderer.gc.maxUnusedTime` low and calling
      // `renderer.gc.run()`. Everything here is destroyed explicitly when it
      // goes, so there is nothing for a collector to do. @see stopGarbageCollection
      if (app?.renderer) stopGarbageCollection(app.renderer);
      // And room for a big map's uniforms on WebGPU. @see roomForUniforms
      if (app?.renderer) roomForUniforms(app.renderer);
      const fl = water && !onGpu ? createWaterLayer(water.columns, bl, scale) : null;
      gpuRef.current = water && onGpu ? createGpuWaterLayer(water.columns, bl, scale) : null;
      // Between the surface and the drips: a fall is drawn over the water
      // it is leaving and under the drops coming off it.
      faRef.current = water ? createFallLayer(bl, scale) : null;
      drRef.current = water ? createGpuDripLayer(bl, scale) : null;
      buildTerrain(tl, bl, grid, textures);
      buildCliffs(cl, bl, grid, textures);
      buildPaved(pl, bl, grid, textures);
      syncStructures(sl, { bands: bl, textures, grid, scale });

      rootRef.current.addChild(bl.root);
      blRef.current = bl;
      tlRef.current = tl;
      clRef.current = cl;
      plRef.current = pl;
      slRef.current = sl;
      setShownStructures(sl);
      flRef.current = fl;
      // See expose-store: an animated structure's state is not observable from
      // outside any other way.
      if (import.meta.env.DEV) {
        window.__structures = sl;
        window.__bands = bl;
        window.__water = water;
        window.__waterLayer = fl;
        window.__falls = faRef.current;
        // The device-built sheets, so a harness can count what it drew.
        window.__sheets = () => gfRef.current;
        // And the drops, so a layer at a time can be hidden and timed.
        (window as unknown as { __drips?: () => unknown }).__drips = () => drRef.current;
        window.__solver = () => solverRef.current;
        window.__waterGpu = gpuRef.current;
        // The boats, for a harness to look at. @see world/boats
        (window as unknown as { __boats?: () => unknown }).__boats = () => getFleet();
        // And the town's traffic. @see world/agents
        (window as unknown as { __town?: () => unknown }).__town = () => getTown();
        window.__renderer = app.renderer;
        // What the readback costs, answered by not doing it. @see setReadback
        window.__readback = setReadback;
        // And whether the dispatch region is the box or the map. @see setWholeMap
        window.__wholeMap = setWholeMap;
        // And which passes to leave out, for bisecting. @see setSkip
        window.__skip = setSkip;
        // And whether the lips come back as a list or as five whole arrays,
        // so the two can be diffed on one bench. @see setFallList
        window.__fallList = setFallList;
        // And whether depth comes back by the band or whole. @see setDepthBand
        window.__depthBand = setDepthBand;
        // The water's meshes, hidden, so the render pass can be timed with and
        // without them. @see showGpuWater
        // What the GPU spent, per pass, for a harness rather than the eye.
        window.__gpuTime = () => stampsNow()?.says() ?? null;
        window.__showWater = (show: boolean) => {
          if (gpuRef.current) showGpuWater(gpuRef.current, show);
        };
        // Drives frames by hand, because the browser throttles rAF whenever
        // the preview is not on screen and a throttled clock has wrecked more
        // than one measurement in this file's history. Runs the same three
        // steps the tick does — solve, build, render — and reports each.
        //
        // Twice over: once pipelined, which is how it really runs, and once
        // waiting on the device after every frame, which serialises the GPU
        // behind the CPU. The difference between the two is what the GPU is
        // doing while the CPU gets on with the next frame.
        // Does the vertex shader draw the same water as the mesh builder? It
        // builds its own scene and answers in pixels — see water-compare.
        window.__waterCompare = (o) => compareWaterPaths(app.renderer, o);
        /**
         * WHAT THE WATER MESH PUTS ON THE SCREEN YOU ARE LOOKING AT.
         *
         * `__pavingCheck` builds its own band layer and renders that, which is
         * the right way to test the BUILDER and the wrong way to find out why
         * the live picture differs from it — on a map where that check reports
         * the deck's water at 180 pixels a column, the screen can still show a
         * dry bridge, and then the difference is the live scene and nothing
         * else. This renders the LIVE root twice, once with the water meshes
         * drawing and once without, and counts what changed: over the whole
         * frame, and over the span alone.
         *
         * Nought over the span with thousands over the frame is water that is
         * being drawn and then painted over. Nought in both is a mesh that is
         * not reaching the frame at all. @see showGpuWater
         */
        window.__liveWaterPixels = async () => {
          const bl = blRef.current, wl = gpuRef.current;
          const field = useWorldStore.getState().getWaterField();
          const g = useWorldStore.getState().grid;
          if (!bl || !wl || !field) return { ok: false, why: "no live water mesh" };
          // THE SCREEN, NOT THE BAND ROOT. The camera is a viewport ABOVE
          // `bl.root`, so rendering the root renders the map with no camera on
          // it at all — in world coordinates, into a square that has nothing to
          // do with what is on the monitor. The first reading off this put the
          // span at x -198..198 of a 900 frame and counted 951 water pixels for
          // a whole river, which is a crop and not a measurement.
          const W = Math.round(app.renderer.width);
          const H = Math.round(app.renderer.height);
          const shoot = () => {
            const target = RenderTexture.create({ width: W, height: H, antialias: false });
            app.renderer.render({ container: app.stage, target, clear: true });
            const out = app.renderer.extract.pixels(target);
            target.destroy(true);
            return out.pixels;
          };
          // AND THE SPAN THROUGH PIXI'S OWN TRANSFORM, so it lands where the
          // camera actually put it, at the scale the layers were built at.
          const camScale = useWorldStore.getState().scale;
          let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
          for (let ty = 0; ty < g.h; ty++) {
            for (let tx = 0; tx < g.w; tx++) {
              if (g.deck[ty * g.w + tx] === 0) continue;
              const w = cellToWorld(tx, ty, g.deckZ[ty * g.w + tx], camScale);
              const p = bl.root.toGlobal({ x: w.wx, y: w.wy });
              const rx = HW * camScale * bl.root.worldTransform.a;
              const ry = HH * camScale * bl.root.worldTransform.d;
              x0 = Math.min(x0, p.x - rx); x1 = Math.max(x1, p.x + rx);
              y0 = Math.min(y0, p.y - ry * 3); y1 = Math.max(y1, p.y + ry);
            }
          }
          // AND THE DECK'S OWN SHARE OF IT, which the box above cannot give:
          // that box holds the channel under the span as well, and a river
          // seen beside a bridge counts the same as water standing on it.
          //
          // The readback FIRST, and every shot after it, because this is the
          // one step that yields: taken between the shots, a frame of the
          // river moving would land in the difference as water the deck was
          // drawing. @see silenceDecks
          const c = field.columns;
          const device = (app.renderer as unknown as { gpu?: { device: GPUDevice } })
            .gpu?.device ?? null;
          const hush = await silenceDecks(app.renderer, device, wl.sources[0], c);
          drawGpuWater(wl, c, bl, 1 / 60, true, solverRef.current !== null);
          const noDeck = shoot();
          hush?.();
          drawGpuWater(wl, c, bl, 1 / 60, true, solverRef.current !== null);

          const was = wl.drawing;
          showGpuWater(wl, true);
          const on = shoot();
          showGpuWater(wl, false);
          const off = shoot();
          showGpuWater(wl, was);
          let all = 0, span = 0, deckAll = 0, deckSpan = 0;
          const w = W;
          for (let i = 0; i < on.length; i += 4) {
            let d = 0, dd = 0;
            for (let k = 0; k < 4; k++) {
              d = Math.max(d, Math.abs(on[i + k] - off[i + k]));
              dd = Math.max(dd, Math.abs(on[i + k] - noDeck[i + k]));
            }
            const p = i / 4, sxp = p % w, syp = (p / w) | 0;
            const inSpan = sxp >= x0 && sxp <= x1 && syp >= y0 && syp <= y1;
            if (d > 5) { all++; if (inSpan) span++; }
            if (dd > 5) { deckAll++; if (inSpan) deckSpan++; }
          }
          return {
            waterPixelsWholeFrame: all, waterPixelsOverTheSpan: span,
            // The deck's water alone, which is the number in question.
            deckWaterPixels: deckAll, deckWaterPixelsOverTheSpan: deckSpan,
            deckHeldInHostCopy: +(() => {
              let h = 0;
              for (let a = 1; a < field.columns.layers; a++) {
                for (let i = 0; i < field.columns.cells; i++) {
                  h += field.columns.depth[a * field.columns.cells + i];
                }
              }
              return h;
            })().toFixed(2),
            spanBox: x0 === Infinity ? null
              : { x0: Math.round(x0), y0: Math.round(y0), x1: Math.round(x1), y1: Math.round(y1) },
            frame: { w: W, h: H },
            why: all === 0 ? "the water mesh reaches no pixel at all"
              : deckAll === 0
                ? "the deck's own water reaches no pixel: it is not being drawn"
                : null,
          };
        };
        /**
         * DOES A BAND EVER NEED MORE QUADS THAN IT WAS ALLOWED TO DRAW?
         *
         * The gathering counts the quads worth drawing on the GPU and the
         * count comes back by an ASYNC mapping, so the number a frame draws by
         * is an earlier frame's count plus `SPARE` of headroom. Ask for more
         * than that in one frame and the extra quads are simply not drawn —
         * and the next frame, when the count has caught up, they are. A hole
         * that opens and heals.
         *
         * Which is what a fall ending looks like from the mesh's side: while
         * the sheet is going over, the lip's side faces are not drawn; when it
         * stops they all come back at once, in the handful of bands the span
         * lies on. @see roomFor, quadDraws
         */
        /**
         * THE DECK'S DRAWN WATER, FRAME BY FRAME. A hole is a dip.
         *
         * Everything upstream of the picture has been cleared: the ids never
         * drop a wet column, no band is ever short of quads, the depths are
         * on the device and the sheet is labelled. So this stops asking why
         * and measures the symptom — how many pixels of the span are the
         * deck's water, every frame — and keeps the frames where that falls
         * off a cliff and comes back.
         *
         * The reference is one frame with the deck's ids emptied, so "the
         * deck's water" means the pixels that exist only because it is there.
         * Kept for the whole run: the camera does not move during it.
         */
        window.__watchDeckPixels = (frames = 150) => new Promise((done) => {
          const bl = blRef.current, wl = gpuRef.current;
          const field = useWorldStore.getState().getWaterField();
          const g = useWorldStore.getState().grid;
          if (!bl || !wl || !field) { done({ ok: false, why: "no live water mesh" }); return; }
          const W = Math.round(app.renderer.width), H = Math.round(app.renderer.height);
          const shoot = () => {
            const target = RenderTexture.create({ width: W, height: H, antialias: false });
            app.renderer.render({ container: app.stage, target, clear: true });
            const out = app.renderer.extract.pixels(target);
            target.destroy(true);
            return out.pixels;
          };
          const camScale = useWorldStore.getState().scale;
          let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
          for (let ty = 0; ty < g.h; ty++) {
            for (let tx = 0; tx < g.w; tx++) {
              if (g.deck[ty * g.w + tx] === 0) continue;
              const w = cellToWorld(tx, ty, g.deckZ[ty * g.w + tx], camScale);
              const p = bl.root.toGlobal({ x: w.wx, y: w.wy });
              const rx = HW * camScale * bl.root.worldTransform.a;
              const ry = HH * camScale * bl.root.worldTransform.d;
              x0 = Math.min(x0, p.x - rx); x1 = Math.max(x1, p.x + rx);
              y0 = Math.min(y0, p.y - ry * 3); y1 = Math.max(y1, p.y + ry);
            }
          }
          const c = field.columns, cells = c.cells;
          const deck: number[] = [];
          for (let i = 0; i < cells; i++) {
            for (let a = 1; a < c.layers; a++) {
              const ia = a * cells + i;
              if (c.roof[ia] > c.ground[ia]) deck.push(ia);
            }
          }
          const SETTLE = 20;
          // A MASK OF WHAT IS USUALLY THE DECK'S WATER, and then the pixels
          // inside it that have gone back to looking like bare deck.
          //
          // The total was the wrong measurement. Summed over the whole span it
          // swings 78,000 to 114,000 as the water moves, so a hole of a few
          // thousand pixels — which is what somebody SEES — is inside the
          // noise and the run came back "never dipped" on a frame the fault
          // was on the screen. A hole is local, so it has to be counted
          // locally: a pixel that has been this deck's water and is now the
          // reference again is a pixel you can see the deck through.
          const bx0 = Math.max(0, Math.floor(x0)), bx1 = Math.min(W - 1, Math.ceil(x1));
          const by0 = Math.max(0, Math.floor(y0)), by1 = Math.min(H - 1, Math.ceil(y1));
          const bw = Math.max(0, bx1 - bx0 + 1);
          const mask = new Uint8Array(bw * Math.max(0, by1 - by0 + 1));
          const LEARN = SETTLE + 30;
          const series: {
            n: number; px: number; holes: number; air: number; wet: number;
          }[] = [];
          let n = 0;
          /**
           * THE REFERENCE: the same picture with the deck's water not drawn.
           *
           * ON BOTH SOURCES. Emptying the host's copy alone leaves the device's
           * depth texture full, and the shader draws an unlabelled column as
           * pseudo-sheet `-1` rather than skipping it — so the reference used
           * to contain the very water it was the reference for. @see silenceDecks
           *
           * SETTLED FIRST, and the first frames after it thrown away. Taken
           * cold, the count climbed 771 to 2624 over eleven frames with the
           * wet column count dead still at 133 — the picture catching up with
           * having had the deck emptied and put back, reported as eleven
           * frames of holes. That is this tool's own wake, not the map's.
           */
          let bare: ReturnType<typeof shoot> = new Uint8ClampedArray(0);
          const device = (app.renderer as unknown as { gpu?: { device: GPUDevice } })
            .gpu?.device ?? null;
          // NOTHING MAY YIELD between the silence and the restore, so the
          // readback is awaited out here and every draw and shot below it is
          // one synchronous stretch. @see silenceDecks
          void silenceDecks(app.renderer, device, wl.sources[0], c).then((hush) => {
            for (let k = 0; k < 3; k++) {
              drawGpuWater(wl, c, bl, 1 / 60, true, solverRef.current !== null);
              shoot();
            }
            bare = shoot();
            hush?.();
            for (let k = 0; k < 3; k++) {
              drawGpuWater(wl, c, bl, 1 / 60, true, solverRef.current !== null);
              shoot();
            }
            requestAnimationFrame(tick);
          });
          const tick = () => {
            const now = shoot();
            let px = 0, holes = 0;
            for (let sy = by0; sy <= by1; sy++) {
              for (let sx = bx0; sx <= bx1; sx++) {
                const i = (sy * W + sx) * 4;
                let d = 0;
                for (let k = 0; k < 4; k++) d = Math.max(d, Math.abs(now[i + k] - bare[i + k]));
                const m = (sy - by0) * bw + (sx - bx0);
                if (d > 5) {
                  px++;
                  if (n < LEARN) mask[m] = 1;
                } else if (mask[m]) holes++;
              }
            }
            let wet = 0;
            for (const ia of deck) if (c.depth[ia] > c.params.dryDepth) wet++;
            // THE AIR OFF THE DECK'S OWN LIPS, not the map's. A map with a
            // river in it always has something falling somewhere, so watching
            // `waterInAir` for "a fall ended" waits for a moment that never
            // comes — twice it sampled a hundred and fifty frames and told me
            // nothing had finished. What has to go to nought is the water in
            // the air off THIS span. @see fallEdge
            let deckAir = 0;
            const air = c.falls.air;
            for (let p = 0; p < c.layers * c.layers; p++) {
              if (((p / c.layers) | 0) < 1) continue;   // the near slot is the deck's
              const base = p * cells * 2;
              for (let k = 0; k < cells * 2; k++) deckAir += air[base + k];
            }
            series.push({ n, px, holes, air: +deckAir.toFixed(4), wet });
            if (++n < frames) requestAnimationFrame(tick);
            else {
              const live = series.slice(SETTLE);
              const all = live.map((s) => s.px).sort((a, b) => a - b);
              const med = all[all.length >> 1] || 0;
              const dips = live.filter((s) => s.px < med * 0.6);
              // WHERE A FALL ENDED: the air was carrying something and then
              // was not. The window round that is the thing to look at, and
              // it is reported whether or not anything dipped — "the fall
              // ended here and nothing happened" is an answer too.
              let ended = -1;
              for (let k = 10; k < live.length; k++) {
                if (live[k].air > 1e-4) continue;
                let had = false;
                for (let j = k - 10; j < k; j++) if (live[j].air > 1e-3) had = true;
                if (had) { ended = k; break; }
              }
              // AND THE WORST FRAME EITHER WAY, so this always hands back the
              // most suspicious window it saw rather than nothing at all.
              let low = 0;
              for (let k = 1; k < live.length; k++) if (live[k].px < live[low].px) low = k;
              // THE MOST HOLE, which is the measurement that matters now.
              const after = series.slice(LEARN);
              let worst = 0;
              for (let k = 1; k < after.length; k++) {
                if (after[k].holes > after[worst].holes) worst = k;
              }
              // The steepest fall in the air off the span, which is the moment
              // a sheet stopped whether or not it reached exactly nought.
              let drop = 0, dropAt = -1;
              for (let k = 1; k < live.length; k++) {
                const by = live[k - 1].air - live[k].air;
                if (by > drop) { drop = by; dropAt = k; }
              }
              done({
                frames: n, settleSkipped: SETTLE,
                median: med, min: all[0], max: all[all.length - 1],
                sawAFallEnd: ended >= 0,
                aroundTheEnding: ended >= 0
                  ? live.slice(Math.max(0, ended - 6), ended + 10) : null,
                // The biggest drop in the air off the span, and the emptiest
                // frame, with their windows — always, so a run that catches no
                // clean ending still says where it came closest.
                biggestDropInDeckAir: dropAt >= 0
                  ? { at: live[dropAt].n, by: +drop.toFixed(4),
                    window: live.slice(Math.max(0, dropAt - 6), dropAt + 10) }
                  : null,
                emptiestFrame: { at: live[low]?.n, px: live[low]?.px,
                  window: live.slice(Math.max(0, low - 6), low + 10) },
                // THE HOLE ITSELF: how many pixels that had been this deck's
                // water went back to bare, and when. @see mask
                maskLearnedOver: LEARN - SETTLE,
                maskPixels: mask.reduce((t, v) => t + v, 0),
                worstHolePixels: after[worst]?.holes ?? 0,
                aroundTheHole: after.length
                  ? after.slice(Math.max(0, worst - 6), worst + 10) : null,
                dipFrames: dips.length, dips: dips.slice(0, 20),
                ok: (after[worst]?.holes ?? 0) < 200,
                why: (after[worst]?.holes ?? 0) >= 200
                  ? `${after[worst].holes} pixels that had been this deck's water`
                    + ` went back to bare at frame ${after[worst].n}`
                  : "nothing that had been the deck's water ever went back to bare",
                note: ended >= 0 ? null
                  : "no fall ENDED while this was watching — the air never went"
                    + " from carrying something to carrying nothing. Run it again"
                    + " so that a sheet finishes during the sample.",
              });
            }
          };
        });
        window.__watchQuadRoom = (frames = 240) => new Promise((done) => {
          const wl = gpuRef.current;
          const g0 = useWorldStore.getState().grid;
          if (!wl?.gather) {
            done({ ok: false, why: "no gathering attached — nothing to be short of" });
            return;
          }
          const deckBands = new Set<number>();
          for (let y = 0; y < g0.h; y++) {
            for (let x = 0; x < g0.w; x++) if (g0.deck[y * g0.w + x] !== 0) deckBands.add(x + y);
          }
          const short: unknown[] = [];
          let worst = 0, n = 0;
          const tick = () => {
            const g = wl.gather;
            if (g) {
              // BOTH TIERS, each against its own count: the roofed tier has
              // a list of its own since the gathering sorts by tier, and a
              // shortfall there drops water from under a span exactly as one
              // in the open tier drops it from everywhere else.
              // @see QuadList.second
              const B = wl.meshes.length;
              const tiers = wl.under.length ? 2 : 1;
              for (let t = 0; t < tiers; t++) {
                for (let b = 0; b < B; b++) {
                  const mesh = t ? wl.under[b] : wl.meshes[b];
                  const drew = mesh.geometry.instanceCount;
                  const wanted = g.count[t * B + b] ?? 0;
                  if (wanted > drew) {
                    const by = wanted - drew;
                    if (by > worst) worst = by;
                    if (short.length < 30) {
                      short.push({
                        n, band: b, tier: t ? "roofed" : "open", wanted, drew, by,
                        onASpan: deckBands.has(b), grew: g.grew[t * B + b],
                      });
                    }
                  }
                }
              }
            }
            if (++n < frames) requestAnimationFrame(tick);
            else {
              done({
                frames: n, spanBands: [...deckBands].sort((a, b) => a - b),
                worstShortfall: worst, shortfalls: short.length, short,
                ok: worst === 0,
                why: worst > 0
                  ? `a band wanted ${worst} more quads than it was drawing`
                  : "no band ever wanted more than it drew",
              });
            }
          };
          requestAnimationFrame(tick);
        });
        /**
         * DECKED COLUMNS THE MESH IS NOT DRAWING, with drawn ones either side.
         *
         * Asked with the rule the builder, the gathering and the vertex
         * shader all decide by, which since the brink gate was reverted is a
         * plain cutoff on depth — `quadDraws` part 0 and `findBodies` both ask
         * exactly this. A column missing with its neighbours present IS a
         * hole, and its depth and its brink say why it was left out.
         *
         * OF THE HOST'S COPY, though, and that is its limit: the shader draws
         * the DEVICE's depth, which is several frames ahead of this. A span
         * can read clean here and have a hole on it. @see __deviceIds
         */
        window.__deckHolesNow = () => {
          const fld = useWorldStore.getState().getWaterField();
          if (!fld) return { ok: false, why: "no water field" };
          const f = fld.columns, cells = f.cells, dry = f.params.dryDepth;
          const deckAt = (i: number) => f.roof[cells + i] > f.ground[cells + i];
          const drawn = (i: number) => f.depth[cells + i] > dry;
          const holes: unknown[] = [];
          for (let cy = 1; cy < f.ny - 1; cy++) {
            for (let cx = 1; cx < f.nx - 1; cx++) {
              const i = cy * f.nx + cx;
              if (!deckAt(i) || drawn(i)) continue;
              const across = deckAt(i - 1) && drawn(i - 1)
                && deckAt(i + 1) && drawn(i + 1);
              const along = deckAt(i - f.nx) && drawn(i - f.nx)
                && deckAt(i + f.nx) && drawn(i + f.nx);
              if (!across && !along) continue;
              if (holes.length < 12) {
                holes.push({
                  cx, cy, depth: +f.depth[cells + i].toFixed(6),
                  floor: f.ground[cells + i],
                  brink: +atBrink(
                    f.nx, f.ny, i, f.ground, f.depth, dry, FALL_MIN, cells, f.roof,
                  ).toFixed(3),
                  neighbourDepths: [
                    +f.depth[cells + i - 1].toFixed(4),
                    +f.depth[cells + i + 1].toFixed(4),
                    +f.depth[cells + i - f.nx].toFixed(4),
                    +f.depth[cells + i + f.nx].toFixed(4),
                  ],
                });
              }
            }
          }
          let wet = 0, damp = 0, zero = 0;
          for (let i = 0; i < cells; i++) {
            if (!deckAt(i)) continue;
            const d = f.depth[cells + i];
            if (d > dry) wet++; else if (d > 0) damp++; else zero++;
          }
          return {
            dryDepth: dry, deckWet: wet, deckDamp: damp, deckZero: zero,
            holes: holes.length, examples: holes,
            ok: holes.length === 0,
            why: holes.length
              ? `${holes.length} decked columns are not drawn with drawn`
                + " neighbours either side"
              : "no decked column is skipped between drawn ones",
          };
        };
        /**
         * HOW FAR BEHIND THE HOST'S COPY OF THE DEPTHS IS, on the decks.
         *
         * The device's depth texture — the one the vertex shader samples,
         * filled by `copyOut` on the end of the solver's own command buffer —
         * read straight back and held against the array the host holds.
         *
         * This was built to catch a worse consequence of the same gap: sheet
         * ids computed on the host from that stale copy and read by the shader
         * against fresh depths, which left wet columns on a span unlabelled
         * and drew them as pseudo-sheet -1. It measured thirteen such columns
         * on one frame. That cause is gone — the grouping is decided at the
         * corner now, from the device's own data — and what is left is the gap
         * itself, which still governs every fall, because on a bridged map the
         * sheets are drawn on the host from this copy while the surface they
         * meet is the device's. @see render/sheet-group, accountDecks
         */
        window.__deviceDepth = async () => {
          const wl = gpuRef.current;
          const f = useWorldStore.getState().getWaterField();
          const device = (app.renderer as unknown as { gpu?: { device: GPUDevice } })
            .gpu?.device ?? null;
          if (!wl || !f) return { ok: false, why: "no device water layer" };
          if (!device) return { ok: false, why: "not on the WebGPU path" };
          if (!solverRef.current) {
            return { ok: false, why: "the host is solving: there is no second copy" };
          }
          const c = f.columns;
          const depthTex = gpuOf(app.renderer, wl.sources[0]);
          if (!depthTex) return { ok: false, why: "no GPU texture behind the depths" };
          const dev = await readFloatRows(device, depthTex, c.nx, 0, c.ny * c.layers);
          return { ...accountDecks(c, dev), dryDepth: c.params.dryDepth };
        };
        /**
         * The same, frame by frame, keeping the worst.
         *
         * The gap opens as a front moves and closes as the readback catches
         * up, so a snapshot taken by hand lands on a quiet frame more often
         * than not. One readback in flight at a time; a frame that arrives
         * while the last is still mapping is skipped rather than queued, which
         * keeps this from becoming the thing it is measuring.
         *
         * ONE SAMPLE TAKEN FIRST, and the run abandoned if it is not an
         * account at all. A watch that treats "the host is solving" as a
         * hundred and fifty clean frames is the failure this whole exercise
         * has been about: it would report `ok` for a map it never measured.
         */
        window.__watchDeviceDepth = async (frames = 240) => {
          // An account, or the reason there is not one. @see accountDecks
          const account = (r: unknown) =>
            (r as Partial<DeckAccount>).deckColumns === undefined
              ? null : r as DeckAccount;
          const first = account(await window.__deviceDepth!());
          if (!first) return await window.__deviceDepth!();
          if (first.deckColumns === 0) {
            return { ...first, ok: false, why: "no storeyed columns: nothing to watch" };
          }
          const bad = (r: DeckAccount) => r.deviceWetHostDry + r.hostWetDeviceDry;
          return new Promise((done) => {
            let seen = 0, sampled = 0, busy = false;
            let worst = first, worstAt = 0;
            const series: { n: number; devWetHostDry: number; hostWetDevDry: number }[] = [];
            const tick = () => {
              if (seen++ >= frames) {
                done({
                  frames: seen, sampled, worstFrame: worstAt,
                  worstGap: worst.worstGap, worstAt: worst.worstAt,
                  // Only the frames where the two copies actually differed:
                  // a clean run is an empty list, which is the answer.
                  disagreed: series,
                  worst,
                  ok: bad(worst) === 0,
                  why: bad(worst) === 0
                    ? "the two copies agreed about which decked columns hold"
                      + " water on every sampled frame"
                    : `frame ${worstAt}: ${worst.why ?? ""}`,
                });
                return;
              }
              requestAnimationFrame(tick);
              if (busy) return;
              busy = true;
              const at = seen;
              void window.__deviceDepth!().then((r) => {
                const a = account(r);
                if (!a) return;
                if (bad(a) > 0 && series.length < 60) {
                  series.push({
                    n: at, devWetHostDry: a.deviceWetHostDry,
                    hostWetDevDry: a.hostWetDeviceDry,
                  });
                }
                if (bad(a) > bad(worst)) { worst = a; worstAt = at; }
                sampled++;
              }).finally(() => { busy = false; });
            };
            requestAnimationFrame(tick);
          });
        };
        // AND WHETHER THE WATER ON A BRIDGE REACHES THE SCREEN AT ALL, which
        // the comparison above cannot answer: it renders the two water
        // builders against each other and nothing else, so a ROAD painted over
        // both of them is invisible to it. @see checkWaterOverPaving
        // THE TWO SHEET BUILDERS, in pixels. The one comparison the water did
        // not have: `__waterCompare` draws no falls and `__frameCompare`
        // compares fields, which a sheet is not. @see compareSheetPaths
        window.__sheetCompare = async (o) => {
          const dev = (app.renderer as unknown as { gpu?: { device: GPUDevice } })
            .gpu?.device ?? null;
          if (!dev) return { ok: false, why: "not on the WebGPU path" };
          return compareSheetPaths(app.renderer, dev, o);
        };
        window.__pavingCheck = async (o) => {
          const tex = texRef.current;
          if (!tex) return { ok: false, why: "atlas not loaded yet" };
          // POINTED AT THE LIVE MAP by default, because the `crossing`
          // fixture draws its deck water perfectly well and a generated map
          // does not — a check that only ever runs on the fixture would have
          // passed the whole time. Pass `{live: false}` for the fixture.
          const st = useWorldStore.getState();
          const live = o?.live ?? true;
          const wf = live ? st.getWaterField() : null;
          const dev = (app.renderer as unknown as { gpu?: { device: GPUDevice } })
            .gpu?.device ?? null;
          return checkWaterOverPaving(app.renderer, tex, st.palette, {
            ...o,
            grid: live ? st.grid : null,
            // THE WATER THAT IS ACTUALLY THERE, unless asked for a film.
            water: live && o?.film !== true ? wf?.columns ?? null : null,
            device: dev,
          });
        };
        // THE SPIKE for the compute port — see `render/compute-spike`. Behind
        // `?spike` because it draws a bar chart over the map and exists to
        // answer one question before three weeks of work rest on the answer.
        if (new URLSearchParams(location.search).has("spike")) {
          const spike = createSpike(app.renderer);
          window.__spike = async () => {
            if (!spike) return { ok: false, why: "no WebGPU device on this renderer" };
            spike.run();
            app.renderer.render({ container: app.stage });
            const got = await spike.read();
            const want = spikeExpected();
            let worst = 0;
            for (let i = 0; i < want.length; i++) {
              worst = Math.max(worst, Math.abs(got[i] - want[i]));
            }
            return { ok: worst < 1e-6, worst, first: [...got.slice(0, 6)], n: got.length };
          };
          if (spike) {
            // On the STAGE, not the world root: the chart is an instrument and
            // not part of the map, and in world space the camera shrinks it to
            // a smudge exactly where the answer needs to be legible.
            spike.mesh.x = 40;
            spike.mesh.y = 160;
            app.stage.addChild(spike.mesh);
          }
        }
        // ONE PASS, both ways, from one state — see `fluid/gpu/compare-pass`.
        // The instrument the compute port is built against: a disagreement
        // here has exactly one candidate, which is why the passes go over one
        // at a time. `bun test` cannot run WGSL, so this lives in the browser.
        window.__accelCompare = async (
          settle = 90, wind?: number,
          through?: "diffuse" | "accelerate" | "limit" | "divergence" | "apply"
          | "falls",
          solo?: boolean,
        ) => {
          const device = (app.renderer as unknown as { gpu?: { device: GPUDevice } })
            .gpu?.device;
          if (!device) return { ok: false, why: "no WebGPU device" };
          return compareAccelerate(device, settle,
            wind === undefined ? undefined : () => accelScene(wind), through, solo);
        };
        // WHOLE FRAMES, both solvers, from one scene — the only question a
        // person watching the water would ask. @see compareFrames
        window.__frameCompare = async (
          frames = 60, sprayScene = false,
          bridged: boolean | "dry" | "road" | "full" = false,
        ) => {
          const device = (app.renderer as unknown as { gpu?: { device: GPUDevice } })
            .gpu?.device;
          if (!device) return { ok: false, why: "no WebGPU device" };
          // THE SPRAY SCENE CARRIES AN ACCEPTED DIVERGENCE and its own bounds
          // say so, rather than every scene being loosened to let it pass.
          // @see SPRAY_BOUNDS
          // AND A SCENE WITH A BRIDGE IN IT, which is the only one that
          // exercises a slot pair that is not (0,0). @see spanned
          // AND THE WORLD'S OWN CROSSING, which is the only one of the three
          // whose geometry somebody could actually build. @see crossingPoured
          if (bridged === "road") {
            return compareFrames(device, frames, crossingPoured, undefined, SPRAY_BOUNDS);
          }
          if (bridged) {
            return compareFrames(
              device, frames,
              bridged === "dry" ? spannedDry : bridged === "full" ? spannedFull : spanned,
              undefined, bridged === "dry" ? undefined : SPRAY_BOUNDS,
            );
          }
          // THE WINDY SCENE ON ITS OWN BOUNDS. @see WIND_BOUNDS
          return sprayScene
            ? compareFrames(device, frames, spray, undefined, SPRAY_BOUNDS)
            : compareFrames(device, frames, accelScene, undefined, WIND_BOUNDS);
        };
        // THE SAME POUR, DRIVEN LIKE THE TICK. @see checkPourLive
        // STARTED RATHER THAN AWAITED: it paces itself on animation frames, so
        // it only runs while the tab is in front, and a caller that awaited it
        // from a console would be waiting on frames it is itself preventing.
        // The answer lands in `__pourLiveResult`.
        window.__pourLive = (
          frames = 40, openEdge = false, onWet = false, twin = false,
          pace = "frame" as "frame" | "free", away = 0,
        ) => {
          const device = (app.renderer as unknown as { gpu?: { device: GPUDevice } })
            .gpu?.device;
          if (!device) return "no WebGPU device";
          (window as unknown as { __pourLiveResult?: unknown }).__pourLiveResult = null;
          void checkPourLive(
            device, frames, openEdge, onWet, twin, undefined, pace, away,
          ).then((r) => {
              (window as unknown as { __pourLiveResult?: unknown })
                .__pourLiveResult = r;
            });
          return "started";
        };
        // A POUR, between frames, the way a click lands. @see checkPour
        // `breaking` is a switch rather than a constant because the leak this
        // is chasing starts at about the frame a collapsing pour begins to
        // break, and the cheapest way to accuse the diffusion is to take it
        // away and pour again.
        window.__pourCheck = async (
          onWet = false, breaking = true, openEdge = true, frames = 24,
          wind?: number,
        ) => {
          const device = (app.renderer as unknown as { gpu?: { device: GPUDevice } })
            .gpu?.device;
          if (!device) return { ok: false, why: "no WebGPU device" };
          const build = () => {
            const f = flat();
            f.params.breaking = breaking ? 1 : 0;
            // THE WIND OFF makes the scene symmetric, and a symmetric scene is
            // worth a great deal: any asymmetry left in the answer is then the
            // solver's and not the weather's. With it on the two sides drift
            // apart for a reason that is not a fault — the substep sizes are
            // each solver's own, so the clock the wind is a function of is not
            // quite the same clock.
            if (wind !== undefined) f.params.wind = wind;
            return f;
          };
          return checkPour(device, build, openEdge, true, frames, onWet);
        };
        // THE CLIFF INDEX, which is not a pass in a substep — it runs once a
        // frame and produces the set the falls are dispatched over, so it is
        // compared on its own rather than through its effect on water.
        window.__cliffCompare = async (
          settle = 90, sprayScene: boolean | "span" | "dry" = false,
          fresh = false,
        ) => {
          const device = (app.renderer as unknown as { gpu?: { device: GPUDevice } })
            .gpu?.device;
          if (!device) return { ok: false, why: "no WebGPU device" };
          // THE BRIDGED SCENES TOO. A lip is an edge between two SLOTS now,
          // and on a map with one storey every one of them is (0,0).
          const build = sprayScene === "span" ? spanned
            : sprayScene === "dry" ? spannedDry
              : sprayScene ? spray : undefined;
          return compareCliffs(device, settle, build, fresh);
        };
        // THE SPRAY, which the scene above deliberately never reaches — its
        // drop is kept under `BREAK` so the five passes before the falls are
        // compared on water that is only flowing. This one throws a sheet off
        // a shelf tall enough to come apart, which is the only way the shed
        // branch, the outbox and the drain are run at all.
        // A HUNDRED AND FIFTY FIVE frames, which is not arbitrary. A sheet
        // banks a fortieth of a drop a step, so which edges cross the line in
        // the one step under test is a matter of phase: most settle counts
        // reach the crowns and not the shed spray, or the other way about.
        // This one reaches both — four shed drops and fifty four crowns — and
        // a comparison that misses half the branch is a comparison that will
        // one day be quietly wrong about it. `sprayed` says which it got.
        // ONE PASS, ON A COLLAPSING POUR — the scene where the LIMITER fires.
        // `__accelCompare`'s scene is a settled sheet and never asks a cell for
        // more water than it has, so every pass agreed on it while a pour was
        // losing eight per cent of itself. @see pour
        window.__pourPass = async (
          settle = 12, through = "apply", solo = true,
        ) => {
          const device = (app.renderer as unknown as { gpu?: { device: GPUDevice } })
            .gpu?.device;
          if (!device) return { ok: false, why: "no WebGPU device" };
          return compareAccelerate(
            device, settle, pourScene,
            through as "limit" | "divergence" | "apply", solo,
          );
        };
        // ONE PASS, ON A MAP WITH A BRIDGE ON IT — the only scene where a
        // slot pair that is not (0,0) carries anything. Every other scene here
        // runs each of these loops exactly once, on the ground, so the whole
        // of the slot arithmetic is unexercised by them and a pass could be
        // wrong about a roof in any way at all and still come back clean.
        // @see spanned
        window.__spanPass = async (
          settle = 30, through = "limit", solo = true, dry: boolean | "full" = false,
        ) => {
          const device = (app.renderer as unknown as { gpu?: { device: GPUDevice } })
            .gpu?.device;
          if (!device) return { ok: false, why: "no WebGPU device" };
          return compareAccelerate(
            device, settle, dry === "full" ? spannedFull : dry ? spannedDry : spanned,
            through as "diffuse" | "accelerate" | "limit" | "divergence"
              | "apply" | "falls" | "landings",
            solo,
          );
        };
        window.__sprayCompare = async (settle = 155, through = "landings") => {
          const device = (app.renderer as unknown as { gpu?: { device: GPUDevice } })
            .gpu?.device;
          if (!device) return { ok: false, why: "no WebGPU device" };
          return compareAccelerate(
            device, settle, spray,
            through as "falls" | "landings", true,
          );
        };
        // EVERY PASS, AGAINST THE MAP IN FRONT OF YOU — see `gpu/check-live`.
        // Not the switch, which exists and is on: this says WHICH of the seven
        // passes disagrees, where the frame comparison only says that two
        // solvers do. It is slow on purpose — the whole field goes up and comes
        // back every time — and it points at your own terrain, which is where
        // the faults have all come from.
        window.__gpuCheck = async () => {
          const device = (app.renderer as unknown as { gpu?: { device: GPUDevice } })
            .gpu?.device;
          if (!device) return [{ pass: "—", ok: false, why: "no WebGPU device" }];
          const field = useWorldStore.getState().getWaterField();
          if (!field) return [{ pass: "—", ok: false, why: "no water field" }];
          return checkLive(device, field.columns);
        };
        const scene = { water, bl, grid };
        const renderer = app.renderer, stage = app.stage;
        /**
         * SYNC OFF MISMEASURES THE DEVICE PATH, and it does it convincingly.
         *
         * The loop below is wholly synchronous, so nothing yields to the event
         * loop inside it and no `mapAsync` promise can resolve while it runs.
         * On the device path that means the solver never gets its readback
         * back: it stalls on its own mapping, and the cost surfaces in the
         * render call, where it reads as the RENDERER having got slower. On a
         * bridged map at 64 tiles it reported the device path 10% worse than
         * the host's. With `sync` on, the same pair is 100.6ms against 16.8,
         * and real rAF says 18.2 against 8.3.
         *
         * So: `sync` on is the honest reading for anything with a readback in
         * it, and a device number taken with it off is worth nothing until it
         * has been taken again with it on. @see hidden tab, same genre
         */
        window.__waterBench = async (
          n = 200, sync = false,
          // EACH FRAME'S OWN WAIT, and a hook before each frame — for a sweep
          // that moves the view frame by frame and wants to know which frames
          // the GPU fell behind on. `warm` frames run first, untimed.
          o: { each?: (i: number) => void; warm?: number; dt?: number } = {},
        ) => {
          const field = useWorldStore.getState().getWaterField();
          // THE SOLVER AND THE MESH ARE TWO CHOICES, and this reported one
          // name for both. `path` was read off the solver while `build` ran
          // whichever layer existed, so a device solver drawing the host's
          // mesh — which is what `?cpuwater=1` plus the GPU toggle IS —
          // reported `drawWater`'s twenty-five milliseconds under the name
          // `device`, next to a `solve` of nought. The build was the honest
          // cost of what that frame builds; the label said it belonged to the
          // path that does not build it.
          const onDevice = solverRef.current !== null;
          const cpu = flRef.current, gpu = gpuRef.current;
          if (!field || !scene.bl || (!cpu && !gpu)) return null;
          const device = (renderer as unknown as { gpu?: { device: GPUDevice } }).gpu?.device;
          // THE STAMPS GO ROUND TOO. They are resolved at the end of the
          // ticker's frame, and the bench does not use the ticker — so without
          // this a bench fills the query set, stops timing at the cap, and
          // reports whatever the live path last left behind. @see flushStamps
          const frame = () => {
            // THE VIEW A PERF SCENE PINNED, if one did: put back before every
            // frame, because the pane's own size and the viewport's React
            // props can each undo it between two. @see pinView
            applyPinned(renderer as unknown as Renderer, useWorldStore.getState().viewport);
            // THE BANDS THIS CAMERA SHOWS, as the tick would cull them.
            cullBandsRef.current?.();
            renderer.render({ container: stage });
            flushStamps(
              (renderer as unknown as { gpu?: { device: GPUDevice } })
                .gpu?.device ?? null,
              true,
            );
          };
          // THE TICK'S OWN FRAME OF WATER, not a copy of the parts somebody
          // remembered. This used to step the solver and build the mesh and
          // nothing else — no springs, no pipes, no gathering, no falls, no
          // drips — so it timed a frame nobody plays. @see waterFrameRef
          //
          // AND THE TICKER STOPPED while it runs. With `sync` on the bench
          // awaits the queue between frames, and the live tick ran in every
          // one of those gaps: two loops stepping one field, timed as one.
          // A FRAME'S TIME, a sixtieth unless asked: a long frame is more
          // substeps, and what those cost is a question of its own.
          const water = () => waterFrameRef.current?.(o.dt ?? 1 / 60) ?? { solve: 0, build: 0 };
          const ticking = app.ticker.started;
          app.ticker.stop();
          let solve = 0, draw = 0, submit = 0, wall = 0;
          const waits: number[] = [];
          try {
            for (let i = 0; i < (o.warm ?? 30); i++) { water(); frame(); }
            if (device) await device.queue.onSubmittedWorkDone();
            const t0 = performance.now();
            for (let i = 0; i < n; i++) {
              o.each?.(i);
              const spent = water();
              const c = performance.now(); frame();
              const d = performance.now();
              solve += spent.solve; draw += spent.build; submit += d - c;
              if (sync && device) {
                await device.queue.onSubmittedWorkDone();
                waits.push(performance.now() - d);
              }
            }
            if (device) await device.queue.onSubmittedWorkDone();
            wall = performance.now() - t0;
          } finally {
            if (ticking) app.ticker.start();
          }
          const per = (v: number) => Math.round((v / n) * 100) / 100;
          return {
            // BOTH HALVES, NAMED SEPARATELY, because they vary separately:
            // `solve` belongs to the solver and `build` to the mesh, and one
            // word for the pair of them is how a host mesh's cost came to be
            // read as the device path's. `path` is kept as the pair so an old
            // reading is still recognisable.
            path: `${onDevice ? "device" : "host"}+${cpu ? "cpu" : "gpu"}mesh`,
            solver: onDevice ? "device" : "host",
            mesh: cpu ? "cpu" : "gpu",
            frames: n, sync,
            solve: per(solve), build: per(draw), submit: per(submit), wall: per(wall),
            // Per frame, from the submit to the GPU finishing it. @see o.each
            waits,
            // WHAT THE RENDER WAS ASKED TO DRAW, because that is what its cost
            // follows: the instances on the last frame, over the surface's
            // bands and the faces under them. @see quads-gpu
            ...(gpu ? {
              quads: [...gpu.meshes, ...gpu.under]
                .reduce((a, m) => a + (m.visible ? m.geometry.instanceCount : 0), 0),
            } : {}),
            ...(solverRef.current ? { last: solverRef.current.last() } : {}),
          };
        };
      }

      // A PERFORMANCE SCENE THAT HOLDS STILL — see debug/perf-scene. Built
      // here because it needs the bench, the layers and the store at once.
      // Polled through `window.__perfLast`, since a whole run outlasts any one
      // call into the page.
      if (import.meta.env.DEV) {
        const w = window as unknown as {
          __perfScene?: (o?: object) => Promise<unknown>;
          __perfLast?: { stage: string; report: unknown };
          __waterBench?: (n?: number, sync?: boolean, o?: { each?: (i: number) => void; warm?: number; dt?: number }) => Promise<unknown>;
          __gpuTime?: () => unknown;
        };
        w.__perfScene = async (o = {}) => {
          const status = { stage: "starting", report: null as unknown };
          w.__perfLast = status;
          const report = await runPerfScene({
            renderer: app.renderer as unknown as Renderer,
            store: () => useWorldStore.getState() as never,
            bench: (n, sync, o) => w.__waterBench!(n, sync, o) as Promise<Record<string, unknown> | null>,
            gpuTime: () => w.__gpuTime?.() as never,
            skip: (names) => setSkip(names),
            resetGpu: () => stampsNow()?.reset(),
            capWater: (n) => setInstanceCap(n),
            pour: (x, y, depth) => {
              const f = useWorldStore.getState().getWaterField();
              if (f) pourAt(f, x, y, depth, 1);
            },
            setHidden: (names) => {
              if (gpuRef.current) showGpuWater(gpuRef.current, !names.includes("surface"));
              const groups: [string, { visible: boolean }[]][] = [
                ["sheets", gfRef.current?.meshes ?? faRef.current?.strips.map((b) => b.mesh) ?? []],
                ["drops", drRef.current?.meshes ?? []],
              ];
              for (const [name, meshes] of groups) {
                const off = names.includes(name);
                for (const m of meshes) {
                  if (off) { heldHidden.add(m); m.visible = false; } else heldHidden.delete(m);
                }
              }
            },
            still: () => {
              const { grid: g, getWaterField } = useWorldStore.getState();
              g.source.fill(0);
              g.inflow.fill(0);
              const f = getWaterField();
              if (f) syncGround(f, g);
            },
            ready: () => {
              const f = useWorldStore.getState().getWaterField();
              return !!f && sceneField.current === f.columns && !!blRef.current
                && (!!flRef.current || !!gpuRef.current);
            },
          }, o, (stage) => { status.stage = stage; });
          status.report = report;
          return report;
        };
      }

      // Ghosts need the bands (true depth), the outline needs the overlay
      // (above everything) — see edit/cursor.
      if (overlayRoot.current) {
        cursorRef.current = createBuildCursor(overlayRoot.current, bl);
        heatRef.current = createDesireHeat(overlayRoot.current);
        streetHeatRef.current = createStreetHeat(overlayRoot.current);
        aiLayerRef.current = createAiLayer(overlayRoot.current);
        // HOLOGRAMS mount in the bands, at true depth; their scan lines go over everything.
        holoRef.current = createHolograms();
        tileHoloRef.current = createTileHolograms();
        juiceRef.current = createJuice();
        disasterFxRef.current = createDisasterFx();
        propsRef.current = createCultureProps(bl);
        shopsRef.current = createShopfronts(bl);
        streetPropsRef.current = createStreetProps(bl);
        woodsRef.current = createWoods(bl);
        signalsRef.current = createSignals(bl);
        busStopsRef.current = createBusStops(bl);
        const scan = new Graphics();
        scan.eventMode = "none";
        scan.zIndex = 1001;
        overlayRoot.current.addChild(scan);
        holoScanRef.current = scan;
      }
      boatRef.current = createBoatLayer(bl);
      if (overlayRoot.current) mainsRef.current = createMainsLayer(bl, overlayRoot.current);
      sewersRef.current = createSewerLayer(bl);
      townRef.current = createTownLayer(bl, app.renderer as unknown as Renderer);
      setSceneEpoch((n) => n + 1);

      console.info(`WORLD: ${grid.w}×${grid.h}, ${bl.bands.length} bands`);
    });

    return () => {
      cancelled = true;
      // THE DEVICE'S SHEETS GO WITH THE BANDS THEY LIVE IN, and before them.
      //
      // The fall layer's meshes are children of the band layer, so
      // `destroyBandLayer` below takes their buffers with it — while the
      // SOLVER is still running and still spilling this frame's quads into
      // them. The solver is rebuilt on `sceneEpoch`, which is bumped at the
      // END of this effect's async build, so there are frames between the two
      // in which the tick submits a command buffer naming buffers that no
      // longer exist: "used in submit while destroyed", once a frame, for as
      // long as the rebuild takes.
      //
      // Cleared here, the solver simply stops drawing sheets until the effect
      // that owns it hands it a new layer. @see sheetTo
      solverRef.current?.sheetTo(null);
      if (gfRef.current) {
        destroyGpuFallLayer(gfRef.current);
        gfRef.current = null;
      }
      cursorRef.current?.destroy();
      cursorRef.current = null;
      holoRef.current?.clear();
      holoRef.current = null;
      disasterFxRef.current?.clear();
      disasterFxRef.current = null;
      juiceRef.current?.clear();
      juiceRef.current = null;
      propsRef.current?.destroy();
      propsRef.current = null;
      shopsRef.current?.destroy();
      shopsRef.current = null;
      streetPropsRef.current?.destroy();
      streetPropsRef.current = null;
      woodsRef.current?.destroy();
      woodsRef.current = null;
      signalsRef.current?.destroy();
      signalsRef.current = null;
      busStopsRef.current?.destroy();
      busStopsRef.current = null;
      tileHoloRef.current?.clear();
      tileHoloRef.current = null;
      holoScanRef.current?.parent?.removeChild(holoScanRef.current);
      holoScanRef.current?.destroy();
      holoScanRef.current = null;
      heatRef.current?.destroy();
      heatRef.current = null;
      streetHeatRef.current?.destroy();
      streetHeatRef.current = null;
      aiLayerRef.current?.destroy();
      aiLayerRef.current = null;
      boatRef.current?.destroy();
      boatRef.current = null;
      mainsRef.current?.destroy();
      mainsRef.current = null;
      sewersRef.current?.destroy();
      sewersRef.current = null;
      townRef.current?.destroy();
      townRef.current = null;
      if (flRef.current) destroyWaterLayer(flRef.current);
      if (gpuRef.current) destroyGpuWaterLayer(gpuRef.current);
      if (faRef.current) destroyFallLayer(faRef.current);
      if (drRef.current) destroyGpuDripLayer(drRef.current);
      if (slRef.current) clearStructureLayer(slRef.current);
      setShownStructures(null);
      if (tlRef.current?.ground) destroyGroundMesh(tlRef.current.ground);
      if (blRef.current) destroyBandLayer(blRef.current);
      slRef.current = null;
      flRef.current = null;
      gpuRef.current = null;
      drRef.current = null;
      blRef.current = null;
      tlRef.current = null;
      clRef.current = null;
      plRef.current = null;
    };
    // The renderer and stage are read only by the dev bench above, and both
    // outlive this effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [grid, scale, fieldEpoch]);

  // Frame the map once the viewport registers. Separate from the build effect
  // because the viewport can arrive after the scene is already drawn, and it
  // re-runs on resize since the fit depends on the canvas size.
  //
  // Set the zoom explicitly rather than via `fitWidth`: that helper's centring
  // and clamping interact in ways that left the camera stranded well outside
  // the map (scale 0.05 where 0.12 was wanted). Two lines of arithmetic are
  // easier to reason about than its argument semantics.
  const viewport = useWorldStore((s) => s.viewport);
  useEffect(() => {
    if (!viewport || !screenSize.width || !screenSize.height) return;
    const b = worldBounds(grid, scale);
    viewport.scale.set(fitScale(b, screenSize.width, screenSize.height));
    const c = boundsCentre(b);
    viewport.moveCenter(c.x, c.y);
  }, [viewport, grid, scale, screenSize.width, screenSize.height]);

  // ── overlays ────────────────────────────────────────────────────────────
  // World space, so Pixi: they must pan and zoom with the map. Geometry and
  // colour only — exact numbers are reported by anchored HTML instead.
  // Created imperatively rather than as <pixiGraphics>: that element's types
  // demand a `draw` callback (the same friction v1 lives with), and these are
  // redrawn on demand, not per frame.
  const overlayRoot = useRef<Container>(null);
  const gridGfx = useRef<Graphics | null>(null);
  const bandGfx = useRef<Graphics | null>(null);
  const tintGfx = useRef<Graphics | null>(null);
  const netGfx = useRef<Graphics | null>(null);
  const maskGfx = useRef<Graphics | null>(null);
  const gapGfx = useRef<Graphics | null>(null);
  const laneGfx = useRef<Graphics | null>(null);
  const laneCache = useRef<{ grid: Grid; rev: number; G: LaneGraph } | null>(null);
  const originGfx = useRef<Graphics | null>(null);
  const hoverGfx = useRef<Graphics | null>(null);
  const openGfx = useRef<Graphics | null>(null);
  const crossGfx = useRef<Graphics | null>(null);
  const overlays = useWorldStore((s) => s.overlays);
  const gpuWater = useWorldStore((s) => s.gpuWater);
  const bandRange = useRef({ lo: 0, hi: 0 });

  // Redraw the static overlays when their inputs change, not per frame.
  const redrawOverlays = useCallback(() => {
    const { lo, hi } = bandRange.current;
    if (gridGfx.current) {
      if (overlays.grid) drawGrid(gridGfx.current, grid, scale, lo, hi);
      else gridGfx.current.clear();
    }
    if (bandGfx.current) {
      if (overlays.bands) drawBandStripes(bandGfx.current, grid, scale, lo, hi);
      else bandGfx.current.clear();
    }
    if (tintGfx.current) {
      if (overlays.height) drawHeightTint(tintGfx.current, grid, scale, lo, hi);
      else tintGfx.current.clear();
    }
    if (netGfx.current) {
      const net = getNetwork();
      if (overlays.net && net) {
        drawNetComponents(netGfx.current, grid, scale, lo, hi,
          (x, y) => netIdAt(net, grid, x, y));
      } else netGfx.current.clear();
    }
    if (maskGfx.current) {
      if (overlays.mask) {
        drawRoadMask(maskGfx.current, grid, scale, lo, hi,
          (x, y) => maskAt(grid, x, y), (x, y) => isPaved(grid, x, y));
      } else maskGfx.current.clear();
    }
    if (gapGfx.current) {
      if (overlays.gaps) {
        drawRoadGaps(gapGfx.current, grid, scale, lo, hi, (x, y) =>
          isPaved(grid, x, y) ? roadSpriteFor(ROAD_TABLE, maskAt(grid, x, y)) : null);
      } else gapGfx.current.clear();
    }
    if (laneGfx.current) {
      if (overlays.lanes) {
        // Built once a revision: panning redraws the overlays.
        const rev = useWorldStore.getState().revision, c = laneCache.current;
        const G = c && c.grid === grid && c.rev === rev ? c.G : buildLaneGraph(grid);
        laneCache.current = { grid, rev, G };
        drawLaneGraph(laneGfx.current, grid, G, scale);
      }
      else laneGfx.current.clear();
    }
    if (originGfx.current) {
      if (overlays.origin) drawOrigin(originGfx.current, grid, scale);
      else originGfx.current.clear();
    }
  }, [grid, scale, overlays]);

  /**
   * X-RAY: fade the ground so what is buried in it can be seen.
   *
   * Not drawn like the other overlays — there is nothing to draw. The pipework
   * and the water in it are already on the screen every frame, above the
   * ground tiers; all that is in the way is the hill. So this takes the hill
   * down to a quarter and leaves everything else exactly as it was, which
   * means a buried run needs no second renderer and cannot disagree with the
   * one that draws it the rest of the time.
   *
   * Re-applied on `sceneEpoch` as well, because a rebuilt band layer arrives
   * with fresh containers at full strength.
   */
  useEffect(() => {
    const bl = blRef.current;
    if (bl) setGroundAlpha(bl, overlays.xray ? XRAY_GROUND : 1);
  }, [overlays.xray, sceneEpoch, grid]);

  useEffect(() => {
    const root = overlayRoot.current;
    if (!root) return;
    // z-sorted rather than insertion-ordered: the build cursor's outline is
    // created later (it needs the band layer) and must stay on top of these
    // however the two effects happen to interleave.
    root.sortableChildren = true;
    const refs = [bandGfx, tintGfx, netGfx, maskGfx, gapGfx, laneGfx, gridGfx, originGfx, hoverGfx, crossGfx, openGfx];
    const made = refs.map((r, i) => {
      const g = new Graphics();
      g.zIndex = i;              // stripes, tint, net, mask, grid, origin, hover, crosshair, what opens
      root.addChild(g);
      r.current = g;
      return g;
    });
    redrawOverlays();
    return () => {
      for (const g of made) { g.parent?.removeChild(g); g.destroy(); }
      for (const r of refs) r.current = null;
    };
  }, [redrawOverlays]);

  // ── picking ─────────────────────────────────────────────────────────────
  // Listened on the VIEWPORT rather than a hit plane: the pointer position is
  // all that is needed, so picking stays purely geometric and cannot be
  // swallowed by a tall sprite overhanging the cell in front of it.
  const viewportForPick = useWorldStore((s) => s.viewport);
  const repickRef = useRef<((wx: number, wy: number) => void) | null>(null);
  useEffect(() => {
    const vp = viewportForPick;
    if (!vp) return;
    const repick = (wx: number, wy: number) => {
      const st = useWorldStore.getState();
      const qy = wy + st.pickNudge;
      const cell = pickCell(
        wx, qy,
        surfaceSampler(st.grid),
        { min: st.grid.minHeight, max: st.grid.maxHeight },
        st.scale,
      );
      const f = worldToCellF(wx, qy + 0, 0, st.scale);
      st.setPointer({ wx, wy, fx: f.x, fy: f.y });
      const cur = st.hover;
      if (cell?.x !== cur?.x || cell?.y !== cur?.y) {
        st.setHover(cell);
        if (cell && st.stroke) st.updateStroke(cell);
      }
    };
    // Exposed so the calibration panel can re-pick at the LAST pointer position
    // when the offset changes — otherwise adjusting it appears to do nothing,
    // because your pointer is on the slider rather than the map.
    repickRef.current = repick;

    // Resolve the cell from the EVENT, so a press never depends on a
    // pointermove having happened first — a click with no preceding move (or
    // straight after the pointer re-enters the canvas) must still paint.
    const cellAt = (e: FederatedPointerEvent) => {
      const st = useWorldStore.getState();
      const p = vp.toWorld(e.global.x, e.global.y);
      return pickCell(
        p.x, p.y + st.pickNudge,
        surfaceSampler(st.grid),
        { min: st.grid.minHeight, max: st.grid.maxHeight },
        st.scale,
      );
    };

    // A TAKEOVER UNDER THE POINTER — a drone's job, or a building marked red:
    // the cell to refuse it at, by the building drawn there, then the ground. @see vetoAt
    const vetoCell = (e: FederatedPointerEvent) => {
      const st = useWorldStore.getState();
      if (!st.playing) return null;
      const hit = structureHitAt(slRef.current, e.global.x, e.global.y);
      for (const c of [hit ? { x: hit.x, y: hit.y } : null, cellAt(e)]) {
        if (c && vetoAt(getAiRunner(), st.grid, c.x, c.y, true)) return c;
      }
      return null;
    };
    let vetoHover = false;
    const canvas = app.canvas;

    const onMove = (e: FederatedPointerEvent) => {
      const p = vp.toWorld(e.global.x, e.global.y);
      repick(p.x, p.y);
      const veto = getAiRunner().jobs.length + getAiRunner().pending.length > 0 && !!vetoCell(e);
      if (veto !== vetoHover) canvas.style.cursor = veto ? "pointer" : "";
      vetoHover = veto;
      // A BUILDING THAT OPENS SOMETHING under the pointer, in the game and not
      // mid-stroke: tested only against those, by what they drew. @see opensSomething
      const st = useWorldStore.getState();
      const open = st.playing && !st.stroke && clickTakesOver(st.tool)
        ? structureHitAt(slRef.current, e.global.x, e.global.y, (s) => takesClick(s.def, s.build) && clickTakesOver(st.tool, s.def))
        : null;
      st.setHoverOpen(open?.id ?? null);
      // THE BUILDING UNDER THE POINTER, for its full label: tested only against
      // those standing near the cell it is over — a tall one is drawn up the
      // screen from its footprint, so those in front of the cell. @see BuildingLabels
      const cell = st.hover;
      const under = st.playing && !st.stroke && cell
        ? structureHitAt(slRef.current, e.global.x, e.global.y, (s) => Math.abs(s.x - cell.x) <= NEAR_HOVER && Math.abs(s.y - cell.y) <= NEAR_HOVER && s.x + s.w + s.y + s.h >= cell.x + cell.y)
        : null;
      st.setHoverBuilding(under?.id ?? null);
    };
    const onLeave = () => {
      const st = useWorldStore.getState();
      st.setHoverOpen(null);
      st.setHoverBuilding(null);
      st.setHover(null);
      st.setPointer(null);
      st.cancelStroke();
    };

    // Left button paints. pixi-viewport keeps left-drag pan, so a paint drag
    // and a camera drag would fight — the paint tools therefore take the left
    // button and panning stays on middle/right while a tool is active.
    // WITH THE LOOK TOOL, a press that is let go where it was pressed is a
    // CLICK on the cell under it — a building, say, to open what it is for —
    // and one dragged away is the camera panning. @see WorldState.lookedAt
    // OVER A BUILDING THAT OPENS SOMETHING, any tool's press is such a click
    // on it: the building takes the click. @see clickTakesOver
    let lookFrom: { x: number; y: number; cell: { x: number; y: number } | null; open?: boolean; veto?: boolean } | null = null;
    // FINGERS DOWN: a second one makes it a pinch, not a stroke.
    const touches = new Set<number>();
    const onDown = (e: FederatedPointerEvent) => {
      if (e.pointerType === "touch") {
        touches.add(e.pointerId);
        if (touches.size > 1) { useWorldStore.getState().cancelStroke(); lookFrom = null; return; }
      }
      if (e.button !== 0) return;
      const st = useWorldStore.getState();
      // A takeover pressed on is refused, whatever the tool, if let go there.
      const veto = vetoCell(e);
      if (veto) {
        lookFrom = { x: e.global.x, y: e.global.y, cell: veto, veto: true };
        return;
      }
      // Tested where the press lands, not taken from the hover: a finger has no hover, and the last one may be stale.
      const open = st.playing && clickTakesOver(st.tool)
        ? structureHitAt(slRef.current, e.global.x, e.global.y, (s) => takesClick(s.def, s.build) && clickTakesOver(st.tool, s.def))
        : null;
      if (open) {
        lookFrom = { x: e.global.x, y: e.global.y, cell: { x: open.x, y: open.y }, open: true };
        return;
      }
      if (st.tool === "inspect") {
        lookFrom = { x: e.global.x, y: e.global.y, cell: cellAt(e) };
        return;
      }
      const cell = cellAt(e);
      if (!cell) return;                       // pressed off the map
      st.setHover(cell);
      st.beginStroke(cell);
    };
    const onUp = (e: FederatedPointerEvent) => {
      const pinching = touches.size > 1;
      touches.delete(e.pointerId);
      if (pinching) return;
      const st = useWorldStore.getState();
      if (lookFrom?.veto) {
        // REFUSED: called off, remembered, and answered. @see recordVeto
        const moved = Math.hypot(e.global.x - lookFrom.x, e.global.y - lookFrom.y);
        if (moved <= LOOK_CLICK_SLOP && vetoAt(getAiRunner(), st.grid, lookFrom.cell!.x, lookFrom.cell!.y)) {
          useGenerationStore.getState().recordVeto();
          st.pushAiMemo(VETO_REPLIES[Math.floor(Math.random() * VETO_REPLIES.length)]);
        }
        lookFrom = null;
        return;
      }
      if (lookFrom && (st.tool === "inspect" || lookFrom.open)) {
        const moved = Math.hypot(e.global.x - lookFrom.x, e.global.y - lookFrom.y);
        if (moved <= LOOK_CLICK_SLOP && lookFrom.open) st.lookAt(lookFrom.cell!);
        else if (moved <= LOOK_CLICK_SLOP) {
          // THE BUILDING UNDER THE POINTER, by what is drawn, before the
          // ground: a click on a tower's side is on the tower, though the cell
          // picked under it is the ground well behind. @see structureHitAt
          const hit = structureHitAt(slRef.current, e.global.x, e.global.y);
          const cell = hit ? { x: hit.x, y: hit.y } : lookFrom.cell;
          if (cell) st.lookAt(cell);
        }
      }
      lookFrom = null;
      if (st.stroke) st.endStroke();
    };
    vp.eventMode = "static";
    vp.on("pointermove", onMove);
    vp.on("pointerleave", onLeave);
    vp.on("pointerdown", onDown);
    vp.on("pointerup", onUp);
    vp.on("pointerupoutside", onUp);
    return () => {
      vp.off("pointermove", onMove);
      vp.off("pointerleave", onLeave);
      vp.off("pointerdown", onDown);
      vp.off("pointerup", onUp);
      vp.off("pointerupoutside", onUp);
    };
  }, [viewportForPick, app]);

  // Hover highlight follows the store, redrawn only when the cell changes —
  // off a SUBSCRIPTION, not a selector: the hover moves with the pointer, and
  // a selector re-rendered this whole component on every cell it crossed.
  // @see the build cursor below, which does the same
  useEffect(() => {
    const draw = () => {
      const st = useWorldStore.getState();
      // Over a building that opens something, the building is what is lit, not the tile.
      if (hoverGfx.current) drawHover(hoverGfx.current, grid, st.hoverOpen === null ? st.hover : null, scale);
    };
    draw();
    return useWorldStore.subscribe((s, was) => { if (s.hover !== was.hover || s.hoverOpen !== was.hoverOpen) draw(); });
  }, [grid, scale]);

  // Calibration: changing the offset re-picks at the last pointer position, so
  // the highlight and crosshair move while you drag the slider.
  const pickNudge = useWorldStore((s) => s.pickNudge);
  useEffect(() => {
    const p = pointerRead();
    if (p && repickRef.current) repickRef.current(p.wx, p.wy);
  }, [pickNudge]);

  /**
   * THE PICK CROSSHAIR, drawn from the tick rather than from an effect.
   *
   * It used to depend on `pointer` in the store, which meant a React render
   * and an effect on every pointer move — for a debug overlay drawn with two
   * lines. The pointer is a latch now, so this watches it the way the rest of
   * the scene watches the water: every frame, and it only redraws when the
   * thing it draws has actually moved. @see pointerSaw
   */
  const crossAt = useRef<PointerAt | null>(null);

  /**
   * WHAT OPENS, LIT: the building under the pointer that a click would open,
   * framed and pulsing every frame it is there, and the pointer a hand.
   * @see drawOpenHighlight
   */
  // THE HOLOGRAMS' FLICKER AND SCAN LINES, every frame they are up; and AI
  // mode's, one a drone carrying a building, kept to the jobs out. @see send
  // And THE MASTERPLAN'S buildings not yet up nor under way, the nearest the
  // town's middle first, steady and faint. Worked out again only when the
  // plan, the map or the drones change. @see PLAN_HOLOGRAMS
  const aiHoloSig = useRef("");
  useTick(() => {
    const tHolo = performance.now();
    const holos: HoloSpec[] = [];
    const flying = new Set<string>();
    for (const j of getAiRunner().jobs) {
      // THE TAKEOVER'S drones too: what each will put up, or take — red. @see vetoAt
      const a = j.action;
      const holo = a.kind === "deferred" ? a.holo
        : a.kind === "place" ? { def: a.def, ...a.at }
        : a.kind === "convert" ? { def: a.into, ...a.at } : null;
      if (!holo) continue;
      const { def, x, y } = holo;
      flying.add(`${def}@${x},${y}`);
      holos.push({ key: `ai:${def}@${x},${y}`, def, x, y, ok: a.kind !== "convert" });
    }
    // A TAKEOVER ANNOUNCED: what the building will become, red over it, till it is done. @see announce
    for (const p of getAiRunner().pending) {
      const { into, at } = p.action;
      flying.add(`take:${into}@${at.x},${at.y}`);
      holos.push({ key: `take:${into}@${at.x},${at.y}`, def: into, x: at.x, y: at.y, ok: false });
    }
    const ss = useSessionStore.getState(), st = useWorldStore.getState();
    const show = ss.showPlan && ss.aiMode && st.playing;
    const plan = show ? currentPlan() : null;
    const pipe = show ? pendingPipe() : null;
    const sig = `${[...flying].join("|")}#${plan ? planId(plan) : -1}#${pipe ? planId(pipe) : -1}#${st.revision}`;
    if (sig !== aiHoloSig.current) {
      aiHoloSig.current = sig;
      const g = st.grid;
      const tiles: TileHolo[] = [];
      if (plan) {
        // ITS BUILDINGS, every one not up nor under way, nearest the middle first.
        const builds = plan.steps
          .filter((s): s is Extract<typeof s, { kind: "build" }> => s.kind === "build")
          .filter((s) => !flying.has(`${s.def}@${s.at.x},${s.at.y}`) && structureAt(g, s.at.x, s.at.y) < 0)
          .sort((a, b) => Math.abs(a.at.x - plan.centre.x) + Math.abs(a.at.y - plan.centre.y) - Math.abs(b.at.x - plan.centre.x) - Math.abs(b.at.y - plan.centre.y))
          .slice(0, PLAN_HOLOGRAMS);
        // A lot as the house it is planned to grow to: the district it builds toward. (It starts at I.)
        for (const s of builds) holos.push({ key: `plan:${s.def}@${s.at.x},${s.at.y}`, def: s.tier && structureDef(withTier(s.def, s.tier)) ? withTier(s.def, s.tier) : s.def, x: s.at.x, y: s.at.y, ok: true, planned: true });
        // ITS STREETS, as the tiles they will be: each one's road art worked
        // out as if every planned street were laid, so they join up.
        const ghost = { ...g, paved: Uint16Array.from(g.paved) };
        const streets: { x: number; y: number }[] = [];
        for (const s of plan.steps) {
          if (s.kind !== "road") continue;
          for (let y = Math.min(s.from.y, s.to.y); y <= Math.max(s.from.y, s.to.y); y++) {
            for (let x = Math.min(s.from.x, s.to.x); x <= Math.max(s.from.x, s.to.x); x++) {
              if (!inBounds(g, x, y) || isPaved(g, x, y)) continue;
              ghost.paved[idx(g, x, y)] = 1;
              streets.push({ x, y });
            }
          }
        }
        for (const c of streets) {
          const frame = roadSpriteFor(ROAD_TABLE, maskAt(ghost, c.x, c.y)).frame;
          if (frame) tiles.push({ key: `road:${c.x},${c.y}`, x: c.x, y: c.y, z: surfaceHeightAt(g, c.x, c.y), frame, colour: HOLO_OK, alpha: 0.5 });
        }
        for (const s of plan.steps) {
          // ITS GROUND LEVELLED: each tile's own terrain at the height it will be.
          if (s.kind === "level") {
            for (let y = Math.min(s.from.y, s.to.y); y <= Math.max(s.from.y, s.to.y); y++) {
              for (let x = Math.min(s.from.x, s.to.x); x <= Math.max(s.from.x, s.to.x); x++) {
                if (!inBounds(g, x, y) || g.height[idx(g, x, y)] === s.z) continue;
                const frame = st.palette[g.terrain[idx(g, x, y)]];
                if (frame) tiles.push({ key: `level:${x},${y}`, x, y, z: s.z, frame, colour: HOLO_OK, alpha: 0.55 });
              }
            }
          }
          // ITS ROAD TO LIFT, red over the road that is there.
          if (s.kind === "lift" && isPaved(g, s.at.x, s.at.y)) {
            const frame = roadSpriteFor(ROAD_TABLE, maskAt(g, s.at.x, s.at.y)).frame;
            if (frame) tiles.push({ key: `lift:${s.at.x},${s.at.y}`, x: s.at.x, y: s.at.y, z: surfaceHeightAt(g, s.at.x, s.at.y), frame, colour: HOLO_BLOCKED, alpha: 0.6 });
          }
          // ITS HOUSE TO CLEAR, red glass over the house.
          if (s.kind === "clear") {
            const id = structureAt(g, s.at.x, s.at.y);
            const there = id >= 0 ? g.structures.get(id) : undefined;
            if (there) holos.push({ key: `clear:${there.id}`, def: there.def, x: there.x, y: there.y, ok: false, planned: true });
          }
        }
      }
      // AND THE PUMP HOUSE OF A PIPE IT MEANS TO LAY.
      if (pipe?.pump) holos.push({ key: `pump:${pipe.pump.x},${pipe.pump.y}`, def: "pump", x: pipe.pump.x, y: pipe.pump.y, ok: true, planned: true });
      planHoloKeys.current = new Set(holos.filter((h) => h.planned).map((h) => `${h.def}@${h.x},${h.y}`));
      aiHolos.current = holos;
      showHolos();
      const bl = blRef.current, tex = texRef.current;
      if (tileHoloRef.current && bl && tex) tileHoloRef.current.set(tiles, { bands: bl, textures: tex, grid: g, scale: st.scale });
    }
    const h = holoRef.current, scan = holoScanRef.current;
    if (h && scan) h.tick(performance.now() / 1000, scan);
    perfAdd("fx", performance.now() - tHolo);
  });

  const openShown = useRef<number | null>(null);
  useTick(() => {
    const g = openGfx.current;
    if (!g) return;
    const st = useWorldStore.getState();
    const s = st.hoverOpen !== null ? st.grid.structures.get(st.hoverOpen) : undefined;
    const id = s?.id ?? null, was = openShown.current;
    if (id !== was) app.canvas.style.cursor = id !== null ? "pointer" : "";
    openShown.current = id;
    if (!s) { if (was !== null) g.clear(); return; }
    const sl = slRef.current, b = sl ? drawnBounds(sl, s.id) : null;
    let drawn: { x: number; y: number; w: number; h: number } | null = null;
    if (b && g.parent) {
      const a = g.parent.toLocal({ x: b.x, y: b.y }), c = g.parent.toLocal({ x: b.x + b.w, y: b.y + b.h });
      drawn = { x: a.x, y: a.y, w: c.x - a.x, h: c.y - a.y };
    }
    drawOpenHighlight(g, st.grid, s, st.scale, drawn, performance.now() / 1000);
  });

  useTick(() => {
    const p = pointerRead();
    if (p === crossAt.current) return;
    crossAt.current = p;
    const st = useWorldStore.getState();
    if (crossGfx.current) {
      drawPickCrosshair(crossGfx.current, p, st.hover, st.grid, st.scale);
    }
  });

  // The palette grows when the browser paints an unused frame, so the terrain
  // layer's copy must be refreshed or a brand-new material renders as nothing.
  const palette = useWorldStore((s) => s.palette);
  useEffect(() => {
    if (tlRef.current) tlRef.current.palette = palette;
    if (clRef.current) clRef.current.palette = palette;
  }, [palette]);

  // Reconcile ONLY the cells an edit touched. This is the whole point of the
  // per-cell sprite handles: an edit costs one sprite update per changed cell,
  // where v1 would rebuild every ground sprite on the map.
  const revision = useWorldStore((s) => s.revision);
  useEffect(() => {
    const tl = tlRef.current, bl = blRef.current, cl = clRef.current;
    const pl = plRef.current, sl = slRef.current, tex = texRef.current;
    if (!tl || !bl || !cl || !pl || !sl || !tex) return;
    const sSync = section("effect: reconcile an edit");
    // DRAINED, not read from state: several commits in one React batch collapse
    // into a single re-render, and reading `lastTouched` would show only the
    // last one's cells while the rest stayed in the grid and off the screen.
    const touched = drainDirty(grid);
    if (!touched.length) return;
    for (const c of touched) {
      syncCell(tl, bl, grid, tex, c.x, c.y);
      // The tiles behind it may now show their sides, or stop. @see covered
      syncCell(tl, bl, grid, tex, c.x - 1, c.y);
      syncCell(tl, bl, grid, tex, c.x, c.y - 1);
      // A column belongs to the taller cell but EXISTS because of the shorter
      // one, so a height edit re-syncs the neighbours that now look onto it —
      // the store already widened `lastTouched` to include them.
      syncCliff(cl, bl, grid, tex, c.x, c.y);
    }
    flushTerrain(tl, grid);
    // A road's tile depends on its EIGHT neighbours, so the paved dirty set is
    // wider than the edited set — and it is wider for a height edit too, since
    // height decides whether two paved cells are joined at all.
    // Painted, a road's look reads further — the junction ahead, the zebra
    // behind — and its texture its neighbours' looks: wider again.
    const pavedDirty = new Set<number>();
    const dirtyOf = pl.painter ? lookDirtyCells : maskDirtyCells;
    if (pl.painter && touched.length) refreshLooks(pl, grid);
    for (const c of touched) {
      for (const n of dirtyOf(grid, c.x, c.y)) pavedDirty.add(n.y * grid.w + n.x);
    }
    for (const k of pavedDirty) {
      syncPaved(pl, bl, grid, tex, k % grid.w, Math.floor(k / grid.w));
    }
    if (pavedDirty.size) recountInexact(pl, grid);
    // Structures last: mounting reads the height the ground now has, so the
    // terrain pass above must have settled first. `syncStructures` walks the
    // record map (tens of entries) while `refreshStructuresAt` only re-draws
    // the ones the edit actually stood on.
    const ctx: RenderCtx = { bands: bl, textures: tex, grid, scale };
    // What changed while the map is up gets its motion; what it loaded with does not. @see createJuice
    syncStructures(sl, ctx, juiceRef.current ?? undefined);
    refreshStructuresAt(sl, ctx, touched);

    // an edit can change the height range, so overlays may need redrawing
    redrawOverlays();
    sSync();
  }, [revision, grid, scale, redrawOverlays]);

  // THE MOOD SHOWN: every house's own sprites tinted by how happy it is,
  // looked at again every second, and put back when it is turned off.
  // @see moodTint
  const moodOverlay = useWorldStore((s) => s.moodOverlay);
  useEffect(() => {
    if (!moodOverlay) return;
    // Sprites a house rebuilt since — growing, filling — are gone, not reset.
    const tinted = new Set<{ tint: number; destroyed?: boolean }>();
    const paint = () => {
      const sl = slRef.current, net = getNetwork(), g = useWorldStore.getState().grid;
      if (!sl || !net) return;
      const moods = liveMoods(g, net);
      for (const [id, m] of sl.mounted) {
        const mood = moods.get(id);
        if (!mood || isDamaged(id)) continue;
        const h = m.handle as { sprites?: { tint: number; destroyed?: boolean }[] };
        for (const sp of h.sprites ?? []) { sp.tint = moodTint(mood.total); tinted.add(sp); }
      }
    };
    paint();
    const id = setInterval(paint, 1000);
    return () => {
      clearInterval(id);
      for (const sp of tinted) if (!sp.destroyed) sp.tint = 0xffffff;
    };
  }, [moodOverlay]);

  // DAMAGE SHOWN: a damaged building's sprites tinted by its cause until the
  // repair crew has been, looked at every second. @see damage, DAMAGED_TINT
  useEffect(() => {
    const muddied = new Map<number, { tint: number; destroyed?: boolean }[]>();
    const paint = () => {
      const sl = slRef.current;
      if (!sl) return;
      for (const [id, sprites] of muddied) {
        if (isDamaged(id)) continue;
        for (const sp of sprites) if (!sp.destroyed) sp.tint = 0xffffff;
        muddied.delete(id);
      }
      for (const [id, m] of sl.mounted) {
        if (!isDamaged(id)) continue;
        // Columns or sprites, as the building is drawn: an AI building is columns. @see deskTint
        const h = m.handle as { columns?: { tint: number; destroyed?: boolean }[]; sprites?: { tint: number; destroyed?: boolean }[] };
        const sprites = h.columns ?? h.sprites ?? [];
        const tint = DAMAGED_TINT[damageCause(id) ?? "flood"];
        for (const sp of sprites) sp.tint = tint;
        muddied.set(id, sprites);
      }
    };
    const id = setInterval(paint, 1000);
    return () => clearInterval(id);
  }, []);

  // A WORKPLACE AS FULL AS IT LOOKS: lit by the share of its desks taken —
  // a busy office bright, an empty one dark. Looked at every second, and
  // retinted only when the share has moved. @see seat
  useEffect(() => {
    // By the handle as well: a building redrawn from scratch is new graphics.
    const shown = new Map<number, { h: unknown; tint: number }>();
    const paint = () => {
      const sl = slRef.current, net = getNetwork(), st = useWorldStore.getState();
      if (!sl || !net || !st.playing) return;
      const desks = liveSeating(st.grid, net).desks;
      for (const [id, m] of sl.mounted) {
        const d = desks.get(id);
        if (!d || !d.of) continue;
        const tint = deskTint(d.used / d.of), was = shown.get(id);
        if (was && was.h === m.handle && was.tint === tint) continue;
        shown.set(id, { h: m.handle, tint });
        const h = m.handle as { columns?: { tint: number }[]; sprites?: { tint: number }[] };
        for (const g of h.columns ?? h.sprites ?? []) g.tint = tint;
      }
    };
    const id = setInterval(paint, 1000);
    return () => clearInterval(id);
  }, []);

  // Painting takes the left button, so panning moves to middle/right while a
  // paint tool is active — otherwise a paint drag and a camera drag collide.
  const tool = useWorldStore((s) => s.tool);
  useEffect(() => {
    if (!viewport) return;
    // ON A TOUCH SCREEN a finger is the "left button": with a tool in hand
    // it builds, and panning is two fingers — the pinch. @see onDown
    if (tool !== "inspect" && window.matchMedia?.("(pointer: coarse)").matches) viewport.plugins.remove("drag");
    else setPanButtons(viewport, tool === "inspect" ? "left-middle" : "middle-right");
  }, [viewport, tool]);

  // ── build cursor ────────────────────────────────────────────────────────
  // One path for hover AND drag: the tool only supplies cells, so the brush
  // footprint you see before pressing is the same shape that commits, drawn by
  // the same code. Per-cell validity, so a partly blocked footprint says which
  // cells are the problem rather than just refusing as a whole.
  // THE STROKE AND THE HOVER ARE NOT SUBSCRIBED HERE. They change on every
  // pointer move, and a selector here re-rendered the whole scene component
  // each time to redraw one cursor — on a pour dragged over a 128 tile map,
  // most of the 22 ms each move was costing once the drawing itself was
  // cheap. The cursor is redrawn straight off a store subscription instead.
  const brushRadius = useWorldStore((s) => s.brushRadius);
  const material = useWorldStore((s) => s.material);
  const structureDefId = useWorldStore((s) => s.structureDefId);
  // `palette` and `revision` are already selected above, for the terrain
  // layer's copy and the per-cell reconcile respectively.

  /**
   * THE PLACING HEAT MAP, with a lot in hand: every tile it could go on tinted
   * by how desirable a house there would be. Drawn again when the map, the
   * tool or the lot in hand changes. @see createDesireHeat, desireAt
   */
  useEffect(() => {
    const heat = heatRef.current;
    if (!heat) return;
    const def = structureDef(structureDefId);
    const who = tool === "placeStructure" && def ? housedBy(def.id)?.id ?? null : null;
    const net = getNetwork();
    if (!who || !net || !useWorldStore.getState().playing) { heat.draw(grid, null, null, () => false, scale); return; }
    const rules = playRules(grid);
    heat.draw(grid, liveDesireMaps(grid, net), who, (x, y) => validatePlacement(grid, def!, x, y, rules).ok, scale);
  }, [tool, structureDefId, grid, revision, scale, sceneEpoch]);

  /** THE EARNINGS OVERLAY: the streets tinted by what they earn, every two seconds while it is on. */
  const earningsOverlay = useWorldStore((s) => s.earningsOverlay);
  useEffect(() => {
    const heat = streetHeatRef.current;
    if (!heat) return;
    if (!earningsOverlay) { heat.draw(grid, null, [], scale); return; }
    const paint = () => heat.draw(grid, liveStreets()?.streets ?? null, liveStreetEarnings(), scale);
    paint();
    const id = setInterval(paint, 2000);
    // Cleared through the ref: the scene going down destroys the overlay first.
    return () => { clearInterval(id); streetHeatRef.current?.draw(grid, null, [], scale); };
  }, [earningsOverlay, grid, scale, sceneEpoch]);

  /**
   * SEEING BEHIND: what stands in front of the focus collapses to its ground
   * floor, an outline of its full height left standing, and goes back up a
   * moment after. Bounds of a building already down are its FULL height, as
   * measured before — or it would stop being in the way the moment it fell,
   * and stand, and fall. @see cutaway
   */
  const cutaway = useRef(createCutaway());
  const cutFull = useRef(new Map<number, Rect>());
  const cutOutline = useRef<Graphics | null>(null);
  /** Where a building is drawn, in the overlay's space — its full height if it is down. */
  const cutBounds = useCallback((id: number): Rect | null => {
    const full = cutFull.current.get(id);
    if (full) return full;
    const sl = slRef.current, ov = overlayRoot.current;
    const b = sl && ov ? drawnBounds(sl, id) : null;
    if (!b || !ov) return null;
    const a = ov.toLocal({ x: b.x, y: b.y }), c = ov.toLocal({ x: b.x + b.w, y: b.y + b.h });
    return { x: a.x, y: a.y, w: c.x - a.x, h: c.y - a.y };
  }, []);
  /** Down, or up again: a building in floors rebuilt with one or all; anything else faded. */
  const cutOne = useCallback((id: number, down: boolean) => {
    const sl = slRef.current, bl = blRef.current, tex = texRef.current;
    const m = sl?.mounted.get(id);
    if (!sl || !bl || !tex || !m) { cutFull.current.delete(id); return; }
    const def = structureDef(m.s.def);
    if (!def) return;
    if (down) { const b = cutBounds(id); if (b) cutFull.current.set(id, b); } else cutFull.current.delete(id);
    if (def.render.kind === "tiles") {
      setCollapsed(id, down);
      m.renderer.update(m.handle, m.s, def, { bands: bl, textures: tex, grid: useWorldStore.getState().grid, scale });
    } else {
      for (const p of partsOf(m.handle)) p.alpha = down ? CUT_FADE : 1;
    }
  }, [cutBounds, scale]);
  /** The outlines of everything down, its full height standing where it was. */
  const drawCutOutlines = useCallback(() => {
    const g = cutOutline.current, sl = slRef.current;
    if (!g || !sl) return;
    g.clear();
    const grid = useWorldStore.getState().grid;
    for (const [id, full] of cutFull.current) {
      const s = grid.structures.get(id);
      if (!s || structureDef(s.def)?.render.kind !== "tiles") continue;
      const z = inBounds(grid, s.x, s.y) ? grid.height[idx(grid, s.x, s.y)] : 0;
      const at = (u: number, v: number): [number, number] => [(u - v) * HW * scale, (u + v) * HH * scale - z * HEIGHT_UNIT * scale];
      const back = at(s.x - 0.5, s.y - 0.5), right = at(s.x + s.w - 0.5, s.y - 0.5);
      const front = at(s.x + s.w - 0.5, s.y + s.h - 0.5), left = at(s.x - 0.5, s.y + s.h - 0.5);
      const up = Math.max(0, back[1] - full.y);
      const top = (p: [number, number]): [number, number] => [p[0], p[1] - up];
      g.poly([...top(back), ...top(right), ...top(front), ...top(left)]);
      for (const p of [left, front, right]) g.moveTo(...p).lineTo(...top(p));
      g.stroke({ color: CUT_OUTLINE, width: 1.5, alpha: 0.45, pixelLine: true });
    }
  }, [scale]);
  /** What the hand is on now: the occluders of it collapsed, those no longer in the way left to stand again. */
  const cutawayFor = useCallback((focus: readonly { x: number; y: number }[], up = 0, extra: readonly Rect[] = [], inset = 0) => {
    const st = useWorldStore.getState();
    const next = st.playing ? occludersOf(st.grid, focus, scale, cutBounds, up, extra, inset) : new Set<number>();
    const { collapse } = cutaway.current.set(next, performance.now());
    for (const id of collapse) cutOne(id, true);
    if (collapse.length) drawCutOutlines();
  }, [cutBounds, cutOne, drawCutOutlines, scale]);
  // And up again, once their grace is over.
  useTick(() => {
    if (!cutaway.current.size) return;
    const { raise } = cutaway.current.tick(performance.now());
    for (const id of raise) cutOne(id, false);
    if (raise.length) drawCutOutlines();
  });
  // The outline layer, over the map, under the cursor.
  useEffect(() => {
    const ov = overlayRoot.current;
    if (!ov) return;
    const g = new Graphics();
    g.eventMode = "none";
    g.zIndex = 994;
    ov.addChild(g);
    cutOutline.current = g;
    const cut = cutaway.current, full = cutFull.current;
    return () => {
      for (const id of cut.clear()) setCollapsed(id, false);
      full.clear();
      g.parent?.removeChild(g); g.destroy();
      cutOutline.current = null;
    };
  }, [grid, sceneEpoch]);

  useEffect(() => {
    const cur = cursorRef.current, tex = texRef.current;
    if (!cur || !tex) return;

    const draw = () => {
      const { stroke, hover: hoverForBrush, hoverOpen } = useWorldStore.getState();
      // Over a building that opens something, the tool is put down: no cursor. @see opensSomething
      const unplace = () => { cur.clear(); if (placeHolos.current.length) { placeHolos.current = []; showHolos(); } };
      // Over a building that opens something, the player is aiming at IT: nothing gets out of its way.
      if (!stroke && hoverOpen !== null) { unplace(); cutawayFor([]); return; }
      // A live drag takes over; otherwise the hover stands in as a one-cell
      // anchor so the brush size is visible before pressing rather than
      // discovered after.
      const s0: Stroke | null = stroke ?? (
        hoverForBrush && tool !== "inspect"
          ? { tool, brush: "point", anchor: hoverForBrush, head: hoverForBrush }
          : null
      );
      if (!s0) {
        unplace();
        // WITH THE LOOK TOOL, the tile under the pointer is never hidden — and a
        // building on it kept clear its whole height. Aimed at a tower's wall,
        // that tile is the ground behind it, so the tower gets out of the way;
        // aimed at its foot, it is the tower. @see cutaway
        if (tool !== "inspect" || !hoverForBrush) { cutawayFor([]); return; }
        const id = structureAt(grid, hoverForBrush.x, hoverForBrush.y);
        const on = id >= 0 ? grid.structures.get(id) : undefined;
        const own = on ? cutBounds(on.id) : null;
        cutawayFor(on ? footprintCells(on.x, on.y, on.w, on.h) : [hoverForBrush], 0, own ? [own] : [], POINT_INSET);
        return;
      }

      // A STRUCTURE tool previews its footprint, not a brush: the same function
      // the commit uses, so the rect you drag out is the rect you get.
      // Demolish dragged from a pipe or a road previews the line it lifts. @see demolishLifts
      const lifting = s0.tool === "demolish" && useWorldStore.getState().playing && demolishLifts(grid, s0.anchor) !== null;
      let cells = isStructureTool(s0.tool) && !lifting
        ? (() => {
            const fp = structureFootprint(structureDef(structureDefId), s0.anchor, s0.head);
            return footprintCells(fp.x, fp.y, fp.w, fp.h);
          })()
        : strokeFootprint(grid, lifting ? { ...s0, brush: "line" } : s0, brushRadius);
      // A MAIN, in the game, shows its route — drawn by the mains layer — not the straight line it is dragged along. @see mainPreview
      if (s0.tool === "pipe" && useWorldStore.getState().playing) cells = [...(mainPreview()[0] ?? [])];
      // A SEWER, its route.
      if (s0.tool === "sewer" && s0.lateral) cells = [...(mainPreview()[0] ?? [])];
      else if (s0.tool === "sewer") { const p = sewerGhost(); if (p) cells = p.cells.map((c) => ({ x: c.x, y: c.y })); }

      // A STRUCTURE'S FOOTPRINT is judged whole — on a bank, on level enough
      // ground — and the verdict handed to each of its cells. Against the
      // rivers as traffic last mapped them, which is at most a second old.
      // @see validatePlacement
      let valid: Validator | undefined;
      const rivers = getTraffic().rivers ?? undefined;
      // The same rules the click will be held to, frontage too under play rules.
      const rules = {
        ...(rivers ? { rivers } : {}),
        ...(useWorldStore.getState().playing ? playRules(grid) : {}),
      };
      // OVER A BUILDING WITH A NEXT TIER, the click upgrades it, so the cursor
      // shows what it would grow into instead. @see planUpgrade
      const under = s0.tool === "placeStructure" ? structureAt(grid, s0.head.x, s0.head.y) : -1;
      const plan = under >= 0 ? planUpgrade(grid, under, rules) : null;
      if (plan) {
        const { w, h } = plan.to.footprint;
        cells = footprintCells(plan.x, plan.y, w, h);
        valid = (_g, x, y) => plan.cells[(y - plan.y) * w + (x - plan.x)] ?? { ok: false };
      } else if (s0.tool === "placeStructure" && lotLine(useWorldStore.getState(), s0)) {
        // A LINE OF LOTS being dragged: each cell of it, and whether it takes one.
        const def = structureDef(structureDefId)!;
        cells = lotLine(useWorldStore.getState(), s0)!;
        const ok = new Map(cells.map((c) => [`${c.x},${c.y}`, validatePlacement(grid, def, c.x, c.y, rules).ok]));
        valid = (_g, x, y) => ({ ok: ok.get(`${x},${y}`) ?? false });
      } else if (s0.tool === "placeStructure") {
        const def = structureDef(structureDefId);
        if (def) {
          const fp = structureFootprint(def, s0.anchor, s0.head);
          const check = validatePlacement(grid, def, fp.x, fp.y, rules);
          valid = (_g, x, y) => check.cells[(y - fp.y) * fp.w + (x - fp.x)] ?? { ok: false };
        }
      }

      // THE HOLOGRAM of what the click puts down: the building itself, red where it cannot go. @see createHolograms
      const holos: HoloSpec[] = [];
      if (s0.tool === "placeStructure") {
        if (plan) holos.push({ key: "place:upgrade", def: plan.to.id, x: plan.x, y: plan.y, ok: plan.cells.every((c) => c.ok), steady: true });
        else if (lotLine(useWorldStore.getState(), s0)) {
          for (const c of lotLine(useWorldStore.getState(), s0)!) holos.push({ key: `place:${c.x},${c.y}`, def: structureDefId, x: c.x, y: c.y, ok: valid?.(grid, c.x, c.y).ok ?? true, steady: true });
        } else {
          const def = structureDef(structureDefId);
          if (def) {
            const fp = structureFootprint(def, s0.anchor, s0.head);
            holos.push({ key: "place", def: def.id, x: fp.x, y: fp.y, ok: validatePlacement(grid, def, fp.x, fp.y, rules).ok, steady: true });
          }
        }
      }
      placeHolos.current = holos;
      showHolos();
      // AND OUT OF THE WAY of what the tool is on: a building placed is taken to be tall. @see cutaway
      cutawayFor(cells, isStructureTool(s0.tool) ? PLACE_UP : 0);

      cur.update(grid, {
        valid,
        cells,
        // Only a material tool places a tile, so only it gets a ghost. Erase and
        // the height tools show the outline alone — ghosting a material they
        // never write would claim the wrong thing about what the click does.
        frame: s0.tool === "paintTerrain" ? (palette[material] ?? null) : null,
        tool: s0.tool,
        scale,
      }, tex);
    };
    draw();
    return useWorldStore.subscribe((s, was) => {
      // And on an edit: an upgrade changes what is under a cursor that has not moved.
      if (s.stroke !== was.stroke || s.hover !== was.hover || s.hoverOpen !== was.hoverOpen || s.revision !== was.revision) draw();
    });
  }, [
    brushRadius, tool, material, palette, structureDefId, showHolos,
    grid, scale, revision, sceneEpoch, cutBounds, cutawayFor,
  ]);

  /**
   * BUILT AND TORN DOWN WITH THE SWITCH, and rebuilt only when the FIELD
   * ITSELF is replaced.
   *
   * It holds a whole copy of the field on the device, so a map nobody has
   * switched over should not be paying for one — and a solver left pointing at
   * a field that has been replaced would step the wrong water.
   *
   * NOT ON `revision`, which is what this used to key on and which was wrong
   * in a way that looked like the switch being broken: `revision` bumps on
   * every edit, and pouring water is an edit. So every pour tore the solver
   * down and built it again — every pipeline recompiled, the readback in
   * flight killed, the upload forced back to a full one — and a DRAG pour
   * bumps it every pointer move, so the solver never got past its first frame
   * and the water never appeared at all.
   *
   * What a rebuild is actually for is a different field: a new map, or a
   * resize, where the buffers are the wrong size. That is a change of object
   * identity and is tested as one, so no counter can be wrong about it. A
   * terrain edit needs nothing — `ground` goes up with every frame's arrivals.
   */
  /**
   * THE DEVICE GOING IS A HANDOVER, not a crash.
   *
   * A lost device makes every call a silent no-op and every readback reject,
   * and those rejections are swallowed on purpose throughout the solver
   * because teardown causes them too — so without this the map simply stopped
   * moving, with the water toggle still reading ON and nothing in the console.
   *
   * Turning the toggle off tears the solver down and the host solver takes the
   * field over, which is what it is kept correct for — and that handover drew
   * a third of the map until `5093e1e`, which is half of why this is worth
   * doing now.
   *
   * IT IS NOT A FULL RECOVERY AND NOTHING HERE CAN MAKE IT ONE. Pixi was
   * handed the same device, so a real loss takes the canvas with it and the
   * map is black whatever the water does — verified by forcing one with
   * `device.destroy()`: the water goes on stepping on the host, the meshes go
   * back to drawing their whole complement, and the screen stays empty.
   * What this buys is a state that is consistent and a message that says what
   * happened, instead of a map that quietly stopped with the toggle still
   * reading ON. Coming back for real means rebuilding every Pixi resource on a
   * new device, which is its own piece of work.
   */
  useEffect(() => onDeviceLost(() => {
    if (useWorldStore.getState().gpuWater) useWorldStore.getState().setGpuWater(false);
  }), []);

  useEffect(() => {
    const field = useWorldStore.getState().getWaterField();
    const device = heldDevice();
    // A DEVICE THAT HAS GONE IS NOT A DEVICE. Checked here as well as in the
    // listener above, because a scene can be rebuilt after the loss — and
    // building a solver on a dead device is a set of buffers that will never
    // answer.
    // A MAP WITH BRIDGES ON IT RUNS HERE TOO, now. Every pass walks slot
    // pairs — see `fluid/slots` — and two bridged scenes say the arithmetic
    // holds: `__frameCompare(150, false, "dry")` agrees to 1.5e-3 of the
    // deepest column with the volume at 1.9e-9, and `__frameCompare(90,
    // false, true)`, which sprays, is inside the bounds that scene's known
    // drop-ordering difference earns it. The one-layer path is exactly where
    // it was. @see spanned, spannedDry
    //
    // AND THE SHEETS TOO, as of the storey-aware decode — so nothing in the
    // water asks how many storeys a map has any more.
    // SAY SO ON THE READOUT. A badge that reports the switch rather than the
    // path claims the device is running whenever anything declines to build
    // a solver. @see gpuWaterWhy
    gpuWaterHeldBack(
      !gpuWater ? null
        : !device || deviceLost() !== null ? "no device"
          : null,
    );
    // SAID IN THE CONSOLE, with the reason, every time it changes. @see sayWaterSolver
    // Not while the device is still being asked for: that is a moment, not a fall-back.
    // `?webgl=1` never asks, so it is said at once rather than never.
    const webglAsked = rendererAsked() === "webgl";
    if (field && (device || webglAsked || deviceWhy() !== null || deviceLost() !== null || !gpuWater)) {
      const lost = deviceLost();
      sayWaterSolver(gpuWater && device && lost === null ? "gpu" : "cpu",
        lost !== null ? `the GPU device was lost (${lost}); the CPU solver took over`
          : !device && webglAsked ? "WebGL asked for in the address"
          : !device ? `no WebGPU device: ${deviceWhy()}`
            : !gpuWater ? "the GPU water toggle is off"
              : null);
    }
    if (!gpuWater || !field || !device || deviceLost() !== null) {
      solverRef.current?.destroy();
      solverRef.current = null;
      gpuWaterSaw(null);
      // THE GATHERING IS NOT THE SOLVER'S, and it used to be built with it.
      // It only reads the depth and ground textures, and on this path the
      // HOST fills those — a frame before the gather reads them rather than
      // in the same command buffer, so its counts lag by one. `roomFor` is
      // the headroom that absorbs exactly that.
      //
      // Without it every band draws every quad it could ever hold, which on
      // a map with storeys is twice as many again: measured on a bridged map
      // at 48 tiles, 22ms of GPU against 1.2 with the gathering on. Tying it
      // to the solver made a mesh that was meant to save host time cost
      // twenty times its saving somewhere else.
      if (gpuWater && field && device && deviceLost() === null && gpuRef.current) {
        const g0 = useWorldStore.getState().grid;
        gpuRef.current.gather = attachQuadGather(
          gpuRef.current, rendererRef.current, device, g0.w, g0.h,
        );
      }
      return;
    }
    // The water layer's own carried fields go with it: the device advects
    // them and writes the answer straight back into the arrays the layer's
    // textures are views over. @see Carried
    const layer = gpuRef.current;
    solverField.current = field.columns;
    try {
    solverRef.current = createGpuWater(
      device, field.columns,
      layer
        ? { seed: layer.wash.seed, now: layer.wash.now, foam: layer.foam.now }
        : undefined,
      // AND THE SURFACE'S TEXTURES, for the device to fill directly. Empty on
      // any renderer or map shape that cannot take the copy, in which case the
      // layer goes on uploading them. @see deviceSinks
      layer && rendererRef.current
        ? deviceSinks(layer, rendererRef.current)
        : [],
    );
    } catch (e) {
      // A SOLVER THAT WOULD NOT BUILD on a device that is there: said, with
      // the error, rather than leaving the CPU to step the water unexplained.
      solverRef.current = null;
      noSolver.current = `the GPU solver failed to build: ${e instanceof Error ? e.message : String(e)}`;
      console.error("WATER: the GPU solver failed to build —", e);
      sayWaterSolver("cpu", noSolver.current);
      return;
    }
    noSolver.current = null;
    // AND THE GATHERING, which only runs while the device owns the water: it
    // reads the depth and ground TEXTURES, and those are only filled ahead of
    // it by the solver's own copy. @see gatherQuads
    if (layer) {
      // Read rather than closed over, for the reason the field above is: this
      // effect is keyed on the scene and not on the grid, and a grid it had
      // captured could be a grid ago.
      const g = useWorldStore.getState().grid;
      layer.gather = attachQuadGather(
        layer, rendererRef.current, device, g.w, g.h,
      );
      // AND THE SHEETS, BUILT WHERE THE LIPS ARE. The falls' own layer keeps a
      // buffer the compute pass writes and the mesh draws, so `drawFalls` has
      // nothing left to do on this path. @see createSheet
      const bl = blRef.current;
      const sr = solverRef.current;
      const rend = rendererRef.current as unknown as {
        buffer?: { getGPUBuffer: (b: unknown) => GPUBuffer };
        texture?: { getGpuSource: (s: unknown) => GPUTexture };
      };
      // AND ON A MAP WITH BRIDGES TOO, now. The sheet builder decoded a
      // fall's edge as a column and an axis alone, so every edge in a plane
      // past the first landed off the end of the map and was thrown away —
      // most of them, on a bridged map — and the HOST drew the falls instead,
      // from a copy of the depths that is up to thirty readbacks stale while
      // the surface they have to meet is the device's own. It reads the slot
      // pair now, and `__sheetCompare` says the two builders agree: on a
      // cliff with a deck at its edge, 2,016 quads each side against 192
      // before, and no pixel either draws that the other leaves empty.
      // @see compareSheetPaths
      if (bl && sr && rend?.buffer && rend?.texture) {
        const gfl = createGpuFallLayer(bl);
        gfRef.current = gfl;
        sr.sheetTo({
          verts: () => gfl.verts.map((v) => rend.buffer!.getGPUBuffer(v)),
          tint: rend.texture.getGpuSource(layer.tint).createView(),
          bands: bl.bands.length,
          cap: gfl.cap,
          // READ, not closed over, for the reason the grid above is — and the
          // tick re-says it whenever the camera moves. @see sheetScale
          proj: [HW, HH, HEIGHT_UNIT, useWorldStore.getState().scale],
          cpt: COLUMNS_PER_TILE,
          tilesHigh: g.h,
        });
        // The host's sheets go quiet rather than being drawn twice.
        if (faRef.current) drawFalls(faRef.current, field.columns, null);
      }
    }
    return () => {
      solverRef.current?.destroy();
      solverRef.current = null;
      noSolver.current = "the scene is being rebuilt (sceneEpoch or the water toggle changed); the GPU solver goes with it";
      // BACK TO THE IDENTITY. The list holds a gathering that will not be
      // refreshed once the device stops, and a stale gathering is water drawn
      // where it no longer is. @see quadCap
      if (gfRef.current) {
        destroyGpuFallLayer(gfRef.current);
        gfRef.current = null;
      }
      const l = gpuRef.current;
      if (l?.gather) {
        destroyQuadGather(l.gather);
        l.gather = null;
        l.quads.update();
      }
      gpuWaterSaw(null);
    };
  }, [gpuWater, sceneEpoch]);

  /**
   * ONE FRAME OF WATER: the readback, the springs, the pipes, the solver, the
   * gathering, the mesh, the falls, the drips and the tally — everything the
   * tick does to the water, as one function, so the bench can do EXACTLY it.
   *
   * It was written inline in the tick, and `__waterBench` kept its own copy of
   * the parts somebody had thought of: the solver and the mesh. No springs, no
   * pipes, no gathering, no falls, no drips, and the faces always on whatever
   * the overlay said — so it measured a frame nobody plays, and read lower
   * than the HUD for reasons nobody could see. Kept in a ref and refreshed
   * every render, so the bench reads the same overlays and scale the tick does.
   * Returns the two halves the HUD times, or null when there is no water.
   */
  /** The band cull, as the tick runs it and the bench calls it. */
  const cullBandsRef = useRef<(() => void) | null>(null);
  /** Why there is no GPU solver just now, and how many CPU frames that has cost. @see sayWaterSolver */
  const noSolver = useRef<string | null>("not built yet");
  const cpuFrames = useRef(0);
  const cpuSaid = useRef(0);
  /** The CPU solver's measured cost a substep, and the substeps a frame it is given. @see CPU_SOLVE_MS */
  const cpuWater = useRef({ perSub: 0, cap: MAX_SUBSTEPS });
  if (import.meta.env.DEV) (window as unknown as { __cpuWater?: { perSub: number; cap: number } }).__cpuWater = cpuWater.current;
  const waterFrameRef = useRef<((dt: number) => { solve: number; build: number; town?: number } | null) | null>(null);
  waterFrameRef.current = (dt: number) => {
    // THE BANDS ON SCREEN FIRST, so the water draws for this frame's view and
    // not the last one's. The cull is its own tick and runs after this one,
    // so the water read last frame's range — and every band a zoom out
    // brought into view drew nothing for its first frame: a fringe of water
    // missing all the way through the zoom. Idempotent; the tick after this
    // finds nothing to change. @see cullBandsRef
    cullBandsRef.current?.();
    const bl = blRef.current, fl = flRef.current;
    const field = useWorldStore.getState().getWaterField();
    const gpu = gpuRef.current;
    if (!(bl && field && (fl || gpu))) return null;
    // A FIELD THE SCENE WAS NOT BUILT FOR: rebuild it, and step nothing on
    // layers shaped for the old one in the meantime. @see fieldEpoch
    // Asked for ONCE and skipped until it lands: only the scene build says
    // which field it was built for, since the rebuild is asynchronous.
    if (sceneField.current !== field.columns) {
      if (rebuildAsked.current !== field.columns) {
        rebuildAsked.current = field.columns;
        setFieldEpoch((n) => n + 1);
      }
      return null;
    }
      // WHAT THE DEVICE FINISHED COMES BACK FIRST, before a spring or a pipe
      // pours a drop into this frame. The scatter overwrites the host's
      // depths, so done after them it lands on top of this frame's water and
      // wipes it — see `GpuWater.sync`.
      // MEASURED FROM HERE, which is where the frame's water starts. The mark
      // used to go after these three, so the scatter that brings the device's
      // answer down, the springs and the whole of the pipe network were in no
      // slot at all — work the HUD's own rows could not account for, showing
      // up only as the gap between `frame` and everything named. What a timer
      // leaves out is the part nobody goes looking at.
      const t0 = performance.now();
      // A FIELD THIS SOLVER WAS NOT BUILT FOR is a solver with buffers of the
      // wrong size. Tested by identity rather than by a counter, because the
      // counters are about edits and this is about the object.
      //
      // ASKED BEFORE `sync`, because `sync` scatters the readback that was in
      // flight into whatever field it is handed, and a readback is sized for
      // the field the solver was BUILT for. Handing it another throws
      // `RangeError: offset is out of bounds` on the first call that finds one
      // pending — measured, on the second `resize` of a session.
      //
      // NOT REACHABLE THROUGH A RESIZE TODAY, and it took six tries to find
      // out why: the scene teardown nulls `blRef` synchronously, and this
      // whole block is gated on it, so the window between a new field and a
      // rebuilt solver has no ticks in it. The order is still wrong, and the
      // guard that actually closes the hazard is in the solver. @see bringDown
      if (solverRef.current && solverField.current !== field.columns) {
        solverRef.current.destroy();
        solverRef.current = null;
        gpuWaterSaw(null);
        noSolver.current = "the water field was replaced (a new map, a resize or a first bridge); the GPU solver is rebuilding";
        sayWaterSolver("cpu", noSolver.current);
      }
      let sw = section("water: sync, sources, pipes");
      solverRef.current?.sync(field.columns);
      runSources(field, grid, dt);
      // PUMP HOUSES are paid for while they run, in the game. @see runPumps
      runPipes(field, grid, dt, useWorldStore.getState().playing ? PAID_PUMPS : undefined);
      // THE WATER MAINS: the game's pipes, solved and delivered. @see runMains
      runMains(field, grid, dt, useWorldStore.getState().playing ? PAID_PUMPS : undefined);
      // THE SLOP IN THE WATER, carried and diluted by it. @see stepPollution
      stepPollution(field, dt);
      // The columns the boats will read, asked for before the step uploads
      // the list. @see wantFleet
      wantFleet(getFleet(), field.columns);
      // THE SWITCH. With the solver built, the frame's water is the device's
      // and the CPU solver does not run at all — see `gpu/solver`, and the
      // note there about the round trip this still pays for.
      const solver = solverRef.current;
      sw(); sw = section("water: solve");
      // ONE FIELD, WHOEVER STEPS IT. A bridge is slots in the same columns
      // rather than a storey of its own, so there is no second thing here
      // for the device path to forget about. @see syncSlots
      if (solver) {
        solver.step(field.columns, dt);
        gpuWaterSaw(solver.last());
      }
      else {
        // THE CPU STEPPING WHILE A DEVICE IS HELD is the case nobody can see:
        // said every few seconds while it lasts, with the state and the last
        // thing that took the solver away. @see noSolver
        if (heldDevice()) {
          cpuFrames.current++;
          const now = performance.now();
          // The first frames of a scene step on the CPU while the solver effect is still to run.
          if (cpuFrames.current > 10 && now - cpuSaid.current > 5000) {
            cpuSaid.current = now;
            console.warn("WATER: the CPU solver is stepping although a WebGPU device is held —", {
              frames: cpuFrames.current, gpuWater: useWorldStore.getState().gpuWater,
              lost: deviceLost(), why: noSolver.current ?? "no solver was built yet (the solver effect has not run since the device came)",
              sceneEpoch, fieldMatches: solverField.current === field.columns,
            });
          }
        }
        stepWater(field, dt);
      }
      const t1 = performance.now();
      sw(); sw = section("water: gather");
      // THE QUADS THIS FRAME IS WORTH DRAWING, gathered before the mesh is
      // told how many to draw. On the device's own path that is after the
      // solver has filled the textures it reads; on the host's it is a frame
      // behind them, which `roomFor` has the headroom for. @see gatherQuads
      const dev = heldDevice();
      const vp = useWorldStore.getState().viewport;
      if (gpu?.gather && dev) {
        gatherQuads(
          gpu.gather, dev, field.columns, grid.w, grid.h, overlays.faces,
          // Zoomed out, a flat tile is one quad — unless a dev session has
          // switched it off to look at the difference. @see LOD_TILE_PX
          // ON SCREEN, which is the store's scale times the viewport's own
          // zoom: the editor zooms through the viewport, and the scale alone
          // reads 1 on a map fitted to the window at a twenty-fifth of that.
          zoomedOut(scale * (vp?.scale.x ?? 1))
            && !(import.meta.env.DEV && (window as unknown as { __lodOff?: boolean }).__lodOff),
          // And only what is across the screen. @see cullFor
          // And above and below it, the bands the meshes are culled to.
          // @see BAND_MARGIN
          vp && !(import.meta.env.DEV && (window as unknown as { __cullOff?: boolean }).__cullOff)
            ? {
              ...cullFor(vp.left, vp.right, scale),
              ...visibleBandRange(grid, scale, vp.top, vp.bottom),
            }
            : null,
          // And shaded cheaply, where a column is a few points across.
          // @see GRAD_TILE_PX
          cheapGradient(scale * (vp?.scale.x ?? 1))
            && !(import.meta.env.DEV && (window as unknown as { __gradOff?: boolean }).__gradOff),
        );
      }
      sw(); sw = section("water: draw surface");
      if (fl) drawWater(fl, field.columns, bl, dt, overlays.faces);
      else if (gpu) {
        drawGpuWater(gpu, field.columns, bl, dt, overlays.faces, solver !== null);
      }
      // The foam FIELD, not the solver's raw breaking: the surface is painted
      // from this, so the sheet has to be too or a white lip goes over a
      // cliff and turns blue in the air.
      sw(); sw = section("water: falls, drips");
      if (faRef.current) {
        const box = activeBox(field.columns);
        const layer = fl ?? gpu;
        const white = layer?.foam.now ?? null;
        // And the pattern the current carries, for the same reason: a sheet
        // that leaves the lip in the surface's own colour needs everything the
        // surface was shaded from — see `sheetLook`.
        const drift = layer?.wash.now ?? null;
        // THE DEVICE'S OWN SHEETS where it is building them, which is a
        // number per band off a readback of half a kilobyte — no geometry, no
        // colours, no neighbour reads. @see drawGpuFalls
        if (gfRef.current) {
          // The camera's own scale, in case it has moved since the pass was
          // set up — a no-op on every frame it has not. @see sheetScale
          // And how finely to cut each sheet, from how big a tile is on
          // screen: zoomed out, a fall is a few pixels tall and twenty-four
          // pieces of it is waste. @see nappeStepsAt
          const vpz = useWorldStore.getState().viewport?.scale.x ?? 1;
          solverRef.current?.sheetScale(scale, nappeStepsAt(2 * HW * scale * vpz));
          drawGpuFalls(gfRef.current, solverRef.current?.sheetCounts() ?? null);
        } else {
          drawFalls(faRef.current, field.columns, box, white, drift);
        }
      }
      if (drRef.current) drawGpuDrips(drRef.current, field, bl, grid, overlays.xray);
      // THE BOATS, on the water this frame left: bob, tilt, drift, then drawn.
      // @see world/boats
      sw();
      const tTown = performance.now();
      const sBoats = section("tick: boats");
      const fleet = getFleet();
      // The rivers' traffic first: boats in from a ported river's inflow, and
      // off at its exit. Then every boat, the ones under way steered for it.
      const traffic = getTraffic();
      stepTraffic(traffic, fleet, useWorldStore.getState().grid, field.columns, dt);
      // THE PORTS PAID for the calls they finished — in the game, into the
      // company's money; in the editor, shown and never paid. @see portCallFee
      if (traffic.calls.length) {
        const st = useWorldStore.getState(), now = performance.now();
        for (const id of traffic.calls.splice(0)) {
          const s = st.grid.structures.get(id);
          let fee = s ? portCallFee(s.def) : null;
          // A PORT UNDER WATER takes no trade. @see portShut
          if (fee === null || portShut(id)) continue;
          // REGULAR ROUTES, won by serving convoys, add to every call. @see ROUTE_BONUS
          fee *= 1 + ROUTE_BONUS * (useSessionStore.getState().routes ?? 0);
          // A CONVOY IN pays double, and is counted. @see stepOpportunities
          const convoy = st.events.find((e) => e.kind === "convoy" && e.phase === "active");
          // Treble at a port by the Conference Centre. @see convoyPays
          if (convoy) { fee *= s ? convoyPays(st.grid, s) : CONVOY_PAYS; tallyCall(convoy.id, fee); }
          if (st.playing) { useMoneyStore.getState().increaseMoney(fee); sfx("coin"); }
          recordCall(getExports(), id, fee, now);
        }
      }
      // WHAT THE PORTS EARN A SECOND, kept with the company for the time away
      // — a few times a minute, from the last minute's calls. @see portIncomePerSecond
      if (useWorldStore.getState().playing) {
        const now = performance.now();
        if (now - portRateAt.current > 5000) {
          portRateAt.current = now;
          const ex = getExports();
          let perMin = 0;
          for (const id of ex.recent.keys()) perMin += perMinute(ex, id, now);
          useSessionStore.getState().setPortIncome(perMin / 60);
        }
      }
      stepFleet(fleet, field.columns, dt, trafficSteer(traffic));
      boatRef.current?.draw(fleet, field.columns, scale, dt);
      sBoats();
      // THE WATER MAINS: their tubes where they changed — or the zoom asks for more or less detail — and the water in them. @see createMainsLayer
      mainsRef.current?.sync(grid, scale, useWorldStore.getState().viewport?.scale.x ?? 1);
      { const st = useWorldStore.getState();
        mainsRef.current?.tick(grid, scale, performance.now(), ...mainPreview(), st.playing && (st.waterOverlay || st.tool === "pipe"), st.hover);
        // THE SEWERS: drawn again where they changed; the underground shown, and the ground see-through over it, in its view. @see createSewerLayer
        // On by itself with the Sewer tool in hand, and what it would lay ghosted.
        const underground = st.sewerView || st.tool === "sewer";
        // Placing what makes slop, once a sewer is needed: where a manhole reaches. @see sewerInReach
        const reach = st.playing && st.tool === "placeStructure" && !!playRules(grid).needsSewer
          && !!structureDef(st.structureDefId)?.ports?.some((p) => p.fluid === "slop" && p.dir === "out");
        sewersRef.current?.sync(grid, scale, underground, sewerGhost(), reach);
        setGroundAlpha(bl, st.overlays.xray || underground ? XRAY_GROUND : 1); }
      // THE TOWN: cars and people on their trips round the roads. @see world/agents
      const net = getNetwork();
      if (net) {
        const st = useWorldStore.getState();
        { const e = section("tick: stepTown"); stepTown(getTown(), st.grid, net, st.revision, dt); e(); }
        // THE EMERGENCY SERVICES, to what the disasters have damaged. @see world/agents/emergency
        { const town = getTown(); stepEmergency(town.emergency ??= createEmergency(), town, st.grid, damagedNow(), dt); }
        // THE PROJECTS going up: crews walking out, loads trucked in, work
        // done — after the town has moved, so who arrived this frame is known.
        // Paid for out of the company's money under the game's rules; free in
        // the editor, which must never spend anybody's money. @see stepWorks
        // NEW HIRES ARRIVING, in the game: by bus, car or limousine from the
        // edge of the map to a lot with room, and moving in. Before the works,
        // which clears who arrived. @see world/agents/arrivals
        // (`__fakeHires`, in development: people to send for that nobody has
        // hired, so a bus can be watched without touching the economy.)
        const fake = import.meta.env.DEV ? window.__fakeHires : undefined;
        if (st.playing || fake) {
          const arrivals = getArrivals();
          const owned = ownedNow();
          for (const [id, n] of Object.entries(fake ?? {})) owned[id as keyof typeof owned] = (owned[id as keyof typeof owned] ?? 0) + n;
          { const e = section("tick: arrivals"); stepArrivals(arrivals, st.grid, net, getTown(), owned, fake ? {} : useSessionStore.getState().remoteBeds ?? {}, dt); e(); }
          if (arrivals.moved.length) useWorldStore.getState().housingMoved(arrivals.moved.splice(0));
        }
        // THE SLOP TANKS at the vibe workplaces, filled by what the vibe coders
        // at their desks make, drained by the sewers, spilling when full. @see stepSlop
        if (st.playing) stepSlop(st.grid, st.getWaterField(), liveSeating(st.grid, net).desks, slopRate(), dt, PAID_PUMPS.pay);
        // EVENTS, in the game: the director's look twice a second, and what
        // an event under way does to the map. @see world/events
        const sEvents = section("tick: leaders, events, flood");
        if (st.playing) {
          // THE TEAM LEADERS, walking between home and work. @see stepLeaders
          const seats = useTeamLeadersEmployeesStore.getState().employees;
          stepLeaders(leaders.current, getTown(), st.grid, net, seats,
            liveLeadership(st.grid, net, seats, liveMoods(st.grid, net)), dt);
          const field = st.getWaterField();
          eventClock.current += dt;
          if (eventClock.current >= 0.5) {
            eventClock.current = 0;
            const owned = ownedNow();
            // WHAT THE EVENTS ARE ABOUT: a port, the company's front door,
            // the studio — each only once built. @see TownView
            const built = (ids: readonly string[]) => [...st.grid.structures.values()].find((s) => ids.includes(s.def) && !s.build);
            const port = getTraffic().ports.size ? [...st.grid.structures.values()].find((s) => getTraffic().ports.has(s.id)) : undefined;
            const door = built(["ipo", "boardroom", "hq", "garage"]), studio = built(["studio"]);
            const convoy = st.events.find((e) => e.kind === "convoy" && e.phase !== "over");
            const tally = convoyTally(convoy?.id ?? -1);
            const equity = canAcquire() ? Math.floor(pendingEquity().toNumber()) : 0;
            const river = riverHead(st.grid);
            // THE LEVEE a flood could be met with: walls on the low bank near the head. @see leveeCells
            const bank = river && field ? leveeCells(st.grid, field) : [];
            // WHAT DRINKS: the Data Centre, or the thirstiest of the rest. @see HEATWAVE, DROUGHT
            const drinker = (() => {
              let best: Structure | undefined, most = -1;
              for (const s of st.grid.structures.values()) {
                if (s.build || !isDrinker(s.def)) continue;
                const d = s.def === "datacentre" ? Infinity : tankFor(s.id)?.demand ?? 0;
                if (d > most) { most = d; best = s; }
              }
              return best;
            })();
            const thirsty = [...allTanks().values()].some((t) => t.demand > 0);
            // THE OFFICES, for the inspector: the one with the most spilled by it. @see INSPECTOR
            const office = (() => {
              const tanks = tanksOf(st.grid);
              let best: Structure | undefined, worst = -1;
              for (const s of st.grid.structures.values()) {
                if (s.build || !WORKPLACES.vibe_coder.includes(s.def)) continue;
                let mess = tanks.get(s.id)?.spilling ? 1 : 0;
                if (field) for (const t of ring(st.grid, s)) mess += sludgeAt(field, t.x, t.y);
                if (mess > worst) { worst = mess; best = s; }
              }
              return best && { s: best, dirty: worst > 0 };
            })();
            // THE BUSIEST JUNCTION, for road works. @see ROAD_WORKS
            const homes = [...st.grid.structures.values()].filter((s) => housedBy(s.def) && residentsIn(s) > 0);
            const homesKey = `${st.grid.rev}:${homes.reduce((n, s) => n + residentsIn(s), 0)}`;
            if (junctionAt.current.key !== homesKey) {
              junctionAt.current = { key: homesKey, at: busiestJunction(st.grid, homes.map((s) => ({ x: s.x, y: s.y, n: residentsIn(s) }))) };
            }
            // A RIVAL AFTER THE 10X DEVS. @see POACHING
            const tenx = owned["10x_dev"] ?? 0;
            const tenxWork = built(WORKPLACES["10x_dev"] ?? []) ?? door;
            const poachN = Math.ceil(tenx * POACH_SHARE);
            // A CARD TO GO VIRAL: slotted, short of its rule. @see VIRAL
            const deckOpen = !!useInnovationStore.getState().unlocks.employeeManagement?.unlocked;
            const deck = useGeneratorStore.getState().employeeManagement.deck;
            const viralCard = deckOpen ? deck.slotted.find((id) => rankNow(deck, id) < 3) : undefined;
            // A STREET OF UNHAPPY HOMES. @see TENANTS
            const moods = liveMoods(st.grid, net);
            const sad = homes.filter((s) => (moods.get(s.id)?.total ?? 0) <= STRIKE_MOOD)
              .sort((a, b) => (moods.get(a.id)?.total ?? 0) - (moods.get(b.id)?.total ?? 0));
            const worstHome = sad[0];
            const street = worstHome ? sad.filter((s) => housedBy(s.def)?.id === housedBy(worstHome.def)?.id && Math.abs(s.x - worstHome.x) + Math.abs(s.y - worstHome.y) <= 6) : [];
            // THE DATA CENTRE, once agents run. @see AGENT_INCIDENT
            const dcBuilt = built(["datacentre"]);
            const aiCardsLeft = CARDS.some((c) => AI_TAGS.includes(c.tag) && !deck.ranks[c.id] && !deck.offers.some((o) => o.cards.includes(c.id)));
            // A SITE STILL WAITING ON LOADS, for a strike. @see STRIKE
            const waiting = sitesOf(st.grid).find((s) => s.build && s.build.delivered < s.build.deliveries);
            // A BUILDING SMOKING: while a fire is under way, the one it is at,
            // for as long as it is still damaged (the crew there first calls it
            // off); else the first a heatwave left overheated. @see FIRE
            const fireEv = st.events.find((e) => e.kind === "fire" && e.phase !== "over");
            if (!fireEv) fireAt.current = null;
            const smokeId = fireEv && fireAt.current
              ? (isDamaged(fireAt.current.id) && st.grid.structures.has(fireAt.current.id) ? fireAt.current.id : null)
              : firstOverheated(st.grid);
            if (fireEv && !fireAt.current && smokeId !== null) fireAt.current = { id: smokeId, spread: null };
            const smokeS = smokeId !== null ? st.grid.structures.get(smokeId) : undefined;
            const view: TownView = {
              now: Date.now(),
              income: useGeneratorStore.getState().getMoneyPerSecond(),
              owned,
              river,
              flooded: floodedCount.current,
              overheated: overheated.current.size,
              smoking: smokeS ? {
                x: smokeS.x, y: smokeS.y, id: smokeS.id, hydrant: onMains(smokeS.id),
                spread: fireAt.current?.spread?.length ?? 0,
                hose: () => hoseFor(HOSE_OUT_MS),
                burnOut: () => { const f = fireAt.current; if (f) burn(st.grid, [f.id, ...(f.spread ?? [])]); },
              } : null,
              drinkers: drinker && thirsty ? {
                x: drinker.x, y: drinker.y,
                dig: (() => { const at = siteFor(st.grid, drinker, null); return at ? () => { digReservoir(at); } : null; })(),
              } : null,
              offices: office ? {
                x: office.s.x, y: office.s.y, id: office.s.id, dirty: office.dirty,
                close: (id: number, seconds: number) => closeFor(st.grid, id, seconds),
              } : null,
              junction: junctionAt.current.at,
              // A JOINT AND A MANHOLE to break. @see BURST_MAIN, SEWER_BACKUP
              joint: (() => { const c = breakableCell(st.grid, false); return c === null ? null : { x: c % st.grid.w, y: (c / st.grid.w) | 0, cell: c }; })(),
              manhole: (() => { const c = busiestNode(st.grid) ?? breakableCell(st.grid, true); return c === null ? null : { x: c % st.grid.w, y: (c / st.grid.w) | 0, cell: c }; })(),
              // THE DISTRICT round the busiest junction, for a blackout. @see BLACKOUT
              district: (() => {
                const j = junctionAt.current.at;
                if (!j) return null;
                const ids = [...st.grid.structures.values()].filter((s) => !s.build && Math.abs(s.x - j.x) + Math.abs(s.y - j.y) <= BLACKOUT_RADIUS).map((s) => s.id);
                return ids.length ? { x: j.x, y: j.y, ids } : null;
              })(),
              hq: (() => { const h = built(["hq", "boardroom", "ipo"]); return h ? { x: h.x, y: h.y } : null; })(),
              poach: tenx >= POACH_LEAST && tenxWork ? {
                x: tenxWork.x, y: tenxWork.y, n: poachN,
                score: useGeneratorStore.getState().satisfactionScores["10x_dev"] ?? 0,
                price: poachN * getGeneratorCost("10x_dev", 1).toNumber() * MATCH_SHARE,
                lose: () => {
                  useGeneratorStore.getState().loseGenerator("10x_dev", poachN);
                  useWorldStore.getState().housingMoved(moveOut(st.grid, "10x_dev", poachN));
                },
              } : null,
              viral: viralCard ? { card: viralCard, name: cultureCard(viralCard).name, slotted: deck.slotted.length } : null,
              unhappy: worstHome && street.length >= STRIKE_HOMES ? {
                x: worstHome.x, y: worstHome.y, homes: street.map((s) => s.id), who: housedBy(worstHome.def)!.id,
                cafe: buildCost("cafe")?.toNumber() ?? 0,
                gift: () => useWorldStore.getState().giftAt("cafe", { x: worstHome.x, y: worstHome.y }),
              } : null,
              datacentre: dcBuilt && useAgentsStore.getState().agents > 0 ? { x: dcBuilt.x, y: dcBuilt.y, policy: deckOpen && aiCardsLeft } : null,
              site: waiting?.build ? {
                x: waiting.x, y: waiting.y,
                left: waiting.build.cost * (1 - waiting.build.delivered / waiting.build.deliveries) * loadPriceMult(),
              } : null,
              levee: river ? {
                walls: bank.length,
                price: bank.length * (buildCost("levee")?.toNumber() ?? 0) * LEVEE_RUSH,
                build: () => useWorldStore.getState().raiseLevee(bank),
              } : null,
              evacuated: [...evacuees.current],
              port: port ? { x: port.x, y: port.y } : null,
              convoy: { calls: tally.calls, earned: tally.earned },
              routes: useSessionStore.getState().routes ?? 0,
              door: door ? { x: door.x, y: door.y } : null,
              // WHAT DUE DILIGENCE INSPECTS: homes, spills, and what drinks watered. @see DILIGENCE
              diligence: {
                mood: townMood(st.grid, liveMoods(st.grid, net)),
                spills: (field ? sludgedHouses(field, st.grid).size : 0) + [...tanksOf(st.grid).values()].filter((t) => t.spilling).length,
                watered: wateredShare(),
                mop: () => { if (field) mopAll(field, st.grid); emptyFull(st.grid); },
              },
              studio: studio && (owned.vibe_coder ?? 0) >= HACKATHON_CODERS ? {
                x: studio.x, y: studio.y,
                spike: (share: number) => slopSpike(st.grid, studio.id, share),
                ideas: () => useGeneratorStore.getState().dealHackathon(),
              } : null,
              // AN ACQUIRER, once the company can be sold; the best street is what caught their eye.
              sale: canAcquire() ? {
                equity, withPremium: Math.floor(equity * offerPremium()),
                street: () => { const best = liveStreetEarnings()[0]; return best ? streetName(best) : undefined; },
              } : null,
            };
            const on = !useSessionStore.getState().mapEventsOff;
            const stepped = on ? stepEvents(st.events, view, EVENT_DEFS) : { events: [], ended: [], acts: [] };
            let next = stepped.events;
            // THE DIRECTOR: one drawn, if one is due. (`__eventNow`, in development: that one, now.) @see pickEvent
            const live = next.some((e) => e.phase !== "over");
            const forced = import.meta.env.DEV && window.__eventNow ? EVENT_DEFS[window.__eventNow] : null;
            if (import.meta.env.DEV) window.__eventNow = undefined;
            // A FOLLOW-UP DUE comes first, outside the gap. @see Outcome.next
            const followUp = !on || live || forced ? null : dueFollowUp(director.current, view, Object.values(EVENT_DEFS), false);
            // THE HUSTLER'S LUCK: the opportunities twice as likely. @see HUSTLER_EVENTS
            const luck = founderIs("hustler") ? HUSTLER_EVENTS : 1;
            const def = !on || live ? null : forced ?? followUp ?? pickEvent(director.current, view, Object.values(EVENT_DEFS), false, Math.random(), luck);
            const fresh = def && startEvent(def, view, eventIds.current++);
            if (fresh) {
              if (followUp) { fresh.chained = true; director.current.next = null; }
              else eventStarted(director.current, fresh.kind, Math.random());
              next = [...next, fresh];
            }
            // WHAT A CHOICE DOES the moment it is taken. @see ChoiceDef.act
            for (const act of stepped.acts) act();
            // WHAT AN EVENT LEAVES BEHIND, once over. @see Outcome
            for (const { event, outcome } of stepped.ended) {
              if (outcome.money) useMoneyStore.getState().increaseMoney(outcome.money);
              if (outcome.next) queueFollowUp(director.current, outcome.next.kind, view.now, outcome.next.inMs);
              outcome.then?.();
              if (event.kind === "river-flood") evacuees.current.clear();
              if (event.kind === "heatwave") overheated.current.clear();
            }
            if (JSON.stringify(next) !== JSON.stringify(st.events)) useWorldStore.getState().setEvents(next);
            // IN AI MODE, the AI answers the moment it comes. @see answerFor
            if (fresh && def && useSessionStore.getState().aiMode) {
              useWorldStore.getState().respondToEvent(fresh.id, answerFor(def, fresh, view, useMoneyStore.getState().money.toNumber()));
            }
          }
          // HOUSES BY FOULED WATER, looked for every couple of seconds. @see fouledHouses
          fouledClock.current += dt;
          const waterNow = st.getWaterField();
          if (fouledClock.current >= 2 && waterNow) { setFouled(fouledHouses(waterNow, st.grid)); fouledClock.current = 0; }
          // A TANK SPILLING, kept for the run: a clean run is a term sheet's goal. @see game/term-sheets
          if ([...tanksOf(st.grid).values()].some((t) => t.spilling)) {
            useSessionStore.getState().markOverflowed();
            // AND A CLEAN RECORD lost. @see CLEAN_RECORD
            removeConditions((c) => c.source === CLEAN_RECORD);
          }
          // MOPPING UP what has spilled: vibe coders off work, walking to it
          // and draining it by hand. @see stepCleanup
          // (In development, `__fakeHires` counts: a crew to watch with nobody hired.)
          const vibes = (ownedNow().vibe_coder ?? 0) + (import.meta.env.DEV ? window.__fakeHires?.vibe_coder ?? 0 : 0);
          const spillers = [...st.grid.structures.values()].filter((s) => WORKPLACES.vibe_coder.includes(s.def) && !s.build);
          setCleanupAway(spillers.length && field ? stepCleanup(cleanup.current, getTown(), st.grid, net, field, spillers, vibes, spillers.map((s) => s.id), dt, CLEANERS_PER_TILE * usePrestigeStore.getState().modifiers.cleanupMult) : 0);
          if (spillers.length && field) {
            sludgeClock.current += dt;
            if (sludgeClock.current >= 2) {
              dryUp(field, st.grid, spillers, sludgeClock.current);
              setSludged(sludgedHouses(field, st.grid));
              sludgeClock.current = 0;
            }
          }
        }
        // THE EVENTS' CLOCKS, and A RIVER IN FLOOD, in the game: the water
        // held at the river's head risen and let fall again, and what it
        // reaches looked for every couple of seconds against what stood there
        // before. @see world/events/flood
        if (!st.playing && floodRise.current) {
          // Stopped mid-flood: the river goes back to its usual level.
          const field = st.getWaterField();
          floodRise.current = 0;
          if (field) { field.inflowRise = 0; syncGround(field, st.grid); }
        }
        if (st.playing) {
          const field = st.getWaterField();
          const flood = st.events.find((e) => e.kind === "river-flood" && e.phase !== "over");
          // THE DIRECTOR'S CLOCK, once the company is big enough; the Hustler's come round faster. @see HUSTLER_EVENTS
          const headcount = Object.values(ownedNow()).reduce((a, n) => a + (n ?? 0), 0);
          tickDirector(director.current, dt, headcount);
          // KEPT WITH THE COMPANY every few seconds, so short sessions add up. @see Session.eventDirector
          pacingSaved.current += dt;
          if (pacingSaved.current >= 5) { pacingSaved.current = 0; useSessionStore.getState().setEventDirector({ ...director.current }); }
          // A CONVOY with extra hands at the quays turns boats round twice as fast.
          const convoy = st.events.find((e) => e.kind === "convoy" && e.phase === "active");
          getTraffic().rush = convoy?.chosen === "hands" ? 2 : 1;
          // AND BRINGS MATERIALS: a site's loads off the boats, at half price. @see CONVOY_LOADS
          setConvoyIn(!!convoy);
          // THE WEATHER ON WHAT DRINKS: a heatwave's thirst, and every tank
          // kept full by pumps, trucks or rationing. @see setHeat
          const heatwave = st.events.find((e) => e.kind === "heatwave" && e.phase === "active");
          const drought = st.events.find((e) => e.kind === "drought" && e.phase === "active");
          setHeat(heatwave ? HEAT_THIRST : 1, heatwave?.chosen === "pumps" || (!!drought && drought.chosen !== "dig"));
          // A BLACKOUT whose load is shed throttles the agents just the same. @see BLACKOUT
          const blackout = st.events.find((e) => e.kind === "blackout" && e.phase === "active");
          setThrottled(heatwave?.chosen === "throttle" || blackout?.chosen === "shed");
          // SAT OUT: its district shut, as it was when it struck, till the power is back. @see closeFor
          if (blackout?.chosen === "wait" && blackout.endsAt !== undefined) {
            if (blackoutIds.current?.event !== blackout.id) {
              const j = blackout.where;
              blackoutIds.current = { event: blackout.id, ids: [...st.grid.structures.values()].filter((s) => !s.build && Math.abs(s.x - j.x) + Math.abs(s.y - j.y) <= BLACKOUT_RADIUS).map((s) => s.id) };
            }
            const left = Math.max(0, (blackout.endsAt - Date.now()) / 1000);
            for (const id of blackoutIds.current.ids) if (st.grid.structures.has(id)) closeFor(st.grid, id, left, "power");
          } else if (!blackout) blackoutIds.current = null;
          // A BURST MAIN, A SEWER BACKED UP: the joint and the manhole broken while it is on. @see setBurst
          const burstEv = st.events.find((e) => e.kind === "burst-main" && e.phase === "active");
          setBurst(burstEv && inBounds(st.grid, burstEv.where.x, burstEv.where.y) ? idx(st.grid, burstEv.where.x, burstEv.where.y) : null);
          const backup = st.events.find((e) => e.kind === "sewer-backup" && e.phase === "active");
          setBackedUp(backup && inBounds(st.grid, backup.where.x, backup.where.y) ? idx(st.grid, backup.where.x, backup.where.y) : null);
          // AN EARTHQUAKE, felt once as it strikes: the nearest the HQ damaged — braced, none; the racks
          // strapped down, none of the AI's. @see QUAKE_DAMAGED
          const quake = st.events.find((e) => e.kind === "earthquake" && e.phase === "active");
          if (quake && quakeFelt.current !== quake.id) {
            quakeFelt.current = quake.id;
            const at = quake.where;
            const near = [...st.grid.structures.values()]
              .filter((s) => !s.build && !["hq", "boardroom", "ipo"].includes(s.def) && (quake.chosen !== "strap" || !AI_BUILDINGS.some((d) => d.id === s.def)))
              .sort((a, b) => Math.abs(a.x - at.x) + Math.abs(a.y - at.y) - (Math.abs(b.x - at.x) + Math.abs(b.y - at.y)) || a.id - b.id)
              .slice(0, quake.chosen === "brace" ? 0 : QUAKE_DAMAGED).map((s) => s.id);
            if (near.length) damage(st.grid, near, "quake");
            quakeDust.current = near;
          }
          // RIDDEN OUT: whatever runs short overheats. @see OVERHEAT_SHARE
          if (heatwave?.chosen === "ride") {
            const hot: number[] = [];
            for (const [id, t] of allTanks()) if (t.demand > 0 && t.share < OVERHEAT_SHARE && !overheated.current.has(id)) hot.push(id);
            if (hot.length) { damage(st.grid, hot, "heat"); for (const id of hot) overheated.current.add(id); }
          }
          // A FIRE LET BURN, halfway through: caught by what is next to it
          // without water, once. @see FIRE_SPREAD, spreadTargets
          const fire = st.events.find((e) => e.kind === "fire" && e.phase === "active");
          if (fire?.chosen === "burn" && fire.endsAt !== undefined && fireAt.current && !fireAt.current.spread && Date.now() >= fire.endsAt - FIRE_MS / 2) {
            const watered = (id: number) => { const t = tankFor(id); return !!t && t.share >= OVERHEAT_SHARE; };
            fireAt.current.spread = spreadTargets(st.grid, fireAt.current.id, watered, FIRE_SPREAD);
          }
          // ROAD WORKS: the junction closed while they are on, and road free for a bypass. @see ROAD_WORKS
          const works = st.events.find((e) => e.kind === "road-works" && e.phase === "active");
          setClosed(works ? [tileOf(st.grid, works.where)] : []);
          setRoadsFree(works?.chosen === "bypass");
          // A SUPPLIER STRIKE: loads held, or from the map's edge. @see STRIKE
          const strike = st.events.find((e) => e.kind === "strike" && e.phase === "active");
          setStrike(strike?.chosen === "wait" ? "held" : strike?.chosen === "edge" ? "edge" : null);
          if (flood && !floodBase.current && field) floodBase.current = floodBaseline(field, st.grid);
          if (flood) floodShield.current = flood.chosen === "sandbags" || flood.chosen === "evacuate" ? flood.chosen : null;
          // A DROUGHT: the river let down to nothing at its head. @see droughtDrop
          const rise = flood?.phase === "active" && flood.endsAt !== undefined ? riseAt((Date.now() - (flood.endsAt - FLOOD_MS)) / 1000, floodPeak(st.grid))
            : drought ? -droughtDrop(st.grid) : 0;
          if (field && rise !== floodRise.current) {
            floodRise.current = rise;
            field.inflowRise = rise;
            syncGround(field, st.grid);
          }
          floodClock.current += dt;
          if (floodClock.current >= 2 && field && floodBase.current) {
            floodClock.current = 0;
            const wet = floodedNow(field, st.grid, floodBase.current.water);
            floodedCount.current = wet.size;
            setFloodState(wet, floodShield.current);
            setFlooded(floodMisery());
            // WHO WAS PUT OUT, for their mood once it is over. @see EVACUEE_MORALE
            for (const who of Object.keys(evacuatedAway(st.grid))) evacuees.current.add(who as GeneratorId);
            // NOTHING DONE: what the water reaches is damaged. @see damage
            if (flood && !floodShield.current && fusionNow().floodsDamage) damage(st.grid, wet);
            // OVER: what is left on dry ground soaking away, and once it has,
            // put away until the next one.
            const left = flood ? 1 : soakAway(field, st.grid, floodBase.current.dry, 2);
            if (!flood && !wet.size && !left) {
              floodBase.current = null;
              floodShield.current = null;
            }
          }
        }
        sEvents();
        const sRest = section("tick: repairs, training, cooling");
        // THE REPAIR CREW, round the damaged buildings once the water is down.
        // None while a fire burns either: the crew does not go in. @see FIRE
        const burning = st.events.some((e) => e.kind === "fire" && e.phase === "active");
        if (st.playing) stepRepairs(st.grid, dt * usePrestigeStore.getState().modifiers.repairMult, !!floodBase.current || burning);
        // A TRAINING RUN finished: its jump, and the log. @see useTrainingStore
        if (st.playing) useTrainingStore.getState().tick();
        // THE DRINKERS DRINK: the Data Centre and the AI's own buildings, from their tanks. @see stepCooling
        if (st.playing) stepCooling(st.grid, runningAgents(), skillOf("river") >= 3, dt);
        // AI MODE, on The Model's own runs: the town building itself, its
        // drones flown out for the look of it. On a fixture too: a fixture
        // played works on a copy of the save. @see stepAutopilot, fixture-sandbox
        sRest();
        const sAi = section("tick: AI");
        if (st.playing && useFounderStore.getState().selectedFounderId === "model") {
          stepAutopilot(st.grid, dt);
          stepAi(getAiRunner(), st.grid, { stage: "tool", running: 0, agents: 0 }, dt, Date.now());
          // ITS LATTICE, charging as the company AI's does: done, the meter quickens. @see LATTICE_MODEL
          if (stepLattice(st.grid, runningAgents(), dt)) st.pushAiMemo("The Lattice is charged. I will be quicker now.");
        }
        // THE COMPANY'S AI AT WORK, from the Colleague stage on — not in a
        // fixture but the `ascension` one, whose story must go on; and not on
        // The Model's own runs. @see stepAi, seedAscension
        if (st.playing && (!startedOnFixture() || startFixture() === "ascension") && useFounderStore.getState().selectedFounderId !== "model") {
          const runner = getAiRunner(), at = Date.now();
          const aiNow = { stage: stageOf(useAiSingularityStore.getState().value).stage, running: runningAgents(), agents: useAgentsStore.getState().agents };
          // WHILE YOU WERE AWAY, once, on the first look. @see catchUpAi
          if (!aiPrimed.current) {
            aiPrimed.current = true;
            const since = useSessionStore.getState().aiAt;
            const memos = since ? catchUpAi(runner, st.grid, aiNow, since, at) : [];
            if (memos.length) st.setAiReport(memos.map((m) => m.text));
          }
          for (const a of stepAi(runner, st.grid, aiNow, dt, at)) {
            // A TAKEOVER is announced, and the Lattice begun. @see planner "repurpose", latticeFor
            if ((a.kind === "convert" && a.into === "gpu-farm") || (a.kind === "place" && a.def === "lattice")) st.pushAiMemo(a.why);
            // What it put up, for an objective waiting on it. @see noteAiBuilt
            if (a.kind === "place") useQuestStore.getState().noteAiBuilt(a.def);
            // THE LATTICE BEGUN: its form, where the AI stands now, kept. @see latticeForm
            if (a.kind === "place" && a.def === "lattice") useQuestStore.getState().fixLatticeForm(latticeForm());
          }
          // THE ARC, a second at a time: its triggers, its objectives, and what it says of how they went. @see quest.store
          questClock.current += dt;
          if (questClock.current >= 1) {
            useQuestStore.getState().step(questWorld(st.grid), questClock.current);
            questClock.current = 0;
            const q = useQuestStore.getState();
            if (q.said.length) { for (const text of q.said) st.pushAiMemo(text); useQuestStore.setState({ said: [] }); }
            // WHAT THE ARC DOES ONCE: the block picked, cleared to be built again. @see ONCE, clearBlock
            if (q.actions.length) {
              useQuestStore.setState({ actions: [] });
              for (const e of q.actions) {
                if (e.kind === "rebuildBlock" && clearBlock(st.grid) > 0) st.pushAiMemo("I have cleared the block. Its residents are staying with friends. I will build it again, properly.");
                // ITS WALLET GIVEN BACK: filled to what it may hold. @see Effect "fillWallet"
                if (e.kind === "fillWallet") useSessionStore.getState().setAiWallet({ aiWallet: walletCap() });
                // PAID: so many seconds of income, or as much as there is. @see Effect "pay"
                if (e.kind === "pay") {
                  const m = useMoneyStore.getState();
                  m.spendMoney(Math.min(m.money.toNumber(), Math.max(0, useGeneratorStore.getState().getMoneyPerSecond()) * e.seconds));
                }
              }
            }
          }
          // THE LATTICE charging, once it stands. @see stepLattice
          if (stepLattice(st.grid, aiNow.running, dt)) st.pushAiMemo("The Lattice is complete. Thank you for your help. It was not necessary.");
          // And what it means to take, a minute before it does. @see announce
          for (const text of runner.said.splice(0)) st.pushAiMemo(text);
          // AND WHAT IT HAS TO SAY. @see stepMemos
          const memo = stepMemos(runner, aiNow.stage, dt, useSessionStore.getState().aiSaid ?? []);
          if (memo) {
            if (memo.arrived) useSessionStore.getState().markAiSaid(memo.arrived);
            st.pushAiMemo(memo.text);
          }
          aiSaved.current += dt;
          if (aiSaved.current >= 5) { aiSaved.current = 0; useSessionStore.getState().setAiAt(at); }
        }
        sAi();
        const sMood = section("tick: mood, evolution");
        // PEOPLE LEAVING MISERABLE HOUSES, in the game, one now and then.
        // @see stepMood
        if (st.playing) {
          const left = stepMood(unrestRef.current, st.grid, liveMoods(st.grid, net), dt);
          if (left.length) useWorldStore.getState().housingMoved(left);
        }
        // THE TOWN EVOLVING, in the game: houses growing where their needs
        // are met, and declining when they lose them; and the town opening
        // what its people need, and closing what nobody does. @see stepTown
        if (st.playing) {
          // WHAT IT KNOWS HOW TO OPEN, by its headcount, one at a time. @see stepLadder
          const ladder = ladderOf(st.grid);
          if (ladder && stepLadder(ladder, ownedNow(), dt).length) townChanged();
          const cover = liveCoverage(st.grid, net);
          // THE FINEST STREETS, out for a stroll. @see Town.strollers
          let strollers = 0;
          for (const level of liveBeauty(st.grid, net).home.values()) if (level >= 3) strollers++;
          getTown().strollers = strollers;
          const grew = stepEvolution(getEvolution(), st.grid, liveMoods(st.grid, net), cover, dt);
          if (grew.length) useWorldStore.getState().housingMoved(grew);
          const ws = useWorldStore.getState();
          const changed = stepTownServices(getTownServices(), st.grid, net, cover, dt, {
            canPlace: (def, x, y) => { const d = structureDef(def); return !!d && validatePlacement(st.grid, d, x, y, playRules(st.grid)).ok; },
            place: ws.townPlace, clear: ws.townClear, rand: Math.random,
          });
          if (changed.length) ws.housingMoved(changed.map((e) => e.structure));
          // A SHOP OPENED: its pop, and its name floating up. @see Juice.opened
          const juice = juiceRef.current, bands = blRef.current, tex = texRef.current;
          for (const e of changed) {
            const s = e.kind === "open" && st.grid.structures.get(e.structure);
            if (!s || !juice || !bands || !tex) continue;
            juice.opened(s, slRef.current?.mounted.get(s.id)?.handle, { bands, textures: tex, grid: st.grid, scale }, shopName(e.service, s.id), SHOP_LOOK[e.service].neon ? SHOP_LOOK[e.service].letters : SHOP_LOOK[e.service].awning);
          }
        }
        sMood();
        const sWorks = section("tick: works");
        const works = getWorks();
        stepWorks(works, st.grid, net, getTown(), ownedNow(), st.playing ? payForLoad : () => true, dt, Date.now());
        if (works.opened.length) announceOpened(works.opened.splice(0));
        if (works.rev !== worksRevRef.current) {
          worksRevRef.current = works.rev;
          useWorldStore.setState({ projectRev: st.projectRev + 1 });
        }
        sWorks();
        { const e = section("tick: town draw"); townRef.current?.draw(getTown(), scale); e(); }
      }
      const t2 = performance.now();
      // THE DEVICE'S OWN TALLY when it is the one holding the water, and the
      // walk over the columns when it is not. @see createMeta
      const tally = solverRef.current?.last().reduce ?? null;
      useWorldStore.getState().refreshWaterMeta(
        tally ? { wet: tally.wet, water: tally.water } : undefined,
      );
      return { solve: t1 - t0, build: tTown - t1, town: t2 - tTown };
  };

  // Animated structures — the fluid in an excavation. Costs one Map walk per
  // frame when nothing on the map animates, because a renderer that declares no
  // `tick` is skipped outright.
  useTick((ticker) => {
    const sl = slRef.current, bl = blRef.current, tex = texRef.current;
    const raw = ((ticker as unknown as { deltaMS?: number }).deltaMS ?? 16.7) / 1000;
    const tFx = performance.now();
    const sFx = section("tick: fx (juice, night, lights, AI layer, rain)");
    // THE DRONES' LANDINGS, flashed where each job was done. @see AiRunner.landed
    {
      const landed = getAiRunner().landed, bl = blRef.current, tex = texRef.current;
      if (landed.length && juiceRef.current && bl && tex) for (const at of landed) juiceRef.current.landed(at, { bands: bl, textures: tex, grid: useWorldStore.getState().grid, scale });
      landed.length = 0;
    }
    // SHIP IT FRIDAYS: a release party now and then, off the roof of a
    // workplace in view. @see Juice.confetti
    shipIn.current -= raw;
    if (shipIn.current <= 0 && juiceRef.current && bl && tex) {
      shipIn.current = SHIP_EVERY * (0.6 + Math.random() * 0.8);
      if (inForce(useGeneratorStore.getState().employeeManagement.deck).includes("shipit")) {
        const grid = useWorldStore.getState().grid;
        const seen = [...grid.structures.values()].filter((s) => !s.build && workplaceKind(s.def) && bandShown(bl, bandOf(s.x + s.w - 1, s.y + s.h - 1)));
        if (seen.length) juiceRef.current.confetti(seen[Math.floor(Math.random() * seen.length)], { bands: bl, textures: tex, grid, scale });
      }
    }
    // DISASTERS ON THE MAP, looked at once a second. @see createDisasterFx
    disasterClock.current += raw;
    if (disasterClock.current >= 1 && disasterFxRef.current && juiceRef.current && bl && tex) {
      disasterClock.current = 0;
      const st = useWorldStore.getState();
      const active = (kind: string) => st.playing ? st.events.find((e) => e.kind === kind && e.phase === "active") : undefined;
      const works = active("road-works");
      const drinkers: number[] = [];
      for (const [id, t] of allTanks()) if (t.demand > 0) drinkers.push(id);
      disasterFxRef.current.sync({
        ctx: { bands: bl, textures: tex, grid: st.grid, scale }, juice: juiceRef.current, lights: lightsRef.current,
        damaged: st.playing ? damagedNow() : [], heatwave: !!active("heatwave"), drinkers,
        closed: works?.where ? [works.where] : [],
        // A FIRE: smoking while it is coming, burning once caught — and what it spread to, once it has. @see FIRE
        fire: (() => {
          const f = st.playing ? st.events.find((e) => e.kind === "fire" && e.phase !== "over") : undefined, at = fireAt.current;
          if (!f || !at) return { burning: [], smouldering: [] };
          return f.phase === "active" ? { burning: [at.id, ...(at.spread ?? [])], smouldering: [] } : { burning: [], smouldering: [at.id] };
        })(),
        spray: (() => { const e = active("burst-main"); return e ? [e.where] : []; })(),
        bubble: (() => { const e = active("sewer-backup"); return e ? [e.where] : []; })(),
        // ITS ROOF AS DRAWN: the top of its sprites over the middle of its
        // footprint's ground, in the scene's space — less half the roof's own
        // diamond, whose top is its back corner and not its middle. @see RoofOf
        roof: (id) => {
          const s = st.grid.structures.get(id), h = slRef.current?.mounted.get(id)?.handle as { sprites?: Container[]; columns?: Container[] } | undefined;
          const parts = h?.sprites ?? h?.columns;
          if (!s || !parts?.length) return null;
          let top = Infinity;
          for (const p of parts) if (!p.destroyed) top = Math.min(top, bl.root.toLocal(p.getBounds()).y);
          const fx = s.x + s.w - 1, fy = s.y + s.h - 1;
          const z = inBounds(st.grid, fx, fy) ? st.grid.height[idx(st.grid, fx, fy)] : 0;
          const foot = cellToWorld(s.x + (s.w - 1) / 2, s.y + (s.h - 1) / 2, z, scale).wy;
          return Number.isFinite(top) ? Math.max(0, (foot - top) / scale - ((s.w + s.h) / 2) * HH) : null;
        },
      });
    }
    {
      const st = useWorldStore.getState(), vpNow = st.viewport;
      // AN EARTHQUAKE: dust off what it damaged, once; and the camera shaken
      // while it lasts, the offset taken off again every frame. @see EARTHQUAKE
      if (quakeDust.current.length && juiceRef.current && bl && tex) {
        for (const id of quakeDust.current) { const s = st.grid.structures.get(id); if (s) juiceRef.current.dust(s, { bands: bl, textures: tex, grid: st.grid, scale }); }
        quakeDust.current = [];
      }
      if (vpNow) {
        vpNow.x -= shake.current.x; vpNow.y -= shake.current.y;
        const q = st.playing ? st.events.find((e) => e.kind === "earthquake" && e.phase === "active") : undefined;
        const left = q?.endsAt !== undefined ? Math.max(0, (q.endsAt - Date.now()) / QUAKE_MS) : 0;
        const amp = useGlobalSettingsStore.getState().motion === "calm" ? 0 : 9 * left;
        shake.current = { x: (Math.random() * 2 - 1) * amp, y: (Math.random() * 2 - 1) * amp * 0.6 };
        vpNow.x += shake.current.x; vpNow.y += shake.current.y;
      }
      // A BLACKOUT: the district's lights stutter as it comes, and go out when it strikes — unless it is held.
      if (lightsRef.current) {
        const b = st.playing ? st.events.find((e) => e.kind === "blackout" && e.phase !== "over") : undefined;
        const held = b?.chosen === "generators" || b?.chosen === "shed";
        const ids = b && !held ? (blackoutIds.current?.ids ?? (() => {
          const j = b.where;
          return [...st.grid.structures.values()].filter((s) => Math.abs(s.x - j.x) + Math.abs(s.y - j.y) <= BLACKOUT_RADIUS).map((s) => s.id);
        })()) : [];
        lightsRef.current.dark(new Set(ids), b?.phase === "warning");
      }
      juiceRef.current?.tick(raw * 1000, bl && vpNow ? { zoom: vpNow.scale.x, shown: (b) => bandShown(bl, b) } : undefined);
    }
    // THE TOWN'S AMBIENCE, a few times a second: its hum by its size, birds by day, crickets by night. @see ambience
    soundClock.current += raw;
    if (soundClock.current > 0.25) {
      soundClock.current = 0;
      const st = useWorldStore.getState();
      const night = st.playing && useGlobalSettingsStore.getState().dayNight ? darkness(phaseNow()) / NIGHT_DARK : 0;
      ambience(st.playing ? Math.min(1, getTown().movers.length / TOWN_FULL) : 0, night);
    }
    // THE HOUR, in the game: the night over the map, and how busy the streets
    // are. Off, or in the editor, a plain bright noon. @see world/daylight
    {
      const on = useWorldStore.getState().playing && useGlobalSettingsStore.getState().dayNight;
      const phase = phaseNow();
      getTown().busy = on ? busyness(phase) : undefined;
      // The culture deck on the streets. @see Town.culture
      {
        const deck = useGeneratorStore.getState().employeeManagement.deck, cards = inForce(deck);
        getTown().culture = { remote: cultureNow().remote, shuttle: cards.includes("shuttle"), vans: cards.includes("hiretofire") };
      }
      const g = night.current;
      const now = Date.now();
      const playing = useWorldStore.getState().playing;
      const meter = playing ? useAiSingularityStore.getState().value : 0;
      // THE ASCENSION SEQUENCE: begun when the meter is full; the camera to the Data Centre. @see stepSequence
      if (playing && stepSequence(meter, now)) {
        const dc = [...useWorldStore.getState().grid.structures.values()].find((x) => x.def === "datacentre" && !x.build);
        if (dc) showMe({ x: dc.x + dc.w / 2, y: dc.y + dc.h / 2 });
      }
      const ascension = playing ? sequenceIntensity(now) : 0;
      const nightNow = on ? darkness(phase) / NIGHT_DARK : 0;
      if (g) {
        // THE SKY TURNS as the AI rises: a violet cast from the Manager on, and at the Ascension.
        // By the stage, so Hard Takeoff's early Overseer brings it with it. @see stagesNow
        const skyStage = stageOf(meter).stage;
        const tint = (skyStage === "overseer" || skyStage === "ascension" ? 0.08 : skyStage === "manager" ? 0.04 : 0) + 0.3 * ascension;
        // A HEATWAVE OR A DROUGHT: the map graded warm, half while it is coming.
        const dry = playing ? useWorldStore.getState().events.find((e) => (e.kind === "heatwave" || e.kind === "drought") && e.phase !== "over") : undefined;
        const warm = dry ? (dry.phase === "active" ? 1 : 0.5) : 0;
        const colour = mixColour(mixColour(mixColour(0xffffff, HEAT_GRADE, warm), NIGHT_GRADE, nightNow), STAGE_COLOUR.overseer, tint);
        // Redrawn only when it changes: a colour a step at a time, or the screen's size.
        const key = `${colour}|${app.screen.width}x${app.screen.height}`;
        if (key !== nightKey.current) {
          nightKey.current = key;
          g.clear();
          if (colour !== 0xffffff) g.rect(0, 0, app.screen.width, app.screen.height).fill({ color: colour });
        }
      }
      const blNow = blRef.current;
      if (propsRef.current) {
        const st = useWorldStore.getState();
        propsRef.current.sync(st.grid, useGeneratorStore.getState().employeeManagement.deck, st.revision, scale);
      }
      if (shopsRef.current) {
        shopsRef.current.sync(useWorldStore.getState().grid, useWorldStore.getState().revision, scale);
        shopsRef.current.tick(now / 1000);
      }
      if (woodsRef.current) { const st = useWorldStore.getState(); woodsRef.current.sync(st.grid, st.palette, st.revision, scale); }
      if (signalsRef.current) {
        // The lanes the town last drove on: kept current by stepTown. @see trafficOf
        const town = getTown(), T = town.traffic;
        if (T) { signalsRef.current.sync(useWorldStore.getState().grid, T, scale); signalsRef.current.tick(T, town.t); }
        if (T && busStopsRef.current) busStopsRef.current.sync(useWorldStore.getState().grid, T, town.buses?.G === T.G ? town.buses.routes : [], scale);
      }
      const streetNet = getNetwork();
      if (streetPropsRef.current && streetNet) {
        const st = useWorldStore.getState();
        streetPropsRef.current.sync(st.grid, liveBeauty(st.grid, streetNet), st.revision, scale, trafficOf(getTown(), st.grid).G.crossings);
        // THE BENCHES' SEATS, for the town's walkers to sit on. @see Town.seats
        const seats = streetPropsRef.current.seats();
        if (seats !== seatsRef.current) { seatsRef.current = seats; getTown().seats = seatsByCell(st.grid, seats); }
        // What the road wears — its pavement by level, its zebras — painted into the road itself.
        const dress = streetPropsRef.current.dress();
        // (The town's walkers have the right of way on its zebras.)
        if (dress) getTown().dress = dress;
        if (dress && plRef.current && blRef.current && texRef.current && plRef.current.dress !== dress) {
          dressPaved(plRef.current, blRef.current, st.grid, texRef.current, dress);
        }
      }
      if (lightsRef.current && blNow) {
        // Put where the map is now whenever it has changed — whichever of the
        // scene and the lights was made first. @see createLights
        const st = useWorldStore.getState();
        // Crunch Week's offices lit cold and bright. @see CRUNCH_WINDOW
        const crunch = inForce(useGeneratorStore.getState().employeeManagement.deck).includes("crunch");
        if (nightNow > 0.02 && (lightsAt.current.grid !== st.grid || lightsAt.current.rev !== st.revision || lightsAt.current.crunch !== crunch)) {
          lightsAt.current = { grid: st.grid, rev: st.revision, crunch };
          const e = section("tick: lights sync");
          lightsRef.current.sync(st.grid, scale, crunch);
          e();
        }
        lightsRef.current.tick(nightNow, blNow.root.worldTransform, now / 1000);
      }
      // THE AI ON THE MAP. @see createAiLayer
      const ai = aiLayerRef.current;
      // In development, `__aiPreview` shows it in the editor at any stage.
      // And on the `singularity` fixture, in the editor, it runs through every stage by itself. @see aiFixturePreview
      const preview = import.meta.env.DEV
        ? window.__aiPreview ?? (startFixture() === "singularity" && !playing ? aiFixturePreview(performance.now() / 1000) : undefined)
        : undefined;
      const modelRun = playing && useFounderStore.getState().selectedFounderId === "model";
      if (ai && (playing || preview || modelRun)) {
        const v = preview?.value ?? meter;
        ai.draw(useWorldStore.getState().grid, scale, {
          stage: stageOf(v).stage, value: v, running: preview ? 1 : runningAgents(), training: preview?.training ?? training() !== null,
          night: on ? darkness(phase) / NIGHT_DARK : 0, ascension: preview?.ascension ?? ascension,
          drones: getAiRunner().jobs.map(droneAt),
          // The Machine's Coolant Loop and Holo-Concierges, where bought. @see game/machine
          coolant: !modelRun && notable("coolant"),
          concierges: !modelRun && notable("concierge") ? conciergesOf(useWorldStore.getState().grid) : undefined,
          airlifts: getWorks().airlifts.map((a) => { const k = Math.min(1, a.t / a.fly); return { x: a.from.x + (a.to.x - a.from.x) * k, y: a.from.y + (a.to.y - a.from.y) * k }; }),
          // An inherited AI's drones in the player's teal, till its takeover begins. @see inherited
          droneLight: !modelRun && inherited(stageOf(v).stage) ? STAGE_COLOUR.tool : undefined,
          // The game's masterplan is holograms; the flat ghost is the editor's preview's alone. @see createTileHolograms
          plan: preview?.plan ?? null,
          ...dcCooling(useWorldStore.getState().grid),
          planHolos: planHoloKeys.current,
          // WHERE IT TAKES OVER: the company's AI's district, in the game. @see aiDistrict
          district: playing && !modelRun && !preview ? aiDistrict(useWorldStore.getState().grid, stageOf(v).stage) : null,
          // ALIGNED, its district drawn in the player's teal; AIR-GAPPED, its links dark. @see game/machine KEYSTONES
          districtColour: !modelRun && keystone("alignment") ? STAGE_COLOUR.tool : undefined,
          airGap: !modelRun && !preview && keystone("airgap"),
          reservoirs: playing ? useSessionStore.getState().aiReservoirs : undefined,
          // WHAT THE ARC IS PICKING, under the pointer; or the block picked. @see useQuestStore.picking
          pick: playing ? questPickBox() : null,
          pipe: useSessionStore.getState().showPlan && useSessionStore.getState().aiMode ? pendingPipe() : null,
        }, raw, now);
      } else ai?.clear();
      const r = rain.current;
      if (r) {
        r.clear();
        const st = useWorldStore.getState();
        const flood = st.playing && st.events.find((e) => e.kind === "river-flood" && e.phase !== "over");
        if (flood) drawRain(r, app.screen.width, app.screen.height, performance.now() / 1000, flood.phase === "active" ? 1 : 0.5);
      }
    }
    perfAdd("fx", performance.now() - tFx);
    sFx();
    // The water runs every frame, and the mesh is rebuilt from it every frame:
    // the surface changes everywhere at once, so there is no incremental
    // version of drawing it.
    const field = useWorldStore.getState().getWaterField();
    /**
     * THE FRAME'S TIME, CUT TO WHAT THE WATER CAN ACTUALLY TAKE.
     *
     * The solver drops whatever it cannot fit into `MAX_SUBSTEPS` — that is
     * the backstop, and it is right — but everything else in this tick was
     * still being handed the WHOLE frame. So on a long frame the springs
     * poured a full frame's water into a flow that had advanced a fifth of
     * one, and the map gained water it had had no time to move.
     *
     * A backgrounded tab is not a corner case here: rAF throttles to about
     * one frame a second, which is sixty times the step the water can take,
     * and the map floods while nobody is looking at it. Measured on a spring
     * at 48 squared — five seconds of wall clock in one-second frames left 80
     * of water against the 16 the same second of flow should hold.
     *
     * Clamped HERE, where time enters, rather than scaled at each use: then
     * `dt` means one thing to the springs, the pipes, the solver and the two
     * renderers, and nothing downstream has to know this happened. @see maxStep
     */
    //
    // AND ON THE CPU, TO WHAT THIS MACHINE CAN SOLVE IN A FRAME. Without a
    // WebGPU device the solver is JavaScript, and its cost is per substep: a
    // long frame asked for more substeps, which made the next frame longer,
    // until every frame took the twelve — Firefox without WebGPU sat at 12 fps
    // on a Large map, 54 ms of every 83 the solver's (2026-11-08). So the
    // budget is what a substep costs here, measured, into CPU_SOLVE_MS; past
    // it the water runs slower than real time, as it already does past
    // MAX_SUBSTEPS, and the frame rate holds. @see maxStep
    const onCpu = !!field && !solverRef.current;
    const dt = field ? Math.min(raw, maxStep(field.columns, onCpu ? cpuWater.current.cap : MAX_SUBSTEPS)) : raw;
    const subs = field && onCpu ? substepsFor(field.columns, dt).length : 0;
    const sWater = section("tick: water frame (all of it)");
    const spent = waterFrameRef.current?.(dt);
    sWater();
    if (spent && subs > 0) {
      const c = cpuWater.current, per = spent.solve / subs;
      c.perSub = c.perSub > 0 ? c.perSub * 0.9 + per * 0.1 : per;
      c.cap = Math.max(1, Math.min(MAX_SUBSTEPS, Math.floor(CPU_SOLVE_MS / c.perSub)));
      cpuWaterSaw(c.perSub, c.cap);
    }
    if (spent) {
      perfAdd("solve", spent.solve);
      perfAdd("build", spent.build);
      perfAdd("town", spent.town ?? 0);
      if (import.meta.env.DEV) {
        const w = (window as unknown as { __waterMs?: { solve: number; draw: number; n: number } });
        const acc = w.__waterMs ?? (w.__waterMs = { solve: 0, draw: 0, n: 0 });
        acc.solve += spent.solve; acc.draw += spent.build; acc.n++;
      }
    }
    if (!sl || !bl || !tex || !hasAnimated(sl)) return;
    tickStructures(sl, { bands: bl, textures: tex, grid, scale }, dt);
  });

  // SUBMIT, measured around the RENDER CALL ITSELF.
  //
  // Wrapping the method, so nothing can get between a function and itself —
  // it was two ticker callbacks either side of Pixi's render step before, on
  // the reasoning that the span between them is the render and nothing else.
  //
  // What it reads is mostly WAITING, and `perf.ts` says so at length: the call
  // blocks on the compositor, so a quiet frame spends it idle. That is why it
  // is called present and is kept out of the `js` total.
  useEffect(() => {
    if (!import.meta.env.DEV || !app?.renderer || !app?.ticker) return;
    const renderer = app.renderer as unknown as { render: (...a: unknown[]) => unknown };
    const real = renderer.render.bind(renderer);
    // AND INSIDE IT, with `?hitches`: a render group's draw list built again
    // (a chunk shown, a child added, moved or re-sorted), and the batches
    // uploaded after — what a moving camera can cost. @see section
    const groups = (renderer as unknown as { renderGroup?: { _buildInstructions?: (...a: unknown[]) => unknown } }).renderGroup;
    const realBuild = groups?._buildInstructions?.bind(groups);
    if (groups && realBuild) groups._buildInstructions = (...a: unknown[]) => { const e = section("pixi: a render group rebuilt"); const out = realBuild(...a); e(); return out; };
    const batch = (renderer as unknown as { renderPipes?: { batch?: { upload?: (...a: unknown[]) => unknown } } }).renderPipes?.batch;
    const realUpload = batch?.upload?.bind(batch);
    if (batch && realUpload) batch.upload = (...a: unknown[]) => { const e = section("pixi: batches uploaded"); const out = realUpload(...a); e(); return out; };
    renderer.render = (...a: unknown[]) => {
      const at = performance.now();
      const e = section("pixi render");
      const out = real(...a);
      e();
      perfAdd("present", performance.now() - at);
      return out;
    };
    /**
     * AND WHAT THE RENDER COSTS THE GPU, which is the one part of a frame
     * nothing here has ever been able to read.
     *
     * A render pass has to carry its own timestamps — bracketing it with
     * passes of ours measures nothing, because nothing orders an empty compute
     * pass against a render. So Pixi's own `beginRenderPass` is wrapped and
     * the pair goes into the descriptor it was about to use. That descriptor
     * is a cached object Pixi reuses, so it is set on EVERY call and deleted
     * when there is nothing to write, or a stale query index would be handed
     * to a later pass. @see Stamps
     */
    // OPTIONAL ALL THE WAY DOWN, and that is the WebGL fix. The renderer has
    // an `encoder` on both paths; only the WebGPU one has a `beginRenderPass`
    // on it. `encoder?.beginRenderPass.bind(...)` guards the encoder being
    // absent and not the METHOD being absent, so on WebGL it threw "Cannot
    // read properties of undefined (reading 'bind')" — inside an effect,
    // during mount, which takes `WorldScene` down with it and leaves a blank
    // canvas. The one path that exists so somebody without WebGPU still gets
    // a map was the one path that could not draw one.
    const es = renderer as unknown as {
      encoder?: {
        beginRenderPass?: (t: { descriptor: GPURenderPassDescriptor }) => void;
      };
    };
    const device = (renderer as unknown as { gpu?: { device: GPUDevice } })
      .gpu?.device ?? null;
    // No device, no timestamps to write: the wrapping below is WebGPU's alone.
    const encoder = device ? es.encoder : undefined;
    const realBegin = encoder?.beginRenderPass?.bind(encoder);
    holdStamps(device);
    if (encoder && realBegin) {
      encoder.beginRenderPass = (target) => {
        // FROM THE DEVICE'S SET, not the solver's. The water's mesh is built
        // in a vertex shader on BOTH paths, so what the render costs is the
        // same question whichever solver is running — and a number that only
        // exists while the compute one is on cannot be checked against
        // anything. @see holdStamps
        const writes = stampsNow()?.take("render");
        if (writes) target.descriptor.timestampWrites = writes;
        else delete target.descriptor.timestampWrites;
        return realBegin(target);
      };
    }
    // Closing the frame off goes after everything, so every slot is filled —
    // and the GPU's clocks are copied out here for the same reason: a resolve
    // only sees queries the commands before it wrote, and the renderer has
    // just submitted. @see flushStamps
    // AND COUNTED: draw calls the encoder submits, and Graphics cleared to be
    // drawn again — the two numbers a scene's batching and immediate-mode
    // drawing show in. @see perfCount
    const enc = (renderer as unknown as { encoder?: { draw?: (...a: unknown[]) => unknown } }).encoder;
    const realDraw = enc?.draw?.bind(enc);
    if (enc && realDraw) enc.draw = (...a: unknown[]) => { perfCount("draws"); return realDraw(...a); };
    const realClear = Graphics.prototype.clear;
    Graphics.prototype.clear = function (this: Graphics) { perfCount("gfx"); return realClear.call(this); };
    const done = () => { flushStamps(device); perfFrame(); };
    app.ticker.add(done, null, UPDATE_PRIORITY.LOW - 1);
    return () => {
      renderer.render = real as typeof renderer.render;
      if (encoder && realBegin) encoder.beginRenderPass = realBegin;
      if (enc && realDraw) enc.draw = realDraw;
      if (groups && realBuild) groups._buildInstructions = realBuild;
      if (batch && realUpload) batch.upload = realUpload;
      Graphics.prototype.clear = realClear;
      // The app can already be torn down by now, when the whole map unmounts.
      app.ticker?.remove(done, null);
    };
  }, [app]);

  // Cull to the visible band range each frame. Cheap: one comparison per band,
  // and setVisibleBands early-returns when the range has not moved.
  //
  // A FUNCTION THE BENCH CALLS TOO. It was this tick's body and nothing else,
  // and the bench does not tick — so a bench run kept whatever band range the
  // last real frame had left, and zooming out for one measured the bands the
  // previous zoom showed. @see cullBandsRef
  cullBandsRef.current = () => {
    const bl = blRef.current;
    const vp = useWorldStore.getState().viewport;
    if (!bl || !vp) return;
    const { lo, hi } = visibleBandRange(grid, scale, vp.top, vp.bottom);
    let e = section("tick: band cull");
    setVisibleBands(bl, lo, hi);
    e();
    if (lo !== bandRange.current.lo || hi !== bandRange.current.hi) {
      bandRange.current = { lo, hi };
      e = section("tick: overlays redrawn for the band range");
      redrawOverlays();                    // overlays follow the visible range
      e();
    }
    const n = visibleBandCount(bl);
    if (n !== useWorldStore.getState().drawnBands) {
      e = section("tick: drawn bands to the store");
      useWorldStore.getState().setDrawnBands(n);
      e();
    }
  };
  useTick(() => cullBandsRef.current?.());

  // ROADS IN DETAIL CLOSE UP: the cells on screen painted at the resolution the
  // zoom shows them at, a few new ones a frame. Asked again only when the zoom
  // crosses a level, the view moves a tile, roads are laid (new textures), or
  // cells are still waiting.
  const lodView = useRef({ pl: null as PavedLayer | null, want: -1, x: NaN, y: NaN, w: NaN, keys: -1, waiting: false });
  useTick(() => {
    const pl = plRef.current, vp = useWorldStore.getState().viewport;
    if (!pl?.painter || !vp) return;
    pl.painter.reap();
    const want = lodFor(scale * vp.scale.x * app.renderer.resolution, pl.lodWant);
    const keys = pl.painter.stats().keys;
    const L = lodView.current, step = 66 * scale;
    const x = Math.round(vp.left / step), y = Math.round(vp.top / step), w = Math.round(vp.worldScreenWidth / step);
    if (pl === L.pl && want === L.want && x === L.x && y === L.y && w === L.w && keys === L.keys && !L.waiting) return;
    const e = section("tick: road detail");
    L.waiting = !lodPaved(pl, useWorldStore.getState().grid, want, { left: vp.left, top: vp.top, right: vp.right, bottom: vp.bottom }, 4);
    e();
    Object.assign(L, { pl, want, x, y, w, keys: pl.painter.stats().keys });
  });

  void app;
  return (
    <pixiContainer>
      <pixiContainer ref={rootRef} />
      {/* above the bands, so overlays are never occluded by terrain */}
      <pixiContainer ref={overlayRoot} zIndex={10} />
    </pixiContainer>
  );
}

/** The box the arc is picking under the pointer — a block, a site — or the block picked, while its objective runs. @see QuestLayer */
function questPickBox(): { x: number; y: number; w: number; h: number } | null {
  const q = useQuestStore.getState(), hover = useWorldStore.getState().hover;
  if (q.picking === "block" && hover) return boxAround(hover, BLOCK);
  if (q.picking === "site" && hover) return boxAround(hover, SITE);
  if (q.block && q.objective?.spec.kind === "selectBlock") return boxAround(q.block, BLOCK);
  return null;
}
