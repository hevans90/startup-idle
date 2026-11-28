/**
 * A gallery of the crops: each in each look, a tile of four patches, its leaves tinted as at the look's height of
 * the year, on soil brown. For looking at crops while making them. Not shipped.
 *
 *     bun run dev/preview-crops.ts out.png [RES]
 */
import { writeFileSync } from "node:fs";
import { encodePng } from "./png-min.ts";
import { bakeTris } from "../src/world/agents/cars/raster.ts";
import { HH, HW } from "../src/world/iso.ts";
import { PROP_LAYERS, propLayerOf } from "../src/world/props/models.ts";
import { CROP_KINDS, CROP_LOOKS } from "../src/world/props/crop-models.ts";
import { leafColour } from "../src/world/calendar.ts";

const RES = Number(process.argv[3] ?? 2.5);
const STATES = ["bud", "full", "thin", "bare", "snow"] as const;
/** When each look is seen at its best, a share of the year. */
const WHEN: Record<string, number> = { bud: 0.75, full: 0.18, thin: 0.36, bare: 0.5, snow: 0.85 };
const CW = Math.round(HW * 2 * RES + 40), CH = Math.round(HH * 2 * RES + 120);
const W = CW * STATES.length, H = CH * CROP_KINDS.length;
const px = new Uint8Array(W * H * 4);
for (let i = 0; i < W * H; i++) { px[i * 4] = 110; px[i * 4 + 1] = 82; px[i * 4 + 2] = 56; px[i * 4 + 3] = 255; }
CROP_KINDS.forEach((kind, r) => STATES.forEach((state, c) => {
  const look = CROP_LOOKS.find((l) => l.id === kind && l.state === state)!;
  const lc = leafColour(kind, kind === "rape" && state === "full" ? 0.2 : WHEN[state]);
  const tint = [[(lc >> 16) / 255, ((lc >> 8) & 255) / 255, (lc & 255) / 255], [1, 1, 1]];
  // The tile's four patches, back to front, each on its front corner.
  for (const [du, dv] of [[0, 0], [0.5, 0], [0, 0.5], [0.5, 0.5]]) {
    const b = bakeTris(look.tris(0), 0, RES, { layers: PROP_LAYERS, layerOf: propLayerOf, shadow: look.shadow });
    const fx = c * CW + CW / 2 + (du - dv) * HW * RES, fy = r * CH + CH - 20 + (du + dv - 1) * HH * RES;
    const bx = Math.round(fx - b.ox), by = Math.round(fy - b.oy);
    b.layers.forEach((img, k) => {
      for (let y = 0; y < img.h; y++) for (let x = 0; x < img.w; x++) {
        const X = bx + x, Y = by + y; if (X < 0 || Y < 0 || X >= W || Y >= H) continue;
        const s = (y * img.w + x) * 4, a = img.px[s + 3] / 255; if (!a) continue;
        const o = (Y * W + X) * 4;
        for (let j = 0; j < 3; j++) px[o + j] = Math.round(px[o + j] * (1 - a) + img.px[s + j] * tint[k][j] * a);
      }
    });
  }
}));
writeFileSync(process.argv[2], encodePng({ w: W, h: H, px }));
