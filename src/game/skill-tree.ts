/**
 * Library-agnostic skill-tree model for the Company Acquisition prestige.
 *
 * The tree is a FIXED, hand-designed *graph* generated procedurally from cluster
 * data (PoE-style). From a central hub, spokes lead to themed clusters. Each
 * cluster is a TRUNK pod that FORKS into several branches (filling a 2D region),
 * and clusters are webbed together by ring-loops at two radii — so it reads as
 * an interconnected web you can path around, not isolated radial arms.
 *
 * Allocation rules are pure functions here; the renderer is a thin view. Node
 * EFFECTS are descriptive placeholders until wired to the economy chokepoints.
 * See docs/acquisition-skill-tree-design.md.
 */

export type SkillNodeKind = "root" | "travel" | "minor" | "notable" | "keystone";

export type SkillNode = {
  id: string;
  x: number;
  y: number;
  title: string;
  kind: SkillNodeKind;
  /** Cluster id this node belongs to ("core" for the hub). */
  cluster: string;
  /** Optional background icon (texture URL/key) — icon pack lands later. */
  icon?: string;
  /** Human-readable effect summary (placeholder until effects are wired). */
  effect?: string;
};

/** Undirected connection between two node ids. */
export type SkillEdge = [string, string];

export type SkillTree = {
  nodes: SkillNode[];
  edges: SkillEdge[];
  roots: string[];
};

// ─── Escalating cost model (design doc §2) ──────────────────────────────────
export const COST_BASE = 1;
export const COST_GROWTH = 1.03;

/**
 * Equity cost of allocating your next node, given how many you already own.
 *
 * Strictly increasing per node: the linear `+ allocatedCount` term keeps the
 * first node cheap (1 Equity) yet guarantees every node costs more than the
 * last, while the geometric term compounds the deep-tree cost. (A pure geometric
 * at base 1 rounds flat to 1 Equity for the first ~24 nodes — looks unscaled.)
 */
export function nodeCost(allocatedCount: number): number {
  return Math.round(COST_BASE * COST_GROWTH ** allocatedCount) + allocatedCount;
}

// ─── Cluster definitions (design doc §4) ────────────────────────────────────
/** A branch fanning off the trunk: `pods` notables with `minors` each, angled
 * `offset` degrees from the cluster centre. */
type Branch = { offset: number; pods: number; minors: number };

type ClusterShape = {
  /** Minors ringing the trunk pod. */
  trunkMinors: number;
  branches: Branch[];
  /** Travel nodes between consecutive pods. */
  travelPerGap: number;
};

type ClusterDef = {
  id: string;
  name: string;
  minor: string;
  /** Signature notables — trunk first, then branch pods; extras get generic names. */
  notables: { title: string; effect: string }[];
  keystone?: { title: string; effect: string };
  shape: ClusterShape;
};

