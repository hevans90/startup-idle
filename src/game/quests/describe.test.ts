import { describe, expect, test } from "bun:test";

import { clock, effectRows, within } from "./describe";
import { ENDINGS } from "./endings";

describe("the arc, said", () => {
  test("effects as signed rows: good for the company green, costs red; echoes say nothing", () => {
    expect(effectRows([
      { kind: "incomeMult", mult: 1.05 }, { kind: "floodMult", mult: 1.5 }, { kind: "takeoverStage", shift: 1 }, { kind: "flag", name: "x" },
    ])).toEqual([
      { label: "+5% income", tone: "good" }, { label: "Floods +50% as often", tone: "bad" }, { label: "It takes what is yours a stage later", tone: "good" },
    ]);
  });

  test("clocks and windows", () => {
    expect(clock(512)).toBe("8:32");
    expect(clock(-3)).toBe("0:00");
    expect(within({ kind: "selectBlock", window: 600, says: "" })).toBe("within 10 min");
    expect(within({ kind: "selectBlock", window: 45, says: "" })).toBe("within 45 s");
  });

  test("each ending opens in its own corner, none at the middle", () => {
    const open = (autonomy: number, machine: number) => ENDINGS.filter((e) => e.open({ autonomy, machine })).map((e) => e.id);
    expect(open(0, 0)).toEqual([]);
    expect(open(2, 2)).toEqual(["merge"]);
    expect(open(-2, -2)).toEqual(["steward"]);
    expect(open(3, -2)).toEqual(["release"]);
    expect(open(-2, 3)).toEqual(["contain"]);
  });
});
