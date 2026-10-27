/**
 * World v2 — EVENTS: things that happen to the town, announced ahead, with
 * something to be done about them.
 *
 * Every event has a WARNING — a countdown and a place on the map — and
 * CHOICES, each with a plain cost, and then it strikes, runs its course, and
 * is over. Nothing here is a punishment from nowhere: the point is the
 * decision. @see EventCard, stepEvents
 *
 * This file holds the events themselves and the DIRECTOR that starts and
 * moves them along, as plain functions of what the town is doing. What an
 * event DOES to the map — sludge poured, trucks sent — is the scene's and the
 * store's. @see world-scene, respondToEvent
 */
import { termEffects } from "../../game/term-deal";
import { notable } from "../../game/machine";
import { questFloodMult } from "../../game/quests/effects";
import { FLOOD_SECONDS } from "./flood";


export type EventKind = "slop-overflow" | "river-flood" | "convoy" | "investor-tour" | "hackathon" | "offer";

export type EventChoice = {
  id: string;
  label: string;
  /** What it costs, said plainly. */
  cost?: string;
  /** Why it cannot be chosen just now, if it cannot. */
  unavailable?: string;
};

export type GameEvent = {
  id: number;
  kind: EventKind;
  title: string;
  text: string;
  /** The tile it is about, for the marker and "Show me". */
  where: { x: number; y: number };
  /** Coming, happening, or done. */
  phase: "warning" | "active" | "over";
  /** When it strikes, ms since the epoch, while it is coming. */
  strikesAt: number | null;
  choices: EventChoice[];
  /** What the player chose, if anything yet. */
  chosen?: string;
  /** When it ended, so it can be shown as over for a moment and then put away. */
  overAt?: number;
  /** What happened, once it is over. */
  outcome?: string;
  /** When it will be over, while it is happening, if that is known. */
  endsAt?: number;
  /** The most buildings it has reached at once, so far. */
  hit?: number;
};

/** What the director can see. */
export type EventWorld = {
  now: number;
  /** The slop pit: where it is, how full (0–100) and how fast it fills, % a second. Null with none. */
  slop: { x: number; y: number; fill: number; rate: number; trucks: number; truckPrice: number } | null;
  /**
   * The rivers, on a map with any: where they come on, whether a flood is
   * due, the houses and ports it has reached, and what sandbags cost.
   */
  river: { x: number; y: number; due: boolean; flooded: number; sandbagCrew: number } | null;
  /** The ports, on a map with any: where, whether a convoy is due, and how it is going. */
  convoy: { x: number; y: number; due: boolean; calls: number; earned: number; handsCrew: number; routes: number } | null;
  /** Where investors would be shown round, whether a tour is due, and what it would come to as things are. */
  tour: { x: number; y: number; due: boolean; reward: number; tidyCrew: number; income: number } | null;
  /** The vibe coders' studio, with enough of them in it for a hackathon, and whether one is due. */
  hackathon: { x: number; y: number; due: boolean; pizza: number } | null;
  /**
   * An ACQUIRER, once the company can be sold: where its front door is,
   * whether an offer is due, and the Equity a sale pays now and with the
   * acquirer's premium. Null while there is nothing to sell. @see OFFER_PREMIUM
   */
  offer: { x: number; y: number; due: boolean; equity: number; withPremium: number; street?: string } | null;
  /** Whether events happen at all: false, and every one is put away. */
  enabled: boolean;
};

/**
 * HOW OFTEN EACH COMES, in seconds of play: the first after so long, and the
 * next some time in a range after that. Only counted while nothing else is
 * under way, so they do not pile up. @see nextDueIn
 */
export const PACING = {
  "river-flood": { first: 15 * 60, between: [20 * 60, 35 * 60] },
  convoy: { first: 10 * 60, between: [15 * 60, 25 * 60] },
  "investor-tour": { first: 20 * 60, between: [25 * 60, 40 * 60] },
  hackathon: { first: 8 * 60, between: [20 * 60, 30 * 60] },
  // The first as soon as there is a company worth buying; then now and again.
  offer: { first: 60, between: [15 * 60, 25 * 60] },
} as const satisfies Partial<Record<EventKind, { first: number; between: readonly [number, number] }>>;
export type PacedKind = keyof typeof PACING;