const CLUSTERS: ClusterDef[] = [
  {
    id: "growth",
    name: "Growth Hacking",
    minor: "+ money / headcount synergy",
    notables: [
      { title: "Blitzscaling", effect: "Output scales with √(total headcount)." },
      { title: "Network Effects", effect: "+5% to all multipliers per 100 employees." },
    ],
    shape: { trunkMinors: 4, travelPerGap: 3, branches: [{ offset: -27, pods: 2, minors: 4 }, { offset: 27, pods: 1, minors: 5 }] },
  },
  {
    id: "vc",
    name: "Venture Capital",
    minor: "+ valuation / cheaper mandates",
    notables: [{ title: "Term Sheet", effect: "+8% money per board-mandate level." }],
    keystone: { title: "Down Round", effect: "Money ×3, but valuation accrues 80% slower." },
    shape: { trunkMinors: 4, travelPerGap: 3, branches: [{ offset: -27, pods: 2, minors: 5 }, { offset: 27, pods: 1, minors: 4 }] },
  },
  {
    id: "movefast",
    name: "Move Fast",
    minor: "+ innovation / auto-buy",
    notables: [{ title: "Ship It", effect: "+25% innovation and +25% auto-buy." }],
    keystone: { title: "Move Fast, Break Things", effect: "Innovation ×2.5 & auto-buy ×2, but −50% money." },
    shape: { trunkMinors: 4, travelPerGap: 2, branches: [{ offset: -27, pods: 2, minors: 4 }, { offset: 27, pods: 1, minors: 4 }] },
  },
  {
    id: "lean",
    name: "Lean Startup",
    minor: "− cost exponent / cheaper hires",
    notables: [{ title: "Ramen Profitable", effect: "−0.02 cost exponent on all generators." }],
    keystone: { title: "Bootstrapped", effect: "No managers/auto-buy, but base production ×4 and cheaper scaling." },
    shape: { trunkMinors: 4, travelPerGap: 3, branches: [{ offset: -27, pods: 2, minors: 5 }, { offset: 27, pods: 1, minors: 5 }] },
  },
  {
    id: "crunch",
    name: "Crunch Culture",
    minor: "+ output (morale tradeoffs)",
    notables: [{ title: "996", effect: "+40% all output; satisfaction gains halved." }],
    keystone: { title: "Crunch Mode", effect: "Satisfaction pinned at 0, but all output ×2.5." },
    shape: { trunkMinors: 4, travelPerGap: 4, branches: [{ offset: -27, pods: 1, minors: 5 }, { offset: 27, pods: 1, minors: 5 }] },
  },
  {
    id: "aihype",
    name: "AI Hype",
    minor: "+ vibe-coder output",
    notables: [{ title: "Prompt Whisperer", effect: "Vibe coders ×1.6 money & innovation." }],
    keystone: { title: "AGI-Pilled", effect: "Interns & 10x worse; vibe coders ×5 + double base & singularity." },
    shape: { trunkMinors: 4, travelPerGap: 3, branches: [{ offset: -27, pods: 2, minors: 4 }, { offset: 27, pods: 1, minors: 5 }] },
  },
  {
    id: "empire",
    name: "Empire Building",
    minor: "+ per-employee scaling",
    notables: [
      { title: "Headcount Is Strategy", effect: "+0.4% money per total employee." },
      { title: "Conglomerate", effect: "+3% all output per generator type with ≥50 owned." },
    ],
    shape: { trunkMinors: 4, travelPerGap: 3, branches: [{ offset: -27, pods: 2, minors: 5 }, { offset: 27, pods: 1, minors: 4 }] },
  },
  {
    id: "opensource",
    name: "Open Source",
    minor: "+ innovation / conversion",
    notables: [
      { title: "Open Core", effect: "Convert 15% of innovation/sec into money/sec." },
      { title: "Foundation Grant", effect: "+20% innovation; innovation also +10% valuation." },
    ],
    shape: { trunkMinors: 4, travelPerGap: 3, branches: [{ offset: -27, pods: 1, minors: 6 }, { offset: 27, pods: 1, minors: 5 }] },
  },
  {
    id: "exit",
    name: "Exit Strategy",
    minor: "+ Equity / offline",
    notables: [{ title: "Serial Founder", effect: "+25% Equity from acquisitions." }],
    keystone: { title: "Permanent Acqui-hire", effect: "Each Exit grants free starting generator levels, but halves Equity payout." },
    shape: { trunkMinors: 4, travelPerGap: 4, branches: [{ offset: -27, pods: 2, minors: 4 }, { offset: 27, pods: 1, minors: 4 }] },
  },
  {
    id: "founder",
    name: "Founder Cult",
    minor: "+ money / innovation",
    notables: [
      { title: "Founder Worship", effect: "Your founder's modifiers amplified +50%." },
      { title: "Cult of Personality", effect: "+30% valuation/sec while playing The Hustler." },
    ],
    shape: { trunkMinors: 4, travelPerGap: 2, branches: [{ offset: -27, pods: 1, minors: 5 }, { offset: 27, pods: 1, minors: 5 }] },
  },
  {
    id: "enshit",
    name: "Enshittification",
    minor: "+ money (− quality)",
    notables: [{ title: "Monetize Everything", effect: "+50% money, −25% innovation." }],
    keystone: { title: "Enshittify", effect: "Money +200%, but innovation −80% and satisfaction bonuses off." },
    shape: { trunkMinors: 4, travelPerGap: 3, branches: [{ offset: -27, pods: 2, minors: 5 }, { offset: 27, pods: 1, minors: 4 }] },
  },
];

const FREE_NOTABLE = {
  title: "Hockey Stick",
  effect: "Your global multiplier grows over the run (resets on acquisition).",
};

// ─── Procedural layout (organic, PoE1-style) ─────────────────────────────────
// NOT a grid: clusters are scattered with seeded jitter and joined by WINDING
// travel paths in a mostly-tree structure (core → inner cluster → satellites),
// so there are no regular polygons / connected rings. Deterministic per `seed`.
const ROMAN = ["I", "II", "III", "IV", "V", "VI"];
const LAYOUT_SEED = 1437; // zero node/edge overlaps — verified by geometry check

