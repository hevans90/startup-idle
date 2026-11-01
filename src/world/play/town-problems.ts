/**
 * A PROBLEM THE WHOLE TOWN SHARES, said once: when most houses of a kind are
 * unhappy for the same reason, comms says it — "Interns unhappy at home: 214
 * houses, no services" — and their badges go, but for the houses worse off
 * than their street. A big town no longer wears one problem on every roof.
 * @see problemOf, CommsDock, plans/polish.md (UI 5)
 */
import { housedBy, residentsIn } from "../../game/housing";
import type { GeneratorId } from "../../state/generators.store";
import type { Grid } from "../grid";
import type { MoodParts, Why } from "../agents/mood-rules";
import { liveMoods } from "../agents/mood";
import { getNetwork, useWorldStore } from "../../state/world.store";
import { liveStreets } from "./street-earnings";

/** One kind's shared trouble: how many of its houses, and why. */
export type TownProblem = { kind: GeneratorId; houses: number; why: Why };

/** Fewer houses than this of a kind is a street, not a town. */
export const TOWN_FROM = 8;
/** The share of a kind's houses that must share the reason. */
export const MOST = 0.5;
/** How much worse than its street a house must be, mood points, to keep its badge. */
export const WORSE_BY = 5;

/** A house's chief trouble: its worst part, if it is unhappy. */
const chief = (m: MoodParts | undefined): Why | null => {
  if (!m || m.total >= 0) return null;
  let worst: MoodParts["parts"][number] | null = null;
  for (const p of m.parts) if (p.points < 0 && (!worst || p.points < worst.points)) worst = p;
  return worst?.why ?? null;
};

/**
 * WHAT THE TOWN SHARES, and the houses whose badge it says for them: those
 * whose chief trouble it is and who are no worse off than the others on
 * their street who share it. `streetOf` gives a house's street, or null.
 */
export function townProblems(
  g: Grid,
  moods: ReadonlyMap<number, MoodParts>,
  streetOf: (house: number) => number | null,
): { problems: TownProblem[]; quiet: Set<number> } {
  const byKind = new Map<GeneratorId, { houses: number[]; why: Map<Why, number> }>();
  for (const s of g.structures.values()) {
    const h = housedBy(s.def);
    if (!h || residentsIn(s) <= 0) continue;
    const m = moods.get(s.id);
    if (!m) continue;
    const k = byKind.get(h.id) ?? { houses: [] as number[], why: new Map<Why, number>() };
    byKind.set(h.id, k);
    k.houses.push(s.id);
    const why = chief(m);
    if (why) k.why.set(why, (k.why.get(why) ?? 0) + 1);
  }
  const problems: TownProblem[] = [];
  const quiet = new Set<number>();
  for (const [kind, k] of byKind) {
    if (k.houses.length < TOWN_FROM) continue;
    let top: Why | null = null, most = 0;
    for (const [why, n] of k.why) if (n > most) { top = why; most = n; }
    if (!top || most < k.houses.length * MOST) continue;
    problems.push({ kind, houses: most, why: top });
    const sharing = k.houses.filter((id) => chief(moods.get(id)) === top);
    // EACH STREET'S SHARE of it: the average mood of its houses that share it.
    const street = new Map<number, { sum: number; n: number }>();
    for (const id of sharing) {
      const at = streetOf(id);
      if (at === null) continue;
      const t = street.get(at) ?? { sum: 0, n: 0 };
      t.sum += moods.get(id)!.total; t.n++;
      street.set(at, t);
    }
    for (const id of sharing) {
      const m = moods.get(id)!;
      const at = streetOf(id);
      const t = at === null ? undefined : street.get(at);
      // WORSE THAN ITS STREET keeps its badge: it is the one to look at.
      if (t && m.total <= t.sum / t.n - WORSE_BY) continue;
      quiet.add(id);
    }
  }
  return { problems, quiet };
}

let memo: { moods: unknown; rev: number; value: ReturnType<typeof townProblems> } | null = null;

/** THE TOWN'S SHARED PROBLEMS NOW, worked out again when the moods or the streets change. */
export function liveTownProblems(): ReturnType<typeof townProblems> {
  const g = useWorldStore.getState().grid, net = getNetwork();
  if (!net) return { problems: [], quiet: new Set() };
  const moods = liveMoods(g, net);
  if (memo && memo.moods === moods && memo.rev === g.rev) return memo.value;
  const live = liveStreets();
  const streetOf = (id: number) => {
    const door = live?.doors.get(id);
    const at = door === undefined ? -1 : live!.streets.of[door];
    return at >= 0 ? at : null;
  };
  memo = { moods, rev: g.rev, value: townProblems(g, moods, streetOf) };
  return memo.value;
}
