/**
 * World v2 — does the vertex shader draw the same water as the mesh builder?
 *
 * The shader is the path that ships and the mesh builder is the one the render
 * tests hold to account, which is the wrong way round unless something ties
 * the two together. The shared rules in `render/corner-rule.ts` tie the
 * DECISIONS together; this ties the pictures together.
 *
 * A READBACK: build one scene, draw it twice into two render textures — once
 * with each path and nothing else in the frame — read both back with the
 * renderer's own extract, and compare them pixel for pixel. It is the only
 * check that covers the arithmetic which can only live in a shader: the
 * projection, the shading, the geometry of a fall.
 *
 * It cannot run under `bun test`, which has no GPU at all, so it is a harness
 * rather than a test — `window.__waterCompare()` in dev, on whichever renderer
 * the page asked for. What a test runner would add is the running of it, not
 * the substance.
 *
 * WHY THE TWO ARE ALLOWED TO DIFFER AT ALL. The builder computes in doubles
 * and the shader in floats, and a corner half a millimetre apart in world
 * space lands a fraction of a pixel apart on screen, where it shows as an edge
 * pixel blended slightly differently. So the measure is not "identical" — it
 * is how MANY pixels differ and by how much.
 *
 * WHAT IT READS WHEN IT IS RIGHT, so that a future reader knows what normal
 * looks like: of 36,434 pixels either path draws, the worst single channel
 * anywhere disagrees by 5 out of 255, the mean by 0.45, and at the default
 * tolerance nothing differs at all. Neither path draws a pixel the other
 * leaves empty. The same on both renderers, to the pixel.
 *
 * THE TOLERANCE IS 5 AND WAS 4, and the extra step is the bridge. Exactly one
 * pixel of the scene reads 5, deterministically, every run: the corner where
 * a deck meets the air carries two surfaces tens of half steps apart, and the
 * two paths round that vertex to different sides of a pixel boundary. It is
 * the same float-precision class the paragraph above describes, one step
 * further along, and it is nowhere near the faults this catches — the corner
 * merge read 248, the bridge faults below read 255.
 *
 * AND WHAT IT READS WHEN IT IS WRONG, because a comparison that cannot fail is
 * worth nothing. Put back the bug this was all downstream of — the corner
 * merge present in the builder and missing from the shader, which is exactly
 * how it shipped — and it reads 1,652 pixels differing, 5% of what was drawn,
 * the worst by 248 out of 255, with pixels on each side the other never drew.
 *
 * THE SCENE HAS A BRIDGE ON IT, and it did not until the day the two paths
 * disagreed about one. A deck makes a column a stack of slots, so every
 * per-slot field the shader reads is a plane deeper and every corner it
 * gathers has a storey it has to look at — and none of that was covered here.
 * Adding it caught two faults at once, both worth 255: the shader drew the
 * water under a span at floor plus depth rather than stopping it at the
 * soffit, and it drew that water in the tier ABOVE the paving, which paints a
 * flooded channel across the front of its own bridge. 6,681 pixels differing,
 * 3,512 of them drawn by the shader alone.
 */
import { Container, RenderTexture, type Renderer, type Texture } from "pixi.js";

import { createGrid, fillTerrain, setDeck, setHeight, type Grid } from "../grid";
import { buildRoadTable } from "../roads/table";
import { createTerrainLayer, buildTerrain } from "../render/terrain";
import { createCliffLayer, buildCliffs } from "../render/cliffs";
import { buildPaved, createPavedLayer } from "../render/paved";
import { copyWater, crossingScene, wetTheDecks } from "./world-scenes";
import { COLUMNS_PER_TILE } from "../water/field";
import type { Palette } from "../palette";
import { createWaterField, pourAt, setWaterEdge, stepWater } from "../water/field";
import { HEIGHT_UNIT, HH, HW } from "../iso";
import { createBandLayer } from "../render/bands";
import { createWaterLayer, destroyWaterLayer, drawWater } from "../render/water";
import { activeBox, type ColumnField } from "../../fluid/columns";
import {
  createFallLayer, destroyFallLayer, drawFalls,
} from "../render/falls-render";
import {
  attachQuadGather, createGpuWaterLayer, destroyGpuWaterLayer, drawGpuWater,
} from "../render/water-gpu";

