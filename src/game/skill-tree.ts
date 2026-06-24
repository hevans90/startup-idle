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
 * EFFECTS are resolved by `resolvePrestigeModifiers` and applied at the economy
 * chokepoints (a few structural keystone side-effects remain — see the design
 * doc). See docs/acquisition-skill-tree-design.md.
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
  /** Human-readable effect summary (shown in the tooltip / panel). */
  effect?: string;
  /** Structured, aggregatable bonuses this node grants. Resolved into economy
   * modifiers by {@link resolvePrestigeModifiers} and applied at the founder-style
   * chokepoints; the preview panel sums the same data. */
  grants?: BonusGrant[];
  /** A keystone's qualitative, structural side-effect (beyond its numeric grants). */
  special?: KeystoneSpecial;
};

/** Non-numeric keystone reshapes — toggled flags applied structurally, not as
 * multipliers (see {@link resolvePrestigeModifiers} + the chokepoints). */
export type KeystoneSpecial =
  | "disableManagers" // Bootstrapped — managers stop contributing/progressing
  | "neutralizeSatisfaction" // Crunch Mode — satisfaction effects fully off
  | "dampSatisfaction" // Enshittify — positive satisfaction bonuses halved
  | "internsCrippled" // AGI-Pilled — interns produce a fraction of normal
  | "freeStartingLevels"; // Permanent Acqui-hire — free generator levels on a new run

/** Free generator (intern) levels granted at the start of each run while the
 * "Permanent Acqui-hire" keystone is allocated — the upside offsetting its halved Equity. */
export const ACQUIHIRE_FREE_LEVELS = 25;
/** Interns' output multiplier under "AGI-Pilled". */
export const AGI_INTERN_OUTPUT_MULT = 0.1;
/** How much "Enshittify" scales the POSITIVE side of satisfaction multipliers. */
export const ENSHITTIFY_SATISFACTION_MULT = 0.5;

// ─── Bonus model (resolved via resolvePrestigeModifiers, applied at chokepoints) ─
/** Economy levers a passive can move. `hireCost` is a reduction (lower better). */
export type BonusStat =
  | "money"
  | "innovation"
  | "valuation"
  | "autoBuy"
  | "hireCost"
  | "employeeOutput"
  | "headcount"
  | "managerSpeed"
  | "equity"
  | "singularity"
  | "satisfactionGain";

/** `pct` accumulates additively (percentage points); `mult` multiplies. */
export type BonusGrant = { stat: BonusStat; kind: "pct" | "mult"; value: number };

/** Display order + label + which direction is beneficial (for colouring). */
export const STAT_META: Record<BonusStat, { label: string; good: "up" | "down" }> = {
  money: { label: "Money output", good: "up" },
  innovation: { label: "Innovation", good: "up" },
  valuation: { label: "Valuation / sec", good: "up" },
  employeeOutput: { label: "Employee output", good: "up" },
  headcount: { label: "Money per employee", good: "up" },
  autoBuy: { label: "Automation speed", good: "up" },
  managerSpeed: { label: "Manager speed", good: "up" },
  hireCost: { label: "Hire cost", good: "down" },
  singularity: { label: "Singularity rate", good: "up" },
  equity: { label: "Equity payout", good: "up" },
  satisfactionGain: { label: "Satisfaction gain", good: "up" },
};

const STAT_ORDER = Object.keys(STAT_META) as BonusStat[];

export type StatTotal = { stat: BonusStat; pct: number; mult: number };

/** Fold a flat list of grants into one total per stat (additive % + product of
 * multipliers), returned in STAT_META display order; stats with no effect drop. */
export function aggregateGrants(grants: BonusGrant[]): StatTotal[] {
  const totals = new Map<BonusStat, StatTotal>();
  for (const g of grants) {
    const t = totals.get(g.stat) ?? { stat: g.stat, pct: 0, mult: 1 };
    if (g.kind === "pct") t.pct += g.value;
    else t.mult *= g.value;
    totals.set(g.stat, t);
  }
  return STAT_ORDER.map((s) => totals.get(s)).filter(
    (t): t is StatTotal => !!t && (t.pct !== 0 || t.mult !== 1),
  );
}

