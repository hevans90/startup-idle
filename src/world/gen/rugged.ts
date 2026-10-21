/**
 * World v2 — HOW HILLY A MAP IS, for the map picker: the share of its dry
 * ground that is not level with all four neighbours — a slope, a terrace
 * edge, a cliff. Flat meadow is near 0; road cuts and banks make even flat
 * land some way rough, so a map is hilly from `HILLY`. @see map-setup, CLIMB
 */
import type { Grid } from "../grid";

export const HILLY = 0.5;

export function ruggedness(g: Grid): number {
  let dry = 0, rough = 0;
  for (let y = 0; y < g.h; y++) {
    for (let x = 0; x < g.w; x++) {
      const i = y * g.w + x;
      if (g.pool[i]) continue;
      dry++;
      const h = g.height[i];
      if ((x > 0 && g.height[i - 1] !== h) || (x < g.w - 1 && g.height[i + 1] !== h)
        || (y > 0 && g.height[i - g.w] !== h) || (y < g.h - 1 && g.height[i + g.w] !== h)) rough++;
    }
  }
  return dry ? rough / dry : 0;
}
