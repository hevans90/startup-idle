import { describe, expect, test } from "bun:test";

import type { Structure } from "../grid";
import { infoFor, type InfoContext } from "./building-info";

const ctx = (over: Partial<InfoContext> = {}): InfoContext => ({
  perHead: { intern: 2 }, arriving: new Map(), alongside: new Map(), queued: new Map(), stalled: new Set(),
  money: (n) => `$${n}`, ...over,
});
const at = (def: string, extra: Partial<Structure> = {}): Structure => ({ id: 7, def, x: 0, y: 0, w: 1, h: 1, ...extra });

describe("a building's label", () => {
  test("a house says who lives there, what they earn, and who is coming", () => {
    const info = infoFor(at("kit:intern.t1", { residents: 3 }), ctx({ arriving: new Map([[7, 2]]) }))!;
    expect(info.title).toBe("Intern house II");
    expect(info.headline).toBe("3/5 · +2");
    expect(info.lines.map((l) => l.text)).toEqual(["3/5 interns living here", "Earns $6/s", "2 on the way"]);
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
    expect(info.headline).toBe("50%");
    expect(info.lines.map((l) => l.text)).toContain("Stalled: needs money for materials");
  });

  test("a finished project says what it opened and where a click goes", () => {
    const info = infoFor(at("hq", { w: 3, h: 3 }), ctx())!;
    expect(info.lines.map((l) => l.text)).toEqual(["Opened managers", "Click for Innovation"]);
  });

  test("a seaport counts its boats", () => {
    const info = infoFor(at("seaport-2", { w: 3, h: 2 }), ctx({ alongside: new Map([[7, 1]]), queued: new Map([[7, 2]]) }))!;
    expect(info.lines[1].text).toBe("1 alongside, 2 waiting");
  });
});