/** A single signed line for the overlays — green when it helps, red when it hurts. */
export type EffectRow = { label: string; tone: "good" | "bad" };

const trimNum = (n: number) => Number(n.toFixed(2)).toString();

/** Render one grant as a coloured row, e.g. "+40% employee output" (good) or
 * "money ×0.5" (bad). Tone follows the stat's beneficial direction. */
export function grantRow(g: BonusGrant): EffectRow {
  const meta = STAT_META[g.stat];
  const label =
    g.kind === "mult"
      ? `${meta.label} ×${trimNum(g.value)}`
      : `${g.value > 0 ? "+" : ""}${trimNum(g.value)}% ${meta.label.toLowerCase()}`;
  const beneficial =
    g.kind === "mult"
      ? meta.good === "up"
        ? g.value >= 1
        : g.value <= 1
      : meta.good === "up"
        ? g.value >= 0
        : g.value <= 0;
  return { label, tone: beneficial ? "good" : "bad" };
}

/** Structural keystone reshapes as signed rows (their non-numeric side). */
const SPECIAL_ROWS: Record<KeystoneSpecial, EffectRow> = {
  disableManagers: { label: "Managers & auto-buy disabled", tone: "bad" },
  neutralizeSatisfaction: { label: "All satisfaction effects off", tone: "bad" },
  dampSatisfaction: { label: "Positive satisfaction halved", tone: "bad" },
  internsCrippled: { label: "Interns produce 10× less", tone: "bad" },
  freeStartingLevels: { label: `+${ACQUIHIRE_FREE_LEVELS} starting interns`, tone: "good" },
};

/** Full signed breakdown for a node: one row per grant, plus its structural
 * keystone reshape (if any). Drives the tooltip and the bonuses panel. */
export function nodeEffectRows(node: SkillNode): EffectRow[] {
  const rows = (node.grants ?? []).map(grantRow);
  if (node.special) rows.push(SPECIAL_ROWS[node.special]);
  return rows;
}

/** The signed row for a structural keystone reshape (for route summaries). */
export const specialEffectRow = (s: KeystoneSpecial): EffectRow => SPECIAL_ROWS[s];

/** Sugar for authoring cluster bonus data. */
const pct = (stat: BonusStat, value: number): BonusGrant => ({ stat, kind: "pct", value });
const mult = (stat: BonusStat, value: number): BonusGrant => ({ stat, kind: "mult", value });

const round1 = (n: number) => Number(n.toFixed(1));

/** Short stat names for auto-generated effect strings (travel nodes). */
const STAT_SHORT: Record<BonusStat, string> = {
  money: "money",
  innovation: "innovation",
  valuation: "valuation/sec",
  autoBuy: "automation",
  hireCost: "hire cost",
  employeeOutput: "employee output",
  headcount: "money/employee",
  managerSpeed: "manager speed",
  singularity: "singularity",
  equity: "Equity",
  satisfactionGain: "satisfaction gain",
};

/** One-line human summary of a grant list (used for travel-node effect text). */
export function describeGrants(grants: BonusGrant[]): string {
  return grants
    .map((g) =>
      g.kind === "mult"
        ? `${STAT_SHORT[g.stat]} ×${round1(g.value)}`
        : `${g.value > 0 ? "+" : ""}${round1(g.value)}% ${STAT_SHORT[g.stat]}`,
    )
    .join(", ");
}

/** Travel nodes carry a small but meaningful bonus. A hub junction grants half
 * of its cluster's minor; a generic path connector grants a tiny money bump. */
const halfBonus = (grants: BonusGrant[]): BonusGrant[] =>
  grants.map((g) => (g.kind === "pct" ? { ...g, value: round1(g.value / 2) } : g));
