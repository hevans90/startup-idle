/**
 * EVERY MODIFIER'S EFFECT LINE, catalogue by catalogue, and what is wrong with
 * each by the game's rules. The test holds the catalogues already put right
 * to them; `bun run wording` lists what is left. @see game/wording, plans/polish.md
 */
import { JUICE_SHOP_UPGRADES } from "./achievements.juice-shop";
import { FOUNDERS } from "./founders.catalog";
import { LEADER_PERKS, PERSONALITIES } from "./leaders";
import { isMachine, machineGraph } from "./machine";
import { POLICIES } from "./policies";
import { PROCESSORS } from "./processors";
import { nodeEffectRows, SKILL_TREE } from "./skill-tree";
import { CLAUSES } from "./term-deal";
import { DATASETS } from "./training";
import { MANDATES } from "../state/valuation.store";
import { effectProblems } from "./wording";

export type CatalogueId =
  | "policies" | "leaders" | "juice" | "mandates" | "skillTree" | "founders" | "terms" | "processors" | "machine" | "training";

/** One effect line: whose it is, and what it says. */
export type Line = { name: string; line: string };

/** Each catalogue's effect lines, as the player reads them now. */
export const CATALOGUES: Record<CatalogueId, () => Line[]> = {
  policies: () => POLICIES.map((p) => ({ name: p.name, line: p.says })),
  leaders: () => [
    ...Object.values(PERSONALITIES).map((p) => ({ name: p.name, line: p.says })),
    ...Object.values(LEADER_PERKS).map((p) => ({ name: p.name, line: p.says })),
  ],
  juice: () => JUICE_SHOP_UPGRADES.flatMap((u) => [
    { name: u.name, line: u.description },
    ...(u.minigameDescription ? [{ name: `${u.name} (mini-game)`, line: u.minigameDescription }] : []),
  ]),
  mandates: () => MANDATES.map((m) => ({ name: m.name, line: m.description })),
  // Every row the business tree's nodes show, each saying once. The Machine's are its own.
  skillTree: () => {
    const seen = new Set<string>();
    return SKILL_TREE.nodes.filter((n) => !isMachine(n.id)).flatMap((n) => nodeEffectRows(n).flatMap((r) => {
      if (seen.has(r.label)) return [];
      seen.add(r.label);
      return [{ name: n.title, line: r.label }];
    }));
  },
  // A founder's perks with no exits and with three, and the rule they play by.
  founders: () => FOUNDERS.flatMap((f) => [
    ...new Set([...f.perks(0), ...f.perks(3)]),
  ].map((line) => ({ name: f.name, line })).concat(f.rule ? [{ name: `${f.name} (rule)`, line: f.rule }] : [])),
  terms: () => CLAUSES.flatMap((c) => c.options.map((o) => ({ name: `${c.title}: ${o.label}`, line: o.says }))),
  processors: () => Object.values(PROCESSORS).map((p) => ({ name: p.name, line: p.says })),
  // Its root, notables and keystones: the effect lines, not their detail.
  machine: () => machineGraph().nodes.filter((n) => n.kind !== "minor").map((n) => ({ name: n.title, line: n.effect })),
  training: () => DATASETS.flatMap((d) => d.skills.map((line, k) => ({ name: `${d.name} ${k + 1}`, line }))),
};

/** A line that breaks the rules, and how. */
export type Finding = Line & { problems: string[] };

/** What is wrong in a catalogue, line by line: only the lines with something wrong. */
export function audit(id: CatalogueId): Finding[] {
  return CATALOGUES[id]()
    .map((l) => ({ ...l, problems: effectProblems(l.line) }))
    .filter((f) => f.problems.length > 0);
}

/** The whole report, as text: a heading a catalogue, a line a finding. */
export function report(): string {
  const out: string[] = [];
  let total = 0, lines = 0;
  for (const id of Object.keys(CATALOGUES) as CatalogueId[]) {
    const all = CATALOGUES[id]().length, found = audit(id);
    total += found.length; lines += all;
    out.push(`\n${id}: ${found.length} of ${all} to put right`);
    for (const f of found) out.push(`  ${f.name}: "${f.line}"\n    ${f.problems.join("; ")}`);
  }
  out.push(`\n${total} of ${lines} effect lines to put right`);
  return out.join("\n");
}

if (import.meta.main) console.log(report());
