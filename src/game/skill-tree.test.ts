import { describe, expect, test } from "bun:test";
import {
  buildAdjacency,
  canRemoveWithoutOrphan,
  frontierPath,
  isReachable,
  nodeById,
  nodeCost,
  nodesToRemove,
  pathEquityCost,
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
