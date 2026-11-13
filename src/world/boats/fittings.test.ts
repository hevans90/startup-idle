import { beforeEach, describe, expect, test } from "bun:test";

import { FLOW_DEFAULTS, createColumnField } from "../../fluid/columns";
import { commit, createHistory } from "../edit/commands";
import { createGrid, idx, setInflow, type Grid } from "../grid";
import { loadPriceMult } from "../events/convoy";
import { SEAPORTS } from "../structures/def";
import { placeCommand } from "../structures/place";
import { FITTINGS, fitOf, fitsTier, fitting } from "./fittings";
import { createFleet, stepFleet } from "./fleet";
import { mapRiver, poolDepthOf } from "./river";
import {
  MATERIALS_OFF, TRADE_A_CALL, TRADE_LASTS, creditTrade, ferrySpeed, hardwareMult, materialsMult, resetTrade, stepTrade, tradeLevel, yachtValuation,
} from "./trade";
import { aboard, berthsFor, callInvestor, createTraffic, fitsFor, landedBy, liftAt, portsOf, slotAt, stepTraffic, trafficSteer, workOf, type Call } from "./traffic";
import { cargoOf } from "./cargo";

function river(depth: number, w = 40): Grid {
  const g = createGrid(w, 18, 1);
  for (let y = 6; y <= 10; y++) for (let x = 0; x < w; x++) { g.pool[idx(g, x, y)] = depth; g.height[idx(g, x, y)] = -depth - 1; setInflow(g, 0, y, depth); }
  return g;
}
const fieldOf = (g: Grid) => {
  const c = createColumnField(g.w * 4, g.h * 4, { ...FLOW_DEFAULTS, wind: 0 }, 0.25);
  for (let cy = 0; cy < c.ny; cy++) for (let cx = 0; cx < c.nx; cx++) { c.depth[cy * c.nx + cx] = g.pool[idx(g, cx >> 2, cy >> 2)]; c.ground[cy * c.nx + cx] = g.height[idx(g, cx >> 2, cy >> 2)]; }
  return c;
};
const port = (g: Grid, tier: number, fit?: string[]) => {
  commit(g, createHistory(), placeCommand(g, SEAPORTS[tier - 1], 14, 4)!);
  const s = [...g.structures.values()].at(-1)!;
  if (fit) s.fit = fit;
  return s;
};
const calls = (g: Grid, seconds: number): Call[] => {
  const c = fieldOf(g), f = createFleet(), t = createTraffic(), out: Call[] = [];
  for (let k = 0; k < seconds * 30; k++) {
    stepTraffic(t, f, g, c, 1 / 30);
    stepFleet(f, c, 1 / 30, trafficSteer(t));
    out.push(...t.calls.splice(0));
  }
  return out;
};

beforeEach(resetTrade);

describe("a berth's fitting", () => {
  test("is a trading quay unless it says otherwise, and that pays the whole fee", () => {
    expect(fitOf({}, 0).id).toBe("trade");
    expect(fitOf({ fit: ["ferry"] }, 1).id).toBe("trade");
    expect(fitting("nonsense").id).toBe("trade");
    expect(fitting("trade").pay).toBe(1);
  });

  test("opens with the size of port", () => {
    const at = (berths: number) => FITTINGS.filter((f) => fitsTier(f, berths)).map((f) => f.id);
    expect(at(1)).toEqual(["trade", "ferry"]);
    expect(at(2)).toEqual(["trade", "ferry", "crane", "hardware", "slop"]);
    expect(at(3)).toHaveLength(FITTINGS.length);
  });

  test("an investor comes by yacht to a pontoon, once, and is said to have; with no pontoon nobody is sent", () => {
    const run = (fit: string[]) => {
      const g = river(2);
      port(g, 3, fit);
      const c = fieldOf(g), f = createFleet(), t = createTraffic(), out: Call[] = [];
      const step = (seconds: number) => {
        for (let k = 0; k < seconds * 30; k++) { stepTraffic(t, f, g, c, 1 / 30); stepFleet(f, c, 1 / 30, trafficSteer(t)); out.push(...t.calls.splice(0)); }
      };
      // The ports are mapped by the first steps.
      step(3);
      const sent = callInvestor(t);
      step(150);
      return { sent, out, left: t.investors };
    };
    const none = run(["trade", "trade", "trade"]);
    expect(none.sent).toBe(false);
    expect(none.out.some((c) => c.vip)).toBe(false);
    const some = run(["trade", "trade", "pontoon"]);
    expect(some.sent).toBe(true);
    expect(some.left).toBe(0);
    const vips = some.out.filter((c) => c.vip);
    expect(vips.length).toBe(1);
    expect(vips[0].fit).toBe("pontoon");
  }, 30_000);

  test("a slop loader's berth is called at by barges, of the smallest class", () => {
    const g = river(2);
    port(g, 2, ["trade", "slop"]);
    const made = calls(g, 150);
    const barges = made.filter((c) => c.fit === "slop");
    expect(barges.length).toBeGreaterThan(0);
    expect(barges.every((c) => c.cls === 0)).toBe(true);
  }, 30_000);

  test("a port never fitted out is called at as it always was", () => {
    const g = river(2);
    port(g, 2);
    const made = calls(g, 120);
    expect(made.length).toBeGreaterThan(2);
    expect(made.every((c) => c.fit === "trade" && c.cls === 0)).toBe(true);
  });

  test("ships come for the berths a port has, each kind in turn", () => {
    const g = river(4);
    port(g, 2, ["ferry", "crane"]);
    const made = calls(g, 200);
    expect(new Set(made.map((c) => c.fit))).toEqual(new Set(["ferry", "crane"]));
    // A ferry is a boat; the crane takes coasters too.
    expect(made.filter((c) => c.fit === "ferry").every((c) => c.cls === 0 && c.berth === 0)).toBe(true);
    expect(made.filter((c) => c.fit === "crane").every((c) => c.berth === 1)).toBe(true);
    expect(made.some((c) => c.fit === "crane" && c.cls === 1)).toBe(true);
  });

  test("a gantry is for ships: on water too shallow for them it takes nothing", () => {
    const deep = river(6), shallow = river(2);
    const a = port(deep, 3, ["trade", "gantry", "trade"]);
    const p = portsOf(deep, mapRiver(deep, poolDepthOf(deep))).get(a.id)!;
    // A ship comes for the gantry, lying across a quay beside it — not for a quay, across the gantry.
    expect(fitsFor(p, 2)).toEqual(["gantry"]);
    expect(berthsFor(p, 2, "gantry")).toEqual([0, 1]);
    expect(berthsFor(p, 2, "trade")).toEqual([]);
    expect(berthsFor(p, 0, "gantry")).toEqual([]);
    expect(berthsFor(p, 0)).toEqual([0, 2]);
    const b = port(shallow, 3, ["gantry", "gantry", "gantry"]);
    const q = portsOf(shallow, mapRiver(shallow, poolDepthOf(shallow))).get(b.id)!;
    expect(q.accepts).toEqual([false, false, false]);
    expect(calls(shallow, 60)).toEqual([]);
  });
});