export type Comparison = {
  width: number;
  height: number;
  /** Pixels where either path drew anything at all. */
  drawn: number;
  /** Of those, how many the two disagree about by more than `tolerance`. */
  differing: number;
  /** As a share of what was drawn. */
  share: number;
  /** The largest single-channel disagreement anywhere, out of 255. */
  worst: number;
  /** Mean disagreement over the drawn pixels, out of 255. */
  mean: number;
  /** Pixels one path drew and the other left empty — the serious kind. */
  onlyCpu: number;
  onlyGpu: number;
  /** Nothing disagreed by more than the tolerance, and nothing is missing. */
  ok: boolean;
};

/**
 * A scene with one of everything the mesh has to get right.
 *
 * Flat ground with DIPS in it under a deep pool (the corner split, and the
 * hairline it used to leave), a plateau with a sheet on it beside a lake (the
 * split doing its job), and a lip for that sheet to go over (sides and falls).
 * Stepped, not poured and left, because a fall only exists once water has
 * crossed a lip — and stepping is deterministic, so both paths see the very
 * same columns.
 */
function scene(size: number) {
  const grid = createGrid(size, size);
  fillTerrain(grid, 1);
  const rim = 3;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const wall = x < rim || y < rim || x >= size - rim || y >= size - rim;
      const plateau = x > size - 10 && y > rim + 1 && y < size - rim - 1;
      const dip = Math.sin(x * 0.9) * Math.cos(y * 0.7) > 0.25 ? -6 : 0;
      setHeight(grid, x, y, wall ? 60 : plateau ? 22 : 10 + dip);
    }
  }
  // AND A BRIDGE OVER THE MIDDLE OF IT, because a corner that carries two
  // sheets is the case the two builders can most easily disagree about — and
  // the case neither of them had here. A deck makes a column a stack of
  // slots, so every per-slot field the shader reads is a plane deeper and
  // every corner it gathers has a storey it has to look at. @see fluid/slots
  const mid = size >> 1;
  for (let y = mid - 2; y <= mid + 1; y++) {
    for (let x = rim + 2; x <= rim + 5; x++) setDeck(grid, x, y, 1, 18);
  }
  const field = createWaterField(grid);
  setWaterEdge(field, false);
  for (let y = rim; y < size - rim; y++) {
    for (let x = rim; x < size - 10; x++) pourAt(field, x, y, 16, 1);
  }
  // A sheet on the plateau, which will spill off its lip.
  for (let y = rim + 2; y < size - rim - 2; y++) {
    for (let x = size - 9; x < size - rim; x++) pourAt(field, x, y, 5, 1);
  }
  // And a puddle on the span, which is water at a height nothing else on the
  // map stands at — so the corner where the deck meets the air really does
  // hold two sheets.
  for (let y = mid - 1; y <= mid; y++) {
    for (let x = rim + 3; x <= rim + 4; x++) pourAt(field, x, y, 3, 1);
  }
  return { grid, field };
}

/** Frame the whole map into a square of `px`, the way the editor's fit does. */
function frame(root: Container, size: number, px: number) {
  const wide = (size + size) * HW;
  const tall = (size + size) * HH + 60 * HEIGHT_UNIT;
  const scale = Math.min(px / wide, px / tall) * 0.95;
  root.scale.set(scale);
  root.position.set(px / 2 + size * HW * scale, px * 0.06 + 60 * HEIGHT_UNIT * scale);
}

/**
 * Draw one scene both ways and compare what came out.
 *
 * `tolerance` is per channel out of 255. Below it two pixels count as the same
 * colour, which is what lets float against double pass.
 */
/** The road art the editor itself uses. @see checkWaterOverPaving */
const ROAD_TABLE = buildRoadTable("landscape");

