/**
 * A gallery of the houses: each kit stood up to its full height and as it
 * starts, its walls tinted, on grass green. For looking at houses while
 * making them. Not shipped.
 *
 *     bun run dev/preview-houses.ts out.png [RES] [id,id,…]
 */
import { writeFileSync } from "node:fs";
import { encodePng } from "./png-min.ts";
import { bakeTris, type Tri } from "../src/world/agents/cars/raster.ts";
import { HALF_STEPS_PER_M } from "../src/world/agents/cars/models.ts";
import { HOUSES, houseLayerOf } from "../src/world/houses/models.ts";
import { HOUSE_LAYERS } from "../src/world/houses/houses-format.ts";
import { HEIGHT_UNIT } from "../src/world/iso.ts";

const RES = Number(process.argv[3] ?? 2.5);
const only = process.argv[4]?.split(",");
const SHOWN = only ? HOUSES.filter((h) => only.includes(h.id)) : HOUSES;
const COLS = 4, CW = Math.round(150 * RES), CH = Math.round(330 * RES);
const ROWS = Math.ceil(SHOWN.length / COLS) * 2;
const W = CW * COLS, H = CH * ROWS;
const px = new Uint8Array(W * H * 4);
for (let i = 0; i < W * H; i++) { px[i * 4] = 124; px[i * 4 + 1] = 158; px[i * 4 + 2] = 92; px[i * 4 + 3] = 255; }

function draw(tris: Tri[], shadow: boolean, h: (typeof HOUSES)[number], cx: number, cy: number, tint: number) {
  const b = bakeTris(tris, 0, RES, { layers: HOUSE_LAYERS, layerOf: houseLayerOf, shadow: shadow ? h.shadow : { ...h.shadow, strength: 0 } });
  const t = [tint, 0xffffff].map((c) => [(c >> 16) / 255, ((c >> 8) & 255) / 255, (c & 255) / 255]);
  b.layers.forEach((img, k) => {
    for (let y = 0; y < img.h; y++) for (let x = 0; x < img.w; x++) {
      const X = Math.round(cx - b.ox) + x, Y = Math.round(cy - b.oy) + y; if (X < 0 || Y < 0 || X >= W || Y >= H) continue;
      const s = (y * img.w + x) * 4, a = img.px[s + 3] / 255; if (!a) continue;
      const o = (Y * W + X) * 4;
      for (let j = 0; j < 3; j++) px[o + j] = Math.round(px[o + j] * (1 - a) + img.px[s + j] * t[k][j] * a);
    }
  });
}

SHOWN.forEach((h, n) => {
  const parts = h.parts(), lift = h.storey * HALF_STEPS_PER_M * HEIGHT_UNIT * RES;
  for (const [row, floors] of [[0, h.floors], [1, Math.min(h.floors, 2)]] as const) {
    const cx = (n % COLS) * CW + CW / 2, cy = (Math.floor(n / COLS) * 2 + row) * CH + CH - 45 * RES;
    const tint = h.tints[(n + row) % h.tints.length];
    draw(parts.ground, true, h, cx, cy, tint);
    for (let f = 1; f < floors; f++) draw(parts.mids[(n + f) % parts.mids.length], false, h, cx, cy - (f - 1) * lift, tint);
    draw(parts.roof, false, h, cx, cy - (floors - 1) * lift, tint);
  }
});
writeFileSync(process.argv[2], encodePng({ w: W, h: H, px }));
