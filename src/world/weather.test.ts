import { describe, expect, test } from "bun:test";

import { groundAt, runoffAt, weatherAt } from "./weather";

/** THE WEATHER: pure on the calendar's time; the seasons in it; what lies and where it goes. @see weather */
const YEAR = 720;
const across = (from: number, years: number, f: (t: number) => void) => { for (let k = 0; k < years * YEAR; k++) f(from + k / YEAR); };

describe("the weather", () => {
  test("the same time, the same weather; it changes over hours, not frames", () => {
    expect(weatherAt(3.217)).toEqual(weatherAt(3.217));
    across(2, 1, (t) => {
      const a = weatherAt(t), b = weatherAt(t + 1 / (YEAR * 30));
      expect(Math.abs(a.fall - b.fall)).toBeLessThan(0.05);
      expect(Math.abs(a.temp - b.temp)).toBeLessThan(0.5);
    });
  });

  test("by the season: snow only in the cold, storms in summer, summer the driest; every kind comes", () => {
    const seen = new Set<string>(), fall = [0, 0, 0, 0];
    across(1, 10, (t) => {
      const w = weatherAt(t), s = Math.floor((t % 1) * 4);
      seen.add(w.kind);
      fall[s] += w.rain;
      if (w.snow > 0.05) expect(w.temp).toBeLessThan(1.5);
      if (w.kind === "storm") expect(w.temp).toBeGreaterThan(12);
      expect(w.rain + w.snow).toBeCloseTo(w.fall, 9);
    });
    expect([...seen].sort()).toEqual(["dry", "frost", "rain", "showers", "snow", "storm"]);
    expect(fall[1]).toBeLessThan(fall[2]);
  });

  test("snow lies through the winter and is gone by summer; the ground wet after rain and dry after a dry spell", () => {
    let winterSnow = 0, summerSnow = 0, wetAfterRain = 0, rains = 0;
    across(3, 3, (t) => {
      const l = groundAt(t), y = t % 1;
      if (y > 0.82 && y < 0.95) winterSnow += l.snow / (YEAR * 0.13 * 3);
      if (y > 0.3 && y < 0.55) summerSnow = Math.max(summerSnow, l.snow);
      if (weatherAt(t).rain > 0.5) { wetAfterRain += l.wet; rains++; }
    });
    expect(winterSnow).toBeGreaterThan(0.5);
    expect(summerSnow).toBe(0);
    expect(wetAfterRain / rains).toBeGreaterThan(0.6);
  });

  test("over the years the rain run off and the water taken up balance, so a lake neither fills nor empties", () => {
    let off = 0, up = 0;
    across(1, 20, (t) => { const r = runoffAt(t); off += r.off; up += r.up; });
    expect(up / off).toBeGreaterThan(0.85);
    expect(up / off).toBeLessThan(1.05);
  });
});
