import { describe, expect, test } from "bun:test";

import { SEQUENCE_MS, sequenceDone, sequenceIntensity, sequenceProgress, stepSequence } from "./ascension-sequence";

describe("the Ascension sequence", () => {
  test("starts once when the meter is full, plays out, and is forgotten when it is not", () => {
    expect(stepSequence(99, 0)).toBe(false);
    expect(sequenceProgress(0)).toBe(0);
    expect(stepSequence(100, 1000)).toBe(true);
    expect(stepSequence(100, 2000)).toBe(false);
    expect(sequenceIntensity(1000 + SEQUENCE_MS / 4)).toBeCloseTo(0.5);
    expect(sequenceDone(1000 + SEQUENCE_MS - 1)).toBe(false);
    expect(sequenceDone(1000 + SEQUENCE_MS)).toBe(true);
    // A shutdown: the meter drops, and the next full meter plays it again.
    stepSequence(50, 30_000);
    expect(sequenceDone(40_000)).toBe(false);
    expect(stepSequence(100, 50_000)).toBe(true);
    stepSequence(0, 0);
  });
});
