/**
 * Bakes the inner-corner road tiles into a sheet, so the engine loads them like
 * any other atlas frame.
 *
 *     bun run bake:road-corners
 *
 * WHY BAKE. These were composited at runtime first, into RenderTextures, and
 * that route has three fragilities the baked sheet removes outright:
 *
 *   - it needs a live `Renderer` at load, so the scene build depended on one
 *   - `RenderTexture` defaults to LINEAR filtering while the atlas is NEAREST,
 *     which silently smoothed the composited tiles
 *   - each RenderTexture is its own texture source, so cells using them could
 *     not batch with atlas cells
 *
 * Baked, they are ordinary SubTextures in one sheet: same sampling as every
 * other tile, one texture source, and reviewable in git.
 *
 * WHAT IT COMPOSITES. Where three paved cells meet a grass cell at one vertex,
 * the kerb has to turn 90° around that point, and no single tile carries a
 * MIXTURE of interior and notched corners. 090 is fully paved with a raised
 * kerb nub at each of its four vertices — exactly the missing piece — so each
 * variant is a base frame plus one nub sub-rect per notched corner.
 *
 * The nub rects come from diffing 090 against 081 and taking the four connected
 * components; see src/world/roads/notch.ts for the derivation.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { blit, decodePng, encodePng, type Image } from "./png-min.ts";
import { NOTCH_RECTS, notchVariantFrame } from "../src/world/roads/notch.ts";
import { buildRoadTable } from "../src/world/roads/table.ts";
import { notchVariantsNeeded } from "../src/world/roads/variants.ts";

const SRC = "public/isometric_assets/landscape/PNG";
const OUT_DIR = "public/isometric_assets/derived";
const SHEET = "roadCorners_sheet.png";
const XML = "roadCorners_sheet.xml";
const TILE_W = 132;
const TILE_H = 99;
const COLS = 6;

const load = (frame: string): Image =>
  decodePng(readFileSync(join(SRC, frame)));

function main() {
  const table = buildRoadTable("landscape");
  const variants = notchVariantsNeeded(table);
  if (!variants.length) throw new Error("no variants to bake");

  const nubSource = load("landscapeTiles_090.png");
  const bases = new Map<string, Image>();
  for (const v of variants) {
    if (!bases.has(v.frame)) bases.set(v.frame, load(v.frame));
  }

  const rows = Math.ceil(variants.length / COLS);
  const sheet: Image = {
    w: COLS * TILE_W,
    h: rows * TILE_H,
    px: new Uint8Array(COLS * TILE_W * rows * TILE_H * 4),
  };

  const entries: { name: string; x: number; y: number }[] = [];
  variants.forEach((v, i) => {
    const col = i % COLS, row = (i / COLS) | 0;
    const ox = col * TILE_W, oy = row * TILE_H;
    // base frame, then one nub per notched corner at its exact rect
    blit(sheet, bases.get(v.frame)!, 0, 0, TILE_W, TILE_H, ox, oy);
    for (const corner of v.notches) {
      const r = NOTCH_RECTS[corner];
      blit(sheet, nubSource, r.x, r.y, r.w, r.h, ox + r.x, oy + r.y);
    }
    entries.push({ name: notchVariantFrame(v.frame, v.notches), x: ox, y: oy });
  });

  const xml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<TextureAtlas imagePath="${SHEET}">`,
    ...entries.map(
      (e) =>
        `    <SubTexture name="${e.name}" x="${e.x}" y="${e.y}" width="${TILE_W}" height="${TILE_H}"/>`,
    ),
    "</TextureAtlas>",
    "",
  ].join("\n");

  mkdirSync(dirname(join(OUT_DIR, SHEET)), { recursive: true });
  writeFileSync(join(OUT_DIR, SHEET), encodePng(sheet));
  writeFileSync(join(OUT_DIR, XML), xml);

  console.log(`baked ${variants.length} variants -> ${OUT_DIR}/${SHEET} (${sheet.w}x${sheet.h})`);
  for (const e of entries) console.log(`  ${e.name}  @ ${e.x},${e.y}`);
}

main();
