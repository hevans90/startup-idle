import { usePrestigeStore } from "../../state/prestige.store";
import { SKILL_TREE, type BonusStat } from "../skill-tree";
import type { BreakdownRow } from "./types";

// Avoid circular: modifiers → ModifierTag → modifiers
export const fmt2 = (n: number) => `×${Number(n.toFixed(2))}`;
export const pct1 = (v: number) => `${v > 0 ? "+" : ""}${Number(v.toFixed(1))}%`;

export type PrestigeMods = ReturnType<typeof usePrestigeStore.getState>["modifiers"];

export function orNone(rows: BreakdownRow[]): BreakdownRow[] {
  return rows.length > 0
    ? rows
    : [{ source: "No active sources", value: "—", tone: "neutral" }];
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
        value: kind === "pct" ? pct1(combined) : fmt2(combined),
        tone: (isGood ? "good" : "bad") as BreakdownRow["tone"],
      };
    });
}

/** Build satisfaction rows, branching on whether prestige mods alter the raw score. */
export function satRows(
  score: number,
  effScore: number,
  mult: number,
  tone: BreakdownRow["tone"],
  prestige: PrestigeMods,
): BreakdownRow[] {
  if (prestige.satisfactionNeutralized) {
    return [
      { source: `Raw score ${score.toFixed(0)}`, value: "", tone: "neutral" },
      { source: "Neutralized to 0 by keystone", value: fmt2(mult), tone: "neutral" },
    ];
  }
  if (prestige.satisfactionPositiveMult !== 1 && score > 0) {
    return [
      { source: `Raw score ${score.toFixed(0)}`, value: "", tone: "neutral" },
      { source: "Skill tree positive boost", value: fmt2(prestige.satisfactionPositiveMult), tone: "good" },
      { source: `Effective score ${effScore.toFixed(0)}`, value: fmt2(mult), tone },
    ];
  }
  return [{ source: `Score ${score.toFixed(0)}`, value: fmt2(mult), tone }];
}
