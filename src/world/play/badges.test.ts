import { afterEach, describe, expect, test } from "bun:test";

import type { Structure } from "../grid";
import { resetCooling } from "../projects/cooling";
import { badgeFor, placeBadges, problemOf, type Badge, type BadgeContext } from "./badges";

afterEach(resetCooling);

const ctx = (over: Partial<BadgeContext> = {}): BadgeContext => ({
  perHead: {}, arriving: new Map(), alongside: new Map(), queued: new Map(), stalled: new Set(), earning: new Map(), residents: new Map(), commutes: new Map(), coverage: new Map(), moods: new Map(),
  money: (n) => `$${n}`, ...over,
});
const at = (def: string, extra: Partial<Structure> = {}): Structure => ({ id: 7, def, x: 0, y: 0, w: 1, h: 1, ...extra });
const mood = (total: number) => new Map([[7, { total, parts: [] }]]);

describe("a building's badge, at rest", () => {
  test("is worn only for a problem: a happy house wears nothing, an unhappy one its morale", () => {
    const house = at("kit:intern.t1", { residents: 3 });
    expect(problemOf(house, ctx({ moods: mood(6) }))).toBeNull();
    expect(problemOf(house, ctx({ moods: mood(-6) }))).toEqual({ icon: "mood", text: "-6", tone: "warn" });
    expect(problemOf(house, ctx({ moods: mood(-20) }))?.tone).toBe("bad");
    // Nobody home, nothing to be unhappy about.
    expect(problemOf(at("kit:intern.t1", { residents: 0 }), ctx({ moods: mood(-20) }))).toBeNull();
  });

  test("a site says when it is stalled or paused, and nothing while it goes up", () => {
    const build = { done: 300, need: 600, delivered: 3, deliveries: 8, cost: 400, priority: 2 as const, updatedAt: 0 };
    const site = at("studio", { w: 3, h: 2, build });
    expect(problemOf(site, ctx())).toBeNull();
    expect(problemOf(site, ctx({ stalled: new Set([7]) }))).toEqual({ icon: "stalled", text: "Stalled", tone: "bad" });
    expect(problemOf(at("studio", { w: 3, h: 2, build: { ...build, priority: 0 } }), ctx())?.text).toBe("Paused");
  });

  test("damage, a house cut off from work, a rack out of reach", () => {
    expect(problemOf(at("kit:intern.t1", { residents: 3 }), ctx({ repairedIn: () => 12 }))?.icon).toBe("damage");
    expect(problemOf(at("kit:intern.t1", { residents: 3 }), ctx({ commutes: new Map([[7, { tiles: null, eff: 0.25, to: null, deskless: 0 }]]) }))?.icon).toBe("road");
    expect(problemOf(at("rack"), ctx({ racksPowered: new Set() }))?.text).toBe("Half power");
    expect(problemOf(at("rack"), ctx({ racksPowered: new Set([7]) }))).toBeNull();
  });

  test("full desks only matter while some of their kind have none", () => {
    const office = at("office-intern", { w: 2, h: 2 });
    const desks = new Map([[7, { used: 40, of: 40 }]]);
    expect(problemOf(office, ctx({ desks }))).toBeNull();
    expect(problemOf(office, ctx({ desks, deskless: { intern: 5 } }))?.text).toBe("Desks full");
  });
});

describe("a building's badge, by view", () => {
  test("the Mood view gives every lived-in house its morale; the Build tool its free beds", () => {
    const house = at("kit:intern.t1", { residents: 3 });
    expect(badgeFor(house, ctx({ moods: mood(6) }), "mood")).toEqual({ icon: "mood", text: "+6", tone: "ok" });
    expect(badgeFor(house, ctx(), "build")).toEqual({ icon: "bed", text: "2 free", tone: "info" });
    // A house at rest, fine, wears nothing in the Water view either.
    expect(badgeFor(house, ctx({ moods: mood(6) }), "water")).toBeNull();
  });
});

describe("placing badges", () => {
  const b = (tone: Badge["tone"]): Badge => ({ icon: "mood", text: "-6", tone });
  test("where two would meet, the worse is kept and counts the other", () => {
    const out = placeBadges([
      { id: 1, x: 100, y: 100, band: 1, badge: b("warn") },
      { id: 2, x: 104, y: 102, band: 2, badge: b("bad") },
      { id: 3, x: 400, y: 100, band: 3, badge: b("warn") },
    ]);
    expect(out.map((p) => [p.id, p.more])).toEqual([[2, 1], [3, 0]]);
  });
  test("badges saying the same merge from further apart than different ones", () => {
    const say = (text: string): Badge => ({ icon: "mood", text, tone: "bad" });
    const out = placeBadges([
      { id: 1, x: 100, y: 100, band: 1, badge: say("-40") },
      { id: 2, x: 160, y: 120, band: 2, badge: say("-40") },
      { id: 3, x: 100, y: 130, band: 3, badge: say("-12") },
    ]);
    expect(out.map((p) => [p.id, p.more])).toEqual([[3, 0], [2, 1]]);
  });
});