export function compareWaterPaths(
  renderer: Renderer, { size = 28, px = 640, seconds = 2, tolerance = 5 } = {},
): Comparison {
  const { grid, field } = scene(size);
  void grid;
  const bands = createBandLayer(size, size);
  const cpu = createWaterLayer(field.columns, bands, 1);
  const gpu = createGpuWaterLayer(field.columns, bands, 1);
  frame(bands.root, size, px);

  // Both paths see the same columns because the solver is stepped once and
  // both are handed the result — and both keep their own carried fields, which
  // start identical and are stepped identically.
  for (let n = 0; n < Math.round(seconds * 60); n++) {
    stepWater(field, 1 / 60);
    drawWater(cpu, field.columns, bands, 1 / 60);
    drawGpuWater(gpu, field.columns, bands, 1 / 60);
  }

  // What each path wanted to be visible, so that hiding one to draw the other
  // does not lose which bands it meant to draw.
  const cpuWanted = cpu.strips.map((s) => s.mesh.visible);
  const gpuWanted = gpu.meshes.map((m) => m.visible);
  const show = (which: "cpu" | "gpu") => {
    cpu.strips.forEach((s, i) => { s.mesh.visible = which === "cpu" && cpuWanted[i]; });
    gpu.meshes.forEach((m, i) => { m.visible = which === "gpu" && gpuWanted[i]; });
  };

  const shot = (which: "cpu" | "gpu") => {
    show(which);
    const target = RenderTexture.create({ width: px, height: px, antialias: false });
    renderer.render({ container: bands.root, target, clear: true });
    const out = renderer.extract.pixels(target);
    target.destroy(true);
    return out.pixels;
  };

  const a = shot("cpu");
  const b = shot("gpu");

  let drawn = 0, differing = 0, worst = 0, total = 0, onlyCpu = 0, onlyGpu = 0;
  for (let i = 0; i < a.length; i += 4) {
    const aOn = a[i + 3] > 2, bOn = b[i + 3] > 2;
    if (!aOn && !bOn) continue;
    drawn++;
    if (aOn && !bOn) onlyCpu++;
    if (bOn && !aOn) onlyGpu++;
    let d = 0;
    for (let c = 0; c < 4; c++) d = Math.max(d, Math.abs(a[i + c] - b[i + c]));
    total += d;
    if (d > worst) worst = d;
    if (d > tolerance) differing++;
  }

  destroyWaterLayer(cpu);
  destroyGpuWaterLayer(gpu);
  bands.root.destroy({ children: true });

  return {
    width: px, height: px, drawn, differing,
    share: drawn ? differing / drawn : 0,
    worst, mean: drawn ? total / drawn : 0, onlyCpu, onlyGpu,
    ok: differing === 0 && onlyCpu === 0 && onlyGpu === 0,
  };
}

/**
 * DOES THE WATER ON A BRIDGE REACH THE SCREEN?
 *
 * `compareWaterPaths` above renders the two water builders against each other
 * and NOTHING ELSE — no terrain, no cliffs and, the point here, no ROADS. That
 * is the right scope for "do the two builders agree", and it is why it reported
 * 0 differing pixels on a map where water standing on a span was invisible: a
 * comparison of water against water cannot see a road drawn over both of them.
 *
 * So this asks the other question, the one somebody looking at the map asks.
 * Build the whole picture the editor builds — terrain, cliffs, PAVING and the
 * water — put a film on every column that has a deck over it, and render. Then
 * dry the decks and render again. If the water on the span is visible at all,
 * those two images differ; if a road is painted over it, they do not, and the
 * number below is nought.
 *
 * A CONTROL IN THE SAME FRAME, because "nothing changed" has two causes and
 * they need telling apart: the same film is put on a patch of bare ground as
 * well, and its pixels are counted separately. Bare ground changing while the
 * deck does not is a drawing-order fault. Neither changing is a harness that
 * is not rendering at all, which is what three of my own measurements turned
 * out to be before this existed.
 */
