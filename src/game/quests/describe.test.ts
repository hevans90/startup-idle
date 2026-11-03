import { describe, expect, test } from "bun:test";

import { clock, effectRows, within } from "./describe";
import { BOOK1_TALK } from "./book1-talk";
import { CONTAIN, ENDINGS } from "./endings";

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

  test("book 1's endings are its talk's, each saying what it leaves; Contain apart, the shutdown branch's", () => {
    expect(ENDINGS.map((e) => e.id)).toEqual(BOOK1_TALK.endings.map((e) => e.id));
    for (const e of ENDINGS) expect(e.does.length).toBeGreaterThan(20);
    expect(ENDINGS.some((e) => e.id === "contain")).toBe(false);
    expect(CONTAIN.id).toBe("contain");
  });
});
