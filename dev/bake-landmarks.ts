/**
 * Bakes the company's own building — the Garage, the HQ, the Boardroom and
 * the IPO Tower, each with its yard — into a sprite sheet.
 *
 *     bun run bake:landmarks
 *     bun run dev/bake-landmarks.ts --preview out.png [id…] [res]
 *
 * Every tier in `src/world/landmarks/models.ts`, rendered once by the
 * vehicles' rasteriser and CUT INTO ITS PLOT'S TILES — each sample filed by
 * the tile the point of the building it shows stands on — so the game can
 * file each tile's share in that tile's band. Each cropped to what it
 * covers, packed into 2048² pages with an index. @see bake-houses.ts
 */
import { mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { TILES_PER_M } from "../src/world/agents/cars/models.ts";
import { bakeTris } from "../src/world/agents/cars/raster.ts";
import { LANDMARK_RES, type LandmarkPiece, type LandmarksSheet } from "../src/world/landmarks/landmarks-format.ts";
import { LANDMARK_IDS, YARD_PLOT, landmarkTris, type LandmarkId } from "../src/world/landmarks/models.ts";
import { encodePng, type Image } from "./png-min.ts";

const OUT_DIR = "public/isometric_assets/derived";
const PAGE = 2048, GAP = 3;
const { w: PW, h: PH } = YARD_PLOT;

/** The tiles in the order they are drawn: back to front, by band; and each tile's place in that order. */
const order = Array.from({ length: PW * PH }, (_, k) => ({ c: k % PW, r: (k / PW) | 0 })).sort((a, b) => a.c + a.r - (b.c + b.r) || a.r - b.r);
const rank = new Map(order.map((t, k) => [t.r * PW + t.c, k]));
const tileAt = (x: number, y: number) => {
  const c = Math.max(0, Math.min(PW - 1, Math.floor(x * TILES_PER_M + PW / 2))), r = Math.max(0, Math.min(PH - 1, Math.floor(y * TILES_PER_M + PH / 2)));
  return rank.get(r * PW + c)!;
};
function bake(id: LandmarkId, res: number) {
  return bakeTris(landmarkTris(id), 0, res, {
    layers: PW * PH, layerOf: () => 0, layerAt: (_m, p) => tileAt(p[0], p[1]),
    shadow: { hl: 1, hw: 1, edge: 0.1, soft: 0.4, strength: 0, reach: 0 },
  });
}
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

const t0 = performance.now();
const pv = process.argv.indexOf("--preview");
if (pv >= 0) {
  // A LOOK AT THEM: each as the game will stack it, side by side on grass.
  const rest = process.argv.slice(pv + 2), res = Number(rest.find((a) => /^[\d.]+$/.test(a)) ?? 1.5);
  const ids = rest.filter((a) => (LANDMARK_IDS as readonly string[]).includes(a)) as LandmarkId[];
  const bakes = (ids.length ? ids : [...LANDMARK_IDS]).map((id) => bake(id, res));
  const W = bakes.reduce((s, b) => s + b.layers[0].w + 16, 16), H = Math.max(...bakes.map((b) => b.layers[0].h)) + 32;
  const out: Image = { w: W, h: H, px: new Uint8Array(W * H * 4) };
  for (let i = 0; i < W * H; i++) { out.px[i * 4] = 122; out.px[i * 4 + 1] = 168; out.px[i * 4 + 2] = 76; out.px[i * 4 + 3] = 255; }
  let x = 16;
  for (const b of bakes) {
    const y = H - 16 - b.layers[0].h;
    for (const l of b.layers) for (let yy = 0; yy < l.h; yy++) for (let xx = 0; xx < l.w; xx++) {
      const s = (yy * l.w + xx) * 4, a = l.px[s + 3] / 255;
      if (!a) continue;
      const d = ((y + yy) * W + x + xx) * 4;
      for (let k = 0; k < 3; k++) out.px[d + k] = Math.round(l.px[s + k] * a + out.px[d + k] * (1 - a));
    }
    x += b.layers[0].w + 16;
  }
  writeFileSync(process.argv[pv + 1], encodePng(out));
  console.log(`preview ${W}×${H} in ${Math.round(performance.now() - t0)} ms`);
  process.exit(0);
}

const pages: Image[] = [];
let x = PAGE, y = 0, shelf = 0;
function place(w: number, h: number): { page: number; x: number; y: number } {
  if (x + w > PAGE) { x = 0; y += shelf + GAP; shelf = 0; }
  if (!pages.length || y + h > PAGE) { pages.push({ w: PAGE, h: PAGE, px: new Uint8Array(PAGE * PAGE * 4) }); x = 0; y = 0; shelf = 0; }
  const at = { page: pages.length - 1, x, y };
  x += w + GAP; shelf = Math.max(shelf, h);
  return at;
}
const sheet: LandmarksSheet = { res: LANDMARK_RES, pages: [], marks: {} };
const all: { piece: ReturnType<typeof crop>; set: (p: LandmarkPiece) => void }[] = [];
for (const id of LANDMARK_IDS) {
  const b = bake(id, LANDMARK_RES), tiles: LandmarkPiece[] = new Array(PW * PH).fill(null);
  order.forEach((t, k) => all.push({ piece: crop(b.layers[k], b.ox, b.oy), set: (p) => { tiles[t.r * PW + t.c] = p; } }));
  sheet.marks[id] = { w: PW, h: PH, tiles };
  console.log(`${id}: ${b.layers[0].w}×${b.layers[0].h}`);
}
for (const a of [...all].sort((p, q) => q.piece.img.h - p.piece.img.h)) {
  const { img, ox, oy } = a.piece;
  if (!img.w) { a.set(null); continue; }
  const at = place(img.w, img.h);
  for (let r = 0; r < img.h; r++) pages[at.page].px.set(img.px.subarray(r * img.w * 4, (r + 1) * img.w * 4), ((at.y + r) * PAGE + at.x) * 4);
  a.set([at.page, at.x, at.y, img.w, img.h, ox, oy]);
}
mkdirSync(OUT_DIR, { recursive: true });
for (const f of readdirSync(OUT_DIR)) if (/^landmarks_\d+\.png$/.test(f)) rmSync(join(OUT_DIR, f));
const last = pages[pages.length - 1], used = Math.ceil((y + shelf) / 64) * 64;
if (used < PAGE) pages[pages.length - 1] = { w: PAGE, h: used, px: last.px.slice(0, PAGE * used * 4) };
pages.forEach((p, k) => {
  const name = `landmarks_${k}.png`;
  writeFileSync(join(OUT_DIR, name), encodePng(p));
  sheet.pages.push(name);
});
writeFileSync(join(OUT_DIR, "landmarks.json"), JSON.stringify(sheet));
console.log(`${LANDMARK_IDS.length} landmarks → ${pages.length} page(s) in ${Math.round(performance.now() - t0)} ms`);
