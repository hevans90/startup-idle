import { afterEach, describe, expect, test } from "bun:test";

import { resetAllGameStores } from "../../simulation/reset-game-stores";
import { useQuestStore } from "../../state/quest.store";
import { questIncomeMult } from "./effects";
import { effectRows } from "./describe";
import type { QuestWorld } from "./objectives";
import { REQUESTS } from "./requests";
import type { Effect } from "./types";

afterEach(() => resetAllGameStores());

const FROM = { tool: 0, assistant: 20, colleague: 40, manager: 60, overseer: 80, ascension: 100 };
const world = (w: Partial<QuestWorld> = {}): QuestWorld => ({
  meter: 45, stageFrom: FROM, agents: 10, running: 10, dcCooled: 1, covered: 1, counts: {}, block: false, keep: false, site: false, ...w,
});
const q = () => useQuestStore.getState();

describe("the requests", () => {
  test("sixteen, four for each of four families, two options each, each moving one axis by one at most", () => {
    expect(REQUESTS).toHaveLength(16);
    const families = new Map<string, number>();
    for (const r of REQUESTS) families.set(r.family, (families.get(r.family) ?? 0) + 1);
    expect([...families.values()]).toEqual([4, 4, 4, 4]);
    expect(new Set(REQUESTS.map((r) => r.id)).size).toBe(16);
    for (const r of REQUESTS) {
      expect(r.options).toHaveLength(2);
      for (const o of r.options) {
        const moved = Object.values(o.axis).filter((n) => n !== 0);
        expect(moved.length).toBeLessThanOrEqual(1);
        for (const n of moved) expect(Math.abs(n!)).toBe(1);
        expect(o.says.length).toBeGreaterThan(0);
        if (o.objective) expect(o.objective.window).toBeLessThanOrEqual(300);
      }
      const flags = r.options.flatMap((o) => [...o.effects, ...(o.success ?? []), ...(o.failure ?? [])])
        .flatMap((e: Effect) => (e.kind === "flag" ? [e.name] : []));
      for (const f of flags) expect(r.echoes?.[f]).toBeString();
    }
  });

  test("a lasting effect runs out on the arc's clock, and says for how long", () => {
    useQuestStore.setState({ offer: { kind: "request", id: "leak", waited: 0 } });
    q().choose(1);
    expect(questIncomeMult()).toBeCloseTo(0.9);
    expect(q().said).toEqual(["Let them read it. They will come round."]);
    expect(effectRows(REQUESTS.find((r) => r.id === "leak")!.options[1].effects)[0].label).toBe("−10% income for 5 min");
    for (let k = 0; k < 299; k++) q().step(world(), 1, () => 0.99, [], []);
    expect(questIncomeMult()).toBeCloseTo(0.9);
    q().step(world(), 1, () => 0.99, [], []);
    expect(questIncomeMult()).toBe(1);
    expect(q().flags).toContain("leak:ran");
  });

  test("paying is done once, by the map", () => {
    useQuestStore.setState({ offer: { kind: "request", id: "hedge", waited: 0 } });
    q().choose(0);
    expect(q().actions).toEqual([{ kind: "pay", seconds: 120 }]);
    expect(effectRows([{ kind: "pay", seconds: 60 }])[0].label).toBe("Costs 1 minute of income");
    expect(q().effects).toEqual([{ kind: "floodMult", mult: 0.75 }]);
  });

  test("an objective of one: built in time, the rest follows", () => {
    useQuestStore.setState({ offer: { kind: "request", id: "gym", waited: 0 } });
    q().choose(0);
    q().step(world({ counts: { gym: 1 } }), 1, () => 0.99, [], REQUESTS);
    expect(q().objective?.progress).toBe(0);
    q().step(world({ counts: { gym: 2 } }), 1, () => 0.99, [], REQUESTS);
    expect(q().objective).toBeNull();
    expect(questIncomeMult()).toBeCloseTo(1.03);
  });
});
