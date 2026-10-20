import { Assets, Spritesheet, Texture, TextureSource } from "pixi.js";

import {
  parseStarlingAtlasXml,
  starlingTexturesToSpritesheetData,
} from "./parse-starling-atlas";

const ATLAS_BASE = "/isometric_assets";

type AtlasDescriptor = {
  dir: string;
  xmlFile: string;
  pngFile: string;
};

const ISO_ATLASES: AtlasDescriptor[] = [
  { dir: "buildings", xmlFile: "building_sheet.xml", pngFile: "building_sheet.png" },
  {
    dir: "landscape",
    xmlFile: "landscape_sheet.xml",
    pngFile: "landscape_sheet.png",
  },
  { dir: "vehicles", xmlFile: "vehicle_sheet.xml", pngFile: "vehicle_sheet.png" },
  // Fully-pavemented road twins, swapped in beside buildings (cityTiles_NNN.png).
  { dir: "city_tiles", xmlFile: "cityTiles_sheet.xml", pngFile: "cityTiles_sheet.png" },
  /**
   * DERIVED, not vendor art: inner-corner road tiles composited from the
   * landscape sheet by `dev/bake-road-corners.ts` (`bun run bake:road-corners`).
   * Baked rather than composited at runtime so they sample and batch exactly
   * like every other frame — see that script's header. Frames are named
   * `roadCorner_<base>_<corners>.png`.
   */
  { dir: "derived", xmlFile: "roadCorners_sheet.xml", pngFile: "roadCorners_sheet.png" },
  /**
   * DERIVED: ground tiles with trees stamped on them, from
   * `dev/bake-trees.ts` (`bun run bake:trees`). Frames are named
   * `<base>_trees<n>.png`. A wood is a terrain MATERIAL rather than a
   * structure, so it saves, paints and renders through the paths that already
   * exist — see that script's header.
   */
  { dir: "derived", xmlFile: "trees_sheet.xml", pngFile: "trees_sheet.png" },
];

/**
 * CRISP UP CLOSE, SMOOTH ZOOMED OUT: a texel drawn bigger than a pixel is
 * `nearest`, the pixel art as drawn; drawn smaller, it is MIPMAPPED and
 * filtered, so a zoomed-out map holds still instead of shimmering as the
 * camera moves. The sheets loaded are the PADDED ones (`bun run bake:padded`),
 * every frame with its edge extruded `PAD` texels, so a mip level averages a
 * frame with itself and not its neighbour — clean down to level `MIP_LEVELS`,
 * where the sampler stops. @see dev/bake-padded-atlases.ts
 */
export const MIP_LEVELS = 4;
/** `?nomips`: the vendor sheets, `nearest` everywhere, as it was — to compare against. */
const NO_MIPS = typeof location !== "undefined" && new URLSearchParams(location.search).has("nomips");
export function crispUpClose(source: TextureSource) {
  if (NO_MIPS) { source.scaleMode = "nearest"; return; }
  source.magFilter = "nearest";
  source.minFilter = "linear";
  source.mipmapFilter = "linear";
  source.style.lodMaxClamp = MIP_LEVELS;
  source.style.update();
}

/** Each source sheet's padded twin, in `isometric_assets/padded/`. */
const PADDED: Record<string, string> = {
  "building_sheet.png": "buildings", "landscape_sheet.png": "landscape", "vehicle_sheet.png": "vehicles",
  "cityTiles_sheet.png": "city_tiles", "roadCorners_sheet.png": "road_corners", "trees_sheet.png": "trees",
};

async function loadOneAtlas(
  desc: AtlasDescriptor
): Promise<Record<string, Texture<TextureSource>>> {
  // The padded twin of the sheet, made from it. @see crispUpClose
  const padded = NO_MIPS ? undefined : PADDED[desc.pngFile];
  if (padded) desc = { dir: "padded", xmlFile: `${padded}.xml`, pngFile: `${padded}.png` };
  const base = `${ATLAS_BASE}/${desc.dir}`;
  const xmlText = await (await fetch(`${base}/${desc.xmlFile}`)).text();
  const { imageFile, textures } = parseStarlingAtlasXml(xmlText);
  if (imageFile !== desc.pngFile) {
    console.warn(
      `[isometric] ${desc.xmlFile} imagePath="${imageFile}" expected "${desc.pngFile}"; using ${desc.pngFile}`
    );
  }
  const pngUrl = `${base}/${desc.pngFile}`;
  const sheet: Texture = await Assets.load({ src: pngUrl, data: { autoGenerateMipmaps: !NO_MIPS } });
  crispUpClose(sheet.source);
  const data = starlingTexturesToSpritesheetData(
    textures,
    desc.pngFile,
    sheet.width,
    sheet.height
  );
  const spritesheet = new Spritesheet(sheet, data);
  return spritesheet.parse() as Promise<Record<string, Texture<TextureSource>>>;
}

/**
 * City detail props (trees, lamp posts, benches) ship as loose PNGs under
 * `city_details/PNG/` rather than a packed Starling atlas. Loaded individually
 * and keyed by filename (e.g. `cityDetails_010.png`) so they slot into the same
 * texture map as the atlas SubTextures.
 */
const CITY_DETAIL_COUNT = 11; // cityDetails_000.png … cityDetails_010.png

async function loadCityDetails(): Promise<
  Record<string, Texture<TextureSource>>
> {
  const out: Record<string, Texture<TextureSource>> = {};
  const base = `${ATLAS_BASE}/city_details/PNG`;
  await Promise.all(
    Array.from({ length: CITY_DETAIL_COUNT }, async (_, i) => {
      const name = `cityDetails_${String(i).padStart(3, "0")}.png`;
      const tex: Texture = await Assets.load({ src: `${base}/${name}`, data: { autoGenerateMipmaps: !NO_MIPS } });
      crispUpClose(tex.source);
      out[name] = tex;
    }),
  );
  return out;
}

/**
 * Loads buildings, landscape, and vehicle Starling atlases plus the loose
 * city-detail props from `public/isometric_assets`. Keys are SubTexture `name`
 * values (e.g. `landscapeTiles_019.png`, `buildingTiles_061.png`,
 * `cityDetails_010.png`).
 */
export async function loadIsometricAtlasTextures(): Promise<
  Record<string, Texture<TextureSource>>
> {
  const merged: Record<string, Texture<TextureSource>> = {};
  for (const desc of ISO_ATLASES) {
    const part = await loadOneAtlas(desc);
    for (const [name, tex] of Object.entries(part)) {
      if (merged[name]) {
        throw new Error(
          `Duplicate SubTexture name across atlases: "${name}" (check isometric_assets XML)`
        );
      }
      merged[name] = tex;
    }
  }
  for (const [name, tex] of Object.entries(await loadCityDetails())) {
    merged[name] = tex;
  }
  return merged;
}
