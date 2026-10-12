import { describe, expect, jest, test } from "bun:test";

import { markWorldGone, markWorldReady, whenWorldReady } from "./world-ready";

describe("waiting for the map", () => {
  test("runs once the map is up, once, or at the timeout if it never comes", () => {
    jest.useFakeTimers();
    markWorldGone();
    let a = 0;
    whenWorldReady(() => a++, 1000);
    expect(a).toBe(0);
    markWorldReady();
    markWorldReady();
    expect(a).toBe(1);
    // Up already: at once.
    let b = 0;
    whenWorldReady(() => b++, 1000);
    expect(b).toBe(1);
    // Never up: at the timeout.
    markWorldGone();
    let c = 0;
    whenWorldReady(() => c++, 1000);
    jest.advanceTimersByTime(1000);
    expect(c).toBe(1);
    // Cancelled: never.
    let d = 0;
    const cancel = whenWorldReady(() => d++, 1000);
    cancel();
    markWorldReady();
    jest.advanceTimersByTime(1000);
    expect(d).toBe(0);
    jest.useRealTimers();
  });
});
