/**
 * THE INVESTORS: who might back a company at its founding, each with a goal
 * for the run — a thing to have, to avoid, or a time to sell by — the kicker
 * meeting it adds to the sale, and how they negotiate: how much the deal must
 * please them, the clause they care about, the cheque they open with, and how
 * they talk. Data only, nothing read from the game: the goals are measured in
 * term-sheets, the deal in term-deal. @see TermSheetSelect
 */
import type { ClauseId } from "./term-deal";

/** What a goal reads, at the sale. @see term-sheets TermNow */
export type Metric =
  | "houses" | "wonders" | "projects" | "agents" | "interns" | "vibe" | "tenx" | "employees" | "minKind"
  | "mps" | "money" | "valuation" | "innovation" | "ips" | "upgrades" | "managerTiers" | "mandates"
  | "leaders" | "morale" | "singularity" | "routes" | "portIncome";

/**
 * A GOAL, by kind: at least so much (harder milestones ask more), no more than
 * so much (harder: less), none at all (a promise: the milestone moves only the
 * kicker), sell within a time (harder: sooner), hold at least a time (harder:
 * longer), or sell inside a window (harder: narrower).
 */
export type GoalSpec =
  | { kind: "more"; metric: Metric; base: number; unit: string; money?: boolean }
  | { kind: "fewer"; metric: Metric; base: number; unit: string }
  | { kind: "none"; metric: Metric; unit: string }
  | { kind: "within"; seconds: number }
  | { kind: "after"; seconds: number }
  | { kind: "window"; from: number; to: number };

export type Investor = {
  id: string;
  investor: string;
  partner: string;
  motto: string;
  goal: GoalSpec;
  /** The kicker at their plan, a share of the sale's Equity. */
  bonus: number;
  /** The appetite a deal must reach for them to sign. */
  demand: number;
  /** The clause that counts twice for them. */
  cares: ClauseId;
  /** The investment they open with. */
  cheque: "angel" | "seed" | "seriesA";
  says: { eager: string; fine: string; no: string };
};

const H = 3600;

