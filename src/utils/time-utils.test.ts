import { describe, expect, test } from "bun:test";
import { formatDuration } from "./time-utils";

const S = 1000;
const M = 60 * S;
const H = 60 * M;
const D = 24 * H;

describe("formatDuration", () => {
  test("shows the two largest meaningful units", () => {
    expect(formatDuration(8 * S)).toBe("8s");
    expect(formatDuration(5 * M + 12 * S)).toBe("5m 12s");
    expect(formatDuration(3 * H + 7 * M)).toBe("3h 7m");
    expect(formatDuration(2 * D + 5 * H)).toBe("2d 5h");
  });

  test("clamps negative / non-finite to 0s", () => {
    expect(formatDuration(-100)).toBe("0s");
    expect(formatDuration(NaN)).toBe("0s");
  });
});
