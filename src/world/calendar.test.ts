import { describe, expect, test } from "bun:test";

import { useCalendarStore } from "../state/calendar.store";
import { dayOf, groundSeason, leafColour, seasonOf, treeStateAt, treeTurn, yearOf, YEAR_SECONDS } from "./calendar";

describe("the calendar", () => {
  test("a year's four seasons, thirty days each, and the year counted from one", () => {
    expect([0, 0.25, 0.5, 0.75, 0.999].map(seasonOf)).toEqual(["spring", "summer", "autumn", "winter", "winter"]);
    expect(dayOf(0)).toBe(1);
    expect(dayOf(0.25 - 1e-9)).toBe(30);
    expect(dayOf(2.25 + 1.5 / 120)).toBe(2);
    expect(yearOf(0.3)).toBe(1);
    expect(yearOf(2.9)).toBe(3);
  });

  test("the ground's year: flowers in spring, straw in summer, brown grass from autumn till spring, snow in winter only", () => {
    const at = (y: number) => groundSeason(y);
    expect(at(0.12).bloom).toBeGreaterThan(0.9);
    expect(at(0.45).dry).toBeGreaterThan(0.9);
    expect(at(0.45).brown).toBe(0);
    expect(at(0.8).brown).toBe(1);
    expect(at(0.0).brown).toBe(1);
    expect(at(0.85).snow).toBe(1);
    for (const y of [0.1, 0.3, 0.5, 0.7, 0.99]) expect(at(y).snow).toBe(0);
    // Nothing jumps, round the turn of the year least of all.
    for (let y = 0; y < 2; y += 0.001) {
      const a = at(y), b = at(y + 0.001);
      for (const k of ["bloom", "dry", "brown", "snow"] as const) expect(Math.abs(a[k] - b[k])).toBeLessThan(0.05);
    }
  });

  test("a tree's year: bare, budding, in leaf, thinning, bare, snowed on; a pine green under its snow", () => {
    expect(treeStateAt("oak", 0.01, 0)).toBe("bare");
    expect(treeStateAt("oak", 0.09, 0)).toBe("bud");
    expect(treeStateAt("oak", 0.4, 0)).toBe("full");
    expect(treeStateAt("oak", 0.68, 0)).toBe("thin");
    expect(treeStateAt("oak", 0.76, 0)).toBe("bare");
    expect(treeStateAt("oak", 0.88, 0)).toBe("snow");
    expect(treeStateAt("oak", 1.4, 0)).toBe("full");
    expect(treeStateAt("pine", 0.3, 0)).toBe("full");
    expect(treeStateAt("pine", 0.88, 0)).toBe("snow");
    // The turn under way is the one asked for, and its end is still to come — whenever and with whatever lag.
    for (let t = 0; t < 3; t += 0.0137) for (const lag of [-0.025, 0, 0.025]) for (const kind of ["oak", "birch", "pine"]) {
      const r = treeTurn(kind, t, lag);
      expect(r.t1).toBeGreaterThan(t);
      expect(r.t0).toBeLessThan(r.t1);
      expect(r.t1 - t).toBeLessThan(kind === "pine" ? 0.9 : 0.6);
    }
    // A turn leads on to the next: what one turns to the next turns from.
    const a = treeTurn("oak", 0.2, 0), b = treeTurn("oak", a.t1 + 1e-6, 0);
    expect(b.from).toBe(a.to);
  });

  test("leaves green in summer, turned in autumn, a cherry in blossom first", () => {
    const g = (c: number) => (c >> 8) & 255, r = (c: number) => c >> 16;
    expect(g(leafColour("oak", 0.4))).toBeGreaterThan(r(leafColour("oak", 0.4)));
    expect(r(leafColour("lime", 0.66))).toBeGreaterThan(g(leafColour("lime", 0.66)) * 0.9);
    expect(r(leafColour("cherry", 0.07))).toBeGreaterThan(220);
    expect(leafColour("oak", 1.4)).toBe(leafColour("oak", 0.4));
  });

  test("the year runs by the wall clock, holds while Seasons is off, and credits time away only as far as it is credited", () => {
    const s = useCalendarStore.getState(), H = YEAR_SECONDS * 1000;
    s.setYear(0, 0);
    s.setRunning(true, 0);
    expect(s.now(H / 4)).toBeCloseTo(0.25, 9);
    s.setRunning(false, H / 4);
    expect(s.now(H * 10)).toBeCloseTo(0.25, 9);
    s.setRunning(true, H);
    expect(s.now(H * 1.5)).toBeCloseTo(0.75, 9);
    // Played till H·1.5, away a long time, a quarter of a year credited: from where it stood, a quarter on.
    useCalendarStore.getState().catchUp(H * 1.5, H / 4, H * 40);
    expect(useCalendarStore.getState().now(H * 40)).toBeCloseTo(1, 9);
  });
});
