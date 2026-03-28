import type { SpriteId, TileInstance } from "./types";

export type ParsedTilemap = {
  cols: number;
  rows: number;
  tiles: TileInstance[];
};

/**
 * Parse legend.txt: `#` starts comment; otherwise `char sprite_id` (char must be first column).
 * `sprite_id` must match a SubTexture `name` in a `*_sheet.xml` under `public/isometric_assets`.
 */
export function parseLegend(raw: string): Map<string, SpriteId> {
  const map = new Map<string, SpriteId>();
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const ch = trimmed[0];
    const key = trimmed.slice(1).trim();
    if (!key) continue;
    map.set(ch, key);
  }
  return map;
}

/** Keeps rows that are only spaces (sparse layers). Strips one trailing empty line from final newline. */
function normalizeLayerLines(raw: string): string[] {
  const lines = raw.split(/\r?\n/);
  if (lines.length > 0 && lines[lines.length - 1] === "") {
    lines.pop();
  }
  return lines;
}

/**
 * Sparse layers (z > 0): fit any ragged text block to the world size from layer 0.
 * Short rows pad with spaces on the right; long rows truncate; extra rows dropped;
 * missing rows are all spaces.
 */
function fitOverlayLinesToExtent(
  lines: string[],
  cols: number,
  rows: number
): string[] {
  const trimmed = lines.slice(0, rows);
  while (trimmed.length < rows) {
    trimmed.push("");
  }
  return trimmed.map((line) => {
    if (line.length >= cols) {
      return line.slice(0, cols);
    }
    return line.padEnd(cols, " ");
  });
}

/**
 * One layer file = rows of text; each row is mapX 0..cols-1. Space = skip cell.
 * `z` is the elevation for every non-space cell in this file.
 *
 * Layer 0: every row must match `cols` and row count `rows` (defines the world).
 * z > 0: rows may be shorter/longer than `cols` or fewer/more than `rows`; padded or truncated to fit.
 */
export function parseLayer(
  raw: string,
  z: number,
  legend: Map<string, SpriteId>,
  cols: number,
  rows: number
): TileInstance[] {
  const rawLines = normalizeLayerLines(raw);
  const lines =
    z === 0 ? rawLines : fitOverlayLinesToExtent(rawLines, cols, rows);

  if (z === 0 && lines.length !== rows) {
    throw new Error(
      `Layer z=0: expected ${rows} rows, got ${rawLines.length}`
    );
  }
  const out: TileInstance[] = [];
  for (let mapY = 0; mapY < rows; mapY++) {
    const line = lines[mapY];
    if (z === 0 && line.length !== cols) {
      throw new Error(
        `Layer z=0 row ${mapY}: expected width ${cols}, got ${line.length}`
      );
    }
    for (let mapX = 0; mapX < cols; mapX++) {
      const ch = line[mapX];
      if (ch === " ") {
        if (z === 0) {
          throw new Error(
            `Layer z=0 at (${mapX},${mapY}): space not allowed (dense ground)`
          );
        }
        continue;
      }
      const spriteId = legend.get(ch);
      if (!spriteId) {
        throw new Error(
          `Layer z=${z} at (${mapX},${mapY}): unknown symbol '${ch}' (add to legend.txt)`
        );
      }
      out.push({ mapX, mapY, z, spriteId });
    }
  }
  return out;
}

/**
 * Layer 0 must be fully dense (no spaces) so every ground cell is defined.
 * Higher layers are sparse (space = no tile at that z).
 */
export function parseLayeredTilemap(
  legendRaw: string,
  layerRaws: [string, number][]
): ParsedTilemap {
  const legend = parseLegend(legendRaw);
  if (layerRaws.length === 0) {
    throw new Error("parseLayeredTilemap: at least one layer required");
  }

  const [baseRaw] = layerRaws[0];
  const baseLines = normalizeLayerLines(baseRaw);
  const rows = baseLines.length;
  const cols = baseLines[0]?.length ?? 0;
  if (!cols) throw new Error("Layer 0 is empty");

  for (let y = 0; y < rows; y++) {
    if (baseLines[y].length !== cols) {
      throw new Error(`Layer 0 row ${y}: ragged line width`);
    }
  }

  const tiles: TileInstance[] = [];
  for (const [raw, z] of layerRaws) {
    tiles.push(...parseLayer(raw, z, legend, cols, rows));
  }

  return { cols, rows, tiles };
}
