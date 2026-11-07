import { describe, expect, test } from "bun:test";

import { EVENT_DEFS } from "./defs";
import { MAX_ROUTES, ROUTE_BONUS, routeWon } from "./defs/convoy";
import { FLOOD_MS, FLOOD_WARN_MS } from "./defs/flood";
import { HACKATHON_SNUB } from "./defs/hackathon";
import { tourFailed, tourReward } from "./defs/investor-tour";
import { OVER_SHOWN_MS, eventCrew, startEvent, stepEvents, type EventKind, type GameEvent, type TownView } from "./events";

const town = (now: number, over: Partial<TownView> = {}): TownView => ({
  now, income: 100, owned: { intern: 12, vibe_coder: 20 }, river: null, flooded: 0, levee: null, evacuated: [], port: null,
  convoy: { calls: 0, earned: 0 }, routes: 0, door: null, mood: 0, studio: null, pizza: 2000, sale: null, ...over,
});
let n = 1;
const start = (kind: EventKind, v: TownView) => [startEvent(EVENT_DEFS[kind], v, n++)!];
const step = (evs: GameEvent[], v: TownView) => stepEvents(evs, v, EVENT_DEFS);

describe("a river flood", () => {
  const at = (now: number, flooded = 0) => town(now, { river: { x: 0, y: 9 }, flooded });

  test("is warned of, strikes a minute later, and is over a minute after that", () => {
    let evs = start("river-flood", at(0));
    expect(evs[0]).toMatchObject({ kind: "river-flood", phase: "warning", strikesAt: FLOOD_WARN_MS });
    expect(evs[0].choices.map((c) => c.id)).toEqual(["sandbags", "levee", "evacuate", "brace"]);
    evs = step(evs, at(FLOOD_WARN_MS)).events;
    expect(evs[0]).toMatchObject({ phase: "active", endsAt: FLOOD_WARN_MS + FLOOD_MS });
    evs = step(evs, at(FLOOD_WARN_MS + 1000, 3)).events;
    evs = step(evs, at(FLOOD_WARN_MS + 2000, 1)).events;
    const over = step(evs, at(FLOOD_WARN_MS + FLOOD_MS));
    expect(over.events[0].phase).toBe("over");
    expect(over.events[0].outcome).toMatch(/3 buildings/);
    expect(over.ended.map((x) => x.event.id)).toEqual([evs[0].id]);
  });

  test("unanswered, it evacuates: never the worst choice", () => {
    const evs = step(start("river-flood", at(0)), at(FLOOD_WARN_MS)).events;
    expect(evs[0].chosen).toBe("evacuate");
  });

  test("a choice made is kept when it strikes", () => {
    const evs = start("river-flood", at(0)).map((e) => ({ ...e, chosen: "brace" }));
    expect(step(evs, at(FLOOD_WARN_MS)).events[0].chosen).toBe("brace");
  });

  test("sandbags take half the interns, for as long as it is coming and on", () => {
    let evs = start("river-flood", at(0)).map((e) => ({ ...e, chosen: "sandbags" }));
    expect(evs[0].choices[0].cost).toContain("6 interns off work");
    expect(eventCrew(evs, { intern: 12 })).toEqual({ intern: 6 });
    evs = step(evs, at(FLOOD_WARN_MS)).events;
    expect(eventCrew(evs, { intern: 12 })).toEqual({ intern: 6 });
  });

  test("a levee is priced from its walls, raised once when chosen, and not offered with the bank walled", () => {
    let raised = 0;
    const levee = (walls: number) => ({ walls, price: walls * 40, build: () => { raised++; } });
    const v = (now: number) => town(now, { river: { x: 0, y: 9 }, levee: levee(12) });
    let evs = start("river-flood", v(0));
    expect(evs[0].choices.find((c) => c.id === "levee")).toMatchObject({ price: 480 });
    evs = evs.map((e) => ({ ...e, chosen: "levee" }));
    const once = step(evs, v(1000));
    once.acts.forEach((a) => a());
    step(once.events, v(2000)).acts.forEach((a) => a());
    expect(raised).toBe(1);
    const walled = start("river-flood", town(0, { river: { x: 0, y: 9 }, levee: levee(0) }));
    expect(walled[0].choices.find((c) => c.id === "levee")?.unavailable).toBe("The bank is walled already");
  });

  test("is called off once the river is gone, and put away a while after it ended", () => {
    const evs = step(start("river-flood", at(0)), town(1000)).events;
    expect(evs[0]).toMatchObject({ phase: "over", outcome: "The river is gone." });
    expect(step(evs, town(1000 + OVER_SHOWN_MS + 1)).events).toEqual([]);
  });
});

