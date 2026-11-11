/**
 * Bakes the fleet — every hull that comes up a river — into sprite sheets.
 *
 *     bun run bake:boats
 *
 * Every model in `src/world/boats/models.ts` at 32 headings, rendered by the
 * vehicles' rasteriser into two layers (the hull's paint to tint, the rest
 * as it is) and three masks of its lights, each cropped to what it covers,
 * packed into 2048² pages with an index the game reads. @see bake-props.ts
 */
import { mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { bakeTris } from "../src/world/agents/cars/raster.ts";
import { BOATS, BOAT_LAYERS, BOAT_MARKS, boatLayerOf, boatMarkOf } from "../src/world/boats/models.ts";
import { BOAT_GAP, BOAT_HEADINGS, BOAT_RES, type BoatFrame, type BoatsSheet } from "../src/world/boats/boats-format.ts";
import { encodePng, type Image } from "./png-min.ts";

const OUT_DIR = "public/isometric_assets/derived";
const PAGE = 2048, GAP = BOAT_GAP;

const pages: Image[] = [];
let x = PAGE, y = 0, shelf = 0;
function place(w: number, h: number): { page: number; x: number; y: number } {
  if (x + w > PAGE) { x = 0; y += shelf + GAP; shelf = 0; }
  if (!pages.length || y + h > PAGE) { pages.push({ w: PAGE, h: PAGE, px: new Uint8Array(PAGE * PAGE * 4) }); x = 0; y = 0; shelf = 0; }
  const at = { page: pages.length - 1, x, y };
  x += w + GAP; shelf = Math.max(shelf, h);
  return at;
}
function blit(dst: Image, src: Image, dx: number, dy: number) {
  for (let r = 0; r < src.h; r++) dst.px.set(src.px.subarray(r * src.w * 4, (r + 1) * src.w * 4), ((dy + r) * dst.w + dx) * 4);
}
/** A part cut down to what it covers, its origin moved to match; an empty one 0 × 0. */
function crop(img: Image, ox: number, oy: number): { img: Image; ox: number; oy: number } {
  let x0 = img.w, y0 = img.h, x1 = -1, y1 = -1;
  for (let yy = 0; yy < img.h; yy++) for (let xx = 0; xx < img.w; xx++) {
    if (!img.px[(yy * img.w + xx) * 4 + 3]) continue;
    if (xx < x0) x0 = xx; if (xx > x1) x1 = xx; if (yy < y0) y0 = yy; if (yy > y1) y1 = yy;
  }
  if (x1 < 0) return { img: { w: 0, h: 0, px: new Uint8Array(0) }, ox: 0, oy: 0 };
  const w = x1 - x0 + 1, h = y1 - y0 + 1, px = new Uint8Array(w * h * 4);
  for (let r = 0; r < h; r++) px.set(img.px.subarray(((y0 + r) * img.w + x0) * 4, ((y0 + r) * img.w + x1 + 1) * 4), r * w * 4);
  return { img: { w, h, px }, ox: ox - x0, oy: oy - y0 };
}

type Baked = { id: string; k: number; parts: ReturnType<typeof crop>[] };
const t0 = performance.now();
const baked: Baked[] = [];
for (const m of BOATS) {
  const tris = m.tris();
  for (let k = 0; k < BOAT_HEADINGS; k++) {
    const b = bakeTris(tris, (k / BOAT_HEADINGS) * Math.PI * 2, BOAT_RES, {
      layers: BOAT_LAYERS, layerOf: boatLayerOf, shadow: m.shadow, marks: { n: BOAT_MARKS, of: boatMarkOf },
    });
    baked.push({ id: m.id, k, parts: [...b.layers, ...b.marks].map((img) => crop(img, b.ox, b.oy)) });
  }
}
const sheet: BoatsSheet = { res: BOAT_RES, headings: BOAT_HEADINGS, layers: BOAT_LAYERS, marks: BOAT_MARKS, pages: [], boats: {} };
for (const m of BOATS) sheet.boats[m.id] = [];
const tall = (b: Baked) => Math.max(...b.parts.map((l) => l.img.h));
for (const b of baked.sort((p, q) => tall(q) - tall(p))) {
  const w = b.parts.reduce((s, l) => s + l.img.w, 0) + GAP * (b.parts.length - 1);
  const at = place(w, tall(b));
  const frame: BoatFrame = [at.page, at.x, at.y];
  let lx = at.x;
  for (const l of b.parts) {
    blit(pages[at.page], l.img, lx, at.y);
    frame.push(l.img.w, l.img.h, l.ox, l.oy);
    lx += l.img.w + GAP;
  }
  sheet.boats[b.id][b.k] = frame;
}

mkdirSync(OUT_DIR, { recursive: true });
for (const f of readdirSync(OUT_DIR)) if (/^boats_\d+\.png$/.test(f)) rmSync(join(OUT_DIR, f));
const last = pages[pages.length - 1], used = Math.ceil((y + shelf) / 64) * 64;
if (used < PAGE) pages[pages.length - 1] = { w: PAGE, h: used, px: last.px.slice(0, PAGE * used * 4) };
pages.forEach((p, k) => {
  const name = `boats_${k}.png`;
  writeFileSync(join(OUT_DIR, name), encodePng(p));
  sheet.pages.push(name);
});
writeFileSync(join(OUT_DIR, "boats.json"), JSON.stringify(sheet));
console.log(`${BOATS.length} boats, ${baked.length} frames → ${pages.length} page(s) in ${Math.round(performance.now() - t0)} ms; last page to y=${used}`);
