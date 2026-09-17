/**
 * Frame metadata for the tile browser.
 *
 * Separate from `loadIsometricAtlasTextures`, which returns Pixi Textures for
 * rendering. The browser needs the frame RECTS and the sheet URL so a thumbnail
 * can be a `<div>` with a `background-position` — ~940 divs against four
 * already-loaded PNGs, rather than 940 image requests or 940 Pixi sprites.
 */
import { parseStarlingAtlasXml } from "../../iso/atlas/parse-starling-atlas";

const ATLAS_BASE = "/isometric_assets";

export type FrameEntry = {
  /** SubTexture name, e.g. "landscapeTiles_067.png" — the id the engine uses. */
  name: string;
  /** Short label for the UI, e.g. "067". */
  label: string;
  sheet: string;
  sheetUrl: string;
  x: number;
  y: number;
  w: number;
  h: number;
};

const SHEETS: { sheet: string; dir: string; xml: string; png: string }[] = [
  { sheet: "landscape", dir: "landscape", xml: "landscape_sheet.xml", png: "landscape_sheet.png" },
  { sheet: "cityTiles", dir: "city_tiles", xml: "cityTiles_sheet.xml", png: "cityTiles_sheet.png" },
  { sheet: "buildings", dir: "buildings", xml: "building_sheet.xml", png: "building_sheet.png" },
  // Deliberately last and largest: 544 frames of vehicles, unused by the map
  // today but there is no reason to hide them from the browser.
  { sheet: "vehicles", dir: "vehicles", xml: "vehicle_sheet.xml", png: "vehicle_sheet.png" },
];

let cache: FrameEntry[] | null = null;

export async function loadAtlasIndex(): Promise<FrameEntry[]> {
  if (cache) return cache;
  const all: FrameEntry[] = [];
  for (const s of SHEETS) {
    const base = `${ATLAS_BASE}/${s.dir}`;
    try {
      const xml = await (await fetch(`${base}/${s.xml}`)).text();
      const { textures } = parseStarlingAtlasXml(xml);
      for (const t of textures) {
        all.push({
          name: t.name,
          label: t.name.replace(/^[A-Za-z]+_/, "").replace(/\.png$/, ""),
          sheet: s.sheet,
          sheetUrl: `${base}/${s.png}`,
          x: t.x, y: t.y, w: t.width, h: t.height,
        });
      }
    } catch {
      // A missing sheet should not take the whole browser down.
      console.warn(`[world] atlas index: could not read ${s.xml}`);
    }
  }
  cache = all;
  return all;
}

/** Distinct frame sizes present, for the size filter. */
export function frameSizes(entries: readonly FrameEntry[]): string[] {
  const seen = new Set<string>();
  for (const e of entries) seen.add(`${e.w}×${e.h}`);
  return [...seen].sort();
}

/**
 * CSS showing one atlas frame inside a fixed box.
 *
 * The whole sheet is scaled by `k` via `background-size` and offset so the
 * wanted frame lands at the origin — no transform, so layout is unaffected and
 * the box can be sized normally.
 */
export function thumbStyle(e: FrameEntry, box: number, sheetSize: { w: number; h: number }): React.CSSProperties {
  const k = Math.min(box / e.w, box / e.h, 1);
  return {
    width: Math.round(e.w * k),
    height: Math.round(e.h * k),
    backgroundImage: `url(${e.sheetUrl})`,
    backgroundSize: `${sheetSize.w * k}px ${sheetSize.h * k}px`,
    backgroundPosition: `${-e.x * k}px ${-e.y * k}px`,
    backgroundRepeat: "no-repeat",
    imageRendering: "pixelated",
  };
}

/** Natural pixel size of each sheet, needed to scale background-size. */
export async function loadSheetSizes(
  entries: readonly FrameEntry[],
): Promise<Record<string, { w: number; h: number }>> {
  const urls = [...new Set(entries.map((e) => e.sheetUrl))];
  const out: Record<string, { w: number; h: number }> = {};
  await Promise.all(
    urls.map(
      (url) =>
        new Promise<void>((resolve) => {
          const img = new Image();
          img.onload = () => { out[url] = { w: img.naturalWidth, h: img.naturalHeight }; resolve(); };
          img.onerror = () => { out[url] = { w: 1, h: 1 }; resolve(); };
          img.src = url;
        }),
    ),
  );
  return out;
}
