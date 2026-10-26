import { describe, expect, test } from "bun:test";

import { consoleMotion, DECIPHERS_FROM, DRAWS_FROM, ENTER_MOST, MOVES_FROM, STAGGER_MOST, STAGGER_MS, stageMix, staggerDelay, stepTimes } from "./index";

describe("the console's motion", () => {
  test("decoration grows with the takeover: frames draw, then headers decipher, then backgrounds move", () => {
    expect(consoleMotion(0, false)).toEqual({ calm: false, mix: 0, draws: false, deciphers: false, moves: false });
    expect(consoleMotion(DRAWS_FROM, false)).toMatchObject({ draws: true, deciphers: false });
    expect(consoleMotion(DECIPHERS_FROM, false)).toMatchObject({ draws: true, deciphers: true, moves: false });
    expect(consoleMotion(MOVES_FROM, false)).toMatchObject({ draws: true, deciphers: true, moves: true });
  });

  test("calm holds it all still, and the mix at nothing", () => {
    expect(consoleMotion(1, true)).toEqual({ calm: true, mix: 0, draws: false, deciphers: false, moves: false });
  });

  test("the stage gives the mix", () => {
    expect(stageMix(0)).toBe(0);
    expect(stageMix(45)).toBe(DRAWS_FROM);
    expect(stageMix(85)).toBe(MOVES_FROM);
  });

  test("an entrance within its budget, the first step at once", () => {
    const t = stepTimes(4);
    expect(t[0]).toBe(0);
    expect(Math.max(...t)).toBeLessThan(ENTER_MOST);
    expect(stepTimes(1)).toEqual([0]);
  });

  test("a list staggered for its first rows, the rest with the last, none when calm", () => {
    expect(staggerDelay(3, false)).toBe(3 * STAGGER_MS);
    expect(staggerDelay(50, false)).toBe(STAGGER_MOST * STAGGER_MS);
    expect(staggerDelay(3, true)).toBe(0);
  });
});
