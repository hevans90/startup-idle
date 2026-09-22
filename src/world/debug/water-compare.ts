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
import { Container, RenderTexture, type Renderer } from "pixi.js";

import { createGrid, fillTerrain, setDeck, setHeight } from "../grid";
import { createWaterField, pourAt, setWaterEdge, stepWater } from "../water/field";
import { HEIGHT_UNIT, HH, HW } from "../iso";
import { createBandLayer } from "../render/bands";
import { createWaterLayer, destroyWaterLayer, drawWater } from "../render/water";
import { createGpuWaterLayer, destroyGpuWaterLayer, drawGpuWater } from "../render/water-gpu";

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
