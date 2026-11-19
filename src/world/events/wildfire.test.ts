import { describe, expect, test } from "bun:test";

import { EVENT_DEFS } from "./defs";
import { WILDFIRE_BRIGADE_MS, WILDFIRE_MS, WILDFIRE_WARN_MS } from "./defs/wildfire";
import { startEvent, stepEvents, type GameEvent, type TownView } from "./events";

/** A WILDFIRE as an event: only with something dry enough to catch, likelier the drier; over when it burns out. */
const town = (now: number, over: Partial<TownView> = {}): TownView => ({
  now, income: 100, owned: {}, river: null, flooded: 0, overheated: 0, smoking: null, wildfire: null, levee: null, evacuated: [], port: null,
  drinkers: null, offices: null, site: null, junction: null, joint: null, manhole: null, district: null, hq: null, poach: null, viral: null, unhappy: null, datacentre: null,
  convoy: { calls: 0, earned: 0 }, routes: 0, door: null, studio: null, sale: null,
  diligence: { mood: 0, spills: 0, watered: null, mop: () => {} }, ...over,
});
const dry = (dryness: number, burning = 0, burnt = 0, buildings = 0) => ({ x: 4, y: 5, dryness, burning, burnt, buildings });
const step = (evs: GameEvent[], v: TownView) => stepEvents(evs, v, EVENT_DEFS).events;

describe("a wildfire", () => {
  test("cannot come with nothing dry enough; comes likelier the drier", () => {
    const W = EVENT_DEFS.wildfire;
    expect(W.followUp).toBeFalsy();
    expect(startEvent(W, town(0), 1)).toBeNull();
    expect(W.weight!(town(0, { wildfire: dry(0.9) }))).toBeGreaterThan(W.weight!(town(0, { wildfire: dry(0.2) })) * 2);
  });

  test("let burn, it runs till it burns out, and says what it took; the brigade has it out in a minute", () => {
    const W = EVENT_DEFS.wildfire;
    let evs = [startEvent(W, town(0, { wildfire: dry(0.8) }), 1)!];
    evs = step(evs, town(WILDFIRE_WARN_MS, { wildfire: dry(0.8, 1) }));
    expect(evs[0].phase).toBe("active");
    expect(evs[0].endsAt).toBe(WILDFIRE_WARN_MS + WILDFIRE_MS);
    evs = step(evs, town(WILDFIRE_WARN_MS + 5000, { wildfire: dry(1, 20, 9, 2) }));
    evs = step(evs, town(WILDFIRE_WARN_MS + 9000, { wildfire: dry(1, 0, 40, 2) }));
    expect(evs[0].phase).toBe("over");
    expect(evs[0].outcome).toContain("40 cells");
    expect(evs[0].outcome).toContain("2 buildings");
    expect(W.activeFor!({ chosen: "brigade" } as GameEvent)).toBe(WILDFIRE_BRIGADE_MS);
  });

  test("rain on it before it catches calls it off", () => {
    const evs = step([startEvent(EVENT_DEFS.wildfire, town(0, { wildfire: dry(0.8) }), 1)!], town(1000));
    expect(evs[0].outcome).toBe("It rained. The smoke is gone.");
  });
});
