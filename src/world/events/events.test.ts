import { describe, expect, test } from "bun:test";

import { FLOOD_MS, FLOOD_WARN_MS, OVER_SHOWN_MS, SLOP_WARN_AT, stepEvents, tourReward, type EventWorld, type GameEvent } from "./events";

const world = (fill: number, now = 0, rate = 0.1): EventWorld => ({
  now, slop: { x: 5, y: 5, fill, rate, trucks: 0, truckPrice: 300 }, river: null, convoy: null, tour: null, hackathon: null, offer: null, enabled: true,
});
const river = (now: number, due: boolean, flooded = 0): EventWorld => ({
  now, slop: null, river: { x: 0, y: 9, due, flooded, sandbagPrice: 500 }, convoy: null, tour: null, hackathon: null, offer: null, enabled: true,
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
    const busy = stepEvents(evs, { ...world(93, 600), slop: { x: 5, y: 5, fill: 93, rate: 0.1, trucks: 2, truckPrice: 300 } }, next);
    expect(busy[0].choices.find((c) => c.id === "trucks")?.unavailable).toBe("2 on the way");
  });
});

describe("a river flood", () => {
  test("is warned of when due, strikes a minute later, and is over a minute after that", () => {
    expect(stepEvents([], river(0, false), next)).toEqual([]);
    let evs = stepEvents([], river(0, true), next);
    expect(evs[0]).toMatchObject({ kind: "river-flood", phase: "warning", strikesAt: FLOOD_WARN_MS });
    expect(evs[0].choices.map((c) => c.id)).toEqual(["sandbags", "evacuate", "brace"]);
    evs = stepEvents(evs, river(FLOOD_WARN_MS, false), next);
    expect(evs[0]).toMatchObject({ phase: "active", endsAt: FLOOD_WARN_MS + FLOOD_MS });
    evs = stepEvents(evs, river(FLOOD_WARN_MS + 1000, false, 3), next);
    evs = stepEvents(evs, river(FLOOD_WARN_MS + 2000, false, 1), next);
    evs = stepEvents(evs, river(FLOOD_WARN_MS + FLOOD_MS, false), next);
    expect(evs[0].phase).toBe("over");
    expect(evs[0].outcome).toMatch(/3 buildings/);
  });

  test("waits for anything else under way", () => {
    const w = { ...river(0, true), slop: { x: 5, y: 5, fill: 100, rate: 0, trucks: 0, truckPrice: 1 } };
    const evs = stepEvents([], w, next);
    expect(evs.map((e) => e.kind)).toEqual(["slop-overflow"]);
  });

  test("events switched off puts every one away", () => {
    const evs = stepEvents([], river(0, true), next);
    expect(stepEvents(evs, { ...river(1, true), enabled: false }, next)).toEqual([]);
  });
});

describe("opportunities", () => {
  const base = (now: number): EventWorld => ({ now, slop: null, river: null, convoy: null, tour: null, hackathon: null, offer: null, enabled: true });

  test("a convoy is warned of, comes in, and says what it earned", () => {
    const w = (now: number, due: boolean, calls = 0, earned = 0) => ({
      ...base(now), convoy: { x: 1, y: 1, due, calls, earned, handsPrice: 400 },
    });
    let evs = stepEvents([], w(0, true), next);
    expect(evs[0]).toMatchObject({ kind: "convoy", phase: "warning", strikesAt: 30_000 });
    evs = stepEvents(evs, w(30_000, false), next);
    expect(evs[0]).toMatchObject({ phase: "active", endsAt: 90_000 });
    evs = stepEvents(evs, w(90_000, false, 7, 140), next);
    expect(evs[0].outcome).toBe("7 calls while it was in, for $140.");
  });

  test("a hackathon nobody hosted never starts", () => {
    const w = (now: number) => ({ ...base(now), hackathon: { x: 1, y: 1, due: now === 0 } });
    let evs = stepEvents([], w(0), next);
    evs = stepEvents(evs, w(45_000), next);
    expect(evs[0]).toMatchObject({ phase: "over", outcome: "No hackathon this time." });
  });

  test("investors pay by the town's mood, and tidying up helps", () => {
    expect(tourReward(10, 0, false)).toBe(300);
    expect(tourReward(10, 0, true)).toBe(450);
    expect(tourReward(10, -40, false)).toBe(0);
    expect(tourReward(10, 40, true)).toBe(900);
  });
});

describe("an acquirer's offer", () => {
  const at = (now: number, due: boolean, equity = 16): EventWorld => ({
    now, slop: null, river: null, convoy: null, tour: null, hackathon: null, enabled: true,
    offer: { x: 4, y: 4, due, equity, withPremium: Math.floor(equity * 1.25) },
  });

  test("comes when due and the company can be sold, is on the table a while, and lapses", () => {
    expect(stepEvents([], { ...at(0, true), offer: null }, next)).toEqual([]);
    let evs = stepEvents([], at(0, true), next);
    expect(evs[0].kind).toBe("offer");
    expect(evs[0].phase).toBe("warning");
    expect(evs[0].choices.map((c) => c.id)).toEqual(["accept", "hold"]);
    expect(evs[0].choices[0].cost).toContain("+20 Equity, against 16");
    evs = stepEvents(evs, at(20_000, false), next);
    expect(evs[0].phase).toBe("active");
    evs = stepEvents(evs, at(20_000 + 120_000, false), next);
    expect(evs[0].phase).toBe("over");
    expect(evs[0].outcome).toMatch(/walked away/);
  });

  test("is called off if the company can no longer be sold", () => {
    const evs = stepEvents([], at(0, true), next);
    const after = stepEvents(evs, { ...at(1000, false), offer: null }, next);
    expect(after[0].phase).toBe("over");
  });
});
