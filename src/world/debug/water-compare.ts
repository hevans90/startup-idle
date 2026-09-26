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
 * WHAT IT READS NOW. The scene grew a CAUSEWAY with a bridged gap in it,
 * because the span it already had is submerged and so has no deck-to-road
 * seam anywhere on it — and that seam turned out to be where two separate
 * faults lived. It reads **6 pixels of 34,943 differing, worst 33**, the same
 * every run, with NOTHING MISSING either way and the same six whether the
 * side faces are drawn or not. It was 45, then 28.
 *
 * THE TWO FAULTS WERE BOTH ABOUT THE FAR-EDGE FACE a span hangs into the
 * diamond of the road in front of it, and neither was a rule computed two
 * ways — both were about WHERE the answer was filed.
 *
 *  - The device asked which TIER a quad belongs to about the column whose
 *    diamond the quad lands in. For a filed-forward face that is the wrong
 *    column, and at this seam it is fatal: an upper slot over a column with
 *    no deck is ABSENT, floor and roof equal, which reads as roofed — so the
 *    open tier threw the span's own face away before the branch that owns it
 *    ran. The device drew no face at all and the builder drew one. Worth 6.
 *  - And a quad's id packed the STOREY outside the part, so every quad of
 *    storey nought drew before any quad of storey one. The road's own water
 *    was therefore painted before the face the span beside it hangs into the
 *    same diamond, and the face landed on top of water NEARER the camera than
 *    itself. The builder, which files that face into the band ahead before
 *    reaching any of that band's columns whatever storey they are in, painted
 *    it under. Worth the other 22. @see water-gpu's PARTS
 *
 * WHAT THE SIX ARE, so nobody hunts them again. Three are a tint index: the
 * surface's shade is a float quantised to a row of the tint table, and at an
 * exact half the two paths round to neighbouring rows — which is why each of
 * those pixels differs in ONE channel, by seven to nine, at the same alpha.
 * The other three are a silhouette: a surface edge lands one pixel apart, and
 * two of them are literally the same colour one row up. Both are the
 * float-against-double class this tolerates everywhere else, and neither is a
 * rule that disagrees with itself.
 *
 * SO `ok` ALLOWS A SPECKLE, and says how big. A control that cannot pass is a
 * control nobody reads, and "nought differing" was only ever reachable on a
 * scene with no bridge on it. @see SPECKLE
 *
 * AND THE HUNT THAT COST THE MOST, because the shape of it will repeat. When
 * the sheet grouping moved from a flood fill on the host to a partition each
 * corner makes for itself, this went from nought differing to **80 of 36,365,
 * worst 38**, all in one box and growing as the scene settled. The grouping
 * had just changed and looked guilty. It was not: painting each path's mask
 * flat per quad showed both computing the identical component, bit for bit, at
 * the same corner. What differed was the RIM — the shader read the ground
 * beside a corner at storey nought while the builder read it in the
 * contributor's own storey, which on a deck is twenty half steps apart, so one
 * path applied the rim in full where the other never applied it at all. One
 * line of the corner rule. @see cornerOf
 *
 * What made it findable, in order: `where` (the box put it on the BRIDGE, not
 * the plateau it looked like); `faces: false` (the surface, not the sides);
 * painting the contributor COUNT instead of the water (4 against 3); painting
 * the MASK flat per quad (identical, which cleared the new code); and painting
 * one fixed corner's mask across every quad, so the two paths were answering
 * about the same corner instead of about whichever one won the pixel. Four of
 * those five readings were misleading until the last, because a pixel only
 * ever reports the quad on TOP of it.
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
import { createGpuWater } from "../../fluid/gpu/solver";
import { COLUMNS_PER_TILE } from "../water/field";
import type { Palette } from "../render/terrain";
import {
  createWaterField, pourAt, runSources, setWaterEdge, stepWater,
} from "../water/field";
import { HEIGHT_UNIT, HH, HW } from "../iso";
import { createBandLayer } from "../render/bands";
import { createWaterLayer, destroyWaterLayer, drawWater } from "../render/water";
import { activeBox, type ColumnField } from "../../fluid/columns";
import {
  createFallLayer, destroyFallLayer, drawFalls,
} from "../render/falls-render";
import {
  attachQuadGather, createGpuWaterLayer, destroyGpuWaterLayer, destroyQuadGather,
  deviceSinks, gatherQuads,
  drawGpuWater,
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
  /** Contributors the builder dropped for want of a tier. @see TIERS */
  overflow: number;
  /** Where the disagreements are, and what they look like. Null when clean. */
  where: null | {
    x0: number; y0: number; x1: number; y1: number;
    samples: {
      x: number; y: number; by: number;
      cpu: [number, number, number, number];
      gpu: [number, number, number, number];
    }[];
  };
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
  // AND A CAUSEWAY WITH A GAP BRIDGED IN IT, well clear of the water below.
  //
  // The span above is SUBMERGED — the basin fills to about 26 and its deck is
  // at 18 — so it has no deck-to-road seam anywhere on it, and that seam is
  // the one place the two mesh builders can differ about which STOREY the
  // water next door is in. The builder read the neighbour's slot nought where
  // the shader reads its own storey, which at an abutment is the channel
  // against the road: one path drew a full-height pane and the other drew
  // nothing, and this scene could not see it. High and dry, it can.
  const deckZ = 34, road = mid + 4;
  for (let y = road; y <= road + 1; y++) {
    for (let x = rim + 1; x < size - rim - 1; x++) setHeight(grid, x, y, deckZ);
    for (let x = rim + 7; x <= rim + 8; x++) {
      setHeight(grid, x, y, 10);              // the gap the causeway crosses
      setDeck(grid, x, y, 1, deckZ);          // and the span over it
    }
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
  // WATER RUNNING ALONG THE CAUSEWAY, over the road and onto the deck.
  //
  // Deep enough to be past the fade, which is not fussiness: a film sitting on
  // the alpha ramp differs between the two paths by a shade index rounding one
  // way or the other, and thirty-odd silhouette pixels of that drown out
  // whatever the SEAM is doing, which is the thing this is here to show.
  for (let y = road; y <= road + 1; y++) {
    for (let x = rim + 2; x < size - rim - 2; x++) pourAt(field, x, y, 5, 1);
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
/**
 * How much SPECKLE a pass is allowed: the share of drawn pixels that may
 * differ by more than the tolerance and still count as the same picture.
 *
 * Not a number chosen to fit the reading. It is what QUANTISATION costs —
 * a shade rounded to a neighbouring row of the tint table, a silhouette
 * landing a pixel across — measured at three resolutions, where it comes to
 * 0.023%, 0.017% and 0.023% of what is drawn. This is not quite twice that.
 *
 * AND HERE IS WHAT IT CANNOT RESOLVE, because a threshold stated without its
 * blind spot is worse than none. Putting back the storey-packing fault reads
 * 0.063% and 0.059% — it trips, but by half again, not by an order. Putting
 * back the tier fault ALONE reads six more pixels than clean and would sail
 * through. So this catches a fault that costs a face and not one that costs a
 * fringe, and the COUNTS are the finer instrument: `differing` is reported
 * whatever this says, and a change that moves it has done something. The
 * faults this was built for are nowhere near the line — the corner merge
 * missing from the shader read 4.5% of the frame, seventy times over.
 * @see compareWaterPaths
 */
export const SPECKLE = 0.0004;

/** The road art the editor itself uses. @see checkWaterOverPaving */
const ROAD_TABLE = buildRoadTable("landscape");

export function compareWaterPaths(
  renderer: Renderer,
  {
    size = 28, px = 640, seconds = 2, tolerance = 5, faces = true,
    // THE GATHERING, AND WITH IT THE BRINK CACHE, which is the path the game
    // actually draws by. Off, the vertex shader runs the brink scan inline;
    // on, it reads the texture the brink pass filled. Those have to be the
    // same picture, and this is the only check that can say so — the fast path
    // shipped unmeasured by this once already. @see createBrinkPass
    gather = true,
    // HOW MANY of the differing pixels come back with their colours. Eight is
    // enough to say WHERE; a hunt wants the shape of the cluster, and a
    // cluster of thirty reported eight at a time is four runs of guessing
    // which ones were left out.
    probes = 8,
    // AND THE BRINK CACHE ON ITS OWN, so it can be told apart from the
    // gathering it rides with: the gathering's counts come back by an async
    // mapping, so how many quads a band draws is not the same twice, and a
    // difference that moves between runs is that and not this.
    brink = true,
  } = {},
): Comparison {
  const { grid, field } = scene(size);
  void grid;
  const bands = createBandLayer(size, size);
  const cpu = createWaterLayer(field.columns, bands, 1);
  const gpu = createGpuWaterLayer(field.columns, bands, 1);
  const device = (renderer as unknown as { gpu?: { device: GPUDevice } }).gpu?.device ?? null;
  const g = gather && device
    ? attachQuadGather(gpu, renderer, device, size, size) : null;
  if (g && !brink) {
    g.brink = null;
    for (const m of [...gpu.meshes, ...gpu.under]) {
      const u = m.shader?.resources.water as { uniforms: Record<string, unknown>; update: () => void } | undefined;
      if (!u) continue;
      (u.uniforms.uSlots as Float32Array)[2] = 0;
      u.update();
    }
  }
  frame(bands.root, size, px);

  // Both paths see the same columns because the solver is stepped once and
  // both are handed the result — and both keep their own carried fields, which
  // start identical and are stepped identically.
  for (let n = 0; n < Math.round(seconds * 60); n++) {
    stepWater(field, 1 / 60);
    drawWater(cpu, field.columns, bands, 1 / 60, faces);
    drawGpuWater(gpu, field.columns, bands, 1 / 60, faces);
    if (g && device) gatherQuads(g, device, field.columns, size, size, faces);
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
  // AND WHERE, which this could not say until a change made 80 pixels of it
  // disagree and the number alone gave nowhere to look. A count tells you
  // there is a fault; a box and a handful of samples tell you which part of
  // the scene has it, and which CHANNEL parted — an alpha that differs is a
  // different fault from a shade that does.
  let bx0 = Infinity, by0 = Infinity, bx1 = -Infinity, by1 = -Infinity;
  const samples: {
    x: number; y: number; by: number;
    cpu: [number, number, number, number]; gpu: [number, number, number, number];
  }[] = [];
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
    if (d > tolerance) {
      differing++;
      const p = i / 4, x = p % px, y = (p / px) | 0;
      bx0 = Math.min(bx0, x); bx1 = Math.max(bx1, x);
      by0 = Math.min(by0, y); by1 = Math.max(by1, y);
      if (samples.length < probes) {
        samples.push({
          x, y, by: d,
          cpu: [a[i], a[i + 1], a[i + 2], a[i + 3]],
          gpu: [b[i], b[i + 1], b[i + 2], b[i + 3]],
        });
      }
    }
  }

  destroyWaterLayer(cpu);
  if (g) destroyQuadGather(g);
  destroyGpuWaterLayer(gpu);
  bands.root.destroy({ children: true });

  const share = drawn ? differing / drawn : 0;
  return {
    width: px, height: px, drawn, differing,
    share,
    worst, mean: drawn ? total / drawn : 0, onlyCpu, onlyGpu,
    where: differing
      ? { x0: bx0, y0: by0, x1: bx1, y1: by1, samples }
      : null,
    // Contributors the BUILDER dropped for want of a tier. The shader has no
    // such limit, so any number here is a difference between the two that is
    // nothing to do with the rule they share. @see TIERS
    overflow: cpu.overflow,
    ok: share <= SPECKLE && onlyCpu === 0 && onlyGpu === 0,
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
  /** How many frames the map was run for before it was looked at. */
  steps: number;
  /** And which solver ran them. The sheet ids come off the host's copy. */
  solver: "host" | "device";
  /** The device's own tally, and what reached the host's copy of each storey. */
  deviceWater: number | null;
  hostGround: number;
  hostDeck: number;
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

export async function checkWaterOverPaving(
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
    // AND RUN THE MAP FIRST, which is the difference between a state somebody
    // wrote down and a state somebody PLAYED. The fixture feeds itself — a
    // spring on the road and another at the head of the channel — so stepping
    // it puts the water where the solver puts it, over the parapets it really
    // clears and around the kerbs it really does not, and it builds the cliff
    // index so the falls have lips to draw from. A film laid on every decked
    // column is none of those things.
    steps = 0,
    // AND ON WHICH SOLVER, because that is the last thing this does not cover
    // and it is the one the game runs. The sheet ids the mesh reads are worked
    // out on the HOST, from the host's copy of the depths — and with the
    // device solving, that copy is whatever the readback last put there. If it
    // does not carry the upper storey, every column on a deck is NO_BODY and
    // the builder skips it: water that is there, solved correctly, and drawn
    // by nothing. @see findBodies, scatter
    solver = "host" as "host" | "device",
  } = {},
): Promise<PavingCheck> {
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
  // `carried` — the live tick's way of saying the device has already filled
  // the textures — is off here, and that is a hole this check still has.
  //
  // The method works by taking water off the deck and rendering again, and it
  // takes it off the HOST's copy; with the textures device-fed that write
  // never reaches them, so the control draws nothing and the verdict is
  // worthless. Which meant this covered the BUILDER on depths it uploads
  // ITSELF, and never the device's own writes — so it passed at 180 pixels a
  // column on the very map where the live screen showed a dry bridge, because
  // `copyOut` was filling one plane of the depth texture and the host's copy
  // was filling all of them. @see copyOut, which is what was wrong
  //
  // I tried to close it from in here and could not. Every way of asking
  // "what did the DEVICE put in that texture" ends up measuring something
  // else: the sheet ids are rebuilt from the host's copy by the very draw
  // that was meant to read them, and any earlier draw has already pushed the
  // host's depths into the same texture, so both shots see the same thing and
  // the answer is nought however the solver behaves. It reported nought on a
  // map that draws perfectly, which is a worse instrument than none.
  //
  // What found the fault instead was `__liveWaterPixels`, in the running app,
  // where the real path is the only path. @see copyOut
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

  let water: Awaited<ReturnType<typeof createGpuWater>> | null = null;
  if (steps > 0) {
    if (solver === "device" && device) {
      // WITH THE CARRIED FIELDS, which is what makes the device FILL the
      // textures rather than the host re-uploading them. Without it
      // `drawGpuWater` sends the host's copy of the depths up every frame and
      // the device's own writes are never the thing being drawn — so this arm
      // would mask precisely the path it exists to cover. @see deviceSinks
      water = createGpuWater(
        device, columns,
        gpu ? { seed: gpu.wash.seed, now: gpu.wash.now, foam: gpu.foam.now } : undefined,
        // AND THE LAYER'S TEXTURES FOR THE DEVICE TO FILL, which is the whole
        // point of the device arm. Left out, the solver writes none of them
        // and `deckTexture` below reads nought whatever `copyOut` does —
        // measuring a wire that was never connected. @see deviceSinks
        gpu ? deviceSinks(gpu, renderer, columns.nx) : [],
      );
      for (let n = 0; n < steps; n++) {
        runSources(field, grid, 1 / 60);
        water.sync(columns);
        // AWAITED, AND THAT IS THE WHOLE POINT. A loop that never yields lets
        // no readback resolve, so the scatter never runs and the host's copy
        // is never written by the device at all — the pours simply pile up
        // unsolved. Run that way this check reported 39,263 on the ground
        // against the host solver's 5,143 and called the bridge dry, which
        // says nothing about the bridge. The same trap as `__waterBench` with
        // `sync` off. @see stepAwaited
        await water.stepAwaited(columns, 1 / 60);
      }
    } else {
      for (let n = 0; n < steps; n++) {
        runSources(field, grid, 1 / 60);
        stepWater(field, 1 / 60);
      }
    }
  }
  // WHAT EACH SIDE SAYS IT IS HOLDING, READ THE MOMENT THE RUN ENDS. Measured
  // at the end of this function instead, it read the CONTROL's water — 216,
  // which is the bare patch — and called the deck empty on both solvers. The
  // device keeps its own tally over every slot; the host's copy is whatever
  // the readback last put there, and nought there with the device holding
  // thousands is not a solver that lost the water. It is water that never came
  // back to the one place the sheet ids are worked out. @see findBodies
  const cells = columns.cells;
  const deviceWater = water ? +water.last().deviceWater.toFixed(1) : null;
  let hostGround = 0, hostDeck = 0;
  for (let i = 0; i < cells; i++) {
    hostGround += columns.depth[i];
    for (let a = 1; a < columns.layers; a++) hostDeck += columns.depth[a * cells + i];
  }
  const deckOf: number[] = [];
  for (let i = 0; i < cells; i++) {
    if (columns.roof[cells + i] > columns.ground[cells + i]) deckOf.push(cells + i);
  }

  let dry: ArrayLike<number>, deckWet: ArrayLike<number>, deckColumns: number;
  if (steps > 0) {
    // WHAT THE MAP MADE FOR ITSELF, against the same map with the span's
    // water taken off it.
    deckColumns = deckOf.reduce((n, i) => n + (columns.depth[i] > 0 ? 1 : 0), 0);
    draw();
    deckWet = shoot();
    const kept = deckOf.map((i) => columns.depth[i]);
    for (const i of deckOf) columns.depth[i] = 0;
    draw();
    dry = shoot();
    deckOf.forEach((i, k) => { columns.depth[i] = kept[k]; });
  } else if (liveWater && copyWater(liveWater, columns)) {
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

  water?.destroy();
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
    mesh, gathered: !!gpu?.gather, falls, steps, solver,
    deviceWater, hostGround: +hostGround.toFixed(1), hostDeck: +hostDeck.toFixed(1),
    deckColumns, bareColumns: bare.length,
    deckPixels, barePixels,
    deckPer: +deckPer.toFixed(3), barePer: +barePer.toFixed(3),
    // NOTHING TO LOOK AT IS NOT A PASS AND NOT A FAILURE. A dry bridge says
    // nothing either way, and reporting it as either is how a check gets
    // believed when it has not run.
    drawn, ok: why === null, why,
  };
}