type Pt = { x: number; y: number };
const unit = (a: number): Pt => ({ x: Math.cos(a), y: Math.sin(a) });
const addv = (p: Pt, d: Pt, s: number): Pt => ({ x: p.x + d.x * s, y: p.y + d.y * s });
const lerp = (a: Pt, b: Pt, f: number): Pt => ({ x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f });
const polar = (r: number, a: number): Pt => ({ x: Math.cos(a) * r, y: Math.sin(a) * r });

/** Deterministic PRNG so the "random" layout is fixed across reloads. */
const mulberry32 = (a: number) => () => {
  a |= 0;
  a = (a + 0x6d2b79f5) | 0;
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

export function buildTree(seed: number): SkillTree {
  const rng = mulberry32(seed);
  const jit = (amp: number) => (rng() * 2 - 1) * amp;
  const nodes: SkillNode[] = [];
  const edges: SkillEdge[] = [];
  const add = (n: SkillNode) => nodes.push(n);
  const link = (a: string, b: string) => edges.push([a, b]);

  const SPACING = 430; // min distance between cluster hubs
  const CORE_MIN = 380; // keep the first ring of clusters off the core
  const BANDS = [450, 780, 1110, 1440, 1770]; // radial bands clusters march out along
  const SP_RIN = 60; // spiral inner radius (first minor off the hub)
  const SP_ROUT = 112; // spiral outer radius (the gated notable at the tail)
  const SP_REACH = SP_ROUT + 38; // furthest a cluster's geometry extends from its hub
  const SP_WIND = 1.7 * Math.PI; // total turn of the spiral
  const HUB_CLEAR = SP_REACH; // links start/end outside a cluster's spiral

  add({ id: "core", x: 0, y: 0, title: "Incorporation", kind: "root", cluster: "core" });
  const hp = polar(195, -Math.PI / 2 + Math.PI / CLUSTERS.length);
  add({ id: "hockey_stick", x: hp.x, y: hp.y, title: FREE_NOTABLE.title, kind: "notable", cluster: "core", effect: FREE_NOTABLE.effect });
  link("core", "hockey_stick");

  // ── Scatter cluster hubs, one theme per angular sector, marching outward.
  // Spacing-rejection keeps hubs apart so no two spirals can overlap; per-hub
  // jitter keeps the field organic rather than a regular ring. Each hub is a bare
  // travel node where inter-cluster links meet; the cluster's minors + notable
  // are emitted later as a spiral once we know which way the parent link arrives.
  type Hub = {
    id: string;
    x: number;
    y: number;
    cluster: string;
    name: string;
    minor: string;
    end: { title: string; effect: string };
  };
  type Keystone = { id: string; x: number; y: number; cluster: string; title: string; effect: string };
  const hubs: Hub[] = [];
  const keystones: Keystone[] = [];
  const farEnough = (x: number, y: number) =>
    Math.hypot(x, y) >= CORE_MIN &&
    hubs.every((h) => Math.hypot(h.x - x, h.y - y) >= SPACING) &&
    keystones.every((kk) => Math.hypot(kk.x - x, kk.y - y) >= SPACING);

  CLUSTERS.forEach((cluster, i) => {
    const sector = (i / CLUSTERS.length) * Math.PI * 2 - Math.PI / 2;
    const constellationCount = 4;
    const slots = constellationCount + (cluster.keystone ? 1 : 0);
    let cursor = 0;
    const nextNotable = () => {
      const sig = cluster.notables[cursor];
      const out = sig ?? {
        title: `${cluster.name} ${ROMAN[cursor] ?? cursor + 1}`,
        effect: `Greater ${cluster.minor}`,
      };
      cursor++;
      return out;
    };

    for (let s = 0; s < slots; s++) {
      const band = BANDS[Math.min(s, BANDS.length - 1)];
      let placed: { x: number; y: number } | null = null;
      for (let tries = 0; tries < 16 && !placed; tries++) {
        const a = sector + jit(0.3);
        const r = band + jit(95);
        const p = polar(r, a);
        if (farEnough(p.x, p.y)) placed = p;
      }
      if (!placed) continue; // crowded — skip this slot rather than overlap

      const isKey = !!cluster.keystone && s === slots - 1;
      if (isKey && cluster.keystone) {
        // Keystones are standalone — no spiral, no hub. Placed here for spacing;
        // attached later by a single long link from the nearest pathing node.
        keystones.push({ id: `${cluster.id}_keystone`, x: placed.x, y: placed.y, cluster: cluster.id, title: cluster.keystone.title, effect: cluster.keystone.effect });
        continue;
      }
      const id = `${cluster.id}_h${s}`;
      add({ id, x: placed.x, y: placed.y, title: "Junction", kind: "travel", cluster: cluster.id });
      hubs.push({ id, x: placed.x, y: placed.y, cluster: cluster.id, name: cluster.name, minor: cluster.minor, end: nextNotable() });
    }
  });

  // ── Connect hubs with a Euclidean minimum spanning tree. An EMST is planar
  // (no two edges cross) and acyclic (no cycles → no polygons) — exactly the
  // organic, branching feel of a real passive tree. Core is the MST root.
  const pts = [{ id: "core", x: 0, y: 0 }, ...hubs];
  const n = pts.length;
  const inTree = new Array(n).fill(false);
  const dist = pts.map((p) => Math.hypot(p.x, p.y));
  const parent = new Array(n).fill(0);
  inTree[0] = true;
  for (let k = 1; k < n; k++) {
    let u = -1;
    let bestD = Infinity;
    for (let v = 0; v < n; v++) {
      if (!inTree[v] && dist[v] < bestD) {
        bestD = dist[v];
        u = v;
      }
    }
    if (u < 0) break;
    inTree[u] = true;
    for (let v = 0; v < n; v++) {
      if (!inTree[v]) {
        const d = Math.hypot(pts[u].x - pts[v].x, pts[u].y - pts[v].y);
        if (d < dist[v]) {
          dist[v] = d;
          parent[v] = u;
        }
      }
    }
  }

  const clearOf = (idx: number) => (idx === 0 ? 30 : HUB_CLEAR);

  // Children of each pts node (the hubs it is the MST parent of).
  const childrenOf: number[][] = pts.map(() => []);
  for (let v = 1; v < n; v++) childrenOf[parent[v]].push(v);

  // ── Realise the spirals. Each cluster winds a chain of minors out from its hub
  // to a gated notable at the tail. Monotonic angle + radius ⇒ the spiral never
  // self-intersects; it's fitted into the LARGEST free angular gap between the
  // hub's incident links (parent + children), so it can't cross any of them.
  hubs.forEach((h, hi) => {
    const u = hi + 1; // pts index
    const incident: number[] = [];
    const par = pts[parent[u]];
    incident.push(Math.atan2(par.y - h.y, par.x - h.x));
    for (const c of childrenOf[u]) incident.push(Math.atan2(pts[c].y - h.y, pts[c].x - h.x));
    incident.sort((a, b) => a - b);
    // widest angular gap between consecutive incident directions. The wrap-around
    // gap runs from the LAST ray forward to the first (through 2π), so it starts
    // at incident[last] — not incident[0] (that bug let the spiral straddle a link).
    let gapStart = incident[incident.length - 1];
    let gapSize = 2 * Math.PI - (incident[incident.length - 1] - incident[0]);
    for (let j = 1; j < incident.length; j++) {
      const g = incident[j] - incident[j - 1];
      if (g > gapSize) {
        gapSize = g;
        gapStart = incident[j - 1];
      }
    }
    // Fit the spiral STRICTLY inside the free wedge: start `margin` past one edge
    // and stop `margin` before the other. Never floor the winding above the gap —
    // an overflowing spiral is exactly what crosses the hub's own incident links.
    const margin = 0.46;
    const a0 = gapStart + margin;
    const wind = Math.min(SP_WIND, Math.max(0, gapSize - 2 * margin));

    // Step minors along the spiral by arc-length so consecutive nodes keep a
    // fixed gap (≈ STEP) regardless of how tightly the spiral is wound — this is
    // what prevents radial bunching when a wedge is narrow.
    const STEP = 40;
    const at = (t: number) => addv(h, unit(a0 + t * wind), SP_RIN + (SP_ROUT - SP_RIN) * t);
    let prev = h.id;
    let last = { x: h.x, y: h.y };
    let k = 0;
    const samples = 200;
    for (let i = 1; i <= samples; i++) {
      const t = (i / samples) * 0.84; // leave the tail end clear for the notable
      const p = at(t);
      if (Math.hypot(p.x - last.x, p.y - last.y) < STEP) continue;
      k++;
      const mid = `${h.id}_m${k}`;
      add({ id: mid, x: p.x, y: p.y, title: h.name, kind: "minor", cluster: h.cluster, effect: h.minor });
      link(prev, mid);
      prev = mid;
      last = p;
    }
    const tail = addv(h, unit(a0 + wind), SP_ROUT);
    const endId = `${h.id}_n`;
    add({ id: endId, x: tail.x, y: tail.y, title: h.end.title, kind: "notable", cluster: h.cluster, effect: h.end.effect });
    link(prev, endId);
  });

  // ── Realise the inter-cluster links as straight travel-chains hub→hub, trimmed
  // rim-to-rim so they start/end outside each spiral.
  for (let u = 1; u < n; u++) {
    const a = pts[u];
    const b = pts[parent[u]];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len;
    const uy = dy / len;
    const start = { x: a.x + ux * clearOf(u), y: a.y + uy * clearOf(u) };
    const end = { x: b.x - ux * clearOf(parent[u]), y: b.y - uy * clearOf(parent[u]) };
    const span = Math.hypot(end.x - start.x, end.y - start.y);
    const travel = Math.max(1, Math.min(4, Math.round(span / 120)));
    let prev = b.id;
    for (let t = travel; t >= 1; t--) {
      const f = t / (travel + 1);
      const p = lerp(start, end, f);
      const id = `link_${u}_${t}`;
      add({ id, x: p.x, y: p.y, title: "Travel", kind: "travel", cluster: "path" });
      link(prev, id);
      prev = id;
    }
    link(prev, a.id);
  }

  // ── Attach keystones as standalone pendants: a single long link from the
  // nearest PATHING node (a junction/travel node) whose connecting line is clear
  // of every other node and edge. No travel chain — just one reasonably long line.
  const radiusOf = (kind: SkillNodeKind) =>
    kind === "keystone" ? 48 : kind === "notable" ? 24 : kind === "root" ? 20 : 15;
  type Pt = { x: number; y: number };
  const segDist = (p: Pt, a: Pt, b: Pt) => {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const l2 = dx * dx + dy * dy || 1;
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2));
    return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
  };
  const ccw = (a: Pt, b: Pt, c: Pt) => (c.y - a.y) * (b.x - a.x) - (b.y - a.y) * (c.x - a.x);
  const crosses = (a: Pt, b: Pt, c: Pt, d: Pt) =>
    ccw(c, d, a) > 0 !== ccw(c, d, b) > 0 && ccw(a, b, c) > 0 !== ccw(a, b, d) > 0;
  const byId = () => new Map(nodes.map((nn) => [nn.id, nn]));
  const segClear = (A: Pt, B: Pt, excl: Set<string>) => {
    for (const m of nodes) {
      if (excl.has(m.id)) continue;
      if (segDist(m, A, B) < radiusOf(m.kind) + 6) return false;
    }
    const pm = byId();
    for (const [e1, e2] of edges) {
      if (excl.has(e1) || excl.has(e2)) continue;
      if (crosses(A, B, pm.get(e1)!, pm.get(e2)!)) return false;
    }
    return true;
  };

  for (const ks of keystones) {
    add({ id: ks.id, x: ks.x, y: ks.y, title: ks.title, kind: "keystone", cluster: ks.cluster, effect: ks.effect });
    // pathing targets = junction/travel nodes, nearest first
    const targets = nodes
      .filter((m) => m.kind === "travel")
      .map((m) => ({ m, d: Math.hypot(m.x - ks.x, m.y - ks.y) }))
      .sort((p, q) => p.d - q.d);
    let connected = false;
    for (const { m } of targets) {
      const ux = (ks.x - m.x) / (Math.hypot(ks.x - m.x, ks.y - m.y) || 1);
      const uy = (ks.y - m.y) / (Math.hypot(ks.x - m.x, ks.y - m.y) || 1);
      const A = { x: m.x + ux * radiusOf(m.kind), y: m.y + uy * radiusOf(m.kind) };
      const B = { x: ks.x - ux * 48, y: ks.y - uy * 48 };
      if (!segClear(A, B, new Set([m.id, ks.id]))) continue;
      link(m.id, ks.id);
      connected = true;
      break;
    }
    if (!connected) link(targets[0].m.id, ks.id); // fallback (seed search rejects)
  }

  return { nodes, edges, roots: ["core"] };
}


