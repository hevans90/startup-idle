import { describe, expect, test } from "bun:test";

import { LEADER_PERKS, PERSONALITIES, REST_SHARE, XP_AT, leaderEffects, perkOffer, rankAt, teamShare, type Leader } from "./leaders";

const leader = (over: Partial<Leader> = {}): Leader => ({
  id: "tl_1", role: "intern", name: "Ada", personality: "overachiever", rank: 0, xp: 0, perks: [], placedAt: 7, ...over,
});

describe("a leader's team", () => {
  test("the team in full, the rest at half; placed nowhere, nothing", () => {
    expect(teamShare(leader(), 10, 10)).toBe(1);
    expect(teamShare(leader(), 0, 10)).toBe(REST_SHARE);
    expect(teamShare(leader(), 4, 10)).toBeCloseTo((4 + 0.5 * 6) / 10);
    expect(teamShare(leader({ placedAt: null }), 10, 10)).toBe(0);
    // Open Door: the rest feel three quarters.
    expect(teamShare(leader({ perks: ["reach"] }), 0, 10)).toBeCloseTo(0.75);
  });

  test("effects scale with it: personality, rank and perks, morale as points", () => {
    const e = leaderEffects(leader({ rank: 2, perks: ["ship"] }), 10, 10);
    expect(e.output).toBeCloseTo(1 + 0.15 + 0.08 + 0.1);
    expect(e.morale).toBe(-4);
    const half = leaderEffects(leader({ rank: 2, perks: ["ship"] }), 0, 10);
    expect(half.output).toBeCloseTo(1 + 0.5 * (0.15 + 0.08 + 0.1));
    expect(half.morale).toBeCloseTo(-2);
    expect(leaderEffects(leader({ placedAt: null }), 10, 10)).toMatchObject({ output: 1, morale: 0, xpPerSecond: 0, hireCost: 1, autoBuy: 0 });
  });

  test("company-wide and kind-wide perks don't scale with the team", () => {
    const e = leaderEffects(leader({ personality: "brown_noser", perks: ["culture", "autopilot"] }), 0, 10);
    expect(e.everyone).toBe(1);
    expect(e.autoBuy).toBeCloseTo(0.25);
    expect(e.hireCost).toBeCloseTo(0.9);
  });

  test("XP comes from the team's work, faster with more of them, at the morale's output, and the personality's pace", () => {
    const few = leaderEffects(leader(), 4, 4).xpPerSecond, many = leaderEffects(leader(), 64, 64).xpPerSecond;
    expect(many).toBeGreaterThan(few);
    expect(leaderEffects(leader(), 64, 64, 2).xpPerSecond).toBeCloseTo(many * 2);
    expect(leaderEffects(leader({ personality: "burnout_risk" }), 64, 64).xpPerSecond).toBeCloseTo(many * 1.3);
  });
});

describe("ranks and perks", () => {
  test("ranks at their XP", () => {
    expect([0, XP_AT[1] - 1, XP_AT[1], XP_AT[5], 1e9].map(rankAt)).toEqual([0, 0, 1, 5, 5]);
  });

  test("a rank reached offers three perks of their pool, the same three till one is taken, none taken twice", () => {
    expect(perkOffer(leader())).toEqual([]);
    const l = leader({ rank: 2 });
    const offer = perkOffer(l);
    expect(offer.length).toBe(3);
    expect(perkOffer(l)).toEqual(offer);
    for (const k of offer) expect(PERSONALITIES.overachiever.pool).toContain(k);
    const next = perkOffer({ ...l, perks: [offer[0]] });
    expect(next).not.toContain(offer[0]);
    expect(perkOffer({ ...l, perks: [offer[0], offer[1]] })).toEqual([]);
  });

  test("every pool is five real perks", () => {
    for (const p of Object.values(PERSONALITIES)) {
      expect(p.pool.length).toBe(5);
      for (const k of p.pool) expect(LEADER_PERKS[k]).toBeDefined();
    }
  });
});
