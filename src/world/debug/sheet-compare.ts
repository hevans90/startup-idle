/**
 * THE TWO SHEET BUILDERS, HELD TO EACH OTHER IN PIXELS.
 *
 * A fall's nappe is built twice: by `falls-render` on the host, walking the
 * lip list and pushing quads, and by `gpu/sheet` on the device, one invocation
 * per lip per step writing instance data. Everything else the water does has a
 * comparison — the solver has `__frameCompare` and `?gpucheck`, the surface has
 * `__waterCompare` — and the sheets have had NOTHING. `compareWaterPaths` does
 * not draw falls at all, and the frame comparison compares FIELDS, which a
 * sheet is not.
 *
 * That gap is why the device's sheet pass is still gated off on any map with a
 * bridge on it: the decode there reads a fall's edge the one-storey way, and
 * nobody could tell whether a fix worked. This is the instrument that says so.
 *
 * THE SAME FIELD INTO BOTH, which is the whole point and the reason this does
 * not simply run the two solvers and look. Run separately they drift — that is
 * measured elsewhere and is not what is in question here — and a sheet drawn
 * from a field three frames behind differs for a reason that has nothing to do
 * with the builder. So the host steps a field, the host draws its sheets from
 * it, and that same field is uploaded whole and the sheet pass run SOLO
 * against it. Any difference left is the two builders disagreeing.
 *
 * IN PIXELS rather than in numbers, because the two do not produce the same
 * shape of thing: the device writes twelve words of instance data per quad for
 * an instanced shader and the host writes four explicit corners. What they
 * have in common is what lands on the screen.
 */
import { Container, RenderTexture, type Renderer } from "pixi.js";

import { createGrid, fillTerrain, setDeck, setHeight } from "../grid";
import { createBandLayer } from "../render/bands";
import { createFallLayer, destroyFallLayer, drawFalls } from "../render/falls-render";
import {
  SHEET_CAP, createGpuFallLayer, destroyGpuFallLayer, drawGpuFalls,
} from "../render/falls-gpu";
import { createGpuWaterLayer, destroyGpuWaterLayer } from "../render/water-gpu";
import { createFoam, stepFoam } from "../render/foam";
import { createFlowWash, stepFlowWash } from "../render/flow-wash";
import { createSheet } from "../../fluid/gpu/sheet";
import { createGpuState, upload, writeConsts } from "../../fluid/gpu/state";
import { reduceSeed } from "../../fluid/gpu/apply";
import { FALL_MIN } from "../../fluid/falls";
import { dripRoom } from "../../fluid/drips";
import { COLUMNS_PER_TILE, createWaterField, pourAt, stepWater } from "../water/field";
import { activeBox } from "../../fluid/columns";
import { HEIGHT_UNIT, HH, HW } from "../iso";

export type SheetComparison = {
  scene: "cliff" | "span";
  /** Lips the scene actually had. A nought is a warning, not a pass. */
  lips: number;
  /** And how much water was in the AIR. A lip with nothing going over it
   * builds no sheet, so this is the number that says the scene ran. */
  air: number;
  /**
   * Lips whose water is leaving an UPPER storey.
   *
   * The whole point of the bridged scene, and worth counting rather than
   * assuming: a deck set back from the edge lets the water return to the shelf
   * and fall off slot nought, and then both builders agree about a case
   * neither was asked. A nought here on the span scene is a scene that proves
   * nothing.
   */
  deckLips: number;
  /** Quads each side made, which is the cheapest sign of a decode gone wrong. */
  hostQuads: number;
  deviceQuads: number;
  /** Pixels either path drew, and how many they disagree about. */
  drawn: number;
  differing: number;
  worst: number;
  mean: number;
  /** Pixels one path drew and the other left empty — the serious kind. */
  onlyHost: number;
  onlyDevice: number;
  ok: boolean;
  why: string | null;
};

/**
 * A CLIFF WITH WATER GOING OVER IT, and optionally a span beside it.
 *
 * The plain one is the control: it is a single storey, which is the shape the
 * device's sheet pass already claims to handle, so it has to read clean before
 * the bridged one means anything.
 */
