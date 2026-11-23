/**
 * Bakes the houses — the three districts' homes, in parts — into a sprite sheet.
 *
 *     bun run bake:houses
 *
 * Every kit in `src/world/houses/models.ts`: its ground floor, each kind of
 * upper floor and its roof, rendered by the vehicles' rasteriser into two
 * layers (the walls to tint, a shop's paint to tint, the rest as it is), each cropped to what it
 * covers, packed into 2048² pages with an index the game reads. Only the
 * ground floor casts the shadow. @see bake-props.ts
 */
import { mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { bakeTris, type Tri } from "../src/world/agents/cars/raster.ts";
import { HOUSES, SHOP_KEYS, houseLayerOf, shopGround, snowOver } from "../src/world/houses/models.ts";
import { HOUSE_GAP, HOUSE_LAYERS, HOUSE_RES, type HouseFrame, type HousesSheet } from "../src/world/houses/houses-format.ts";
import { encodePng, type Image } from "./png-min.ts";

const OUT_DIR = "public/isometric_assets/derived";
const PAGE = 2048, GAP = HOUSE_GAP;

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

type Baked = { layers: ReturnType<typeof crop>[]; frame: HouseFrame };
const t0 = performance.now();
const all: Baked[] = [];
const sheet: HousesSheet = { res: HOUSE_RES, layers: HOUSE_LAYERS, pages: [], kits: {} };
for (const h of HOUSES) {
  const parts = h.parts();
  const bake = (tris: Tri[], shadow: boolean): HouseFrame => {
    const b = bakeTris(tris, 0, HOUSE_RES, { layers: HOUSE_LAYERS, layerOf: houseLayerOf, shadow: shadow ? h.shadow : { ...h.shadow, strength: 0 } });
    const frame: HouseFrame = [];
    all.push({ layers: b.layers.map((img) => crop(img, b.ox, b.oy)), frame });
    return frame;
  };
  // The snow on the roof: baked with the roof so the roof hides what it should, and kept alone — the roof's own
  // layer let go. (The top floor under it is the roof's to hide; what stands lower is never in front of it.)
  const snowed = (): HouseFrame => {
    const b = bakeTris([...parts.roof, ...snowOver(parts.roof)], 0, HOUSE_RES, { layers: HOUSE_LAYERS, layerOf: (m) => (m === "snow" ? 1 : 0), shadow: { ...h.shadow, strength: 0 } });
    const frame: HouseFrame = [];
    const none = { img: { w: 0, h: 0, px: new Uint8Array(0) }, ox: 0, oy: 0 };
    all.push({ layers: [none, crop(b.layers[1], b.ox, b.oy), ...b.layers.slice(2).map(() => none)], frame });
    return frame;
  };
  sheet.kits[h.id] = {
    ground: bake(parts.ground, true), mids: parts.mids.map((m) => bake(m, false)), roof: bake(parts.roof, false), snow: snowed(),
    // Its ground floor again with a shop in it: on either face, the door at either end.
    shop: Object.fromEntries(SHOP_KEYS.map((k) => [k, bake(shopGround(h, k), true)])),
  };
}
const tall = (b: Baked) => Math.max(...b.layers.map((l) => l.img.h));
for (const b of [...all].sort((p, q) => tall(q) - tall(p))) {
  const w = b.layers.reduce((s, l) => s + l.img.w, 0) + GAP * (b.layers.length - 1);
  const at = place(w, tall(b));
  b.frame.push(at.page, at.x, at.y);
  let lx = at.x;
  for (const l of b.layers) {
    blit(pages[at.page], l.img, lx, at.y);
    b.frame.push(l.img.w, l.img.h, l.ox, l.oy);
    lx += l.img.w + GAP;
  }
}

mkdirSync(OUT_DIR, { recursive: true });
for (const f of readdirSync(OUT_DIR)) if (/^houses_\d+\.(png|webp)$/.test(f)) rmSync(join(OUT_DIR, f));
const last = pages[pages.length - 1], used = Math.ceil((y + shelf) / 64) * 64;
if (used < PAGE) pages[pages.length - 1] = { w: PAGE, h: used, px: last.px.slice(0, PAGE * used * 4) };
pages.forEach((p, k) => {
  const name = `houses_${k}.png`;
  writeFileSync(join(OUT_DIR, name), encodePng(p));
  sheet.pages.push(name);
});
writeFileSync(join(OUT_DIR, "houses.json"), JSON.stringify(sheet));
console.log(`${HOUSES.length} houses, ${all.length} parts → ${pages.length} page(s) in ${Math.round(performance.now() - t0)} ms; last page to y=${used}`);
