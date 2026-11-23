import { describe, expect, test } from "bun:test";
import { RELOAD_GAP, mayReload } from "./device";

describe("a lost device", () => {
  test("is answered with a reload the first time, and not again within the gap", () => {
    expect(mayReload(1_000_000, null)).toBe(true);
    expect(mayReload(1_000_000, 1_000_000 - 5_000)).toBe(false);
    expect(mayReload(1_000_000, 1_000_000 - RELOAD_GAP)).toBe(true);
  });
});
