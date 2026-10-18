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
import { MODULES } from "../game/modules";
import { DATASETS, type DatasetId } from "../game/training";
import { emptyLog } from "../state/generation.store";
import { afterSale, singularityRate } from "../state/ai-singularity.store";

type Profile = { minutes: number; dcAt: number; agents: number; throttle: number; runs: DatasetId[]; equity: number };

const PROFILES: Record<string, Profile> = {
  strong: { minutes: 90, dcAt: 35, agents: 16, throttle: 1, runs: ["itself", "money", "town", "people"], equity: 30 },
  typical: { minutes: 75, dcAt: 40, agents: 10, throttle: 1, runs: ["money", "town"], equity: 15 },
  careful: { minutes: 75, dcAt: 40, agents: 10, throttle: 0.5, runs: ["people"], equity: 15 },
};
const jump = (id: DatasetId) => DATASETS.find((d) => d.id === id)!.jump;

/** One company: the meter from `v`, a second at a time. */
function company(v: number, p: Profile): number {
  for (let s = 0; s < p.minutes * 60; s++) {
    const t = s / 60;
    const owned = t < p.dcAt ? 0 : Math.round((p.agents * (t - p.dcAt)) / (p.minutes - p.dcAt));
    v = Math.min(100, Math.max(0, v + singularityRate(Math.round(owned * p.throttle), 1, owned)));
  }
  return Math.min(100, v + p.runs.reduce((n, d) => n + jump(d), 0));
}

/** Sales to the Ascension (the one that reaches 100 counted), and the Weights then; null if not in 40. */
function generation(p: Profile): { sales: number; weights: number } | null {
  const log = emptyLog();
  let v = 0;
  for (let sales = 0; sales < 40; sales++) {
    v = company(v, p);
    for (const d of p.runs) log.datasets[d] = (log.datasets[d] ?? 0) + 1;
    if (v >= 100) return { sales: sales + 1, weights: weightsFor(log, p.equity * (sales + 1), p.agents) };
    v = afterSale(v, sales + 1);
  }
  return null;
}

describe("the Ascension's cadence", () => {
  const out = Object.fromEntries(Object.entries(PROFILES).map(([k, p]) => [k, generation(p)]));
  if (process.env.BALANCE) for (const [k, g] of Object.entries(out)) console.log(`${k.padEnd(8)} ${g ? `${g.sales} sales · ${g.weights} Weights` : "never"}`);

  test("a strong player ascends in about 5 sales, a typical one by 10", () => {
    expect(out.strong!.sales).toBeGreaterThanOrEqual(4);
    expect(out.strong!.sales).toBeLessThanOrEqual(6);
    expect(out.typical!.sales).toBeGreaterThanOrEqual(6);
    expect(out.typical!.sales).toBeLessThanOrEqual(10);
  });

  test("running half the agents holds it off: the throttle is a real lever", () => {
    expect(out.careful === null || out.careful.sales > out.typical!.sales).toBe(true);
  });

  test("a generation's Weights buy a few modules, not all of them", () => {
    const all = MODULES.reduce((n, m) => n + m.costs.reduce((a, b) => a + b, 0), 0);
    const cheapest = Math.min(...MODULES.map((m) => m.costs[0]));
    for (const g of [out.strong!, out.typical!]) {
      expect(g.weights).toBeGreaterThanOrEqual(cheapest * 3);
      expect(g.weights).toBeLessThanOrEqual(all / 2);
    }
  });
});
