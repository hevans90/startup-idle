import { describe, expect, test } from "bun:test";

import { EVENT_DEFS } from "./defs";
import { EVENT_HEADCOUNT, FIRST_GAP, GAP, createDirector, eventStarted, pickEvent, tickDirector } from "./director";
import type { TownView } from "./events";

const town = (over: Partial<TownView> = {}): TownView => ({
  now: 0, income: 100, owned: {}, river: null, flooded: 0, evacuated: [], port: null,
  convoy: { calls: 0, earned: 0 }, routes: 0, door: null, mood: 0, studio: null, pizza: 0, sale: null, ...over,
});
const defs = Object.values(EVENT_DEFS);

describe("the director", () => {
  test("waits for a hundred people, then the first comes a few minutes after", () => {
    const d = createDirector();
    tickDirector(d, 1e6, EVENT_HEADCOUNT - 1);
    expect(d.gap).toBeNull();
    expect(pickEvent(d, town({ port: { x: 1, y: 1 } }), defs, false, 0)).toBeNull();
    tickDirector(d, 1, EVENT_HEADCOUNT);
    expect(d.gap).toBe(FIRST_GAP);
    tickDirector(d, FIRST_GAP, EVENT_HEADCOUNT);
    expect(pickEvent(d, town({ port: { x: 1, y: 1 } }), defs, false, 0)?.kind).toBe("convoy");
  });

  test("picks only those that can come, and none while one is under way", () => {
    const d = createDirector({ gap: 0, last: null });
    expect(pickEvent(d, town(), defs, false, 0.5)).toBeNull();
    expect(pickEvent(d, town({ river: { x: 0, y: 0 } }), defs, false, 0.99)?.kind).toBe("river-flood");
    expect(pickEvent(d, town({ river: { x: 0, y: 0 } }), defs, true, 0.5)).toBeNull();
  });

  test("the last one is less likely to come straight back", () => {
    const d = createDirector({ gap: 0, last: "convoy" });
    const v = town({ port: { x: 1, y: 1 }, river: { x: 0, y: 0 } });
    // Flood 1, convoy ¼: four in five rolls are the flood.
    expect(pickEvent(d, v, defs, false, 0.79)?.kind).toBe("river-flood");
    expect(pickEvent(d, v, defs, false, 0.81)?.kind).toBe("convoy");
  });

  test("one started puts the next off 15–25 minutes, and the clock is kept", () => {
    const d = createDirector({ gap: 0, last: null });
    eventStarted(d, "hackathon", 0);
    expect(d).toEqual({ gap: GAP[0], last: "hackathon" });
    eventStarted(d, "hackathon", 1);
    expect(d.gap).toBe(GAP[1]);
    expect(createDirector(JSON.parse(JSON.stringify(d)))).toEqual(d);
    // An old save's pacing: started over.
    expect(createDirector({ convoy: 12 } as never)).toEqual({ gap: null, last: null });
  });
});
