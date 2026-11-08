import { describe, expect, test } from "bun:test";

import { createGrid } from "../grid";
import { FIRE_REPAIR_SECONDS, burn, damage, damageCause, firstOverheated, repairedIn, stepRepairs } from "./damage";
import { EVENT_DEFS } from "./defs";
import { BRIGADE_OUT_MS, FIRE_AFTER_MS, FIRE_MS, FIRE_WARN_MS, HOSE_OUT_MS } from "./defs/fire";
import { HEAT_MS } from "./defs/heatwave";
import { startEvent, stepEvents, type GameEvent, type TownView } from "./events";
import { spreadTargets } from "./fire-spread";

const town = (now: number, over: Partial<TownView> = {}): TownView => ({
  now, income: 100, owned: {}, river: null, flooded: 0, overheated: 0, smoking: null, levee: null, evacuated: [], port: null,
  drinkers: null, offices: null, site: null, junction: null, joint: null, manhole: null, district: null, hq: null, poach: null, viral: null, unhappy: null, datacentre: null,
  convoy: { calls: 0, earned: 0 }, routes: 0, door: null, studio: null, sale: null,
  diligence: { mood: 0, spills: 0, watered: null, mop: () => {} }, ...over,
});
const smoking = (hydrant: boolean, calls: string[] = []) => ({
  x: 3, y: 3, id: 7, hydrant, spread: 1, hose: () => { calls.push("hose"); }, burnOut: () => { calls.push("burnOut"); },
});
const step = (evs: GameEvent[], v: TownView) => stepEvents(evs, v, EVENT_DEFS);

describe("a fire", () => {
  test("follows a heatwave ridden out that overheated anything, and only that", () => {
    const hot = { id: 1, kind: "heatwave", chosen: "ride", hit: 2 } as GameEvent;
    expect(EVENT_DEFS.heatwave.outcome(hot, town(HEAT_MS)).next).toEqual({ kind: "fire", inMs: FIRE_AFTER_MS });
    expect(EVENT_DEFS.heatwave.outcome({ ...hot, hit: 0 }, town(HEAT_MS)).next).toBeUndefined();
    expect(EVENT_DEFS.heatwave.outcome({ ...hot, chosen: "pumps" }, town(HEAT_MS)).next).toBeUndefined();
  });

  test("is never drawn by the director, and cannot come with nothing smoking", () => {
    expect(EVENT_DEFS.fire.followUp).toBe(true);
    expect(startEvent(EVENT_DEFS.fire, town(0), 1)).toBeNull();
  });

  test("the hydrants only where the mains reach it", () => {
    const off = startEvent(EVENT_DEFS.fire, town(0, { smoking: smoking(false) }), 1)!;
    expect(off.choices.find((c) => c.id === "hose")?.unavailable).toBe("No mains reach it");
    const on = startEvent(EVENT_DEFS.fire, town(0, { smoking: smoking(true) }), 1)!;
    expect(on.choices.find((c) => c.id === "hose")?.unavailable).toBeUndefined();
    expect(on.choices.find((c) => c.id === "brigade")?.price).toBeGreaterThan(0);
  });

  test("hosed, the mains go on it and it is out sooner; the brigade sooner still", () => {
    const calls: string[] = [];
    const v = (now: number) => town(now, { smoking: smoking(true, calls) });
    let evs = [{ ...startEvent(EVENT_DEFS.fire, v(0), 1)!, chosen: "hose" }];
    const struck = step(evs, v(FIRE_WARN_MS));
    for (const act of struck.acts) act();
    expect(calls).toEqual(["hose"]);
    expect(struck.events[0]).toMatchObject({ phase: "active", endsAt: FIRE_WARN_MS + HOSE_OUT_MS });
    evs = [{ ...startEvent(EVENT_DEFS.fire, v(0), 2)!, chosen: "brigade" }];
    expect(step(evs, v(FIRE_WARN_MS)).events[0].endsAt).toBe(FIRE_WARN_MS + BRIGADE_OUT_MS);
  });

  test("unanswered it burns, the whole time, and is burnt out after", () => {
    const calls: string[] = [];
    const v = (now: number) => town(now, { smoking: smoking(true, calls) });
    let evs = step([startEvent(EVENT_DEFS.fire, v(0), 1)!], v(FIRE_WARN_MS)).events;
    expect(evs[0]).toMatchObject({ chosen: "burn", endsAt: FIRE_WARN_MS + FIRE_MS });
    const over = step(evs, v(FIRE_WARN_MS + FIRE_MS));
    expect(over.events[0].outcome).toMatch(/1 next to it/);
    over.ended[0].outcome.then?.();
    expect(calls).toEqual(["burnOut"]);
  });

  test("called off when the crew gets to it first", () => {
    const evs = [startEvent(EVENT_DEFS.fire, town(0, { smoking: smoking(true) }), 1)!];
    expect(step(evs, town(1000)).events[0]).toMatchObject({ phase: "over", outcome: "The crew cooled it in time." });
  });
});

describe("burnt out", () => {
  test("starts at the first overheated in the queue, and is the crew's longest job", () => {
    const g = createGrid(10, 10);
    for (const id of [1, 2, 3]) g.structures.set(id, { id, def: "rack", x: id * 2, y: 1, w: 1, h: 1 });
    damage(g, [1], "flood");
    damage(g, [2, 3], "heat");
    expect(firstOverheated(g)).toBe(2);
    burn(g, [2]);
    expect(damageCause(2)).toBe("fire");
    expect(firstOverheated(g)).toBe(3);
    // Keeps its place: after the flood's, before the other overheated.
    stepRepairs(g, 180, false);
    expect(repairedIn(2)).toBe(FIRE_REPAIR_SECONDS);
  });
});

describe("a fire let burn spreads", () => {
  const g = createGrid(12, 12);
  g.structures.set(1, { id: 1, def: "rack", x: 5, y: 5, w: 1, h: 1 });
  g.structures.set(2, { id: 2, def: "kit:intern.t0", x: 6, y: 5, w: 1, h: 1 });
  g.structures.set(3, { id: 3, def: "kit:intern.t0", x: 5, y: 7, w: 1, h: 1 });
  g.structures.set(4, { id: 4, def: "rack", x: 4, y: 4, w: 1, h: 1 });
  g.structures.set(5, { id: 5, def: "kit:intern.t0", x: 9, y: 9, w: 1, h: 1 });

  test("to what is next to it without water, the nearest first, as many as it may", () => {
    expect(spreadTargets(g, 1, () => false, 2)).toEqual([2, 4]);
    expect(spreadTargets(g, 1, () => false, 5)).toEqual([2, 4, 3]);
  });

  test("never to a building watered, nor one further off", () => {
    expect(spreadTargets(g, 1, (id) => id === 4, 5)).toEqual([2, 3]);
    expect(spreadTargets(g, 1, () => false, 5)).not.toContain(5);
  });
});
