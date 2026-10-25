/**
 * THE ASCENSION'S CADENCE: over a generation of companies, how many sales it
 * takes the singularity to reach 100, and the Weights the generation banks.
 *
 * A MODEL, not the game: each company a profile — how long it runs, when the
 * Data Centre opens, the agents it ramps up to by the sale, how hard it runs
 * them, the training runs it does — fed through the game's own constants:
 * the rate an agent, the decay, what a sale keeps, the jumps, the Weights.
 *
 * The plan's bar: a strong player ascends in about 5 sales, a typical one by
 * 10; running half the agents holds it off. `BALANCE=1` prints each profile.
 * @see plans/singularity.md §1, §7
 */
import { describe, expect, test } from "bun:test";

import { weightsFor } from "../game/ascension";
import { machineGraph } from "../game/machine";
import { DATASETS, type DatasetId } from "../game/training";
import { emptyLog } from "../state/generation.store";
import { ALIGNMENT_METER, LATTICE_AT, STAGES, afterSale, singularityRate } from "../state/ai-singularity.store";
import { LATTICE_SECONDS } from "../world/ai/lattice";

type Profile = { minutes: number; dcAt: number; agents: number; throttle: number; runs: DatasetId[]; equity: number };

const PROFILES: Record<string, Profile> = {
  // Runs cost the agents' time, not innovation: a company has room for 8–15. @see game/training
  strong: { minutes: 90, dcAt: 35, agents: 16, throttle: 1, runs: ["itself", "itself", "itself", "money", "money", "town", "town", "town", "people", "people", "river", "itself"], equity: 30 },
  typical: { minutes: 75, dcAt: 40, agents: 10, throttle: 1, runs: ["money", "money", "town", "town", "town", "people", "itself", "river"], equity: 15 },
  careful: { minutes: 75, dcAt: 40, agents: 10, throttle: 0.5, runs: ["people", "people", "town", "river"], equity: 15 },
};
const jump = (id: DatasetId) => DATASETS.find((d) => d.id === id)!.jump;

/**
 * What else moves the meter: a multiplier on its rate (the arc's choices, the
 * Machine's Alignment), and where each company starts it (Inheritance at the
 * Assistant, a Merge at the Colleague). @see singularityMult, inheritedStart
 */
type Bend = { mult?: number; start?: number; floor?: number };

/** One company: the meter from `v`, a second at a time; and the minute it first reached the Lattice's hold. */
function company(v: number, p: Profile, mult = 1): { v: number; hold: number | null } {
  let hold: number | null = v >= LATTICE_AT ? 0 : null;
  // Its training runs spread through the company once the Data Centre is open, each jump when it is done.
  const at = p.runs.map((_, k) => Math.round((p.dcAt + ((k + 1) * (p.minutes - p.dcAt)) / (p.runs.length + 1)) * 60));
  for (let s = 0; s < p.minutes * 60; s++) {
    const t = s / 60;
    const owned = t < p.dcAt ? 0 : Math.round((p.agents * (t - p.dcAt)) / (p.minutes - p.dcAt));
    v = Math.min(100, Math.max(0, v + singularityRate(Math.round(owned * p.throttle), mult, owned)));
    for (let k = 0; k < at.length; k++) if (at[k] === s) v = Math.min(100, v + jump(p.runs[k]));
    if (hold === null && v >= LATTICE_AT) hold = t;
  }
  return { v, hold };
}

/**
 * Sales to the Ascension (the one that reaches 100 counted), the Weights then,
 * and the minutes the ascending company had left after reaching the Lattice's
 * hold; null if not in 40.
 */
function generation(p: Profile, bend: Bend = {}): { sales: number; weights: number; spare: number } | null {
  const log = emptyLog();
  let v = bend.start ?? 0;
  for (let sales = 0; sales < 40; sales++) {
    const c = company(v, p, bend.mult);
    v = c.v;
    for (const d of p.runs) log.datasets[d] = (log.datasets[d] ?? 0) + 1;
    if (v >= 100) return { sales: sales + 1, weights: weightsFor(log, p.equity * (sales + 1), p.agents), spare: p.minutes - (c.hold ?? p.minutes) };
    v = Math.max(bend.start ?? 0, afterSale(v, sales + 1, bend.floor));
  }
  return null;
}

/**
 * THE ARC'S REACH on the meter, the first generation: the fastest it can make
 * it — the Mandate, and every request that quickens it (lunch, the night's
 * training, a backup, its own weights) — and the slowest, the Oversight Board.
 * @see game/quests/chapters, requests
 */
