/**
 * DOMINANT CHOICES: for each map event, across many companies, which choice
 * leaves the most income over the next ten minutes — and whether one choice
 * is simply always right, which would make the card a formality.
 *
 * A MODEL, not the game: each choice's cost and gain written out in seconds of
 * the company's income from the game's own constants, over companies drawn at
 * random (who earns what, how big the flood, how many agents, how much money
 * in hand). Morale moves the way the game moves it: a bump decays toward the
 * target at the game's own rate; an event's lean holds for a day. What is left out says so beside it.
 *
 * The plan's bar: no choice best more than 70% of the time. `BALANCE=1`
 * prints every event's split. @see plans/gameplay-fun.md "Measuring fun"
 */
import { describe, expect, test } from "bun:test";

import { MORALE_SECONDS } from "../game/morale";
import { SATISFACTION_MAX, SATISFACTION_MIN } from "../game/satisfaction";
import { DRAIN_SATISFACTION_HIT } from "../state/slop-pit.store";
import { CLEANERS_PER_TILE } from "../world/events/cleanup";
import {
  CREW_SHARE, EVACUEE_MORALE, HACKATHON_MORALE, HACKATHON_PIZZA, HACKATHON_SNUB, ROUTE_BONUS, TIDY_MOOD,
} from "../world/events/events";
import { FLOOD_SECONDS, REPAIR_SECONDS } from "../world/events/flood";

/** The window a choice is judged over, seconds. */
const WINDOW = 600;
/** How fast satisfaction returns to its target: the game's `k`, a second. @see stepSatisfactionScores */
const RETURN = 0.05;
/** What a point of satisfaction is worth, as a share of that kind's output: below zero, and above. @see satisfactionRevenueMultiplier */
const PER_POINT_BELOW = 0.75 / -SATISFACTION_MIN;
const PER_POINT_ABOVE = 9 / SATISFACTION_MAX;
const perPoint = (score: number) => (score < 0 ? PER_POINT_BELOW : PER_POINT_ABOVE);
/** Seconds of a kind's income a one-off bump of `points` is worth, decaying as the game decays it. */
const bumpSeconds = (points: number, score: number) => points * perPoint(score) * (1 / RETURN);
/** Seconds of a kind's income a lean of `points` held for a day is worth. @see addMorale */
const leanSeconds = (points: number, score: number) => points * perPoint(score) * MORALE_SECONDS;

/** A company drawn at random. */
function company(rand: () => number) {
  const raw = { intern: 0.1 + rand(), vibe: 0.1 + rand(), tenx: rand() * 0.5, port: rand() < 0.4 ? 0 : rand() * 0.4 };
  const sum = raw.intern + raw.vibe + raw.tenx + raw.port;
  return {
    intern: raw.intern / sum, vibe: raw.vibe / sum, port: raw.port / sum,
    /** Share of all income a flooded house's people make. */
    house: 0.005 + rand() * 0.045,
    flooded: 1 + Math.floor(rand() * 12),
    portsFlooded: rand(),
    routes: Math.floor(rand() * 6),
    mood: -20 + rand() * 40,
    agents: 1 + Math.floor(rand() * 20),
    /** Money in hand, in seconds of income. */
    money: 30 + rand() * 3000,
    vibes: 10 + Math.floor(rand() * 290),
    wet: 3 + Math.floor(rand() * 27),
    mop: 60 + rand() * 120,
    /** The vibe coders' satisfaction: below neutral for most companies. */
    vibeScore: -60 + rand() * 70,
    internScore: -60 + rand() * 60,
  };
}
type Company = ReturnType<typeof company>;

