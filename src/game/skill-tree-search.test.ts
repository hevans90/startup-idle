import { describe, expect, test } from "bun:test";
import { nodeById, SKILL_TREE } from "./skill-tree";
import { searchNodeIds } from "./skill-tree-search";

const NODES = nodeById(SKILL_TREE);

describe("searchNodeIds (fuse.js over title + effect)", () => {
  test("short / empty queries match nothing", () => {
    expect(searchNodeIds("").size).toBe(0);
    expect(searchNodeIds(" a ").size).toBe(0);
  });

  test("searching a kind highlights every node of that kind", () => {
    const keystoneIds = SKILL_TREE.nodes
      .filter((n) => n.kind === "keystone")
      .map((n) => n.id);
    const hits = searchNodeIds("keystone");
    for (const id of keystoneIds) expect(hits.has(id)).toBe(true);

    const notableIds = SKILL_TREE.nodes
      .filter((n) => n.kind === "notable")
      .map((n) => n.id);
    const notableHits = searchNodeIds("notable");
    for (const id of notableIds) expect(notableHits.has(id)).toBe(true);
  });

  test("a real node title returns at least that node", () => {
    const sample = SKILL_TREE.nodes.find((n) => n.kind === "keystone")!;
    const hits = searchNodeIds(sample.title);
    expect(hits.size).toBeGreaterThan(0);
    expect(hits.has(sample.id)).toBe(true);
  });

  test("matches on effect text, not just the title", () => {
    // "automation" appears in effect descriptions but in no node title — so a
    // hit on it proves the effect field is being searched.
    const effectOnly = SKILL_TREE.nodes.filter(
      (n) =>
        (n.effect ?? "").toLowerCase().includes("automation") &&
        !n.title.toLowerCase().includes("automation"),
    );
    expect(effectOnly.length).toBeGreaterThan(0);
    const hits = searchNodeIds("automation");
    for (const n of effectOnly) expect(hits.has(n.id)).toBe(true);
  });
});
