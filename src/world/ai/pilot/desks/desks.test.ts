import { afterEach, describe, expect, test } from "bun:test";

import { resetAllGameStores } from "../../../../simulation/reset-game-stores";
import { useInnovationStore } from "../../../../state/innovation.store";
import { useMoneyStore } from "../../../../state/money.store";
import { MANDATES, useValuationStore } from "../../../../state/valuation.store";
import { useWorldStore } from "../../../../state/world.store";
import { mapRiver } from "../../../boats/river";
import { EVENT_DEFS } from "../../../events/defs";
import { setTownView, startEvent, type TownView } from "../../../events/events";
import { createGrid, fillTerrain, idx, setHeight, setPaved } from "../../../grid";
import { isPaved } from "../../../roads/mask";
import { structureDef } from "../../../structures/def";
import { validatePlacement } from "../../../structures/place";
import type { Purse } from "../chooser";
import { MANAGER_SHARE, cultureDesk } from "./culture";
import { eventsDesk } from "./events";
import { roadTo } from "./harbour";
import { machineDesk } from "./machine";

afterEach(() => { resetAllGameStores(); setTownView(null); useWorldStore.getState().setEvents([]); });

const purse = (more: Partial<Purse> = {}): Purse => ({ money: 1e6, income: 100, reserve: 0, innovation: 0, innovationRate: 0, ...more });
/** Enough of the town for an earthquake to be drawn and answered. */
const view = { now: 0, income: 100, owned: {}, hq: { x: 5, y: 5 } } as unknown as TownView;

describe("the Events desk", () => {
  test("answers a card the moment it comes, free and urgent: the event's default with no scene to judge by", () => {
    const e = startEvent(EVENT_DEFS.earthquake, view, 1)!;
    useWorldStore.getState().setEvents([e]);
    const [job] = eventsDesk().propose(purse());
    expect(job).toMatchObject({ id: "event:1", urgent: true, cost: 0 });
    expect(job.says).toContain("Carry on");
    expect(job.run()).toEqual({ ok: true });
    expect(useWorldStore.getState().events[0].chosen).toBe("carry-on");
    // Answered: nothing more to do.
    expect(eventsDesk().propose(purse())).toEqual([]);
  });

  test("with the town in view, the event's own answer for AI mode", () => {
    const e = startEvent(EVENT_DEFS.earthquake, view, 2)!;
    useWorldStore.getState().setEvents([e]);
    setTownView(view);
    // Bracing is paid for: with nothing in the bank it would be the default again.
    expect(eventsDesk().propose(purse())[0].says).toContain("Carry on");
    useMoneyStore.getState().increaseMoney(1e6);
    expect(eventsDesk().propose(purse())[0].says).toContain("Brace");
  });
});

describe("the Culture desk", () => {
  const open = () => useInnovationStore.setState((s) => ({ unlocks: { ...s.unlocks, managers: { ...s.unlocks.managers, unlocked: true } } }));

  test("assigns a manager when the next costs little of the innovation in hand, and not otherwise", () => {
    open();
    useInnovationStore.getState().increaseInnovation(1000);
    const have = () => useInnovationStore.getState().innovation.toNumber();
    const job = cultureDesk().propose(purse({ innovation: have() })).find((j) => j.id.startsWith("manager:"))!;
    expect(job).toMatchObject({ costs: "innovation", cost: 1 });
    expect(job.run()).toEqual({ ok: true });
    expect(have()).toBe(999);
    // The first of each costs 1: with 10 in hand that is over the share.
    expect(1).toBeGreaterThan(10 * MANAGER_SHARE);
    expect(cultureDesk().propose(purse({ innovation: 10 })).some((j) => j.id.startsWith("manager:"))).toBe(false);
  });

  test("with the managers not open, none", () => {
    expect(cultureDesk().propose(purse({ innovation: 1e6 })).some((j) => j.id.startsWith("manager:"))).toBe(false);
  });

  test("passes a mandate the valuation in hand buys", () => {
    expect(cultureDesk().propose(purse()).some((j) => j.id.startsWith("mandate:"))).toBe(false);
    const cheapest = Math.min(...MANDATES.map((m) => useValuationStore.getState().getMandateCost(m.id).toNumber()));
    useValuationStore.getState().increaseValuation(cheapest);
    const job = cultureDesk().propose(purse()).find((j) => j.id.startsWith("mandate:"))!;
    expect(job.cost).toBe(0);
    expect(job.run()).toEqual({ ok: true });
    expect(Object.values(useValuationStore.getState().mandateLevels).reduce((a, n) => a + n, 0)).toBe(1);
  });
});

describe("the Machine desk", () => {
  test("has nothing to do before the Data Centre stands", () => {
    expect(machineDesk().propose(purse({ innovation: 1e9 }))).toEqual([]);
  });
});

describe("a road to the water's edge", () => {
  /** A river down the west edge, and one street a long way east of it. */
  function bank() {
    const g = createGrid(32, 16);
    fillTerrain(g, 1);
    for (let y = 0; y < 16; y++) for (let x = 0; x < 32; x++) { setHeight(g, x, y, x <= 3 ? -2 : 2); if (x <= 3) g.pool[idx(g, x, y)] = 4; }
    for (let y = 4; y <= 10; y++) setPaved(g, 20, y, 1);
    // Water come in at its head makes it a river. @see mapRiver
    g.inflow[idx(g, 1, 0)] = 1;
    return g;
  }

  test("is the shortest from a street to where the Harbour could stand, and makes room for it", () => {
    const g = bank(), def = structureDef("harbour")!;
    const rules = { needsRoad: true, rivers: mapRiver(g, (i) => (g.pool[i] ? 2 : 0)) };
    // Nowhere yet: nothing by the river has a road beside it.
    let any = false;
    for (let y = 0; y < g.h; y++) for (let x = 0; x < g.w; x++) any ||= validatePlacement(g, def, x, y, rules).ok;
    expect(any).toBe(false);
    const route = roadTo(g, def, rules)!;
    expect(route).not.toBeNull();
    // From beside the street, a tile at a time, to beside the site.
    expect(Math.abs(route.path[0].x - 20)).toBe(1);
    for (let i = 1; i < route.path.length; i++) expect(Math.abs(route.path[i].x - route.path[i - 1].x) + Math.abs(route.path[i].y - route.path[i - 1].y)).toBe(1);
    for (const c of route.path) { expect(isPaved(g, c.x, c.y)).toBe(false); setPaved(g, c.x, c.y, 1); }
    expect(validatePlacement(g, def, route.at.x, route.at.y, rules).ok).toBe(true);
  });

  test("none with no street to come from", () => {
    const g = bank();
    for (let y = 4; y <= 10; y++) setPaved(g, 20, y, 0);
    expect(roadTo(g, structureDef("harbour")!, { needsRoad: true, rivers: mapRiver(g, (i) => (g.pool[i] ? 2 : 0)) })).toBeNull();
  });
});
