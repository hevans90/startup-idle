import { beforeEach, describe, expect, test } from "bun:test";
import Decimal from "break_infinity.js";
import { nodeCost, TREE_VERSION } from "../game/skill-tree";
import { RESPECS_PER_EXIT, usePrestigeStore } from "./prestige.store";

const reset = () =>
  usePrestigeStore.setState({
    equity: new Decimal(0),
    exits: 0,
    respecPoints: 0,
    allocated: [],
    everEarnedEquity: false,
  });

describe("prestige allocation (escalating cost)", () => {
  beforeEach(() => {
    localStorage.clear();
    reset();
  });

  test("can't allocate the root with no Equity; can once affordable", () => {
    expect(usePrestigeStore.getState().canAllocate("core")).toBe(false);
    usePrestigeStore.getState().grantEquity(5);
    expect(usePrestigeStore.getState().canAllocate("core")).toBe(true);
  });

  test("allocating spends the escalating next-cost", () => {
    usePrestigeStore.getState().grantEquity(100);
    const c0 = usePrestigeStore.getState().getNextCost(); // nodeCost(0)
    usePrestigeStore.getState().allocate("core");
    expect(usePrestigeStore.getState().equity.toNumber()).toBe(100 - c0);
    // next node costs at least as much as the first
    expect(usePrestigeStore.getState().getNextCost()).toBeGreaterThanOrEqual(c0);
    expect(usePrestigeStore.getState().getNextCost()).toBe(nodeCost(1));
  });

  test("prerequisites unlock outward; unreachable nodes are blocked", () => {
    usePrestigeStore.getState().grantEquity(1000);
    expect(usePrestigeStore.getState().canAllocate("growth_h0")).toBe(false);
    usePrestigeStore.getState().allocate("core");
    expect(usePrestigeStore.getState().canAllocate("link_1_1")).toBe(true);
    usePrestigeStore.getState().allocate("link_1_1");
    expect(usePrestigeStore.getState().canAllocate("growth_h0")).toBe(true);
  });
});

describe("allocatePath (multi-node, one click)", () => {
  beforeEach(() => {
    localStorage.clear();
    reset();
  });

  test("allocates the whole route and spends the summed escalating cost", () => {
    usePrestigeStore.getState().grantEquity(1000);
    const before = usePrestigeStore.getState().equity.toNumber();
    usePrestigeStore.getState().allocatePath("growth_h0"); // core → link_1_1 → growth_h0
    const s = usePrestigeStore.getState();
    expect(s.allocated).toEqual(["core", "link_1_1", "growth_h0"]);
    // cost = nodeCost(0)+nodeCost(1)+nodeCost(2)
    expect(s.equity.toNumber()).toBe(
      before - (nodeCost(0) + nodeCost(1) + nodeCost(2)),
    );
  });

  test("only buys the affordable prefix when you can't afford all of it", () => {
    usePrestigeStore.getState().grantEquity(nodeCost(0)); // enough for exactly one
    usePrestigeStore.getState().allocatePath("growth_h0");
    const s = usePrestigeStore.getState();
    expect(s.allocated).toEqual(["core"]);
    expect(s.equity.toNumber()).toBe(0);
  });
});

describe("respecPath (multi-node, one click)", () => {
  beforeEach(() => {
    localStorage.clear();
    reset();
  });

  test("refunds a node plus its orphaned dependents in one go", () => {
    usePrestigeStore.getState().grantEquity(1000);
    usePrestigeStore.getState().allocatePath("growth_h0"); // 3 nodes
    usePrestigeStore.setState({ respecPoints: 10 });
    const equityAfterAlloc = usePrestigeStore.getState().equity.toNumber();

    // refunding link_1_1 must also take growth_h0 (its only route to root)
    usePrestigeStore.getState().respecPath("link_1_1");
    const s = usePrestigeStore.getState();
    expect(s.allocated).toEqual(["core"]);
    expect(s.respecPoints).toBe(8); // 2 nodes refunded
    expect(s.equity.toNumber()).toBe(
      equityAfterAlloc + nodeCost(2) + nodeCost(1),
    );
  });

  test("partial refund (too few points) never orphans — removes leaf-ward only", () => {
    usePrestigeStore.getState().grantEquity(1000);
    usePrestigeStore.getState().allocatePath("growth_h0"); // core, link_1_1, growth_h0
    usePrestigeStore.setState({ respecPoints: 1 });
    usePrestigeStore.getState().respecPath("link_1_1"); // wants 2, only 1 point
    const s = usePrestigeStore.getState();
    // only the leaf came off; link_1_1 stays so growth_h0 isn't orphaned
    expect(s.allocated).toContain("core");
    expect(s.allocated).toContain("link_1_1");
    expect(s.allocated).not.toContain("growth_h0");
    expect(s.respecPoints).toBe(0);
  });
});

