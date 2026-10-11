import { describe, expect, test } from "bun:test";

import { PACING, type GameEvent } from "./events";
import { createPacing, endedBetween, isDue, repace, tickPacing } from "./town-events";

const ev = (id: number, kind: GameEvent["kind"], phase: GameEvent["phase"]): GameEvent => ({
  id, kind, phase, title: "", text: "", where: { x: 0, y: 0 }, strikesAt: null, choices: [],
});

describe("event pacing", () => {
  test("clocks run only while nothing is under way, and a new event puts its kind off", () => {
    const p = createPacing();
    tickPacing(p, [ev(1, "convoy", "active")], 1e6);
    expect(isDue(p, "convoy")).toBe(false);
    tickPacing(p, [], PACING.convoy.first);
    expect(isDue(p, "convoy")).toBe(true);
    repace(p, [], [ev(2, "convoy", "warning")], () => 0);
    expect(p.convoy).toBe(PACING.convoy.between[0]);
  });

  test("an event that ended is found once", () => {
    const before = [ev(1, "hackathon", "active")], after = [ev(1, "hackathon", "over")];
    expect(endedBetween(before, after).map((e) => e.id)).toEqual([1]);
    expect(endedBetween(after, after)).toEqual([]);
  });
});
