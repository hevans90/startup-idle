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
const DISTRICT_CONNECTOR_COL: Record<GeneratorId, number> = {
  intern: 13,
  vibe_coder: 13,
  "10x_dev": 42,
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

/** A street lane runs every `BLOCK_STRIDE` rows/cols inside a district. */
function isDistrictRoad(x: number, y: number, r: Rect): boolean {
  const lx = x - r.x0;
  const ly = y - r.y0;
  return lx % BLOCK_STRIDE === BLOCK_STRIDE - 1 || ly % BLOCK_STRIDE === BLOCK_STRIDE - 1;
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
      for (let x = region.x0; x <= region.x1; x++) {
        if (isDistrictRoad(x, y, region)) roads.add(cellKey(x, y));
      }
    }
    const col = DISTRICT_CONNECTOR_COL[id];
    const from = Math.min(region.y1, AVENUE_ROWS[0]);
    const to = Math.max(region.y0, AVENUE_ROWS[AVENUE_ROWS.length - 1]);
    for (let y = from; y <= to; y++) roads.add(cellKey(col, y));
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