/** Seconds to the next of a kind, for a roll of the dice in [0, 1). */
export const nextDueIn = (kind: PacedKind, roll: number) => {
  const [lo, hi] = PACING[kind].between;
  // Convoys twice as often with the Machine's Market Maker. @see game/machine "market"
  // Floods more or less often by the arc. @see questFloodMult
  return (lo + roll * (hi - lo)) / (kind === "convoy" && notable("market") ? 2 : 1) / (kind === "river-flood" ? questFloodMult() : 1);
};

/** At this fill the pit's overflow is announced; at 100 it overflows; below this it is over. */
export const SLOP_WARN_AT = 90;
export const SLOP_CALM_AT = 95;
/** How long an ended event stays up, ms. */
export const OVER_SHOWN_MS = 10_000;

/** Warning before a flood, and how long it runs once it strikes, ms. */
export const FLOOD_WARN_MS = 60_000;
export const FLOOD_MS = FLOOD_SECONDS * 1000;

/** What the card says while the pit overflows. */
const OVERFLOWING = {
  title: "The slop pit is overflowing",
  text: "Sludge is running out over the rim and downhill. It stops when the pit drops below 95%.",
};

/** The choices the slop pit gives, as things stand. */
export function slopChoices(w: NonNullable<EventWorld["slop"]>): EventChoice[] {
  return [
    { id: "drain", label: "Drain it now", cost: "−40 vibe coder morale", ...(w.fill < 1 ? { unavailable: "It is empty" } : {}) },
    {
      id: "trucks", label: "Send sludge trucks", cost: `${w.truckPrice > 0 ? `$${Math.round(w.truckPrice).toLocaleString()}` : "free"} for three loads`,
      ...(w.trucks > 0 ? { unavailable: `${w.trucks} on the way` } : {}),
    },
    { id: "spill", label: "Let it spill", cost: "sludge on the streets nearby" },
  ];
}

/** What investors shown round pay, in seconds of income, by how happy the town's homes are: 30, and 1.5 a point. */
export function tourReward(income: number, mood: number, tidied: boolean): number {
  const seconds = Math.max(0, Math.min(90, 30 + 1.5 * (mood + (tidied ? TIDY_MOOD : 0))));
  return Math.round(Math.max(0, income) * seconds);
}
/** Mood points tidying up is worth, to the investors. */
export const TIDY_MOOD = 10;
/** Satisfaction a hackathon gives the vibe coders, and what turning one down costs. */
export const HACKATHON_MORALE = 6;
export const HACKATHON_SNUB = 4;
/** The pizza for a hackathon, in seconds of income. @see pizzaPrice */
export const HACKATHON_PIZZA = 20;
/** What being evacuated puts a flooded home's people out, in morale for a day. */
export const EVACUEE_MORALE = 2;
/** Whether a tour left the investors unimpressed: they paid less than the base 30 s of income. @see SNUB */
export const tourFailed = (income: number, reward: number) => reward < Math.max(0, income) * 30;

/**
 * AN OPPORTUNITY: announced, then on for a while, then over — something to
 * make the most of rather than something to survive.
 */
type Opportunity = {
  warnMs: number;
  activeMs: number;
  warning: { title: string; text: string };
  active: { title: string; text: string };
  /** Where it is, whether one is due, and its choices — and its warning's text, where that depends on the town — or null when there can be none. */
  of: (w: EventWorld) => { x: number; y: number; due: boolean; choices: EventChoice[]; text?: string } | null;
  /** Whether it goes ahead when it strikes, given what was chosen. */
  goesAhead?: (e: GameEvent) => boolean;
  outcome: (e: GameEvent, w: EventWorld) => string;
};

const money = (n: number) => `$${Math.round(n).toLocaleString()}`;
/** "12 interns", "1 intern". */
const people = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;

