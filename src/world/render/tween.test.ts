import { describe, expect, test } from "bun:test";

import { EASE, createTweens } from "./tween";

describe("tweens", () => {
  test("ease from one value to the other over their time, and end exactly there", () => {
    const tw = createTweens();
    let v = 0, done = 0;
    tw.add({ from: 10, to: 20, ms: 100, ease: EASE.linear, set: (x) => { v = x; }, done: () => done++ });
    tw.step(50);
    expect(v).toBe(15);
    expect(tw.size).toBe(1);
    tw.step(80);
    expect(v).toBe(20);
    expect(done).toBe(1);
    expect(tw.size).toBe(0);
  });

  test("stop, unfinished, once what they move is gone", () => {
    const tw = createTweens();
    let alive = true, v = 0;
    tw.add({ from: 0, to: 1, ms: 100, ease: EASE.linear, set: (x) => { v = x; }, alive: () => alive });
    tw.step(20);
    alive = false;
    tw.step(20);
    expect(v).toBeCloseTo(0.2);
    expect(tw.size).toBe(0);
  });

  test("finish sets each to its end", () => {
    const tw = createTweens();
    let v = 0;
    tw.add({ from: 0, to: 5, ms: 1000, ease: EASE.outCubic, set: (x) => { v = x; } });
    tw.finish();
    expect(v).toBe(5);
  });

  test("the eases start at 0 and end at 1; a hop ends where it began", () => {
    for (const e of [EASE.linear, EASE.outCubic, EASE.inOutCubic, EASE.outBack]) {
      expect(e(0)).toBeCloseTo(0);
      expect(e(1)).toBeCloseTo(1);
    }
    expect(EASE.outBack(0.8)).toBeGreaterThan(1);
    expect(EASE.hop(0)).toBeCloseTo(0);
    expect(EASE.hop(0.5)).toBeCloseTo(1);
    expect(EASE.hop(1)).toBeCloseTo(0);
  });
});
