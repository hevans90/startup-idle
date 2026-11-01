import { describe, expect, test } from "bun:test";

import type { Structure } from "../grid";
import { infoFor, type InfoContext } from "./building-info";

const ctx = (over: Partial<InfoContext> = {}): InfoContext => ({
  perHead: { intern: 2 }, arriving: new Map(), alongside: new Map(), queued: new Map(), stalled: new Set(), earning: new Map(), residents: new Map(), commutes: new Map(), coverage: new Map(), moods: new Map(),
  money: (n) => `$${n}`, ...over,
});
const at = (def: string, extra: Partial<Structure> = {}): Structure => ({ id: 7, def, x: 0, y: 0, w: 1, h: 1, ...extra });

describe("a building's label", () => {
  test("a house says who lives there, what they earn, and who is coming", () => {
    const moods = new Map([[7, { total: 4, parts: [{ why: "café", points: 4 }] }]]);
    const info = infoFor(at("kit:intern.t1", { residents: 3 }), ctx({ arriving: new Map([[7, 2]]), moods }))!;
    expect(info.title).toBe("Intern house II");
    // III at 10, and with no park its crowding counts against it: 4 − 6.
    expect(info.lines.map((l) => l.text)).toEqual(["3/5 interns living here", "Earns $6/s", "Grows at +12 more desirability", "Morale +4 · content", "2 on the way"]);
  });

  test("an empty lot is a lot, and says how many beds are free", () => {
    const info = infoFor(at("kit:vibe_coder.t0", { residents: 0 }), ctx())!;
    expect(info.title).toBe("Vibe coder lot");
    expect(info.lines.map((l) => l.text)).toEqual(["0/2 vibe coders living here", "2 beds free"]);
  });

  test("earnings are left out when nobody knows them", () => {
    const info = infoFor(at("kit:10x_dev.t0", { residents: 1 }), ctx())!;
    expect(info.lines.some((l) => l.text.startsWith("Earns"))).toBe(false);
  });

  test("a site says how far it has got, and when it is stalled", () => {
    const build = { done: 300, need: 600, delivered: 3, deliveries: 8, cost: 400, priority: 2 as const, updatedAt: 0 };
    const info = infoFor(at("studio", { w: 3, h: 2, build }), ctx({ stalled: new Set([7]) }))!;
    expect(info.lines.map((l) => l.text)).toEqual(["50% built", "Stalled"]);
  });

  test("a finished project says what it opened and where a click goes", () => {
    const info = infoFor(at("hq", { w: 3, h: 3 }), ctx())!;
    expect(info.lines.map((l) => l.text)).toEqual(["Click for Innovation"]);
  });

  test("a seaport counts its boats", () => {
    const info = infoFor(at("seaport-2", { w: 3, h: 2 }),
      ctx({ alongside: new Map([[7, 1]]), queued: new Map([[7, 2]]), earning: new Map([[7, 60]]) }))!;
    expect(info.lines.map((l) => l.text)).toEqual(["1/2 alongside · 2 waiting", "Earning $60/min"]);
  });
});

describe("mood on the labels", () => {
  test("a house says how happy it is, and what weighs on it most", () => {
    const moods = new Map([[7, { total: -12, parts: [{ why: "café", points: 4 }, { why: "long commute", points: -12 }, { why: "no services", points: -4 }] }]]);
    const info = infoFor(at("kit:intern.t1", { residents: 3 }), ctx({ moods }))!;
    expect(info.lines.map((l) => l.text)).toContain("Morale -12 · unhappy: long commute");
  });

});
