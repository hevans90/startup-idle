/**
 * A gallery of every vehicle model at eight headings, painted, on road grey:
 * for looking at models while making them. Not shipped.
 *
 *     bun run dev/preview-cars.ts out.png
 */
import { writeFileSync } from "node:fs";
import { encodePng } from "./png-min.ts";
import { MODELS } from "../src/world/agents/cars/models.ts";
import { bakeFrame } from "../src/world/agents/cars/raster.ts";
const RES = 6, HEADS = [0, 4, 8, 12, 16, 20, 24, 28], CELL = 260;
const tints = [[0.75, 0.12, 0.1], [0.18, 0.36, 0.62], [0.92, 0.92, 0.9]];
const W = CELL * HEADS.length, H = CELL * MODELS.length;
const px = new Uint8Array(W * H * 4);
for (let i = 0; i < W * H; i++) { px[i * 4] = 92; px[i * 4 + 1] = 94; px[i * 4 + 2] = 98; px[i * 4 + 3] = 255; }
MODELS.forEach((m, r) => HEADS.forEach((h, c) => {
  const b = bakeFrame(m, (h / 32) * Math.PI * 2, RES);
  const t = tints[r % 3];
  const bx = c * CELL + CELL / 2 - b.ox, by = r * CELL + CELL / 2 - b.oy;
  for (let y = 0; y < b.paint.h; y++) for (let x = 0; x < b.paint.w; x++) {
    const X = bx + x, Y = by + y; if (X < 0 || Y < 0 || X >= W || Y >= H) continue;
    const o = (Y * W + X) * 4, s = (y * b.paint.w + x) * 4;
    for (const [img, tint] of [[b.paint, t], [b.trim, [1, 1, 1]]] as const) {
      const a = img.px[s + 3] / 255; if (!a) continue;
      for (let k = 0; k < 3; k++) px[o + k] = Math.round(px[o + k] * (1 - a) + img.px[s + k] * tint[k] * a);
    }
  }
}));
writeFileSync(process.argv[2], encodePng({ w: W, h: H, px }));
