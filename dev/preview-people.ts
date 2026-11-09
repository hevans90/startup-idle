/**
 * A gallery of the town's people: each figure at eight headings, then one
 * through its walk, tinted, on pavement grey. For looking at figures while
 * making them. Not shipped.
 *
 *     bun run dev/preview-people.ts out.png [RES] [id,id,…]
 */
import { writeFileSync } from "node:fs";
import { encodePng } from "./png-min.ts";
import { FIGURES, figureTris, layerOfMat, PERSON_LAYERS } from "../src/world/agents/people/figures.ts";
import { bakeTris } from "../src/world/agents/cars/raster.ts";
import { PERSON_SHADOW } from "../src/world/agents/people/people-format.ts";

const RES = Number(process.argv[3] ?? 6);
const only = process.argv[4]?.split(",");
const SHOWN = only ? FIGURES.filter((f) => only.includes(f.id)) : FIGURES;
const CELL = Math.round(15 * RES), COLS = 8 + 6;
const TINTS = [[0.93, 0.76, 0.6], [0.22, 0.26, 0.36], [0.72, 0.22, 0.2], [0.24, 0.17, 0.11], [1, 1, 1]];
const W = CELL * COLS, H = CELL * SHOWN.length;
const px = new Uint8Array(W * H * 4);
for (let i = 0; i < W * H; i++) { px[i * 4] = 150; px[i * 4 + 1] = 148; px[i * 4 + 2] = 142; px[i * 4 + 3] = 255; }
SHOWN.forEach((f, r) => {
  for (let c = 0; c < COLS; c++) {
    const heading = c < 8 ? (c / 8) * Math.PI * 2 : Math.PI / 4;
    const phase = c < 8 ? 0.6 : ((c - 8) / 6) * Math.PI * 2;
    const near = -Math.sin(heading) + Math.cos(heading) >= 0 ? 1 : -1;
    const b = bakeTris(figureTris(f, phase, false, near), heading, RES, { layers: PERSON_LAYERS.length, layerOf: layerOfMat, shadow: PERSON_SHADOW });
    const bx = Math.round(c * CELL + CELL / 2 - b.ox), by = Math.round(r * CELL + CELL * 0.85 - b.oy);
    b.layers.forEach((img, k) => {
      for (let y = 0; y < img.h; y++) for (let x = 0; x < img.w; x++) {
        const X = bx + x, Y = by + y; if (X < 0 || Y < 0 || X >= W || Y >= H) continue;
        const s = (y * img.w + x) * 4, a = img.px[s + 3] / 255; if (!a) continue;
        const o = (Y * W + X) * 4;
        for (let j = 0; j < 3; j++) px[o + j] = Math.round(px[o + j] * (1 - a) + img.px[s + j] * TINTS[k][j] * a);
      }
    });
  }
});
writeFileSync(process.argv[2], encodePng({ w: W, h: H, px }));
