/**
 * A PERFORMANCE SCENE THAT HOLDS STILL, for `window.__perfScene()` in dev.
 *
 * Every measurement of a big map before this was undermined by something that
 * was not the thing being measured, and each of them read as a finding:
 *
 *   - a backgrounded pane is a 0×0 window, so the viewport culled every band
 *     but a few and the "terrain" looked free, then expensive, then free;
 *   - the viewport's screen size is a React prop, re-applied on any render, so
 *     a size set by hand came undone mid-run;
 *   - a flood poured on a map with open edges drained off it while it was
 *     being timed, so the second half of an A/B timed a different scene;
 *   - and a layer hidden with `visible` was shown again by the band hold.
 *
 * So the scene builds its own map, closes its edges and turns off what feeds
 * it, PINS its view — size,
 * zoom and centre re-applied before every frame the bench drives — and hides
 * layers with `visible`, telling the band hold to leave them hidden. Not with
 * `renderable`, which was tried: it is not structural, so hiding took and
 * showing again did not, and every configuration after the first one to hide
 * the surface timed a map with no water on it. Then it measures each
 * configuration interleaved and repeated, so a slow drift in the scene shows
 * up as a spread rather than as a difference between configurations.
 *
 * It REPLACES THE WORLD IN MEMORY, so it refuses to run without `?nosave`:
 * autosave would write the scratch map over the one in the save slot.
 */
import type { Renderer } from "pixi.js";
import type { Viewport } from "pixi-viewport";

/** A view to hold every bench frame at. @see pinView */
export type PinnedView = { w: number; h: number; zoom: number; x: number; y: number };

let pinned: PinnedView | null = null;

/** Hold the bench's frames at this view until {@link unpinView}. */
export const pinView = (v: PinnedView) => { pinned = v; };
export const unpinView = () => { pinned = null; };

/**
 * Put the renderer and the viewport back where the pin says, if there is one.
 * Called by the bench before every frame it draws. Cheap when nothing moved.
 */
export function applyPinned(renderer: Renderer, vp: Viewport | null) {
  if (!pinned) return;
  if (renderer.width !== pinned.w || renderer.height !== pinned.h) {
    renderer.resize(pinned.w, pinned.h);
  }
  if (!vp) return;
  if (vp.screenWidth !== pinned.w || vp.screenHeight !== pinned.h) {
    vp.resize(pinned.w, pinned.h);
  }
  if (vp.scale.x !== pinned.zoom) vp.setZoom(pinned.zoom, true);
  if (vp.center.x !== pinned.x || vp.center.y !== pinned.y) vp.moveCenter(pinned.x, pinned.y);
}

/** What one configuration cost, averaged over its frames. */
export type PerfRow = {
  config: string;
  /** GPU milliseconds of the render pass, and of everything else (compute). */
  render: number;
  compute: number;
  /** Host milliseconds: the solver's half, the mesh's half, the render call. */
  solve: number;
  build: number;
  submit: number;
  /** Water quads drawn, and the readback the solver did. */
  quads: number;
  readMs: number;
  readMb: number;
  /** GPU milliseconds per timed pass, render included. */
  passes: Record<string, number>;
  /** How many frames the GPU means are of. Fewer than half the frames run is a thin sample. */
  samples: number;
};

export type PerfReport = {
  ok: boolean;
  why: string | null;
  size: number;
  fixture: string;
  view: PinnedView;
  /** Wet columns and water held when measuring started and when it ended. */
  wetFrom: number;
  wetTo: number;
  waterFrom: number;
  waterTo: number;
  /** Each configuration's runs, interleaved, then their mean. */
  runs: PerfRow[];
  mean: Record<string, PerfRow>;
};

/** What the scene needs from the editor, handed in rather than imported. */
export type PerfDeps = {
  renderer: Renderer;
  store: () => {
    grid: { w: number; h: number };
    viewport: Viewport | null;
    openEdge: boolean;
    resize: (w: number, h: number) => void;
    applyFixture: (id: never) => void;
    setOpenEdge: (open: boolean) => void;
    getWaterField: () => { columns: { layers: number } } | null;
  };
  bench: (n: number, sync: boolean) => Promise<Record<string, unknown> | null>;
  /** Leave these solver passes out. @see setSkip */
  skip: (names: string[]) => void;
  gpuTime: () => { of: Record<string, number>; total: number; frames: number } | null;
  /** Forget the GPU frames timed so far. @see Stamps.reset */
  resetGpu: () => void;
  /** Cap every water mesh's instances; Infinity for none. @see setInstanceCap */
  capWater: (n: number) => void;
  pour: (x: number, y: number, depth: number) => void;
  /**
   * Hide exactly these water layers and show the rest: "surface", "sheets",
   * "drops". With `visible`, which is structural and so rebuilds what the
   * renderer draws, and which the band hold is told to leave alone.
   */
  setHidden: (names: string[]) => void;
  /** Whether the scene is built for the field there is now. */
  ready: () => boolean;
  /** Turn off every spring, drain and off-map inflow on the map. */
  still: () => void;
};

