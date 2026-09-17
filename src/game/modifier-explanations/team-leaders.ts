import {
  EMPLOYEE_SKILLS,
  skillMult,
  skillRankMult,
} from "../team-leaders.catalog";
import { useTeamLeadersEmployeesStore } from "../../state/team-leaders.store";
import type { ModifierBreakdown } from "./types";
import { fmt2, orNone } from "./utils";

export const entries: Record<string, () => ModifierBreakdown> = {
  teamLeaderEmpValuationMult: (): ModifierBreakdown => {
    const employees = useTeamLeadersEmployeesStore.getState().employees;
    let total = 1;
    const rows = employees
      .filter((emp) => (emp.skills.valuation_boost ?? 0) > 0)
      .map((emp) => {
        const lv = emp.skills.valuation_boost!;
        const mult = skillMult("valuation_boost", lv);
        total *= mult;
        return {
          source: `${emp.name} — ${EMPLOYEE_SKILLS.valuation_boost.name} Lv ${lv}`,
          value: fmt2(mult),
          tone: "good" as const,
        };
      });
    return {
      label: "Team leader valuation boost",
      rows: orNone(rows),
      total: fmt2(total),
    };
  },

  teamLeaderEmpGlobalRevenue: (): ModifierBreakdown => {
    const employees = useTeamLeadersEmployeesStore.getState().employees;
    let total = 1;
    const rows = employees
      .filter((emp) => (emp.skills.global_revenue ?? 0) > 0)
      .map((emp) => {
        const lv = emp.skills.global_revenue!;
        const mult = skillMult("global_revenue", lv);
        total *= mult;
        return {
          source: `${emp.name} — ${EMPLOYEE_SKILLS.global_revenue.name} Lv ${lv}`,
          value: fmt2(mult),
          tone: "good" as const,
        };
      });
    return {
      label: "Team leader global revenue",
      rows: orNone(rows),
      total: fmt2(total),
    };
  },

  teamLeaderEmpGlobalIps: (): ModifierBreakdown => {
    const employees = useTeamLeadersEmployeesStore.getState().employees;
    let total = 1;
    const rows = employees
      .filter((emp) => (emp.skills.compounding_ips ?? 0) > 0)
      .map((emp) => {
        const lv = emp.skills.compounding_ips!;
        const mult = skillRankMult("compounding_ips", lv, emp.rank);
        total *= mult;
        return {
          source: `${emp.name} — ${EMPLOYEE_SKILLS.compounding_ips.name} Lv ${lv} (rank ${emp.rank})`,
          value: fmt2(mult),
          tone: "good" as const,
        };
      });
    return {
      label: "Team leader global IPS",
      rows: orNone(rows),
      total: fmt2(total),
    };
  },
};