export type PavingCheck = {
  mesh: "cpu" | "gpu";
  /** Whether the device mesh was asked to gather, as the live path does. */
  gathered: boolean;
  /** Whether the falls were drawn over the water, as the live path does. */
  falls: boolean;
  deckColumns: number;
  bareColumns: number;
  /** Pixels the deck's water changes. Nought means a road is over it. */
  deckPixels: number;
  /** And the bare-ground control, which must not be nought. */
  barePixels: number;
  /** Pixels a wet column reaches, each way. The comparison that matters. */
  deckPer: number;
  barePer: number;
  drawn: number;
  ok: boolean;
  why: string | null;
};

export function checkWaterOverPaving(
  renderer: Renderer,
  textures: Record<string, Texture>,
  palette: Palette,
  {
    mesh = "gpu" as "cpu" | "gpu", px = 640, depth = 1.5, size = 24,
    // THE MAP IN FRONT OF YOU, optionally. The `crossing` fixture draws its
    // deck water perfectly well and a generated map does not, which is the
    // whole reason this exists — so the check has to be able to be pointed at
    // the second. Its own water field off the same grid, so nothing here
    // touches what is on screen.
    grid: given = null as Grid | null,
    // AND ITS WATER, optionally. With a synthetic film on every decked column
    // this check said the span drew as well as bare ground did, on a map where
    // the span plainly looked dry — so it has to be able to render the water
    // that is actually there rather than the water it would like to be there.
    water: liveWater = null as ColumnField | null,
    // AND THE GATHERING, which is the last thing between this and the live
    // path. Off, every band draws its whole complement of quads; on, a compute
    // pass decides which are worth drawing and the meshes are asked for that
    // many. A harness that always ran with it off would be testing a path
    // nobody runs. @see attachQuadGather
    gather = true,
    device = null as GPUDevice | null,
    // AND THE FALLS, which share a container with the water mesh and are built
    // after it — so they draw OVER it. On a span full of water they are the
    // sheets coming off both parapets, and whether they also cover the deck
    // they leave is exactly the kind of thing a water-only comparison cannot
    // be asked. @see createFallLayer
    //
    // THIS ARM DOES NOT BITE YET, and saying so is cheaper than somebody
    // trusting it. `drawFalls` walks the cliff index, and nothing here ever
    // steps the field — so there are no lips, the layer draws nothing, and
    // turning it on and off changes not one pixel. Making it bite means
    // running `markCliffs` and a few steps before the shots, which also means
    // deciding what "the same state twice" is once water is moving. Until
    // then a pass here says nothing about the falls.
    falls = true,
  } = {},
): PavingCheck {
  const built = given
    ? { grid: given, field: createWaterField(given) }
    : crossingScene(size);
  const { grid, field } = built;
  const columns = field.columns;
  const w = grid.w, h = grid.h;
  const bands = createBandLayer(w, h);

  // THE WHOLE PICTURE, not just the water. The roads are the point.
  const tl = createTerrainLayer(grid, palette, 1);
  const cl = createCliffLayer(grid, palette, 1);
  const pl = createPavedLayer(grid, ROAD_TABLE, 1);
  buildTerrain(tl, bands, grid, textures);
  buildCliffs(cl, bands, grid, textures);
  buildPaved(pl, bands, grid, textures);

  const cpu = mesh === "cpu" ? createWaterLayer(columns, bands, 1) : null;
  const gpu = mesh === "gpu" ? createGpuWaterLayer(columns, bands, 1) : null;

  if (gpu && gather && device) {
    gpu.gather = attachQuadGather(gpu, renderer, device, w, h);
  }
  const fl = falls ? createFallLayer(bands, 1) : null;
  const draw = () => {
    if (cpu) drawWater(cpu, columns, bands, 1 / 60);
    if (gpu) drawGpuWater(gpu, columns, bands, 1 / 60);
    if (fl) drawFalls(fl, columns, activeBox(columns));
  };
  const shoot = () => {
    const target = RenderTexture.create({ width: px, height: px, antialias: false });
    renderer.render({ container: bands.root, target, clear: true });
    const out = renderer.extract.pixels(target);
    target.destroy(true);
    return out.pixels;
  };

  // A PATCH OF BARE GROUND FOR THE CONTROL, chosen off the grid rather than
  // written down: on a generated map the corner this used to hard-code is as
  // likely to be a river as a field. Unpaved, undecked, flat with its
  // neighbours, and as many tiles as the deck has so the two densities below
  // are comparable.
  const deckTiles: number[] = [];
  const flatBare: number[] = [];
  for (let ty = 1; ty < h - 1; ty++) {
    for (let tx = 1; tx < w - 1; tx++) {
      const t = ty * w + tx;
      if (grid.deck[t] !== 0) { deckTiles.push(t); continue; }
      if (grid.paved[t] !== undefined && grid.paved[t] !== 0 && grid.paved[t] !== 255) continue;
      const z = grid.height[t];
      let flat = true;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const n = (ty + dy) * w + (tx + dx);
        if (grid.height[n] !== z || grid.deck[n] !== 0) { flat = false; break; }
      }
      if (flat) flatBare.push(t);
      void 0;
    }
  }
  // FRAMED ON THE BRIDGE, not on the whole map. A 64-tile map fitted into 640
  // pixels draws a span as a hairline, where every fault is a rounding error
  // and nothing can be told from anything; the picture somebody complains
  // about is the one they are looking AT. Centred on the decks and scaled so
  // the span and a margin of its approaches fill the frame.
  if (deckTiles.length) {
    let sx = 0, sy = 0;
    for (const t of deckTiles) { sx += t % w; sy += (t / w) | 0; }
    const cxT = sx / deckTiles.length, cyT = sy / deckTiles.length;
    let span = 1;
    for (const t of deckTiles) {
      span = Math.max(span, Math.abs((t % w) - cxT), Math.abs(((t / w) | 0) - cyT));
    }
    const tiles = (span + 4) * 2;
    const scale = px / (tiles * (HW + HH));
    bands.root.scale.set(scale);
    bands.root.position.set(
      px / 2 - (cxT - cyT) * HW * scale,
      px / 2 - (cxT + cyT) * HH * scale,
    );
  } else {
    frame(bands.root, Math.max(w, h), px);
  }

  // NEAREST THE SPAN, because the frame is now on the span: a control patch
  // in the far corner of the map is outside it, draws nothing, and reports
  // the harness as broken rather than the bridge.
  if (deckTiles.length) {
    let sx = 0, sy = 0;
    for (const t of deckTiles) { sx += t % w; sy += (t / w) | 0; }
    const cxT = sx / deckTiles.length, cyT = sy / deckTiles.length;
    const far = (t: number) =>
      Math.abs((t % w) - cxT) + Math.abs(((t / w) | 0) - cyT);
    flatBare.sort((a, b) => far(a) - far(b));
  }
  const bare: number[] = [];
  for (const t of flatBare.slice(0, Math.max(1, deckTiles.length))) {
    const tx = t % w, ty = (t / w) | 0;
    for (let cy = ty * COLUMNS_PER_TILE; cy < (ty + 1) * COLUMNS_PER_TILE; cy++) {
      for (let cx = tx * COLUMNS_PER_TILE; cx < (tx + 1) * COLUMNS_PER_TILE; cx++) {
        bare.push(cy * columns.nx + cx);
      }
    }
  }

  const cells = columns.cells;
  const deckOf: number[] = [];
  for (let i = 0; i < cells; i++) {
    if (columns.roof[cells + i] > columns.ground[cells + i]) deckOf.push(cells + i);
  }

  let dry: ArrayLike<number>, deckWet: ArrayLike<number>, deckColumns: number;
  if (liveWater && copyWater(liveWater, columns)) {
    // THE MAP AS IT STANDS, against the same map with the span's water taken
    // off it. Whatever is between the two images is the span's water.
    deckColumns = deckOf.reduce((n, i) => n + (columns.depth[i] > 0 ? 1 : 0), 0);
    draw();
    deckWet = shoot();
    const kept = deckOf.map((i) => columns.depth[i]);
    for (const i of deckOf) columns.depth[i] = 0;
    draw();
    dry = shoot();
    deckOf.forEach((i, k) => { columns.depth[i] = kept[k]; });
  } else {
    // 1. Everything dry.
    wetTheDecks(columns, 0);
    draw();
    dry = shoot();
    // 2. The decks wet, bare ground still dry.
    deckColumns = wetTheDecks(columns, depth);
    draw();
    deckWet = shoot();
  }

  // 3. THE CONTROL, AGAINST ITS OWN BASELINE. It used to be measured against
  //    the `dry` image above, which is only the same picture when the water
  //    above was synthetic: with the live map's water copied in, `dry` still
  //    holds the river and the control shot does not, so the difference
  //    between them was the whole river — 104,000 pixels, reported as bare
  //    ground being ten times more visible than it is. Its own empty frame.
  wetTheDecks(columns, 0);
  draw();
  const empty = shoot();
  for (const i of bare) columns.depth[i] = depth;
  draw();
  const bareWet = shoot();

  let drawn = 0, deckPixels = 0, barePixels = 0;
  for (let i = 0; i < dry.length; i += 4) {
    if (dry[i + 3] > 2) drawn++;
    let dd = 0, bd = 0;
    for (let c = 0; c < 4; c++) {
      dd = Math.max(dd, Math.abs(dry[i + c] - deckWet[i + c]));
      bd = Math.max(bd, Math.abs(empty[i + c] - bareWet[i + c]));
    }
    if (dd > 5) deckPixels++;
    if (bd > 5) barePixels++;
  }

  if (fl) destroyFallLayer(fl);
  if (cpu) destroyWaterLayer(cpu);
  if (gpu) destroyGpuWaterLayer(gpu);
  bands.root.destroy({ children: true });

  // PER COLUMN, because the two patches are never the same size and a raw
  // count would call a big deck passing and a small one failing.
  //
  // CALIBRATED BY SABOTAGE rather than by taste. Drawing the water mesh into
  // the tier BELOW the paving — the fault this check was written to look for —
  // takes a generated map from 13.83 pixels a column to 9.69 against bare
  // ground's 13.13, a ratio of 1.05 falling to 0.74. So the bar is 0.85: it
  // catches that and clears the honest shortfall of a span whose water is
  // clipped by its own parapets. The `crossing` fixture runs at 3.8, so the
  // bound is nowhere near either.
  //
  // That sabotage is also the answer to the question this was built for. If
  // paving were covering the deck's water, burying the water UNDER it would
  // erase it; three quarters of it still came through, because tiles' diamonds
  // tile the plane without overlapping and a road can only cover the water on
  // its own tile — which its own band draws first anyway.
  const deckPer = deckColumns ? deckPixels / deckColumns : 0;
  const barePer = bare.length ? barePixels / bare.length : 0;
  const why = deckColumns === 0
    ? "no deck column is wet: nothing to look at, not a fault"
    : barePixels === 0
      ? "the control drew nothing either — the harness is not rendering"
      : deckPixels === 0
        ? "water on the deck reaches no pixel: something is drawn over it"
        : deckPer < barePer * 0.85
          ? `the deck's water reaches ${deckPer.toFixed(2)} pixels a column `
            + `against bare ground's ${barePer.toFixed(2)}: something is over it`
          : null;
  return {
    mesh, gathered: !!gpu?.gather, falls,
    deckColumns, bareColumns: bare.length,
    deckPixels, barePixels,
    deckPer: +deckPer.toFixed(3), barePer: +barePer.toFixed(3),
    // NOTHING TO LOOK AT IS NOT A PASS AND NOT A FAILURE. A dry bridge says
    // nothing either way, and reporting it as either is how a check gets
    // believed when it has not run.
    drawn, ok: why === null, why,
  };
}
