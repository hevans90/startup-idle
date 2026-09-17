/**
 * Water in the air.
 *
 * The solver moved water across an edge in one step, which over a lip is wrong
 * in a way you can see: the wave at the top stops, the wave at the bottom
 * starts, and nothing crosses the distance. These are about the distance.
 */
import { describe, expect, test } from "bun:test";

import {
  FLOW_DEFAULTS, addWater, at, createColumnField, stepFlow, totalWater,
} from "./columns";
import { FALL_GRAVITY, FALL_MIN, fallExtent, waterInAir } from "./falls";

const CALM = { ...FLOW_DEFAULTS, wind: 0 };

/** A shelf `high` half steps above a floor, with a slug of water at its lip. */
function cliff(high: number, amount = 12) {
  const f = createColumnField(20, 12, CALM, 0.5);
  for (let y = 0; y < 12; y++) {
    for (let x = 0; x < 20; x++) {
      // Walled all round, so a conservation check is about the air and not
      // about the edge of the world.
      f.ground[at(f, x, y)] = y < 2 || y > 9 || x > 17 ? high + 20 : x < 10 ? high : 0;
    }
  }
  for (let y = 4; y <= 7; y++) addWater(f, 9, y, amount, 1);
  return f;
}

const run = (f: ReturnType<typeof cliff>, seconds: number) => {
  for (let n = 0; n < Math.round(seconds * 60); n++) stepFlow(f, 1 / 60);
};

/** Everything standing on the floor below the shelf. */
function below(f: ReturnType<typeof cliff>) {
  let v = 0;
  for (let y = 0; y < 12; y++) for (let x = 10; x < 18; x++) v += f.depth[at(f, x, y)];
  return v;
}

describe("water takes time to come down", () => {
  test("nothing arrives below until it has fallen the distance", () => {
    // Twenty half steps at the fall gravity is two thirds of a second. The
    // pool at the bottom must not answer before then, and it used to answer in
    // the same frame the water left the lip.
    const high = 20;
    const fall = Math.sqrt((2 * high) / FALL_GRAVITY);
    expect(fall).toBeGreaterThan(0.5);

    const f = cliff(high);
    run(f, fall * 0.7);
    expect(below(f)).toBe(0);                   // still on its way down
    expect(waterInAir(f)).toBeGreaterThan(5);    // and somewhere while it is

    run(f, fall * 0.6);
    expect(below(f)).toBeGreaterThan(0);         // and then it lands
  });

  test("a taller cliff takes longer", () => {
    const arrives = (high: number) => {
      const f = cliff(high);
      for (let n = 0; n < 60 * 4; n++) {
        stepFlow(f, 1 / 60);
        if (below(f) > 0) return n / 60;
      }
      return Infinity;
    };
    const shallow = arrives(6), deep = arrives(24);
    expect(deep).toBeGreaterThan(shallow * 1.4);
    expect(deep).toBeLessThan(2);
  });

  test("not a drop is lost while it is in the air", () => {
    // A conservation check that counted only depths would call a waterfall a
    // leak, which is why `totalWater` counts what is falling.
    const f = cliff(20);
    const held = totalWater(f);
    for (const t of [0.1, 0.3, 0.7, 1.5, 5]) {
      run(f, t);
      expect(totalWater(f)).toBeCloseTo(held, 3);
    }
    // And it gets down, bar the tail of an exponential.
    expect(waterInAir(f)).toBeLessThan(held * 0.02);
  });

  test("a LEDGE is not a fall — water goes straight over", () => {
    // One terrain step is a lip water tumbles over and keeps flowing. At a
    // tenth of the threshold a steady hillside became a staircase of little
    // cliffs and the water spent its whole journey in the air.
    const f = cliff(FALL_MIN - 1.5);
    run(f, 0.2);
    expect(waterInAir(f)).toBe(0);
    expect(below(f)).toBeGreaterThan(0);
  });

  test("the fall reaches down the wall at the speed a thing falls", () => {
    const f = cliff(24);
    const front = () => {
      let best = 0;
      for (let k = 0; k < f.falls.front.length; k++) best = Math.max(best, f.falls.front[k]);
      return best;
    };
    run(f, 0.1);
    const early = front();
    run(f, 0.1);
    const later = front();
    // Distance goes as the SQUARE of time: twice as long is four times as far.
    expect(early).toBeGreaterThan(0.2);
    expect(later / early).toBeGreaterThan(2.5);
    expect(later / early).toBeLessThan(5.5);
    run(f, 1);
    expect(front()).toBeCloseTo(24, 0);          // and it reaches the floor
  });

  test("a fall whose supply stops lets go of its lip", () => {
    // The shelf is swept clear rather than left to drain: the friction
    // threshold leaves a film on it that trickles over for ever, which is a
    // fall that never stops, which is correct and no use for this.
    const f = cliff(24, 4);
    run(f, 0.5);
    for (let y = 0; y < 12; y++) for (let x = 0; x < 10; x++) f.depth[at(f, x, y)] = 0;

    let detached = false;
    for (let n = 0; n < 60 * 2 && !detached; n++) {
      stepFlow(f, 1 / 60);
      for (let i = 0; i < f.nx * f.ny; i++) {
        const e = fallExtent(f, i, 0);
        if (e && e.head > 1) detached = true;    // hanging off nothing
      }
    }
    expect(detached).toBe(true);
  });
});
