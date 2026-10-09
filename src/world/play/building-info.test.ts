import { describe, expect, test } from "bun:test";

import type { Structure } from "../grid";
import { collate, gatherLabels, infoFor, type InfoContext } from "./building-info";

const ctx = (over: Partial<InfoContext> = {}): InfoContext => ({
  perHead: { intern: 2 }, arriving: new Map(), alongside: new Map(), queued: new Map(), stalled: new Set(),
  money: (n) => `$${n}`, ...over,
});
const at = (def: string, extra: Partial<Structure> = {}): Structure => ({ id: 7, def, x: 0, y: 0, w: 1, h: 1, ...extra });

describe("a building's label", () => {
  test("a house says who lives there, what they earn, and who is coming", () => {
    const info = infoFor(at("kit:intern.t1", { residents: 3 }), ctx({ arriving: new Map([[7, 2]]) }))!;
    expect(info.title).toBe("Intern house II");
    expect(info.brief).toEqual(["3/5 · +2"]);
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
    expect(info.brief).toEqual(["50%"]);
    expect(info.lines.map((l) => l.text)).toEqual(["50% built", "Stalled"]);
  });

  test("a finished project says what it opened and where a click goes", () => {
    const info = infoFor(at("hq", { w: 3, h: 3 }), ctx())!;
    expect(info.lines.map((l) => l.text)).toEqual(["Click for Innovation"]);
  });

  test("a seaport counts its boats", () => {
    const info = infoFor(at("seaport-2", { w: 3, h: 2 }), ctx({ alongside: new Map([[7, 1]]), queued: new Map([[7, 2]]) }))!;
    expect(info.lines[1].text).toBe("1 alongside, 2 waiting");
  });
});

describe("labels too close to show apart", () => {
  const house = (id: number, residents: number, def = "kit:intern.t1") =>
    infoFor({ ...at(def, { residents }), id }, ctx({ arriving: new Map([[2, 1]]) }))!;

  test("collate into one that adds up everything they said", () => {
    const hq = infoFor(at("hq", { w: 3, h: 3 }), ctx())!;
    const port = infoFor(at("seaport", { w: 2, h: 2 }), ctx({ alongside: new Map([[7, 1]]) }))!;
    const one = collate([house(1, 3), house(2, 1), house(3, 0, "kit:vibe_coder.t0"), hq, port], (n) => `$${n}`);
    expect(one.title).toBe("5 buildings");
    expect(one.lines.map((l) => l.text)).toEqual([
      "Interns: 4/10 in 2 homes", "  earn $8/s", "  1 on the way",
      "Vibe coders: 0/2 in 1 home",
      "Company HQ",
      "1 seaport: 1/1 alongside",
    ]);
    expect(one.brief).toEqual(["Interns 4/10 +1", "Vibe coders 0/2", "Company HQ", "Ports 1/1"]);
    expect(one.facts.length).toBe(5);
  });

  test("gather only where they would overlap, and come apart with room", () => {
    const items = [1, 2, 3].map((id) => ({ id, x: id * 20, y: 100, band: id, info: house(id, 1) }));
    // Twenty pixels apart: one label for all three.
    expect(gatherLabels(items, true, String).map((g) => g.ids.length)).toEqual([3]);
    // Four hundred apart: one each.
    const far = items.map((it) => ({ ...it, x: it.id * 400 }));
    expect(gatherLabels(far, true, String).map((g) => g.ids.length)).toEqual([1, 1, 1]);
  });

  test("nothing is ever left out", () => {
    const items = Array.from({ length: 40 }, (_, k) => ({
      id: k, x: (k % 8) * 37, y: Math.floor(k / 8) * 21, band: k, info: house(k, k % 5),
    }));
    for (const full of [true, false]) {
      const groups = gatherLabels(items, full, String);
      expect(groups.flatMap((g) => g.ids).sort((a, b) => a - b)).toEqual(items.map((i) => i.id));
      const res = groups.flatMap((g) => g.info.facts).reduce((n, f) => n + (f.type === "home" ? f.residents : 0), 0);
      expect(res).toBe(items.reduce((n, i) => n + (i.id % 5), 0));
    }
  });
});
