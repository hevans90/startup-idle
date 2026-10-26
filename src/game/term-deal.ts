/**
 * THE TERM SHEET, NEGOTIATED: five clauses, each a few options, and what each
 * one does to the run — money in at founding for a share of the sale, who
 * sits on the board, an option pool, how hard the investor's milestone is,
 * and whether anyone else may make an offer.
 *
 * The investor has an APPETITE: each option pleases them or costs them, and
 * the clause they care about counts twice. They sign only a deal that meets
 * their demand, and they open with one that does — so every term the founder
 * takes back has to be paid for with another given away.
 *
 * Read from the session store alone (no map, no agents), so the hire, mandate
 * and sale code can read it without a cycle. A run founded before there were
 * clauses has none, and keeps the old terms exactly. @see term-sheets, TermSheetSelect
 */
import { useSessionStore } from "../state/session.store";
import { INVESTORS, type Investor } from "./term-investors";

export type ClauseId = "investment" | "board" | "pool" | "milestone" | "exclusivity";

/** What a deal does to the run, all together. Identity: no deal, or a deal that changes nothing. */
export type TermEffects = {
  /** Money paid in at founding. */
  cash: number;
  /** The investor's stake: the share of the sale's Equity they take. */
  dilution: number;
  /** Everything else on the sale's Equity: the preference, the board. */
  saleMult: number;
  /** On every hire's price: the option pool. */
  hireCostMult: number;
  /** On every board mandate's price. */
  mandateCostMult: number;
  /** How hard the milestone is: on its target (and on the quick sale's deadline, inversely). */
  goalScale: number;
  /** On the milestone's bonus when it is met. */
  bonusMult: number;
  /** Acquirers' offers this run: as usual, at half the premium, or none. */
  offers: "open" | "halved" | "none";
};

export const NO_EFFECTS: TermEffects = {
  cash: 0, dilution: 0, saleMult: 1, hireCostMult: 1, mandateCostMult: 1, goalScale: 1, bonusMult: 1, offers: "open",
};

/** The words a clause is drawn up in, for the investor whose sheet it is. */
export type ClauseContext = { investor: string; founder: string };

export type ClauseOption = {
  id: string;
  label: string;
  /** What it does, in a line, for the controls. */
  says: string;
  /** How much it pleases the investor: up is for them, down is for the founder. (The investment's is the investor's own: @see optionAppetite.) */
  appetite: number;
  /** The paragraph as the document reads with it. */
  text: (c: ClauseContext) => string;
  effects: Partial<TermEffects>;
};

export type Clause = { id: ClauseId; number: number; title: string; options: readonly ClauseOption[] };

const money = (n: number) => `$${n.toLocaleString("en-GB")}`;

