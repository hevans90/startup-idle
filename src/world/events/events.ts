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
import type { CardId, HackathonGain } from "../../game/culture";
import type { GeneratorId } from "../../state/generators.store";
import { formatCurrency } from "../../utils/money-utils";

export type EventKind =
  | "river-flood" | "convoy" | "diligence" | "hackathon" | "offer" | "heatwave" | "drought" | "inspector" | "strike"
  | "road-works" | "poaching" | "viral" | "tenants" | "agents" | "fire"
  | "burst-main" | "sewer-backup" | "blackout" | "earthquake";

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
  /** Come back as a follow-up of one before it. @see Outcome.next */
  chained?: boolean;
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
  /** What a heatwave has overheated so far. @see HEATWAVE */
  overheated: number;
  /**
   * A BUILDING SMOKING: the one a heatwave left overheated, where a fire
   * starts — or, while a fire is on, the one burning. Whether the mains reach
   * it (hydrants), how many next to it it has spread to, turning the mains
   * onto it, and burning it out. Null with nothing overheated. @see FIRE
   */
  smoking: (Spot & { id: number; hydrant: boolean; spread: number; hose: () => void; burnOut: () => void }) | null;
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
  /**
   * WHAT DRINKS: the Data Centre, or the thirstiest of the AI's buildings —
   * and digging a reservoir by it, where one would go (null where none would).
   * Null with nothing drinking. @see HEATWAVE, DROUGHT, digReservoir
   */
  drinkers: (Spot & { dig: (() => void) | null }) | null;
  /**
   * THE OFFICES, for the health inspector: the vibe coders' workplace with the
   * most spilled round it (or any, with none spilled), whether any has spilled,
   * and shutting one for a while. Null with none. @see INSPECTOR
   */
  offices: (Spot & { id: number; dirty: boolean; close: (id: number, seconds: number) => void }) | null;
  /** A building site still waiting on loads, and what they have left to cost. Null with none. @see STRIKE */
  site: (Spot & { left: number }) | null;
  /** The busiest junction, for road works: the one the most people live near. @see busiestJunction */
  junction: Spot | null;
  /** A joint of the longest water main that feeds anything, by cell, to burst. Null with none. @see BURST_MAIN */
  joint: (Spot & { cell: number }) | null;
  /** A manhole on the longest sewer that drains anything, by cell, to back up. Null with none. @see SEWER_BACKUP */
  manhole: (Spot & { cell: number }) | null;
  /** A DISTRICT to lose its power: the buildings round the busiest junction, by id. Null with none. @see BLACKOUT */
  district: (Spot & { ids: number[] }) | null;
  /** THE HQ, once it stands (or what came after it), for an earthquake. @see EARTHQUAKE */
  hq: Spot | null;
  /**
   * A RIVAL AFTER THE 10X DEVS: where they work, how many would go, their
   * satisfaction, what matching costs, and letting them go. Null with too few to poach. @see POACHING
   */
  poach: (Spot & { n: number; score: number; price: number; lose: () => void }) | null;
  /** A slotted card short of its rule, to go viral, and how many are slotted. Null with none. @see VIRAL */
  viral: { card: CardId; name: string; slotted: number } | null;
  /**
   * A STREET OF UNHAPPY HOMES: the unhappiest, the homes round it as unhappy,
   * whose they are, what a café costs, and putting one down by them. Null with none. @see TENANTS
   */
  unhappy: (Spot & { homes: number[]; who: GeneratorId; cafe: number; gift: () => boolean }) | null;
  /** The Data Centre, once agents run in it; and whether the deck can deal the AI's cards. @see AGENT_INCIDENT */
  datacentre: (Spot & { policy: boolean }) | null;
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

/**
 * What an event came to: a line for the card, money, and anything else it
 * leaves — and, maybe, a FOLLOW-UP: an event of a kind to come back in so
 * long, ahead of the director's own. @see Director.next
 */
export type Outcome = { text: string; money?: number; then?: () => void; next?: { kind: EventKind; inMs: number } };

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
  /** Only ever another's follow-up: never drawn by the director on its own. @see Outcome.next */
  followUp?: boolean;
  warnMs: number;
  activeMs: number;
  /** How long it runs once struck, given what was chosen, if not always `activeMs`. */
  activeFor?: (e: GameEvent) => number;
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
  /** IN AI MODE, what the AI chooses the moment it comes; its default without. @see answerFor */
  ai?: (v: TownView) => string;
};

/** How long an ended event stays up, ms. */
export const OVER_SHOWN_MS = 10_000;

/** WHO A CHOICE TAKES OFF WORK, as a share of the kind: every event's prices in one place. @see Crew */
export const CREW_SHARE = { sandbags: 0.5, hands: 0.75, tidy: 1, mop: 0.5, hackathon: 1, sprint: 1, mend: 1, rod: 0.5, strap: 1 } as const;

export const money = (n: number) => formatCurrency(Math.round(n));
/** A line's first letter in capitals. */
export const cap = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);
/** "a minute", "4 minutes", "2½ minutes": how long, for a card. */
export function minutes(ms: number): string {
  const m = ms / 60_000;
  if (m === 1) return "a minute";
  if (Number.isInteger(m)) return `${m} minutes`;
  if (Number.isInteger(m * 2)) return `${Math.floor(m) || ""}½ minutes`;
  return `${Math.round(m)} minutes`;
}
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
  // A CREW OF NOBODY is no choice: off work with nobody to send, it would cost nothing. @see crewOf
  const unavailable = c.unavailable?.(v) || (c.crew && crewOf(c.crew, v.owned) === 0 ? "Nobody to send" : undefined);
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

/**
 * WHAT THE AI ANSWERS, in AI mode: its pick if it is on the card and can be
 * taken and paid for, else the default. @see EventDef.ai
 */
export function answerFor(d: EventDef, e: GameEvent, v: TownView, money: number): string {
  const pick = d.ai?.(v);
  const c = pick !== undefined ? e.choices.find((x) => x.id === pick) : undefined;
  return c && !c.unavailable && (c.price ?? 0) <= money ? c.id : d.default;
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
      else Object.assign(e, { phase: "active", strikesAt: null, endsAt: v.now + (d.activeFor?.(e) ?? d.activeMs), title: d.active.title, text: d.active.text });
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