describe("a convoy", () => {
  const at = (now: number, calls = 0, earned = 0, routes = 0) => town(now, { port: { x: 1, y: 1 }, convoy: { calls, earned }, routes });

  test("is warned of, comes in, and says what it earned", () => {
    let evs = start("convoy", at(0));
    expect(evs[0]).toMatchObject({ phase: "warning", strikesAt: 30_000 });
    evs = step(evs, at(30_000)).events;
    expect(evs[0]).toMatchObject({ phase: "active", endsAt: 90_000 });
    expect(step(evs, at(90_000, 7, 140)).events[0].outcome).toBe("7 calls while it was in, for $140.");
  });

  test("served with extra hands, it comes back as a regular route, up to the most there can be", () => {
    let evs = start("convoy", at(0, 0, 0, 1));
    expect(evs[0].choices[0].cost).toContain("regular route");
    evs = evs.map((e) => ({ ...e, chosen: "hands" }));
    evs = step(evs, at(30_000, 0, 0, 1)).events;
    expect(eventCrew(evs, { intern: 12 })).toEqual({ intern: 3 });
    const over = step(evs, at(90_000, 4, 50, 1));
    expect(routeWon(over.events[0], 4)).toBe(true);
    expect(over.events[0].outcome).toContain(`regular route, +${Math.round(ROUTE_BONUS * 200)}% on every call`);
    expect(over.ended[0].outcome.then).toBeDefined();
    expect(start("convoy", at(0, 0, 0, MAX_ROUTES))[0].choices[0].cost).not.toContain("regular route");
  });
});

describe("investors", () => {
  const at = (now: number, mood = 0) => town(now, { door: { x: 1, y: 1 }, mood });

  test("pay by the town's mood, and tidying up helps", () => {
    expect(tourReward(10, 0, false)).toBe(300);
    expect(tourReward(10, 0, true)).toBe(450);
    expect(tourReward(10, -40, false)).toBe(0);
    expect(tourReward(10, 40, true)).toBe(900);
  });

  test("paid less than the base thirty seconds, they leave unimpressed", () => {
    expect(tourFailed(100, 2999)).toBe(true);
    expect(tourFailed(100, 3000)).toBe(false);
    let evs = start("investor-tour", at(0, -10));
    evs = step(evs, at(45_000, -10)).events;
    const over = step(evs, at(75_000, -10));
    expect(over.events[0].outcome).toContain("the next acquirer will offer less");
    expect(over.ended[0].outcome.money).toBe(1500);
  });
});

describe("a hackathon", () => {
  const at = (now: number) => town(now, { studio: { x: 1, y: 1 } });

  test("costs its pizza, and takes every vibe coder while it is on", () => {
    let evs = start("hackathon", at(0));
    expect(evs[0].choices[0]).toMatchObject({ id: "host", price: 2000 });
    expect(evs[0].choices[0].cost).toContain("$2");
    evs = evs.map((e) => ({ ...e, chosen: "host" }));
    expect(eventCrew(evs, { vibe_coder: 20 })).toEqual({});
    evs = step(evs, at(45_000)).events;
    expect(eventCrew(evs, { vibe_coder: 20 })).toEqual({ vibe_coder: 20 });
  });

  test("nobody hosted never starts", () => {
    const evs = step(start("hackathon", at(0)), at(45_000)).events;
    expect(evs[0]).toMatchObject({ phase: "over", outcome: `No hackathon this time, and they noticed: −${HACKATHON_SNUB} vibe coder morale for a day.` });
  });
});

describe("an acquirer's offer", () => {
  const sale = (street?: string) => ({ equity: 16, withPremium: 20, street: () => street });
  const at = (now: number, street?: string) => town(now, { door: { x: 4, y: 4 }, sale: sale(street) });

  test("can come only once the company can be sold", () => {
    expect(startEvent(EVENT_DEFS.offer, town(0, { door: { x: 4, y: 4 } }), 1)).toBeNull();
  });

  test("is on the table a while, and lapses", () => {
    let evs = start("offer", at(0));
    expect(evs[0].choices.map((c) => c.id)).toEqual(["accept", "hold"]);
    expect(evs[0].choices[0].cost).toContain("+20 Equity, against 16");
    evs = step(evs, at(20_000)).events;
    expect(evs[0]).toMatchObject({ phase: "active", chosen: "hold" });
    expect(step(evs, at(140_000)).events[0].outcome).toMatch(/walked away/);
  });

  test("names the street that caught their eye", () => {
    expect(start("offer", at(0, "the street by the Studio"))[0].text).toContain("walking the street by the Studio");
    expect(start("offer", at(0))[0].text).toBe("Someone wants to buy the company. An offer is coming.");
  });

  test("is called off if the company can no longer be sold", () => {
    expect(step(start("offer", at(0)), town(1000, { door: { x: 4, y: 4 } })).events[0].phase).toBe("over");
  });
});

describe("the slop pit's overflow, from a save made before the pit went", () => {
  test("is put away on the first look", () => {
    const old = { id: 1, kind: "slop-overflow", phase: "active", title: "", text: "", where: { x: 0, y: 0 }, strikesAt: null, choices: [] } as unknown as GameEvent;
    expect(step([old], town(0)).events).toEqual([]);
  });
});
