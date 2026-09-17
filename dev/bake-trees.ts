/**
 * Bakes wooded ground tiles, so a wood is an ordinary terrain material.
 *
 *     bun run bake:trees
 *
 * The tree itself is vendor art — `cityDetails_010.png`, the same prop v1
 * scatters on its unbuilt plots (@see GROUND_PROPS). It is a free-standing
 * 32×45 sprite with no ground under it, which is exactly what a tile needs
 * stamping onto it.
 *
 * WHY BAKE, rather than composite at runtime: the same three reasons the road
 * corners are baked. No `Renderer` needed at load, NEAREST sampling like the
 * rest of the atlas instead of a RenderTexture's LINEAR, and one texture source
 * so wooded cells batch with every other cell. @see bake-road-corners
 *
 * WHY A GROUND TILE, rather than a structure standing on one: a wood is
 * scenery, and scenery that is a material costs nothing anywhere else. It
 * saves, loads, paints, undoes and renders through the paths that already
 * exist, and the map does not grow a second kind of object with a footprint and
 * placement rules for something the player will never interact with. The trade
 * is that you cannot fell one tree — you repaint the cell.
 *
 * TREES SIT LOW ON THE TILE because a ground frame has no headroom: 132×99 is a
 * 66px diamond and a 33px skirt, with the diamond's top vertex at y=0. A tree
 * is 45px tall, so its foot has to be in the lower half of the diamond or its
 * canopy is cut off at the top of the frame.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { blit, decodePng, encodePng, type Image } from "./png-min.ts";

const LAND = "public/isometric_assets/landscape/PNG";
const CITY = "public/isometric_assets/city_details/PNG";
const OUT_DIR = "public/isometric_assets/derived";
const SHEET = "trees_sheet.png";
const XML = "trees_sheet.xml";

const TILE_W = 132;
const TILE_H = 99;

/** The prop, and where its trunk meets the ground within its own frame. */
const TREE = "cityDetails_010.png";
const FOOT_X = 16;
const FOOT_Y = 44;

/**
 * Where trees stand on the tile, back to front.
 *
 * Each is the point the TRUNK'S FOOT sits on, in frame pixels. All are inside
 * the top diamond (|dx|/66 + |dy|/33 ≤ 1 about its centre at 66,33) and low
 * enough down it that the canopy clears the top of the frame.
 */
const STANDS: readonly [number, number][] = [[84, 46], [50, 52], [66, 61]];

/** How many trees each baked variant carries. */
const COUNTS = [1, 2, 3];

/** Tiles trees are stamped onto. Sand and bare earth stay bare. */
const BASES = ["landscapeTiles_067.png"];

/** The frame name for `n` trees on `base`. Mirrors `woodedFrame` in src. */
const woodedFrame = (base: string, n: number) =>
  `${base.replace(/\.png$/, "")}_trees${n}.png`;

const load = (dir: string, frame: string): Image =>
  decodePng(readFileSync(join(dir, frame)));

function main() {
  const tree = load(CITY, TREE);
  const entries: { name: string; x: number; y: number }[] = [];
  const sheet: Image = {
    w: COUNTS.length * TILE_W,
    h: BASES.length * TILE_H,
    px: new Uint8Array(COUNTS.length * TILE_W * BASES.length * TILE_H * 4),
  };

  BASES.forEach((base, row) => {
    const ground = load(LAND, base);
    COUNTS.forEach((n, col) => {
      const ox = col * TILE_W, oy = row * TILE_H;
      blit(sheet, ground, 0, 0, TILE_W, TILE_H, ox, oy);
      // Back to front — STANDS is already in that order, so a prefix of it
      // keeps the overlap right however many trees this variant has.
      for (const [fx, fy] of STANDS.slice(0, n)) {
        blit(sheet, tree, 0, 0, tree.w, tree.h,
          ox + fx - FOOT_X, oy + fy - FOOT_Y);
      }
      entries.push({ name: woodedFrame(base, n), x: ox, y: oy });
    });
  });

  const xml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<TextureAtlas imagePath="${SHEET}">`,
    ...entries.map((e) =>
      `    <SubTexture name="${e.name}" x="${e.x}" y="${e.y}" width="${TILE_W}" height="${TILE_H}"/>`),
    "</TextureAtlas>",
    "",
  ].join("\n");

  mkdirSync(dirname(join(OUT_DIR, SHEET)), { recursive: true });
  writeFileSync(join(OUT_DIR, SHEET), encodePng(sheet));
  writeFileSync(join(OUT_DIR, XML), xml);
  console.log(`baked ${entries.length} wooded tiles -> ${OUT_DIR}/${SHEET} (${sheet.w}x${sheet.h})`);
  for (const e of entries) console.log(`  ${e.name}  @ ${e.x},${e.y}`);
}

main();