function cliffScene(size: number, span: boolean) {
  const grid = createGrid(size, size);
  fillTerrain(grid, 1);
  const rim = 2;
  const lip = Math.floor(size / 2);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const wall = x < rim || y < rim || x >= size - rim || y >= size - rim;
      // A shelf that stops at `lip` and drops twelve half steps to a floor.
      setHeight(grid, x, y, wall ? 60 : x < lip ? 14 : 2);
    }
  }
  if (span) {
    // A DECK AT THE VERY EDGE, so the water goes over the lip off SLOT ONE.
    //
    // Put it three columns short of the edge instead and the whole thing is
    // pointless: the water crosses the deck, comes back down onto the shelf,
    // and falls off slot nought like any other map. The first version of this
    // did exactly that and both paths agreed perfectly about a case neither
    // was being asked. The lip has to be ON the deck. @see deckLips
    for (let y = rim + 1; y < size - rim - 1; y++) {
      for (let x = lip - 2; x <= lip; x++) {
        setHeight(grid, x, y, 2);
        setDeck(grid, x, y, 1, 14);
      }
    }
  }
  const field = createWaterField(grid);
  // Fed at the back of the shelf, so it runs the length of it and spills.
  for (let y = rim + 1; y < size - rim - 1; y++) {
    for (let x = rim + 1; x <= rim + 3; x++) pourAt(field, x, y, 6, 1);
  }
  return { grid, field };
}

/** Frame the map into a square, the way the editor's fit does. */
function frame(root: Container, size: number, px: number) {
  const wide = (size + size) * HW;
  const tall = (size + size) * HH + 60 * HEIGHT_UNIT;
  const scale = Math.min(px / wide, px / tall) * 0.95;
  root.scale.set(scale);
  root.position.set(px / 2 + size * HW * scale, px * 0.06 + 60 * HEIGHT_UNIT * scale);
  return scale;
}

