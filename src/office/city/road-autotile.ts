import type { SpriteId } from "../map/types";
import { cellKey } from "./types";

/**
 * Road auto-tiling from the hand-labelled tileset (see dev labeller →
 * road-labels.json). Edge naming matches the labeller: N=top-left,
 * E=top-right, S=bottom-right, W=bottom-left.
 */
export const DIR = { N: 1, E: 2, S: 4, W: 8 } as const;

/**
 * Map-neighbour offset across each labelled edge, from the iso projection
 * (+mapX → screen down-right, +mapY → down-left):
 *   N → (x-1, y)   E → (x, y-1)   S → (x+1, y)   W → (x, y+1)
 */
const NEIGHBOUR: Record<keyof typeof DIR, [number, number]> = {
  N: [-1, 0],
  E: [0, -1],
  S: [1, 0],
  W: [0, 1],
};

const tile = (n: string): SpriteId => `landscapeTiles_${n}.png`;

/** Plain asphalt — used for any connection pattern with no labelled tile. */
const FALLBACK: SpriteId = tile("081");

/**
 * Connection mask (which NEIGHBOURS are roads) → sprite. Chosen so the tile's
 * OPEN edges face road neighbours and its pavement faces grass. Derived from
 * the labelled thin set; unlabelled patterns (1-wide corners, isolated) use
 * the plain-asphalt fallback so the network never gaps.
 */
const BY_MASK: Record<number, SpriteId> = {
  [DIR.N]: tile("112"), // dead-end, road to N
  [DIR.E]: tile("117"), // dead-end, road to E
  [DIR.S]: tile("105"), // dead-end, road to S
  [DIR.W]: tile("111"), // dead-end, road to W
  [DIR.N | DIR.S]: tile("074"), // straight N–S
  [DIR.E | DIR.W]: tile("082"), // straight E–W
  [DIR.N | DIR.E | DIR.S]: tile("104"), // T (back W)
  [DIR.N | DIR.E | DIR.W]: tile("089"), // T (back S)
  [DIR.N | DIR.S | DIR.W]: tile("097"), // T (back E)
  [DIR.E | DIR.S | DIR.W]: tile("096"), // T (back N)
  [DIR.N | DIR.E | DIR.S | DIR.W]: tile("090"), // cross
};

/** Road sprite for a cell's neighbour-connection mask. */
export function roadSpriteFor(mask: number): SpriteId {
  return BY_MASK[mask] ?? FALLBACK;
}

const cityTile = (n: string): SpriteId => `cityTiles_${n}.png`;

/**
 * Fully-pavemented city twins per connection mask, from the hand-labelled city
 * sheet (dev labeller "City pavement" tab → city-tile-labels.json). A thin grid
 * road cell adjacent to a building is swapped to its twin here for the paved
 * downtown look. Masks without a labelled twin (corners, lone-E dead-end) return
 * null → the cell keeps its plain landscape tile.
 */
const CITY_BY_MASK: Record<number, SpriteId> = {
  [DIR.N]: cityTile("111"), // dead-end N
  [DIR.S]: cityTile("104"), // dead-end S
  [DIR.W]: cityTile("110"), // dead-end W
  [DIR.N | DIR.S]: cityTile("073"), // straight N–S
  [DIR.E | DIR.W]: cityTile("081"), // straight E–W
  [DIR.N | DIR.E | DIR.S]: cityTile("103"), // T (back W)
  [DIR.N | DIR.E | DIR.W]: cityTile("088"), // T (back S)
  [DIR.N | DIR.S | DIR.W]: cityTile("022"), // T (back E)
  [DIR.E | DIR.S | DIR.W]: cityTile("095"), // T (back N)
  [DIR.N | DIR.E | DIR.S | DIR.W]: cityTile("082"), // cross
};

/**
 * Pavemented city twin for a cell's connection mask, or null if there's no
 * labelled twin for that shape (caller keeps the plain landscape tile).
 */
export function cityRoadSpriteFor(mask: number): SpriteId | null {
  return CITY_BY_MASK[mask] ?? null;
}

/**
 * Tiles for the 2-wide thick avenue. The two lanes meet in the middle (asphalt)
 * with pavement on each lane's OUTER side. `topLane`/`bottomLane` are straight
 * lanes; the `*Branch` variants open the outer pavement where a thin connector
 * road tees in. (Top lane: outer = E edge; bottom lane: outer = W edge.)
 */
const AVENUE = {
  topLane: tile("080"), // open N,S,W · pavement E (outer)
  bottomLane: tile("095"), // open N,S,E · pavement W (outer)
  topBranch: tile("094"), // top lane, thin branch through the E outer edge
  bottomBranch: tile("108"), // bottom lane, thin branch through the W outer edge
} as const;

/**
 * Tile for a 2-wide avenue cell. `laneIndex` 0 = top row, 1 = bottom row;
 * `outerBranch` = a thin road meets this lane on its outer (grass) side.
 */
export function avenueTileFor(laneIndex: number, outerBranch: boolean): SpriteId {
  if (laneIndex === 0) return outerBranch ? AVENUE.topBranch : AVENUE.topLane;
  return outerBranch ? AVENUE.bottomBranch : AVENUE.bottomLane;
}

/** Which of a cell's four neighbours are roads, in labeller N/E/S/W bits. */
export function roadMaskAt(
  mapX: number,
  mapY: number,
  roadCells: ReadonlySet<string>,
): number {
  let mask = 0;
  for (const d of ["N", "E", "S", "W"] as const) {
    const [dx, dy] = NEIGHBOUR[d];
    if (roadCells.has(cellKey(mapX + dx, mapY + dy))) mask |= DIR[d];
  }
  return mask;
}
