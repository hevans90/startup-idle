/**
 * World v2 — EVENTS: things that happen to the town, announced ahead, with
 * something to be done about them.
 *
 * Every event has a WARNING — a countdown and a place on the map — and
 * CHOICES, each with its price, and then it strikes, runs its course, and is
 * over. Nothing here is a punishment from nowhere: the point is the decision.
 * @see EventCard
 *
 * This file is the ENGINE: what an event is (`EventDef`, one file each in
 * `defs/`), what it is shown of the town (`TownView`), and `stepEvents`,
 * which moves every event along. Which event comes, and when, is the
 * director's. @see director
 */
import type { HackathonGain } from "../../game/culture";
import type { GeneratorId } from "../../state/generators.store";
import { formatCurrency } from "../../utils/money-utils";

export type EventKind = "river-flood" | "convoy" | "diligence" | "hackathon" | "offer";

type Spot = { x: number; y: number };

/**
 * PEOPLE A CHOICE TAKES OFF WORK: a share of a kind, while the event is
 * coming, while it is on, or both — people, not money, so the price grows
 * with the company and never becomes a rounding error. @see eventCrew
 */
export type Crew = { who: GeneratorId; share: number; during: "warning" | "active" | "both" };

export type EventChoice = {
  id: string;
  label: string;
  /** What it costs and does, said plainly: the engine's, from its price, crew and note. */
  cost?: string;
  /** Why it cannot be chosen just now, if it cannot. */
  unavailable?: string;
  /** Money paid on choosing it. @see respondToEvent */
  price?: number;
  /** Who it takes off work, and when. */
  crew?: Crew;
};

export type GameEvent = {
  id: number;
  kind: EventKind;
  title: string;
  text: string;
  /** The tile it is about, for the marker and "Show me". */
  where: Spot;
  /** Coming, happening, or done. */
  phase: "warning" | "active" | "over";
  /** When it strikes, ms since the epoch, while it is coming. */
  strikesAt: number | null;
  choices: EventChoice[];
  /** What the player chose, if anything yet — or, unanswered, the event's default once it strikes. */
  chosen?: string;
  /** When it ended, so it can be shown as over for a moment and then put away. */
  overAt?: number;
  /** What happened, once it is over. */
  outcome?: string;
  /** When it will be over, while it is happening, if that is known. */
  endsAt?: number;
  /** The most buildings it has reached at once, so far. */
  hit?: number;
  /** The choice whose act has been done, so it is done once. @see ChoiceDef.act */
  acted?: string;
};

/**
 * WHAT EVERY EVENT IS SHOWN OF THE TOWN, twice a second: built by the scene,
 * read by the events and the director. Nothing here is an event's own state.
 */
export type TownView = {
  now: number;
  /** Money a second. */
  income: number;
  /** Everyone hired, by kind. */
  owned: Partial<Record<GeneratorId, number>>;
  /** Where the river comes on, on a map with one. */
  river: Spot | null;
  /** Buildings under a flood's water now. */
  flooded: number;
  /** The levee a flood could be met with: the walls it would be, their price, and raising it. @see leveeCells */
  levee: { walls: number; price: number; build: () => void } | null;
  /** The kinds a flood's evacuation has put out of their homes. */
  evacuated: readonly GeneratorId[];
  /** A port, on a map with any. */
  port: Spot | null;
  /** The calls made, and what they paid, while the convoy under way is in. */
  convoy: { calls: number; earned: number };
  /** Regular routes won so far. @see ROUTE_BONUS */
  routes: number;
  /** The company's grandest door: the garage, up to the IPO. */
  door: Spot | null;
  /**
   * WHAT DUE DILIGENCE INSPECTS: the town's mood (every house's, weighted by
   * who lives there), the spills on the map (sludged houses and tanks
   * spilling), the share of what drinks that is watered (null with nothing
   * that drinks), and mopping every spill up. @see townMood, DILIGENCE
   */
  diligence: { mood: number; spills: number; watered: number | null; mop: () => void };
  /**
   * The vibe coders' studio, with enough of them for a hackathon: where it
   * is, filling its slop tank by a share, and dealing their ideas onto the
   * culture deck. @see HACKATHON_CODERS, hackathonDeal
   */
  studio: (Spot & { spike: (share: number) => void; ideas: () => HackathonGain }) | null;
  /** A sale, once the company can be sold: its Equity, with an acquirer's premium, and the street that would catch their eye. */
  sale: { equity: number; withPremium: number; street: () => string | undefined } | null;
};

