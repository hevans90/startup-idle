import { describe, expect, test } from "bun:test";

import { LORRY_GAP, LORRY_LOAD, LORRY_LOADS, NO_ROAD, YARD_A_BERTH, carryAt, createYards, landCargo, lands, stepYards, yardFill, yardSlows } from "./yard";

describe("a port's yard", () => {
  test("only the berths that land things fill it", () => {
    expect(["crane", "hardware", "gantry"].every(lands)).toBe(true);
    expect(["trade", "ferry", "pontoon"].some(lands)).toBe(false);
  });

  test("fills by what is landed, to what it holds, and slows the cranes as it does", () => {
    const y = createYards();
    expect(yardSlows(y, 1, 2)).toBe(1);
    landCargo(y, 1, 4, 2);
    expect(yardFill(y, 1, 2)).toBe(0.5);
    expect(yardSlows(y, 1, 2)).toBe(1.5);
    landCargo(y, 1, 99, 2);
    expect(y.held.get(1)).toBe(2 * YARD_A_BERTH);
    expect(yardSlows(y, 1, 2)).toBe(2);
  });

  test("a lorry a while takes it out by road, one at a time", () => {
    const y = createYards();
    landCargo(y, 1, 6, 2);
    let sent = 0, onRoad = 0;
    for (let k = 0; k < 60 * 10; k++) {
      onRoad = Math.max(0, onRoad - 0.1);
      stepYards(y, 0.1, () => { if (onRoad > 0) return "busy"; sent++; onRoad = 5; return "sent"; });
    }
    expect(sent).toBe(6 / LORRY_LOAD);
    expect(y.held.has(1)).toBe(false);
  });

  test("with no road out it still empties, a quarter as fast, and nothing is lost before then", () => {
    const y = createYards();
    landCargo(y, 1, 4, 2);
    for (let k = 0; k < LORRY_GAP * 10 * 2; k++) stepYards(y, 0.1, () => "none");
    expect(y.held.get(1)).toBeCloseTo(4 - 2 * LORRY_LOAD * NO_ROAD, 6);
    for (let k = 0; k < 2000; k++) stepYards(y, 0.1, () => "none");
    expect(y.held.has(1)).toBe(false);
  });
});

describe("the yard gantry loading a lorry", () => {
  test("fetches a box from the stack, carries it to the lorry and sets it down, all before the lorry goes", () => {
    const steps = Array.from({ length: 101 }, (_, k) => carryAt(k / 100));
    // It starts over the stack with nothing, its spreader up; and ends over the lorry with nothing, its spreader up.
    expect(steps[0]).toEqual({ over: "stack", down: 0, carried: false });
    expect(steps[100]).toEqual({ over: "lorry", down: 0, carried: false });
    // Once to the stack, then once to the lorry: never back.
    const places = steps.map((s) => s.over);
    expect(places.indexOf("lorry")).toBeGreaterThan(0);
    expect(places.slice(places.indexOf("lorry")).every((p) => p === "lorry")).toBe(true);
    // The box is picked up with the spreader right down on the stack, and let go with it right down on the lorry.
    const takes = steps.findIndex((s) => s.carried), drops = steps.findIndex((s, k) => k > takes && !s.carried);
    expect(steps[takes].over).toBe("stack");
    expect(steps[takes].down).toBe(1);
    expect(steps[drops].over).toBe("lorry");
    expect(steps[drops - 1].down).toBe(1);
    // Carried all the way between, and the spreader is up for the whole of the crossing.
    expect(steps.slice(takes, drops).every((s) => s.carried)).toBe(true);
    const crossing = steps.filter((s, k) => k / 100 >= 0.44 && k / 100 <= 0.62);
    expect(crossing.every((s) => s.down === 0 && s.carried)).toBe(true);
    // A lorry stands long enough for it to be seen.
    expect(LORRY_LOADS).toBeGreaterThan(4);
  });
});

