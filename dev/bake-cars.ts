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
import { mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
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
/**
 * A layer cut down to what it covers, and its origin moved to match: 40% of
 * a frame is clear, the paint's more so. An empty layer is 0 × 0.
 */
function crop(img: Image, ox: number, oy: number): { img: Image; ox: number; oy: number } {
  let x0 = img.w, y0 = img.h, x1 = -1, y1 = -1;
  for (let y = 0; y < img.h; y++) for (let x = 0; x < img.w; x++) {
    if (!img.px[(y * img.w + x) * 4 + 3]) continue;
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  if (x1 < 0) return { img: { w: 0, h: 0, px: new Uint8Array(0) }, ox: 0, oy: 0 };
  const w = x1 - x0 + 1, h = y1 - y0 + 1, px = new Uint8Array(w * h * 4);
  for (let r = 0; r < h; r++) px.set(img.px.subarray(((y0 + r) * img.w + x0) * 4, ((y0 + r) * img.w + x1 + 1) * 4), r * w * 4);
  return { img: { w, h, px }, ox: ox - x0, oy: oy - y0 };
}

const sheet: CarSheet = { res: CAR_RES, headings: CAR_HEADINGS, pages: [], models: {} };
const t0 = performance.now();
// Baked first and packed tallest first, so a shelf wastes little over its frames.
const baked = MODELS.flatMap((m) => Array.from({ length: CAR_HEADINGS }, (_, h) => {
  const b = bakeFrame(m, (h / CAR_HEADINGS) * Math.PI * 2, CAR_RES);
  return { m, h, paint: crop(b.paint, b.ox, b.oy), trim: crop(b.trim, b.ox, b.oy) };
}));
for (const m of MODELS) sheet.models[m.id] = { length: m.length, width: m.width, frames: [] };
for (const { m, h, paint: p, trim: t } of baked.sort((a, b) => Math.max(b.paint.img.h, b.trim.img.h) - Math.max(a.paint.img.h, a.trim.img.h))) {
  const at = place(p.img.w + GAP + t.img.w, Math.max(p.img.h, t.img.h));
  blit(pages[at.page], p.img, at.x, at.y);
  blit(pages[at.page], t.img, at.x + p.img.w + GAP, at.y);
  sheet.models[m.id].frames[h] = [at.page, at.x, at.y, p.img.w, p.img.h, p.ox, p.oy, t.img.w, t.img.h, t.ox, t.oy];
}

mkdirSync(OUT_DIR, { recursive: true });
// Pages from a bake that needed more of them.
for (const f of readdirSync(OUT_DIR)) if (/^cars_\d+\.png$/.test(f)) rmSync(join(OUT_DIR, f));
// The last page only as tall as what is on it, rounded up for its mips.
const last = pages[pages.length - 1], used = Math.ceil((y + shelf) / 64) * 64;
if (used < PAGE) pages[pages.length - 1] = { w: PAGE, h: used, px: last.px.slice(0, PAGE * used * 4) };
pages.forEach((p, k) => {
  const name = `cars_${k}.png`;
  writeFileSync(join(OUT_DIR, name), encodePng(p));
  sheet.pages.push(name);
});
writeFileSync(join(OUT_DIR, "cars.json"), JSON.stringify(sheet));
console.log(`${MODELS.length} models × ${CAR_HEADINGS} headings → ${pages.length} page(s) in ${Math.round(performance.now() - t0)} ms; last page filled to y=${y + shelf}`);
