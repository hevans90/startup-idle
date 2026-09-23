/**
 * World v2 — the Pixi scene.
 *
 * Imperative by design: bands and per-cell sprite handles are built and
 * reconciled directly, with React only mounting the container. Same pattern as
 * v1's `GroundRoadLayer`, but the state it draws from is mutable.
 */
import { extend, useApplication, useTick } from "@pixi/react";
import {
  Container, Graphics, RenderTexture, UPDATE_PRIORITY,
  type FederatedPointerEvent,
} from "pixi.js";
import { useCallback, useEffect, useRef, useState } from "react";

import { loadIsometricAtlasTextures } from "../iso/atlas/load-isometric-atlases";
import { drainDirty, getNetwork, useWorldStore } from "../state/world.store";
import { perfAdd, perfFrame } from "./debug/perf";
import {
  createBandLayer, destroyBandLayer, setGroundAlpha, setVisibleBands, visibleBandCount,
  type BandLayer,
} from "./render/bands";
import { boundsCentre, fitScale, visibleBandRange, worldBounds } from "./render/camera";
import { buildTerrain, createTerrainLayer, type TerrainLayer } from "./render/terrain";
import { buildCliffs, createCliffLayer, syncCliff, type CliffLayer } from "./render/cliffs";
import { buildPaved, createPavedLayer, recountInexact, syncPaved, type PavedLayer } from "./render/paved";
import {
  createWaterLayer, destroyWaterLayer, drawWater, type WaterLayer,
} from "./render/water";
import {
  attachQuadGather, createGpuWaterLayer, destroyGpuWaterLayer, deviceSinks,
  destroyQuadGather, drawGpuWater, gatherQuads, showGpuWater, waterOnGpu,
  type GpuWaterLayer,
} from "./render/water-gpu";
import { checkWaterOverPaving, compareWaterPaths } from "./debug/water-compare";
import { NO_BODY } from "./render/bodies";
import { atBrink, showsWater } from "./render/corner-rule";
import { FALL_MIN, waterInAir } from "../fluid/falls";
import { crossingPoured } from "./debug/world-scenes";
import {
  clearStructureLayer, createStructureLayer, hasAnimated, refreshStructuresAt,
  syncStructures, tickStructures, type StructureLayer,
} from "./structures/layer";
import type { RenderCtx } from "./structures/render";
import { structureDef } from "./structures/def";
import { strokeFootprint as structureFootprint } from "./structures/place";
// Registers the `tiles` strategy. Imported for the side effect: the registry is
// what the layer looks a definition up in, and nothing else references it.
import "./structures/tiles-renderer";
import { buildRoadTable, roadSpriteFor } from "./roads/table";
import { isPaved, maskAt, maskDirtyCells } from "./roads/mask";
import { netIdAt } from "./roads/network";
import { loadIsometricAtlasTextures as _loader } from "../iso/atlas/load-isometric-atlases";
import {
  drawBandStripes, drawGrid, drawHeightTint, drawHover, drawNetComponents,
  drawOrigin, drawPickCrosshair, drawRoadGaps, drawRoadMask,
} from "./render/overlays";

/**
 * How solid the ground stays in x-ray.
 *
 * Faint enough to see a pipe through a hillside, solid enough that the map is
 * still a map — at a tenth you are looking at a wireframe and cannot tell
 * where anything is, and at a half a deep run is still lost behind the cliff
 * columns, which stack and so multiply their own alpha.
 */