/** A choice, as an event defines it. */
export type ChoiceDef = {
  id: string;
  label: string;
  /** Money, paid on choosing. */
  price?: (v: TownView) => number;
  crew?: Crew;
  /** What else it costs or does, said plainly. */
  note?: (v: TownView) => string;
  /** Why it cannot be chosen just now, if it cannot. */
  unavailable?: (v: TownView) => string | undefined;
  /** What it does on the map the moment it is taken, once. @see stepEvents */
  act?: (v: TownView) => void;
};

/** What an event came to: a line for the card, money, and anything else it leaves. */
export type Outcome = { text: string; money?: number; then?: () => void };

/**
 * AN EVENT: where it can come, how likely, its warning, its choices, what it
 * does if nobody answers, and what it leaves. @see stepEvents, director
 */
export type EventDef = {
  kind: EventKind;
  /** Where it would be — or null, and it cannot come, and one under way is called off. */
  where: (v: TownView) => Spot | null;
  /** How likely it is drawn, against the others that can come; 1 without. @see pickEvent */
  weight?: (v: TownView) => number;
  warnMs: number;
  activeMs: number;
  warning: { title: string; text: (v: TownView) => string };
  active: { title: string; text: string };
  choices: ChoiceDef[];
  /** Taken for the player when the warning runs out unanswered. Never the worst of them. */
  default: string;
  /** Whether it goes ahead when it strikes, given what was chosen. */
  goesAhead?: (e: GameEvent) => boolean;
  /** What it keeps of the town while it is on. */
  during?: (e: GameEvent, v: TownView) => Partial<GameEvent>;
  outcome: (e: GameEvent, v: TownView) => Outcome;
  /** Said when it is called off; "Called off." without. */
  calledOff?: string;
};

/** How long an ended event stays up, ms. */
export const OVER_SHOWN_MS = 10_000;

/** WHO A CHOICE TAKES OFF WORK, as a share of the kind: every event's prices in one place. @see Crew */
export const CREW_SHARE = { sandbags: 0.5, hands: 0.25, tidy: 1, mop: 0.5, hackathon: 1 } as const;

export const money = (n: number) => formatCurrency(Math.round(n));
const NAMES: Partial<Record<GeneratorId, string>> = { intern: "intern", vibe_coder: "vibe coder", "10x_dev": "10x dev" };
/** "12 interns", "1 intern". */
export const people = (n: number, who: GeneratorId) => `${n} ${NAMES[who] ?? who}${n === 1 ? "" : "s"}`;
const DURING: Record<Crew["during"], string> = { warning: "until it strikes", active: "while it is on", both: "until it is over" };
/** How many a crew takes, of those hired. */
export const crewOf = (c: Crew, owned: Partial<Record<GeneratorId, number>>) => Math.floor((owned[c.who] ?? 0) * c.share);

/** A choice as the card shows it: its price, its crew and its note, said in that order. */
export function choiceOf(c: ChoiceDef, v: TownView): EventChoice {
  const price = c.price?.(v);
  const parts = [
    price ? money(price) : null,
    c.crew ? `${people(crewOf(c.crew, v.owned), c.crew.who)} off work ${DURING[c.crew.during]}` : null,
    c.note?.(v) || null,
  ].filter(Boolean);
  const unavailable = c.unavailable?.(v);
  return {
    id: c.id, label: c.label, cost: parts.length ? parts.join(" · ") : "free",
    ...(price ? { price } : {}), ...(c.crew ? { crew: c.crew } : {}), ...(unavailable ? { unavailable } : {}),
  };
}