export const SKILL_TREE: SkillTree = buildTree(LAYOUT_SEED);

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
 * either a root or adjacent to an allocated node.
 */
export function isReachable(
  tree: SkillTree,
  allocated: ReadonlySet<string>,
  id: string,
  adjacency: Map<string, Set<string>> = buildAdjacency(tree),
): boolean {
  if (allocated.has(id)) return false;
  if (tree.roots.includes(id)) return true;
  const neighbours = adjacency.get(id);
  if (!neighbours) return false; // unknown / isolated node
  for (const n of neighbours) if (allocated.has(n)) return true;
  return false;
}

/**
 * Whether removing `id` keeps every *other* allocated node still connected to a
 * root (so refunding it doesn't orphan the rest). Roots can't be removed.
 */
export function canRemoveWithoutOrphan(
  tree: SkillTree,
  allocated: ReadonlySet<string>,
  id: string,
  adjacency: Map<string, Set<string>> = buildAdjacency(tree),
): boolean {
  if (!allocated.has(id) || tree.roots.includes(id)) return false;
  const remaining = new Set(allocated);
  remaining.delete(id);
  if (remaining.size === 0) return true;
  const startRoots = tree.roots.filter((r) => remaining.has(r));
  if (startRoots.length === 0) return false;
  const seen = new Set<string>(startRoots);
  const queue = [...startRoots];
  while (queue.length) {
    const cur = queue.pop()!;
    for (const n of adjacency.get(cur) ?? []) {
      if (remaining.has(n) && !seen.has(n)) {
        seen.add(n);
        queue.push(n);
      }
    }
  }
  return seen.size === remaining.size;
}

