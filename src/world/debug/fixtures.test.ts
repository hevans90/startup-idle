/**
 * The fixtures exist to make picking failures reproducible, so what matters is
 * that picking actually SURVIVES them — a fixture that renders but cannot be
 * clicked is worse than none.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import { createGrid, setPaved, surfaceSampler } from "../grid";
import { DIR, isPaved, maskAt, orthOf } from "../roads/mask";
import { buildRoadTable, roadSpriteFor } from "../roads/table";
import { componentCount, createNetwork, netIdAt } from "../roads/network";
import { HEIGHT_UNIT, HH, HW, RAMP, cellToWorld, faceCoords, pickCell, rampDir, rampRise, surfaceHeight } from "../iso";
import {
  FIXTURE_IDS, OCCLUDER_GAP, OCCLUDER_HEIGHT, applyFixture, buildOccluder, buildRampFan,
  buildZiggurat, type FixtureId,
} from "./fixtures";
import {
  createWaterField, depthAt, runSources, stepWater, totalVolume, waterInPipes, wetTiles,
} from "../water/field";
import { PIPE_D, pipeLevelAt, runPipes } from "../water/pipes";

/** The presets that come with their own water. */
const WATER_FIXTURES: FixtureId[] = ["river", "cascade", "lake", "islands", "pipes", "plunge"];

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

  // Every water fixture, a minute of water each, on a 48x48 map: this one is
  // simply a lot of simulation and it runs past the default five seconds. The
  // budget is per FIXTURE rather than a flat number, so adding one to the list
  // does not silently spend the next one's time — which is what happened when
  // `plunge` was added and a twenty second bound that had been comfortable for
  // five became a failure that only showed up in a full run.
  test("and each of them is running a minute later", () => {
    for (const id of WATER_FIXTURES) {
      const { field } = live(id, 60);
      expect(wetTiles(field)).toBeGreaterThan(100);
    }
  }, WATER_FIXTURES.length * 8000);

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

describe("the pipes fixture", () => {
  /**
   * The fixture exists to be WATCHED, and what it is worth is that the four
   * things a pipe does happen in order and inside a minute. So this runs it
   * and checks the order — which is also the only end-to-end test there is of
   * the whole chain, from a tap on a map through a network to a drop in the
   * air and back again.
   */
  const world64 = () => {
    const g = createGrid(64, 64);
    applyFixture(g, "pipes", 1);
    const field = createWaterField(g);
    const mid = Math.round(g.h / 2);
    const len = Math.min(20, Math.round(g.w * 0.35));
    const drop = 4 + len;
    const run = (seconds: number) => {
      for (let n = 0; n < Math.round(seconds * 60); n++) {
        runSources(field, g, 1 / 60);
        runPipes(field, g, 1 / 60);
        stepWater(field, 1 / 60);
      }
    };
    return {
      g, field, run, mid, drop,
      spout: () => pipeLevelAt(g, field, drop - 1, mid),
      branch: () => pipeLevelAt(g, field, Math.round((7 + drop) / 2), mid - 2),
      pocket: () => depthAt(field, drop + 1, mid),
    };
  };

  test("fills, drips, pressurises, floods and then backs up — in that order", () => {
    const w = world64();
    const invert = 14;                             // the foot of the channel

    // 1. It FILLS. Nothing is in it when the map loads, because a pipe makes
    //    no water; what goes in comes from the channel it is lying in.
    expect(waterInPipes(w.field)).toBe(0);
    w.run(10);
    expect(waterInPipes(w.field)).toBeGreaterThan(10);

    // 2. It DRIPS, and the capped branch has nowhere to go so it PRESSURISES:
    //    a dead end fills to its crown and then stands above it, which is a
    //    head and not a volume.
    expect(w.field.columns.drips.live).toBeGreaterThan(0);
    expect(w.branch()).toBeGreaterThan(invert + PIPE_D);

    // 3. The pocket below FILLS, from the drops and the channel together.
    w.run(20);
    expect(w.pocket()).toBeGreaterThan(5);

    // 4. And once it is over the spout, the spout DROWNS: it stops dripping,
    //    and the level inside the pipe comes up to the level outside it,
    //    because through a drowned hole the two are one body of water.
    w.run(40);
    expect(w.pocket()).toBeGreaterThan(PIPE_D);
    expect(w.spout()).toBeGreaterThan(invert + PIPE_D);
    // The pocket's floor is the map's, at nought, so its depth IS its surface
    // — and the level inside the pipe has come up to meet it.
    expect(w.spout()).toBeCloseTo(w.pocket(), 0);
    expect(w.field.columns.drips.live).toBe(0);
  }, 20000);

  test("and it makes no water of its own — only what its tap puts in", () => {
    // The pipes themselves are not a source, and the check is arithmetic: one
    // tile of spring at `SPRING` a second over its sixteen columns, times
    // three taps, and nothing else anywhere.
    const w = world64();
    const taps = [...w.g.source].filter((r) => r > 0).length;
    w.run(20);
    expect(totalVolume(w.field)).toBeCloseTo(taps * 8 * 16 * 20, 0);
  }, 20000);
});