/** Who every event under way has taken off work, by kind: its chosen choice's crew, in its phase. */
export function eventCrew(events: readonly GameEvent[], owned: Partial<Record<GeneratorId, number>>): Partial<Record<GeneratorId, number>> {
  const out: Partial<Record<GeneratorId, number>> = {};
  for (const e of events) {
    if (e.phase === "over") continue;
    const c = e.choices.find((x) => x.id === e.chosen)?.crew;
    if (!c || (c.during !== "both" && c.during !== e.phase)) continue;
    out[c.who] = Math.min(owned[c.who] ?? 0, (out[c.who] ?? 0) + crewOf(c, owned));
  }
  return out;
}

/** An event the director has just drawn, warned of. */
export function startEvent(d: EventDef, v: TownView, id: number): GameEvent | null {
  const at = d.where(v);
  if (!at) return null;
  return {
    id, kind: d.kind, phase: "warning", title: d.warning.title, text: d.warning.text(v),
    where: at, strikesAt: v.now + d.warnMs, choices: d.choices.map((c) => choiceOf(c, v)),
  };
}

/**
 * One look at the town: every event moved on, and those long over put away.
 * Returns the list as it should now be, what each that ended came to — for
 * the scene to pay out — and the acts of choices just taken, for it to do.
 * @see Outcome, ChoiceDef.act
 */
export function stepEvents(
  events: readonly GameEvent[], v: TownView, defs: Readonly<Partial<Record<EventKind, EventDef>>>,
): { events: GameEvent[]; ended: { event: GameEvent; outcome: Outcome }[]; acts: (() => void)[] } {
  const ended: { event: GameEvent; outcome: Outcome }[] = [];
  const acts: (() => void)[] = [];
  const out: GameEvent[] = [];
  for (const ev of events) {
    const d = defs[ev.kind];
    // And the slop pit's overflow, from a save made before the pit went. @see world/slop/tanks
    if (!d) continue;
    if (ev.phase === "over") {
      if (ev.overAt === undefined || v.now - ev.overAt <= OVER_SHOWN_MS) out.push(ev);
      continue;
    }
    const at = d.where(v);
    // Each choice priced as the town is now — but the one taken kept as it was taken.
    const e: GameEvent = {
      ...ev,
      choices: at ? d.choices.map((c) => (c.id === ev.chosen ? ev.choices.find((x) => x.id === c.id) ?? choiceOf(c, v) : choiceOf(c, v))) : ev.choices,
    };
    const end = () => {
      const o = d.outcome(e, v);
      Object.assign(e, { phase: "over", overAt: v.now, outcome: o.text });
      ended.push({ event: e, outcome: o });
    };
    if (!at) Object.assign(e, { phase: "over", overAt: v.now, outcome: d.calledOff ?? "Called off." });
    else if (e.phase === "warning" && e.strikesAt !== null && v.now >= e.strikesAt) {
      // UNANSWERED: the event's default, taken for the player.
      e.chosen ??= d.default;
      if (d.goesAhead && !d.goesAhead(e)) end();
      else Object.assign(e, { phase: "active", strikesAt: null, endsAt: v.now + d.activeMs, title: d.active.title, text: d.active.text });
    } else if (e.phase === "active") {
      Object.assign(e, d.during?.(e, v));
      if (e.endsAt !== undefined && v.now >= e.endsAt) end();
    }
    // A CHOICE TAKEN does what it does on the map, once — answered or taken by default.
    const act = e.chosen !== undefined && e.acted !== e.chosen && e.phase !== "over" ? d.choices.find((c) => c.id === e.chosen)?.act : undefined;
    if (act) { e.acted = e.chosen; acts.push(() => act(v)); }
    out.push(e);
  }
  return { events: out, ended, acts };
}