/**
 * WHO A CHOICE TAKES OFF WORK, as a share of a kind: what sandbags, extra
 * hands at the quays and tidying up for investors cost — people, not money,
 * so the price grows with the company and never becomes a rounding error.
 * @see eventAway
 */
export const CREW_SHARE = { sandbags: 0.5, hands: 0.25, tidy: 1 } as const;


/**
 * A CONVOY SERVED — extra hands at the quays, and calls made while it was in —
 * comes back as a regular route: every call at every port pays this much more,
 * for good, up to `MAX_ROUTES` of them. @see routeWon
 */
export const ROUTE_BONUS = 0.2;
export const MAX_ROUTES = 5;
/** Whether a convoy, over, was served well enough to become a regular route. */
export const routeWon = (e: GameEvent, calls: number) => e.kind === "convoy" && e.chosen === "hands" && calls > 0;
const pct = (k: number) => `+${Math.round(k * 100)}%`;

const OPPORTUNITIES: Partial<Record<EventKind, Opportunity>> = {
  convoy: {
    warnMs: 30_000, activeMs: 60_000,
    warning: { title: "A convoy is coming down the river", text: "For a minute, every call at your ports pays double." },
    active: { title: "The convoy is in", text: "Every call pays double until it has passed." },
    of: (w) => w.convoy && {
      ...w.convoy,
      choices: [
        {
          id: "hands", label: "Extra hands at the quays",
          cost: `${people(w.convoy.handsCrew, "intern")} off work while it is in · calls take half as long${w.convoy.routes < MAX_ROUTES ? ` · it becomes a regular route: ${pct(ROUTE_BONUS)} on every call` : ""}`,
        },
        { id: "usual", label: "Business as usual", cost: "free" },
      ],
    },
    outcome: (e, w) => {
      const calls = w.convoy?.calls ?? 0, routes = w.convoy?.routes ?? 0;
      const won = routeWon(e, calls) && routes < MAX_ROUTES;
      return `${calls} calls while it was in, for ${money(w.convoy?.earned ?? 0)}.${won ? ` It will be back: a regular route, ${pct(ROUTE_BONUS * (routes + 1))} on every call.` : ""}`;
    },
  },
  "investor-tour": {
    warnMs: 45_000, activeMs: 30_000,
    warning: { title: "Investors are coming to look round", text: "They will judge the company by how happy its people are at home." },
    active: { title: "The investors are touring the town", text: "Every unhappy house is being noticed." },
    of: (w) => w.tour && {
      ...w.tour,
      choices: [
        { id: "tidy", label: "Tidy up first", cost: `${people(w.tour.tidyCrew, "vibe coder")} off work until they come · the town looks ${TIDY_MOOD} mood better` },
        { id: "as-is", label: "Show it as it is", cost: `they would pay ${money(w.tour.reward)} now` },
      ],
    },
    outcome: (_e, w) => {
      const r = w.tour?.reward ?? 0;
      if (r <= 0) return "The investors were not impressed, and they talk: the next acquirer will offer less.";
      return w.tour && tourFailed(w.tour.income, r)
        ? `The investors paid ${money(r)}, unimpressed — the next acquirer will offer less.`
        : `The investors liked what they saw: ${money(r)}.`;
    },
  },
  offer: {
    warnMs: 20_000, activeMs: 120_000,
    warning: { title: "An acquirer is circling", text: "Someone wants to buy the company. An offer is coming." },
    active: { title: "An offer is on the table", text: "Sell now and they pay a premium. Hold out, and the company — and the next offer — may grow." },
    // A NO-SHOP in the term sheet: no acquirer comes knocking this run. @see term-deal
    of: (w) => (termEffects().offers === "none" ? null : w.offer && {
      ...w.offer,
      // THE BEST STREET is what caught their eye. @see liveStreetEarnings
      ...(w.offer.street ? { text: `Someone wants to buy the company — they have been walking ${w.offer.street}. An offer is coming.` } : {}),
      choices: [
        { id: "accept", label: "Look at the offer", cost: `+${w.offer.withPremium} Equity, against ${w.offer.equity} without them · sells the company` },
        { id: "hold", label: "Hold out", cost: "the premium goes with them" },
      ],
    }),
    // A sale ends the company, and this with it; still here, it lapsed.
    outcome: (e) => (e.chosen === "accept" ? "The offer lapsed before you signed. Another may come." : "The acquirer has walked away. Another may come."),
  },
  hackathon: {
    warnMs: 45_000, activeMs: 60_000,
    warning: { title: "The vibe coders want a hackathon", text: "A minute off work, all of them, and they come back happier." },
    active: { title: "Hackathon!", text: "The vibe coders are off work, building something nobody asked for." },
    of: (w) => w.hackathon && {
      ...w.hackathon,
      choices: [
        { id: "host", label: "Host it", cost: `${money(w.hackathon.pizza)} of pizza, vibe coders off work a minute, then +${HACKATHON_MORALE} vibe coder morale for a day` },
        { id: "decline", label: "Not now", cost: `−${HACKATHON_SNUB} vibe coder morale for a day` },
      ],
    },
    goesAhead: (e) => e.chosen === "host",
    outcome: (e) => (e.chosen === "host" ? `They are back, and happier for it: +${HACKATHON_MORALE} vibe coder morale for a day.` : `No hackathon this time, and they noticed: −${HACKATHON_SNUB} vibe coder morale for a day.`),
  },
};

