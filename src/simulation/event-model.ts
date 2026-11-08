/**
 * WHAT EACH EVENT'S CHOICES COST, as a model: each choice's cost over the
 * window in seconds of the company's income, from the game's own constants,
 * over companies drawn at random (who earns what, how big the flood, how many
 * agents, how much money in hand). Morale moves the way the game moves it: a
 * bump decays toward the target at the game's own rate; an event's lean holds
 * for a day. What is left out says so beside it.
 *
 * The stakes test holds the choices apart by it, and the map run charges
 * each event it draws by its default. @see event-stakes.test, simulateMapRun
 */
import { MORALE_SECONDS } from "../game/morale";
import { SATISFACTION_MAX, SATISFACTION_MIN } from "../game/satisfaction";
import { CREW_SHARE } from "../world/events/events";
import { EVACUEE_MORALE } from "../world/events/defs/flood";
import { HACKATHON_MORALE, HACKATHON_MS, HACKATHON_SNUB } from "../world/events/defs/hackathon";
import { CONVOY_MS, ROUTE_BONUS } from "../world/events/defs/convoy";
import { ROUTE_LOADS } from "../world/events/convoy";
import { DILIGENCE_MOOD, DILIGENCE_MULT, DILIGENCE_WATERED, TIDY_MOOD } from "../world/events/defs/diligence";
import { FLOOD_SECONDS } from "../world/events/flood";
import { HEAT_MS, HEAT_THIRST, OVERHEAT_SHARE, PUMP_SECONDS } from "../world/events/defs/heatwave";
import { DIG_SECONDS, DROUGHT_MS, RATION_MORALE, TRUCK_SECONDS } from "../world/events/defs/drought";
import { CLEAN_MOOD, CLOSED_SECONDS, FINE_SECONDS, INSPECT_WARN_MS } from "../world/events/defs/inspector";
import { OVERTIME_MS, OVERTIME_SECONDS, WORKS_MS } from "../world/events/defs/road-works";
import { COUNTER_VALUE, MATCH_SHARE, POACH_SHARE } from "../world/events/defs/poaching";
import { VIRAL_MORALE, VIRAL_MS } from "../world/events/defs/viral";
import { FREEZE_MORALE, FREEZE_WORK, IGNORE_MORALE, IGNORE_WORK, TENANTS_SECONDS } from "../world/events/defs/tenants";
import { INCIDENT_METER, ROLLBACK_SECONDS, RUN_SECONDS } from "../world/events/defs/agents";
import { EDGE_LOADS, STRIKE_MS, STRIKE_PAY } from "../world/events/defs/strike";
import { FIRE_REPAIR_SECONDS, REPAIR_SECONDS } from "../world/events/damage";
import { BRIGADE_SECONDS, FIRE_MS, FIRE_SPREAD, HOSE_OUT_MS } from "../world/events/defs/fire";

/** The window a choice is judged over, seconds. */
export const WINDOW = 1200;
/** What a point of satisfaction is worth, as a share of that kind's output: below zero, and above. @see satisfactionRevenueMultiplier */
const PER_POINT_BELOW = 0.75 / -SATISFACTION_MIN;
const PER_POINT_ABOVE = 9 / SATISFACTION_MAX;
const perPoint = (score: number) => (score < 0 ? PER_POINT_BELOW : PER_POINT_ABOVE);
/** Seconds of a kind's income a lean of `points` held for a day is worth. @see addMorale */
const leanSeconds = (points: number, score: number) => points * perPoint(score) * MORALE_SECONDS;