const XRAY_GROUND = 0.26;
import { createBuildCursor, type BuildCursor } from "./edit/cursor";
import { isStructureTool, strokeFootprint, type Stroke } from "./edit/tools";
import { setPanButtons } from "../utils/viewport-controls";
import { syncCell } from "./render/terrain";
import { footprintCells, surfaceSampler } from "./grid";
import { HEIGHT_UNIT, HH, HW, cellToWorld, pickCell, worldToCellF } from "./iso";
import { runSources, stepWater } from "./water/field";
import { runPipes } from "./water/pipes";
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
  SPRAY_BOUNDS, checkPour, checkPourLive, compareFrames, flat,
} from "../fluid/gpu/compare-frames";
import { gpuWaterHeldBack, gpuWaterSaw } from "./debug/gpu-water-stat";
import { flushStamps, holdStamps, stampsNow } from "./debug/gpu-stamps";
import {
  createGpuFallLayer, destroyGpuFallLayer, drawGpuFalls, type GpuFallLayer,
} from "./render/falls-gpu";
import { COLUMNS_PER_TILE } from "./water/field";
import { pointerRead, type PointerAt } from "./debug/pointer-at";
import { heldDevice } from "./debug/gpu-device";
import { deviceLost, onDeviceLost } from "./render/device";
import {
  compareAccelerate, compareCliffs, pour as pourScene,
  scene as accelScene, spanned, spannedDry, spray,
} from "../fluid/gpu/compare-pass";
import { checkLive } from "../fluid/gpu/check-live";
import { holdDevice } from "./debug/gpu-device";
import { activeBox, maxStep } from "../fluid/columns";

// Required: <pixiContainer> is only a known element once Container is
// registered with @pixi/react, and without it `rootRef` never populates.
extend({ Container });

/**
 * Built once: the label files never change at runtime. Thick roads only — the
 * thin family is largely unlabelled, so asking for it would produce holes.
 */