export type PerfOptions = {
  size?: number;
  fixture?: string;
  /** Half steps poured on every tile inside an eight tile margin; 0 is dry. */
  flood?: number;
  /** Frames run after the flood before anything is timed. */
  settle?: number;
  /** Frames timed per configuration per round, and how many rounds. */
  frames?: number;
  rounds?: number;
  w?: number;
  h?: number;
  /** "fit" for the whole map in the window, or a viewport zoom. */
  zoom?: "fit" | number;
  /** Solver passes to leave out for the whole run. @see setSkip */
  skip?: string[];
  /** Measure the scene already built — no resize, no fixture, no flood. */
  reuse?: boolean;
  /**
   * Configurations to time in place of the usual five. Each hides `hide`, caps
   * every water mesh at `cap` instances — one keeps the draws and drops the
   * work — and renders at `resolution`.
   */
  configs?: PerfConfig[];
};

export type PerfConfig = { name: string; hide?: string[]; cap?: number; resolution?: number };

/** The configurations, each a set of water layers HIDDEN for it. */
const CONFIGS: Record<string, string[]> = {
  all: [],
  "-surface": ["surface"],
  "-sheets": ["sheets"],
  "-drops": ["drops"],
  ground: ["surface", "sheets", "drops"],
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function until(ok: () => boolean, ms: number): Promise<boolean> {
  const end = performance.now() + ms;
  while (performance.now() < end) {
    if (ok()) return true;
    await sleep(100);
  }
  return ok();
}

export async function runPerfScene(
  deps: PerfDeps, opts: PerfOptions, progress: (stage: string) => void,
): Promise<PerfReport> {
  const {
    size = 204, fixture = "bridge", flood = 30, settle = 240,
    frames = 10, rounds = 2, w = 800, h = 600, zoom = "fit", skip = [], reuse = false,
  } = opts;
  const configs: PerfConfig[] = opts.configs
    ?? Object.entries(CONFIGS).map(([name, hide]) => ({ name, hide }));
  const st = deps.store;
  const empty = (why: string, view: PinnedView): PerfReport => ({
    ok: false, why, size, fixture, view, wetFrom: 0, wetTo: 0, waterFrom: 0, waterTo: 0,
    runs: [], mean: {},
  });
  // A HEIGHT'S WORTH OF MAP, as the band math lays it out: the map is a
  // diamond (w + h) half-widths across and (w + h) half-heights down.
  const span = { x: (size + size) * 66, y: (size + size) * 33 };
  const fit = Math.min(w / span.x, h / span.y) * 0.94;
  const view: PinnedView = {
    w, h, zoom: zoom === "fit" ? fit : zoom, x: 0, y: span.y / 2,
  };
  if (typeof location !== "undefined" && !new URLSearchParams(location.search).has("nosave")) {
    return empty("open the editor with ?nosave: this replaces the world in memory", view);
  }

  const wasOpen = st().openEdge;
  const wasResolution = deps.renderer.resolution;
  pinView(view);
  try {
    if (reuse) {
      if (st().grid.w !== size) return empty(`the scene built is ${st().grid.w} tiles, not ${size}`, view);
    } else {
      progress("building");
      st().setOpenEdge(false);
      if (st().grid.w !== size || st().grid.h !== size) st().resize(size, size);
      st().applyFixture(fixture as never);
      if (!await until(() => st().grid.w === size && deps.ready(), 60_000)) {
        return empty("the scene was not rebuilt within a minute", view);
      }
      // And once more, after the field has grown any storeys the fixture
      // needed: the first deck replaces it, and the scene rebuilds again.
      await sleep(500);
      if (!await until(() => deps.ready(), 60_000)) {
        return empty("the scene was not rebuilt for the fixture's field", view);
      }

      // AND NOTHING FED. With the edges closed, a fixture's springs and the
      // river it is fed at the rim have nowhere to go: the first version of
      // this left them on, and the map filled for as long as anyone measured
      // it — sixty deep where it was poured thirty, until the water tally
      // overflowed. @see DEPTH_LANES
      deps.still();
      if (flood > 0) {
        progress("flooding");
        for (let y = 8; y < size - 8; y++) {
          for (let x = 8; x < size - 8; x++) deps.pour(x, y, flood);
        }
      }
      progress("settling");
      await deps.bench(settle, false);
    }

    const hide = deps.setHidden;
    deps.skip(skip);
    const first = await deps.bench(1, true);
    const last0 = (first?.last ?? {}) as { reduce?: { wet?: number; water?: number } };
    const runs: PerfRow[] = [];
    for (let r = 0; r < rounds; r++) {
      for (const { name: config, hide: hidden = [], cap = Infinity, resolution } of configs) {
        progress(`round ${r + 1}/${rounds}: ${config}`);
        hide(hidden);
        deps.capWater(cap);
        if (resolution && deps.renderer.resolution !== resolution) {
          deps.renderer.resolution = resolution;
          deps.renderer.resize(view.w, view.h);
        }
        // WARMED UP before it is timed: a layer shown or hidden rebuilds what
        // the renderer draws, and that one frame's cost belongs to the switch
        // and not to the configuration. Then the stamps turn over.
        await deps.bench(4, true);
        // AND THE GPU'S MEANS FORGOTTEN, twice, two frames apart: they are a
        // window of the last twenty frames timed, longer than a configuration
        // runs, so read straight off they blended this one with the ones
        // before it — rows that could not be added up, a surface that cost
        // nothing. The second reset catches a readback that was in flight.
        deps.resetGpu();
        await deps.bench(2, true);
        deps.resetGpu();
        const b = await deps.bench(frames, true);
        await sleep(300);
        const t = deps.gpuTime();
        const of = t?.of ?? {};
        let compute = 0;
        for (const [k, v] of Object.entries(of)) if (k !== "render") compute += v;
        const last = (b?.last ?? {}) as { readMs?: number; readMb?: number };
        runs.push({
          config,
          render: of.render ?? 0,
          compute,
          solve: Number(b?.solve ?? 0),
          build: Number(b?.build ?? 0),
          submit: Number(b?.submit ?? 0),
          quads: Number(b?.quads ?? 0),
          readMs: last.readMs ?? 0,
          readMb: last.readMb ?? 0,
          passes: { ...of },
          samples: t?.frames ?? 0,
        });
      }
    }
    hide([]);
    const end = await deps.bench(1, true);
    const last1 = (end?.last ?? {}) as { reduce?: { wet?: number; water?: number } };

    const mean: Record<string, PerfRow> = {};
    for (const config of [...new Set(configs.map((c) => c.name))]) {
      const mine = runs.filter((x) => x.config === config);
      const avg = (k: keyof PerfRow) =>
        Math.round((mine.reduce((a, x) => a + (x[k] as number), 0) / mine.length) * 100) / 100;
      const passes: Record<string, number> = {};
      for (const x of mine) {
        for (const [k, v] of Object.entries(x.passes)) passes[k] = (passes[k] ?? 0) + v / mine.length;
      }
      for (const k of Object.keys(passes)) passes[k] = Math.round(passes[k] * 100) / 100;
      mean[config] = {
        config, render: avg("render"), compute: avg("compute"), solve: avg("solve"),
        build: avg("build"), submit: avg("submit"), quads: avg("quads"),
        readMs: avg("readMs"), readMb: avg("readMb"), passes, samples: avg("samples"),
      };
    }
    return {
      ok: true, why: null, size, fixture, view,
      wetFrom: last0.reduce?.wet ?? 0, wetTo: last1.reduce?.wet ?? 0,
      waterFrom: Math.round(last0.reduce?.water ?? 0),
      waterTo: Math.round(last1.reduce?.water ?? 0),
      runs, mean,
    };
  } finally {
    deps.setHidden([]);
    deps.skip([]);
    deps.capWater(Infinity);
    if (deps.renderer.resolution !== wasResolution) {
      deps.renderer.resolution = wasResolution;
      deps.renderer.resize(view.w, view.h);
    }
    unpinView();
    st().setOpenEdge(wasOpen);
    progress("done");
  }
}
