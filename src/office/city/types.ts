import type { GeneratorId } from "../../state/generators.store";
import type { SpriteId, TileInstance } from "../map/types";
import type { Cell, Rect } from "../../iso/types";

// Phase 0: moved to `src/iso/`. Re-exported here so v1 call sites are unchanged.
export type { Cell, Rect };

/** A buildable slot inside a district, ordered by activation priority. */
export type Plot = Cell & {
  /** District this plot belongs to. */
  district: GeneratorId;
  /** Lower = built earlier (filled from the access road outward). */
  order: number;
};

export type DistrictLayout = {
  id: GeneratorId;
  region: Rect;
  /** Buildable cells, ascending by `order`. */
  plots: Plot[];
};

/** Static city base, generated once and reused (like `getDefaultMap()`). */
export type WorldGrid = {
  cols: number;
  rows: number;
  /** Dense ground sprite for every cell. */
  ground: TileInstance[];
  /** "mapX,mapY" of every road cell in the full network. */
  roadCells: Set<string>;
  districts: DistrictLayout[];
};

export const cellKey = (mapX: number, mapY: number): string =>
  `${mapX},${mapY}`;

export type { GeneratorId, SpriteId, TileInstance };
