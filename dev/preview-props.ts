/**
 * A gallery of the props: each at its four turns, its leaves or cloth tinted,
 * on pavement grey. For looking at props while making them. Not shipped.
 *
 *     bun run dev/preview-props.ts out.png [RES] [id,id,…]
 */
import { writeFileSync } from "node:fs";
import { encodePng } from "./png-min.ts";
import { bakeTris } from "../src/world/agents/cars/raster.ts";
import { PROPS, PROP_LAYERS, propLayerOf } from "../src/world/props/models.ts";
import { PROP_TINT } from "../src/world/props/props-format.ts";

const RES = Number(process.argv[3] ?? 3);
const only = process.argv[4]?.split(",");
const SHOWN = only ? PROPS.filter((p) => only.includes(p.id)) : PROPS;
const bakes = SHOWN.map((p) => [0, 1, 2, 3].map((k) => bakeTris(p.tris(), (k / 4) * Math.PI * 2, RES, { layers: PROP_LAYERS, layerOf: propLayerOf, shadow: p.shadow })));
const CW = Math.max(...bakes.flat().map((b) => b.layers[0].w)) + 8, CH = Math.max(...bakes.flat().map((b) => b.layers[0].h)) + 8;
const W = CW * 4, H = CH * SHOWN.length;
const px = new Uint8Array(W * H * 4);
for (let i = 0; i < W * H; i++) { px[i * 4] = 150; px[i * 4 + 1] = 148; px[i * 4 + 2] = 142; px[i * 4 + 3] = 255; }
SHOWN.forEach((p, r) => bakes[r].forEach((b, c) => {
  const tint = [PROP_TINT[p.id] ?? 0xffffff, 0xffffff].map((t) => [(t >> 16) / 255, ((t >> 8) & 255) / 255, (t & 255) / 255]);
  const bx = Math.round(c * CW + CW / 2 - b.ox), by = Math.round(r * CH + CH - 6 - (b.layers[0].h - b.oy) - b.oy);
  b.layers.forEach((img, k) => {
    for (let y = 0; y < img.h; y++) for (let x = 0; x < img.w; x++) {
      const X = bx + x, Y = by + y; if (X < 0 || Y < 0 || X >= W || Y >= H) continue;
      const s = (y * img.w + x) * 4, a = img.px[s + 3] / 255; if (!a) continue;
      const o = (Y * W + X) * 4;
      for (let j = 0; j < 3; j++) px[o + j] = Math.round(px[o + j] * (1 - a) + img.px[s + j] * tint[k][j] * a);
    }
  });
}));
writeFileSync(process.argv[2], encodePng({ w: W, h: H, px }));
