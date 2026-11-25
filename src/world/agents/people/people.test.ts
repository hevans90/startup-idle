import { readFileSync } from "node:fs";
import { describe, expect, test } from "bun:test";
import { Texture } from "pixi.js";

import { bakeTris } from "../cars/raster";
import { FIGURE_WEIGHTS, figureFor, heightOf } from "./cast";
import { FIGURES, figureTris, layerOfMat, PERSON_LAYERS } from "./figures";
import { PERSON_GAP, PERSON_RES, PERSON_SHADOW, type PeopleSheet } from "./people-format";
import { cutSet } from "./people-sheet";

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
    for (const f of FIGURES) for (const t of figureTris(f, 0.3, "walk", 1)) {
      const k = layerOfMat(t.mat);
      expect(k).toBeGreaterThanOrEqual(0); expect(k).toBeLessThan(PERSON_LAYERS.length);
    }
  });

  test("a frame bakes the same pixels twice, and a walker stands on their origin", () => {
    const f = FIGURES[0];
    const bake = () => bakeTris(figureTris(f, 1.1, "walk", 1), 0.4, PERSON_RES, { layers: PERSON_LAYERS.length, layerOf: layerOfMat, shadow: PERSON_SHADOW });
    const a = bake(), b = bake();
    expect(a.ox).toBe(b.ox); expect(a.oy).toBe(b.oy);
    a.layers.forEach((l, i) => expect(Buffer.from(l.px).equals(Buffer.from(b.layers[i].px))).toBe(true));
    expect(a.oy).toBeGreaterThan(a.layers[0].h * 0.6);
  });

  test("a frame is cut when it is first asked for, once: its layers side by side in its page", () => {
    const disk: PeopleSheet = JSON.parse(readFileSync("public/isometric_assets/derived/people.json", "utf8"));
    const sources = disk.pages.map(() => Texture.WHITE.source);
    for (const fig of Object.values(disk.figures)) for (const set of Object.values(fig)) {
      const run = cutSet(set, disk.layers, sources), k = set.length - 1, f = set[k], a = run.at(k);
      expect(run.at(k)).toBe(a);
      expect(a.tex.length).toBe(disk.layers);
      let x = f[1];
      a.tex.forEach((t, q) => {
        const [w, h, ox, oy] = f.slice(3 + q * 4, 7 + q * 4);
        if (w) { expect(t.frame).toMatchObject({ x, y: f[2], width: w, height: h }); expect(a.anchor[q]).toEqual({ x: ox / w, y: oy / h }); }
        else expect(t).toBe(Texture.EMPTY);
        x += w + PERSON_GAP;
      });
    }
  });
});
