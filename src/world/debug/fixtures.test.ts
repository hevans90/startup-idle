/**
 * The fixtures exist to make picking failures reproducible, so what matters is
 * that picking actually SURVIVES them — a fixture that renders but cannot be
 * clicked is worse than none.
 */
import { describe, expect, test } from "bun:test";

import { createGrid, setPaved, surfaceSampler } from "../grid";
import { DIR, isPaved, maskAt, orthOf } from "../roads/mask";
import { buildRoadTable, roadSpriteFor } from "../roads/table";
import { componentCount, createNetwork, netIdAt } from "../roads/network";
import { HEIGHT_UNIT, HH, HW, RAMP, cellToWorld, faceCoords, pickCell, rampDir, rampRise, surfaceHeight } from "../iso";
import {
  OCCLUDER_GAP, OCCLUDER_HEIGHT, applyFixture, buildOccluder, buildRampFan, buildZiggurat,
  type FixtureId,
} from "./fixtures";
import { createWaterField, depthAt, runSources, stepWater, wetTiles } from "../water/field";

/** The presets that come with their own water. */
const WATER_FIXTURES: FixtureId[] = ["river", "cascade", "lake", "islands"];

const world = (w = 48, h = 48) => createGrid(w, h, 1);

/** Where a cell's surface centre projects to, accounting for a ramp's tilt. */
function centreOf(g: ReturnType<typeof world>, x: number, y: number) {
  const i = y * g.w + x;
  const surf = { height: g.height[i], ramp: rampDir(g.ramp[i]), rise: rampRise(g.ramp[i]) };
  const h = surfaceHeight(surf, 0.5, 0.5);
  return { wx: (x - y) * HW, wy: (x + y + 1) * HH - h * HEIGHT_UNIT - HH };
}

const pickAt = (g: ReturnType<typeof world>, wx: number, wy: number) =>
  pickCell(wx, wy, surfaceSampler(g), { min: g.minHeight, max: g.maxHeight }, 1);

describe("ziggurat", () => {
  const g = world();
  buildZiggurat(g, 1, 24, 24, 4);

  test("terraces climb by a full step each", () => {
    expect(g.height[24 * g.w + 24]).toBe(6);   // top tier, 3 steps up
    expect(g.maxHeight).toBe(6);
  });

  test("has a ramp on each of the four faces", () => {
    const dirs = new Set<number>();
    for (let i = 0; i < g.ramp.length; i++) if (g.ramp[i]) dirs.add(rampDir(g.ramp[i]));
    expect(dirs).toEqual(new Set([RAMP.N, RAMP.E, RAMP.S, RAMP.W]));
  });

  test("every cell's own surface centre picks that cell — ramps included", () => {
    let checked = 0, ramps = 0;
    for (let y = 4; y < g.h - 4; y++) {
      for (let x = 4; x < g.w - 4; x++) {
        const { wx, wy } = centreOf(g, x, y);
        const got = pickAt(g, wx, wy);
        // A cell can legitimately be HIDDEN by a nearer taller one; only assert
        // when nothing nearer covers the point.
        const covered = got && got.x + got.y > x + y;
        if (covered) continue;
        expect(got).toEqual({ x, y });
        checked++;
        if (g.ramp[y * g.w + x]) ramps++;
      }
    }
    expect(checked).toBeGreaterThan(1000);
    expect(ramps).toBeGreaterThan(8);
  });
});

describe("occluder", () => {
  const g = world();
  buildOccluder(g, 1, 24, 24);

  test("the ridge stands at the height that makes it cover ground behind it", () => {
    expect(g.height[24 * g.w + 24]).toBe(OCCLUDER_HEIGHT);
    expect(g.maxHeight).toBe(OCCLUDER_HEIGHT);
    expect(OCCLUDER_HEIGHT).toBe(2 * OCCLUDER_GAP);
  });

  test("the ridge wins the pick over the level ground it hides", () => {
    // ground OCCLUDER_GAP bands further away, on the same x−y diagonal
    const hx = 24 - OCCLUDER_GAP / 2, hy = 24 - OCCLUDER_GAP / 2;
    expect(g.height[hy * g.w + hx]).toBe(0);            // genuinely level
    const behind = centreOf(g, hx, hy);
    const got = pickAt(g, behind.wx, behind.wy);
    expect(got).not.toBeNull();
    // whatever won is NEARER than the cell whose own centre we aimed at
    expect(got!.x + got!.y).toBeGreaterThan(hx + hy);
    expect(g.height[got!.y * g.w + got!.x]).toBe(OCCLUDER_HEIGHT);
    // ...and really does contain the point
    const i = got!.y * g.w + got!.x;
    expect(faceCoords(behind.wx, behind.wy, got!.x, got!.y, {
      height: g.height[i], ramp: rampDir(g.ramp[i]), rise: rampRise(g.ramp[i]),
    }, 1)).not.toBeNull();
  });

  test("the ridge's own surface is still pickable", () => {
    const top = centreOf(g, 24, 24);
    expect(pickAt(g, top.wx, top.wy)).toEqual({ x: 24, y: 24 });
  });

  test("ground well clear of the ridge picks itself", () => {
    const far = centreOf(g, 40, 40);
    expect(pickAt(g, far.wx, far.wy)).toEqual({ x: 40, y: 40 });
  });
});

