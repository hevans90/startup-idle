import type { GeneratorId } from "../../state/generators.store";
import type { SpriteId, TileInstance } from "../map/types";

export type Cell = { mapX: number; mapY: number };

export type Rect = { x0: number; y0: number; x1: number; y1: number };

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
