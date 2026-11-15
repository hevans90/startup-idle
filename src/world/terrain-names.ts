/**
 * World v2 — WHAT THE GROUND IS MADE OF, by name: the palette's entries.
 *
 * A saved map carries its palette, and maps saved while the ground was drawn
 * from a sheet of tiles carry that sheet's frame names. `terrainName` reads
 * either: the six the game has kept, and anything else — a frame painted from
 * the old tile browser — as grass, which is what stands there now.
 */
export const TERRAIN_NAMES = ["grass", "dirt", "sand", "wood1", "wood2", "wood3"] as const;
export type TerrainName = (typeof TERRAIN_NAMES)[number];

/** The names maps were saved with, before. */
const WAS: Readonly<Record<string, TerrainName>> = {
  "landscapeTiles_067.png": "grass",
  "landscapeTiles_083.png": "dirt",
  "landscapeTiles_059.png": "sand",
  "landscapeTiles_067_trees1.png": "wood1",
  "landscapeTiles_067_trees2.png": "wood2",
  "landscapeTiles_067_trees3.png": "wood3",
};

/** A palette entry as the game names it now; null stays null (the void). */
export const terrainName = (saved: string | null): TerrainName | null =>
  saved === null ? null : (TERRAIN_NAMES as readonly string[]).includes(saved) ? (saved as TerrainName) : WAS[saved] ?? "grass";

/** How many trees a wooded material carries: none for the rest. */
export const treesIn = (name: string | null | undefined): number => {
  const m = name ? /^wood(\d)$/.exec(terrainName(name) ?? "") : null;
  return m ? Number(m[1]) : 0;
};
