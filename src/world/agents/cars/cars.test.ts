import { describe, expect, test } from "bun:test";

import { HEIGHT_UNIT, HH, HW } from "../../iso";
import { AI_TRUCK_COLOUR, VAN_COLOUR } from "../town";
import { baseCorners, headingIndex, modelFor, pitchMatrix } from "./car-sheet";
import { CAR_WEIGHTS, LORRY_WEIGHTS, MODELS, TILES_PER_M, VAN_WEIGHTS, type Model } from "./models";
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
      const reach = (m.length + 0.8) * TILES_PER_M * HW * 2 * 2;
      expect(f.paint.w).toBeLessThan(reach + 8);
    }
  }, 30_000);
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
});
