import { describe, expect, test } from "bun:test";
import {
  buildAdjacency,
  isReachable,
  nodeById,
  SKILL_TREE,
} from "./skill-tree";

describe("skill tree model", () => {
  test("every edge endpoint is a real node", () => {
    const ids = new Set(SKILL_TREE.nodes.map((n) => n.id));
    for (const [a, b] of SKILL_TREE.edges) {
      expect(ids.has(a)).toBe(true);
      expect(ids.has(b)).toBe(true);
    }
  });

  test("node ids are unique", () => {
    const ids = SKILL_TREE.nodes.map((n) => n.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test("adjacency is symmetric", () => {
    const adj = buildAdjacency(SKILL_TREE);
    for (const [a, neighbours] of adj) {
      for (const b of neighbours) {
        expect(adj.get(b)?.has(a)).toBe(true);
      }
    }
  });

  test("roots are reachable from an empty allocation; non-roots are not", () => {
    const empty = new Set<string>();
    expect(isReachable(SKILL_TREE, empty, "core")).toBe(true);
    expect(isReachable(SKILL_TREE, empty, "rev_1")).toBe(false);
  });

  test("a node becomes reachable once a neighbour is allocated", () => {
    expect(isReachable(SKILL_TREE, new Set(["core"]), "rev_1")).toBe(true);
    // still gated two hops out
    expect(isReachable(SKILL_TREE, new Set(["core"]), "rev_2")).toBe(false);
  });

  test("an already-allocated node is not 'reachable' (no re-allocation)", () => {
    expect(isReachable(SKILL_TREE, new Set(["core"]), "core")).toBe(false);
  });

  test("nodeById covers every node", () => {
    expect(nodeById(SKILL_TREE).size).toBe(SKILL_TREE.nodes.length);
  });
});
