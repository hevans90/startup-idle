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
];

async function loadOneAtlas(
  desc: AtlasDescriptor
): Promise<Record<string, Texture<TextureSource>>> {
  const base = `${ATLAS_BASE}/${desc.dir}`;
  const xmlText = await (await fetch(`${base}/${desc.xmlFile}`)).text();
  const { imageFile, textures } = parseStarlingAtlasXml(xmlText);
  if (imageFile !== desc.pngFile) {
    console.warn(
      `[isometric] ${desc.xmlFile} imagePath="${imageFile}" expected "${desc.pngFile}"; using ${desc.pngFile}`
    );
  }
  const pngUrl = `${base}/${desc.pngFile}`;
  const sheet: Texture = await Assets.load(pngUrl);
  sheet.source.scaleMode = "nearest";
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
      const tex: Texture = await Assets.load(`${base}/${name}`);
      tex.source.scaleMode = "nearest";
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