export const CLAUSES: readonly Clause[] = [
  {
    id: "investment", number: 1, title: "Investment", options: [
      { id: "none", label: "Bootstrap", says: "No money in; no stake", appetite: -2, effects: {},
        text: () => "No investment. The founder keeps the company whole." },
      { id: "angel", label: "Angel", says: "$150 now · 10% stake", appetite: 0, effects: { cash: 150, dilution: 0.1 },
        text: () => `${money(150)} at signing for 10% of the company.` },
      { id: "seed", label: "Seed", says: "$600 now · 20% stake", appetite: 0, effects: { cash: 600, dilution: 0.2 },
        text: () => `${money(600)} at signing for 20% of the company.` },
      { id: "seriesA", label: "Series A", says: "$2,500 now · 35% stake", appetite: -1, effects: { cash: 2500, dilution: 0.35 },
        text: () => `${money(2500)} at signing for 35%, with protective provisions.` },
    ],
  },
  {
    id: "board", number: 2, title: "Board", options: [
      { id: "founder", label: "Founder", says: "Mandates at full price", appetite: -1, effects: {},
        text: (c) => `${c.founder} holds two seats of three; the investor observes.` },
      { id: "shared", label: "Shared", says: "Mandates 10% cheaper", appetite: 0, effects: { mandateCostMult: 0.9 },
        text: (c) => `One seat each for ${c.founder} and ${c.investor}, one independent.` },
      { id: "investor", label: "Investor", says: "Mandates 25% cheaper · sale 10% less", appetite: 2, effects: { mandateCostMult: 0.75, saleMult: 0.9 },
        text: (c) => `${c.investor} holds two seats of three, and the chair.` },
    ],
  },
  {
    id: "pool", number: 3, title: "Option pool", options: [
      { id: "none", label: "None", says: "Hiring at full price", appetite: 0, effects: {},
        text: () => "No options reserved; staff are paid in salary." },
      { id: "ten", label: "10%", says: "Hiring 10% cheaper · sale 5% less", appetite: 1, effects: { hireCostMult: 0.9, saleMult: 0.95 },
        text: () => "10% reserved for staff options; hires come cheaper." },
      { id: "twenty", label: "20%", says: "Hiring 20% cheaper · sale 10% less", appetite: 2, effects: { hireCostMult: 0.8, saleMult: 0.9 },
        text: () => "20% reserved for staff options; hiring is cheap." },
    ],
  },
  {
    id: "milestone", number: 4, title: "Milestone", options: [
      { id: "comfortable", label: "Easy", says: "An easier target · 60% of the kicker", appetite: -1, effects: { goalScale: 0.75, bonusMult: 0.6 },
        text: () => "Set at three quarters of the plan; the kicker cut to match." },
      { id: "standard", label: "Plan", says: "Their target · the full kicker", appetite: 0, effects: {},
        text: () => "Set at the investor's plan, with the kicker as offered." },
      { id: "stretch", label: "Stretch", says: "Half as hard again · 1.6× the kicker", appetite: 1, effects: { goalScale: 1.5, bonusMult: 1.6 },
        text: () => "Half as much again as the plan; the kicker raised 60%." },
      { id: "moonshot", label: "Moonshot", says: "Twice as hard · 2.2× the kicker", appetite: 2, effects: { goalScale: 2, bonusMult: 2.2 },
        text: () => "Twice the plan; the kicker more than doubled." },
    ],
  },
  {
    id: "exclusivity", number: 5, title: "Exclusivity", options: [
      { id: "open", label: "Open", says: "Acquirers may offer as usual", appetite: 0, effects: {},
        text: () => "Any acquirer may make an offer, at any time." },
      { id: "rofr", label: "First refusal", says: "Acquirers' premiums halved", appetite: 1, effects: { offers: "halved" },
        text: (c) => `${c.investor} may match any offer; acquirers bid lower.` },
      { id: "noshop", label: "No-shop", says: "No acquirer offers this run", appetite: 2, effects: { offers: "none" },
        text: (c) => `No offers entertained, except through ${c.investor}.` },
    ],
  },
];

export type Clauses = Record<ClauseId, string>;

/** HOW EACH INVESTOR NEGOTIATES: how much they must get, the clause they care about, the draft they open with, and how they reply. */
export type Negotiator = {
  /** The appetite a deal must reach for them to sign. */
  demand: number;
  /** The clause that counts twice for them. */
  cares: ClauseId;
  opening: Clauses;
  says: { eager: string; fine: string; no: string };
  /** Who signs for them, and what their letterhead says under their name. */
  partner: string;
  motto: string;
};

/** Where every opening starts: their cheque, a shared board, no pool, their plan, an open market. */
const BASE: Omit<Clauses, "investment"> = { board: "shared", pool: "none", milestone: "standard", exclusivity: "open" };
/** The order an opening is sweetened in, after the clause they care about. */
const SWEETEN: readonly ClauseId[] = ["pool", "milestone", "exclusivity", "board"];

/**
 * THE DRAFT THEY OPEN WITH: their cheque and the plain terms, then the clause
 * they care about pushed their way a step at a time — then the others — until
 * it meets their demand. So every opening is one they would sign, and it leans
 * the way they lean.
 */
function openingFor(i: Investor): Clauses {
  const d: Clauses = { investment: i.cheque, ...BASE };
  const step = (id: ClauseId): boolean => {
    const opts = CLAUSES.find((c) => c.id === id)!.options;
    const at = opts.findIndex((o) => o.id === d[id]);
    const next = opts.slice(at + 1).find((o) => o.appetite > opts[at].appetite);
    if (!next) return false;
    d[id] = next.id;
    return true;
  };
  const order = [i.cares, ...SWEETEN.filter((c) => c !== i.cares)];
  for (let guard = 0; guard < 20 && appetiteOf(i, d) < i.demand; guard++) {
    if (!order.some((c) => step(c))) break;
  }
  return d;
}