/** Opportunities started, moved along and ended. */
function stepOpportunities(out: GameEvent[], w: EventWorld, next: () => number): GameEvent[] {
  for (const [kind, o] of Object.entries(OPPORTUNITIES) as [EventKind, Opportunity][]) {
    const at = o.of(w);
    const ev = out.find((e) => e.kind === kind && e.phase !== "over");
    if (!ev) {
      if (!at?.due || out.some((e) => e.phase !== "over")) continue;
      out = [...out, {
        id: next(), kind, phase: "warning", ...o.warning, ...(at.text ? { text: at.text } : {}),
        where: { x: at.x, y: at.y }, strikesAt: w.now + o.warnMs, choices: at.choices,
      }];
      continue;
    }
    const e: GameEvent = { ...ev, choices: at?.choices ?? ev.choices };
    if (!at) Object.assign(e, { phase: "over", overAt: w.now, outcome: "Called off." });
    else if (e.phase === "warning" && e.strikesAt !== null && w.now >= e.strikesAt) {
      if (o.goesAhead && !o.goesAhead(e)) Object.assign(e, { phase: "over", overAt: w.now, outcome: o.outcome(e, w) });
      else Object.assign(e, { phase: "active", strikesAt: null, endsAt: w.now + o.activeMs, ...o.active });
    } else if (e.phase === "active" && e.endsAt !== undefined && w.now >= e.endsAt) {
      Object.assign(e, { phase: "over", overAt: w.now, outcome: o.outcome(e, w) });
    }
    out = out.map((x) => (x.id === e.id ? e : x));
  }
  return out;
}

/** The choices a flood gives. */
export function floodChoices(w: NonNullable<EventWorld["river"]>): EventChoice[] {
  return [
    { id: "sandbags", label: "Sandbag the riverside", cost: `${people(w.sandbagCrew, "intern")} filling sandbags until it passes` },
    { id: "evacuate", label: "Evacuate", cost: `flooded homes stop work until it passes, and are put out: −${EVACUEE_MORALE} morale for a day` },
    { id: "brace", label: "Brace for it", cost: "whatever the water reaches is damaged: idle until repaired, one at a time" },
  ];
}

/** What a flood came to, by what was chosen. */
function floodOutcome(e: GameEvent): string {
  const n = e.hit ?? 0;
  if (!n) return "The river stayed in its banks.";
  const what = `${n} building${n === 1 ? "" : "s"}`;
  if (e.chosen === "sandbags") return `The sandbags held: ${what} kept dry.`;
  if (e.chosen === "evacuate") return `${what} cleared in time; everyone is back.`;
  return `The water reached ${what}. They are idle until the repair crew has been round each.`;
}