export async function compareSheetPaths(
  renderer: Renderer, device: GPUDevice,
  { size = 24, px = 640, seconds = 2, tolerance = 5, span = false } = {},
): Promise<SheetComparison> {
  const { field } = cliffScene(size, span);
  const c = field.columns;
  const bands = createBandLayer(size, size);
  const scale = frame(bands.root, size, px);

  // ONE FIELD, STEPPED ONCE, on the host. Both builders read it.
  const wash = createFlowWash(c);
  const foam = createFoam(c);
  for (let n = 0; n < Math.round(seconds * 60); n++) {
    stepWater(field, 1 / 60);
    const box = activeBox(c);
    if (box) { stepFlowWash(wash, c, 1 / 60, box); stepFoam(foam, c, 1 / 60, box); }
  }
  const region = activeBox(c);

  // The host's sheets, from that field.
  const host = createFallLayer(bands, scale);
  drawFalls(host, c, region, foam.now, wash.now);

  // And the device's, from the same field uploaded whole and the pass run on
  // its own — no solver, so nothing has moved between the two.
  // THE WATER LAYER IS HERE FOR ITS TINT RAMP AND NOTHING ELSE, so its own
  // meshes are hidden: left drawing, the surface is most of what the shot
  // contains and a comparison of the SHEETS reads clean because the sheets are
  // a rounding error in it. The first run of this said ok on 1,014 pixels of
  // which none were a sheet.
  const water = createGpuWaterLayer(c, bands, scale);
  for (const m of [...water.meshes, ...water.under]) m.visible = false;
  const gfl = createGpuFallLayer(bands);
  const state = createGpuState(device, c);
  upload(state, c);
  // THE CONSTS, WITHOUT WHICH THE PASS REJECTS EVERY LIP. The sheet is bounded
  // by the active box exactly as the builder is, and the box lives here — left
  // at whatever the buffer was made with, it is empty and the answer is nought
  // quads with no complaint from anybody. The first run of this reported the
  // device building no sheet at all and the fault was here, not there.
  const p2 = c.params;
  writeConsts(state, {
    x0: 0, y0: 0, x1: c.nx - 1, y1: c.ny - 1,
    gain: 0, bedGain: 0, hMax: 0, minHead: 0, spread: 0, dt: 1 / 60,
    windDepth: 2.5, dryDepth: p2.dryDepth, fallMin: FALL_MIN,
    openEdge: c.openEdge, rimMaterial: c.rimMaterial, rimHeld: c.rim !== null,
    slots: c.layers, gravity: p2.gravity, breaking: p2.breaking, diffScale: 0,
    room: dripRoom(c.drips), cell: c.cell, cliffN: c.falls.cliffN,
    frameDt: 1 / 60, arriveN: 0, wantN: 0,
  }, c.wnx, c.wstride);
  device.queue.writeBuffer(state.reduce, 0, reduceSeed(c.nx, c.ny));
  // The carried fields are not in `upload` — they belong to the renderer, and
  // the sheet samples both at the lips. Written straight in.
  device.queue.writeBuffer(state.field, state.offset.washNow * 4, wash.now);
  device.queue.writeBuffer(state.field, state.offset.foamNow * 4, foam.now);

  const sys = renderer as unknown as {
    buffer: { getGPUBuffer: (b: unknown) => GPUBuffer };
    texture: { getGpuSource: (s: unknown) => GPUTexture };
  };
  const sheet = createSheet(device, bands.bands.length, SHEET_CAP);
  sheet.bind(sys.texture.getGpuSource(water.tint).createView());
  sheet.say(HW, HH, HEIGHT_UNIT, scale, bands.bands.length, SHEET_CAP,
    COLUMNS_PER_TILE, size);

  const enc = device.createCommandEncoder({ label: "sheet compare" });
  sheet.encode(enc, state, c.falls.cliffN);
  sheet.spill(enc, gfl.verts.map((v) => sys.buffer.getGPUBuffer(v)));
  sheet.copy(enc);
  device.queue.submit([enc.finish()]);
  // WAIT ON THE QUEUE AND NOT ON A FRAME. The counts come back by a mapping,
  // and the obvious way to wait for one is to tick a few rAFs — which stops
  // dead the moment the pane is not on screen, and then this hangs rather than
  // reporting. Nothing here draws until the shots at the end, so there is no
  // reason to want a frame at all.
  await device.queue.onSubmittedWorkDone();
  sheet.fetch();
  let counts: Uint32Array | null = null;
  for (let n = 0; n < 200 && !counts; n++) {
    await new Promise((r) => setTimeout(r, 4));
    counts = sheet.says();
  }
  drawGpuFalls(gfl, counts);

  let deviceQuads = 0;
  if (counts) for (const n of counts) deviceQuads += Math.min(n, SHEET_CAP);
  let hostQuads = 0;
  for (const b of host.live) hostQuads += host.strips[b].n;

  // Each alone, into its own texture.
  const hostOn = host.strips.map((s) => s.mesh.visible);
  const devOn = gfl.meshes.map((m) => m.visible);
  const show = (which: "host" | "device") => {
    host.strips.forEach((s, i) => { s.mesh.visible = which === "host" && hostOn[i]; });
    gfl.meshes.forEach((m, i) => { m.visible = which === "device" && devOn[i]; });
  };
  const shoot = (which: "host" | "device") => {
    show(which);
    const target = RenderTexture.create({ width: px, height: px, antialias: false });
    renderer.render({ container: bands.root, target, clear: true });
    const out = renderer.extract.pixels(target);
    target.destroy(true);
    return out.pixels;
  };
  const a = shoot("host");
  const b = shoot("device");

  let drawn = 0, differing = 0, worst = 0, total = 0, onlyHost = 0, onlyDevice = 0;
  for (let i = 0; i < a.length; i += 4) {
    const aOn = a[i + 3] > 2, bOn = b[i + 3] > 2;
    if (!aOn && !bOn) continue;
    drawn++;
    if (aOn && !bOn) onlyHost++;
    if (bOn && !aOn) onlyDevice++;
    let d = 0;
    for (let k = 0; k < 4; k++) d = Math.max(d, Math.abs(a[i + k] - b[i + k]));
    total += d;
    if (d > worst) worst = d;
    if (d > tolerance) differing++;
  }

  destroyFallLayer(host);
  destroyGpuFallLayer(gfl);
  destroyGpuWaterLayer(water);
  sheet.destroy();
  state.destroy?.();
  bands.root.destroy({ children: true });

  const lips = c.falls.cliffN;
  let air = 0;
  for (const v of c.falls.air) air += v;
  // Which storey each lip's water is LEAVING, off the packed edge — the twin
  // of the decode in fluid/falls. @see fallEdge
  let deckLips = 0;
  for (let k = 0; k < lips; k++) {
    const edge = c.falls.cliff[k];
    const plane = Math.floor(edge / (c.cells * 2));
    if (Math.floor(plane / c.layers) > 0) deckLips++;
  }
  return {
    scene: span ? "span" : "cliff",
    lips, air: +air.toFixed(4), deckLips, hostQuads, deviceQuads,
    drawn, differing, worst, mean: drawn ? total / drawn : 0,
    onlyHost, onlyDevice,
    // A SHEET HAS TO HAVE BEEN BUILT, on BOTH sides, or there is nothing here
    // to agree about — the surest way to pass this is to compare two empty
    // pictures. @see hostQuads
    ok: lips > 0 && hostQuads > 0 && deviceQuads > 0
      && (!span || deckLips > 0)
      && differing === 0 && onlyHost === 0 && onlyDevice === 0,
    why: span && deckLips === 0
      ? "no lip is on the deck: the span scene is not asking the question"
      : lips === 0 ? "no lips: the scene never spilled, so nothing was compared"
      : hostQuads === 0 && deviceQuads === 0
        ? "neither builder made a quad: nothing was compared"
        : hostQuads === 0 ? "the host built no sheet where the device did"
          : deviceQuads === 0 ? "the device built no sheet where the host did"
            : differing === 0 ? null
              : `${differing} of ${drawn} pixels differ, worst ${worst}`,
  };
}
