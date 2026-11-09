/**
 * Bakes the props — trees, benches, café sets, fountains — into sprite sheets.
 *
 *     bun run bake:props
 *
 * Every model in `src/world/props/models.ts` at four turns, rendered by the
 * vehicles' rasteriser into two layers (leaves and cloth to tint, the rest as
 * it is), each cropped to what it covers, packed into 2048² pages with an
 * index the game reads. @see bake-people.ts
 */
import { mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { bakeTris } from "../src/world/agents/cars/raster.ts";
import { PROPS, PROP_LAYERS, propLayerOf } from "../src/world/props/models.ts";
import { PROP_GAP, PROP_RES, PROP_TURNS, type PropFrame, type PropsSheet } from "../src/world/props/props-format.ts";
import { encodePng, type Image } from "./png-min.ts";

const OUT_DIR = "public/isometric_assets/derived";
const PAGE = 2048, GAP = PROP_GAP;

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

type Baked = { id: string; k: number; layers: ReturnType<typeof crop>[] };
const t0 = performance.now();
const baked: Baked[] = [];
for (const p of PROPS) {
  const tris = p.tris();
  for (let k = 0; k < PROP_TURNS; k++) {
    const b = bakeTris(tris, (k / PROP_TURNS) * Math.PI * 2, PROP_RES, { layers: PROP_LAYERS, layerOf: propLayerOf, shadow: p.shadow });
    baked.push({ id: p.id, k, layers: b.layers.map((img) => crop(img, b.ox, b.oy)) });
  }
}
const sheet: PropsSheet = { res: PROP_RES, turns: PROP_TURNS, layers: PROP_LAYERS, pages: [], props: {} };
for (const p of PROPS) sheet.props[p.id] = [];
const tall = (b: Baked) => Math.max(...b.layers.map((l) => l.img.h));
for (const b of baked.sort((p, q) => tall(q) - tall(p))) {
  const w = b.layers.reduce((s, l) => s + l.img.w, 0) + GAP * (b.layers.length - 1);
  const at = place(w, tall(b));
  const frame: PropFrame = [at.page, at.x, at.y];
  let lx = at.x;
  for (const l of b.layers) {
    blit(pages[at.page], l.img, lx, at.y);
    frame.push(l.img.w, l.img.h, l.ox, l.oy);
    lx += l.img.w + GAP;
  }
  sheet.props[b.id][b.k] = frame;
}

mkdirSync(OUT_DIR, { recursive: true });
for (const f of readdirSync(OUT_DIR)) if (/^props_\d+\.png$/.test(f)) rmSync(join(OUT_DIR, f));
const last = pages[pages.length - 1], used = Math.ceil((y + shelf) / 64) * 64;
if (used < PAGE) pages[pages.length - 1] = { w: PAGE, h: used, px: last.px.slice(0, PAGE * used * 4) };
pages.forEach((p, k) => {
  const name = `props_${k}.png`;
  writeFileSync(join(OUT_DIR, name), encodePng(p));
  sheet.pages.push(name);
});
writeFileSync(join(OUT_DIR, "props.json"), JSON.stringify(sheet));
console.log(`${PROPS.length} props, ${baked.length} frames → ${pages.length} page(s) in ${Math.round(performance.now() - t0)} ms; last page to y=${used}`);