const ROAD_TABLE = buildRoadTable("landscape");

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
  /**
   * Bumped when the async scene build finishes. The cursor cannot exist before
   * the band layer does, so the effects that drive it need a reason to re-run
   * once it appears rather than waiting for the next pointer move.
   */
  const [sceneEpoch, setSceneEpoch] = useState(0);
  const grid = useWorldStore((s) => s.grid);
  const scale = useWorldStore((s) => s.scale);
  const { app } = useApplication();

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
      const pl = createPavedLayer(grid, ROAD_TABLE, scale);
      const sl = createStructureLayer();
      const water = useWorldStore.getState().getWaterField();
      // THE MESH KNOWS ABOUT STOREYS, so a map with bridges on it draws on
      // the device like any other. The SOLVER still does not — see the effect
      // that builds it — which is the one thing left holding a bridged map on
      // the host. @see createGpuWaterLayer
      const onGpu = waterOnGpu();
      rendererRef.current = app?.renderer ?? null;
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
        window.__solver = () => solverRef.current;
        window.__waterGpu = gpuRef.current;
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
        // WHETHER THE MESH'S TWO SOURCES AGREE ABOUT THE MAP IN FRONT OF YOU.
        //
        // On the device path the depth the mesh draws comes off the DEVICE's
        // texture and the sheet id that decides whether to draw it at all is
        // worked out on the HOST, from the host's copy of the depths. A column
        // that is wet on one and NO_BODY on the other is water that is there,
        // correctly solved, and drawn by nothing — which is what a bridge with
        // no water on it looks like. This counts them. @see findBodies
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
        window.__liveWaterPixels = () => {
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
          const was = wl.drawing;
          showGpuWater(wl, true);
          const on = shoot();
          showGpuWater(wl, false);
          const off = shoot();
          showGpuWater(wl, was);

          // AND THE DECK'S OWN SHARE OF IT, which the box above cannot give:
          // that box holds the channel under the span as well, and a river
          // seen beside a bridge counts the same as water standing on it.
          //
          // Taken by the SHEET IDS rather than by the depths. They are worked
          // out on the host every frame and uploaded, so emptying the host's
          // upper storeys makes the deck's columns NO_BODY and the builder
          // drops them — while the device's depth texture, which this path
          // does not write, is left alone. Whatever changes is what the deck's
          // water was putting on the screen. @see findBodies
          const c = field.columns, cells = c.cells;
          const kept = new Float32Array(cells * (c.layers - 1));
          for (let a = 1; a < c.layers; a++) {
            for (let i = 0; i < cells; i++) {
              kept[(a - 1) * cells + i] = c.depth[a * cells + i];
              c.depth[a * cells + i] = 0;
            }
          }
          drawGpuWater(wl, c, bl, 1 / 60, true, solverRef.current !== null);
          const noDeck = shoot();
          for (let a = 1; a < c.layers; a++) {
            for (let i = 0; i < cells; i++) {
              c.depth[a * cells + i] = kept[(a - 1) * cells + i];
            }
          }
          drawGpuWater(wl, c, bl, 1 / 60, true, solverRef.current !== null);
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
         * WATCH A SPAN FOR HOLES, frame by frame.
         *
         * `__deckBodies` is a snapshot and a hole that lasts a moment is not
         * in it. This samples every frame for a while and keeps the worst: a
         * column that is WET and has no sheet id is a column the builder
         * skips, which is a hole you can see the deck through.
         *
         * It also keeps the AIR, because the thing being chased is what
         * happens as a fall ENDS — so the frame a hole opens can be lined up
         * against the frame the last of the water left the lip.
         */
        window.__watchDeckHoles = (frames = 240) => new Promise((done) => {
          const f = useWorldStore.getState().getWaterField();
          if (!f) { done({ ok: false, why: "no water field" }); return; }
          const c = f.columns, cells = c.cells;
          const deck: number[] = [];
          for (let i = 0; i < cells; i++) {
            for (let a = 1; a < c.layers; a++) {
              const ia = a * cells + i;
              if (c.roof[ia] > c.ground[ia]) deck.push(ia);
            }
          }
          const log: unknown[] = [];
          let worst = 0, worstFrame = -1, n = 0;
          const tick = () => {
            const wl = gpuRef.current;
            let wet = 0, holes = 0;
            for (const ia of deck) {
              if (c.depth[ia] <= c.params.dryDepth) continue;
              wet++;
              if (wl && wl.bodies.at[ia] === NO_BODY) holes++;
            }
            const air = waterInAir(c);
            if (holes > worst) { worst = holes; worstFrame = n; }
            if (holes > 0 || n % 30 === 0) {
              log.push({ n, wet, holes, air: +air.toFixed(4), lips: c.falls.cliffN });
            }
            if (++n < frames) requestAnimationFrame(tick);
            else {
              done({
                deckColumns: deck.length, frames: n,
                worstHoles: worst, atFrame: worstFrame,
                log: log.slice(0, 40),
                ok: worst === 0,
                why: worst > 0
                  ? `${worst} wet deck columns lost their sheet id at frame ${worstFrame}`
                  : "no column was ever wet without an id — the hole is not the labelling",
              });
            }
          };
          requestAnimationFrame(tick);
        });
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
          // THE REFERENCE: the same picture with the deck's water not drawn.
          //
          // SETTLED FIRST, and the first frames after it thrown away. Taken
          // cold, the count climbed 771 to 2624 over eleven frames with the
          // wet column count dead still at 133 — the picture catching up with
          // having had the deck emptied and put back, reported as eleven
          // frames of holes. That is this tool's own wake, not the map's.
          const kept = deck.map((i) => c.depth[i]);
          for (const i of deck) c.depth[i] = 0;
          for (let k = 0; k < 3; k++) {
            drawGpuWater(wl, c, bl, 1 / 60, true, solverRef.current !== null);
            shoot();
          }
          const bare = shoot();
          deck.forEach((i, k) => { c.depth[i] = kept[k]; });
          for (let k = 0; k < 3; k++) {
            drawGpuWater(wl, c, bl, 1 / 60, true, solverRef.current !== null);
            shoot();
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
          requestAnimationFrame(tick);
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
              for (let b = 0; b < wl.meshes.length; b++) {
                const drew = wl.meshes[b].geometry.instanceCount;
                const wanted = g.count[b];
                if (wanted > drew) {
                  const by = wanted - drew;
                  if (by > worst) worst = by;
                  if (short.length < 30) {
                    short.push({
                      n, band: b, wanted, drew, by,
                      onASpan: deckBands.has(b), grew: g.grew[b],
                    });
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
         * Asked of `showsWater` itself, which is the rule the builder, the
         * gathering and the vertex shader all decide by — so this cannot
         * disagree with what is on the screen about which columns are in the
         * sheet. A column missing with its neighbours present IS the hole,
         * and its depth and its brink say why it was left out.
         */
        window.__deckHolesNow = () => {
          const fld = useWorldStore.getState().getWaterField();
          if (!fld) return { ok: false, why: "no water field" };
          const f = fld.columns, cells = f.cells, dry = f.params.dryDepth;
          const deckAt = (i: number) => f.roof[cells + i] > f.ground[cells + i];
          const drawn = (i: number) => showsWater(
            f.nx, f.ny, i, f.ground, f.depth, dry, FALL_MIN, cells, f.roof,
          );
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
        window.__deckBodies = () => {
          const f = useWorldStore.getState().getWaterField();
          const wl = gpuRef.current;
          if (!f) return { ok: false, why: "no water field" };
          const c = f.columns, cells = c.cells;
          let deck = 0, wet = 0, labelled = 0, noBody = 0, held = 0;
          for (let i = 0; i < cells; i++) {
            for (let a = 1; a < c.layers; a++) {
              const ia = a * cells + i;
              if (!(c.roof[ia] > c.ground[ia])) continue;
              deck++;
              held += c.depth[ia];
              if (c.depth[ia] <= c.params.dryDepth) continue;
              wet++;
              if (!wl) continue;
              if (wl.bodies.at[ia] === NO_BODY) noBody++; else labelled++;
            }
          }
          const last = solverRef.current?.last();
          return {
            deckColumns: deck, wetInHostCopy: wet,
            heldInHostCopy: +held.toFixed(2),
            labelled, noBody,
            solver: solverRef.current ? "device" : "host",
            // What the DEVICE says the whole map holds, for contrast: a host
            // copy at nought with this in the thousands is the readback, not
            // the solver. @see GpuFrame.deviceWater
            deviceWater: last ? +last.deviceWater.toFixed(1) : null,
            ok: noBody === 0,
            why: noBody > 0
              ? `${noBody} wet deck columns have no sheet id: they draw as nothing`
              : null,
          };
        };
        // AND WHETHER THE WATER ON A BRIDGE REACHES THE SCREEN AT ALL, which
        // the comparison above cannot answer: it renders the two water
        // builders against each other and nothing else, so a ROAD painted over
        // both of them is invisible to it. @see checkWaterOverPaving
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
          bridged: boolean | "dry" | "road" = false,
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
              device, frames, bridged === "dry" ? spannedDry : spanned,
              undefined, bridged === "dry" ? undefined : SPRAY_BOUNDS,
            );
          }
          return sprayScene
            ? compareFrames(device, frames, spray, undefined, SPRAY_BOUNDS)
            : compareFrames(device, frames);
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
          settle = 30, through = "limit", solo = true, dry = false,
        ) => {
          const device = (app.renderer as unknown as { gpu?: { device: GPUDevice } })
            .gpu?.device;
          if (!device) return { ok: false, why: "no WebGPU device" };
          return compareAccelerate(
            device, settle, dry ? spannedDry : spanned,
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
        holdDevice((app.renderer as unknown as { gpu?: { device: GPUDevice } })
          .gpu?.device ?? null);
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
        window.__waterBench = async (n = 200, sync = false) => {
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
          const build = () => (cpu
            ? drawWater(cpu, field.columns, scene.bl!, 1 / 60)
            : drawGpuWater(gpu!, field.columns, scene.bl!, 1 / 60, true, onDevice));
          const device = (renderer as unknown as { gpu?: { device: GPUDevice } }).gpu?.device;
          // THE STAMPS GO ROUND TOO. They are resolved at the end of the
          // ticker's frame, and the bench does not use the ticker — so without
          // this a bench fills the query set, stops timing at the cap, and
          // reports whatever the live path last left behind. @see flushStamps
          const frame = () => {
            renderer.render({ container: stage });
            flushStamps(
              (renderer as unknown as { gpu?: { device: GPUDevice } })
                .gpu?.device ?? null,
              true,
            );
          };
          // THE SOLVER THE TICK WOULD USE, not `stepWater` unconditionally —
          // which is what this used to do, so in GPU mode it benched the CPU
          // solver and reported the number as the device's. A bench that
          // measures the path you are not running is worse than none.
          const step = () => {
            const s = solverRef.current;
            if (!s) { stepWater(field, 1 / 60); return; }
            s.sync(field.columns);
            s.step(field.columns, 1 / 60);
            // AND THE READOUT GETS FED, exactly as the tick feeds it — so the
            // leak alarm is armed while the bench is driving, which is the one
            // way to exercise it with the tab in the background.
            gpuWaterSaw(s.last());
          };
          for (let i = 0; i < 30; i++) { step(); build(); frame(); }
          if (device) await device.queue.onSubmittedWorkDone();

          let solve = 0, draw = 0, submit = 0;
          const t0 = performance.now();
          for (let i = 0; i < n; i++) {
            const a = performance.now(); step();
            const b = performance.now(); build();
            const c = performance.now(); frame();
            const d = performance.now();
            solve += b - a; draw += c - b; submit += d - c;
            if (sync && device) await device.queue.onSubmittedWorkDone();
          }
          if (device) await device.queue.onSubmittedWorkDone();
          const wall = performance.now() - t0;
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
            ...(solverRef.current ? { last: solverRef.current.last() } : {}),
          };
        };
      }

      // Ghosts need the bands (true depth), the outline needs the overlay
      // (above everything) — see edit/cursor.
      if (overlayRoot.current) {
        cursorRef.current = createBuildCursor(overlayRoot.current, bl);
      }
      setSceneEpoch((n) => n + 1);

      console.info(`WORLD: ${grid.w}×${grid.h}, ${bl.bands.length} bands`);
    });

    return () => {
      cancelled = true;
      cursorRef.current?.destroy();
      cursorRef.current = null;
      if (flRef.current) destroyWaterLayer(flRef.current);
      if (gpuRef.current) destroyGpuWaterLayer(gpuRef.current);
      if (faRef.current) destroyFallLayer(faRef.current);
      if (drRef.current) destroyGpuDripLayer(drRef.current);
      if (slRef.current) clearStructureLayer(slRef.current);
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
  }, [grid, scale]);

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
  const originGfx = useRef<Graphics | null>(null);
  const hoverGfx = useRef<Graphics | null>(null);
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
    const refs = [bandGfx, tintGfx, netGfx, maskGfx, gapGfx, gridGfx, originGfx, hoverGfx, crossGfx];
    const made = refs.map((r, i) => {
      const g = new Graphics();
      g.zIndex = i;              // stripes, tint, net, mask, grid, origin, hover, crosshair
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

    const onMove = (e: FederatedPointerEvent) => {
      const p = vp.toWorld(e.global.x, e.global.y);
      repick(p.x, p.y);
    };
    const onLeave = () => {
      const st = useWorldStore.getState();
      st.setHover(null);
      st.setPointer(null);
      st.cancelStroke();
    };

    // Left button paints. pixi-viewport keeps left-drag pan, so a paint drag
    // and a camera drag would fight — the paint tools therefore take the left
    // button and panning stays on middle/right while a tool is active.
    const onDown = (e: FederatedPointerEvent) => {
      if (e.button !== 0) return;
      const st = useWorldStore.getState();
      if (st.tool === "inspect") return;
      const cell = cellAt(e);
      if (!cell) return;                       // pressed off the map
      st.setHover(cell);
      st.beginStroke(cell);
    };
    const onUp = () => {
      const st = useWorldStore.getState();
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
  }, [viewportForPick]);

  // Hover highlight follows the store, redrawn only when the cell changes.
  const hover = useWorldStore((s) => s.hover);
  useEffect(() => {
    if (hoverGfx.current) drawHover(hoverGfx.current, grid, hover, scale);
  }, [hover, grid, scale]);

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
    // DRAINED, not read from state: several commits in one React batch collapse
    // into a single re-render, and reading `lastTouched` would show only the
    // last one's cells while the rest stayed in the grid and off the screen.
    const touched = drainDirty(grid);
    if (!touched.length) return;
    for (const c of touched) {
      syncCell(tl, bl, grid, tex, c.x, c.y);
      // A column belongs to the taller cell but EXISTS because of the shorter
      // one, so a height edit re-syncs the neighbours that now look onto it —
      // the store already widened `lastTouched` to include them.
      syncCliff(cl, bl, grid, tex, c.x, c.y);
    }
    // A road's tile depends on its EIGHT neighbours, so the paved dirty set is
    // wider than the edited set — and it is wider for a height edit too, since
    // height decides whether two paved cells are joined at all.
    const pavedDirty = new Set<number>();
    for (const c of touched) {
      for (const n of maskDirtyCells(grid, c.x, c.y)) pavedDirty.add(n.y * grid.w + n.x);
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
    syncStructures(sl, ctx);
    refreshStructuresAt(sl, ctx, touched);

    // an edit can change the height range, so overlays may need redrawing
    redrawOverlays();
  }, [revision, grid, scale, redrawOverlays]);

  // Painting takes the left button, so panning moves to middle/right while a
  // paint tool is active — otherwise a paint drag and a camera drag collide.
  const tool = useWorldStore((s) => s.tool);
  useEffect(() => {
    if (!viewport) return;
    setPanButtons(viewport, tool === "inspect" ? "left-middle" : "middle-right");
  }, [viewport, tool]);

  // ── build cursor ────────────────────────────────────────────────────────
  // One path for hover AND drag: the tool only supplies cells, so the brush
  // footprint you see before pressing is the same shape that commits, drawn by
  // the same code. Per-cell validity, so a partly blocked footprint says which
  // cells are the problem rather than just refusing as a whole.
  const stroke = useWorldStore((s) => s.stroke);
  const brushRadius = useWorldStore((s) => s.brushRadius);
  const hoverForBrush = useWorldStore((s) => s.hover);
  const material = useWorldStore((s) => s.material);
  const structureDefId = useWorldStore((s) => s.structureDefId);
  // `palette` and `revision` are already selected above, for the terrain
  // layer's copy and the per-cell reconcile respectively.

  useEffect(() => {
    const cur = cursorRef.current, tex = texRef.current;
    if (!cur || !tex) return;

    // A live drag takes over; otherwise the hover stands in as a one-cell
    // anchor so the brush size is visible before pressing rather than
    // discovered after.
    const s0: Stroke | null = stroke ?? (
      hoverForBrush && tool !== "inspect"
        ? { tool, brush: "point", anchor: hoverForBrush, head: hoverForBrush }
        : null
    );
    if (!s0) { cur.clear(); return; }

    // A STRUCTURE tool previews its footprint, not a brush: the same function
    // the commit uses, so the rect you drag out is the rect you get.
    const cells = isStructureTool(s0.tool)
      ? (() => {
          const fp = structureFootprint(structureDef(structureDefId), s0.anchor, s0.head);
          return footprintCells(fp.x, fp.y, fp.w, fp.h);
        })()
      : strokeFootprint(grid, s0, brushRadius);

    cur.update(grid, {
      cells,
      // Only a material tool places a tile, so only it gets a ghost. Erase and
      // the height tools show the outline alone — ghosting a material they
      // never write would claim the wrong thing about what the click does.
      frame: s0.tool === "paintTerrain" ? (palette[material] ?? null) : null,
      tool: s0.tool,
      scale,
    }, tex);
  }, [
    stroke, hoverForBrush, brushRadius, tool, material, palette, structureDefId,
    grid, scale, revision, sceneEpoch,
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
    // It is still read for the SHEETS below, which are one storey yet.
    const storeyed = field ? field.columns.layers > 1 : false;
    // SAY SO ON THE READOUT. A badge that reports the switch rather than the
    // path claims the device is running whenever anything declines to build
    // a solver. @see gpuWaterWhy
    gpuWaterHeldBack(
      !gpuWater ? null
        : !device || deviceLost() !== null ? "no device"
          : null,
    );
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
    solverRef.current = createGpuWater(
      device, field.columns,
      layer
        ? { seed: layer.wash.seed, now: layer.wash.now, foam: layer.foam.now }
        : undefined,
      // AND THE SURFACE'S TEXTURES, for the device to fill directly. Empty on
      // any renderer or map shape that cannot take the copy, in which case the
      // layer goes on uploading them. @see deviceSinks
      layer && rendererRef.current
        ? deviceSinks(layer, rendererRef.current, field.columns.nx)
        : [],
    );
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
      // THE DEVICE'S SHEETS ARE STILL ONE STOREY. Everything else in the
      // solver walks slot pairs now; the sheet builder decodes a fall's edge
      // the old way, so on a map with bridges the HOST draws the falls — it
      // is plane-aware and costs a few hundred quads. @see drawFalls
      if (bl && sr && !storeyed && rend?.buffer && rend?.texture) {
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

  // Animated structures — the fluid in an excavation. Costs one Map walk per
  // frame when nothing on the map animates, because a renderer that declares no
  // `tick` is skipped outright.
  useTick((ticker) => {
    const sl = slRef.current, bl = blRef.current, tex = texRef.current;
    const fl = flRef.current;
    const raw = ((ticker as unknown as { deltaMS?: number }).deltaMS ?? 16.7) / 1000;
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
    const dt = field ? Math.min(raw, maxStep(field.columns)) : raw;
    const gpu = gpuRef.current;
    if (bl && field && (fl || gpu)) {
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
      }
      solverRef.current?.sync(field.columns);
      runSources(field, grid, dt);
      runPipes(field, grid, dt);
      // THE SWITCH. With the solver built, the frame's water is the device's
      // and the CPU solver does not run at all — see `gpu/solver`, and the
      // note there about the round trip this still pays for.
      const solver = solverRef.current;
      // ONE FIELD, WHOEVER STEPS IT. A bridge is slots in the same columns
      // rather than a storey of its own, so there is no second thing here
      // for the device path to forget about. @see syncSlots
      if (solver) {
        solver.step(field.columns, dt);
        gpuWaterSaw(solver.last());
      }
      else stepWater(field, dt);
      const t1 = performance.now();
      // THE QUADS THIS FRAME IS WORTH DRAWING, gathered before the mesh is
      // told how many to draw. On the device's own path that is after the
      // solver has filled the textures it reads; on the host's it is a frame
      // behind them, which `roomFor` has the headroom for. @see gatherQuads
      const dev = heldDevice();
      if (gpu?.gather && dev) {
        gatherQuads(gpu.gather, dev, field.columns, grid.w, grid.h, overlays.faces);
      }
      if (fl) drawWater(fl, field.columns, bl, dt, overlays.faces);
      else if (gpu) {
        drawGpuWater(gpu, field.columns, bl, dt, overlays.faces, solver !== null);
      }
      // The foam FIELD, not the solver's raw breaking: the surface is painted
      // from this, so the sheet has to be too or a white lip goes over a
      // cliff and turns blue in the air.
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
          solverRef.current?.sheetScale(scale);
          drawGpuFalls(gfRef.current, solverRef.current?.sheetCounts() ?? null);
        } else {
          drawFalls(faRef.current, field.columns, box, white, drift);
        }
      }
      if (drRef.current) drawGpuDrips(drRef.current, field, bl, grid, overlays.xray);
      const t2 = performance.now();
      perfAdd("solve", t1 - t0);
      perfAdd("build", t2 - t1);
      if (import.meta.env.DEV) {
        const w = (window as unknown as { __waterMs?: { solve: number; draw: number; n: number } });
        const acc = w.__waterMs ?? (w.__waterMs = { solve: 0, draw: 0, n: 0 });
        acc.solve += t1 - t0; acc.draw += t2 - t1; acc.n++;
      }
      // THE DEVICE'S OWN TALLY when it is the one holding the water, and the
      // walk over the columns when it is not. @see createMeta
      const tally = solverRef.current?.last().reduce ?? null;
      useWorldStore.getState().refreshWaterMeta(
        tally ? { wet: tally.wet, water: tally.water } : undefined,
      );
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
    renderer.render = (...a: unknown[]) => {
      const at = performance.now();
      const out = real(...a);
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
    const done = () => { flushStamps(device); perfFrame(); };
    app.ticker.add(done, null, UPDATE_PRIORITY.LOW - 1);
    return () => {
      renderer.render = real as typeof renderer.render;
      if (encoder && realBegin) encoder.beginRenderPass = realBegin;
      app.ticker.remove(done, null);
    };
  }, [app]);

  // Cull to the visible band range each frame. Cheap: one comparison per band,
  // and setVisibleBands early-returns when the range has not moved.
  useTick(() => {
    const bl = blRef.current;
    const vp = useWorldStore.getState().viewport;
    if (!bl || !vp) return;
    const { lo, hi } = visibleBandRange(grid, scale, vp.top, vp.bottom);
    setVisibleBands(bl, lo, hi);
    if (lo !== bandRange.current.lo || hi !== bandRange.current.hi) {
      bandRange.current = { lo, hi };
      redrawOverlays();                    // overlays follow the visible range
    }
    const n = visibleBandCount(bl);
    if (n !== useWorldStore.getState().drawnBands) {
      useWorldStore.getState().setDrawnBands(n);
    }
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
