/**
 * A KIND'S LEADER, explained: who, how they lean, the team they lead, their
 * rank and perks, and what it comes to across the kind. @see game/leaders
 */
import { LEADER_PERKS, PERSONALITIES, RANK_OUTPUT } from "../leaders";
import { leadersNow } from "../leader-economy";
import { leaderTeam } from "../projects";
import { useGeneratorStore, type GeneratorId } from "../../state/generators.store";
import { useTeamLeadersEmployeesStore } from "../../state/team-leaders.store";
import type { BreakdownRow, ModifierBreakdown } from "./types";
import { fmt2 } from "./utils";

function leaderEntry(role: GeneratorId): () => ModifierBreakdown {
  return () => {
    const l = useTeamLeadersEmployeesStore.getState().employees.find((e) => e.role === role);
    const owned = Object.fromEntries(useGeneratorStore.getState().generators.map((g) => [g.id, g.amount]));
    const e = leadersNow(owned).of[role];
    if (!l || !e) return { label: "Leader", rows: [{ source: "No leader for this kind", value: "—", tone: "neutral" }], total: fmt2(1) };
    const p = PERSONALITIES[l.personality];
    const rows: BreakdownRow[] = [
      { source: `${l.name}, ${p.name}: ${p.says}`, value: "", tone: "neutral" },
      l.placedAt === null
        ? { source: "Not placed: does nothing until put in a building", value: "", tone: "bad" }
        : { source: `Leads ${leaderTeam(role)} of ${owned[role] ?? 0} in their building; the rest feel half`, value: "", tone: "neutral" },
      { source: `Rank ${l.rank} · +${Math.round(RANK_OUTPUT * l.rank * 100)}% to the team`, value: "", tone: "good" },
      ...l.perks.map((k) => ({ source: `${LEADER_PERKS[k].name}: ${LEADER_PERKS[k].says}`, value: "", tone: "good" as const })),
      { source: "Innovation", value: fmt2(e.innovation), tone: e.innovation >= 1 ? "good" : "bad" },
    ];
    return { label: `${l.name} — leader`, description: "Output across the kind, the team in full and the rest at half.", rows, total: fmt2(e.output) };
  };
}

export const entries: Record<string, () => ModifierBreakdown> = {
  "leader.intern": leaderEntry("intern"),
  "leader.vibe_coder": leaderEntry("vibe_coder"),
  "leader.10x_dev": leaderEntry("10x_dev"),
};