describe("respec", () => {
  beforeEach(() => {
    localStorage.clear();
    reset();
  });

  test("buying respecs spends an Exit for RESPECS_PER_EXIT points", () => {
    usePrestigeStore.setState({ exits: 2 });
    usePrestigeStore.getState().buyRespecs();
    const s = usePrestigeStore.getState();
    expect(s.exits).toBe(1);
    expect(s.respecPoints).toBe(RESPECS_PER_EXIT);
  });

  test("can't buy respecs with no Exits", () => {
    usePrestigeStore.getState().buyRespecs();
    expect(usePrestigeStore.getState().respecPoints).toBe(0);
  });

  test("refunds a leaf node: −1 point, +Equity back, deallocated", () => {
    usePrestigeStore.getState().grantEquity(1000);
    usePrestigeStore.getState().allocate("core");
    usePrestigeStore.getState().allocate("link_1_1");
    usePrestigeStore.setState({ respecPoints: 5 });
    const equityBefore = usePrestigeStore.getState().equity.toNumber();

    usePrestigeStore.getState().respecNode("link_1_1"); // leaf
    const s = usePrestigeStore.getState();
    expect(s.allocated).not.toContain("link_1_1");
    expect(s.respecPoints).toBe(4);
    expect(s.equity.toNumber()).toBe(equityBefore + nodeCost(1)); // refund top marginal
  });

  test("won't refund a node that would orphan others, or with no points", () => {
    usePrestigeStore.getState().grantEquity(1000);
    usePrestigeStore.getState().allocate("core");
    usePrestigeStore.getState().allocate("link_1_1");
    usePrestigeStore.getState().allocate("growth_h0");

    // no points yet
    usePrestigeStore.getState().respecNode("growth_h0");
    expect(usePrestigeStore.getState().allocated).toContain("growth_h0");

    usePrestigeStore.setState({ respecPoints: 5 });
    // refunding spoke_0 would orphan spoke_1 → blocked
    usePrestigeStore.getState().respecNode("link_1_1");
    expect(usePrestigeStore.getState().allocated).toContain("link_1_1");
    // the leaf is fine
    usePrestigeStore.getState().respecNode("growth_h0");
    expect(usePrestigeStore.getState().allocated).not.toContain("growth_h0");
  });
});

describe("prestige hydration", () => {
  beforeEach(() => {
    localStorage.clear();
    reset();
  });

  test("coerces legacy Equity and prunes unknown node ids", async () => {
    localStorage.setItem(
      "prestige",
      JSON.stringify({
        state: { equity: 12, exits: 2, respecPoints: 3, allocated: ["core", "ghost"], treeVersion: TREE_VERSION },
        version: 0,
      }),
    );
    await usePrestigeStore.persist.rehydrate();
    const s = usePrestigeStore.getState();
    expect(s.equity).toBeInstanceOf(Decimal);
    expect(s.equity.toNumber()).toBe(12);
    expect(s.allocated).toEqual(["core"]); // ghost pruned
  });

  test("a save from an older tree gets every node's Equity back", async () => {
    localStorage.setItem(
      "prestige",
      JSON.stringify({ state: { equity: 12, exits: 2, respecPoints: 3, allocated: ["core", "link_1_1"] }, version: 0 }),
    );
    await usePrestigeStore.persist.rehydrate();
    const s = usePrestigeStore.getState();
    expect(s.allocated).toEqual([]);
    expect(s.equity.toNumber()).toBe(12 + nodeCost(0) + nodeCost(1));
  });
});

describe("ever earned Equity", () => {
  beforeEach(() => {
    localStorage.clear();
    reset();
  });

  test("set by a sale or a grant, and kept when the Equity is spent", () => {
    expect(usePrestigeStore.getState().everEarnedEquity).toBe(false);
    usePrestigeStore.getState().bankAcquisition(new Decimal(5));
    usePrestigeStore.setState({ equity: new Decimal(0), exits: 0 });
    expect(usePrestigeStore.getState().everEarnedEquity).toBe(true);
    reset();
    usePrestigeStore.getState().grantEquity(1);
    expect(usePrestigeStore.getState().everEarnedEquity).toBe(true);
  });

  test("an older save says so by what Equity bought or is; a fresh one does not", async () => {
    const hydrate = async (state: object) => {
      localStorage.setItem("prestige", JSON.stringify({ state, version: 0 }));
      await usePrestigeStore.persist.rehydrate();
      return usePrestigeStore.getState().everEarnedEquity;
    };
    expect(await hydrate({ equity: 0, exits: 0, respecPoints: 0, allocated: ["core"] })).toBe(true);
    expect(await hydrate({ equity: 3, exits: 0, respecPoints: 0, allocated: [] })).toBe(true);
    expect(await hydrate({ equity: 0, exits: 0, respecPoints: 0, allocated: [] })).toBe(false);
  });
});