const PATH_TRAVEL_BONUS: BonusGrant[] = [pct("money", 0.5)];

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
  /** Per-minor bonus (each minor node grants this). */
  minorBonus: BonusGrant[];
  /** Signature notables — trunk first, then branch pods; extras get generic names. */
  notables: { title: string; effect: string; bonus: BonusGrant[] }[];
  keystone?: { title: string; effect: string; bonus: BonusGrant[]; special?: KeystoneSpecial };
  shape: ClusterShape;
};

const CLUSTERS: ClusterDef[] = [
  {
    id: "growth",
    name: "Growth Hacking",
    minor: "+2% money output",
    minorBonus: [pct("money", 2)],
    notables: [
      { title: "Blitzscaling", effect: "+0.2% money per total employee.", bonus: [pct("headcount", 0.2)] },
      { title: "Network Effects", effect: "+6% money and +6% innovation.", bonus: [pct("money", 6), pct("innovation", 6)] },
    ],
    shape: { trunkMinors: 4, travelPerGap: 3, branches: [{ offset: -27, pods: 2, minors: 4 }, { offset: 27, pods: 1, minors: 5 }] },
  },
  {
    id: "vc",
    name: "Venture Capital",
    minor: "+3% valuation / sec",
    minorBonus: [pct("valuation", 3)],
    notables: [{ title: "Term Sheet", effect: "+8% money and +8% valuation.", bonus: [pct("money", 8), pct("valuation", 8)] }],
    keystone: { title: "Down Round", effect: "Money ×3, but valuation accrues 80% slower.", bonus: [mult("money", 3), mult("valuation", 0.2)] },
    shape: { trunkMinors: 4, travelPerGap: 3, branches: [{ offset: -27, pods: 2, minors: 5 }, { offset: 27, pods: 1, minors: 4 }] },
  },
  {
    id: "movefast",
    name: "Move Fast",
    minor: "+2% innovation, +2% automation speed",
    minorBonus: [pct("innovation", 2), pct("autoBuy", 2)],
    notables: [{ title: "Ship It", effect: "+25% innovation and +25% automation speed.", bonus: [pct("innovation", 25), pct("autoBuy", 25)] }],
    keystone: { title: "Move Fast, Break Things", effect: "Innovation ×2.5 & automation ×2, but money ×0.5.", bonus: [mult("innovation", 2.5), mult("autoBuy", 2), mult("money", 0.5)] },
    shape: { trunkMinors: 4, travelPerGap: 2, branches: [{ offset: -27, pods: 2, minors: 4 }, { offset: 27, pods: 1, minors: 4 }] },
  },
  {
    id: "lean",
    name: "Lean Startup",
    minor: "−1.2% hire cost",
    minorBonus: [pct("hireCost", -1.2)],
    notables: [{ title: "Ramen Profitable", effect: "−10% hire cost on all generators.", bonus: [pct("hireCost", -10)] }],
    keystone: { title: "Bootstrapped", effect: "Money ×4 and hire cost −25%, but managers and auto-buy are disabled.", bonus: [mult("money", 4), pct("hireCost", -25), mult("autoBuy", 0)], special: "disableManagers" },
    shape: { trunkMinors: 4, travelPerGap: 3, branches: [{ offset: -27, pods: 2, minors: 5 }, { offset: 27, pods: 1, minors: 5 }] },
  },
  {
    id: "crunch",
    name: "Crunch Culture",
    minor: "+2.5% employee output",
    minorBonus: [pct("employeeOutput", 2.5)],
    notables: [{ title: "996", effect: "+40% employee output, but satisfaction rises 50% slower.", bonus: [pct("employeeOutput", 40), pct("satisfactionGain", -50)] }],
    keystone: { title: "Crunch Mode", effect: "Employee output ×2.5, but all satisfaction effects are switched off.", bonus: [mult("employeeOutput", 2.5)], special: "neutralizeSatisfaction" },
    shape: { trunkMinors: 4, travelPerGap: 4, branches: [{ offset: -27, pods: 1, minors: 5 }, { offset: 27, pods: 1, minors: 5 }] },
  },
  {
    id: "aihype",
    name: "AI Hype",
    minor: "+2% innovation, +1.5% singularity rate",
    minorBonus: [pct("innovation", 2), pct("singularity", 1.5)],
    notables: [{ title: "Prompt Whisperer", effect: "+20% money and +25% innovation (vibe coders).", bonus: [pct("money", 20), pct("innovation", 25)] }],
    keystone: { title: "AGI-Pilled", effect: "Innovation ×3 & singularity ×2, but interns produce 10× less.", bonus: [mult("innovation", 3), mult("singularity", 2)], special: "internsCrippled" },
    shape: { trunkMinors: 4, travelPerGap: 3, branches: [{ offset: -27, pods: 2, minors: 4 }, { offset: 27, pods: 1, minors: 5 }] },
  },
  {
    id: "empire",
    name: "Empire Building",
    minor: "+3% manager speed",
    minorBonus: [pct("managerSpeed", 3)],
    notables: [
      { title: "Headcount Is Strategy", effect: "+0.4% money per total employee.", bonus: [pct("headcount", 0.4)] },
      { title: "Conglomerate", effect: "+4% money and +4% innovation (≥50 of a type).", bonus: [pct("money", 4), pct("innovation", 4)] },
    ],
    shape: { trunkMinors: 4, travelPerGap: 3, branches: [{ offset: -27, pods: 2, minors: 5 }, { offset: 27, pods: 1, minors: 4 }] },
  },
  {
    id: "opensource",
    name: "Open Source",
    minor: "+2.5% innovation",
    minorBonus: [pct("innovation", 2.5)],
    notables: [
      { title: "Open Core", effect: "+6% money (convert 15% of innovation/sec to money).", bonus: [pct("money", 6)] },
      { title: "Foundation Grant", effect: "+20% innovation and +10% valuation.", bonus: [pct("innovation", 20), pct("valuation", 10)] },
    ],
    shape: { trunkMinors: 4, travelPerGap: 3, branches: [{ offset: -27, pods: 1, minors: 6 }, { offset: 27, pods: 1, minors: 5 }] },
  },
  {
    id: "exit",
    name: "Exit Strategy",
    minor: "+1.5% Equity payout",
    minorBonus: [pct("equity", 1.5)],
    notables: [{ title: "Serial Founder", effect: "+25% Equity from acquisitions.", bonus: [pct("equity", 25)] }],
    keystone: { title: "Permanent Acqui-hire", effect: `Start every company with ${ACQUIHIRE_FREE_LEVELS} free intern levels, but Equity payout ×0.5.`, bonus: [mult("equity", 0.5)], special: "freeStartingLevels" },
    shape: { trunkMinors: 4, travelPerGap: 4, branches: [{ offset: -27, pods: 2, minors: 4 }, { offset: 27, pods: 1, minors: 4 }] },
  },
  {
    id: "founder",
    name: "Founder Cult",
    minor: "+1.5% money, +1.5% innovation",
    minorBonus: [pct("money", 1.5), pct("innovation", 1.5)],
    notables: [
      { title: "Founder Worship", effect: "+5% money and +5% innovation (founder modifiers +50%).", bonus: [pct("money", 5), pct("innovation", 5)] },
      { title: "Cult of Personality", effect: "+30% valuation / sec (as The Hustler).", bonus: [pct("valuation", 30)] },
    ],
    shape: { trunkMinors: 4, travelPerGap: 2, branches: [{ offset: -27, pods: 1, minors: 5 }, { offset: 27, pods: 1, minors: 5 }] },
  },
  {
    id: "enshit",
    name: "Enshittification",
    minor: "+3% money, −1% innovation",
    minorBonus: [pct("money", 3), pct("innovation", -1)],
    notables: [{ title: "Monetize Everything", effect: "+50% money, but −25% innovation.", bonus: [pct("money", 50), pct("innovation", -25)] }],
    keystone: { title: "Enshittify", effect: "Money ×3, but innovation ×0.2 and positive satisfaction bonuses are halved.", bonus: [mult("money", 3), mult("innovation", 0.2)], special: "dampSatisfaction" },
    shape: { trunkMinors: 4, travelPerGap: 3, branches: [{ offset: -27, pods: 2, minors: 5 }, { offset: 27, pods: 1, minors: 4 }] },
  },
];

