/**
 * Bakes the trees through the year — every kind in every look it takes — into sprite sheets.
 *
 *     bun run bake:trees
 *
 * Each look in `src/world/props/tree-models.ts` at four turns (and each crop's in `crop-models.ts` at its four sowings), rendered by the vehicles' rasteriser into two
 * layers (leaves to tint, the rest as it is, the shadow with it), both cut to the box they cover together and laid
 * side by side, packed into 2048² pages with an index the game reads. @see bake-props.ts, render/tree-mesh
 */
import { mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { bakeTris } from "../src/world/agents/cars/raster.ts";
import { PROP_LAYERS, propLayerOf } from "../src/world/props/models.ts";
import { PROP_RES, PROP_TURNS } from "../src/world/props/props-format.ts";
import { TREE_LOOKS } from "../src/world/props/tree-models.ts";
import { CROP_LOOKS } from "../src/world/props/crop-models.ts";
import type { TreeFrame, TreesSheet } from "../src/world/props/trees-format.ts";
import { encodePng, type Image } from "./png-min.ts";

const OUT_DIR = "public/isometric_assets/derived";
const PAGE = 2048, GAP = 3;

const pages: Image[] = [];
let x = PAGE, y = 0, shelf = 0;
function place(w: number, h: number): { page: number; x: number; y: number } {
  if (x + w > PAGE) { x = 0; y += shelf + GAP; shelf = 0; }
  if (!pages.length || y + h > PAGE) { pages.push({ w: PAGE, h: PAGE, px: new Uint8Array(PAGE * PAGE * 4) }); x = 0; y = 0; shelf = 0; }
  const at = { page: pages.length - 1, x, y };
  x += w + GAP; shelf = Math.max(shelf, h);
  return at;
}
function blit(dst: Image, src: Image, sx: number, sy: number, w: number, h: number, dx: number, dy: number) {
  for (let r = 0; r < h; r++) dst.px.set(src.px.subarray(((sy + r) * src.w + sx) * 4, ((sy + r) * src.w + sx + w) * 4), ((dy + r) * dst.w + dx) * 4);
}

type Baked = { id: string; state: string; k: number; layers: Image[]; box: [number, number, number, number]; ox: number; oy: number };
const t0 = performance.now();
const baked: Baked[] = [];
// (A crop's four turns are four sowings, square to the map: @see crop-models.)
const LOOKS = [
  ...TREE_LOOKS.map((l) => { const tris = l.tris(); return { ...l, at: (k: number) => ({ tris, heading: (k / PROP_TURNS) * Math.PI * 2 }) }; }),
  ...CROP_LOOKS.map((l) => ({ ...l, at: (k: number) => ({ tris: l.tris(k), heading: 0 }) })),
];
for (const look of LOOKS) {
  for (let k = 0; k < PROP_TURNS; k++) {
    const { tris, heading } = look.at(k);
    const b = bakeTris(tris, heading, PROP_RES, { layers: PROP_LAYERS, layerOf: propLayerOf, shadow: look.shadow });
    // The box both layers cover between them.
    let x0 = Infinity, y0 = Infinity, x1 = -1, y1 = -1;
    for (const img of b.layers) for (let yy = 0; yy < img.h; yy++) for (let xx = 0; xx < img.w; xx++) {
      if (!img.px[(yy * img.w + xx) * 4 + 3]) continue;
      if (xx < x0) x0 = xx; if (xx > x1) x1 = xx; if (yy < y0) y0 = yy; if (yy > y1) y1 = yy;
    }
    baked.push({ id: look.id, state: look.state, k, layers: b.layers, box: [x0, y0, x1 + 1, y1 + 1], ox: b.ox, oy: b.oy });
  }
}
const sheet: TreesSheet = { res: PROP_RES, turns: PROP_TURNS, gap: GAP, pages: [], looks: {} };
const tall = (b: Baked) => b.box[3] - b.box[1];
for (const b of baked.sort((p, q) => tall(q) - tall(p))) {
  const w = b.box[2] - b.box[0], h = tall(b);
  const at = place(w * 2 + GAP, h);
  b.layers.forEach((img, l) => blit(pages[at.page], img, b.box[0], b.box[1], w, h, at.x + l * (w + GAP), at.y));
  const frame: TreeFrame = [at.page, at.x, at.y, w, h, b.ox - b.box[0], b.oy - b.box[1]];
  ((sheet.looks[b.id] ??= {})[b.state] ??= [])[b.k] = frame;
}

mkdirSync(OUT_DIR, { recursive: true });
for (const f of readdirSync(OUT_DIR)) if (/^trees_\d+\.(png|webp|ktx2)$/.test(f)) rmSync(join(OUT_DIR, f));
const last = pages[pages.length - 1], used = Math.ceil((y + shelf) / 64) * 64;
if (used < PAGE) pages[pages.length - 1] = { w: PAGE, h: used, px: last.px.slice(0, PAGE * used * 4) };
pages.forEach((p, k) => {
  const file = `trees_${k}.png`;
  writeFileSync(join(OUT_DIR, file), encodePng(p));
  sheet.pages.push({ file, w: p.w, h: p.h });
});
writeFileSync(join(OUT_DIR, "trees.json"), JSON.stringify(sheet));
console.log(`${LOOKS.length} looks, ${baked.length} frames → ${pages.length} page(s) in ${Math.round(performance.now() - t0)} ms; last page to y=${used}`);
