/**
 * THE TERM SHEET, NEGOTIATED: six clauses, each a few options, and what each
 * one does to the run — money in at founding for a share of the sale, a
 * preference on the payout, who sits on the board, an option pool, how hard
 * the investor's milestone is, and whether anyone else may make an offer.
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

export type ClauseId = "investment" | "preference" | "board" | "pool" | "milestone" | "exclusivity";

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
  /** How much it pleases the investor: up is for them, down is for the founder. */
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
        text: (c) => `${c.investor} invests nothing at signing and takes no stake. ${c.founder} builds on their own money.` },
      { id: "angel", label: "Angel", says: "$150 now · 10% stake", appetite: 0, effects: { cash: 150, dilution: 0.1 },
        text: (c) => `${c.investor} invests ${money(150)} at signing in exchange for 10% of the company, fully diluted.` },
      { id: "seed", label: "Seed", says: "$600 now · 20% stake", appetite: 0, effects: { cash: 600, dilution: 0.2 },
        text: (c) => `${c.investor} invests ${money(600)} at signing in exchange for 20% of the company, fully diluted.` },
      { id: "seriesA", label: "Series A", says: "$2,500 now · 35% stake", appetite: -1, effects: { cash: 2500, dilution: 0.35 },
        text: (c) => `${c.investor} leads a Series A of ${money(2500)} at signing for 35% of the company, fully diluted, with the usual protective provisions.` },
    ],
  },
  {
    id: "preference", number: 2, title: "Liquidation preference", options: [
      { id: "none", label: "None", says: "They are paid as everyone is", appetite: -1, effects: {},
        text: () => "On a sale the proceeds are shared pro rata. The investor holds no preference." },
      { id: "one", label: "1× standard", says: "Their money back first", appetite: 0, effects: {},
        text: () => "On a sale the investor is first repaid one times their investment, non-participating, and the rest is shared pro rata." },
      { id: "two", label: "2× participating", says: "Sale pays 15% less Equity", appetite: 2, effects: { saleMult: 0.85 },
        text: () => "On a sale the investor is repaid two times their investment and then participates in the remainder. Founders' proceeds are reduced accordingly." },
    ],
  },
  {
    id: "board", number: 3, title: "Board of directors", options: [
      { id: "founder", label: "Founder control", says: "Mandates at full price", appetite: -1, effects: {},
        text: (c) => `The board is three seats: two appointed by ${c.founder}, one independent. The investor observes without a vote.` },
      { id: "shared", label: "Shared", says: "Mandates 10% cheaper", appetite: 0, effects: { mandateCostMult: 0.9 },
        text: (c) => `The board is three seats: one for ${c.founder}, one for ${c.investor}, one independent agreed by both. Mandates pass by majority.` },
      { id: "investor", label: "Investor majority", says: "Mandates 25% cheaper · sale 10% less", appetite: 2, effects: { mandateCostMult: 0.75, saleMult: 0.9 },
        text: (c) => `${c.investor} appoints two of three seats and the chair. The board may approve mandates and a sale without the founder's consent.` },
    ],
  },
  {
    id: "pool", number: 4, title: "Option pool", options: [
      { id: "none", label: "None", says: "Hiring at full price", appetite: 0, effects: {},
        text: () => "No options are reserved. Employees are paid in salary alone." },
      { id: "ten", label: "10%", says: "Hiring 10% cheaper · sale 5% less", appetite: 1, effects: { hireCostMult: 0.9, saleMult: 0.95 },
        text: () => "A pool of 10% of the company is reserved for employees before the investment, so hires take part of their pay in options." },
      { id: "twenty", label: "20%", says: "Hiring 20% cheaper · sale 10% less", appetite: 2, effects: { hireCostMult: 0.8, saleMult: 0.9 },
        text: () => "A pool of 20% of the company is reserved for employees before the investment. Hiring is cheap; the founder's share is not." },
    ],
  },
  {
    id: "milestone", number: 5, title: "Milestone", options: [
      { id: "comfortable", label: "Comfortable", says: "An easier target · 60% of the bonus", appetite: -1, effects: { goalScale: 0.75, bonusMult: 0.6 },
        text: () => "The milestone below is set at three quarters of the investor's plan. Its kicker is reduced to match." },
      { id: "standard", label: "Standard", says: "Their target · the full bonus", appetite: 0, effects: {},
        text: () => "The milestone below is set at the investor's plan, with the kicker as offered." },
      { id: "stretch", label: "Stretch", says: "Half as hard again · 1.6× the bonus", appetite: 1, effects: { goalScale: 1.5, bonusMult: 1.6 },
        text: () => "The milestone below is a stretch: half as much again as the plan. Met, its kicker is increased by sixty percent." },
      { id: "moonshot", label: "Moonshot", says: "Twice as hard · 2.2× the bonus", appetite: 2, effects: { goalScale: 2, bonusMult: 2.2 },
        text: () => "The milestone below is a moonshot: twice the plan. Met, its kicker is more than doubled. Missed, it pays nothing." },
    ],
  },
  {
    id: "exclusivity", number: 6, title: "Exclusivity", options: [
      { id: "open", label: "Open market", says: "Acquirers may offer as usual", appetite: 0, effects: {},
        text: () => "The company may entertain offers from any acquirer at any time." },
      { id: "rofr", label: "First refusal", says: "Acquirers' premiums halved", appetite: 1, effects: { offers: "halved" },
        text: (c) => `${c.investor} holds a right of first refusal on any sale: acquirers may still offer, knowing the investor may match them.` },
      { id: "noshop", label: "No-shop", says: "No acquirer offers this run", appetite: 2, effects: { offers: "none" },
        text: (c) => `For the life of this company it will not solicit or entertain any offer to acquire it, other than through ${c.investor}.` },
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

export const NEGOTIATORS: Record<string, Negotiator> = {
  quick: { demand: 2, cares: "exclusivity",
    opening: { investment: "seed", preference: "one", board: "shared", pool: "none", milestone: "standard", exclusivity: "noshop" },
    says: { eager: "Sign it and we'll wire it before lunch.", fine: "Fast, clean, done. We can work with this.", no: "Too slow, too loose. We don't sign that." },
    partner: "Dex Varga, Managing Partner", motto: "Velocity is a moat · Orbital Finance District" },
  town: { demand: 1, cares: "board",
    opening: { investment: "angel", preference: "one", board: "shared", pool: "ten", milestone: "standard", exclusivity: "open" },
    says: { eager: "A seat at the table, a town to build. Lovely.", fine: "That's a fair deal for a main street.", no: "We'd need a say in how the town is run." },
    partner: "Ines Oduya, General Partner", motto: "Patient capital for places people live · Old Quarter" },
  clean: { demand: 1, cares: "preference",
    opening: { investment: "angel", preference: "two", board: "founder", pool: "none", milestone: "standard", exclusivity: "open" },
    says: { eager: "Protected and principled. We're delighted.", fine: "Green on both sides of the ledger. Agreed.", no: "We need our capital protected to sign." },
    partner: "Hal Moreno, Stewardship Partner", motto: "Returns without residue · Green Ring, Level 9" },
  wonders: { demand: 2, cares: "milestone",
    opening: { investment: "seed", preference: "one", board: "shared", pool: "none", milestone: "stretch", exclusivity: "open" },
    says: { eager: "Monuments, and ambition to match. Done.", fine: "Build us something worth a plaque.", no: "Think bigger, or find another backer." },
    partner: "Odessa Kline, Founding Partner", motto: "We fund what outlives us · The Plinth" },
  agents: { demand: 2, cares: "pool",
    opening: { investment: "seed", preference: "one", board: "shared", pool: "twenty", milestone: "standard", exclusivity: "open" },
    says: { eager: "Cheap headcount, many agents. The future.", fine: "The machines approve. Mostly.", no: "Our thesis needs a bigger option pool." },
    partner: "Unit 7 (on behalf of the fund)", motto: "Compute is the new capital · Datacentre Row" },
};

export const clause = (id: ClauseId) => CLAUSES.find((c) => c.id === id)!;
export const option = (id: ClauseId, opt: string | undefined): ClauseOption | undefined => clause(id).options.find((o) => o.id === opt);

/** The draft an investor opens with: their terms, every clause filled. */
export const openingDeal = (investor: string): Clauses => ({ ...NEGOTIATORS[investor].opening });

/** How much a deal pleases its investor: each clause's appetite, the one they care about twice. */
export function appetite(investor: string, clauses: Clauses): number {
  const n = NEGOTIATORS[investor];
  return CLAUSES.reduce((sum, c) => sum + (option(c.id, clauses[c.id])?.appetite ?? 0) * (n?.cares === c.id ? 2 : 1), 0);
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
