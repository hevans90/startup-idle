import { describe, expect, test } from "bun:test";

import { busyness, darkness, dayPhase, DAY_SECONDS, DAY_SWING, lightAt, nightAt, NIGHT_DARK, NIGHT_GRADE, seasonPhase } from "./daylight";
import { shadowSeason } from "./light";

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

  test("one light through the day: noon and midnight as they were, gold between", () => {
    const noon = lightAt(0.5), midnight = lightAt(0), dusk = lightAt(0.75);
    expect(noon.grade).toBe(0xffffff);
    noon.skyTop.forEach((c, i) => expect(c).toBeCloseTo([0.3, 0.5, 0.78][i], 6));
    expect(noon.sun[3]).toBe(1);
    expect(midnight.grade).toBe(NIGHT_GRADE);
    expect(midnight.sun[3]).toBe(0);
    expect(midnight.skyTop[2]).toBeCloseTo(0.78 * 0.45, 6);
    // (Warmer than either: more red than blue in the grade, the horizon flushed.)
    expect(dusk.low).toBeGreaterThan(0.4);
    expect((dusk.grade >> 16) & 255).toBeGreaterThan(dusk.grade & 255);
    expect(dusk.skyLow[0]).toBeGreaterThan(dusk.skyLow[2]);
  });
});

describe("the season's day and sun", () => {
  test("noon and midnight stay; winter's dawn is later and its dusk earlier, summer's the other way", () => {
    for (const y of [0, 0.125, 0.375, 0.625, 0.875]) {
      expect(seasonPhase(0, y)).toBeCloseTo(0, 9);
      expect(seasonPhase(0.5, y)).toBeCloseTo(0.5, 9);
      // (It never runs backward.)
      for (let p = 0; p < 1; p += 0.01) expect(seasonPhase(p + 0.01, y)).toBeGreaterThan(seasonPhase(p, y) - 1e-9);
    }
    // Seven in the morning: still before dawn in midwinter, well after it in midsummer.
    expect(nightAt(seasonPhase(7 / 24, 0.875))).toBeGreaterThan(nightAt(seasonPhase(7 / 24, 0.375)) + 0.1);
    expect(seasonPhase(0.25 + DAY_SWING, 0.875)).toBeCloseTo(0.25, 9);
    expect(seasonPhase(0.75 - DAY_SWING, 0.875)).toBeCloseTo(0.75, 9);
    // The equinoxes: the day as it always was.
    expect(seasonPhase(0.3, 0.125)).toBeCloseTo(0.3, 6);
  });

  test("a shadow is thrown further in winter, less far in summer, in steps", () => {
    expect(shadowSeason(0.875)).toBeGreaterThan(1.3);
    expect(shadowSeason(0.375)).toBeLessThan(0.8);
    expect(shadowSeason(0.125)).toBeCloseTo(1, 6);
    expect(shadowSeason(0.4)).toBe(shadowSeason(0.39));
  });
});
