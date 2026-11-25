import { describe, expect, test } from "bun:test";

import { HEIGHT_UNIT, HH, HW } from "../../iso";
import { AI_TRUCK_COLOUR, VAN_COLOUR } from "../town";
import { readFileSync } from "node:fs";

import { baseCorners, cutRun, headingIndex, modelFor, pagesOf, pitchMatrix, poseOf, type CarLook } from "./car-sheet";
import { CAR_GAP, CAR_HEADINGS, CAR_PITCHES, PITCH_HEADINGS, type CarSheet } from "./sheet-format";
import { BUS_WEIGHTS, CAR_WEIGHTS, LORRY_WEIGHTS, MINIBUS_WEIGHTS, MODELS, TILES_PER_M, VAN_WEIGHTS, pitchAngle, type Model } from "./models";
import { BUS_COLOUR, halfLength, SHUTTLE_COLOUR } from "./fleet";
import { bakeFrame } from "./raster";

const box: Model = {
  id: "box", length: 2, width: 1,
  slabs: [{ l0: 1, l1: -1, w: 0.5, z0: 0, z1: 1, mat: "paint", faces: { top: "trim" } }],
  wheels: [],
};

describe("bakeFrame", () => {
  test("the same model and heading bake the same pixels", () => {
    const a = bakeFrame(MODELS[0], 0.7, 2), b = bakeFrame(MODELS[0], 0.7, 2);
    expect(a.ox).toBe(b.ox);
    expect(Buffer.from(a.paint.px).equals(Buffer.from(b.paint.px))).toBe(true);
    expect(Buffer.from(a.trim.px).equals(Buffer.from(b.trim.px))).toBe(true);
  });

  test("a box covers its middle, painted on its sides and trimmed on its top", () => {
    const f = bakeFrame(box, 0, 4);
    const at = (img: typeof f.paint, x: number, y: number) => img.px[(Math.round(y) * img.w + Math.round(x)) * 4 + 3];
    // Half a metre up, at the middle: a side face (paint) of the box seen from the front-right.
    const up = 0.5 * (TILES_PER_M / 0.2041) * HEIGHT_UNIT * 4;
    expect(at(f.paint, f.ox, f.oy - up / 2)).toBeGreaterThan(200);
    // A metre up, just behind the middle: the top, which is trim.
    const top = 1 * (TILES_PER_M / 0.2041) * HEIGHT_UNIT * 4;
    expect(at(f.trim, f.ox, f.oy - top - 2)).toBeGreaterThan(200);
  });

  test("paint is baked colourless, so a tint gives it its colour", () => {
    const f = bakeFrame(MODELS[1], 1.3, 2);
    for (let i = 0; i < f.paint.px.length; i += 4) {
      if (!f.paint.px[i + 3]) continue;
      expect(f.paint.px[i]).toBe(f.paint.px[i + 1]);
      expect(f.paint.px[i + 1]).toBe(f.paint.px[i + 2]);
    }
  });

  test("the origin is inside the frame at every heading, and the frame isn't wastefully large", () => {
    for (const m of MODELS) for (let h = 1; h < 32; h += 8) {
      const f = bakeFrame(m, (h / 32) * Math.PI * 2, 2);
      expect(f.ox).toBeGreaterThan(0); expect(f.ox).toBeLessThan(f.paint.w);
      expect(f.oy).toBeGreaterThan(0); expect(f.oy).toBeLessThan(f.paint.h);
      // Longest way round, at 2 texels a px, with the shadow's reach.
      // (Or, for what overhangs its own body — a crane's boom — as far as that reaches, either way.)
      const reach = (Math.max(m.length, 2 * (m.overhang ?? 0)) + 0.8) * TILES_PER_M * HW * 2 * 2;
      expect(f.paint.w).toBeLessThan(reach + 8);
    }
  }, 90_000);
});

