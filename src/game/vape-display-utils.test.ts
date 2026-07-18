import { describe, expect, test } from "bun:test";
import { vapeChargeFromLastPuff } from "./vape-display-utils";

describe("vapeChargeFromLastPuff", () => {
  test("never puffed → ready immediately", () => {
    expect(vapeChargeFromLastPuff(0, 1_000_000, 45)).toBe(1);
  });

  test("cooldown scales with real elapsed time and is reload-independent", () => {
    const puffAt = 1_000_000;
    // The charge depends only on (now - lastPuffAt), so a reload that re-runs
    // this with the same persisted lastPuffAt yields the same value — no reset.
    expect(vapeChargeFromLastPuff(puffAt, puffAt, 45)).toBe(0); // just puffed
    expect(vapeChargeFromLastPuff(puffAt, puffAt + 22_500, 45)).toBeCloseTo(0.5, 5);
    expect(vapeChargeFromLastPuff(puffAt, puffAt + 45_000, 45)).toBe(1); // full
    expect(vapeChargeFromLastPuff(puffAt, puffAt + 90_000, 45)).toBe(1); // capped at 1
  });

  test("clock skew (now before lastPuffAt) clamps to 0, not negative", () => {
    expect(vapeChargeFromLastPuff(1_000_000, 999_000, 45)).toBe(0);
  });
});
