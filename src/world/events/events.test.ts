import { describe, expect, test } from "bun:test";

import { EVENT_DEFS } from "./defs";
import { CONVOY_MS, MAX_ROUTES, ROUTE_BONUS, routeWon } from "./defs/convoy";
import { FLOOD_MS, FLOOD_WARN_MS } from "./defs/flood";
import { HACKATHON_MS, HACKATHON_SLOP, HACKATHON_SNUB } from "./defs/hackathon";
import { DILIGENCE_MULT, TIDY_MOOD } from "./defs/diligence";
import { DROUGHT_MS, RATION_MORALE, TRUCK_SECONDS } from "./defs/drought";
import { HEAT_MS, PUMP_SECONDS } from "./defs/heatwave";
import { CLEAN_MOOD, CLOSED_SECONDS, FINE_SECONDS } from "./defs/inspector";
import { STRIKE_PAY } from "./defs/strike";
import { OVERTIME_MS, OVERTIME_SECONDS, WORKS_MS } from "./defs/road-works";
import { COUNTER_VALUE } from "./defs/poaching";
import { VIRAL_MORALE, VIRAL_MS } from "./defs/viral";
import { FREEZE_WORK, IGNORE_WORK } from "./defs/tenants";
import { INCIDENT_METER, RUN_SECONDS } from "./defs/agents";
import { INSPECT_WARN_MS, REINSPECT_MS } from "./defs/inspector";
import type { HackathonGain } from "../../game/culture";
import { CREW_SHARE, OVER_SHOWN_MS, answerFor, eventCrew, startEvent, stepEvents, type EventKind, type GameEvent, type TownView } from "./events";

const town = (now: number, over: Partial<TownView> = {}): TownView => ({
  now, income: 100, owned: { intern: 12, vibe_coder: 20 }, river: null, flooded: 0, overheated: 0, levee: null, evacuated: [], port: null,
  drinkers: null, offices: null, site: null, junction: null, poach: null, viral: null, unhappy: null, datacentre: null,
  convoy: { calls: 0, earned: 0 }, routes: 0, door: null, studio: null, sale: null,
  diligence: { mood: 0, spills: 0, watered: null, mop: () => {} }, ...over,
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
    expect(evs[0]).toMatchObject({ phase: "active", endsAt: 30_000 + CONVOY_MS });
    expect(step(evs, at(30_000 + CONVOY_MS, 7, 140)).events[0].outcome).toBe("7 calls while it was in, for $140.");
  });

  test("served with extra hands, it comes back as a regular route, up to the most there can be", () => {
    let evs = start("convoy", at(0, 0, 0, 1));
    expect(evs[0].choices[0].cost).toContain("regular route");
    evs = evs.map((e) => ({ ...e, chosen: "hands" }));
    evs = step(evs, at(30_000, 0, 0, 1)).events;
    expect(eventCrew(evs, { intern: 12 })).toEqual({ intern: Math.floor(12 * CREW_SHARE.hands) });
    const over = step(evs, at(30_000 + CONVOY_MS, 4, 50, 1));
    expect(routeWon(over.events[0], 4)).toBe(true);
    expect(over.events[0].outcome).toContain(`regular route, +${Math.round(ROUTE_BONUS * 200)}% on every call`);
    expect(over.ended[0].outcome.then).toBeDefined();
    expect(start("convoy", at(0, 0, 0, MAX_ROUTES))[0].choices[0].cost).not.toContain("regular route");
  });
});

