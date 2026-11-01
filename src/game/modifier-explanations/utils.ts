import { usePrestigeStore } from "../../state/prestige.store";
import { SKILL_TREE, type BonusStat } from "../skill-tree";
import type { BreakdownRow } from "./types";
import { percent, times } from "../wording";


/** A popover's title: the stat, then where it comes from — "Money · skill tree". @see game/wording */
export const titled = (stat: string, from?: string) => (from ? `${stat} · ${from}` : stat);

export type PrestigeMods = ReturnType<typeof usePrestigeStore.getState>["modifiers"];

export function orNone(rows: BreakdownRow[]): BreakdownRow[] {
  return rows.length > 0
    ? rows
    : [{ source: "Nothing yet", value: "—", tone: "neutral" }];
}

export function prestigeRows(
  stat: BonusStat,
  goodDir: "up" | "down" = "up",
): BreakdownRow[] {
  const { allocated } = usePrestigeStore.getState();

  type Tally = { kind: string; value: number; isGood: boolean; count: number };
  const tally = new Map<string, Tally>();

  for (const id of allocated) {
    const node = SKILL_TREE.nodes.find((n) => n.id === id);
    for (const g of node?.grants ?? []) {
      if (g.stat !== stat) continue;
      const isGood =
        goodDir === "up"
          ? g.kind === "pct" ? g.value > 0 : g.value > 1
          : g.kind === "pct" ? g.value < 0 : g.value < 1;
      const key = node!.title;
      const existing = tally.get(key);
      if (existing) {
        existing.count++;
      } else {
        tally.set(key, { kind: g.kind, value: g.value, isGood, count: 1 });
      }
    }
  }

  return Array.from(tally.entries())
    .sort(([, a], [, b]) => a.count - b.count)
    .map(([title, { kind, value, isGood, count }]) => {
      const source = count > 1 ? `${title} ×${count}` : title;
      const combined = kind === "pct" ? value * count : Math.pow(value, count);
      return {
        source,
        value: kind === "pct" ? percent(combined) : times(combined),
        tone: (isGood ? "good" : "bad") as BreakdownRow["tone"],
      };
    });
}

/** A kind's morale as breakdown rows, branching on whether a keystone changes what it counts for. */
export function satRows(
  score: number,
  effScore: number,
  mult: number,
  tone: BreakdownRow["tone"],
  prestige: PrestigeMods,
): BreakdownRow[] {
  if (prestige.satisfactionNeutralized) {
    return [
      { source: `Morale ${score.toFixed(0)}`, value: "", tone: "neutral" },
      { source: "Crunch Mode: morale does nothing", value: times(mult), tone: "neutral" },
    ];
  }
  if (prestige.satisfactionPositiveMult !== 1 && score > 0) {
    return [
      { source: `Morale ${score.toFixed(0)}`, value: "", tone: "neutral" },
      { source: "Enshittify: good morale counts half", value: times(prestige.satisfactionPositiveMult), tone: "bad" },
      { source: `Counted as ${effScore.toFixed(0)}`, value: times(mult), tone },
    ];
  }
  return [{ source: `Morale ${score.toFixed(0)}`, value: times(mult), tone }];
}
