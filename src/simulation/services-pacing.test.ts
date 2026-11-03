/**
 * THE UNLOCK LADDER'S PACE, on the map run's player: every service unlocks,
 * never two within `UNLOCK_GAP`, and about one every five minutes — not a
 * burst, not a drought. `BALANCE=1` prints when each came. @see UNLOCK_AT
 */
import { describe, expect, jest, test } from "bun:test";

import { SERVICE_IDS } from "../world/agents/needs";
import { UNLOCK_GAP } from "../world/agents/unlocks";
import { simulateMapRun } from "./simulate-map-run";

describe("the unlock ladder", () => {
  test("every service, one at a time, about one every five minutes", () => {
    const run = simulateMapRun(jest.advanceTimersByTime.bind(jest), { maxSimulatedSeconds: 86400, afterCore: 3 * 3600 });
    const at = run.unlocks.map((u) => u.at);
    if (process.env.BALANCE) console.log(run.unlocks.map((u) => `${(u.at / 60).toFixed(1)}m ${u.id}`).join("\n"));
    expect(run.unlocks.map((u) => u.id).sort()).toEqual([...SERVICE_IDS].sort());
    const gaps = at.slice(1).map((t, k) => t - at[k]);
    expect(Math.min(...gaps)).toBeGreaterThanOrEqual(UNLOCK_GAP);
    const mean = (at[at.length - 1] - at[0]) / gaps.length;
    expect(mean).toBeGreaterThan(4 * 60);
    expect(mean).toBeLessThan(6 * 60);
  }, 300_000);
});
