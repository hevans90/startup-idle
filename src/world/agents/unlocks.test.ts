import { describe, expect, test } from "bun:test";

import { createGrid } from "../grid";
import { deserializeWorld, serializeWorld } from "../io/serialize";
import { UNLOCK_AT, UNLOCK_GAP, ladderOf, serviceOpen, startLadder, stepLadder, unlockedOf, wantsAny } from "./unlocks";

describe("the unlock ladder", () => {
  test("a service unlocks when its kind's headcount reaches it", () => {
    const g = {}, l = startLadder(g, []);
    expect(stepLadder(l, { intern: UNLOCK_AT.takeaway - 1 }, 1)).toEqual([]);
    expect(serviceOpen(g, "takeaway")).toBe(false);
    expect(stepLadder(l, { intern: UNLOCK_AT.takeaway }, 1)).toEqual(["takeaway"]);
    expect(serviceOpen(g, "takeaway")).toBe(true);
  });

  test("a jump in hires reveals them one at a time, UNLOCK_GAP apart", () => {
    const l = startLadder({}, []);
    const all = { intern: 1000, vibe_coder: 1000, "10x_dev": 1000 };
    expect(stepLadder(l, all, 1)).toHaveLength(1);
    expect(stepLadder(l, all, UNLOCK_GAP - 1)).toEqual([]);
    expect(stepLadder(l, all, 1)).toHaveLength(1);
    expect(l.queue).toHaveLength(14);
  });

  test("a map saved before the ladder catches up at once; one saved with it keeps what it had", () => {
    const old = {}, l = startLadder(old);
    expect(stepLadder(l, { intern: UNLOCK_AT.bar }, 1)).toEqual(["takeaway", "bar"]);
    const saved = {};
    startLadder(saved, unlockedOf(old));
    expect(serviceOpen(saved, "bar")).toBe(true);
    expect(stepLadder(ladderOf(saved)!, { intern: UNLOCK_AT.bar }, 1)).toEqual([]);
  });

  test("a map with no ladder has everything open, and nobody minds an unmet need before any is unlocked", () => {
    expect(serviceOpen({}, "dentist")).toBe(true);
    const g = {};
    startLadder(g, []);
    expect(wantsAny(g, "intern")).toBe(false);
    stepLadder(ladderOf(g)!, { intern: UNLOCK_AT.takeaway }, 1);
    expect(wantsAny(g, "intern")).toBe(true);
    expect(wantsAny(g, "vibe_coder")).toBe(false);
  });

  test("the map's file keeps what it unlocked; a file from before has none, and catches up", () => {
    const g = createGrid(8, 8);
    stepLadder(startLadder(g, []), { intern: UNLOCK_AT.takeaway }, 1);
    const back = deserializeWorld(serializeWorld(g, { terrain: [null], paved: [null] })).grid;
    expect(unlockedOf(back)).toEqual(["takeaway"]);
    expect(ladderOf(back)!.catchUp).toBe(false);
    expect(ladderOf(deserializeWorld(serializeWorld(createGrid(8, 8), { terrain: [null], paved: [null] })).grid)).toBeUndefined();
  });
});