describe("a ship's cargo, worked by the cranes a box at a time", () => {
  test("a call's work is settled by its length: so many lifts, and at a crane berth every one lands a box", () => {
    const w = workOf("lighter", "crane", 1, 20)!;
    expect(w).toMatchObject({ cap: 4, cranes: 1, lifts: 4, unload: 4, reload: false });
    expect(aboard(w, 0)).toBe(4);
    // One fewer as each lift picks one up; ashore as each is set down.
    expect(aboard(w, 0.02)).toBe(4);
    expect(aboard(w, 0.05)).toBe(3);
    expect(landedBy(w, 0.05)).toBe(0);
    expect(landedBy(w, 0.2)).toBe(1);
    expect(aboard(w, 1)).toBe(0);
    expect(landedBy(w, 1)).toBe(4);
    // The top box first.
    expect(slotAt(w, 0, "unload")).toBe(3);
    expect(slotAt(w, 3, "unload")).toBe(0);
  });

  test("at a gantry two cranes take boxes off and put as many back, so she sails as full as she came", () => {
    const w = workOf("container", "gantry", 2, 30)!;
    expect(w).toMatchObject({ cap: 12, cranes: 2, lifts: 8, unload: 4, reload: true });
    expect(aboard(w, 0.49)).toBe(4);
    expect(liftAt(w, 0.3).mode).toBe("unload");
    expect(liftAt(w, 0.7).mode).toBe("load");
    expect(aboard(w, 1)).toBe(12);
    // The second crane's box is the one before the first's, coming off; and the one after, going on.
    expect(slotAt(w, 0, "unload")).toBe(11);
    expect(slotAt(w, 4, "load")).toBe(4);
  });

  test("a ferry and a yacht have none to work, nor has a look with no slots", () => {
    expect(workOf("ferry", "ferry", 1, 20)).toBeNull();
    expect(workOf("dinghy", "trade", 1, 20)).toBeNull();
    expect(cargoOf("coaster")!.slots).toHaveLength(12);
  });
});

describe("what the trade does", () => {
  test("a call pushes its meter up, and it runs down by itself", () => {
    creditTrade("materials");
    expect(tradeLevel("materials")).toBeCloseTo(TRADE_A_CALL, 6);
    for (let k = 0; k < 20; k++) creditTrade("materials", 2);
    expect(tradeLevel("materials")).toBe(1);
    stepTrade(TRADE_LASTS / 2);
    expect(tradeLevel("materials")).toBeCloseTo(0.5, 6);
    stepTrade(TRADE_LASTS);
    expect(tradeLevel("materials")).toBe(0);
  });

  test("with no trade nothing is changed; at full, each does what it says", () => {
    expect([materialsMult(), hardwareMult(), ferrySpeed(), yachtValuation()]).toEqual([1, 1, 1, 1]);
    const loads = loadPriceMult();
    for (const k of ["materials", "hardware", "ferries", "yachts"] as const) for (let n = 0; n < 20; n++) creditTrade(k);
    expect(materialsMult()).toBeCloseTo(1 - MATERIALS_OFF, 6);
    expect(loadPriceMult()).toBeCloseTo(loads * (1 - MATERIALS_OFF), 6);
    expect(hardwareMult()).toBeLessThan(1);
    expect(ferrySpeed()).toBe(2);
    expect(yachtValuation()).toBeGreaterThan(1);
  });
});