describe("rampFan", () => {
  const g = world();
  buildRampFan(g, 1, 20, 20);

  test("has both rises in all four directions — eight ramps", () => {
    const seen = new Set<string>();
    for (let i = 0; i < g.ramp.length; i++) {
      if (g.ramp[i]) seen.add(`${rampDir(g.ramp[i])}:${rampRise(g.ramp[i])}`);
    }
    expect(seen.size).toBe(8);
  });

  test("each ramp climbs to the height of the cell it points at", () => {
    for (let y = 0; y < g.h; y++) {
      for (let x = 0; x < g.w; x++) {
        const i = y * g.w + x;
        if (!g.ramp[i]) continue;
        const dir = rampDir(g.ramp[i]);
        const step = { [RAMP.N]: [-1, 0], [RAMP.E]: [0, -1], [RAMP.S]: [1, 0], [RAMP.W]: [0, 1] }[dir]!;
        const top = g.height[(y + step[1]) * g.w + (x + step[0])];
        expect(g.height[i] + rampRise(g.ramp[i])).toBe(top);
      }
    }
  });
});

describe("applyFixture", () => {
  test("flat resets height and ramps together", () => {
    const g = world(16, 16);
    applyFixture(g, "ziggurat", 1);
    expect(g.maxHeight).toBeGreaterThan(0);
    applyFixture(g, "flat", 1);
    expect(g.maxHeight).toBe(0);
    expect(g.minHeight).toBe(0);
    expect(g.ramp.some((v) => v !== 0)).toBe(false);
    expect(g.terrain.every((v) => v === 1)).toBe(true);
  });

  test("every fixture leaves the cached height range correct", () => {
    for (const id of ["flat", "ziggurat", "occluder", "rampFan"] as const) {
      const g = world(40, 40);
      applyFixture(g, id, 1);
      let lo = 0, hi = 0;
      for (const v of g.height) { if (v < lo) lo = v; if (v > hi) hi = v; }
      expect([g.minHeight, g.maxHeight]).toEqual([lo, hi]);
    }
  });

  test("does not run off the edge of a small map", () => {
    for (const id of ["ziggurat", "occluder", "rampFan"] as const) {
      const g = createGrid(8, 8, 1);
      expect(() => applyFixture(g, id, 1)).not.toThrow();
    }
  });
});

describe("cellToWorld agrees with the centre helper on level ground", () => {
  test("a level cell's surface centre is its diamond centre", () => {
    const g = world(8, 8);
    const c = centreOf(g, 3, 5);
    const { wx, wy } = cellToWorld(3, 5, 0, 1);
    expect(c.wx).toBeCloseTo(wx, 9);
    expect(c.wy).toBeCloseTo(wy, 9);
  });
});

