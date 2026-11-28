/**
 * WHAT EACH FIELD GROWS, and when it is cut: the same parcels and the same crops the ground shader draws (@see
 * render/ground-mesh fieldOver), so the harvest paid is the one seen. A field is a parcel's crop:
 *
 * - **Hay**, mown in spring;
 * - **wheat, barley, rape**, cut in summer;
 * - **maize**, cut in autumn;
 * - **kale**, picked in winter.
 *
 * Each field is cut once a year, in its season — so a farm's ground pays four times a year, a share each time.
 */

/** The shader's hash, to the bit: an LCG then an xorshift-multiply mix, on u32s. */
export function cropHash(x: number, y: number): number {
  let h = (Math.imul(x | 0, 1664525) + Math.imul(y | 0, 1013904223)) >>> 0;
  h = (h ^ (h >>> 16)) >>> 0;
  h = Math.imul(h, 0x7feb352d) >>> 0;
  h = (h ^ (h >>> 15)) >>> 0;
  h = Math.imul(h, 0x846ca68b) >>> 0;
  h = (h ^ (h >>> 16)) >>> 0;
  return h / 4294967295;
}

export type Crop = "wheat" | "barley" | "rape" | "maize" | "kale" | "hay";
/** The crops by the shader's number for them. */
export const CROPS: readonly Crop[] = ["wheat", "barley", "rape", "hay", "maize", "kale"];

/** The seasons, by quarter of the year: spring, summer, autumn, winter. */
export type Season = 0 | 1 | 2 | 3;
export const SEASON_NAMES = ["Spring", "Summer", "Autumn", "Winter"] as const;

/** When in the year (its share) each season's crop is cut. Kept with the shader's cut and mow windows. */
export const HARVEST_AT: readonly number[] = [0.18, 0.425, 0.685, 0.93];

/** The season a crop is cut in. */
export const seasonOf = (c: Crop): Season => (c === "hay" ? 0 : c === "maize" ? 2 : c === "kale" ? 3 : 1);

/** A cell's PARCEL, read at its middle as the shader reads it: its three hashes (the crop, its lag, its rows). */
function parcelOf(x: number, y: number): { pc: [number, number] } {
  const px = x + 0.5, py = y + 0.5;
  const band = Math.floor(py / 4);
  const qx = (px + cropHash(band, 91) * 3) / 3, qy = py / 4;
  return { pc: [Math.floor(qx), Math.floor(qy)] };
}

/** THE CROP on a cell: its parcel's. */
export function cropAt(x: number, y: number): Crop {
  const { pc } = parcelOf(x, y), h1 = cropHash(pc[0], pc[1]);
  return h1 < 0.12 ? "wheat" : h1 < 0.2 ? "barley" : h1 < 0.27 ? "rape" : h1 < 0.5 ? "maize" : h1 < 0.75 ? "kale" : "hay";
}

/**
 * HOW A CELL'S FIELD IS SOWN, as the shader ploughs it: whether its rows run along v (lines of one u) or along u,
 * and its parcel's lag in the year, a share of one. @see render/ground-mesh fieldOver
 */
export function cropRows(x: number, y: number): { acrossU: boolean; lag: number } {
  const { pc } = parcelOf(x, y);
  return { acrossU: cropHash(pc[0] + 3, pc[1] + 29) > 0.5, lag: (cropHash(pc[0] + 17, pc[1] + 5) - 0.5) * 0.03 };
}

/** Rows of a crop to a tile, as sown and as the shader ploughs them: maize and kale, bigger plants, four. */
export const rowsOf = (c: Crop) => (c === "maize" || c === "kale" ? 4 : 8);

/** The season a cell's field is cut in. */
export const cropSeason = (x: number, y: number): Season => seasonOf(cropAt(x, y));

/** The next harvest after the year's share `t`: which season, and when (as a year, past `t`). */
export function nextHarvest(t: number): { season: Season; at: number } {
  const y = Math.floor(t), part = t - y;
  for (let s = 0; s < 4; s++) if (HARVEST_AT[s] > part) return { season: s as Season, at: y + HARVEST_AT[s] };
  return { season: 0, at: y + 1 + HARVEST_AT[0] };
}
