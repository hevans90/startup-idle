/**
 * Bakes the town's people into sprite sheets.
 *
 *     bun run bake:people
 *
 * Every figure in `src/world/agents/people/figures.ts`, at every heading and
 * every frame of its walk — and a builder's at work — rendered by the
 * vehicles' rasteriser into layers, each cropped to what it covers, and
 * packed into 2048² pages with an index the game reads. @see bake-cars.ts
 */
import { mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { bakeTris } from "../src/world/agents/cars/raster.ts";
import { FIGURES, figureTris, layerOfMat, PERSON_LAYERS } from "../src/world/agents/people/figures.ts";
import {
  PERSON_GAP, PERSON_HEADINGS, PERSON_RES, PERSON_SHADOW, PERSON_STRIDES, SITTER_SHADOW, type PeopleSheet, type PersonFrame,
} from "../src/world/agents/people/people-format.ts";
import { encodePng, type Image } from "./png-min.ts";

const OUT_DIR = "public/isometric_assets/derived";
const PAGE = 2048, GAP = PERSON_GAP;

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
/** A layer cut down to what it covers, its origin moved to match; an empty one 0 × 0. */
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

type Baked = { id: string; set: "walk" | "work" | "sit"; k: number; layers: ReturnType<typeof crop>[] };
const t0 = performance.now();
const baked: Baked[] = [];
for (const f of FIGURES) for (const set of f.hivis ? (["walk", "work"] as const) : (["walk"] as const)) {
  for (let h = 0; h < PERSON_HEADINGS; h++) for (let s = 0; s < PERSON_STRIDES; s++) {
    const heading = (h / PERSON_HEADINGS) * Math.PI * 2, phase = (s / PERSON_STRIDES) * Math.PI * 2;
    // The arm nearer the camera, which looks down the +u +v diagonal, swings the hammer.
    const near = -Math.sin(heading) + Math.cos(heading) >= 0 ? 1 : -1;
    const b = bakeTris(figureTris(f, phase, set, near), heading, PERSON_RES,
      { layers: PERSON_LAYERS.length, layerOf: layerOfMat, shadow: PERSON_SHADOW });
    baked.push({ id: f.id, set, k: h * PERSON_STRIDES + s, layers: b.layers.map((img) => crop(img, b.ox, b.oy)) });
  }
  // SAT DOWN: a frame a heading, still.
  for (let h = 0; h < PERSON_HEADINGS; h++) {
    const heading = (h / PERSON_HEADINGS) * Math.PI * 2;
    const b = bakeTris(figureTris(f, 0, "sit", 1), heading, PERSON_RES, { layers: PERSON_LAYERS.length, layerOf: layerOfMat, shadow: SITTER_SHADOW });
    baked.push({ id: f.id, set: "sit", k: h, layers: b.layers.map((img) => crop(img, b.ox, b.oy)) });
  }
}
const sheet: PeopleSheet = {
  res: PERSON_RES, headings: PERSON_HEADINGS, strides: PERSON_STRIDES, layers: PERSON_LAYERS.length, pages: [], figures: {},
};
for (const f of FIGURES) sheet.figures[f.id] = { walk: [], sit: [], ...(f.hivis ? { work: [] } : {}) };
const tall = (b: Baked) => Math.max(...b.layers.map((l) => l.img.h));
for (const b of baked.sort((p, q) => tall(q) - tall(p))) {
  const w = b.layers.reduce((s, l) => s + l.img.w, 0) + GAP * (b.layers.length - 1);
  const at = place(w, tall(b));
  const frame: PersonFrame = [at.page, at.x, at.y];
  let lx = at.x;
  for (const l of b.layers) {
    blit(pages[at.page], l.img, lx, at.y);
    frame.push(l.img.w, l.img.h, l.ox, l.oy);
    lx += l.img.w + GAP;
  }
  sheet.figures[b.id][b.set]![b.k] = frame;
}

mkdirSync(OUT_DIR, { recursive: true });
for (const f of readdirSync(OUT_DIR)) if (/^people_\d+\.png$/.test(f)) rmSync(join(OUT_DIR, f));
const last = pages[pages.length - 1], used = Math.ceil((y + shelf) / 64) * 64;
if (used < PAGE) pages[pages.length - 1] = { w: PAGE, h: used, px: last.px.slice(0, PAGE * used * 4) };
pages.forEach((p, k) => {
  const name = `people_${k}.png`;
  writeFileSync(join(OUT_DIR, name), encodePng(p));
  sheet.pages.push(name);
});
writeFileSync(join(OUT_DIR, "people.json"), JSON.stringify(sheet));
console.log(`${FIGURES.length} figures, ${baked.length} frames → ${pages.length} page(s) in ${Math.round(performance.now() - t0)} ms; last page to y=${used}`);
