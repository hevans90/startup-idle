/** SubTexture `name` from a `*_sheet.xml` under `public/isometric_assets` (e.g. `landscapeTiles_019.png`). */
export type SpriteId = string;

/** One placed tile in map space; z=0 is ground, higher z stacks upward (screen-up). */
export type TileInstance = {
  mapX: number;
  mapY: number;
  z: number;
  spriteId: SpriteId;
};
