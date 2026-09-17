import { describe, expect, test } from "bun:test";
import type { GeneratorId } from "../state/generators.store";
import {
  skillMult,
  skillOffset,
  skillRankMult,
  computeTeamLeaderEmpSatOffsets,
  getActivePairSynergies,
} from "./team-leaders.catalog";
import type { TeamLeaderSkillId, TeamLeaderTraitId } from "./team-leaders.catalog";

// ─── SECTION 1: skillMult / skillOffset / skillRankMult helpers ───────────────

describe("skillMult", () => {
  test("level=0 always returns identity (1)", () => {
    expect(skillMult("revenue_boost", 0)).toBe(1);
  });

  test("level clamping: lv4 === lv3 for revenue_boost", () => {
    expect(skillMult("revenue_boost", 4)).toBe(skillMult("revenue_boost", 3));
    expect(skillMult("revenue_boost", 3)).toBe(1.55);
    expect(skillMult("revenue_boost", 4)).toBe(1.55);
  });

  test("skill with only offset returns identity (1) for mult", () => {
    expect(skillMult("satisfaction_lift", 1)).toBe(1);
  });
});

describe("skillOffset", () => {
  test("level=0 always returns identity (0)", () => {
    expect(skillOffset("chaos_spark", 0)).toBe(0);
  });

  test("chaos_spark offsets at lv1, lv2, lv3", () => {
    expect(skillOffset("chaos_spark", 1)).toBe(-5);
    expect(skillOffset("chaos_spark", 2)).toBe(-10);
    expect(skillOffset("chaos_spark", 3)).toBe(-15);
  });
});

describe("skillRankMult", () => {
  test("level=0 always returns identity (1)", () => {
    expect(skillRankMult("compounding_rev", 0, 5)).toBe(1);
  });

  test("rank=0 always returns 1 regardless of level", () => {
    expect(skillRankMult("compounding_rev", 1, 0)).toBe(1);
  });

  test("compounding_rev lv2 at rank=5: 1 + 0.08*5 = 1.4", () => {
    expect(skillRankMult("compounding_rev", 2, 5)).toBeCloseTo(1.4);
  });

  test("compounding_ips lv3 at rank=10: 1 + 0.1*10 = 2.0", () => {
    expect(skillRankMult("compounding_ips", 3, 10)).toBeCloseTo(2.0);
  });
});

// ─── SECTION 2: computeTeamLeaderEmpSatOffsets ────────────────────────────────

type EmpSkills = Partial<Record<TeamLeaderSkillId, number>>;

function emp(
  role: GeneratorId,
  skillId: TeamLeaderSkillId,
  level: number,
): { role: GeneratorId; skills: EmpSkills; traitId: TeamLeaderTraitId } {
  return { role, skills: { [skillId]: level }, traitId: "overachiever" };
}