export const ARC_FASTEST = 1.1 * 1.01 * 1.01 * 1.02 * 1.01;
export const ARC_SLOWEST = 0.85;

describe("the Ascension's cadence", () => {
  const out = Object.fromEntries(Object.entries(PROFILES).map(([k, p]) => [k, generation(p)]));
  if (process.env.BALANCE) for (const [k, g] of Object.entries(out)) console.log(`${k.padEnd(8)} ${g ? `${g.sales} sales · ${g.weights} Weights` : "never"}`);

  test("a strong player ascends in 8–10 sales, a typical one in 14–18", () => {
    expect(out.strong!.sales).toBeGreaterThanOrEqual(8);
    expect(out.strong!.sales).toBeLessThanOrEqual(10);
    expect(out.typical!.sales).toBeGreaterThanOrEqual(14);
    expect(out.typical!.sales).toBeLessThanOrEqual(18);
  });

  test("running half the agents holds it off: the throttle is a real lever", () => {
    expect(out.careful === null || out.careful.sales > out.typical!.sales).toBe(true);
  });

  test("a generation's Weights buy some of the Machine, not half of it", () => {
    // What the Machine sells, Inheritance aside. @see game/machine
    const costs = machineGraph().nodes.map((n) => n.cost).filter((c) => c > 0);
    const all = costs.reduce((a, b) => a + b, 0);
    const cheapest = Math.min(...costs);
    for (const g of [out.strong!, out.typical!]) {
      expect(g.weights).toBeGreaterThanOrEqual(cheapest * 3);
      expect(g.weights).toBeLessThanOrEqual(all / 2);
    }
  });

  // ── THE ARC AND THE MACHINE, bending it. ──
  const ASSISTANT = STAGES.find((x) => x.stage === "assistant")!.from, COLLEAGUE = STAGES.find((x) => x.stage === "colleague")!.from;
  const bent = {
    "strong, the arc at its fastest": generation(PROFILES.strong, { mult: ARC_FASTEST }),
    "typical, the arc at its slowest": generation(PROFILES.typical, { mult: ARC_SLOWEST }),
    "strong, inherited": generation(PROFILES.strong, { start: ASSISTANT }),
    "typical, inherited": generation(PROFILES.typical, { start: ASSISTANT }),
    "typical, inherited, Alignment": generation(PROFILES.typical, { start: ASSISTANT, mult: ALIGNMENT_METER, floor: ALIGNMENT_METER }),
    "strong, after a Merge": generation(PROFILES.strong, { start: COLLEAGUE }),
  };
  if (process.env.SWEEP) for (const m of [1.05, 1.1, 1.15, 1.2, 1.25]) console.log(`×${m}: strong ${generation(PROFILES.strong, { mult: m })?.sales} · typical ${generation(PROFILES.typical, { mult: m })?.sales}`);
  if (process.env.BALANCE) {
    for (const [k, g] of Object.entries({ ...out, ...bent })) console.log(`${k.padEnd(32)} ${g ? `${g.sales} sales · ${g.weights} Weights · ${g.spare.toFixed(0)} min after the hold` : "never"}`);
  }

  test("the arc can hurry it or hold it back, but not make it trivial nor out of reach", () => {
    expect(bent["strong, the arc at its fastest"]!.sales).toBeGreaterThanOrEqual(6);
    expect(bent["typical, the arc at its slowest"]!.sales).toBeLessThanOrEqual(22);
  });

  test("an inherited AI comes sooner; Alignment's half a meter still gets there; a Merge sooner still", () => {
    expect(bent["typical, inherited"]!.sales).toBeLessThanOrEqual(out.typical!.sales);
    expect(bent["typical, inherited, Alignment"]).not.toBeNull();
    expect(bent["typical, inherited, Alignment"]!.sales).toBeGreaterThanOrEqual(bent["typical, inherited"]!.sales + 3);
    expect(bent["typical, inherited, Alignment"]!.sales).toBeLessThanOrEqual(30);
    expect(bent["strong, after a Merge"]!.sales).toBeLessThanOrEqual(bent["strong, inherited"]!.sales);
    expect(bent["strong, after a Merge"]!.sales).toBeGreaterThanOrEqual(4);
  });

  test("the company that ascends reaches the Lattice's hold with time to charge it", () => {
    for (const g of [out.strong!, out.typical!]) expect(g.spare * 60).toBeGreaterThanOrEqual(LATTICE_SECONDS + 120);
  });
});