/**
 * WHAT ONE OPTION DOES TO AN INVESTOR'S APPETITE, the clause they care about counted twice. The investment is
 * theirs to judge: the cheque they came to write pleases them, another size costs them, and none at all costs most.
 */
function optionAppetite(i: Pick<Investor, "cares" | "cheque">, id: ClauseId, opt: string | undefined): number {
  const base = id === "investment"
    ? (opt === i.cheque ? 1 : opt === "none" ? -2 : -1)
    : (CLAUSES.find((c) => c.id === id)!.options.find((o) => o.id === opt)?.appetite ?? 0);
  return base * (i.cares === id ? 2 : 1);
}

const appetiteOf = (i: Pick<Investor, "cares" | "cheque">, d: Clauses) => CLAUSES.reduce((sum, c) => sum + optionAppetite(i, c.id, d[c.id]), 0);

const byId = new Map(INVESTORS.map((i) => [i.id, i]));

/** What an option does to this investor's appetite: for the redline's ▲▼. */
export const clauseAppetite = (investor: string, id: ClauseId, opt: string): number => {
  const i = byId.get(investor);
  return i ? optionAppetite(i, id, opt) : 0;
};

export const NEGOTIATORS: Record<string, Negotiator> = Object.fromEntries(INVESTORS.map((i) => [i.id, {
  demand: i.demand, cares: i.cares, opening: openingFor(i), says: i.says, partner: i.partner, motto: i.motto,
}]));

export const clause = (id: ClauseId) => CLAUSES.find((c) => c.id === id)!;
export const option = (id: ClauseId, opt: string | undefined): ClauseOption | undefined => clause(id).options.find((o) => o.id === opt);

/** The draft an investor opens with: their terms, every clause filled. */
export const openingDeal = (investor: string): Clauses => ({ ...NEGOTIATORS[investor].opening });

/** How much a deal pleases its investor: each clause's appetite, the one they care about twice. */
export function appetite(investor: string, clauses: Clauses): number {
  const i = byId.get(investor);
  return i ? appetiteOf(i, clauses) : 0;
}

/** Whether they would sign it. */
export const willSign = (investor: string, clauses: Clauses) => appetite(investor, clauses) >= (NEGOTIATORS[investor]?.demand ?? 0);

/** What they say to a draft: eager well over their demand, fine at it, no below. */
export function reply(investor: string, clauses: Clauses): string {
  const n = NEGOTIATORS[investor], a = appetite(investor, clauses);
  return a < n.demand ? n.says.no : a >= n.demand + 2 ? n.says.eager : n.says.fine;
}

/** A deal's effects, its clauses combined. */
export function dealEffects(clauses: Partial<Clauses> | null | undefined): TermEffects {
  const out = { ...NO_EFFECTS };
  if (!clauses) return out;
  for (const c of CLAUSES) {
    const e = option(c.id, clauses[c.id])?.effects;
    if (!e) continue;
    out.cash += e.cash ?? 0;
    out.dilution += e.dilution ?? 0;
    out.saleMult *= e.saleMult ?? 1;
    out.hireCostMult *= e.hireCostMult ?? 1;
    out.mandateCostMult *= e.mandateCostMult ?? 1;
    out.goalScale *= e.goalScale ?? 1;
    out.bonusMult *= e.bonusMult ?? 1;
    if (e.offers) out.offers = e.offers;
  }
  return out;
}

/** This run's deal's effects: none for a run without clauses. */
export const termEffects = (): TermEffects => dealEffects(useSessionStore.getState().termClauses as Partial<Clauses> | null);

/** What the deal leaves of a sale's Equity: the founder's share, times the preference and the board. */
export const termSaleMult = (): number => {
  const e = termEffects();
  return (1 - e.dilution) * e.saleMult;
};

/** The signed deal, a line a clause — "Investment: Seed" — for wherever the run shows its terms. */
export function dealLines(clauses: Partial<Clauses> | null | undefined): { title: string; label: string; says: string }[] {
  if (!clauses) return [];
  return CLAUSES.flatMap((c) => {
    const o = option(c.id, clauses[c.id]);
    return o ? [{ title: c.title, label: o.label, says: o.says }] : [];
  });
}