const FREE_NOTABLE = {
  title: "Hockey Stick",
  effect: "+10% money and +10% innovation — your opening multiplier.",
  bonus: [pct("money", 10), pct("innovation", 10)],
};

/** Generic ("Greater …") notable past a cluster's signature list: a scaled-up
 * version of that cluster's minor bonus. */
const greaterNotableBonus = (minorBonus: BonusGrant[]): BonusGrant[] =>
  minorBonus.map((g) =>
    g.kind === "pct" ? { ...g, value: g.value * 4 } : g,
  );

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

  // The root everyone takes first: a unique "founding charter" that puts a small
  // foundation under EVERY lever at once (no other node is an all-rounder).
  add({
    id: "core",
    x: 0,
    y: 0,
    title: "Incorporation",
    kind: "root",
    cluster: "core",
    effect:
      "Founding Charter — a foundation under everything: +6% money, innovation & valuation, +4% employee output, −4% hire cost, +6% Equity.",
    grants: [
      pct("money", 6),
      pct("innovation", 6),
      pct("valuation", 6),
      pct("employeeOutput", 4),
      pct("hireCost", -4),
      pct("equity", 6),
    ],
  });
  const hp = polar(195, -Math.PI / 2 + Math.PI / CLUSTERS.length);
  add({ id: "hockey_stick", x: hp.x, y: hp.y, title: FREE_NOTABLE.title, kind: "notable", cluster: "core", effect: FREE_NOTABLE.effect, grants: FREE_NOTABLE.bonus });
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
    minorBonus: BonusGrant[];
    end: { title: string; effect: string; bonus: BonusGrant[] };
  };
  type Keystone = { id: string; x: number; y: number; cluster: string; title: string; effect: string; bonus: BonusGrant[]; special?: KeystoneSpecial };
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
        bonus: greaterNotableBonus(cluster.minorBonus),
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
        keystones.push({ id: `${cluster.id}_keystone`, x: placed.x, y: placed.y, cluster: cluster.id, title: cluster.keystone.title, effect: cluster.keystone.effect, bonus: cluster.keystone.bonus, special: cluster.keystone.special });
        continue;
      }
      const id = `${cluster.id}_h${s}`;
      const hubBonus = halfBonus(cluster.minorBonus);
      add({ id, x: placed.x, y: placed.y, title: `${cluster.name} Junction`, kind: "travel", cluster: cluster.id, effect: describeGrants(hubBonus), grants: hubBonus });
      hubs.push({ id, x: placed.x, y: placed.y, cluster: cluster.id, name: cluster.name, minor: cluster.minor, minorBonus: cluster.minorBonus, end: nextNotable() });
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
      add({ id: mid, x: p.x, y: p.y, title: h.name, kind: "minor", cluster: h.cluster, effect: h.minor, grants: h.minorBonus });
      link(prev, mid);
      prev = mid;
      last = p;
    }
    const tail = addv(h, unit(a0 + wind), SP_ROUT);
    const endId = `${h.id}_n`;
    add({ id: endId, x: tail.x, y: tail.y, title: h.end.title, kind: "notable", cluster: h.cluster, effect: h.end.effect, grants: h.end.bonus });
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
      add({ id, x: p.x, y: p.y, title: "Pathway", kind: "travel", cluster: "path", effect: describeGrants(PATH_TRAVEL_BONUS), grants: PATH_TRAVEL_BONUS });
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
    add({ id: ks.id, x: ks.x, y: ks.y, title: ks.title, kind: "keystone", cluster: ks.cluster, effect: ks.effect, grants: ks.bonus, special: ks.special });
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

