import type { GeneratorId } from "../../state/generators.store";
import type { SpriteId, TileInstance } from "../map/types";
import {
  cellKey,
  type Cell,
  type DistrictLayout,
  type Plot,
  type Rect,
  type WorldGrid,
} from "./types";

export const WORLD_COLS = 56;
export const WORLD_ROWS = 40;

/** Ground sprite ids (atlas SubTexture names from the landscape sheet). */
const GROUND = {
  grass: "landscapeTiles_067.png",
  dirt: "landscapeTiles_083.png",
} as const;

/** Horizontal main avenue (spine) — 2-wide thick road (top lane, bottom lane). */
export const AVENUE_ROWS = [18, 19];

/**
 * District regions. Interns sprawl as a wide low campus (top-left), vibe coders
 * take a quarter (bottom-left), 10x devs a downtown core (right). Each region is
 * subdivided into a road grid: every 3rd local row/col is a street, leaving 2×2
 * blocks of buildable plots.
 */
const DISTRICT_REGIONS: Record<GeneratorId, Rect> = {
  intern: { x0: 2, y0: 1, x1: 26, y1: 16 },
  vibe_coder: { x0: 2, y0: 21, x1: 26, y1: 38 },
  "10x_dev": { x0: 30, y0: 3, x1: 54, y1: 36 },
};

/** Ground under each district region (downtown is paved dirt, campuses grass). */
const DISTRICT_GROUND: Record<GeneratorId, SpriteId> = {
  intern: GROUND.grass,
  vibe_coder: GROUND.grass,
  "10x_dev": GROUND.dirt,
};

/** Column on which each district connects to the avenue. */
// Each connector aligns with one of its district's grid columns so it links
// the internal grid to the avenue (intern/vibe x0=2 → col 13; downtown x0=30
// → col 41; both are grid lanes at (x-x0) % BLOCK_STRIDE === BLOCK_STRIDE-1).
const DISTRICT_CONNECTOR_COL: Record<GeneratorId, number> = {
  intern: 13,
  vibe_coder: 13,
  "10x_dev": 41,
};

function inRect(x: number, y: number, r: Rect): boolean {
  return x >= r.x0 && x <= r.x1 && y >= r.y0 && y <= r.y1;
}

/**
 * Cells between street lanes (block size). Larger blocks → long, uninterrupted
 * streets so sidewalk tiles read as continuous lines instead of dashes broken
 * at every intersection.
 */
const BLOCK_STRIDE = 6;

// Cross-streets (rows parallel to the avenue) are anchored to the AVENUE, not to
// each district's own origin — otherwise districts with different `y0` (and so
// different phase mod BLOCK_STRIDE) place their first street at different
// distances from the spine, making one district's blocks hug the avenue closer
// than the others. These anchors are the last buildable row before the avenue's
// clear buffer on each side; blocks then march outward symmetrically.
const ABOVE_ANCHOR = AVENUE_ROWS[0] - 2;
const BELOW_ANCHOR = AVENUE_ROWS[AVENUE_ROWS.length - 1] + 2;

/** Whether row `y` is a cross-street, measured outward from the avenue. */
function isCrossStreetRow(y: number): boolean {
  if (y <= ABOVE_ANCHOR)
    return (ABOVE_ANCHOR - y) % BLOCK_STRIDE === BLOCK_STRIDE - 1;
  if (y >= BELOW_ANCHOR)
    return (y - BELOW_ANCHOR) % BLOCK_STRIDE === BLOCK_STRIDE - 1;
  return false; // inside the avenue's buffer
}

/**
 * A street lane runs every `BLOCK_STRIDE` cells. Vertical lanes are per-district
 * (so connectors line up with a district's own grid); horizontal cross-streets
 * are avenue-aligned so every district keeps the same block depth against the
 * spine.
 */
function isDistrictRoad(x: number, y: number, r: Rect): boolean {
  const lx = x - r.x0;
  return lx % BLOCK_STRIDE === BLOCK_STRIDE - 1 || isCrossStreetRow(y);
}

