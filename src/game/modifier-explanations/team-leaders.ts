/**
 * A KIND'S LEADER, explained: who, how they lean, the team they lead, their
 * rank and perks, and what it comes to across the kind. @see game/leaders
 */
import { LEADER_PERKS, PERSONALITIES, RANK_OUTPUT, REST_SHARE } from "../leaders";
import { leadersNow } from "../leader-economy";
import { leaderTeam } from "../projects";
import { useGeneratorStore, type GeneratorId } from "../../state/generators.store";
import { useTeamLeadersEmployeesStore } from "../../state/team-leaders.store";
import type { BreakdownRow, ModifierBreakdown } from "./types";
import { describe, times } from "../wording";

function leaderEntry(role: GeneratorId): () => ModifierBreakdown {
  return () => {
    const l = useTeamLeadersEmployeesStore.getState().employees.find((e) => e.role === role);
    const owned = Object.fromEntries(useGeneratorStore.getState().generators.map((g) => [g.id, g.amount]));
    const e = leadersNow(owned).of[role];
    if (!l || !e) return { label: "Money · leader", rows: [{ source: "No leader for this kind", value: "—", tone: "neutral" }], total: times(1) };
    const p = PERSONALITIES[l.personality];
    // What the rest of the kind feel: half, or Open Door's. @see teamShare
    const rest = Math.max(REST_SHARE, ...l.perks.map((k) => LEADER_PERKS[k].rest ?? 0));
    const rows: BreakdownRow[] = [
      { source: `${l.name}, ${p.name}: ${p.says}`, value: "", tone: "neutral" },
      l.placedAt === null
        ? { source: "Not placed: does nothing until put in a building", value: "", tone: "bad" }
        : { source: `Leads ${leaderTeam(role)} of ${owned[role] ?? 0} in their building; the rest feel ${Math.round(rest * 100)}%`, value: "", tone: "neutral" },
      { source: `Rank ${l.rank} · ${describe({ money: 1 + RANK_OUTPUT * l.rank }, "Team")}`, value: "", tone: "good" },
      ...l.perks.map((k) => ({ source: `${LEADER_PERKS[k].name}: ${LEADER_PERKS[k].says}`, value: "", tone: "good" as const })),
      { source: "Innovation", value: times(e.innovation), tone: e.innovation >= 1 ? "good" : "bad" },
    ];
    return { label: `Money · ${l.name}, leader`, description: "Their kind's money: the team in full, the rest of the kind in part.", rows, total: times(e.output) };
  };
}

export const entries: Record<string, () => ModifierBreakdown> = {
  "leader.intern": leaderEntry("intern"),
  "leader.vibe_coder": leaderEntry("vibe_coder"),
  "leader.10x_dev": leaderEntry("10x_dev"),
};
