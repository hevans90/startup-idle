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
  createGpuWaterLayer, destroyGpuWaterLayer, drawGpuWater, waterOnGpu,
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
import { pickCell, worldToCellF } from "./iso";
import { runSources, stepWater } from "./water/field";
import { runPipes } from "./water/pipes";
import { createGpuDripLayer, destroyGpuDripLayer, drawGpuDrips, type GpuDripLayer } from "./render/drips-gpu";
import {
  createFallLayer, destroyFallLayer, drawFalls, type FallLayer,
} from "./render/falls-render";
import { activeBox } from "../fluid/columns";

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
        window.__waterGpu = gpuRef.current;
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
        const scene = { water, bl, grid };
        const renderer = app.renderer, stage = app.stage;
        window.__waterBench = async (n = 200, sync = false) => {
          const field = useWorldStore.getState().getWaterField();
          const cpu = flRef.current, gpu = gpuRef.current;
          if (!field || !scene.bl || (!cpu && !gpu)) return null;
          const build = () => (cpu
            ? drawWater(cpu, field, scene.bl!, 1 / 60)
            : drawGpuWater(gpu!, field, scene.bl!, 1 / 60));
          const device = (renderer as unknown as { gpu?: { device: GPUDevice } }).gpu?.device;
          const frame = () => renderer.render({ container: stage });
          for (let i = 0; i < 30; i++) { stepWater(field, 1 / 60); build(); frame(); }
          if (device) await device.queue.onSubmittedWorkDone();

          let solve = 0, draw = 0, submit = 0;
          const t0 = performance.now();
          for (let i = 0; i < n; i++) {
            const a = performance.now(); stepWater(field, 1 / 60);
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
            path: cpu ? "cpu" : "gpu", frames: n, sync,
            solve: per(solve), build: per(draw), submit: per(submit), wall: per(wall),
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
  const pointer = useWorldStore((s) => s.pointer);
  useEffect(() => {
    const p = useWorldStore.getState().pointer;
    if (p && repickRef.current) repickRef.current(p.wx, p.wy);
  }, [pickNudge]);

  useEffect(() => {
    if (crossGfx.current) drawPickCrosshair(crossGfx.current, pointer, hover, grid, scale);
  }, [pointer, hover, grid, scale]);

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

  // Animated structures — the fluid in an excavation. Costs one Map walk per
  // frame when nothing on the map animates, because a renderer that declares no
  // `tick` is skipped outright.
  useTick((ticker) => {
    const sl = slRef.current, bl = blRef.current, tex = texRef.current;
    const fl = flRef.current;
    const dt = ((ticker as unknown as { deltaMS?: number }).deltaMS ?? 16.7) / 1000;
    // The water runs every frame, and the mesh is rebuilt from it every frame:
    // the surface changes everywhere at once, so there is no incremental
    // version of drawing it.
    const field = useWorldStore.getState().getWaterField();
    const gpu = gpuRef.current;
    if (bl && field && (fl || gpu)) {
      runSources(field, grid, dt);
      runPipes(field, grid, dt);
      const t0 = performance.now();
      stepWater(field, dt);
      const t1 = performance.now();
      if (fl) drawWater(fl, field, bl, dt, overlays.faces);
      else if (gpu) drawGpuWater(gpu, field, bl, dt, overlays.faces);
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
        drawFalls(faRef.current, field.columns, box, white, drift);
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
      useWorldStore.getState().refreshWaterMeta();
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
    // Closing the frame off goes after everything, so every slot is filled.
    const done = () => perfFrame();
    app.ticker.add(done, null, UPDATE_PRIORITY.LOW - 1);
    return () => {
      renderer.render = real as typeof renderer.render;
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
