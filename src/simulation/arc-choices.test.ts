/**
 * THE ARC'S CHOICES, WEIGHED: for every chapter and request, across many
 * companies and players, which option is worth the most — and whether one is
 * simply always right, which would make the decision a formality.
 *
 * A MODEL, not the game. An option is worth, in seconds of the company's
 * income over what is left of the generation:
 *  - its INCOME effects, for as long as they last; what it PAYS;
 *  - FLOODS made likelier or rarer, each costing the company a while;
 *  - an AGENT CAP, the agents' share of income lost while the Data Centre is
 *    short; a STANDING SOURCE, the opposite;
 *  - the WALLET drawing on the company's money: some of what is in hand;
 *  - an OBJECTIVE: its cost (agents throttled, mains paid for, a building
 *    put up), and what follows met or not, by how likely it is met;
 *  - and its AXES: a player wants one ending, drawn at random, and every step
 *    toward its corner is worth something to them — the reason anyone says
 *    no to more money. The meter, the district, the charter's rules and a
 *    Machine node revealed are not income and count nothing here; the
 *    cadence model holds the meter. @see singularity-cadence.test.ts
 *
 * The plan's bar: no option best for more than 60% of companies. `BALANCE=1`
 * prints every split. @see plans/ai-takeover.md §5 "Balance"
 */
import { describe, expect, test } from "bun:test";

import { CHAPTERS } from "../game/quests/chapters";
import { REQUESTS } from "../game/quests/requests";
import { ENDINGS } from "../game/quests/endings";
import { AXIS_MOST, type Disposition, type Effect, type Option } from "../game/quests/types";

/** A company and a player, drawn at random. */
function draw(rand: () => number) {
  return {
    /** Seconds of play left in the generation. */
    horizon: 3600 * (1 + rand() * 7),
    /** The agents' share of income. */
    agents: 0.1 + rand() * 0.4,
    /** How often the Data Centre is short of water, as a share of the time. */
    short: rand() * 0.5,
    /** Money in hand, in seconds of income. */
    money: 60 + rand() * 1800,
    /** What a flood costs, in seconds of income; and the seconds between floods. */
    flood: 30 + rand() * 170,
    floodsEvery: 1650,
    /** What a main or a building costs, in seconds of income. */
    build: 20 + rand() * 200,
    /** How likely the player meets an objective. */
    meets: 0.4 + rand() * 0.55,
    /** The ending they want — a corner — and what a step toward it is worth, a share of income over the horizon. */
    corner: { autonomy: rand() < 0.5 ? 1 : -1, machine: rand() < 0.5 ? 1 : -1 } as Disposition,
    perStep: rand() * 0.03,
  };
}
type Draw = ReturnType<typeof draw>;

/** An effect's worth, in seconds of income. */
function worth(e: Effect, c: Draw): number {
  const span = Math.min(e.lasts ?? Infinity, c.horizon);
  switch (e.kind) {
    case "incomeMult": return (e.mult - 1) * span;
    case "pay": return -e.seconds;
    case "floodMult": return -(e.mult - 1) * c.flood * (span / c.floodsEvery);
    case "agentCap": return -c.agents * (1 - e.share) * (e.unlessCooled ? c.short : 1) * span;
    case "standingWater": return c.agents * 0.5 * c.short * span;
    case "walletDraws": return -e.share * c.money * 0.5;
    case "rebuildBlock": return 0.01 * span - 120 * 0.05;
    default: return 0;
  }
}

/** What an objective costs to try, in seconds of income. */
function tryCost(o: NonNullable<Option["objective"]>, c: Draw): number {
  switch (o.kind) {
    case "throttleAtMost": return c.agents * (1 - o.share) * o.seconds;
    case "coolDataCentre": return c.build;
    case "buildBy": return c.build;
    default: return 0;
  }
}

/** An option's worth to this company and player. */
function value(o: Option, c: Draw): number {
  let v = o.effects.reduce((n, e) => n + worth(e, c), 0);
  if (o.objective) {
    v -= tryCost(o.objective, c);
    v += c.meets * (o.success ?? []).reduce((n, e) => n + worth(e, c), 0) + (1 - c.meets) * (o.failure ?? []).reduce((n, e) => n + worth(e, c), 0);
  }
  const toward = (o.axis.autonomy ?? 0) * c.corner.autonomy + (o.axis.machine ?? 0) * c.corner.machine;
  return v + toward * c.perStep * c.horizon;
}

/** Each chapter's and request's options, and the share of draws each is best for. */
export function arcDominance(draws = 4000, seed = 11): Record<string, Record<string, number>> {
  let s = seed;
  const rand = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
  const out: Record<string, Record<string, number>> = {};
  for (const q of [...CHAPTERS, ...REQUESTS]) {
    const wins = q.options.map(() => 0);
    for (let k = 0; k < draws; k++) {
      const c = draw(rand);
      // The best; a tie, either, at a toss.
      let best = 0, top = -Infinity;
      q.options.forEach((o, i) => { const v = value(o, c); if (v > top + 1e-9 || (Math.abs(v - top) <= 1e-9 && rand() < 0.5)) { top = v; best = i; } });
      wins[best]++;
    }
    out[q.id] = Object.fromEntries(q.options.map((o, i) => [o.label, wins[i] / draws]));
  }
  return out;
}

/**
 * NOT HELD TO THE BAR, and why: the cosmetic ones, whose options do nothing
 * but name a thing, and are split by the axis alone or not at all.
 */
const KNOWN: Record<string, string> = { "drone-name": "a name, nothing more: neither option does anything" };

describe("the arc's choices", () => {
  const d = arcDominance();
  if (process.env.BALANCE) {
    for (const [id, split] of Object.entries(d)) console.log(`${id.padEnd(14)} ${Object.entries(split).map(([k, v]) => `${k} ${(v * 100).toFixed(0)}%`).join(" · ")}`);
  }

  test("no option is best for nearly every company", () => {
    const over = Object.entries(d).filter(([id, split]) => !(id in KNOWN) && Math.max(...Object.values(split)) > 0.6);
    expect(over.map(([id]) => id)).toEqual([]);
  });

  test("every ending is reachable by some way through the chapters, and none by letting it choose", () => {
    // Every way through the chapters, the disposition each leaves — kept within ±3 as it goes, as the store does.
    const clamp = (n: number) => Math.max(-AXIS_MOST, Math.min(AXIS_MOST, n));
    let ways: Disposition[] = [{ autonomy: 0, machine: 0 }];
    for (const c of CHAPTERS) {
      ways = ways.flatMap((d) => c.options.map((o) => ({ autonomy: clamp(d.autonomy + (o.axis.autonomy ?? 0)), machine: clamp(d.machine + (o.axis.machine ?? 0)) })));
    }
    const reached = new Map(ENDINGS.map((e) => [e.id, ways.filter((d) => e.open(d)).length]));
    if (process.env.BALANCE) console.log(`${ways.length} ways through: ${[...reached].map(([id, n]) => `${id} ${n}`).join(" · ")}`);
    for (const [, n] of reached) expect(n).toBeGreaterThan(0);
    // Left to itself, its answers move nothing: it ends where it began, at no ending.
    expect(ENDINGS.filter((e) => e.open({ autonomy: 0, machine: 0 }))).toEqual([]);
  });
});
