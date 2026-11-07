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
import { CREW_SHARE } from "../world/events/events";
import { EVACUEE_MORALE } from "../world/events/defs/flood";
import { HACKATHON_MORALE, HACKATHON_MS, HACKATHON_SNUB } from "../world/events/defs/hackathon";
import { ROUTE_BONUS } from "../world/events/defs/convoy";
import { DILIGENCE_MOOD, DILIGENCE_MULT, DILIGENCE_WATERED, TIDY_MOOD } from "../world/events/defs/diligence";
import { FLOOD_SECONDS } from "../world/events/flood";
import { HEAT_MS, HEAT_THIRST, OVERHEAT_SHARE, PUMP_SECONDS } from "../world/events/defs/heatwave";
import { DIG_SECONDS, DROUGHT_MS, RATION_MORALE, TRUCK_SECONDS } from "../world/events/defs/drought";
import { CLEAN_MOOD, CLOSED_SECONDS, FINE_SECONDS } from "../world/events/defs/inspector";
import { EDGE_LOADS, STRIKE_MS, STRIKE_PAY } from "../world/events/defs/strike";
import { REPAIR_SECONDS } from "../world/events/damage";

/** The window a choice is judged over, seconds. */
const WINDOW = 600;
/** What a point of satisfaction is worth, as a share of that kind's output: below zero, and above. @see satisfactionRevenueMultiplier */
const PER_POINT_BELOW = 0.75 / -SATISFACTION_MIN;
const PER_POINT_ABOVE = 9 / SATISFACTION_MAX;
const perPoint = (score: number) => (score < 0 ? PER_POINT_BELOW : PER_POINT_ABOVE);
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
    /** What due diligence finds: spills on the streets, and the share of what drinks that is watered. */
    spills: rand() < 0.5 ? 0 : 1 + Math.floor(rand() * 4),
    watered: rand() < 0.3 ? 1 : rand(),
    /** Seconds of income the sale's valuation is worth, per whole of it. */
    saleWorth: 100 + rand() * 1500,
    /** Share of income the agents' boost makes, and how much of what drinks the river waters. */
    agentShare: rand() * 0.5,
    onRiver: rand(),
    /** Vibe workplaces: the closed one's share of them. */
    offices: 1 + Math.floor(rand() * 6),
    /** A site's loads left, in seconds of income; and a second of its stall, in seconds of income. */
    siteLeft: 20 + rand() * 400,
    stall: rand() * 0.8,
    /** Loads a site takes a second, in seconds of income. */
    loadsRate: 0.05 + rand() * 0.6,
    /** The pipes' headroom over what drinks asks, usually. */
    headroom: 0.4 + rand() * 1.4,
    /** How long a clean record lasts before the next spill, in days. */
    cleanFor: rand() * 0.6,
    agents: 1 + Math.floor(rand() * 20),
    /** Money in hand, in seconds of income. */
    money: 30 + rand() * 3000,
    /** The vibe coders' satisfaction: below neutral for most companies. */
    vibeScore: -60 + rand() * 70,
    internScore: -60 + rand() * 60,
  };
}
type Company = ReturnType<typeof company>;

/** What due diligence's multiplier is worth, in seconds of income, as the town would be judged. @see inspect */
const judged = (c: Company, tidied: number, spills: number) => {
  const passed = Number(c.mood + tidied >= DILIGENCE_MOOD) + Number(spills === 0) + Number(c.watered >= DILIGENCE_WATERED);
  return DILIGENCE_MULT[passed] * c.saleWorth;
};

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
  diligence: {
    // The crew off for the warning; then the sale valued by the checks passed. (Left out: the sweetener.)
    tidy: (c) => c.vibe * CREW_SHARE.tidy * 45 - judged(c, TIDY_MOOD, c.spills),
    mop: (c) => (c.spills ? c.intern * CREW_SHARE.mop * 45 - judged(c, 0, 0) : Infinity),
    "as-is": (c) => -judged(c, 0, c.spills),
  },
  heatwave: {
    // Pumps paid; the agents' boost off for it; or what the doubled thirst leaves short runs hot, and below half overheats.
    pumps: () => PUMP_SECONDS,
    throttle: (c) => c.agentShare * HEAT_MS / 1000,
    ride: (c) => {
      const met = Math.min(1, c.headroom / HEAT_THIRST);
      return c.agentShare * ((1 - met) * 0.5 * HEAT_MS / 1000 + (met < OVERHEAT_SHARE ? 0.5 * (HEAT_MS / 1000 + REPAIR_SECONDS * 2) : 0));
    },
  },
  drought: {
    // What the river waters runs hot for it — a reservoir, piped, covers a little of it; or the homes put out; or trucks.
    dig: (c) => DIG_SECONDS + c.agentShare * c.onRiver * 0.5 * 0.8 * DROUGHT_MS / 1000,
    ration: (c) => c.intern * leanSeconds(RATION_MORALE, c.internScore) + c.vibe * leanSeconds(RATION_MORALE, c.vibeScore),
    truck: () => TRUCK_SECONDS * DROUGHT_MS / 60_000,
  },
  inspector: {
    // The vibe coders off for the warning, then a clean record till the next spill; a fine; or an office shut.
    sprint: (c) => c.vibe * CREW_SHARE.sprint * 45 - c.cleanFor * c.vibe * leanSeconds(CLEAN_MOOD, c.vibeScore),
    fine: () => FINE_SECONDS,
    close: (c) => (c.vibe / c.offices) * CLOSED_SECONDS,
  },
  strike: {
    // A share of the loads' cost; the site stalled throughout; or the loads dearer the long way round, and a little slower.
    pay: (c) => c.siteLeft * STRIKE_PAY,
    wait: (c) => c.stall * STRIKE_MS / 1000,
    edge: (c) => Math.min(c.siteLeft, c.loadsRate * STRIKE_MS / 1000) * (EDGE_LOADS - 1) + c.stall * 0.2 * STRIKE_MS / 1000,
  },
  hackathon: {
    // Every vibe coder off for it, the studio's tank half filled — a spill risked, taken as 20 s of income
    // (the pizza it replaced) — then a card offer, valued till phase 5 measures it as the day's morale it replaced.
    host: (c) => 20 + c.vibe * (HACKATHON_MS / 1000) - c.vibe * leanSeconds(HACKATHON_MORALE, c.vibeScore),
    decline: (c) => c.vibe * leanSeconds(HACKATHON_SNUB, c.vibeScore),
  },
  // TRAINING RUNS are not here: every dataset costs the same — the agents'
  // boost for the run — and what each teaches is how the AI acts on the map,
  // not income to weigh in seconds. @see game/training
};

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
      expect(Math.max(...Object.values(split))).toBeLessThanOrEqual(0.7);
    }
  });
});
