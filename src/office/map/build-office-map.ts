import legendRaw from "./tilemaps/default/legend.txt?raw";
import layer0Raw from "./tilemaps/default/layer-0-ground.txt?raw";
import layer1Raw from "./tilemaps/default/layer-1.txt?raw";
import layer2Raw from "./tilemaps/default/layer-2.txt?raw";
import {
  parseLayeredTilemap,
  type ParsedTilemap,
} from "./parse-tilemap-text";

const defaultMap: ParsedTilemap = parseLayeredTilemap(legendRaw, [
  [layer0Raw, 0],
  [layer1Raw, 1],
  [layer2Raw, 2],
]);

export function getDefaultMap(): ParsedTilemap {
  return defaultMap;
}

/** All `TileInstance`s for the bundled default map (see `tilemaps/default/*.txt`). */
export function buildOfficeMap(): ParsedTilemap["tiles"] {
  return defaultMap.tiles;
}