describe("due diligence", () => {
  const at = (now: number, d: Partial<TownView["diligence"]> = {}) =>
    town(now, { door: { x: 1, y: 1 }, diligence: { mood: 0, spills: 0, watered: null, mop: () => {}, ...d } });
  const run = (d: Partial<TownView["diligence"]>, chosen?: string) => {
    let evs = start("diligence", at(0, d));
    if (chosen) evs = evs.map((e) => ({ ...e, chosen }));
    evs = step(evs, at(45_000, d)).events;
    return step(evs, at(75_000, d)).ended[0];
  };

  test("values the company by how many of its three checks pass", () => {
    const all = run({ mood: 20, spills: 0, watered: 1 });
    expect(all.outcome.text).toMatch(new RegExp(`^Homes pass, spills pass, water pass: the company is valued ×${DILIGENCE_MULT[3].toFixed(2)}`));
    expect(all.outcome.text).toContain("ask 1 less");
    const none = run({ mood: -20, spills: 3, watered: 0.2 });
    expect(none.outcome.text).toContain(`×${DILIGENCE_MULT[0].toFixed(2)}`);
    expect(none.outcome.text).not.toContain("ask");
    // Nothing that drinks, nothing to fail.
    expect(run({ mood: 20, spills: 2, watered: null }).outcome.text).toContain("water pass");
  });

  test("tidying lifts the homes' reading; mopping is offered only with a spill, and done once chosen", () => {
    expect(run({ mood: 6 - TIDY_MOOD }).outcome.text).toMatch(/^Homes fail/);
    expect(run({ mood: 6 - TIDY_MOOD }, "tidy").outcome.text).toMatch(/^Homes pass/);
    expect(start("diligence", at(0))[0].choices.find((c) => c.id === "mop")?.unavailable).toBe("Nothing has spilled");
    // With nobody to send, tidying is no free lift.
    const nobody = start("diligence", { ...at(0), owned: { intern: 12 } })[0].choices.find((c) => c.id === "tidy");
    expect(nobody?.unavailable).toBe("Nobody to send");
    let mopped = 0;
    const evs = start("diligence", at(0, { spills: 2 })).map((e) => ({ ...e, chosen: "mop" }));
    step(evs, at(1000, { spills: 2, mop: () => { mopped++; } })).acts.forEach((a) => a());
    expect(mopped).toBe(1);
  });

  test("shown as it is, the card says what they would find", () => {
    expect(start("diligence", at(0, { mood: 20, spills: 1 }))[0].choices.find((c) => c.id === "as-is")?.cost)
      .toBe("they would find: homes pass, spills fail, water pass");
  });
});