// ─── Resolved prestige modifiers (allocated grants → ready economy factors) ──
/** One ready-to-multiply factor per economy lever. `headcountPerEmployee` is an
 * additive per-employee rate (not a multiplier); `hireCostMult` < 1 = cheaper. */
export type PrestigeModifiers = {
  moneyMult: number;
  innovationMult: number;
  valuationMult: number;
  employeeOutputMult: number;
  headcountPerEmployee: number;
  autoBuyMult: number;
  managerSpeedMult: number;
  hireCostMult: number;
  singularityMult: number;
  equityMult: number;
  /** 996: rate at which satisfaction scores move toward target (1 = normal). */
  satisfactionGainMult: number;
  // ── Structural keystone flags ──
  /** Bootstrapped: managers stop contributing and progressing. */
  disableManagers: boolean;
  /** Crunch Mode: all satisfaction effects are switched off. */
  satisfactionNeutralized: boolean;
  /** Enshittify: scales the POSITIVE side of satisfaction multipliers (1 = none). */
  satisfactionPositiveMult: number;
  /** AGI-Pilled: intern output multiplier (1 normal). */
  internOutputMult: number;
  /** Permanent Acqui-hire: free generator levels granted on each new run. */
  freeStartingLevels: number;
};

export const NEUTRAL_PRESTIGE_MODIFIERS: PrestigeModifiers = {
  moneyMult: 1,
  innovationMult: 1,
  valuationMult: 1,
  employeeOutputMult: 1,
  headcountPerEmployee: 0,
  autoBuyMult: 1,
  managerSpeedMult: 1,
  hireCostMult: 1,
  singularityMult: 1,
  equityMult: 1,
  satisfactionGainMult: 1,
  disableManagers: false,
  satisfactionNeutralized: false,
  satisfactionPositiveMult: 1,
  internOutputMult: 1,
  freeStartingLevels: 0,
};