/** A company drawn at random. */
export function company(rand: () => number) {
  const raw = { intern: 0.1 + rand(), vibe: 0.1 + rand(), tenx: rand() * 0.5, port: rand() < 0.4 ? 0 : rand() * 0.4 };
  const sum = raw.intern + raw.vibe + raw.tenx + raw.port;
  return {
    intern: raw.intern / sum, vibe: raw.vibe / sum, port: raw.port / sum,
    /** Share of all income a flooded house's people make. */
    house: 0.005 + rand() * 0.045,
    flooded: 1 + Math.floor(rand() * 20),
    portsFlooded: rand(),
    /** A levee's walls, in seconds of income; and the floods still to come that it would meet. */
    leveePrice: 30 + rand() * 600,
    floodsAhead: rand() * 2,
    routes: Math.floor(rand() * 6),
    mood: -20 + rand() * 40,
    /** What due diligence finds: spills on the streets, and the share of what drinks that is watered. */
    spills: rand() < 0.5 ? 0 : 1 + Math.floor(rand() * 4),
    watered: rand() < 0.3 ? 1 : rand(),
    /** Seconds of income the sale's valuation is worth, per whole of it. */
    saleWorth: 100 + rand() * 1500,
    /** Share of income the agents' boost makes, and how much of what drinks the river waters. */
    agentShare: rand() * 0.5,
    /** The same, of a company with something drinking: the only ones a heatwave or a drought comes to. */
    drinkingShare: 0.2 + rand() * 0.6,
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
    /** The share of income whose commutes cross the busiest junction, and how much going round costs them. */
    across: rand() * 0.5,
    detour: rand(),
    /** The 10x devs' share of income, and what one costs to hire, in seconds of income. */
    tenx: rand() * 0.3,
    tenxHire: 5 + rand() * 60,
    tenxN: Math.max(1, Math.round((10 + rand() * 70) * POACH_SHARE)),
    /** What leaning into a card's rule is worth, a second, as a share of income. */
    rule: rand() * 0.6,
    /** A culture point, in seconds of income. */
    point: 10 + rand() * 120,
    /** Room to lay a bypass round the junction, 0 to 1; and a café's price, in seconds of income. */
    room: rand(),
    cafePrice: 5 + rand() * 120,
    /** How much of losing a 10x dev is the price of hiring another: beds, and a hire price that has since risen. */
    rehire: 0.2 + rand(),
    /** A culture card offer, in seconds of income: none with the deck not open. */
    card: rand() < 0.3 ? 0 : 40 + rand() * 260,
    /** The share of the time a site is building, taking loads. */
    building: rand(),
    /** The striking homes' share of income. */
    street: 0.02 + rand() * 0.15,
    /** What a free café is worth to them, against being ignored: a share of their work back. */
    cafe: rand(),
    /** Seconds of income a point of the meter costs. */
    meter: rand() * 20,
    /** What an AI card offer is worth, in seconds of income: nothing without the deck. */
    aiCard: rand() < 0.3 ? -Infinity : rand() * 150,
    agents: 1 + Math.floor(rand() * 20),
    /** Money in hand, in seconds of income. */
    money: 30 + rand() * 3000,
    /** The vibe coders' satisfaction: below neutral for most companies. */
    vibeScore: -60 + rand() * 70,
    internScore: -60 + rand() * 60,
  };
}
export type Company = ReturnType<typeof company>;

/** What due diligence's multiplier is worth, in seconds of income, as the town would be judged. @see inspect */
const judged = (c: Company, tidied: number, spills: number) => {
  const passed = Number(c.mood + tidied >= DILIGENCE_MOOD) + Number(spills === 0) + Number(c.watered >= DILIGENCE_WATERED);
  return DILIGENCE_MULT[passed] * c.saleWorth;
};

/**
 * A number in [0, 1) from a company's own draws: what a fire needs to know of
 * it is worked out, not drawn, so the companies every other event is judged
 * on stay exactly as they were.
 */
