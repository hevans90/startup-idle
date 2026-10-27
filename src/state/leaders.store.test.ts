import { beforeEach, describe, expect, test } from "bun:test";

import { XP_AT } from "../game/leaders";
import { useTeamLeadersEmployeesStore } from "./team-leaders.store";

const store = () => useTeamLeadersEmployeesStore.getState();

describe("the leaders on the payroll", () => {
  beforeEach(() => {
    localStorage.clear();
    store().reset();
  });

  test("one a kind: hired from candidates, placed, ranked by XP, a perk picked, let go", () => {
    store().generateCandidates("intern");
    const c = store().candidatePool.intern![0];
    store().hireCandidateFromPool("intern", c.id);
    expect(store().employees.map((e) => e.id)).toEqual([c.id]);
    // A second hire for the same kind does nothing.
    store().generateCandidates("intern");
    expect(store().candidatePool.intern).toBeUndefined();

    store().setPlacing("intern");
    store().placeLeader(c.id, 42);
    expect(store().employees[0].placedAt).toBe(42);
    expect(store().placing).toBeNull();

    store().tickTeamLeaders(XP_AT[2], () => 1);
    expect(store().employees[0].rank).toBe(2);
    const pick = store().employees[0];
    const { perkOffer } = require("../game/leaders");
    const offered = perkOffer(pick) as string[];
    store().pickPerk(c.id, offered[0] as never);
    store().pickPerk(c.id, "nonsense" as never);
    expect(store().employees[0].perks).toEqual([offered[0]]);

    expect(store().fireEmployee(c.id)).toBe(true);
    expect(store().employees).toEqual([]);
    expect(store().legacies[0]).toMatchObject({ role: "intern", revenueMult: 0.04 });
  });

  test("an old save's stat-and-skills leaders come back as leaders: their trait their personality, their rank kept, the best of each kind, unplaced", async () => {
    localStorage.setItem("team-leaders-store-v1", JSON.stringify({
      state: {
        employees: [
          { id: "a", role: "intern", name: "Tyler", traitId: "chaos_agent", rank: 3, outputStat: 140, moraleStat: 20, unspentPoints: 1, skills: { chaos_spark: 2 } },
          { id: "b", role: "intern", name: "Emma", traitId: "quiet_quitter", rank: 1, skills: {} },
          { id: "c", role: "vibe_coder", name: "Sky", traitId: "not-a-trait", rank: 9, skills: {} },
        ],
        legacies: [], candidatePool: {}, rerollCounts: {},
      },
      version: 0,
    }));
    await useTeamLeadersEmployeesStore.persist.rehydrate();
    const byRole = Object.fromEntries(store().employees.map((e) => [e.role, e]));
    expect(byRole.intern).toMatchObject({ id: "a", personality: "chaos_agent", rank: 3, xp: XP_AT[3], perks: [], placedAt: null });
    expect(byRole.vibe_coder).toMatchObject({ personality: "overachiever", rank: 5 });
    expect(store().employees.length).toBe(2);
  });
});
