/**
 * Bakes the town's vehicles into sprite sheets.
 *
 *     bun run bake:cars
 *
 * Every model in `src/world/agents/cars/models.ts`, at every heading the game
 * shows, rendered by the software rasteriser in `cars/raster.ts` — no browser,
 * no renderer — and packed into 2048² pages, with an index the game reads.
 *
 * WHY BAKE, rather than draw at runtime as the box cars were: a car in the
 * game is then a sprite and nothing else. No look is drawn mid-frame the first
 * time it shows, the models can be as detailed as they like, and the sheets
 * are PNGs like the rest of the art. @see plans/baked-cars.md
 *
 * EACH FRAME IS TWO LAYERS side by side in the page: the paint, white with
 * its light, which the game tints; and the trim, in its own colours, drawn
 * over it. Both share a size and an origin: the vehicle's middle at the road.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { MODELS } from "../src/world/agents/cars/models.ts";
import { bakeFrame } from "../src/world/agents/cars/raster.ts";
import { CAR_GAP, CAR_HEADINGS, CAR_RES, type CarSheet } from "../src/world/agents/cars/sheet-format.ts";
import { encodePng, type Image } from "./png-min.ts";

const OUT_DIR = "public/isometric_assets/derived";
const PAGE = 2048;
/** Between frames: room for the mip levels to blur into without picking up a neighbour. */
const GAP = CAR_GAP;

const pages: Image[] = [];
let x = PAGE, y = 0, shelf = 0;
/** A free spot `w × h` in the pages, packed in shelves. */
function place(w: number, h: number): { page: number; x: number; y: number } {
  if (x + w > PAGE) { x = 0; y += shelf + GAP; shelf = 0; }
  if (!pages.length || y + h > PAGE) {
    pages.push({ w: PAGE, h: PAGE, px: new Uint8Array(PAGE * PAGE * 4) });
    x = 0; y = 0; shelf = 0;
  }
  const at = { page: pages.length - 1, x, y };
  x += w + GAP; shelf = Math.max(shelf, h);
  return at;
}
function blit(dst: Image, src: Image, dx: number, dy: number) {
  for (let r = 0; r < src.h; r++) dst.px.set(src.px.subarray(r * src.w * 4, (r + 1) * src.w * 4), ((dy + r) * dst.w + dx) * 4);
}

const sheet: CarSheet = { res: CAR_RES, headings: CAR_HEADINGS, pages: [], models: {} };
const t0 = performance.now();
for (const m of MODELS) {
  const frames: CarSheet["models"][string]["frames"] = [];
  for (let h = 0; h < CAR_HEADINGS; h++) {
    const b = bakeFrame(m, (h / CAR_HEADINGS) * Math.PI * 2, CAR_RES);
    const at = place(b.paint.w * 2 + GAP, b.paint.h);
    blit(pages[at.page], b.paint, at.x, at.y);
    blit(pages[at.page], b.trim, at.x + b.paint.w + GAP, at.y);
    frames.push([at.page, at.x, at.y, b.paint.w, b.paint.h, b.ox, b.oy]);
  }
  sheet.models[m.id] = { length: m.length, width: m.width, frames };
}

mkdirSync(OUT_DIR, { recursive: true });
pages.forEach((p, k) => {
  const name = `cars_${k}.png`;
  writeFileSync(join(OUT_DIR, name), encodePng(p));
  sheet.pages.push(name);
});
writeFileSync(join(OUT_DIR, "cars.json"), JSON.stringify(sheet));
console.log(`${MODELS.length} models × ${CAR_HEADINGS} headings → ${pages.length} page(s) in ${Math.round(performance.now() - t0)} ms; last page filled to y=${y + shelf}`);
