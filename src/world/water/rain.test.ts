import { describe, expect, test } from "bun:test";

import { createGrid, fillTerrain, idx } from "../grid";
import { YEAR_SECONDS } from "../calendar";
import { runoffAt, weatherAt } from "../weather";
import { createWaterField, totalVolume } from "./field";
import { catchment, soakOf, stepRain } from "./rain";
import { COVER } from "../vegetation/fields";

/** RAIN INTO THE WATER: the land drains downhill to standing water, and what runs off it is poured there. @see rain */
/** A 16² slope falling east to a pond in the last two columns, with a hollow on it. */
function slope() {
  const g = createGrid(16, 16); fillTerrain(g, 1);
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) g.height[idx(g, x, y)] = 30 - x * 2;
  g.height[idx(g, 5, 5)] = 15;
  return g;
}
const pond = (i: number, w = 16) => i % w >= 14;

describe("runoff", () => {
  test("every tile drains to the pond but the hollow and what drains into it", () => {
    const g = slope(), c = catchment(g, pond);
    let area = 0;
    for (let k = 0; k < c.n; k++) { expect(pond(c.sink[k])).toBe(true); area += c.area[k]; }
    // (The pond's own tiles are their own sinks; the hollow keeps its rain and its uphill neighbours'.)
    expect(area).toBeLessThan(256);
    expect(area).toBeGreaterThan(220);
  });

  test("in rain, the runoff is poured into the pond; in a dry spell some is taken up", () => {
    const g = slope(), c = catchment(g, pond);
    let wet = 0, dry = 0;
    for (let t = 2; t < 3 && (!wet || !dry); t += 1 / 720) {
      const w = weatherAt(t), r = runoffAt(t);
      if (!wet && w.rain > 0.6 && r.off > r.up) wet = t;
      if (!dry && w.fall === 0 && r.up > 0 && w.temp > 10) dry = t;
    }
    const field = createWaterField(g);
    const before = totalVolume(field, g);
    const poured = stepRain(g, field, c, wet, 10);
    expect(poured).toBeGreaterThan(0);
    expect(totalVolume(field, g) - before).toBeGreaterThan(0);
    expect(stepRain(g, field, c, dry, 10)).toBeLessThan(0);
    // A sink is never a fountain, however much drains to it.
    expect(poured / c.n / 10).toBeLessThanOrEqual(1.5);
    expect(YEAR_SECONDS).toBe(3600);
  });

  test("a wood soaks rain up, paving sheds it all", () => {
    const g = slope(), bare = catchment(g, pond);
    for (let i = 0; i < 256; i++) if (i % 16 < 8) { g.veg.cover[i] = COVER.wood; g.veg.density[i] = 3; }
    for (let y = 0; y < 16; y++) g.paved[idx(g, 10, y)] = 1;
    const sum = (c: typeof bare) => c.runoff.reduce((a, b) => a + b, 0);
    const wooded = catchment(g, pond);
    expect(sum(wooded)).toBeLessThan(sum(bare) * 0.8);
    expect(soakOf(g, idx(g, 10, 3))).toBeGreaterThan(1);
    expect(soakOf(g, idx(g, 2, 3))).toBeLessThan(0.5);
  });
});