describe("in the game", () => {
  test("a mover keeps its model, and vans are vans", () => {
    for (let id = 0; id < 50; id++) expect(modelFor({ id, kind: "car", colour: 0 })).toBe(modelFor({ id, kind: "car", colour: 0 }));
    const picks = Array.from({ length: 4000 }, (_, id) => modelFor({ id, kind: "car", colour: 0 }));
    // Every car model shows up, and the common ones far more often than the rare.
    expect(new Set(picks)).toEqual(new Set(Object.keys(CAR_WEIGHTS)));
    const count = (id: string) => picks.filter((p) => p === id).length;
    expect(count("hatchback")).toBeGreaterThan(count("largeSuv+box") * 5);
    for (const id of new Set(picks)) expect(MODELS.some((m) => m.id === id)).toBe(true);
    const vans = new Set(Array.from({ length: 200 }, (_, id) => modelFor({ id, kind: "truck", colour: VAN_COLOUR })));
    expect(vans).toEqual(new Set(Object.keys(VAN_WEIGHTS)));
    const lorries = new Set(Array.from({ length: 200 }, (_, id) => modelFor({ id, kind: "truck", colour: 0xd98c2b })));
    expect(lorries).toEqual(new Set(Object.keys(LORRY_WEIGHTS)));
    expect(modelFor({ id: 3, kind: "truck", colour: AI_TRUCK_COLOUR })).toBe("machineLorry");
    for (const id of [...vans, ...lorries]) expect(MODELS.some((m) => m.id === id)).toBe(true);
    expect(modelFor({ id: 3, kind: "limo", colour: 0 })).toBe("limo");
    const buses = (colour: number) => new Set(Array.from({ length: 200 }, (_, id) => modelFor({ id, kind: "bus", colour })));
    expect(buses(SHUTTLE_COLOUR)).toEqual(new Set(Object.keys(BUS_WEIGHTS)));
    expect(buses(BUS_COLOUR)).toEqual(new Set(Object.keys(MINIBUS_WEIGHTS)));
    expect(modelFor({ id: 3, kind: "person", colour: 0 })).toBeNull();
  });

  test("headings snap to the nearest of the frames, round the turn", () => {
    const step = (Math.PI * 2) / 32;
    expect(headingIndex(0, 32)).toBe(0);
    expect(headingIndex(step * 0.6, 32)).toBe(1);
    expect(headingIndex(-step, 32)).toBe(31);
    expect(headingIndex(Math.PI * 2, 32)).toBe(0);
  });

  test("the base is the car's footprint turned to its heading", () => {
    const c = baseCorners({ length: 0.4, width: 0.2 }, Math.PI / 2);
    expect(c.map((p) => [+p.u.toFixed(3), +p.v.toFixed(3)])).toEqual([[-0.1, 0.2], [0.1, 0.2], [-0.1, -0.2], [0.1, -0.2]]);
  });

  test("on a ramp, along the heading rises by the pitch and across it stays", () => {
    expect(pitchMatrix(0.4, 0)).toBeNull();
    for (const heading of [0.3, 1.2, 2.5, 4]) {
      const ch = Math.cos(heading), sh = Math.sin(heading);
      const M = pitchMatrix(heading, 2)!;
      const along = M.apply({ x: (ch - sh) * HW, y: (ch + sh) * HH });
      expect(along.x).toBeCloseTo((ch - sh) * HW);
      expect(along.y).toBeCloseTo((ch + sh) * HH - 2 * HEIGHT_UNIT);
      const across = M.apply({ x: (-sh - ch) * HW, y: (-sh + ch) * HH });
      expect(across.x).toBeCloseTo((-sh - ch) * HW);
      expect(across.y).toBeCloseTo((-sh + ch) * HH);
    }
  });

  test("a vehicle is as long as its model: a bus far longer than a city car, nobody on foot", () => {
    const len = (kind: "car" | "bus" | "person", colour = 0) => {
      let most = 0, least = Infinity;
      for (let id = 0; id < 200; id++) { const h = halfLength({ id, kind, colour }); most = Math.max(most, h); least = Math.min(least, h); }
      return { most, least };
    };
    expect(len("bus", SHUTTLE_COLOUR).least).toBeGreaterThan(len("car").most);
    expect(len("car").least).toBeCloseTo((3.55 * TILES_PER_M) / 2);
    expect(len("person").most).toBe(0);
  });
});

