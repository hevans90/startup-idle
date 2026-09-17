import type { SpriteId } from "../../iso/types";

// Phase 0: moved to `src/iso/`. Re-exported here so v1 call sites are unchanged.
export type { SpriteId };

/** One placed tile in map space; z=0 is ground, higher z stacks upward (screen-up). */
export type TileInstance = {
  mapX: number;
  mapY: number;
  z: number;
  spriteId: SpriteId;
};