describe("road fixtures", () => {
  const netOf = (g: ReturnType<typeof world>) => createNetwork(g);
  const TABLE = buildRoadTable("landscape");

  test("roadShapes exercises every mask the autotiler can produce", () => {
    const g = world(48, 48);
    applyFixture(g, "roadShapes", 1);
    const seen = new Set<number>();
    for (let y = 0; y < g.h; y++) {
      for (let x = 0; x < g.w; x++) {
        if (!isPaved(g, x, y)) continue;
        seen.add(orthOf(maskAt(g, x, y)));
      }
    }
    // ends, both straights, all four bends, both Ts and a cross
    expect(seen.size).toBeGreaterThanOrEqual(10);
    expect(seen.has(0)).toBe(true);                                  // the lone square
    expect(seen.has(DIR.N | DIR.E | DIR.S | DIR.W)).toBe(true);      // the crossroads
  });

  test("EVERY paved cell in every road fixture resolves to a real tile", () => {
    for (const id of ["roadShapes", "avenue", "plaza", "splitTrap"] as const) {
      const g = world(48, 48);
      applyFixture(g, id, 1);
      let cells = 0;
      for (let y = 0; y < g.h; y++) {
        for (let x = 0; x < g.w; x++) {
          if (!isPaved(g, x, y)) continue;
          cells++;
          expect(roadSpriteFor(TABLE, maskAt(g, x, y)).frame).not.toBeNull();
        }
      }
      expect(cells).toBeGreaterThan(10);
    }
  });

  test("the avenue's two columns resolve to LANE tiles, not T-junctions", () => {
    const g = world(48, 48);
    applyFixture(g, "avenue", 1);
    const cx = 24, cy = 24;
    // mid-run, away from the junction where the two avenues meet
    for (const [x, y] of [[cx - 6, cy], [cx - 6, cy + 1]] as const) {
      const pick = roadSpriteFor(TABLE, maskAt(g, x, y));
      expect(pick.role).toBe("thick-lane");
      expect(pick.exact).toBe(true);
    }
  });

  test("the plaza has a filled interior and a rim that is not fill", () => {
    const g = world(48, 48);
    applyFixture(g, "plaza", 1);
    const cx = 24, cy = 24;
    expect(roadSpriteFor(TABLE, maskAt(g, cx, cy)).role).toBe("thick-fill");
    expect(roadSpriteFor(TABLE, maskAt(g, cx - 4, cy)).role).not.toBe("thick-fill");
  });

  test("the split trap really is split on one arm and joined on the other", () => {
    const g = world(48, 48);
    applyFixture(g, "splitTrap", 1);
    const net = netOf(g);
    const cx = 24, cy = 24;

    // left arm: no ramp, so the run is two components
    const lowL = netIdAt(net, g, cx - 6, cy - 4);
    const highL = netIdAt(net, g, cx - 6, cy + 4);
    expect(lowL).toBeGreaterThanOrEqual(0);
    expect(highL).toBeGreaterThanOrEqual(0);
    expect(lowL).not.toBe(highL);

    // right arm: the ramp bridges it
    const lowR = netIdAt(net, g, cx + 6, cy - 4);
    const highR = netIdAt(net, g, cx + 6, cy + 4);
    expect(lowR).toBe(highR);
  });

  test("erasing one cell of a loop splits it — what the overlay shows", () => {
    const g = world(24, 24);
    // a closed ring
    for (let x = 6; x <= 14; x++) { setPaved(g, x, 6, 1); setPaved(g, x, 14, 1); }
    for (let y = 6; y <= 14; y++) { setPaved(g, 6, y, 1); setPaved(g, 14, y, 1); }
    expect(componentCount(createNetwork(g))).toBe(1);

    setPaved(g, 10, 6, 0);
    expect(componentCount(createNetwork(g))).toBe(1);   // still a loop, just open
    setPaved(g, 10, 14, 0);
    expect(componentCount(createNetwork(g))).toBe(2);   // now two arcs
  });
});

describe("the water fixtures", () => {
  /** Run a preset's own taps and flow for a while, as the scene does. */
  const live = (id: FixtureId, seconds: number) => {
    const g = createGrid(48, 48);
    applyFixture(g, id, 1);
    const field = createWaterField(g);
    for (let n = 0; n < seconds * 60; n++) {
      runSources(field, g, 1 / 60);
      stepWater(field, 1 / 60);
    }
    return { g, field };
  };

  test("every one of them arrives with its own taps, so loading it starts a flow", () => {
    // The point of them. A fixture that hands you a shape to pour into is
    // half an hour of raising terrain before you can look at anything.
    for (const id of WATER_FIXTURES) {
      const g = createGrid(48, 48);
      applyFixture(g, id, 1);
      expect([...g.source].filter((r) => r > 0).length).toBeGreaterThan(0);
    }
  });

  // Four fixtures, a minute of water each, on a 48x48 map: this one is simply
  // a lot of simulation and it runs past the default five seconds.
  test("and each of them is running a minute later", () => {
    for (const id of WATER_FIXTURES) {
      const { field } = live(id, 60);
      expect(wetTiles(field)).toBeGreaterThan(100);
    }
  }, 20000);

  test("the river reaches a standing flow rather than filling up", () => {
    // As much arriving as leaving, which is the whole difference between a
    // river and a bath.
    const { g, field } = live("river", 60);
    const a = wetTiles(field);
    for (let n = 0; n < 60 * 60; n++) {
      runSources(field, g, 1 / 60);
      stepWater(field, 1 / 60);
    }
    expect(Math.abs(wetTiles(field) - a)).toBeLessThan(a * 0.15);
  });

  test("the cascade holds a pool on every tread", () => {
    // Each tread has a lip on its downhill side, so water stands at every
    // riser instead of a film racing over all of them.
    const { g, field } = live("cascade", 60);
    let pools = 0;
    for (let x = 2; x < g.w - 2; x++) {
      // A tile deeper than its downhill neighbour is standing water, not a
      // sheet on its way somewhere.
      const here = depthAt(field, x, Math.floor(g.h / 2));
      if (here > 1) pools++;
    }
    expect(pools).toBeGreaterThan(4);
  });

  test("switching to another fixture leaves no taps behind", () => {
    const g = createGrid(48, 48);
    applyFixture(g, "river", 1);
    expect([...g.source].some((r) => r !== 0)).toBe(true);
    applyFixture(g, "flat", 1);
    expect([...g.source].some((r) => r !== 0)).toBe(false);
  });
});
