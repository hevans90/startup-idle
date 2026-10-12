import { describe, expect, test } from "bun:test";

import { busyness, darkness, dayPhase, DAY_SECONDS, NIGHT_DARK } from "./daylight";

describe("day and night", () => {
  test("dark at midnight, light at noon, the day by the clock", () => {
    expect(darkness(0)).toBeCloseTo(NIGHT_DARK, 6);
    expect(darkness(0.5)).toBeCloseTo(0, 6);
    expect(dayPhase(DAY_SECONDS * 1000 * 0.25)).toBeCloseTo(0.25, 6);
  });

  test("the streets busiest at the rush, quietest at night", () => {
    const at = (h: number) => busyness(h / 24);
    expect(at(8).traffic).toBeGreaterThan(at(13).traffic);
    expect(at(18).commute).toBeGreaterThan(at(13).commute);
    expect(at(0).traffic).toBeLessThan(at(13).traffic);
  });
});
