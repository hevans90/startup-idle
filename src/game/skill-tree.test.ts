import { describe, expect, test } from "bun:test";
import {
  aggregateGrants,
  buildAdjacency,
  canRemoveWithoutOrphan,
  frontierPath,
  isReachable,
  NEUTRAL_PRESTIGE_MODIFIERS,
  nodeById,
  nodeCost,
  nodeEffectRows,
  nodesToRemove,
  pathEquityCost,
  resolvePrestigeModifiers,
  SKILL_TREE,
} from "./skill-tree";

describe("generated skill tree", () => {
  test("has at least 300 nodes", () => {
    expect(SKILL_TREE.nodes.length).toBeGreaterThanOrEqual(300);
  });

  test("node ids are unique", () => {
    const ids = SKILL_TREE.nodes.map((n) => n.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test("every edge endpoint is a real node", () => {
    const ids = new Set(SKILL_TREE.nodes.map((n) => n.id));
    for (const [a, b] of SKILL_TREE.edges) {
      expect(ids.has(a)).toBe(true);
      expect(ids.has(b)).toBe(true);
    }
  });

  test("adjacency is symmetric", () => {
    const adj = buildAdjacency(SKILL_TREE);
    for (const [a, neighbours] of adj) {
      for (const b of neighbours) expect(adj.get(b)?.has(a)).toBe(true);
    }
  });

  test("every node is reachable from a root (no orphans)", () => {
    const adj = buildAdjacency(SKILL_TREE);
    const seen = new Set(SKILL_TREE.roots);
    const queue = [...SKILL_TREE.roots];
    while (queue.length) {
      const cur = queue.pop()!;
      for (const n of adj.get(cur) ?? []) {
        if (!seen.has(n)) {
          seen.add(n);
          queue.push(n);
        }
      }
    }
    expect(seen.size).toBe(SKILL_TREE.nodes.length);
  });

  test("has the expected node kinds (keystones, notables, travel)", () => {
    const kinds = new Set(SKILL_TREE.nodes.map((n) => n.kind));
    expect(kinds.has("keystone")).toBe(true);
    expect(kinds.has("notable")).toBe(true);
    expect(kinds.has("travel")).toBe(true);
    const keystones = SKILL_TREE.nodes.filter((n) => n.kind === "keystone");
    expect(keystones.length).toBe(7); // design doc §4
  });

  test("reachability gates non-roots behind allocation", () => {
    const empty = new Set<string>();
    expect(isReachable(SKILL_TREE, empty, "core")).toBe(true);
    expect(isReachable(SKILL_TREE, empty, "link_1_2")).toBe(false);
    expect(isReachable(SKILL_TREE, new Set(["core"]), "link_1_2")).toBe(true);
    expect(isReachable(SKILL_TREE, new Set(["core"]), "link_1_1")).toBe(false);
  });
});

describe("layout has no overlaps (nodes or links)", () => {
  const radiusOf = (kind: string) =>
    kind === "keystone" ? 48 : kind === "notable" ? 24 : kind === "root" ? 20 : 15;
  type Pt = { x: number; y: number };
  const pos = new Map(SKILL_TREE.nodes.map((n) => [n.id, n]));
  const segDist = (p: Pt, a: Pt, b: Pt) => {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const l2 = dx * dx + dy * dy || 1;
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2));
    return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
  };
  const ccw = (a: Pt, b: Pt, c: Pt) =>
    (c.y - a.y) * (b.x - a.x) - (b.y - a.y) * (c.x - a.x);
  const crosses = (a: Pt, b: Pt, c: Pt, d: Pt) =>
    ccw(c, d, a) > 0 !== ccw(c, d, b) > 0 && ccw(a, b, c) > 0 !== ccw(a, b, d) > 0;

  test("no two node discs overlap", () => {
    const N = SKILL_TREE.nodes;
    for (let i = 0; i < N.length; i++)
      for (let j = i + 1; j < N.length; j++)
        expect(
          Math.hypot(N[i].x - N[j].x, N[i].y - N[j].y),
        ).toBeGreaterThanOrEqual(radiusOf(N[i].kind) + radiusOf(N[j].kind));
  });

  test("no link passes through a node it doesn't connect", () => {
    for (const [a, b] of SKILL_TREE.edges) {
      const A = pos.get(a)!;
      const B = pos.get(b)!;
      for (const m of SKILL_TREE.nodes) {
        if (m.id === a || m.id === b) continue;
        expect(segDist(m, A, B)).toBeGreaterThanOrEqual(radiusOf(m.kind));
      }
    }
  });

  test("no two links cross", () => {
    const E = SKILL_TREE.edges;
    for (let i = 0; i < E.length; i++)
      for (let j = i + 1; j < E.length; j++) {
        const [a, b] = E[i];
        const [c, d] = E[j];
        if (a === c || a === d || b === c || b === d) continue;
        expect(crosses(pos.get(a)!, pos.get(b)!, pos.get(c)!, pos.get(d)!)).toBe(false);
      }
  });
});

describe("frontierPath + pathEquityCost", () => {
  const adj = buildAdjacency(SKILL_TREE);

  test("from nothing allocated, the path includes the root and ends at the target", () => {
    const path = frontierPath(SKILL_TREE, new Set(), "link_1_1", adj);
    expect(path[0]).toBe("core");
    expect(path[path.length - 1]).toBe("link_1_1");
  });

  test("path contains only unallocated nodes and ends at the target", () => {
    const allocated = new Set(["core"]);
    const path = frontierPath(SKILL_TREE, allocated, "link_1_1", adj);
    expect(path).not.toContain("core");
    expect(path[path.length - 1]).toBe("link_1_1");
    // allocating along the path, each node is reachable from the prior frontier
    const acc = new Set(allocated);
    for (const id of path) {
      expect(isReachable(SKILL_TREE, acc, id, adj)).toBe(true);
      acc.add(id);
    }
  });

  test("an already-allocated target yields an empty path", () => {
    expect(frontierPath(SKILL_TREE, new Set(["core"]), "core", adj)).toEqual([]);
  });

  test("pathEquityCost sums the escalating per-node costs", () => {
    expect(pathEquityCost(0, 0)).toBe(0);
    expect(pathEquityCost(0, 3)).toBe(nodeCost(0) + nodeCost(1) + nodeCost(2));
    expect(pathEquityCost(5, 2)).toBe(nodeCost(5) + nodeCost(6));
  });

  test("nodesToRemove returns the node plus its orphaned dependents", () => {
    const alloc = new Set(["core", "link_1_2", "link_1_1"]);
    // removing the middle node must also take the leaf that depends on it
    expect(nodesToRemove(SKILL_TREE, alloc, "link_1_2", adj)).toEqual([
      "link_1_2",
      "link_1_1",
    ]);
    // a leaf removes only itself
    expect(nodesToRemove(SKILL_TREE, alloc, "link_1_1", adj)).toEqual(["link_1_1"]);
    // a root is never removable
    expect(nodesToRemove(SKILL_TREE, alloc, "core", adj)).toEqual([]);
  });
});

describe("node bonuses", () => {
  test("every non-root node grants at least one bonus (travel included)", () => {
    const bearing = SKILL_TREE.nodes.filter((n) => n.kind !== "root");
    expect(bearing.length).toBeGreaterThan(0);
    for (const n of bearing) {
      expect(n.grants && n.grants.length).toBeGreaterThan(0);
    }
  });

  test("travel-node bonuses are small (≤ 2% per stat, no multipliers)", () => {
    for (const n of SKILL_TREE.nodes) {
      if (n.kind !== "travel") continue;
      for (const g of n.grants ?? []) {
        expect(g.kind).toBe("pct");
        expect(Math.abs(g.value)).toBeLessThanOrEqual(2);
      }
    }
  });

  test("the root grants the unique all-rounder Founding Charter", () => {
    const root = SKILL_TREE.nodes.find((n) => n.kind === "root")!;
    const stats = new Set((root.grants ?? []).map((g) => g.stat));
    // touches many distinct levers — the only such node in the tree
    expect(stats.size).toBeGreaterThanOrEqual(5);
    expect(resolvePrestigeModifiers([root.id]).moneyMult).toBeGreaterThan(1);
  });

  test("aggregateGrants sums percents, multiplies multipliers, drops no-ops", () => {
    const totals = aggregateGrants([
      { stat: "money", kind: "pct", value: 5 },
      { stat: "money", kind: "pct", value: 3 },
      { stat: "money", kind: "mult", value: 3 },
      { stat: "innovation", kind: "mult", value: 0.2 },
      { stat: "valuation", kind: "pct", value: 0 }, // net no-op → dropped
    ]);
    const money = totals.find((t) => t.stat === "money")!;
    expect(money.pct).toBe(8);
    expect(money.mult).toBe(3);
    expect(totals.find((t) => t.stat === "innovation")!.mult).toBeCloseTo(0.2);
    expect(totals.find((t) => t.stat === "valuation")).toBeUndefined();
  });
});

describe("resolvePrestigeModifiers", () => {
  const nodeWith = (pred: (g: { stat: string; kind: string; value: number }) => boolean) =>
    SKILL_TREE.nodes.find((n) => n.grants?.some(pred))!;

  test("nothing allocated → neutral modifiers", () => {
    expect(resolvePrestigeModifiers([])).toEqual(NEUTRAL_PRESTIGE_MODIFIERS);
  });

  test("a money% node raises moneyMult by that fraction", () => {
    const n = nodeWith((g) => g.stat === "money" && g.kind === "pct" && g.value > 0);
    const g = n.grants!.find((x) => x.stat === "money" && x.kind === "pct")!;
    // isolate: a node that ONLY grants money% so the assertion is exact
    const moneyOnly = SKILL_TREE.nodes.find(
      (x) => x.grants?.length === 1 && x.grants[0].stat === "money" && x.grants[0].kind === "pct",
    );
    const target = moneyOnly ?? n;
    const v = (moneyOnly ?? n).grants!.find((x) => x.stat === "money")!.value;
    expect(resolvePrestigeModifiers([target.id]).moneyMult).toBeCloseTo(1 + v / 100);
    expect(g.value).toBeGreaterThan(0);
  });

  test("a money× keystone multiplies moneyMult", () => {
    const k = nodeWith((g) => g.stat === "money" && g.kind === "mult");
    const m = k.grants!.find((x) => x.stat === "money" && x.kind === "mult")!;
    expect(resolvePrestigeModifiers([k.id]).moneyMult).toBeCloseTo(m.value);
  });

  test("a hireCost node makes hires cheaper (mult < 1)", () => {
    const n = nodeWith((g) => g.stat === "hireCost" && g.value < 0);
    expect(resolvePrestigeModifiers([n.id]).hireCostMult).toBeLessThan(1);
  });

  test("a headcount node yields an additive per-employee rate", () => {
    const n = nodeWith((g) => g.stat === "headcount");
    const g = n.grants!.find((x) => x.stat === "headcount")!;
    expect(resolvePrestigeModifiers([n.id]).headcountPerEmployee).toBeCloseTo(g.value / 100);
  });

  test("a satisfactionGain node slows satisfaction (mult < 1)", () => {
    const n = nodeWith((g) => g.stat === "satisfactionGain" && g.value < 0);
    expect(resolvePrestigeModifiers([n.id]).satisfactionGainMult).toBeLessThan(1);
  });

  test("keystone structural flags resolve from their `special` tag", () => {
    const bySpecial = (s: string) => SKILL_TREE.nodes.find((n) => n.special === s)!;
    expect(resolvePrestigeModifiers([bySpecial("disableManagers").id]).disableManagers).toBe(true);
    expect(
      resolvePrestigeModifiers([bySpecial("neutralizeSatisfaction").id]).satisfactionNeutralized,
    ).toBe(true);
    expect(
      resolvePrestigeModifiers([bySpecial("dampSatisfaction").id]).satisfactionPositiveMult,
    ).toBeLessThan(1);
    expect(
      resolvePrestigeModifiers([bySpecial("internsCrippled").id]).internOutputMult,
    ).toBeLessThan(1);
    expect(
      resolvePrestigeModifiers([bySpecial("freeStartingLevels").id]).freeStartingLevels,
    ).toBeGreaterThan(0);
  });

  test("each structural special lives on exactly one keystone", () => {
    for (const s of [
      "disableManagers",
      "neutralizeSatisfaction",
      "dampSatisfaction",
      "internsCrippled",
      "freeStartingLevels",
    ]) {
      const hits = SKILL_TREE.nodes.filter((n) => n.special === s);
      expect(hits.length).toBe(1);
      expect(hits[0].kind).toBe("keystone");
    }
  });
});

describe("nodeEffectRows (signed, coloured breakdown)", () => {
  test("996 splits into a green output gain and a red satisfaction downside", () => {
    const n996 = SKILL_TREE.nodes.find((n) => n.title === "996")!;
    const rows = nodeEffectRows(n996);
    expect(rows.length).toBe(2);
    const good = rows.find((r) => r.tone === "good");
    const bad = rows.find((r) => r.tone === "bad");
    expect(good?.label.toLowerCase()).toContain("employee output");
    expect(bad?.label.toLowerCase()).toContain("satisfaction gain");
  });

  test("a keystone appends its structural reshape as a row", () => {
    const boot = SKILL_TREE.nodes.find((n) => n.special === "disableManagers")!;
    const rows = nodeEffectRows(boot);
    expect(rows.some((r) => /manager/i.test(r.label) && r.tone === "bad")).toBe(true);
  });

  test("a beneficial multiplier reads good, a detrimental one reads bad", () => {
    const downRound = SKILL_TREE.nodes.find((n) => n.title === "Down Round")!;
    const rows = nodeEffectRows(downRound);
    // money ×3 → good, valuation ×0.2 → bad
    expect(rows.some((r) => /money/i.test(r.label) && r.tone === "good")).toBe(true);
    expect(rows.some((r) => /valuation/i.test(r.label) && r.tone === "bad")).toBe(true);
  });
});

describe("nodeCost (escalating)", () => {
  test("each node costs at least as much as the last, ≥ 1", () => {
    expect(nodeCost(0)).toBeGreaterThanOrEqual(1);
    let prev = 0;
    for (const n of [0, 10, 50, 150, 300]) {
      expect(nodeCost(n)).toBeGreaterThanOrEqual(prev);
      prev = nodeCost(n);
    }
    expect(nodeCost(300)).toBeGreaterThan(nodeCost(0));
  });
});

describe("canRemoveWithoutOrphan", () => {
  const adj = buildAdjacency(SKILL_TREE);
  test("a leaf can be removed; a cut node and roots cannot", () => {
    const allocated = new Set(["core", "link_1_2", "link_1_1"]);
    expect(canRemoveWithoutOrphan(SKILL_TREE, allocated, "link_1_1", adj)).toBe(true);
    // removing spoke_0 would orphan spoke_1
    expect(canRemoveWithoutOrphan(SKILL_TREE, allocated, "link_1_2", adj)).toBe(false);
    // roots are never removable
    expect(canRemoveWithoutOrphan(SKILL_TREE, allocated, "core", adj)).toBe(false);
  });

  test("nodeById covers every node", () => {
    expect(nodeById(SKILL_TREE).size).toBe(SKILL_TREE.nodes.length);
  });
});