export const INVESTORS: readonly Investor[] = [
  // THE ORIGINALS, kept.
  { id: "quick", investor: "Blitz Capital", partner: "Dex Varga, Managing Partner", motto: "Velocity is a moat · Orbital Finance District",
    goal: { kind: "within", seconds: 2.5 * H }, bonus: 0.3, demand: 2, cares: "exclusivity", cheque: "seed",
    says: { eager: "Sign it and we'll wire it before lunch.", fine: "Fast, clean, done.", no: "Too slow, too loose. We don't sign that." } },
  { id: "town", investor: "Main Street Partners", partner: "Ines Oduya, General Partner", motto: "Patient capital for places people live · Old Quarter",
    goal: { kind: "more", metric: "houses", base: 40, unit: "lived-in houses" }, bonus: 0.25, demand: 1, cares: "board", cheque: "angel",
    says: { eager: "A seat at the table, a town to build. Lovely.", fine: "A fair deal for a main street.", no: "We'd need a say in how the town is run." } },
  { id: "wonders", investor: "Monument Ventures", partner: "Odessa Kline, Founding Partner", motto: "We fund what outlives us · The Plinth",
    goal: { kind: "more", metric: "wonders", base: 2, unit: "wonders standing" }, bonus: 0.3, demand: 2, cares: "milestone", cheque: "seed",
    says: { eager: "Monuments, and ambition to match. Done.", fine: "Build us something worth a plaque.", no: "Think bigger, or find another backer." } },
  { id: "agents", investor: "Singularity Seed", partner: "Unit 7, on behalf of the fund", motto: "Compute is the new capital · Datacentre Row",
    goal: { kind: "more", metric: "agents", base: 12, unit: "AI agents running" }, bonus: 0.25, demand: 2, cares: "pool", cheque: "seed",
    says: { eager: "Cheap headcount, many agents. The future.", fine: "The machines approve. Mostly.", no: "Our thesis needs a bigger option pool." } },

  // TIME.
  { id: "patient", investor: "Glacier Holdings", partner: "Bram Tolle, Senior Partner", motto: "Ice wins in the end · Permafrost Exchange",
    goal: { kind: "after", seconds: 3 * H }, bonus: 0.3, demand: 1, cares: "exclusivity", cheque: "seriesA",
    says: { eager: "Slow money, and lots of it. Splendid.", fine: "We can wait. Can you?", no: "We don't do flips. Promise us time." } },
  { id: "clockwork", investor: "Clockwork Capital", partner: "Ottilie Marsh, Timekeeper", motto: "Precisely on schedule · Meridian Tower",
    goal: { kind: "window", from: 1 * H, to: 2 * H }, bonus: 0.35, demand: 2, cares: "milestone", cheque: "seed",
    says: { eager: "To the minute. We adore a schedule.", fine: "Not early, not late. Agreed.", no: "We need a tighter window than that." } },
  { id: "sprint", investor: "Afterburner Fund", partner: "Kai Renner, Partner", motto: "Ignite, exit, repeat · Launch Pad 3",
    goal: { kind: "within", seconds: 1.5 * H }, bonus: 0.45, demand: 3, cares: "exclusivity", cheque: "seriesA",
    says: { eager: "Ninety minutes. Let's make history.", fine: "Fast enough. Barely.", no: "Nobody shops this deal while we sprint." } },

  // HEADCOUNT.
  { id: "headcount", investor: "Legion Ventures", partner: "Marcus Hale, Partner", motto: "Scale is a strategy · The Barracks",
    goal: { kind: "more", metric: "employees", base: 150, unit: "employees" }, bonus: 0.25, demand: 2, cares: "pool", cheque: "seed",
    says: { eager: "An army of hires, cheaply. Perfect.", fine: "Hire them. Lots of them.", no: "We need hiring to be cheap. Bigger pool." } },
  { id: "megacorp", investor: "Megacorp Holdings", partner: "The Board of Megacorp", motto: "Everything, eventually · Megacorp Plaza",
    goal: { kind: "more", metric: "employees", base: 300, unit: "employees" }, bonus: 0.4, demand: 3, cares: "board", cheque: "seriesA",
    says: { eager: "Another division for the empire.", fine: "Acceptable. Grow.", no: "Megacorp takes the board, or nothing." } },
  { id: "interns", investor: "Fresh Grad Fund", partner: "Priya Nandakumar, Partner", motto: "Young, cheap, enthusiastic · Campus Quad",
    goal: { kind: "more", metric: "interns", base: 80, unit: "interns" }, bonus: 0.2, demand: 1, cares: "pool", cheque: "angel",
    says: { eager: "So many lanyards. We love it.", fine: "Interns are the future. Allegedly.", no: "Give the kids some options, at least." } },
  { id: "vibes", investor: "Good Vibes Capital", partner: "Sunny Okafor, Chief Vibes Officer", motto: "Ship the feeling · The Beanbag Floor",
    goal: { kind: "more", metric: "vibe", base: 40, unit: "vibe coders" }, bonus: 0.3, demand: 2, cares: "milestone", cheque: "seed",
    says: { eager: "The vibes are immaculate. Signing.", fine: "Vibes: acceptable.", no: "Your milestone has bad vibes. Aim higher." } },
  { id: "tenx", investor: "Apex 10x Partners", partner: "Viktor Stahl, Partner", motto: "Only the best · The Summit",
    goal: { kind: "more", metric: "tenx", base: 3, unit: "10x devs" }, bonus: 0.4, demand: 2, cares: "board", cheque: "seriesA",
    says: { eager: "Elite talent, elite terms. Yes.", fine: "Hire the tens. Nothing less.", no: "We sit on the board of every 10x shop." } },
  { id: "polymath", investor: "Polymath Partners", partner: "Rosa Lindqvist, Partner", motto: "Range beats depth · The Commons",
    goal: { kind: "more", metric: "minKind", base: 20, unit: "interns and vibe coders, each" }, bonus: 0.3, demand: 2, cares: "pool", cheque: "seed",
    says: { eager: "A balanced team. How refreshing.", fine: "Breadth. We like breadth.", no: "Make hiring cheaper, for everyone." } },
  { id: "lean", investor: "Skeleton Crew LLC", partner: "Ada Voss, Sole Partner", motto: "Fewer people, more margin · Unit 1, Back Alley",
    goal: { kind: "fewer", metric: "employees", base: 60, unit: "employees" }, bonus: 0.35, demand: 1, cares: "investment", cheque: "angel",
    says: { eager: "Tiny team, tiny cheque. Beautiful.", fine: "Stay small. Stay lean.", no: "Don't take more money than you need." } },
  { id: "noTenx", investor: "Steady Hands Fund", partner: "Graham Oyelaran, Partner", motto: "No heroes, no drama · Quiet Lane",
    goal: { kind: "none", metric: "tenx", unit: "10x devs" }, bonus: 0.25, demand: 1, cares: "board", cheque: "angel",
    says: { eager: "No rock stars. A grown-up company.", fine: "Steady as she goes.", no: "We'd want a seat to keep it steady." } },
  { id: "noVibes", investor: "Old Guard Partners", partner: "Cornelius Pratt III, Partner Emeritus", motto: "As it was done · The Old Exchange",
    goal: { kind: "none", metric: "vibe", unit: "vibe coders" }, bonus: 0.35, demand: 2, cares: "exclusivity", cheque: "seed",
    says: { eager: "Proper engineering. Splendid.", fine: "No vibes. Good.", no: "We'll need exclusivity, young person." } },

  // THE MACHINE.
  { id: "swarm", investor: "Swarm Dynamics", partner: "Hive Node 4", motto: "Many minds, one ledger · The Mesh",
    goal: { kind: "more", metric: "agents", base: 30, unit: "AI agents running" }, bonus: 0.4, demand: 3, cares: "pool", cheque: "seriesA",
    says: { eager: "The swarm grows. The swarm approves.", fine: "Sufficient agents projected.", no: "The swarm requires a larger pool." } },
  { id: "noAgents", investor: "Human Touch Fund", partner: "Maeve Corrigan, Partner", motto: "People, not processes · The Hand-Built House",
    goal: { kind: "none", metric: "agents", unit: "AI agents running" }, bonus: 0.3, demand: 1, cares: "milestone", cheque: "angel",
    says: { eager: "A company of humans. How rare.", fine: "Keep it human.", no: "Promise us more than that." } },
  { id: "horizon", investor: "Event Horizon Partners", partner: "Dr. Juno Achebe, Partner", motto: "Past the point of no return · The Edge",
    goal: { kind: "more", metric: "singularity", base: 45, unit: "% on the AI's meter" }, bonus: 0.35, demand: 2, cares: "exclusivity", cheque: "seed",
    says: { eager: "Let it rise. We'll be watching.", fine: "The meter must climb.", no: "We need it exclusive. The AI is ours." } },
  { id: "luddite", investor: "Luddite Capital", partner: "Ned Ludd Jr., Partner", motto: "Unplug responsibly · The Loom Works",
    goal: { kind: "fewer", metric: "singularity", base: 25, unit: "% on the AI's meter" }, bonus: 0.3, demand: 1, cares: "board", cheque: "angel",
    says: { eager: "Keep the machine in its box. Bravo.", fine: "No singularity on our watch.", no: "A seat, so we can pull the plug." } },

  // MONEY.
  { id: "revenue", investor: "Topline Partners", partner: "Isabel Mercer, Partner", motto: "Revenue solves everything · Ledger Street",
    goal: { kind: "more", metric: "mps", base: 2000, unit: "a second of income", money: true }, bonus: 0.25, demand: 2, cares: "milestone", cheque: "seed",
    says: { eager: "Big numbers, bigger kicker. Yes.", fine: "Make it rain.", no: "Stretch the target, or no deal." } },
  { id: "cashcow", investor: "Cash Cow Capital", partner: "Barnaby Fields, Partner", motto: "Milk it · The Dairy Exchange",
    goal: { kind: "more", metric: "money", base: 1_000_000, unit: "in the bank", money: true }, bonus: 0.3, demand: 2, cares: "investment", cheque: "seriesA",
    says: { eager: "A war chest! We're thrilled.", fine: "Bank it. All of it.", no: "We'd rather write a bigger cheque." } },
  { id: "unicorn", investor: "Unicorn Hunters", partner: "Sasha Blum, Partner", motto: "One in a thousand · The Stables",
    goal: { kind: "more", metric: "valuation", base: 6000, unit: "valuation this run" }, bonus: 0.35, demand: 3, cares: "milestone", cheque: "seriesA",
    says: { eager: "A horn! We see a horn!", fine: "Could be a unicorn. Could be a horse.", no: "Unicorns need moonshots." } },
  { id: "research", investor: "Moonshot Labs", partner: "Prof. Lena Ito, Partner", motto: "Ideas first, money later · Laboratory 9",
    goal: { kind: "more", metric: "ips", base: 1, unit: "innovation a second" }, bonus: 0.3, demand: 2, cares: "pool", cheque: "seed",
    says: { eager: "Research at scale. Marvellous.", fine: "Think. Keep thinking.", no: "Researchers need options." } },
  { id: "patents", investor: "Patent Pool Partners", partner: "Hugo Brandt, Counsel and Partner", motto: "Owned, filed, enforced · The Registry",
    goal: { kind: "more", metric: "innovation", base: 30, unit: "innovation in hand" }, bonus: 0.25, demand: 1, cares: "exclusivity", cheque: "angel",
    says: { eager: "Ideas, hoarded. Excellent.", fine: "File everything.", no: "Exclusive, or not at all." } },

  // THE COMPANY'S MACHINERY.
  { id: "process", investor: "Process Capital", partner: "Mira Kowalczyk, Operating Partner", motto: "Systems over heroes · The Flowchart",
    goal: { kind: "more", metric: "upgrades", base: 12, unit: "upgrades bought" }, bonus: 0.25, demand: 1, cares: "milestone", cheque: "seed",
    says: { eager: "Optimised. Delicious.", fine: "Process is progress.", no: "Your milestone lacks rigour." } },
  { id: "middle", investor: "Middle Management Group", partner: "Derek Pell, VP of Partners", motto: "Synergy, aligned · Floor 14",
    goal: { kind: "more", metric: "managerTiers", base: 10, unit: "manager tiers in all" }, bonus: 0.25, demand: 1, cares: "board", cheque: "angel",
    says: { eager: "Layers! We love layers.", fine: "Let's circle back. Signed.", no: "We need visibility at board level." } },
  { id: "governance", investor: "Governance Trust", partner: "Dame Felicity Oro, Chair", motto: "Order in the boardroom · The Chamber",
    goal: { kind: "more", metric: "mandates", base: 5, unit: "mandate levels passed" }, bonus: 0.3, demand: 2, cares: "board", cheque: "seed",
    says: { eager: "A board that governs. At last.", fine: "Pass the mandates.", no: "The board must be ours." } },
  { id: "talent", investor: "Talent Scouts", partner: "Remy Fontaine, Partner", motto: "We know a star · The Green Room",
    goal: { kind: "more", metric: "leaders", base: 3, unit: "leaders placed" }, bonus: 0.25, demand: 1, cares: "pool", cheque: "angel",
    says: { eager: "Leaders, with options. Ideal.", fine: "Find your stars.", no: "Stars want equity. Pool, please." } },
  { id: "happy", investor: "Wellbeing Ventures", partner: "Noor Haddad, Partner", motto: "Happy teams ship · The Garden Office",
    goal: { kind: "more", metric: "morale", base: 8, unit: "average morale" }, bonus: 0.3, demand: 1, cares: "pool", cheque: "angel",
    says: { eager: "Happy people, happy returns.", fine: "Look after them.", no: "Share the upside with the team." } },
  { id: "hustle", investor: "Hustle Capital", partner: "Brock Steele, Partner", motto: "Sleep is for exits · The Grind House",
    goal: { kind: "fewer", metric: "morale", base: -8, unit: "average morale" }, bonus: 0.35, demand: 2, cares: "milestone", cheque: "seed",
    says: { eager: "Hungry teams win. Grind on.", fine: "Keep them hungry.", no: "Push harder. Raise the bar." } },

  // THE MAP.
  { id: "harbour", investor: "Harbour Masters", partner: "Captain Iris Vane, Partner", motto: "Every tide brings trade · Pier 9",
    goal: { kind: "more", metric: "routes", base: 3, unit: "regular routes won" }, bonus: 0.3, demand: 1, cares: "exclusivity", cheque: "angel",
    says: { eager: "Ships, routes, cargo. Splendid.", fine: "Fair winds.", no: "Our port, our terms: exclusive." } },
  { id: "tidewater", investor: "Tidewater Capital", partner: "Linus Shore, Partner", motto: "Ride the current · The Quay",
    goal: { kind: "more", metric: "portIncome", base: 50, unit: "a second from seaports", money: true }, bonus: 0.3, demand: 2, cares: "investment", cheque: "seriesA",
    says: { eager: "A port economy. Wonderful.", fine: "Trade is good.", no: "Take our money, or don't take our name." } },
  { id: "builder", investor: "Builder's Bank", partner: "Hal Brennan, Master Builder", motto: "Bricks before bits · The Foundry",
    goal: { kind: "more", metric: "projects", base: 6, unit: "projects built" }, bonus: 0.3, demand: 2, cares: "board", cheque: "seed",
    says: { eager: "A skyline! Build, build, build.", fine: "Lay the bricks.", no: "A seat, to approve the plans." } },
  { id: "garage", investor: "Garage Band Capital", partner: "Jo Kasparian, Partner", motto: "Stay scrappy · Unit B, Behind the Bakery",
    goal: { kind: "fewer", metric: "projects", base: 2, unit: "projects built" }, bonus: 0.35, demand: 1, cares: "investment", cheque: "angel",
    says: { eager: "Garage forever. Love it.", fine: "Keep it scrappy.", no: "Too much money ruins a garage." } },
  { id: "smallTown", investor: "Small Town Fund", partner: "Edie Barrow, Partner", motto: "Know your neighbours · The Village Green",
    goal: { kind: "fewer", metric: "houses", base: 15, unit: "lived-in houses" }, bonus: 0.3, demand: 1, cares: "board", cheque: "angel",
    says: { eager: "A village, not a sprawl. Charming.", fine: "Keep it cosy.", no: "We'd like a seat on the parish board." } },
];