const hashed = (c: Company, salt: number) => {
  const x = Math.sin(c.money * 12.9898 + c.house * 7833.3 + salt * 37.719) * 43758.5453;
  return x - Math.floor(x);
};
/** A FIRE's company: the burning building's share of income, whether the mains reach it, and how many next to it are dry. */
const fireOf = (c: Company) => ({
  rack: c.drinkingShare / (1 + Math.floor(hashed(c, 1) * 5)),
  mains: hashed(c, 2) < 0.7,
  dry: Math.floor(hashed(c, 3) * (FIRE_SPREAD + 1)),
});

/** Each choice's COST over the window, in seconds of total income (less is better). */
export const EVENTS: Record<string, Record<string, (c: Company) => number>> = {
  "river-flood": {
    // Half the interns off from the warning to the end. @see CREW_SHARE
    sandbags: (c) => c.intern * CREW_SHARE.sandbags * (60 + FLOOD_SECONDS),
    // The flooded homes' people away for the flood, and put out for a day after. (Taken to be interns.)
    evacuate: (c) => Math.min(0.6, c.flooded * c.house) * FLOOD_SECONDS + c.intern * leanSeconds(EVACUEE_MORALE, c.internScore),
    // The flooded ports shut for it, then each home idle till the crew reaches it.
    brace: (c) => c.port * c.portsFlooded * FLOOD_SECONDS
      + Math.min(0.6, c.flooded * c.house) * REPAIR_SECONDS * (c.flooded + 1) / 2,
    // The walls paid for; past them, a little still damaged; and the floods to come, met by them.
    levee: (c) => c.leveePrice + 0.2 * Math.min(0.6, c.flooded * c.house) * REPAIR_SECONDS * (c.flooded + 1) / 2
      - c.floodsAhead * Math.min(0.6, c.flooded * c.house) * REPAIR_SECONDS * (c.flooded + 1) / 2,
  },
  convoy: {
    // A quarter of the interns off for the minute; calls twice as quick at double pay, then a route for good.
    // A route also takes a tenth off every load for good. @see ROUTE_LOADS
    hands: (c) => c.intern * CREW_SHARE.hands * CONVOY_MS / 1000
      - c.port * 2 * CONVOY_MS / 1000 - (c.routes < 5 ? (ROUTE_BONUS * c.port + ROUTE_LOADS * c.loadsRate * c.building) * (WINDOW - CONVOY_MS / 1000) : 0),
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
    throttle: (c) => c.drinkingShare * HEAT_MS / 1000,
    ride: (c) => {
      const met = Math.min(1, c.headroom / HEAT_THIRST);
      return c.drinkingShare * ((1 - met) * 0.5 * HEAT_MS / 1000 + (met < OVERHEAT_SHARE ? 0.5 * (HEAT_MS / 1000 + REPAIR_SECONDS * 2) : 0));
    },
  },
  drought: {
    // What the river waters runs hot for it — a reservoir, piped, covers a little of it; or the homes put out; or trucks.
    dig: (c) => DIG_SECONDS + c.drinkingShare * c.onRiver * 0.5 * 0.8 * DROUGHT_MS / 1000,
    ration: (c) => c.intern * leanSeconds(RATION_MORALE, c.internScore) + c.vibe * leanSeconds(RATION_MORALE, c.vibeScore),
    truck: () => TRUCK_SECONDS * DROUGHT_MS / 60_000,
  },
  inspector: {
    // The vibe coders off for the warning, then a clean record till the next spill; a fine; or an office shut.
    sprint: (c) => c.vibe * CREW_SHARE.sprint * INSPECT_WARN_MS / 1000 - c.cleanFor * c.vibe * leanSeconds(CLEAN_MOOD, c.vibeScore),
    fine: () => FINE_SECONDS,
    close: (c) => (c.vibe / c.offices) * CLOSED_SECONDS,
  },
  strike: {
    // A share of the loads' cost; the site stalled throughout; or the loads dearer the long way round, and a little slower.
    pay: (c) => c.siteLeft * STRIKE_PAY,
    wait: (c) => c.stall * STRIKE_MS / 1000,
    edge: (c) => Math.min(c.siteLeft, c.loadsRate * STRIKE_MS / 1000) * (EDGE_LOADS - 1) + c.stall * 0.2 * STRIKE_MS / 1000,
  },
  "road-works": {
    // Overtime paid; or those across it going round for five minutes — or, with road free, a bypass laid for good.
    overtime: (c) => OVERTIME_SECONDS + c.across * c.detour * OVERTIME_MS / 1000,
    bypass: (c) => c.across * c.detour * (1 - 0.6 * c.room) * WORKS_MS / 1000 + 5 - c.across * 0.02 * WINDOW * c.room,
    "put-up": (c) => c.across * c.detour * WORKS_MS / 1000,
  },
  poaching: {
    // Half their hire price a head; or their share of the 10x devs' work gone till rehired; or as many free and the valuation dipped.
    match: (c) => c.tenxN * c.tenxHire * MATCH_SHARE,
    "let-go": (c) => c.tenxN * c.tenxHire * c.rehire,
    counter: (c) => (1 - COUNTER_VALUE) * c.saleWorth,
  },
  viral: {
    // A card's rule for five minutes, then everyone put out; or a point.
    lean: (c) => -c.rule * VIRAL_MS / 1000 + c.intern * leanSeconds(VIRAL_MORALE, c.internScore) + c.vibe * leanSeconds(VIRAL_MORALE, c.vibeScore),
    bank: (c) => -c.point,
  },
  tenants: {
    // A café: their work back, but for what it does not fix; a rent freeze: half their work for a day, but glad of it; ignored: a quarter, and put out.
    cafe: (c) => c.cafePrice + c.street * (1 - c.cafe) * (1 - IGNORE_WORK) * TENANTS_SECONDS,
    freeze: (c) => c.street * (1 - FREEZE_WORK) * TENANTS_SECONDS - c.intern * leanSeconds(FREEZE_MORALE, c.internScore),
    ignore: (c) => c.street * (1 - IGNORE_WORK) * TENANTS_SECONDS + c.intern * leanSeconds(IGNORE_MORALE, c.internScore),
  },
  agents: {
    // The meter is a clock to the Ascension: each point of it costs; money for the clean-up, or made by it; or an AI card.
    rollback: (c) => ROLLBACK_SECONDS - INCIDENT_METER * c.meter,
    run: (c) => INCIDENT_METER * c.meter - RUN_SECONDS,
    policy: (c) => -c.aiCard,
  },
  fire: {
    // Counted past the overheating it was anyway (idle till the crew's been).
    // The mains on it: every tank empty and nothing drinking till it is out.
    hose: (c) => (fireOf(c).mains ? c.drinkingShare * HOSE_OUT_MS / 1000 : Infinity),
    brigade: () => BRIGADE_SECONDS,
    // Burnt for the whole of it and rebuilt, not mended; and the dry ones next to it caught halfway through. (Taken to be homes.)
    burn: (c) => {
      const f = fireOf(c);
      return f.rack * (FIRE_MS / 1000 + FIRE_REPAIR_SECONDS - REPAIR_SECONDS) + f.dry * c.house * (FIRE_MS / 2000 + FIRE_REPAIR_SECONDS);
    },
  },
  hackathon: {
    // Every vibe coder off for it, the studio's tank half filled — a spill risked, taken as 20 s of income —
    // then a card offer; with the deck not open, the day's morale.
    host: (c) => 20 + c.vibe * (HACKATHON_MS / 1000) - (c.card || c.vibe * leanSeconds(HACKATHON_MORALE, c.vibeScore)),
    decline: (c) => c.vibe * leanSeconds(HACKATHON_SNUB, c.vibeScore),
  },
  // TRAINING RUNS are not here: every dataset costs the same — the agents'
  // boost for the run — and what each teaches is how the AI acts on the map,
  // not income to weigh in seconds. @see game/training
};