/**
 * Fewest-node path of UNALLOCATED nodes from the allocated frontier to `target`
 * (inclusive of target, in allocate order). If nothing is allocated yet the path
 * starts from the roots (so it includes the root you'd buy first). Empty if the
 * target is already allocated or unreachable.
 */
export function frontierPath(
  tree: SkillTree,
  allocated: ReadonlySet<string>,
  target: string,
  adjacency: Map<string, Set<string>> = buildAdjacency(tree),
): string[] {
  if (allocated.has(target)) return [];
  const sources = allocated.size ? [...allocated] : tree.roots;
  const prev = new Map<string, string | null>();
  const queue: string[] = [];
  for (const s of sources) {
    prev.set(s, null);
    queue.push(s);
  }
  let head = 0;
  let found = false;
  while (head < queue.length) {
    const cur = queue[head++];
    if (cur === target) {
      found = true;
      break;
    }
    for (const n of adjacency.get(cur) ?? []) {
      if (!prev.has(n)) {
        prev.set(n, cur);
        queue.push(n);
      }
    }
  }
  if (!found) return [];
  const path: string[] = [];
  let cur: string | null = target;
  while (cur != null && !allocated.has(cur)) {
    path.push(cur);
    cur = prev.get(cur) ?? null;
  }
  return path.reverse();
}

