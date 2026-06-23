/**
 * Library-agnostic skill-tree model for the Company Acquisition prestige system.
 * Nodes are a FIXED, hand-authored, undirected graph you allocate into by
 * spending Equity. The renderer (PixiJS) is a thin view over this — all
 * allocation rules live here as pure functions so they're testable and the
 * renderer can be swapped without touching game logic.
 *
 * Perk EFFECTS are intentionally placeholders for now (prototype): the shape is
 * here (`effect`), the actual modifiers get designed + wired to chokepoints later.
 */

export type SkillNodeKind = "root" | "minor" | "notable";

export type SkillNode = {
  id: string;
  /** Layout position in tree-space (arbitrary units, centered near 0,0). */
  x: number;
  y: number;
  title: string;
  /** Equity cost to allocate. */
  cost: number;
  kind: SkillNodeKind;
  /** Optional background icon (texture URL/key) drawn inside the node. An icon
   * pack will populate these later; until then nodes render as plain discs. */
  icon?: string;
  /** Placeholder for the eventual modifier payload (designed later). */
  effect?: string;
};

/** Undirected connection between two node ids. */
export type SkillEdge = [string, string];

export type SkillTree = {
  nodes: SkillNode[];
  edges: SkillEdge[];
  /** Always-allocatable entry points (no prerequisite). */
  roots: string[];
};

/**
 * Placeholder prototype tree: a central root with three themed branches
 * (revenue / product / hype) and a couple of cross-links, ending in "notable"
 * nodes. Positions are hand-laid for a tree-like spread. Effects are stubs.
 */
export const SKILL_TREE: SkillTree = {
  roots: ["core"],
  nodes: [
    { id: "core", x: 0, y: 0, title: "Incorporation", cost: 1, kind: "root", effect: "Entry point" },

    // Revenue branch (right)
    { id: "rev_1", x: 220, y: -40, title: "Burn Rate Denial", cost: 1, kind: "minor" },
    { id: "rev_2", x: 420, y: -90, title: "Growth Hacking", cost: 2, kind: "minor" },
    { id: "rev_3", x: 420, y: 30, title: "Rent Seeking", cost: 2, kind: "minor" },
    { id: "rev_notable", x: 620, y: -30, title: "Monopoly Moat", cost: 5, kind: "notable", effect: "TBD: big money lever" },

    // Product branch (upper-left)
    { id: "prod_1", x: -120, y: -200, title: "Move Fast", cost: 1, kind: "minor" },
    { id: "prod_2", x: -240, y: -380, title: "Break Things", cost: 2, kind: "minor" },
    { id: "prod_3", x: -20, y: -360, title: "Tech Debt Spiral", cost: 2, kind: "minor" },
    { id: "prod_notable", x: -180, y: -560, title: "AGI Any Day Now", cost: 5, kind: "notable", effect: "TBD: big innovation lever" },

    // Hype branch (lower-left)
    { id: "hype_1", x: -120, y: 200, title: "Thought Leadership", cost: 1, kind: "minor" },
    { id: "hype_2", x: -260, y: 360, title: "Vaporware Keynote", cost: 2, kind: "minor" },
    { id: "hype_3", x: -40, y: 380, title: "Founder Mythology", cost: 2, kind: "minor" },
    { id: "hype_notable", x: -200, y: 560, title: "Reality Distortion", cost: 5, kind: "notable", effect: "TBD: big valuation lever" },

    // Cross-link keystone (bridges revenue + product)
    { id: "keystone", x: 120, y: -300, title: "Acqui-hire Engine", cost: 8, kind: "notable", effect: "TBD: unique keystone" },
  ],
  edges: [
    ["core", "rev_1"],
    ["rev_1", "rev_2"],
    ["rev_1", "rev_3"],
    ["rev_2", "rev_notable"],
    ["rev_3", "rev_notable"],

    ["core", "prod_1"],
    ["prod_1", "prod_2"],
    ["prod_1", "prod_3"],
    ["prod_2", "prod_notable"],

    ["core", "hype_1"],
    ["hype_1", "hype_2"],
    ["hype_1", "hype_3"],
    ["hype_2", "hype_notable"],

    ["prod_3", "keystone"],
    ["rev_2", "keystone"],
  ],
};

export const nodeById = (tree: SkillTree): Map<string, SkillNode> =>
  new Map(tree.nodes.map((n) => [n.id, n]));

/** Undirected adjacency: id → set of connected ids. */
export function buildAdjacency(tree: SkillTree): Map<string, Set<string>> {
  const adj = new Map<string, Set<string>>();
  const link = (a: string, b: string) => {
    if (!adj.has(a)) adj.set(a, new Set());
    adj.get(a)!.add(b);
  };
  for (const [a, b] of tree.edges) {
    link(a, b);
    link(b, a);
  }
  return adj;
}

/**
 * Whether a node CAN be reached (ignoring cost): not already allocated, and
 * either a root or adjacent to an allocated node. Cost/Equity is checked
 * separately by the store.
 */
export function isReachable(
  tree: SkillTree,
  allocated: ReadonlySet<string>,
  id: string,
  adjacency: Map<string, Set<string>> = buildAdjacency(tree),
): boolean {
  if (allocated.has(id)) return false;
  if (!nodeById(tree).has(id)) return false;
  if (tree.roots.includes(id)) return true;
  const neighbours = adjacency.get(id);
  if (!neighbours) return false;
  for (const n of neighbours) if (allocated.has(n)) return true;
  return false;
}

/** Bounding box of all node positions (for centering the viewport). */
export function treeBounds(tree: SkillTree): {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
} {
  const xs = tree.nodes.map((n) => n.x);
  const ys = tree.nodes.map((n) => n.y);
  return {
    minX: Math.min(...xs),
    minY: Math.min(...ys),
    maxX: Math.max(...xs),
    maxY: Math.max(...ys),
  };
}