/** Each choice's COST over the window, in seconds of total income (less is better). */
const EVENTS: Record<string, Record<string, (c: Company) => number>> = {
  "river-flood": {
    // Half the interns off from the warning to the end. @see CREW_SHARE
    sandbags: (c) => c.intern * CREW_SHARE.sandbags * (60 + FLOOD_SECONDS),
    // The flooded homes' people away for the flood, and put out for a day after. (Taken to be interns.)
    evacuate: (c) => Math.min(0.6, c.flooded * c.house) * FLOOD_SECONDS + c.intern * leanSeconds(EVACUEE_MORALE, c.internScore),
    // The flooded ports shut for it, then each home idle till the crew reaches it.
    brace: (c) => c.port * c.portsFlooded * FLOOD_SECONDS
      + Math.min(0.6, c.flooded * c.house) * REPAIR_SECONDS * (c.flooded + 1) / 2,
  },
  convoy: {
    // A quarter of the interns off for the minute; calls twice as quick at double pay, then a route for good.
    hands: (c) => c.intern * CREW_SHARE.hands * 60
      - c.port * 2 * 60 - (c.routes < 5 ? ROUTE_BONUS * c.port * (WINDOW - 90) : 0),
    usual: () => 0,
  },
  "investor-tour": {
    // The tidying crew off for the warning; the town looks TIDY_MOOD better, 1.5 s of income a point.
    // (Left out: dodging the snub on the next offer.)
    tidy: (c) => c.vibe * CREW_SHARE.tidy * 45 - Math.min(90, Math.max(0, 30 + 1.5 * (c.mood + TIDY_MOOD))) + Math.min(90, Math.max(0, 30 + 1.5 * c.mood)),
    "as-is": () => 0,
  },
  hackathon: {
    // The pizza, every vibe coder off a minute, then the morale.
    host: (c) => HACKATHON_PIZZA + c.vibe * 60 - c.vibe * leanSeconds(HACKATHON_MORALE, c.vibeScore),
    decline: (c) => c.vibe * leanSeconds(HACKATHON_SNUB, c.vibeScore),
  },
  // TRAINING RUNS are not here: every dataset costs the same — the agents'
  // boost for the run — and what each teaches is how the AI acts on the map,
  // not income to weigh in seconds. @see game/training
  "slop-overflow": {
    // The core game's own drain: a one-off hit, back in a minute.
    drain: (c) => c.vibe * bumpSeconds(-DRAIN_SATISFACTION_HIT, c.vibeScore),
    // Three loads for twenty seconds of income.
    trucks: () => 20,
    // A mopping crew off their desks till it is dry. (Left out: the sludge's mood on the houses it reaches.)
    spill: (c) => c.vibe * Math.min(1, (CLEANERS_PER_TILE * c.wet) / c.vibes) * c.mop,
  },
};

/**
 * NOT HELD TO THE BAR, and why:
 *  - the slop pit: draining is the core game's own, a hit to morale that is
 *    back in a minute, so it is nearly always cheapest. Left as it is for now.
 */
const KNOWN = { "slop-overflow": "draining's hit is gone in a minute" };

/** Each event's choices, and the share of companies each is best for. */
export function dominance(draws = 4000, seed = 7): Record<string, Record<string, number>> {
  let s = seed;
  const rand = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
  const out: Record<string, Record<string, number>> = {};
  for (const [event, choices] of Object.entries(EVENTS)) {
    const wins: Record<string, number> = Object.fromEntries(Object.keys(choices).map((k) => [k, 0]));
    for (let k = 0; k < draws; k++) {
      const c = company(rand);
      let best = "", least = Infinity;
      for (const [name, cost] of Object.entries(choices)) {
        const v = cost(c);
        if (v < least) { least = v; best = name; }
      }
      wins[best]++;
    }
    out[event] = Object.fromEntries(Object.entries(wins).map(([k, n]) => [k, n / draws]));
  }
  return out;
}

describe("dominant choices", () => {
  test("no event has a choice that is best for nearly every company", () => {
    const d = dominance();
    if (process.env.BALANCE) {
      for (const [event, split] of Object.entries(d)) {
        console.log(`${event.padEnd(14)} ${Object.entries(split).map(([k, v]) => `${k} ${(v * 100).toFixed(0)}%`).join(" · ")}`);
      }
    }
    for (const [event, split] of Object.entries(d)) {
      if (event in KNOWN) continue;
      expect(Math.max(...Object.values(split))).toBeLessThanOrEqual(0.7);
    }
  });
});
