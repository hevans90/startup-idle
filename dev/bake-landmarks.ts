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
import { LANDMARK_RES, LANDMARK_SNOW_RES, type LandmarkPiece, type LandmarksSheet } from "../src/world/landmarks/landmarks-format.ts";
import { LANDMARK_IDS, YARD_PLOT, landmarkTris, type LandmarkId } from "../src/world/landmarks/models.ts";
import { snowOver } from "../src/world/houses/models.ts";
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
function bake(id: LandmarkId, res: number, back = false) {
  return bakeTris(landmarkTris(id, back), 0, res, {
    // (Twice over: each tile's share of the building, then each tile's share of its canopies.)
    layers: PW * PH * 2, layerOf: () => 0, layerAt: (_m, p, t) => tileAt(p[0], p[1]) + (t.tag ? PW * PH : 0),
    shadow: { hl: 1, hw: 1, edge: 0.1, soft: 0.4, strength: 0, reach: 0 },
  });
}
/**
 * The snow lying on it, as it hides it: baked with the building, each tile's snow (and its canopies') kept and the
 * building itself let go, in the last layer.
 */
function bakeSnow(id: LandmarkId, res: number, back = false) {
  const tris = landmarkTris(id, back), N = PW * PH;
  // (On what stands up off the yard: the yard's own paving is the ground's, and its snow the ground's.)
  const raised = tris.filter((t) => Math.min(t.p[0][2], t.p[1][2], t.p[2][2]) > 0.3);
  return bakeTris([...tris, ...snowOver(raised)], 0, res, {
    layers: N * 2 + 1, layerOf: () => 0,
    layerAt: (m, p, t) => (m === "snow" ? tileAt(p[0], p[1]) + (t.tag ? N : 0) : N * 2),
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
  const bakes = (ids.length ? ids : [...LANDMARK_IDS]).map((id) => bake(id, res, rest.includes("back")));
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
const sheet: LandmarksSheet = { res: LANDMARK_RES, snowRes: LANDMARK_SNOW_RES, pages: [], marks: {} };
const all: { piece: ReturnType<typeof crop>; set: (p: LandmarkPiece) => void }[] = [];
// (Each twice: its yard to the front of its plot, and to the back — `id~back`.)
for (const [id, back] of LANDMARK_IDS.flatMap((q) => [[q, false], [q, true]] as const)) {
  const b = bake(id, LANDMARK_RES, back), tiles: LandmarkPiece[] = new Array(PW * PH).fill(null), over: LandmarkPiece[] = new Array(PW * PH).fill(null);
  order.forEach((t, k) => all.push({ piece: crop(b.layers[k], b.ox, b.oy), set: (p) => { tiles[t.r * PW + t.c] = p; } }));
  order.forEach((t, k) => all.push({ piece: crop(b.layers[PW * PH + k], b.ox, b.oy), set: (p) => { over[t.r * PW + t.c] = p; } }));
  const sb = bakeSnow(id, LANDMARK_SNOW_RES, back), snow: LandmarkPiece[] = new Array(PW * PH).fill(null), snowOn: LandmarkPiece[] = new Array(PW * PH).fill(null);
  order.forEach((t, k) => all.push({ piece: crop(sb.layers[k], sb.ox, sb.oy), set: (p) => { snow[t.r * PW + t.c] = p; } }));
  order.forEach((t, k) => all.push({ piece: crop(sb.layers[PW * PH + k], sb.ox, sb.oy), set: (p) => { snowOn[t.r * PW + t.c] = p; } }));
  sheet.marks[back ? `${id}~back` : id] = { w: PW, h: PH, tiles, over, snow, snowOver: snowOn };
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
for (const f of readdirSync(OUT_DIR)) if (/^landmarks_\d+\.(png|webp|ktx2)$/.test(f)) rmSync(join(OUT_DIR, f));
const last = pages[pages.length - 1], used = Math.ceil((y + shelf) / 64) * 64;
if (used < PAGE) pages[pages.length - 1] = { w: PAGE, h: used, px: last.px.slice(0, PAGE * used * 4) };
pages.forEach((p, k) => {
  const name = `landmarks_${k}.png`;
  writeFileSync(join(OUT_DIR, name), encodePng(p));
  sheet.pages.push(name);
});
writeFileSync(join(OUT_DIR, "landmarks.json"), JSON.stringify(sheet));
console.log(`${LANDMARK_IDS.length} landmarks → ${pages.length} page(s) in ${Math.round(performance.now() - t0)} ms`);