describe("a hackathon", () => {
  let spiked = 0, dealt: HackathonGain = { kind: "offer" };
  const at = (now: number) => town(now, { studio: { x: 1, y: 1, spike: (k) => { spiked += k; }, ideas: () => dealt } });

  test("costs no money, and takes every vibe coder while it is on", () => {
    let evs = start("hackathon", at(0));
    expect(evs[0].choices[0].price).toBeUndefined();
    evs = evs.map((e) => ({ ...e, chosen: "host" }));
    expect(eventCrew(evs, { vibe_coder: 20 })).toEqual({});
    evs = step(evs, at(45_000)).events;
    expect(evs[0].endsAt).toBe(45_000 + HACKATHON_MS);
    expect(eventCrew(evs, { vibe_coder: 20 })).toEqual({ vibe_coder: 20 });
  });

  test("hosted, it fills the studio's tank and comes back with a card offer, or a rank once the cards are dealt", () => {
    spiked = 0;
    const run = () => {
      const evs = step(start("hackathon", at(0)).map((e) => ({ ...e, chosen: "host" })), at(45_000)).events;
      return step(evs, at(45_000 + HACKATHON_MS)).ended[0];
    };
    dealt = { kind: "offer" };
    expect(run().outcome.text).toMatch(/culture card offer/);
    expect(spiked).toBe(HACKATHON_SLOP);
    dealt = { kind: "rank", card: "crunch" };
    expect(run().outcome.text).toMatch(/Crunch.* is a rank up/);
    dealt = null;
    const locked = run();
    expect(locked.outcome.text).toMatch(/happier/);
    expect(locked.outcome.then).toBeDefined();
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

describe("a heatwave", () => {
  const at = (now: number, overheated = 0) => town(now, { drinkers: { x: 3, y: 3, dig: null }, overheated });

  test("comes only where something drinks, and costs a minute of income for pumps", () => {
    expect(startEvent(EVENT_DEFS.heatwave, town(0), 1)).toBeNull();
    const evs = start("heatwave", at(0));
    expect(evs[0].choices.map((c) => c.id)).toEqual(["pumps", "throttle", "ride"]);
    expect(evs[0].choices[0].price).toBe(100 * PUMP_SECONDS);
  });

  test("unanswered, the agents are throttled; ridden out, it counts what overheated", () => {
    expect(step(start("heatwave", at(0)), at(45_000)).events[0].chosen).toBe("throttle");
    let evs = step(start("heatwave", at(0)).map((e) => ({ ...e, chosen: "ride" })), at(45_000)).events;
    evs = step(evs, at(50_000, 2)).events;
    expect(step(evs, at(45_000 + HEAT_MS, 0)).events[0].outcome).toMatch(/^2 overheated/);
  });
});

describe("a drought", () => {
  const at = (now: number, dig: (() => void) | null = null) => town(now, { river: { x: 0, y: 5 }, drinkers: { x: 3, y: 3, dig } });

  test("needs a river and something drinking", () => {
    expect(startEvent(EVENT_DEFS.drought, town(0, { river: { x: 0, y: 5 } }), 1)).toBeNull();
    expect(start("drought", at(0))[0].where).toEqual({ x: 0, y: 5 });
  });

  test("a reservoir is dug once chosen, and offered only where one would go", () => {
    expect(start("drought", at(0))[0].choices[0].unavailable).toBe("Nowhere level to dig");
    let dug = 0;
    const evs = start("drought", at(0, () => { dug++; })).map((e) => ({ ...e, chosen: "dig" }));
    step(evs, at(1000, () => { dug++; })).acts.forEach((a) => a());
    expect(dug).toBe(1);
  });

  test("trucking is paid a minute at a time; unanswered, the homes are rationed", () => {
    expect(start("drought", at(0))[0].choices[2].price).toBe(100 * TRUCK_SECONDS * (DROUGHT_MS / 60_000));
    let evs = step(start("drought", at(0)), at(60_000)).events;
    expect(evs[0].chosen).toBe("ration");
    const over = step(evs, at(60_000 + DROUGHT_MS));
    expect(over.events[0].outcome).toContain(`−${RATION_MORALE} morale`);
    expect(over.ended[0].outcome.then).toBeDefined();
  });
});

describe("the health inspector", () => {
  let closed: [number, number] | null = null;
  const office = (dirty: boolean) => ({ x: 2, y: 2, id: 9, dirty, close: (id: number, s: number) => { closed = [id, s]; } });
  const at = (now: number, dirty: boolean, spills = 0) => town(now, { offices: office(dirty), diligence: { mood: 0, spills, watered: null, mop: () => {} } });
  const run = (chosen: string | undefined, dirty: boolean) => {
    let evs = start("inspector", at(0, true));
    if (chosen) evs = evs.map((e) => ({ ...e, chosen }));
    evs = step(evs, at(INSPECT_WARN_MS, dirty)).events;
    return step(evs, at(INSPECT_WARN_MS + 5_000, dirty)).ended[0];
  };

  test("is drawn only once an office has spilled", () => {
    expect(EVENT_DEFS.inspector.weight!(at(0, false))).toBe(0);
    expect(EVENT_DEFS.inspector.weight!(at(0, true))).toBe(1);
    expect(start("inspector", at(0, true))[0].choices.find((c) => c.id === "fine")?.price).toBe(100 * FINE_SECONDS);
  });

  test("found clean, a clean record; dirty and unanswered, the worst office closed", () => {
    expect(run("sprint", false).outcome.text).toContain(`+${CLEAN_MOOD} morale`);
    closed = null;
    const shut = run(undefined, true);
    expect(shut.event.chosen).toBe("close");
    shut.outcome.then?.();
    expect(closed).toEqual([9, CLOSED_SECONDS]);
    expect(run("fine", true).outcome.then).toBeUndefined();
  });
});

describe("the health inspector, come back", () => {
  const office = (dirty: boolean) => ({ x: 2, y: 2, id: 9, dirty, close: () => {} });
  const at = (now: number) => town(now, { offices: office(true) });
  const run = (chained: boolean) => {
    const evs = step(start("inspector", at(0)).map((e) => ({ ...e, chained })), at(INSPECT_WARN_MS)).events;
    return step(evs, at(INSPECT_WARN_MS + 5_000)).ended[0].outcome;
  };

  test("an office closed the first time brings them back; the second time, a fine as well", () => {
    expect(run(false).next).toEqual({ kind: "inspector", inMs: REINSPECT_MS });
    const again = run(true);
    expect(again.next).toBeUndefined();
    expect(again.text).toContain("fined");
  });
});

describe("the AI, in AI mode", () => {
  test("answers with its pick when it can take and pay for it, and the default when not", () => {
    const v = town(0, { drinkers: { x: 3, y: 3, dig: null } });
    const e = start("heatwave", v)[0];
    expect(answerFor(EVENT_DEFS.heatwave, e, v, 1e9)).toBe("pumps");
    expect(answerFor(EVENT_DEFS.heatwave, e, v, 10)).toBe("throttle");
    const d = start("diligence", town(0, { door: { x: 1, y: 1 } }))[0];
    expect(answerFor(EVENT_DEFS.diligence, d, town(0), 1e9)).toBe("as-is");
  });
});

describe("road works", () => {
  const at = (now: number) => town(now, { junction: { x: 4, y: 6 } });

  test("close the busiest junction for five minutes, or one with overtime", () => {
    expect(startEvent(EVENT_DEFS["road-works"], town(0), 1)).toBeNull();
    const evs = start("road-works", at(0));
    expect(evs[0].where).toEqual({ x: 4, y: 6 });
    expect(evs[0].choices[0].price).toBe(100 * OVERTIME_SECONDS);
    expect(step(evs, at(45_000)).events[0]).toMatchObject({ chosen: "put-up", endsAt: 45_000 + WORKS_MS });
    expect(step(evs.map((e) => ({ ...e, chosen: "overtime" })), at(45_000)).events[0].endsAt).toBe(45_000 + OVERTIME_MS);
  });
});

describe("poaching", () => {
  let lost = 0;
  const poach = (score: number) => ({ x: 1, y: 1, n: 3, score, price: 900, lose: () => { lost++; } });
  const at = (now: number, score = 0) => town(now, { poach: poach(score) });
  const run = (chosen?: string) => {
    let evs = start("poaching", at(0));
    if (chosen) evs = evs.map((e) => ({ ...e, chosen }));
    evs = step(evs, at(45_000)).events;
    return step(evs, at(46_000)).ended[0];
  };

  test("is likelier the unhappier the 10x devs, and matching it costs", () => {
    expect(EVENT_DEFS.poaching.weight!(at(0, -40))).toBeGreaterThan(EVENT_DEFS.poaching.weight!(at(0, 20)));
    expect(start("poaching", at(0))[0].choices[0].price).toBe(900);
  });

  test("unanswered, they go; counter-poached, as many come and the valuation dips", () => {
    lost = 0;
    const gone = run();
    expect(gone.outcome.text).toBe("3 10x devs left for the rival.");
    gone.outcome.then?.();
    expect(lost).toBe(1);
    expect(run("counter").outcome.text).toContain(`×${COUNTER_VALUE}`);
    expect(run("match").outcome.then).toBeUndefined();
  });
});

describe("a viral post", () => {
  const at = (now: number) => town(now, { door: { x: 1, y: 1 }, viral: { card: "crunch", name: "Crunch Week", slotted: 2 } });

  test("names the card, weighs by what is slotted, and is banked unanswered", () => {
    const evs = start("viral", at(0));
    expect(evs[0].text).toContain("Crunch Week");
    expect(EVENT_DEFS.viral.weight!(at(0))).toBe(2);
    expect(evs[0].choices[0].cost).toContain(`Output ×2 while it is light for ${VIRAL_MS / 60_000} minutes`);
    const banked = step(evs, at(20_000));
    expect(banked.events[0]).toMatchObject({ phase: "over", chosen: "bank" });
    expect(banked.ended[0].outcome.then).toBeDefined();
  });

  test("leant into, it runs, and everyone is tired after", () => {
    let evs = step(start("viral", at(0)).map((e) => ({ ...e, chosen: "lean" })), at(20_000)).events;
    expect(evs[0].phase).toBe("active");
    evs = step(evs, at(20_000 + VIRAL_MS)).events;
    expect(evs[0].outcome).toContain(`−${VIRAL_MORALE} morale`);
  });
});

describe("a tenants' strike", () => {
  const at = (now: number, gift = true) => town(now, { unhappy: { x: 3, y: 3, homes: [5, 6, 7], who: "intern", gift: () => gift } });

  test("on a street of unhappy homes, ignored unanswered", () => {
    expect(startEvent(EVENT_DEFS.tenants, town(0), 1)).toBeNull();
    const evs = start("tenants", at(0));
    expect(evs[0].text).toContain("3 unhappy homes");
    expect(evs[0].choices.find((c) => c.id === "freeze")?.cost).toContain(`×${FREEZE_WORK}`);
    expect(evs[0].choices.find((c) => c.id === "ignore")?.cost).toContain(`×${IGNORE_WORK}`);
    const over = step(step(evs, at(45_000)).events, at(46_000));
    expect(over.events[0]).toMatchObject({ chosen: "ignore" });
  });
});

describe("an agent incident", () => {
  const at = (now: number, policy = true) => town(now, { datacentre: { x: 2, y: 2, policy } });

  test("comes once agents run; let run, it pays; made policy only with AI cards left", () => {
    expect(startEvent(EVENT_DEFS.agents, town(0), 1)).toBeNull();
    const evs = start("agents", at(0));
    expect(evs[0].choices.find((c) => c.id === "run")?.cost).toContain(`the meter +${INCIDENT_METER}`);
    expect(start("agents", at(0, false))[0].choices.find((c) => c.id === "policy")?.unavailable).toBe("No AI cards to deal");
    const over = step(step(evs, at(30_000)).events, at(31_000)).ended[0];
    expect(over.event.chosen).toBe("run");
    expect(over.outcome.money).toBe(100 * RUN_SECONDS);
  });
});

describe("a supplier strike", () => {
  const at = (now: number) => town(now, { site: { x: 5, y: 5, left: 1000 } });

  test("comes while a site waits on loads; paying the strikers ends it before it starts", () => {
    expect(startEvent(EVENT_DEFS.strike, town(0), 1)).toBeNull();
    const evs = start("strike", at(0));
    expect(evs[0].choices[0].price).toBe(1000 * STRIKE_PAY);
    expect(step(evs.map((e) => ({ ...e, chosen: "pay" })), at(30_000)).events[0].phase).toBe("over");
    expect(step(evs, at(30_000)).events[0]).toMatchObject({ phase: "active", chosen: "edge" });
  });

  test("is called off once the site has its loads", () => {
    expect(step(start("strike", at(0)), town(1000)).events[0].outcome).toBe("The site is supplied.");
  });
});

describe("the slop pit's overflow, from a save made before the pit went", () => {
  test("is put away on the first look", () => {
    const old = { id: 1, kind: "slop-overflow", phase: "active", title: "", text: "", where: { x: 0, y: 0 }, strikesAt: null, choices: [] } as unknown as GameEvent;
    expect(step([old], town(0)).events).toEqual([]);
  });
});
