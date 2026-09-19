/**
 * The valley, which is the thing that makes a river run.
 *
 * These are about the PLAN and the ground it implies, not about a finished
 * map — deliberately, because the fault this module exists to fix was
 * invisible in a finished map until you ran the water. A bed that climbs
 * looks like a river right up until nothing flows down it.
 */
import { describe, expect, test } from "bun:test";

import { createGrid } from "../grid";
import { layRoad } from "./road";
import { DEFAULT_GEN, withDefaults } from "./params";
import { mulberry32 } from "../../utils/rng";
import { planRivers, rimOf, valleyGround } from "./valley";

const plan = (seed: number, params = {}) => {
  const p = withDefaults(params);
  const g = createGrid(64, 64);
  const rng = mulberry32(seed);
  const road = layRoad(g, p, rng, 1);
  const out = planRivers(g, p, rng, road.distance);
  return { g, p, road, plan: out, ground: valleyGround(g, p, out) };
};

describe("a planned river", () => {
  test("starts on the edge of the map and ends on it", () => {
    // BOTH ENDS, which is what makes the map a reach of something larger:
    // the water arrives over one boundary and leaves over the other. A course
    // that stopped inland would be fed with nowhere to put what it was given.
    for (let seed = 0; seed < 12; seed++) {
      const { g, plan: r } = plan(seed);
      expect(r.paths.length).toBeGreaterThan(0);
      for (const path of r.paths) {
        expect(rimOf(g, path[0])).toBe(0);
        expect(rimOf(g, path[path.length - 1])).toBe(0);
      }
    }
  });

  test("and crosses the map rather than running round the outside of it", () => {
    // Two edge cells can be a long way apart and still both be near one
    // corner — (1,63) and (0,0) are sixty-four apart on a 64² map and the
    // line between them IS the left-hand edge. A course laid there leaks off
    // the boundary down its whole length: measured, that seed's river held
    // 19% of its channel where one crossing the middle held all of it.
    for (let seed = 0; seed < 12; seed++) {
      const { g, plan: r } = plan(seed);
      for (const path of r.paths) {
        const middle = path[path.length >> 1];
        expect(rimOf(g, middle)).toBeGreaterThan(2);
      }
    }
  });

  test("and the floor it is given never once climbs on its way down", () => {
    // THE WHOLE POINT OF PLANNING FIRST. Shaped out of noise and cut
    // afterwards, the bed took whatever fall the land happened to leave
    // between its two ends — over eight seeds, 38 half steps of CLIMB against
    // 15 of net descent, because `relief` is larger than a river's entire
    // fall. Planned first, the floor is a function of how far along the
    // course you are and cannot do anything but descend.
    for (let seed = 0; seed < 12; seed++) {
      const { plan: r, ground } = plan(seed);
      for (const path of r.paths) {
        for (let k = 1; k < path.length; k++) {
          expect(ground.base[path[k]]).toBeLessThanOrEqual(ground.base[path[k - 1]]);
        }
        // AND IT ACTUALLY FALLS, which "never climbs" does not say: a level
        // floor never climbs either, and a level floor is a canal.
        const drop = ground.base[path[0]] - ground.base[path[path.length - 1]];
        expect(drop).toBeGreaterThan(DEFAULT_GEN.riverFall * 0.9);
      }
    }
  });

  test("and the land climbs away from it, which is what makes it a valley", () => {
    // Measured on the finished maps: the ground a tile from the water sits 24
    // half steps below the plain ten tiles out. Here it is asked of the model
    // rather than of a seed, so it is a rule and not an observation.
    for (let seed = 0; seed < 8; seed++) {
      const { g, plan: r, ground } = plan(seed);
      const spine = r.paths[0];
      if (!spine) continue;
      const at = (d: number) => {
        let sum = 0, n = 0;
        for (let i = 0; i < g.w * g.h; i++) {
          if (Math.abs(r.near[i] - d) > 0.5) continue;
          sum += ground.base[i];
          n++;
        }
        return n ? sum / n : 0;
      };
      expect(at(1)).toBeLessThan(at(4));
      expect(at(4)).toBeLessThan(at(9));
    }
  });

  test("and it may cross the street, which it could never do before", () => {
    // THE RULE THAT IS GONE. A channel used to keep two tiles clear of any
    // paving, and that one condition shaped every map: the road spans the
    // map, so the cells a river could use fell into two regions with no way
    // between them, and every course had to begin and end on ONE side of the
    // street. River and road ran roughly parallel on every seed because it
    // was the only shape left. A deck is the third answer — where a course
    // meets the road, the road goes over it. @see Grid.deck, carveChannel
    let crossed = 0;
    for (let seed = 0; seed < 12; seed++) {
      const { road, plan: r } = plan(seed);
      for (const path of r.paths) {
        if (path.some((i) => road.distance[i] === 0)) { crossed++; break; }
      }
    }
    expect(crossed).toBeGreaterThan(6);
  });
});
