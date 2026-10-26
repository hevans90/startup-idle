import { describe, expect, test } from "bun:test";

import { INTERFACE, ambience, canPlay, gainNow, listen, mixNow, setConsoleMix, setLevel, setMix, sfx, unlock } from "./sound";

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

  test("the interface's sounds are on their own bus, each part has its level, and none of it throws without a context", () => {
    for (const n of ["click", "tick", "open", "close", "confirm", "deny", "alert", "transmission", "decision"] as const) expect(INTERFACE.has(n)).toBe(true);
    expect(INTERFACE.has("build")).toBe(false);
    expect(() => { setMix({ interface: 0.3, ticks: true }); setConsoleMix(0.8); sfx("tick"); sfx("alert"); }).not.toThrow();
    expect(mixNow()).toMatchObject({ interface: 0.3, ticks: true });
    setMix({ interface: 0.5, ticks: false });
  });
});
