/**
 * THE MACHINE'S PATHS, WEIGHED: of its three keystones, which one a company
 * would be best off with — and whether one is simply always right.
 *
 * A MODEL, coarser than the others, each keystone worth a share of income
 * over a generation, against companies drawn at random:
 *  - AIR GAP: every agent's boost multiplied (the game's own boost a rack's
 *    agent), less the Machine's notables that work on the map — each owned
 *    worth a little — and less the AI's work on the map, which it stops;
 *  - HARD TAKEOFF: what the AI spends from its allowance, now free, and its
 *    work over the whole map, less what it takes from the player sooner;
 *  - ALIGNMENT: nothing taken from the player, ever, less the Ascensions
 *    put off by its slower meter — what Weights are worth to this player.
 * The plan's bar: none best for more than 60%. `BALANCE=1` prints the split.
 * @see game/machine KEYSTONES, plans/ai-takeover.md §8
 */
import { describe, expect, test } from "bun:test";

import { AGENT_BOOST, AIR_GAP_BOOST } from "../game/agents";

function draw(rand: () => number) {
  return {
    agents: 8 + Math.floor(rand() * 33),
    /** The AI's allowance, a share of income. */
    allowance: 0.05 + rand() * 0.45,
    /** The map notables owned, each worth this share of income. */
    notables: Math.floor(rand() * 8),
    perNotable: 0.01 + rand() * 0.03,
    /** What the AI's work on the map adds, a share of income. */
    work: rand() * 0.2,
    /** What its takeovers cost the player, a share of income. */
    takes: rand() * 0.15,
    /** What the Ascensions an Alignment puts off are worth to this player, a share of income. */
    weights: rand() * 0.4,
  };
}

/** Each keystone's worth to a company, as a share of income. */
function worths(c: ReturnType<typeof draw>): Record<string, number> {
  const boost = (mult: number) => 1 + AGENT_BOOST * mult * c.agents;
  return {
    "Air Gap": boost(AIR_GAP_BOOST) / boost(1) - 1 - c.notables * c.perNotable - c.work,
    "Hard Takeoff": c.allowance * 0.5 + c.work * 0.5 - c.takes,
    Alignment: c.takes - c.weights * 0.5,
  };
}

export function pathDominance(draws = 4000, seed = 5): Record<string, number> {
  let s = seed;
  const rand = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
  const wins: Record<string, number> = { "Air Gap": 0, "Hard Takeoff": 0, Alignment: 0 };
  for (let k = 0; k < draws; k++) {
    const w = worths(draw(rand));
    const best = Object.entries(w).sort((a, b) => b[1] - a[1])[0][0];
    wins[best]++;
  }
  return Object.fromEntries(Object.entries(wins).map(([k, n]) => [k, n / draws]));
}

describe("the Machine's paths", () => {
  const d = pathDominance();
  if (process.env.BALANCE) console.log(Object.entries(d).map(([k, v]) => `${k} ${(v * 100).toFixed(0)}%`).join(" · "));

  test("no keystone is best for nearly every company", () => {
    expect(Math.max(...Object.values(d))).toBeLessThanOrEqual(0.6);
  });
});