/** The river's flood, moved along. */
function stepFlood(out: GameEvent[], w: EventWorld, next: () => number): GameEvent[] {
  const r = w.river;
  const flood = out.find((e) => e.kind === "river-flood" && e.phase !== "over");
  if (!flood) {
    // ONE THING AT A TIME: a flood waits for anything else under way.
    if (!r?.due || out.some((e) => e.phase !== "over")) return out;
    return [...out, {
      id: next(), kind: "river-flood", phase: "warning",
      title: "The river is going to flood",
      text: "Heavy rain upstream. The river will rise over its banks for a minute; anything low beside it will be under water.",
      where: { x: r.x, y: r.y }, strikesAt: w.now + FLOOD_WARN_MS, choices: floodChoices(r),
    }];
  }
  const e: GameEvent = { ...flood, choices: r ? floodChoices(r) : flood.choices };
  if (!r) Object.assign(e, { phase: "over", overAt: w.now, outcome: "The river is gone." });
  else if (e.phase === "warning" && e.strikesAt !== null && w.now >= e.strikesAt) {
    Object.assign(e, {
      phase: "active", strikesAt: null, endsAt: w.now + FLOOD_MS, title: "The river is in flood",
      text: "The water is over the banks. It goes down on its own.",
    });
  } else if (e.phase === "active") {
    e.hit = Math.max(e.hit ?? 0, r.flooded);
    if (e.endsAt !== undefined && w.now >= e.endsAt) Object.assign(e, { phase: "over", overAt: w.now, outcome: floodOutcome(e) });
  }
  return out.map((x) => (x.id === e.id ? e : x));
}

/**
 * One look at the town: events started, moved on, and put away. Returns the
 * list as it should now be; `next` numbers new ones.
 */
export function stepEvents(events: readonly GameEvent[], w: EventWorld, next: () => number): GameEvent[] {
  if (!w.enabled) return [];
  let out = events.filter((e) => !(e.phase === "over" && e.overAt !== undefined && w.now - e.overAt > OVER_SHOWN_MS));
  const slopEvent = out.find((e) => e.kind === "slop-overflow" && e.phase !== "over");
  if (w.slop) {
    const s = w.slop;
    if (!slopEvent && s.fill >= SLOP_WARN_AT && s.fill < 100) {
      const eta = s.rate > 0 ? ((100 - s.fill) / s.rate) * 1000 : 0;
      out = [...out, {
        id: next(), kind: "slop-overflow", phase: "warning",
        title: "The slop pit is about to overflow",
        text: "When it is full, sludge spills over the rim and runs downhill into whatever is near it.",
        where: { x: s.x, y: s.y }, strikesAt: w.now + eta, choices: slopChoices(s),
      }];
    } else if (!slopEvent && s.fill >= 100) {
      // FULL ALREADY — found so on a load, say — and so overflowing now.
      out = [...out, {
        id: next(), kind: "slop-overflow", phase: "active", ...OVERFLOWING,
        where: { x: s.x, y: s.y }, strikesAt: null, choices: slopChoices(s),
      }];
    } else if (slopEvent) {
      const e = { ...slopEvent, choices: slopChoices(s) };
      if (e.phase === "warning") {
        if (s.fill >= 100) Object.assign(e, { phase: "active", strikesAt: null, ...OVERFLOWING });
        else if (s.fill < SLOP_WARN_AT - 5) Object.assign(e, { phase: "over", overAt: w.now, outcome: "Averted: the pit is back down." });
        else if (s.rate > 0) e.strikesAt = w.now + ((100 - s.fill) / s.rate) * 1000;
      } else if (e.phase === "active" && s.fill < SLOP_CALM_AT) {
        Object.assign(e, { phase: "over", overAt: w.now, outcome: "The overflow has stopped. The sludge will dry up in time." });
      }
      out = out.map((x) => (x.id === e.id ? e : x));
    }
  } else if (slopEvent) {
    out = out.map((x) => (x.id === slopEvent.id ? { ...x, phase: "over" as const, overAt: w.now, outcome: "The pit is gone." } : x));
  }
  return stepOpportunities(stepFlood(out, w, next), w, next);
}
