import Fuse from "fuse.js";
import { SKILL_TREE } from "./skill-tree";

// Static tree → build the fuzzy index once. We search the node title, its effect
// text (the bonus description) and its kind, so "discount"/"innovation" find the
// relevant passives and "keystone"/"notable" highlight all nodes of that kind.
const fuse = new Fuse(SKILL_TREE.nodes, {
  keys: ["title", "effect", "kind"],
  threshold: 0.4,
  ignoreLocation: true,
  minMatchCharLength: 2,
});

/** Ids of nodes fuzzily matching `query` (title or effect). Empty for queries
 * shorter than 2 chars. */
export function searchNodeIds(query: string): Set<string> {
  const q = query.trim();
  if (q.length < 2) return new Set();
  return new Set(fuse.search(q).map((r) => r.item.id));
}