/** Total Equity to allocate `pathLen` more nodes, given how many are already
 * allocated (each successive node costs more — see {@link nodeCost}). */
export function pathEquityCost(allocatedCount: number, pathLen: number): number {
  let sum = 0;
  for (let i = 0; i < pathLen; i++) sum += nodeCost(allocatedCount + i);
  return sum;
}

/**
 * Every allocated node that must be refunded to remove `id` without orphaning
 * anything: `id` plus all allocated nodes that can only reach a root THROUGH
 * `id` (its dependents). `id` is first; the rest are its leaf-ward subtree.
 * Empty if `id` isn't allocated or is a root (roots are never removable).
 */
export function nodesToRemove(
  tree: SkillTree,
  allocated: ReadonlySet<string>,
  id: string,
  adjacency: Map<string, Set<string>> = buildAdjacency(tree),
): string[] {
  if (!allocated.has(id) || tree.roots.includes(id)) return [];
  const remaining = new Set(allocated);
  remaining.delete(id);
  const startRoots = tree.roots.filter((r) => remaining.has(r));
  const seen = new Set<string>(startRoots);
  const queue = [...startRoots];
  while (queue.length) {
    const cur = queue.pop()!;
    for (const n of adjacency.get(cur) ?? []) {
      if (remaining.has(n) && !seen.has(n)) {
        seen.add(n);
        queue.push(n);
      }
    }
  }
  const out = [id];
  for (const a of allocated) if (a !== id && !seen.has(a)) out.push(a);
  return out;
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
