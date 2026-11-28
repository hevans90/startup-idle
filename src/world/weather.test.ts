import { describe, expect, test } from "bun:test";

import { FRONT_SPEED, PREVAILING, coolingThirst, floodOdds, roadGrip, weatherMood, frontLag, groundAt, groundOver, runoffAt, skyAt, skyOver, weatherAt, weatherOver, windAt, windStrength } from "./weather";

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

describe("the wind, the fronts and the sky", () => {
  test("the wind is a unit step, about the prevailing way; its strength 0–1", () => {
    across(4, 2, (t) => {
      const [x, y] = windAt(t), s = windStrength(t);
      expect(Math.hypot(x, y)).toBeCloseTo(1, 9);
      expect(x * PREVAILING[0] + y * PREVAILING[1]).toBeGreaterThan(0.6);
      expect(s).toBeGreaterThanOrEqual(0);
      expect(s).toBeLessThanOrEqual(1);
    });
  });

  test("a front crosses downwind: a cell's weather is the origin's, later; pure", () => {
    expect(frontLag(0, 0)).toBe(0);
    expect(frontLag(40 * PREVAILING[0], 40 * PREVAILING[1])).toBeGreaterThan(frontLag(10 * PREVAILING[0], 10 * PREVAILING[1]));
    // Across the wind, the same weather.
    expect(frontLag(-PREVAILING[1] * 30, PREVAILING[0] * 30)).toBeCloseTo(0, 12);
    const lag = frontLag(60, 20);
    expect(weatherOver(2.4, 60, 20)).toEqual(weatherAt(2.4 - lag));
    expect(skyOver(2.4, 60, 20)).toEqual(skyAt(2.4 - lag));
    // A hundred cells in under a minute of play (a year an hour).
    expect(100 / FRONT_SPEED * 3600).toBeLessThan(60);
    const g = groundOver(2.9, 60, 20), exact = groundAt(2.9 - lag);
    expect(Math.abs(g.snow - exact.snow)).toBeLessThan(0.02);
    expect(Math.abs(g.wet - exact.wet)).toBeLessThan(0.05);
  });

  test("the sky by the season: heaps high in summer, sheets low in the cold; rain under cloud; fog only when nothing falls", () => {
    const flat = [0, 0, 0, 0], base = [0, 0, 0, 0], n = [0, 0, 0, 0];
    let fog = 0, storms = 0, clear = 0, wisps = 0;
    across(1, 10, (t) => {
      const s = skyAt(t), w = weatherAt(t), q = Math.floor((t % 1) * 4);
      for (const v of [s.cover, s.flat, s.dark, s.storm, s.fog, s.wisps, s.cold]) { expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThanOrEqual(1); }
      expect(s.top).toBeGreaterThan(s.base + 4);
      if (w.fall > 0.15) expect(s.cover).toBeGreaterThan(0.5);
      expect(s.cover).toBeLessThanOrEqual(0.85);
      if (s.fog > 0.05) expect(w.fall).toBeLessThan(0.2);
      if (w.storm > 0.6) { storms++; expect(s.top - s.base).toBeGreaterThan(30); expect(s.base).toBeLessThan(4); }
      if (s.cover < 0.3) clear++;
      if (s.fog > 0.4) fog++;
      if (s.wisps > 0.3) wisps++;
      flat[q] += s.flat; base[q] += s.base; n[q]++;
    });
    // Summer (1) heaped and high; winter (3) flat and low.
    expect(flat[1] / n[1]).toBeLessThan(flat[3] / n[3] - 0.2);
    expect(base[1] / n[1]).toBeGreaterThan(base[3] / n[3] + 4);
    for (const k of [fog, storms, clear, wisps]) expect(k).toBeGreaterThan(10);
  });

  test("the sky changes over minutes, not frames", () => {
    across(2, 1, (t) => {
      const a = skyAt(t), b = skyAt(t + 1 / (YEAR * 30));
      expect(Math.abs(a.cover - b.cover)).toBeLessThan(0.06);
      expect(Math.abs(a.base - b.base)).toBeLessThan(1.5);
    });
  });
});

describe("what the weather does to the town", () => {
  test("moods: every kind comes, grim only in rain or storm, fair only when dry, the first snow while little lies", () => {
    const seen = new Set<string>();
    across(1, 6, (t) => {
      const m = weatherMood(t), w = weatherAt(t), g = groundAt(t);
      seen.add(String(m));
      if (m === "grim") expect(w.rain + w.storm).toBeGreaterThan(0.2);
      if (m === "fair") expect(w.fall).toBeLessThan(0.02);
      if (m === "firstSnow") { expect(w.snow).toBeGreaterThan(0.1); expect(g.snow).toBeLessThan(0.35); }
    });
    expect([...seen].sort()).toEqual(["fair", "firstSnow", "grim", "null"]);
  });

  test("the roads grip less in snow and hard rain, never under a half; tanks thirst less in the cold, more in the heat; a sodden ground floods likelier", () => {
    let least = 1, most = 0, cold = 2, hot = 0;
    across(1, 6, (t) => {
      const k = roadGrip(t), th = coolingThirst(t);
      expect(k).toBeGreaterThanOrEqual(0.55); expect(k).toBeLessThanOrEqual(1);
      least = Math.min(least, k); most = Math.max(most, k);
      cold = Math.min(cold, th); hot = Math.max(hot, th);
    });
    expect(most).toBe(1);
    expect(least).toBeLessThan(0.75);
    expect(cold).toBeLessThan(0.85);
    expect(hot).toBeGreaterThan(1.05);
    expect(hot).toBeLessThanOrEqual(1.25);
    expect(roadGrip(0, { snow: 1, wet: 0, melt: 0, frost: 0 })).toBeLessThan(roadGrip(0, { snow: 0, wet: 0, melt: 0, frost: 0 }));
    expect(floodOdds({ snow: 0, wet: 0, melt: 0, frost: 0 })).toBe(0.5);
    expect(floodOdds({ snow: 0, wet: 1, melt: 0, frost: 0 })).toBe(2);
  });
});
