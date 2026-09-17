/**
 * World v2 — the Pixi scene.
 *
 * Imperative by design: bands and per-cell sprite handles are built and
 * reconciled directly, with React only mounting the container. Same pattern as
 * v1's `GroundRoadLayer`, but the state it draws from is mutable.
 */
import { extend, useApplication, useTick } from "@pixi/react";
import {
  Container, Graphics, UPDATE_PRIORITY, type FederatedPointerEvent,
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
import { compareWaterPaths } from "./debug/water-compare";
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
import { HEIGHT_UNIT, HH, HW, pickCell, worldToCellF } from "./iso";
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
import { gpuWaterSaw } from "./debug/gpu-water-stat";
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
  scene as accelScene, spray,
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
      const onGpu = waterOnGpu();
      rendererRef.current = app?.renderer ?? null;
      const fl = water && !onGpu ? createWaterLayer(water, bl, scale) : null;
      gpuRef.current = water && onGpu ? createGpuWaterLayer(water, bl, scale) : null;
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
        window.__frameCompare = async (frames = 60, sprayScene = false) => {
          const device = (app.renderer as unknown as { gpu?: { device: GPUDevice } })
            .gpu?.device;
          if (!device) return { ok: false, why: "no WebGPU device" };
          // THE SPRAY SCENE CARRIES AN ACCEPTED DIVERGENCE and its own bounds
          // say so, rather than every scene being loosened to let it pass.
          // @see SPRAY_BOUNDS
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
          settle = 90, sprayScene = false, fresh = false,
        ) => {
          const device = (app.renderer as unknown as { gpu?: { device: GPUDevice } })
            .gpu?.device;
          if (!device) return { ok: false, why: "no WebGPU device" };
          return compareCliffs(
            device, settle, sprayScene ? spray : undefined, fresh,
          );
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
            ? drawWater(cpu, field, scene.bl!, 1 / 60)
            : drawGpuWater(gpu!, field, scene.bl!, 1 / 60, true, onDevice));
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
    if (!gpuWater || !field || !device || deviceLost() !== null) {
      solverRef.current?.destroy();
      solverRef.current = null;
      gpuWaterSaw(null);
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
      if (solver) {
        solver.step(field.columns, dt);
        gpuWaterSaw(solver.last());
      }
      else stepWater(field, dt);
      const t1 = performance.now();
      // THE QUADS THIS FRAME IS WORTH DRAWING, gathered before the mesh is
      // told how many to draw and after the solver has filled the textures it
      // reads. @see gatherQuads
      const dev = heldDevice();
      if (gpu?.gather && solver && dev) {
        gatherQuads(gpu.gather, dev, field.columns, grid.w, grid.h, overlays.faces);
      }
      if (fl) drawWater(fl, field, bl, dt, overlays.faces);
      else if (gpu) {
        drawGpuWater(gpu, field, bl, dt, overlays.faces, solver !== null);
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
    const es = renderer as unknown as {
      encoder?: {
        beginRenderPass: (t: { descriptor: GPURenderPassDescriptor }) => void;
      };
    };
    const encoder = es.encoder;
    const realBegin = encoder?.beginRenderPass.bind(encoder);
    const device = (renderer as unknown as { gpu?: { device: GPUDevice } })
      .gpu?.device ?? null;
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
