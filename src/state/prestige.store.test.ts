import { beforeEach, describe, expect, test } from "bun:test";
import Decimal from "break_infinity.js";
import { usePrestigeStore } from "./prestige.store";

const reset = () =>
  usePrestigeStore.setState({
    equity: new Decimal(0),
    exits: 0,
    allocated: [],
  });

describe("prestige store allocation", () => {
  beforeEach(() => {
    localStorage.clear();
    reset();
  });

  test("can't allocate a root with no Equity, can once affordable", () => {
    expect(usePrestigeStore.getState().canAllocate("core")).toBe(false);
    usePrestigeStore.getState().grantEquity(5);
    expect(usePrestigeStore.getState().canAllocate("core")).toBe(true);
  });

  test("allocating spends Equity and records the node", () => {
    usePrestigeStore.getState().grantEquity(5);
    usePrestigeStore.getState().allocate("core"); // cost 1
    const s = usePrestigeStore.getState();
    expect(s.allocated).toContain("core");
    expect(s.equity.toNumber()).toBe(4);
  });

  test("can't allocate an unreachable node even when affordable", () => {
    usePrestigeStore.getState().grantEquity(100);
    expect(usePrestigeStore.getState().canAllocate("rev_2")).toBe(false);
    expect(usePrestigeStore.getState().allocated).not.toContain("rev_2");
  });

  test("prerequisites unlock as you allocate outward", () => {
    usePrestigeStore.getState().grantEquity(100);
    expect(usePrestigeStore.getState().canAllocate("rev_1")).toBe(false);
    usePrestigeStore.getState().allocate("core");
    expect(usePrestigeStore.getState().canAllocate("rev_1")).toBe(true);
    usePrestigeStore.getState().allocate("rev_1");
    expect(usePrestigeStore.getState().canAllocate("rev_2")).toBe(true);
  });

  test("allocate is a no-op when unaffordable", () => {
    usePrestigeStore.getState().grantEquity(0.5); // < core cost of 1
    usePrestigeStore.getState().allocate("core");
    expect(usePrestigeStore.getState().allocated).toEqual([]);
  });
});

describe("prestige store hydration", () => {
  beforeEach(() => {
    localStorage.clear();
    reset();
  });

  test("coerces a legacy raw-number Equity and drops unknown node ids", async () => {
    localStorage.setItem(
      "prestige",
      JSON.stringify({
        state: { equity: 12, exits: 2, allocated: ["core", "ghost_node"] },
        version: 0,
      }),
    );
    await usePrestigeStore.persist.rehydrate();
    const s = usePrestigeStore.getState();
    expect(s.equity).toBeInstanceOf(Decimal);
    expect(s.equity.toNumber()).toBe(12);
    expect(s.exits).toBe(2);
    expect(s.allocated).toEqual(["core"]); // ghost_node pruned
  });
});
