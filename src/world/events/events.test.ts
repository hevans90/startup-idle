import { describe, expect, test } from "bun:test";

import { OVER_SHOWN_MS, SLOP_WARN_AT, stepEvents, type EventWorld, type GameEvent } from "./events";

const world = (fill: number, now = 0, rate = 0.1): EventWorld => ({
  now, slop: { x: 5, y: 5, fill, rate, trucks: 0, truckPrice: 300 },
});
let n = 1;
const next = () => n++;

describe("the slop pit's overflow, as an event", () => {
  test("is announced at 90%, with the time it will take to fill at the rate it is filling", () => {
    expect(stepEvents([], world(SLOP_WARN_AT - 1), next)).toEqual([]);
    const [e] = stepEvents([], world(92, 1000, 0.1), next);
    expect(e.phase).toBe("warning");
    expect(e.strikesAt).toBeCloseTo(1000 + (8 / 0.1) * 1000, 6);
    expect(e.choices.map((c) => c.id)).toEqual(["drain", "trucks", "spill"]);
  });

  test("strikes at 100%, and is over below 95%", () => {
    let evs: GameEvent[] = stepEvents([], world(92), next);
    evs = stepEvents(evs, world(100, 5000), next);
    expect(evs[0].phase).toBe("active");
    evs = stepEvents(evs, world(97, 6000), next);
    expect(evs[0].phase).toBe("active");
    evs = stepEvents(evs, world(80, 7000), next);
    expect(evs[0].phase).toBe("over");
    expect(evs[0].outcome).toMatch(/stopped/);
    // And put away a while after.
    expect(stepEvents(evs, world(80, 7000 + OVER_SHOWN_MS + 1), next)).toEqual([]);
  });

  test("found full already, it is overflowing at once", () => {
    const [e] = stepEvents([], world(100), next);
    expect(e.phase).toBe("active");
    expect(e.title).toMatch(/overflowing/);
  });

  test("averted if the pit comes back down before it fills", () => {
    let evs: GameEvent[] = stepEvents([], world(92), next);
    evs = stepEvents(evs, world(40, 3000), next);
    expect(evs[0].phase).toBe("over");
    expect(evs[0].outcome).toMatch(/Averted/);
  });

  test("never two at once, and the trucks cannot be sent twice", () => {
    let evs: GameEvent[] = stepEvents([], world(92), next);
    evs = stepEvents(evs, world(93, 500), next);
    expect(evs.length).toBe(1);
    const busy = stepEvents(evs, { now: 600, slop: { x: 5, y: 5, fill: 93, rate: 0.1, trucks: 2, truckPrice: 300 } }, next);
    expect(busy[0].choices.find((c) => c.id === "trucks")?.unavailable).toBe("2 on the way");
  });
});
