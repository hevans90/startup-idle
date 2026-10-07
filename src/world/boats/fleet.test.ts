import { describe, expect, test } from "bun:test";

import { FLOW_DEFAULTS, createColumnField, type ColumnField } from "../../fluid/columns";
import {
  DRAFT, addBoat, createFleet, removeBoatNear, sampleWater, stepFleet,
} from "./fleet";

/** A field `tiles` across, four columns a tile, ground at `ground`, water `depth` deep. */
const lake = (tiles: number, depth: number, ground = (_cx: number, _cy: number) => 0) => {
  const n = tiles * 4;
  const c = createColumnField(n, n, { ...FLOW_DEFAULTS, wind: 0 }, 0.25);
  for (let cy = 0; cy < n; cy++) {
    for (let cx = 0; cx < n; cx++) {
      const i = cy * n + cx;
      c.ground[i] = ground(cx, cy);
      c.depth[i] = depth;
    }
  }
  return c;
};

const run = (c: ColumnField, f: ReturnType<typeof createFleet>, seconds: number) => {
  for (let k = 0; k < Math.round(seconds * 60); k++) stepFleet(f, c, 1 / 60);
};

describe("a boat on the water", () => {
  test("floats at the surface the mesh draws, and settles there", () => {
    const c = lake(8, 3, () => 2);
    const f = createFleet();
    const b = addBoat(f, c, 4, 4)!;
    expect(b).not.toBeNull();
    expect(sampleWater(c, 4, 4).surface).toBeCloseTo(5, 6);
    b.z = 9;                                         // dropped in from above
    run(c, f, 4);
    expect(Math.abs(b.z - 5)).toBeLessThan(0.1);      // back on the water, give or take its bob
  });

  test("bobs with the sheet: a wave under it lifts it, a moment late", () => {
    const c = lake(8, 3);
    const f = createFleet();
    const b = addBoat(f, c, 4, 4)!;
    run(c, f, 2);
    const rest = b.z;
    for (let i = 0; i < c.depth.length; i++) c.depth[i] = 5;     // the sheet rises by two
    stepFleet(f, c, 1 / 60);
    expect(b.z - rest).toBeLessThan(1);               // not glued to it
    run(c, f, 2);
    expect(b.z - rest).toBeGreaterThan(1.8);          // but carried up with it
  });

  test("drifts down a sloped surface, as a river carries it", () => {
    // The surface falls toward +x: ground and water both step down.
    const c = lake(16, 3, (cx) => -cx * 0.1);
    const f = createFleet();
    const b = addBoat(f, c, 6, 8)!;
    run(c, f, 2);
    expect(b.x).toBeGreaterThan(6.3);
    expect(Math.abs(b.y - 8)).toBeLessThan(0.05);
    // And turns its bow to the way it is going.
    expect(Math.abs(Math.cos(b.heading) - 1)).toBeLessThan(0.1);
  });

  test("does not sail onto dry ground", () => {
    // Water to x < 6 tiles; dry, raised ground beyond.
    const c = lake(16, 3, (cx) => (cx >= 24 ? 6 : -cx * 0.1));
    for (let cy = 0; cy < c.ny; cy++) for (let cx = 24; cx < c.nx; cx++) c.depth[cy * c.nx + cx] = 0;
    const f = createFleet();
    const b = addBoat(f, c, 4, 8)!;
    run(c, f, 10);
    expect(sampleWater(c, b.x, b.y).depth).toBeGreaterThan(DRAFT);
    expect(b.x).toBeLessThan(6);
  });

  test("is not put down where there is no water to float in", () => {
    const c = lake(8, 0.2);
    expect(addBoat(createFleet(), c, 4, 4)).toBeNull();
  });

  test("comes to rest on the ground when the water goes", () => {
    const c = lake(8, 3, () => 1);
    const f = createFleet();
    const b = addBoat(f, c, 4, 4)!;
    run(c, f, 1);
    c.depth.fill(0);
    run(c, f, 2);
    expect(b.afloat).toBe(false);
    expect(b.z).toBeCloseTo(1, 1);
  });

  test("two boats in one place push apart, and one can be taken off", () => {
    const c = lake(8, 3);
    const f = createFleet();
    addBoat(f, c, 4, 4);
    addBoat(f, c, 4.05, 4);
    run(c, f, 2);
    const [a, o] = f.boats;
    expect(Math.hypot(a.x - o.x, a.y - o.y)).toBeGreaterThan(0.4);
    expect(removeBoatNear(f, a.x, a.y)).toBe(true);
    expect(f.boats.length).toBe(1);
    expect(removeBoatNear(f, 0, 0)).toBe(false);
  });
});