describe("the culvert fixture", () => {
  /**
   * Two pockets in solid rock, and a pipe under the rock between them.
   *
   * The one thing a surface pipe could never do, set up so that there is no
   * other explanation available: the right-hand pocket has no tap, and the
   * rock between the two is taller than either pocket can ever fill, so over
   * the ground they are separate worlds and the terrain solver is right about
   * that. Anything that arrives on the right came through the pipe.
   */
  const world = () => {
    const g = createGrid(64, 64);
    applyFixture(g, "culvert", 1);
    const field = createWaterField(g);
    const mid = Math.round(g.h / 2), half = Math.round(g.w / 2);
    const pool = (x0: number, x1: number) => {
      let sum = 0;
      for (let y = mid - 3; y <= mid + 3; y++) for (let x = x0; x <= x1; x++) sum += depthAt(field, x, y);
      return sum;
    };
    return {
      g, field, mid, half,
      run: (seconds: number) => {
        for (let n = 0; n < Math.round(seconds * 60); n++) {
          runSources(field, g, 1 / 60);
          runPipes(field, g, 1 / 60);
          stepWater(field, 1 / 60);
        }
      },
      left: () => pool(half - 11, half - 4),
      right: () => pool(half + 4, half + 7),
    };
  };

  test("the run is buried, and the rock it is under is unbroken", () => {
    const w = world();
    const under = w.g.height[w.mid * w.g.w + w.half];
    expect(w.g.pipeZ[w.mid * w.g.w + w.half]).toBe(0);
    expect(under).toBeGreaterThan(20);            // and the pipe is beneath it
    // No gap anywhere in the ridge: every cell of it is high, on every row, so
    // there is no surface route between the two at any depth of water.
    for (let y = 0; y < w.g.h; y++) {
      for (let x = w.half - 2; x <= w.half + 2; x++) {
        expect(w.g.height[y * w.g.w + x]).toBe(under);
      }
    }
  });

  test("and water crosses it, which over the ground is impossible", () => {
    const w = world();
    expect(w.right()).toBe(0);
    w.run(70);
    expect(w.left()).toBeGreaterThan(0);          // the tap has filled its own
    expect(w.right()).toBeGreaterThan(0.5);       // and this can only be the pipe
  }, 30000);

  test("and nothing is made on the way — only what the tap put in", () => {
    const w = world();
    const taps = [...w.g.source].filter((r) => r > 0).length;
    w.run(20);
    expect(totalVolume(w.field)).toBeCloseTo(taps * 8 * 16 * 20, 0);
  }, 30000);
});

describe("a fixture can start with water in it", () => {
  test("the lake is a lake on the first frame, not a hole that becomes one", () => {
    // Every fixture with water in it used to be a SPRING, because the grid
    // could say a lake had been poured and never how deep. So the water ran in
    // from somewhere and the map had to be watched while it filled — half a
    // minute of a dry basin before there was anything to look at.
    const g = world();
    applyFixture(g, "lake", 1);
    const f = createWaterField(g);
    expect(totalVolume(f)).toBeGreaterThan(0);
    expect(wetTiles(f)).toBeGreaterThan(100);
    // And it is the basin that is wet, not the rim round it.
    expect(wetTiles(f)).toBeLessThan(g.w * g.h);
  });

  test("and the plunge fixture lands a fall in water that is already there", () => {
    // The one that could not be set up at all before: the pool had to fill
    // itself from the fall, so for the first half minute the fall was landing
    // on rock and by the time there was a pool the interesting part was over.
    const g = world();
    applyFixture(g, "plunge", 1);
    const f = createWaterField(g);
    expect(totalVolume(f)).toBeGreaterThan(0);
    // A pool on the low ground, a dry shelf above it, and a spring to feed it.
    expect(depthAt(f, g.w - 6, g.h / 2)).toBeGreaterThan(1);
    expect(depthAt(f, 6, g.h / 2)).toBe(0);
    expect([...g.source].some((v) => v > 0)).toBe(true);
  });

  test("a fixture with no pool in it has none", () => {
    const g = world();
    applyFixture(g, "ziggurat", 1);
    expect([...g.pool].every((v) => v === 0)).toBe(true);
    expect(totalVolume(createWaterField(g))).toBe(0);
  });
});

describe("fixtures can be asked for by name in the URL", () => {
  test("every id in the list builds something", () => {
    // `FixtureId` is a type and types are gone by the time a query string
    // turns up, so the list has to be written out — and a written-out list is
    // one that goes stale. This is what holds the two together.
    for (const id of FIXTURE_IDS) {
      const g = createGrid(16, 16);
      applyFixture(g, id, 1);
      expect(g.minHeight).toBeLessThanOrEqual(g.maxHeight);
    }
  });

  test("and the list covers every id the switch handles", () => {
    // The other direction: a fixture added to `applyFixture` and not to the
    // list is one you cannot reach from a URL, silently.
    const src = readFileSync(new URL("./fixtures.ts", import.meta.url), "utf8");
    const handled = [...src.matchAll(/case "(\w+)":/g)].map((m) => m[1]);
    expect(handled.length).toBeGreaterThan(0);
    for (const id of handled) expect(FIXTURE_IDS).toContain(id as FixtureId);
    expect(new Set(FIXTURE_IDS).size).toBe(FIXTURE_IDS.length);
  });
});
