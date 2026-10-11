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

export type EventKind = "slop-overflow";

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
};

/** What the director can see. */
export type EventWorld = {
  now: number;
  /** The slop pit: where it is, how full (0–100) and how fast it fills, % a second. Null with none. */
  slop: { x: number; y: number; fill: number; rate: number; trucks: number; truckPrice: number } | null;
};

/** At this fill the pit's overflow is announced; at 100 it overflows; below this it is over. */
export const SLOP_WARN_AT = 90;
export const SLOP_CALM_AT = 95;
/** How long an ended event stays up, ms. */
export const OVER_SHOWN_MS = 10_000;

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

/**
 * One look at the town: events started, moved on, and put away. Returns the
 * list as it should now be; `next` numbers new ones.
 */
export function stepEvents(events: readonly GameEvent[], w: EventWorld, next: () => number): GameEvent[] {
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
  return out;
}
