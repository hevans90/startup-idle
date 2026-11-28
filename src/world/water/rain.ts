/**
 * RAIN INTO THE WATER, as runoff: what does not soak into the land runs downhill to where water stands, and is
 * poured there; in dry weather the same places give a little back to the air. A river rises in a storm and with
 * the thaw, and a lake falls in a dry summer — through the solver, as any water does.
 *
 * Not rain over every column: that is the whole map each frame, on the device too. Each tile drains downhill, by
 * the steepest way, to the first standing water it reaches (its SINK); a sink takes the rain of every tile that
 * drains to it, less what its cover soaks up. A tile that drains to a hollow with no water in it soaks it up there (the ground darkens
 * it). So the pouring is onto a few hundred tiles, every half second. @see world/weather runoffAt
 */
import { YEAR_SECONDS } from "../calendar";
import { inBounds, type Grid } from "../grid";
import { runoffAt, type Lying } from "../weather";
import { drainAt, pourAt, type WaterField } from "./field";
import { fluidIndexOf } from "./materials";
import { COVER } from "../vegetation/fields";

/**
 * The sinks: tile indices, how many tiles drain to each, and how much of their rain runs off — each tile counted
 * by what covers it (@see soakOf): a wood soaks it up, paving sheds it all.
 */
export type Catchment = { sink: Int32Array; area: Float32Array; runoff: Float32Array; n: number };

/** How much of the rain on a tile runs off, against open grass: by its cover and trees, or built over. */
export function soakOf(g: Grid, i: number): number {
  if (g.paved[i] || g.structureAt[i] >= 0) return 1.4;
  switch (g.veg.cover[i]) {
    case COVER.wood: return 1 - 0.18 * g.veg.density[i];
    case COVER.scrub: case COVER.meadow: case COVER.hedge: case COVER.row: return 0.7;
    case COVER.reeds: return 0.6;
    case COVER.field: return 0.9;
    case COVER.burnt: return 1.25;
    default: return 1;
  }
}

const STEPS: readonly (readonly [number, number])[] = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];

/**
 * WHERE EACH TILE'S RAIN GOES: downhill by the steepest way — a diagonal counted its length — to the first tile
 * with water standing on it (`wet`); none, if it comes to a hollow or the edge first.
 */
export function catchment(g: Grid, wet: (i: number) => boolean): Catchment {
  const W = g.w, H = g.h, N = W * H;
  /** Where each tile's rain ends: a sink's index, −1 none, −2 not yet known. */
  const to = new Int32Array(N).fill(-2);
  const down = (i: number): number => {
    const x = i % W, y = (i / W) | 0, h = g.height[i];
    let best = -1, drop = 0;
    for (const [dx, dy] of STEPS) {
      if (!inBounds(g, x + dx, y + dy)) continue;
      const j = (y + dy) * W + x + dx, d = (h - g.height[j]) / (dx && dy ? Math.SQRT2 : 1);
      if (d > drop) { drop = d; best = j; }
    }
    return best;
  };
  const path: number[] = [];
  for (let i = 0; i < N; i++) {
    if (to[i] !== -2) continue;
    let j = i;
    path.length = 0;
    // Walk down till a wet tile, a hollow, or a tile already known.
    while (to[j] === -2 && !wet(j)) { path.push(j); to[j] = -3; const k = down(j); if (k < 0) { j = -1; break; } j = k; }
    const end = j < 0 ? -1 : wet(j) ? j : to[j] === -3 ? -1 : to[j];
    if (j >= 0 && wet(j)) to[j] = j;
    for (const p of path) to[p] = end;
  }
  const area = new Map<number, number>(), off = new Map<number, number>();
  for (let i = 0; i < N; i++) if (to[i] >= 0) { area.set(to[i], (area.get(to[i]) ?? 0) + 1); off.set(to[i], (off.get(to[i]) ?? 0) + soakOf(g, i)); }
  const out: Catchment = { sink: new Int32Array(area.size), area: new Float32Array(area.size), runoff: new Float32Array(area.size), n: area.size };
  let k = 0;
  for (const [s, a] of area) { out.sink[k] = s; out.area[k] = a; out.runoff[k] = off.get(s)!; k++; }
  return out;
}

/** The most a sink is given or loses, half steps a second: a sink of a whole map's land is not a fountain. */
const MOST = 1.5;

/**
 * POUR THE RUNOFF of `seconds` of play at `t` (years) into the sinks, and take what the air takes: the rain on a
 * sink's land over its one tile. Returns the net poured, half steps over tiles, for a readout.
 */
export function stepRain(g: Grid, field: WaterField, c: Catchment, t: number, seconds: number, lying?: Lying): number {
  if (seconds <= 0 || !c.n) return 0;
  const r = runoffAt(t, lying), off = r.off / YEAR_SECONDS, up = r.up / YEAR_SECONDS;
  if (!off && !up) return 0;
  const water = fluidIndexOf("water");
  let sum = 0;
  for (let k = 0; k < c.n; k++) {
    const i = c.sink[k], x = i % g.w, y = (i / g.w) | 0;
    // (What runs off its land in, by what covers it; what the air takes, over all of it as before.)
    const rate = Math.max(-MOST, Math.min(MOST, c.runoff[k] * off - c.area[k] * up)), d = rate * seconds;
    if (d > 0) pourAt(field, x, y, d, water, g);
    else drainAt(field, x, y, -d);
    sum += d;
  }
  return sum;
}
