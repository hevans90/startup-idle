import { beforeEach, describe, expect, test } from "bun:test";
import Decimal from "break_infinity.js";

import { leaderEffects, XP_AT } from "./leaders";
import { APPLICANTS_AT, CHECK_COST, POST_OPEN, badChance, hireCost, makeApplicant, postCost, reputation, reviewsOf, rollFlag, startRank } from "./linkedout";
import { useInnovationStore } from "../state/innovation.store";
import { useLinkedOutStore } from "../state/linkedout.store";
import { useTeamLeadersEmployeesStore } from "../state/team-leaders.store";

const lo = () => useLinkedOutStore.getState();
const rng = (...xs: number[]) => { let i = 0; return () => xs[i++ % xs.length]; };

describe("reputation", () => {
  test("three stars for even morale, one more each +10, half off for each let go, 1 to 5", () => {
    expect(reputation(0, 0)).toBe(3);
    expect(reputation(20, 0)).toBe(5);
    expect(reputation(-20, 0)).toBe(1);
    expect(reputation(10, 2)).toBe(3);
    expect(reputation(100, 0)).toBe(5);
  });

  test("better reputation: more applicants, further along, hiding less", () => {
    expect(APPLICANTS_AT[5]).toBeGreaterThan(APPLICANTS_AT[1]);
    expect(badChance(5)).toBeLessThan(badChance(1));
    expect(startRank(1, rng(0))).toBe(0);
    expect(startRank(5, rng(0))).toBe(2);
    expect(rollFlag(3, rng(0, 0))).not.toBeNull();
    expect(rollFlag(3, rng(0.99))).toBeNull();
    expect(rollFlag(3, rng(badChance(3) + 0.05))).toBe("brilliant");
  });
});

describe("an applicant's profile", () => {
  test("a headline of three parts, a voice, endorsements; starting XP for their rank; the flag hidden", () => {
    const a = makeApplicant("vibe_coder", 5, 1000, rng(0.1, 0.5, 0.9, 0.3));
    expect(a.headline.split(" | ").length).toBe(3);
    expect(a.about.length).toBeGreaterThan(5);
    expect(a.xp).toBe(XP_AT[a.rank]);
    expect(a.flagKnown).toBe(false);
    expect(a.leavesAt).toBeGreaterThan(a.arrivedAt);
  });

  test("reviews say what morale is made of", () => {
    const [r] = reviewsOf([{ kind: "intern", home: -20, work: -8, leaders: 0, score: -20 }]);
    expect(r.text).toContain("commute");
    expect(r.text).toContain("Crunch");
    expect(r.stars).toBeLessThan(3);
  });
});

describe("red flags, once hired", () => {
  const l = { id: "x", role: "intern" as const, name: "X", personality: "overachiever" as const, rank: 3, xp: XP_AT[3], perks: [], placedAt: 1 };
  test("a quiet quitter stops at rank 3; the brilliant rank faster; the ghost a fifth less; the ego costs morale", () => {
    expect(leaderEffects({ ...l, flag: "quitter" }, 10, 10).xpPerSecond).toBe(0);
    expect(leaderEffects({ ...l, flag: "brilliant" }, 10, 10).xpPerSecond).toBeCloseTo(leaderEffects(l, 10, 10).xpPerSecond * 1.5);
    expect(leaderEffects({ ...l, flag: "ghost" }, 10, 10).output - 1).toBeCloseTo((leaderEffects(l, 10, 10).output - 1) * 0.8);
    expect(leaderEffects({ ...l, flag: "ego" }, 10, 10).morale).toBe(leaderEffects(l, 10, 10).morale - 3);
  });
});

describe("LinkedOut, used", () => {
  beforeEach(() => {
    localStorage.clear();
    lo().reset();
    useTeamLeadersEmployeesStore.getState().reset();
    useInnovationStore.setState({ innovation: new Decimal(1000) });
  });

  test("a post costs innovation, one open a kind; applicants come in over its time and no more than it brings", () => {
    expect(lo().post("intern")).toBe(true);
    expect(lo().post("intern")).toBe(false);
    expect(useInnovationStore.getState().innovation.toNumber()).toBe(1000 - postCost(0));
    const t0 = Date.now();
    lo().tick(t0 + POST_OPEN * 1000 + 1, 1, 0);
    const n = lo().applicants.length;
    expect(n).toBeGreaterThan(0);
    expect(n).toBeLessThanOrEqual(APPLICANTS_AT[3]);
    expect(lo().posts).toEqual([]);
  });

  test("checked, then hired: the flag known, the leader on the payroll; hiring over someone lets them go, and remembers it", () => {
    lo().post("intern");
    // By seven minutes two have come even at the slowest (a minute, then three), and none has left.
    lo().tick(Date.now() + 7 * 60_000, 1, 0);
    const [a, b] = lo().applicants;
    expect(b).toBeDefined();
    expect(lo().check(a.id)).toBe(true);
    expect(lo().applicants.find((x) => x.id === a.id)!.flagKnown).toBe(true);
    expect(lo().hire(a.id)).toBe(true);
    expect(useTeamLeadersEmployeesStore.getState().employees[0].id).toBe(a.id);
    expect(useInnovationStore.getState().innovation.toNumber()).toBe(1000 - postCost(0) - CHECK_COST - hireCost(a.rank));
    lo().hire(b.id);
    expect(lo().letGoThisRun).toBe(1);
    expect(lo().connections.map((c) => c.id)).toEqual([a.id]);
  });

  test("a sale makes every leader a connection, brought back later at rank 1", () => {
    useTeamLeadersEmployeesStore.getState().hire({ id: "z", role: "10x_dev", name: "Zed", personality: "chaos_agent", rank: 4, xp: XP_AT[4], perks: [], placedAt: null, flag: "ego" });
    lo().newCompany();
    expect(lo().connections).toEqual([expect.objectContaining({ id: "z", rankWas: 4, flag: "ego" })]);
    useTeamLeadersEmployeesStore.getState().reset();
    expect(lo().rehire("z")).toBe(true);
    expect(useTeamLeadersEmployeesStore.getState().employees[0]).toMatchObject({ name: "Zed", rank: 1, flag: "ego" });
    expect(lo().connections).toEqual([]);
  });
});
