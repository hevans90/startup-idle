/**
 * World v2 — A PIPE'S ROUTE, for the AI: from a building that drinks to the
 * nearest water, over the company's own free ground — under roads, round
 * buildings, never in the water. If the water stands above the building's
 * floor the route is a gravity run; if not, its shore end is a PUMP HOUSE,
 * when one pump's lift is enough. Pure: a grid and what is the company's in, a
 * route out, valid as the Pipe tool and the pump's placement judge it.
 * @see gamePipeRun, runPumps, plans/datacentre-water.md §6
 */
import { PUMP_HEAD } from "../../game/cooling";
import { idx, inBounds, structureAt, type Grid, type Structure } from "../grid";

type Cell = { x: number; y: number };

export type PipeRoute = {
  /** The pipe, in order from the water's end — or the pump's — to the building. */
  pipe: Cell[];
  /** Where a pump house goes, beside the water, or null for a gravity run. */
  pump: Cell | null;
};

const SIDES = [[1, 0], [-1, 0], [0, 1], [0, -1]] as const;

/**
 * The shortest route from `drinker` to water, or null. `wet` is whether water
 * stands on a tile now; `surface` how high its top is there. `avoid` keeps a
 * route off tiles — a Paranoid AI keeps clear of the river. @see styleOf
 */
export function routePipe(
  g: Grid, drinker: Structure, owned: (x: number, y: number) => boolean,
  wet: (x: number, y: number) => boolean, surface: (x: number, y: number) => number,
  avoid: (x: number, y: number) => boolean = () => false,
): PipeRoute | null {
  const free = (x: number, y: number) =>
    inBounds(g, x, y) && owned(x, y) && !wet(x, y) && structureAt(g, x, y) < 0 && !g.pipe[idx(g, x, y)] && !avoid(x, y);
  const floor = g.height[idx(g, drinker.x, drinker.y)];
  // Out from every free tile beside the building, a tile at a time.
  const from = new Int32Array(g.w * g.h).fill(-2);
  const queue: number[] = [];
  for (let y = drinker.y - 1; y <= drinker.y + drinker.h; y++) {
    for (let x = drinker.x - 1; x <= drinker.x + drinker.w; x++) {
      const inside = x >= drinker.x && x < drinker.x + drinker.w && y >= drinker.y && y < drinker.y + drinker.h;
      const corner = (x < drinker.x || x >= drinker.x + drinker.w) && (y < drinker.y || y >= drinker.y + drinker.h);
      if (inside || corner || !free(x, y)) continue;
      from[idx(g, x, y)] = -1;
      queue.push(idx(g, x, y));
    }
  }
  for (let q = 0; q < queue.length; q++) {
    const i = queue[q], x = i % g.w, y = (i - x) / g.w;
    // AT THE SHORE: water beside this tile. Gravity, a pump, or no good.
    const water = SIDES.map(([dx, dy]) => ({ x: x + dx, y: y + dy })).find((c) => inBounds(g, c.x, c.y) && wet(c.x, c.y));
    if (water) {
      const top = surface(water.x, water.y);
      const path: Cell[] = [];
      for (let k = i; k !== -1; k = from[k]) path.push({ x: k % g.w, y: (k - (k % g.w)) / g.w });
      // `path` runs from the shore to the building already.
      if (top > floor) return { pipe: path, pump: null };
      if (top + PUMP_HEAD > floor && path.length > 1) return { pipe: path.slice(1), pump: path[0] };
      // No good here: on along the shore.
    }
    for (const [dx, dy] of SIDES) {
      const nx = x + dx, ny = y + dy;
      if (!free(nx, ny)) continue;
      const j = idx(g, nx, ny);
      if (from[j] !== -2) continue;
      from[j] = i;
      queue.push(j);
    }
  }
  return null;
}
