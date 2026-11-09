import { describe, expect, test } from "bun:test";

import { bakeTris } from "../cars/raster";
import { FIGURE_WEIGHTS, figureFor, heightOf } from "./cast";
import { FIGURES, figureTris, layerOfMat, PERSON_LAYERS } from "./figures";
import { PERSON_RES, PERSON_SHADOW } from "./people-format";

describe("figures", () => {
  test("every walker's figure is one that's baked, and a crew wears hi-vis", () => {
    const ids = new Set(FIGURES.map((f) => f.id));
    for (const id of Object.keys(FIGURE_WEIGHTS)) expect(ids.has(id)).toBe(true);
    const picks = new Set(Array.from({ length: 2000 }, (_, id) => figureFor({ id, job: undefined })));
    expect(picks).toEqual(new Set(Object.keys(FIGURE_WEIGHTS)));
    for (let id = 0; id < 50; id++) expect(figureFor({ id, job: undefined })).toBe(figureFor({ id, job: undefined }));
    expect(figureFor({ id: 4, job: { role: "build" } as never })).toBe("builder");
    expect(figureFor({ id: 4, job: { role: "moving-in" } as never })).not.toBe("builder");
  });

  test("heights differ by about a tenth either way", () => {
    for (let id = 0; id < 500; id++) { const h = heightOf(id); expect(h).toBeGreaterThanOrEqual(0.92); expect(h).toBeLessThan(1.06); }
  });

  test("every material lands on one of the five layers", () => {
    for (const f of FIGURES) for (const t of figureTris(f, 0.3, false, 1)) {
      const k = layerOfMat(t.mat);
      expect(k).toBeGreaterThanOrEqual(0); expect(k).toBeLessThan(PERSON_LAYERS.length);
    }
  });

  test("a frame bakes the same pixels twice, and a walker stands on their origin", () => {
    const f = FIGURES[0];
    const bake = () => bakeTris(figureTris(f, 1.1, false, 1), 0.4, PERSON_RES, { layers: PERSON_LAYERS.length, layerOf: layerOfMat, shadow: PERSON_SHADOW });
    const a = bake(), b = bake();
    expect(a.ox).toBe(b.ox); expect(a.oy).toBe(b.oy);
    a.layers.forEach((l, i) => expect(Buffer.from(l.px).equals(Buffer.from(b.layers[i].px))).toBe(true));
    expect(a.oy).toBeGreaterThan(a.layers[0].h * 0.6);
  });
});
