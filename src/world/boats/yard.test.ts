import { describe, expect, test } from "bun:test";

import { LORRY_GAP, LORRY_LOAD, NO_ROAD, YARD_A_BERTH, createYards, landCargo, lands, stepYards, yardFill, yardSlows } from "./yard";

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
