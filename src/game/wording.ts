/**
 * THE GAME'S WORDS FOR WHAT A MODIFIER DOES: one grammar, one glossary, one
 * way of writing a number. @see plans/polish.md
 *
 * Every modifier has an EFFECT LINE — "Money +25% · morale −8" — and may have
 * a flavour line beside it. The effect line is made here, from the
 * modifier's numbers (`describe`), so what it says cannot drift from what it
 * does; `effectProblems` holds any line still written by hand to the same
 * rules.
 *
 *  - The stat first, then the change: "Money +8%", not "+8% money".
 *  - Gains before costs, each a part, joined by " · " — never "and", "&",
 *    "but" or a comma. No full stop.
 *  - The true minus (−) and times (×). A share is a percentage; two times
 *    and more, or half and less, is a multiple: "Money ×3", "money ×0.5".
 *  - One word for each thing (`STATS`); the words a player must never read
 *    are `NEVER`.
 */
/** A stat a modifier can move. */
export type Stat =
  | "money" | "innovation" | "valuation" | "output" | "equity" | "perEmployee"
  | "hires" | "mandates" | "builds"
  | "morale" | "desirability"
  | "autoBuy" | "slop" | "aiMeter" | "managerSpeed" | "moraleRecovery" | "xp";

/**
 * THE GLOSSARY: each stat's one name, which way is good, and whether it moves
 * by a share (a factor: 1.08 is +8%) or by points (morale +6).
 */
export const STATS: Record<Stat, { name: string; good: "up" | "down"; by: "share" | "points" }> = {
  money: { name: "Money", good: "up", by: "share" },
  innovation: { name: "Innovation", good: "up", by: "share" },
  valuation: { name: "Valuation", good: "up", by: "share" },
  // A kind's whole production, money and innovation both.
  output: { name: "Output", good: "up", by: "share" },
  equity: { name: "Equity", good: "up", by: "share" },
  // Money for each employee on the books, all kinds together.
  perEmployee: { name: "Money per employee", good: "up", by: "share" },
  hires: { name: "Hires", good: "down", by: "share" },
  mandates: { name: "Mandates", good: "down", by: "share" },
  builds: { name: "Builds", good: "down", by: "share" },
  morale: { name: "Morale", good: "up", by: "points" },
  desirability: { name: "Desirability", good: "up", by: "points" },
  autoBuy: { name: "Auto-buy", good: "up", by: "share" },
  slop: { name: "Slop", good: "down", by: "share" },
  aiMeter: { name: "AI meter", good: "up", by: "share" },
  managerSpeed: { name: "Manager speed", good: "up", by: "share" },
  moraleRecovery: { name: "Morale recovery", good: "up", by: "share" },
  // How fast a leader ranks up.
  xp: { name: "XP", good: "up", by: "share" },
};

/** The order parts are written in, gains and costs each. */
const ORDER = Object.keys(STATS) as Stat[];

/**
 * THE WORDS A PLAYER NEVER READS, and what to say instead: code words, and
 * second names for something the glossary already names.
 */
export const NEVER: readonly { word: RegExp; say: string }[] = [
  { word: /\bgenerators?\b/i, say: "interns, vibe coders, 10x devs" },
  { word: /\baccru/i, say: "valuation" },
  { word: /\b(employee )?money output\b/i, say: "money" },
  { word: /\binnovation rate\b/i, say: "innovation" },
  { word: /\bvaluation (accrual )?rate\b/i, say: "valuation" },
  { word: /\bhire (cost|discount)\b/i, say: "hires" },
  { word: /\bhiring cost\b/i, say: "hires" },
  { word: /\bequity payout\b/i, say: "Equity" },
  { word: /\b10x (developer|engineer)s?\b/i, say: "10x devs" },
  { word: /\bautomation\b/i, say: "auto-buy" },
  { word: /\bcost growth\b/i, say: "how fast hires get dearer" },
  { word: /\bcheaper\b/i, say: "a minus on the price: Hires −10%" },
  { word: /\$(?!\d)/, say: "money" },
];

/** A percentage, whole unless under ten and not whole: "+25%", "−2.5%". */
export function percent(p: number): string {
  const r = Math.abs(p) < 10 && Math.round(p * 10) % 10 !== 0 ? Math.round(p * 10) / 10 : Math.round(p);
  return `${r > 0 ? "+" : r < 0 ? "−" : ""}${Math.abs(r)}%`;
}

/** A multiple: two places under two, one from there — "×1.35", "×2.5", "×0.5". */
export function times(f: number): string {
  return `×${Number(f.toFixed(f < 2 ? 2 : 1))}`;
}

