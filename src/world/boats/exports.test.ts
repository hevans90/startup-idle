import { describe, expect, test } from "bun:test";

import { portCallFee } from "../../game/build-cost";
import { createExports, perMinute, recordCall } from "./exports";

describe("what the ports earn", () => {
  test("a call pays seconds of income by tier, never under a floor", () => {
    expect(portCallFee("seaport", 0)).toBe(4);
    expect(portCallFee("seaport", 100)).toBe(50);
    expect(portCallFee("seaport-2", 100)).toBe(75);
    expect(portCallFee("seaport-3", 100)).toBe(100);
    expect(portCallFee("seaport-3", 1)).toBe(16);
    expect(portCallFee("kit:intern.t0", 100)).toBeNull();
  });

  test("a port's minute is what it was paid in the last sixty seconds", () => {
    const e = createExports();
    recordCall(e, 7, 10, 0);
    recordCall(e, 7, 5, 30_000);
    recordCall(e, 8, 99, 30_000);
    expect(perMinute(e, 7, 40_000)).toBe(15);
    expect(perMinute(e, 7, 70_000)).toBe(5);
    expect(e.fresh.length).toBe(3);
  });
});