describe("a vehicle on a slope", () => {
  // A thin plate a metre up, four metres long: where its ends are drawn says how it is turned.
  const plate: Model = { id: "plate", length: 4, width: 1, slabs: [{ l0: 2, l1: -2, w: 0.5, z0: 1, z1: 1.05, mat: "trim" }], wheels: [] };
  /** The trim's covered texels' bounds, about the origin. */
  const bounds = (pitch: number, heading = 0) => {
    const f = bakeFrame(plate, heading, 4, pitch);
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (let y = 0; y < f.trim.h; y++) for (let x = 0; x < f.trim.w; x++) {
      if (f.trim.px[(y * f.trim.w + x) * 4 + 3] < 200) continue;
      x0 = Math.min(x0, x - f.ox); x1 = Math.max(x1, x - f.ox); y0 = Math.min(y0, y - f.oy); y1 = Math.max(y1, y - f.oy);
    }
    return { x0, x1, y0, y1 };
  };

  test("a whole step a tile is 22°, half a step 11.5°", () => {
    expect((pitchAngle(2) * 180) / Math.PI).toBeCloseTo(22.2, 1);
    expect((pitchAngle(1) * 180) / Math.PI).toBeCloseTo(11.5, 1);
    expect(pitchAngle(0)).toBe(0);
  });

  test("is baked turned as it stands: shorter along the ground by the slope's cosine, its roof back and its nose up — not sheared", () => {
    const level = bounds(0), up = bounds(2);
    // Heading +x the plate runs down-right on the screen: its width there is its run along the ground.
    const run = (b: { x0: number; x1: number }) => b.x1 - b.x0;
    // (Its thickness and its width across add the same to both; what is along it shrinks by cos 22°.)
    const along = 4 * TILES_PER_M * 66 * 4;
    expect(run(level) - run(up)).toBeGreaterThan(along * (1 - Math.cos(pitchAngle(2))) - 3);
    expect(run(level) - run(up)).toBeLessThan(along * (1 - Math.cos(pitchAngle(2))) + 3);
    // Its middle, a metre up, has gone back along the road by sin 22° of that metre: up-left on the screen.
    const mid = (b: { x0: number; x1: number }) => (b.x0 + b.x1) / 2;
    expect(mid(level) - mid(up)).toBeGreaterThan(1 * Math.sin(pitchAngle(2)) * TILES_PER_M * 66 * 4 - 3);
    // Down a slope, the other way: forward.
    expect(mid(bounds(-2)) - mid(level)).toBeGreaterThan(1 * Math.sin(pitchAngle(2)) * TILES_PER_M * 66 * 4 - 3);
  });

  test("level, it bakes as it always did; and each pitch its own pixels", () => {
    const a = bakeFrame(MODELS[0], 0, 2), b = bakeFrame(MODELS[0], 0, 2, 0), c = bakeFrame(MODELS[0], 0, 2, 2);
    expect(Buffer.from(a.trim.px).equals(Buffer.from(b.trim.px))).toBe(true);
    expect(c.trim.w !== a.trim.w || !Buffer.from(a.trim.px).equals(Buffer.from(c.trim.px))).toBe(true);
  });

  const runOf = (tag: string) => ({ at: () => tag }) as unknown as CarLook["tilted"][number];
  const look = { ...runOf("level"), id: "x", length: 1, width: 1, tilted: CAR_PITCHES.map((q) => runOf(`p${q}`)) } as CarLook;
  const sheet = { headings: CAR_HEADINGS, pitches: [...CAR_PITCHES], pitchHeadings: PITCH_HEADINGS };

  test("is drawn from the frame baked nearest its slope, heading one of a road's four ways; the rest of its pitch sheared", () => {
    // Level: its heading's own frame.
    expect(poseOf(sheet, look, 5, 0)).toMatchObject({ from: look, k: 5, lean: 0, shear: 0 });
    // Up a whole-step ramp heading +y (a quarter turn): the frame leant two half steps, nothing left to shear.
    expect(poseOf(sheet, look, 8, 2)).toMatchObject({ from: look.tilted[3], k: 1, lean: 2, shear: 0 });
    expect(poseOf(sheet, look, 8, 2).heading).toBeCloseTo(Math.PI / 2, 9);
    // Down it; and on a half-step ramp.
    expect(poseOf(sheet, look, 24, -2)).toMatchObject({ from: look.tilted[0], k: 3, lean: -2 });
    expect(poseOf(sheet, look, 0, 1)).toMatchObject({ from: look.tilted[2], k: 0, lean: 1, shear: 0 });
    // Coming onto a ramp, its nose on it: the nearest baked, and the difference sheared.
    const on = poseOf(sheet, look, 16, 1.4);
    expect(on).toMatchObject({ from: look.tilted[2], k: 2, lean: 1 });
    expect(on.shear).toBeCloseTo(0.4, 9);
    expect(poseOf(sheet, look, 16, 0.3)).toMatchObject({ from: look, lean: 0, shear: 0.3 });
    // Changing lane on a ramp, a frame's turn off the road's way: drawn straight, leant.
    expect(poseOf(sheet, look, 31, 2)).toMatchObject({ from: look.tilted[3], k: 0, lean: 2 });
    expect(poseOf(sheet, look, 9, 2)).toMatchObject({ from: look.tilted[3], k: 1, lean: 2 });
    // Any other heading on a slope: its level frame, sheared the whole way.
    expect(poseOf(sheet, look, 4, 2)).toMatchObject({ from: look, k: 4, lean: 0, shear: 2 });
    // A sheet baked without them: sheared, as it was.
    expect(poseOf({ headings: CAR_HEADINGS, pitches: [], pitchHeadings: 0 }, { ...look, tilted: [] }, 8, 2)).toMatchObject({ from: expect.anything(), k: 8, shear: 2 });
  });

  test("a frame is cut when it is first asked for, once; and a model's pages are all its frames' and lamps'", () => {
    const disk: CarSheet = JSON.parse(readFileSync("public/isometric_assets/derived/cars.json", "utf8"));
    for (const m of Object.values(disk.models)) {
      const run = cutRun(m.frames, disk.over ?? 0), k = 3, f = m.frames[k], a = run.at(k);
      expect(run.at(k)).toBe(a);
      expect(a.trim.tex.frame).toMatchObject({ x: f[1] + f[3] + CAR_GAP, y: f[2], width: f[7], height: f[8] });
      expect(a.over.length).toBe(disk.over ?? 0);
      expect(a.lamps.length + a.over.length).toBe((f.length - 11) / 7);
      const pages = pagesOf(m);
      for (const fr of m.frames) { expect(pages).toContain(fr[0]); for (let q = 11; q < fr.length; q += 7) if (fr[q + 3]) expect(pages).toContain(fr[q]); }
    }
  });

  test("the sheet on disk has every model leant at every pitch, each of a road's four ways", () => {
    const disk: CarSheet = JSON.parse(readFileSync("public/isometric_assets/derived/cars.json", "utf8"));
    expect(disk.pitches).toEqual([...CAR_PITCHES]);
    expect(disk.pitchHeadings).toBe(PITCH_HEADINGS);
    for (const m of MODELS) {
      const e = disk.models[m.id];
      expect(e.frames.length).toBe(CAR_HEADINGS);
      expect(e.tilted!.length).toBe(CAR_PITCHES.length);
      for (const run of e.tilted!) { expect(run.length).toBe(PITCH_HEADINGS); for (const f of run) expect(f[7]).toBeGreaterThan(0); }
    }
  });
});
