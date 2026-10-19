import { describe, expect, test } from "bun:test";

import { ambience, canPlay, gainNow, listen, setLevel, sfx, unlock } from "./sound";

describe("sound", () => {
  test("with no AudioContext, every call is a quiet no-op", () => {
    expect(canPlay()).toBe(false);
    expect(() => { unlock(); sfx("build"); sfx("click"); ambience(1, 0); listen()(); }).not.toThrow();
  });

  test("muted is silent whatever the volume; the volume is heard on a curve", () => {
    setLevel(0.8, true);
    expect(gainNow()).toBe(0);
    setLevel(0.5, false);
    expect(gainNow()).toBeCloseTo(0.25);
    setLevel(2, false);
    expect(gainNow()).toBe(1);
    setLevel(0.6, false);
  });
});
