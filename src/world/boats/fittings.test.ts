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
import { berthsFor, cargoAt, createTraffic, fitsFor, liftAt, portsOf, stepTraffic, trafficSteer, type Call } from "./traffic";

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
    expect(at(2)).toEqual(["trade", "ferry", "crane", "hardware"]);
    expect(at(3)).toHaveLength(FITTINGS.length);
  });

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
    expect(fitsFor(p, 2)).toEqual(["trade", "gantry"]);
    expect(berthsFor(p, 0, "gantry")).toEqual([]);
    expect(berthsFor(p, 0)).toEqual([0, 2]);
    const b = port(shallow, 3, ["gantry", "gantry", "gantry"]);
    const q = portsOf(shallow, mapRiver(shallow, poolDepthOf(shallow))).get(b.id)!;
    expect(q.accepts).toEqual([false, false, false]);
    expect(calls(shallow, 60)).toEqual([]);
  });
});

describe("a ship's cargo, worked by the cranes", () => {
  test("a crane berth empties her a third a lift, as each lift picks it up", () => {
    expect(cargoAt("crane", 0)).toBe(1);
    expect(cargoAt("crane", 0.04)).toBe(1);
    expect(cargoAt("crane", 0.1)).toBeCloseTo(2 / 3, 6);
    expect(cargoAt("crane", 0.5)).toBeCloseTo(1 / 3, 6);
    expect(cargoAt("crane", 0.9)).toBe(0);
    expect(cargoAt("crane", 1)).toBe(0);
    expect(liftAt("crane", 0.5)).toMatchObject({ n: 1, loading: false });
  });

  test("a trading quay and a gantry take most off and put it back, so she sails full", () => {
    for (const fit of ["trade", "gantry"]) {
      expect(cargoAt(fit, 0)).toBe(1);
      expect(cargoAt(fit, 0.45)).toBeCloseTo(1 / 3, 6);
      expect(liftAt(fit, 0.45).loading).toBe(false);
      expect(liftAt(fit, 0.55).loading).toBe(true);
      // Back aboard as each lift sets it down.
      expect(cargoAt(fit, 0.55)).toBeCloseTo(1 / 3, 6);
      expect(cargoAt(fit, 0.72)).toBeCloseTo(2 / 3, 6);
      expect(cargoAt(fit, 1)).toBe(1);
    }
  });

  test("a ferry and a yacht have none to work", () => {
    expect([cargoAt("ferry", 0.5), cargoAt("pontoon", 0.5)]).toEqual([1, 1]);
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