/** One stat's change, as a factor or as points: "+8%", "×3", "−8" — or "off", a factor of nought. */
export function change(stat: Stat, value: number): string {
  if (STATS[stat].by === "share" && value === 0) return "off";
  if (STATS[stat].by === "points") return `${value > 0 ? "+" : value < 0 ? "−" : ""}${Math.abs(Math.round(value * 10) / 10)}`;
  if (value >= 2 || (value > 0 && value <= 0.5)) return times(value);
  return percent((value - 1) * 100);
}

/** Whether a change to a stat helps. */
export function helps(stat: Stat, value: number): boolean {
  const neutral = STATS[stat].by === "points" ? 0 : 1;
  return STATS[stat].good === "up" ? value >= neutral : value <= neutral;
}

/** A name mid-line: lower case, unless it opens with an acronym ("AI meter") or a proper name ("Equity", "LinkedOut"). */
const KEEP_CAPITAL = /^([A-Z]{2}|R&D|Equity|LinkedOut|Data Centre|Campus|Overseer)/;
const midLine = (name: string) => (KEEP_CAPITAL.test(name) ? name : name[0].toLowerCase() + name.slice(1));

/** A part no stat can say — "auto-buy one every 2 s", "managers off" — and whether it helps. Written lower case; it opens a line in capitals. */
export type Plain = { text: string; good: boolean };

/**
 * AN EFFECT LINE from a modifier's numbers: shares as factors (`money: 1.08`),
 * points as points (`morale: -8`). Gains first, then costs, each in the
 * glossary's order, any `plain` parts after the stats of their side; a
 * `scope` — "Team", "Vibe coders'" — opens the line. Stats that do nothing
 * are left out.
 *
 *   describe({ output: 1.25, morale: -8 })               → "Output +25% · morale −8"
 *   describe({ output: 1.15, morale: -4 }, "Team")       → "Team output +15% · morale −4"
 */
export function describe(effects: Partial<Record<Stat, number>>, scope?: string, plain: readonly Plain[] = []): string {
  const parts = [
    ...ORDER
      .filter((s) => effects[s] !== undefined && effects[s] !== (STATS[s].by === "points" ? 0 : 1))
      .map((s) => ({ text: `${STATS[s].name} ${change(s, effects[s]!)}`, good: helps(s, effects[s]!) })),
    ...plain,
  ];
  const ordered = [...parts.filter((p) => p.good), ...parts.filter((p) => !p.good)];
  return ordered
    .map(({ text }, k) => {
      if (k > 0) return midLine(text);
      return scope ? `${scope} ${midLine(text)}` : text[0].toUpperCase() + text.slice(1);
    })
    .join(" · ");
}

/** One stat's part on its own, as a row says it: "Money +6%", "Auto-buy off". */
export const part = (stat: Stat, value: number): string => `${STATS[stat].name} ${change(stat, value)}`;

/**
 * A CHANGE TO HOW FAST HIRES GET DEARER, the next over the last: an exponent's
 * points, as a percentage — `dearer(-0.02)` is "Hires get dearer 2% slower".
 */
export const dearer = (delta: number, what = "Hires"): string =>
  `${what} get dearer ${Number(Math.abs(delta * 100).toFixed(1))}% ${delta < 0 ? "slower" : "faster"}`;

/** The longest an effect line runs, characters: more goes in its popover's detail. */
export const EFFECT_MAX = 60;

/**
 * WHAT IS WRONG WITH AN EFFECT LINE written by hand, a reason each, or none.
 * Grammar and glossary only: whether it is true is `describe`'s to say.
 */
export function effectProblems(line: string): string[] {
  const out: string[] = [];
  if (/\.\s*$/.test(line)) out.push("ends with a full stop");
  if (/\s(and|but|&)\s|,\s*but\b/i.test(line)) out.push("joins parts with and, but or & — use ·");
  if (/(^|[\s(])-\d/.test(line)) out.push("a hyphen for a minus — use −");
  if (/\d(\.\d+)?x\b|\bx\d/.test(line)) out.push("an x for times — use ×");
  if (/^[+−-]?\d/.test(line)) out.push("the change before the stat — say the stat first");
  if (/[()]/.test(line)) out.push("an aside in brackets — it belongs in the flavour line");
  if (line.length > EFFECT_MAX) out.push(`longer than ${EFFECT_MAX} characters — the rest is detail`);
  for (const n of NEVER) if (n.word.test(line)) out.push(`says "${line.match(n.word)![0]}" — say ${n.say}`);
  return out;
}
