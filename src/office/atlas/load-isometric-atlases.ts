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
 * Loads buildings, landscape, and vehicle Starling atlases from `public/isometric_assets`.
 * Keys are SubTexture `name` values (e.g. `landscapeTiles_019.png`, `buildingTiles_061.png`).
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
  return merged;
}
