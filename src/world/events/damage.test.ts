import { describe, expect, test } from "bun:test";

import { createGrid } from "../grid";
import { closeFor, damage, damagedAs, damagedDesksAway, isDamaged, repairedIn, REPAIR_SECONDS, stepRepairs } from "./damage";

describe("a closure", () => {
  test("runs on its own clock, outside the crew's queue, and puts those at its desks off work", () => {
    const g = createGrid(8, 8);
    for (const id of [1, 2]) g.structures.set(id, { id, def: "office", x: id, y: 1, w: 1, h: 1 });
    damage(g, [1], "heat");
    closeFor(g, 2, 100);
    expect(damagedAs(1)).toBe("Overheated");
    expect(damagedAs(2)).toBe("Closed by the inspector");
    expect(repairedIn(2)).toBe(100);
    expect(repairedIn(1)).toBe(REPAIR_SECONDS);
    expect(damagedDesksAway(g, new Map([[2, { used: 7 }]]), () => "vibe_coder")).toEqual({ vibe_coder: 7 });
    // Held — the cause still at it — the crew waits; the closure does not.
    stepRepairs(g, 60, true);
    expect(isDamaged(1)).toBe(true);
    expect(repairedIn(2)).toBe(40);
    expect(stepRepairs(g, 50, false).sort()).toEqual([1, 2]);
  });
});