/**
 * Keep a 1-cell clear buffer around the avenue: no district grid road may sit
 * on or directly beside an avenue row. Otherwise (e.g. downtown spans the
 * avenue) a thin road runs parallel one tile away and the avenue's branch
 * detection mis-fires all along that lane. Connectors still cross this buffer.
 */
function nearAvenue(y: number): boolean {
  return AVENUE_ROWS.some((ar) => Math.abs(ar - y) <= 1);
}

function buildRoadCells(): Set<string> {
  const roads = new Set<string>();
  // Main avenue across the full width.
  for (const y of AVENUE_ROWS) {
    for (let x = 0; x < WORLD_COLS; x++) roads.add(cellKey(x, y));
  }
  // District internal grids + a connector column down/up to the avenue.
  for (const id of Object.keys(DISTRICT_REGIONS) as GeneratorId[]) {
    const region = DISTRICT_REGIONS[id];
    for (let y = region.y0; y <= region.y1; y++) {
      if (nearAvenue(y)) continue; // keep the avenue's buffer clear
      for (let x = region.x0; x <= region.x1; x++) {
        if (isDistrictRoad(x, y, region)) roads.add(cellKey(x, y));
      }
    }
    // One connector column, continuous from the district through the avenue —
    // the only road that touches the avenue's outer edge (so branches there are
    // intentional). Spans across the buffer to link the grid to the avenue.
    const col = DISTRICT_CONNECTOR_COL[id];
    const lo = Math.min(region.y0, AVENUE_ROWS[0]);
    const hi = Math.max(region.y1, AVENUE_ROWS[AVENUE_ROWS.length - 1]);
    for (let y = lo; y <= hi; y++) roads.add(cellKey(col, y));
  }
  return roads;
}

/** Manhattan distance from a cell to the district's connector column @ avenue. */
function connectorDistance(x: number, y: number, id: GeneratorId): number {
  return Math.abs(x - DISTRICT_CONNECTOR_COL[id]) + Math.abs(y - AVENUE_ROWS[0]);
}

function buildDistricts(roads: Set<string>): DistrictLayout[] {
  return (Object.keys(DISTRICT_REGIONS) as GeneratorId[]).map((id) => {
    const region = DISTRICT_REGIONS[id];
    const cells: Cell[] = [];
    for (let y = region.y0; y <= region.y1; y++) {
      // Keep the avenue's clear buffer plot-free too. The left districts end
      // before the buffer naturally, but the 10x region spans the avenue, so
      // without this its buildings would sit a tile closer to the spine than
      // the others.
      if (nearAvenue(y)) continue;
      for (let x = region.x0; x <= region.x1; x++) {
        if (!roads.has(cellKey(x, y))) cells.push({ mapX: x, mapY: y });
      }
    }
    // Fill from the access road outward for a coherent growth feel.
    cells.sort(
      (a, b) =>
        connectorDistance(a.mapX, a.mapY, id) -
        connectorDistance(b.mapX, b.mapY, id),
    );
    const plots: Plot[] = cells.map((c, order) => ({ ...c, district: id, order }));
    return { id, region, plots };
  });
}

function buildGround(): TileInstance[] {
  const ground: TileInstance[] = [];
  for (let y = 0; y < WORLD_ROWS; y++) {
    for (let x = 0; x < WORLD_COLS; x++) {
      let spriteId: SpriteId = GROUND.grass;
      for (const id of Object.keys(DISTRICT_REGIONS) as GeneratorId[]) {
        if (inRect(x, y, DISTRICT_REGIONS[id])) {
          spriteId = DISTRICT_GROUND[id];
          break;
        }
      }
      ground.push({ mapX: x, mapY: y, z: 0, spriteId });
    }
  }
  return ground;
}

let cached: WorldGrid | null = null;

/** The static city base. Deterministic and memoized. */
export function generateWorld(): WorldGrid {
  if (cached) return cached;
  const roadCells = buildRoadCells();
  cached = {
    cols: WORLD_COLS,
    rows: WORLD_ROWS,
    ground: buildGround(),
    roadCells,
    districts: buildDistricts(roadCells),
  };
  return cached;
}