describe("computeTeamLeaderEmpSatOffsets", () => {
  test("empty array returns zeroes for all roles", () => {
    const result = computeTeamLeaderEmpSatOffsets([]);
    expect(result).toEqual({ intern: 0, vibe_coder: 0, "10x_dev": 0 });
  });

  test("chaos_spark lv1 on intern: intern=0, others=-5", () => {
    const result = computeTeamLeaderEmpSatOffsets([emp("intern", "chaos_spark", 1)]);
    expect(result.intern).toBe(0);
    expect(result.vibe_coder).toBe(-5);
    expect(result["10x_dev"]).toBe(-5);
  });

  test("team_morale lv2 on any role: all three roles get +8", () => {
    const result = computeTeamLeaderEmpSatOffsets([emp("intern", "team_morale", 2)]);
    expect(result.intern).toBe(8);
    expect(result.vibe_coder).toBe(8);
    expect(result["10x_dev"]).toBe(8);
  });

  test("crunch_mode lv3 on vibe_coder: vibe_coder=-28, others=0", () => {
    const result = computeTeamLeaderEmpSatOffsets([emp("vibe_coder", "crunch_mode", 3)]);
    expect(result.vibe_coder).toBe(-28);
    expect(result.intern).toBe(0);
    expect(result["10x_dev"]).toBe(0);
  });

  test("satisfaction_lift lv1 on intern: intern=5, others=0", () => {
    const result = computeTeamLeaderEmpSatOffsets([emp("intern", "satisfaction_lift", 1)]);
    expect(result.intern).toBe(5);
    expect(result.vibe_coder).toBe(0);
    expect(result["10x_dev"]).toBe(0);
  });

  test("stacking: intern+chaos_spark lv1 AND vibe_coder+team_morale lv1", () => {
    const employees = [
      emp("intern", "chaos_spark", 1),
      emp("vibe_coder", "team_morale", 1),
    ];
    const result = computeTeamLeaderEmpSatOffsets(employees);
    // intern: chaos_spark doesn't affect own role, team_morale lv1=+4 => +4
    expect(result.intern).toBe(4);
    // vibe_coder: chaos_spark from intern => -5, team_morale lv1=+4 => -1
    expect(result.vibe_coder).toBe(-1);
    // 10x_dev: chaos_spark from intern => -5, team_morale lv1=+4 => -1
    expect(result["10x_dev"]).toBe(-1);
  });
});

// ─── SECTION 3: getActivePairSynergies ────────────────────────────────────────

function emps(
  traitIds: TeamLeaderTraitId[],
): { traitId: TeamLeaderTraitId }[] {
  return traitIds.map((id) => ({ traitId: id }));
}

describe("getActivePairSynergies", () => {
  test("empty array returns []", () => {
    expect(getActivePairSynergies([])).toEqual([]);
  });

  test("single employee returns []", () => {
    expect(getActivePairSynergies(emps(["overachiever"]))).toEqual([]);
  });

  test("[overachiever, overachiever] -> exactly one synergy with id='competitive_culture'", () => {
    const result = getActivePairSynergies(emps(["overachiever", "overachiever"]));
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("competitive_culture");
  });

  test("[overachiever, chaos_agent] -> exactly one with id='productive_chaos'", () => {
    const result = getActivePairSynergies(emps(["overachiever", "chaos_agent"]));
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("productive_chaos");
  });

  test("[chaos_agent, overachiever] -> 'productive_chaos' (order independence)", () => {
    const result = getActivePairSynergies(emps(["chaos_agent", "overachiever"]));
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("productive_chaos");
  });

  test("[quiet_quitter, quiet_quitter] -> 'collective_indifference' exactly once", () => {
    const result = getActivePairSynergies(emps(["quiet_quitter", "quiet_quitter"]));
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("collective_indifference");
  });

  test("[burnout_risk, chaos_agent] -> 'dumpster_fire'", () => {
    const result = getActivePairSynergies(emps(["burnout_risk", "chaos_agent"]));
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("dumpster_fire");
  });

  test("three employees [overachiever, chaos_agent, brown_noser] -> only 'productive_chaos'", () => {
    const result = getActivePairSynergies(
      emps(["overachiever", "chaos_agent", "brown_noser"]),
    );
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("productive_chaos");
  });

  test("[burnout_risk, chaos_agent] pair synergy satOffset flows through computeTeamLeaderEmpSatOffsets", () => {
    const employees = [
      { role: "intern" as GeneratorId, skills: {} as EmpSkills, traitId: "burnout_risk" as TeamLeaderTraitId },
      { role: "vibe_coder" as GeneratorId, skills: {} as EmpSkills, traitId: "chaos_agent" as TeamLeaderTraitId },
    ];
    const result = computeTeamLeaderEmpSatOffsets(employees);
    // dumpster_fire satOffset = -15 applied to all roles
    expect(result.intern).toBe(-15);
    expect(result.vibe_coder).toBe(-15);
    expect(result["10x_dev"]).toBe(-15);
  });
});
