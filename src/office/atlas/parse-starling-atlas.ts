import { XMLParser } from "fast-xml-parser";

export type StarlingSubTexture = {
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
};

export type ParsedStarlingAtlas = {
  imageFile: string;
  textures: StarlingSubTexture[];
};

type SubTextureRaw = {
  "@_name"?: string;
  "@_x"?: number;
  "@_y"?: number;
  "@_width"?: number;
  "@_height"?: number;
};

type TextureAtlasRoot = {
  TextureAtlas?: {
    "@_imagePath"?: string;
    SubTexture?: SubTextureRaw | SubTextureRaw[];
  };
};

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  parseAttributeValue: true,
  trimValues: true,
});

function asSubTextureArray(
  raw: SubTextureRaw | SubTextureRaw[] | undefined
): SubTextureRaw[] {
  if (raw == null) return [];
  return Array.isArray(raw) ? raw : [raw];
}

/**
 * Parse a Starling / Sparrow `TextureAtlas` XML into frame rects for Pixi `Spritesheet` JSON.
 */
export function parseStarlingAtlasXml(xml: string): ParsedStarlingAtlas {
  const root = xmlParser.parse(xml) as TextureAtlasRoot;
  const atlas = root.TextureAtlas;
  if (!atlas) {
    throw new Error("Starling atlas XML: missing <TextureAtlas>");
  }
  const imageFile = atlas["@_imagePath"]?.trim() ?? "";
  if (!imageFile) {
    throw new Error("Starling atlas XML: missing imagePath on TextureAtlas");
  }
  const textures: StarlingSubTexture[] = [];
  for (const el of asSubTextureArray(atlas.SubTexture)) {
    const name = el["@_name"]?.trim();
    const x = Number(el["@_x"]);
    const y = Number(el["@_y"]);
    const width = Number(el["@_width"]);
    const height = Number(el["@_height"]);
    if (!name) continue;
    if (![x, y, width, height].every(Number.isFinite)) {
      throw new Error(`Starling atlas XML: bad rect on SubTexture "${name}"`);
    }
    textures.push({ name, x, y, width, height });
  }
  if (textures.length === 0) {
    throw new Error("Starling atlas XML: no SubTexture entries");
  }
  return { imageFile, textures };
}

/** Pixi `Spritesheet` JSON `frames` + `meta` (TexturePacker-compatible). */
export function starlingTexturesToSpritesheetData(
  subtextures: StarlingSubTexture[],
  imageFile: string,
  imageWidth: number,
  imageHeight: number
) {
  const frames: Record<
    string,
    {
      frame: { x: number; y: number; w: number; h: number };
      sourceSize: { w: number; h: number };
      spriteSourceSize: { x: number; y: number; w: number; h: number };
    }
  > = {};
  for (const st of subtextures) {
    frames[st.name] = {
      frame: { x: st.x, y: st.y, w: st.width, h: st.height },
      sourceSize: { w: st.width, h: st.height },
      spriteSourceSize: { x: 0, y: 0, w: st.width, h: st.height },
    };
  }
  return {
    frames,
    meta: {
      image: imageFile,
      format: "RGBA8888" as const,
      size: { w: imageWidth, h: imageHeight },
      scale: 1,
    },
  };
}
