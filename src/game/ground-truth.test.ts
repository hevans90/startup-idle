import { beforeEach, describe, expect, test } from "bun:test";

import { TRUTH_CAP, TRUTH_RUN, bankGroundTruth, groundTruth, resetGroundTruth, spendGroundTruth, truthShare } from "./ground-truth";

/** GROUND TRUTH: banked a field at a time by the farms' drones, capped, a run's worth spent a run. */
beforeEach(() => resetGroundTruth());

describe("ground truth", () => {
  test("banked up to three runs' worth", () => {
    bankGroundTruth(50);
    bankGroundTruth(200);
    expect(groundTruth()).toBe(TRUTH_CAP);
    expect(TRUTH_CAP).toBe(3 * TRUTH_RUN);
    expect(truthShare()).toBe(1);
  });

  test("a run spends a run's worth, and runs on what was there", () => {
    bankGroundTruth(60);
    expect(spendGroundTruth()).toBeCloseTo(60 / TRUTH_CAP);
    expect(groundTruth()).toBe(60 - TRUTH_RUN);
    spendGroundTruth();
    expect(groundTruth()).toBe(0);
    expect(spendGroundTruth()).toBe(0);
  });
});
