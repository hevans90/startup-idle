/**
 * Re-packs every atlas with room between its frames, so it can be MIPMAPPED.
 *
 *     bun run bake:padded
 *
 * WHY. The vendor sheets pack their frames edge to edge — not a pixel between
 * them. Sampled `nearest` at full size that is fine; but zoomed out the map
 * shimmers and crawls, because every screen pixel picks one texel of many and
 * which one changes as the camera moves. Mipmaps are the cure, and a mip level
 * is an average of the level above: a frame's edge texels averaged with its
 * neighbour's, two levels down, is a seam of the wrong tile's colour round
 * every tile on the map.
 *
 * So each frame is copied into a sheet of its own with `PAD` texels round it,
 * and its edge texels EXTRUDED into that margin — repeated outward — so what
 * a mip level averages in at the edge is the frame itself. Up to level
 * `log2(PAD) + 1` stays clean; the loader caps mips there. @see MIP_LEVELS
 *
 * Writes `public/isometric_assets/padded/<dir>.png` and `.xml`, one per source
 * sheet, with the same frame names. Run again whenever a source sheet changes
 * (`bake:road-corners`, `bake:trees` first).
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { decodePng, encodePng, type Image } from "./png-min.ts";

const BASE = "public/isometric_assets";
const OUT = join(BASE, "padded");
/** Texels round every frame. Eight keeps four mip levels below full size clean. */
export const PAD = 8;
const WIDTH = 2048;

/** The sheets, as the loader lists them. @see ISO_ATLASES */
const SHEETS = [
  { dir: "buildings", xml: "building_sheet.xml", png: "building_sheet.png", out: "buildings" },
  { dir: "landscape", xml: "landscape_sheet.xml", png: "landscape_sheet.png", out: "landscape" },
  { dir: "vehicles", xml: "vehicle_sheet.xml", png: "vehicle_sheet.png", out: "vehicles" },
  { dir: "city_tiles", xml: "cityTiles_sheet.xml", png: "cityTiles_sheet.png", out: "city_tiles" },
  { dir: "derived", xml: "roadCorners_sheet.xml", png: "roadCorners_sheet.png", out: "road_corners" },
  { dir: "derived", xml: "trees_sheet.xml", png: "trees_sheet.png", out: "trees" },
];

type Frame = { name: string; x: number; y: number; w: number; h: number };

function framesOf(xml: string): Frame[] {
  const out: Frame[] = [];
  for (const m of xml.matchAll(/<SubTexture name="([^"]+)" x="(\d+)" y="(\d+)" width="(\d+)" height="(\d+)"/g)) {
    out.push({ name: m[1], x: +m[2], y: +m[3], w: +m[4], h: +m[5] });
  }
  return out;
}

/** Copy one texel, all four channels. */
const copy = (dst: Image, dx: number, dy: number, src: Image, sx: number, sy: number) => {
  const d = (dy * dst.w + dx) * 4, s = (sy * src.w + sx) * 4;
  dst.px[d] = src.px[s]; dst.px[d + 1] = src.px[s + 1]; dst.px[d + 2] = src.px[s + 2]; dst.px[d + 3] = src.px[s + 3];
};

/** Shelf-pack the frames, tallest first, each `PAD` all round: where each one's padded slot goes. */
function pack(frames: Frame[]): { at: Map<string, { x: number; y: number }>; h: number } {
  const at = new Map<string, { x: number; y: number }>();
  let x = 0, y = 0, shelf = 0;
  for (const f of [...frames].sort((a, b) => b.h - a.h || b.w - a.w)) {
    const w = f.w + 2 * PAD, h = f.h + 2 * PAD;
    if (x + w > WIDTH) { x = 0; y += shelf; shelf = 0; }
    at.set(f.name, { x: x + PAD, y: y + PAD });
    x += w;
    shelf = Math.max(shelf, h);
  }
  return { at, h: y + shelf };
}

function bake(s: (typeof SHEETS)[number]) {
  const frames = framesOf(readFileSync(join(BASE, s.dir, s.xml), "utf8"));
  const src = decodePng(readFileSync(join(BASE, s.dir, s.png)));
  const { at, h } = pack(frames);
  const sheet: Image = { w: WIDTH, h, px: new Uint8Array(WIDTH * h * 4) };
  for (const f of frames) {
    const o = at.get(f.name)!;
    // The frame, and its edge texels repeated out into the margin: the nearest
    // texel of the frame to each texel of the margin.
    for (let y = -PAD; y < f.h + PAD; y++) {
      for (let x = -PAD; x < f.w + PAD; x++) {
        const sx = f.x + Math.min(f.w - 1, Math.max(0, x)), sy = f.y + Math.min(f.h - 1, Math.max(0, y));
        copy(sheet, o.x + x, o.y + y, src, sx, sy);
      }
    }
  }
  const xml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<TextureAtlas imagePath="${s.out}.png">`,
    ...frames.map((f) => {
      const o = at.get(f.name)!;
      return `\t<SubTexture name="${f.name}" x="${o.x}" y="${o.y}" width="${f.w}" height="${f.h}"/>`;
    }),
    "</TextureAtlas>",
    "",
  ].join("\n");
  writeFileSync(join(OUT, `${s.out}.png`), encodePng(sheet));
  writeFileSync(join(OUT, `${s.out}.xml`), xml);
  console.log(`${s.out}: ${frames.length} frames -> ${WIDTH}x${h}`);
}

mkdirSync(OUT, { recursive: true });
for (const s of SHEETS) bake(s);
