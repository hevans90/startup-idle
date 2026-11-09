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

/** How near in colour a soft edge texel must be to the solid one beside it to be its edge, per channel. */
const EDGE_NEAR = 12;
/**
 * TRUE EDGES: each soft edge texel of a frame — partly see-through, the
 * vendor's antialiasing — given the colour of the solid texel beside it, its
 * see-through kept. The vendor's are a shade darker than what they edge, so
 * wherever one tile's edge lies over its neighbour's top of the same green,
 * a darker line showed: zoomed out, a grid across every field. Only where
 * it is that texel's edge — near its colour; a shadow, dark and see-through,
 * is left as it is.
 */
function trueEdges(sheet: Image, o: { x: number; y: number }, f: Frame) {
  const px = sheet.px, W = sheet.w, fix: [number, number][] = [];
  for (let y = -PAD; y < f.h + PAD; y++) {
    for (let x = -PAD; x < f.w + PAD; x++) {
      const k = ((o.y + y) * W + o.x + x) * 4, a = px[k + 3];
      if (a === 0 || a === 255) continue;
      // The nearest solid texel, out to two away.
      let best = -1, bd = Infinity;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
        const yy = y + dy, xx = x + dx;
        if (yy < -PAD || xx < -PAD || yy >= f.h + PAD || xx >= f.w + PAD) continue;
        const q = ((o.y + yy) * W + o.x + xx) * 4, d = dx * dx + dy * dy;
        if (px[q + 3] === 255 && d < bd) { bd = d; best = q; }
      }
      if (best < 0) continue;
      if (Math.max(Math.abs(px[k] - px[best]), Math.abs(px[k + 1] - px[best + 1]), Math.abs(px[k + 2] - px[best + 2])) > EDGE_NEAR) continue;
      fix.push([k, best]);
    }
  }
  // All at once, so one fixed texel is not another's solid neighbour.
  for (const [k, q] of fix) { px[k] = px[q]; px[k + 1] = px[q + 1]; px[k + 2] = px[q + 2]; }
}

/**
 * The ground tiles that get an INNER twin. @see innerFrame (src/world/iso-frames)
 * A wood's frames are grass under trees, so their ground is grass's.
 */
const INNER_OF: Record<string, string> = {
  "landscapeTiles_067.png": "landscapeTiles_067.png",
  "landscapeTiles_083.png": "landscapeTiles_083.png",
  "landscapeTiles_059.png": "landscapeTiles_059.png",
  "landscapeTiles_067_trees1.png": "landscapeTiles_067.png",
  "landscapeTiles_067_trees2.png": "landscapeTiles_067.png",
  "landscapeTiles_067_trees3.png": "landscapeTiles_067.png",
};
const inner = (name: string) => name.replace(/\.png$/, "_inner.png");
/** The last row of a flat tile's top face in column `x` of its 132-wide frame. */
const topEdge = (x: number) => Math.floor(33 + 32 * (1 - Math.abs(x - 65.5) / 65.5));

/**
 * INNER TILES. A ground tile in the middle of a field shows only its top: the
 * tiles in front of it hide its lip and sides. But zoomed out, a mip level
 * averages the top's front edge with the darker lip under it, and every row
 * of tiles had a dark line along its front — a grid over every field. The
 * inner twin is the same tile with everything under the top painted the
 * top's colour, so its edge stays its colour at every level; the terrain uses
 * it wherever both tiles in front cover it. A tree's texels are left alone.
 */
function innerTile(src: Image, f: Frame, base: Frame, self: boolean): Image {
  const out: Image = { w: f.w, h: f.h, px: new Uint8Array(f.w * f.h * 4) };
  const at = (fr: Frame, x: number, y: number) => ((fr.y + y) * src.w + fr.x + x) * 4;
  const c = at(base, 66, 33), fill = [src.px[c], src.px[c + 1], src.px[c + 2]];
  for (let y = 0; y < f.h; y++) {
    for (let x = 0; x < f.w; x++) {
      const s = at(f, x, y), b = at(base, x, y), d = (y * f.w + x) * 4;
      for (let k = 0; k < 4; k++) out.px[d + k] = src.px[s + k];
      // The top's front edge too: the vendor's is a shade darker there.
      if (y < topEdge(x) - 1 || src.px[s + 3] === 0) continue;
      const ground = self || [0, 1, 2, 3].every((k) => src.px[s + k] === src.px[b + k]);
      if (!ground) continue;
      out.px[d] = fill[0]; out.px[d + 1] = fill[1]; out.px[d + 2] = fill[2];
    }
  }
  return out;
}

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
  let frames = framesOf(readFileSync(join(BASE, s.dir, s.xml), "utf8"));
  let src = decodePng(readFileSync(join(BASE, s.dir, s.png)));
  // The inner twins, drawn below the source in a taller copy of it.
  const twins = frames.filter((f) => INNER_OF[f.name]);
  if (twins.length) {
    const landscape = s.out === "landscape" ? src : decodePng(readFileSync(join(BASE, "landscape", "landscape_sheet.png")));
    const lf = framesOf(readFileSync(join(BASE, "landscape", "landscape_sheet.xml"), "utf8"));
    const grown: Image = { w: src.w, h: src.h + 99, px: new Uint8Array(src.w * (src.h + 99) * 4) };
    grown.px.set(src.px);
    let x = 0;
    for (const f of twins) {
      // The base frame read from the landscape sheet; a twin of a tree frame
      // compares its own texels against it, so put both in one image.
      const base = lf.find((b) => b.name === INNER_OF[f.name])!;
      const both: Image = { w: landscape.w + src.w, h: Math.max(landscape.h, src.h), px: new Uint8Array((landscape.w + src.w) * Math.max(landscape.h, src.h) * 4) };
      for (let y = 0; y < landscape.h; y++) both.px.set(landscape.px.subarray(y * landscape.w * 4, (y + 1) * landscape.w * 4), y * both.w * 4);
      for (let y = 0; y < src.h; y++) both.px.set(src.px.subarray(y * src.w * 4, (y + 1) * src.w * 4), (y * both.w + landscape.w) * 4);
      const t = innerTile(both, { ...f, x: f.x + landscape.w }, base, base.name === f.name);
      for (let y = 0; y < t.h; y++) grown.px.set(t.px.subarray(y * t.w * 4, (y + 1) * t.w * 4), ((src.h + y) * grown.w + x) * 4);
      frames = [...frames, { name: inner(f.name), x, y: src.h, w: f.w, h: f.h }];
      x += f.w;
    }
    src = grown;
  }
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
  for (const f of frames) trueEdges(sheet, at.get(f.name)!, f);
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