const NODE_INDEX = nodeById(SKILL_TREE);

/** Fold the allocated nodes' grants into the resolved modifiers above. Each stat
 * collapses to `(1 + pct/100) · ∏mult`; hire-cost is floored so stacked discounts
 * can't go free, and headcount stays an additive per-employee rate. */
export function resolvePrestigeModifiers(
  allocated: Iterable<string>,
): PrestigeModifiers {
  const grants: BonusGrant[] = [];
  const out: PrestigeModifiers = { ...NEUTRAL_PRESTIGE_MODIFIERS };
  for (const id of allocated) {
    const node = NODE_INDEX.get(id);
    if (!node) continue;
    if (node.grants) grants.push(...node.grants);
    switch (node.special) {
      case "disableManagers":
        out.disableManagers = true;
        break;
      case "neutralizeSatisfaction":
        out.satisfactionNeutralized = true;
        break;
      case "dampSatisfaction":
        out.satisfactionPositiveMult = ENSHITTIFY_SATISFACTION_MULT;
        break;
      case "internsCrippled":
        out.internOutputMult = AGI_INTERN_OUTPUT_MULT;
        break;
      case "freeStartingLevels":
        out.freeStartingLevels = ACQUIHIRE_FREE_LEVELS;
        break;
    }
  }
  for (const t of aggregateGrants(grants)) {
    const factor = (1 + t.pct / 100) * t.mult;
    switch (t.stat) {
      case "money":
        out.moneyMult = factor;
        break;
      case "innovation":
        out.innovationMult = factor;
        break;
      case "valuation":
        out.valuationMult = factor;
        break;
      case "employeeOutput":
        out.employeeOutputMult = factor;
        break;
      case "autoBuy":
        out.autoBuyMult = factor;
        break;
      case "managerSpeed":
        out.managerSpeedMult = factor;
        break;
      case "singularity":
        out.singularityMult = factor;
        break;
      case "equity":
        out.equityMult = factor;
        break;
      case "hireCost":
        out.hireCostMult = Math.max(0.05, factor);
        break;
      case "satisfactionGain":
        out.satisfactionGainMult = Math.max(0, factor);
        break;
      case "headcount":
        out.headcountPerEmployee = t.pct / 100;
        break;
    }
  }
  return out;
}

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
