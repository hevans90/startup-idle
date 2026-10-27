/**
 * World v2 — AI MODE, ITS PEOPLE: on the Model's own runs, what the player
 * would do on the Innovation and Employees tabs, a step at a time — each
 * kind's work policies set to its style (tall runs them for output, wide for
 * morale), a job posted where a kind has no leader, the best applicant
 * checked and hired unless they hide something bad, the leader put in their
 * kind's busiest workplace, a perk picked at each rank. Spends innovation,
 * not money. @see stepAutopilot, plans/innovation-overhaul.md §6
 */
import { LEADER_PERKS, perkOffer, type LeaderPerkId, type PersonalityId } from "../../game/leaders";
import { CHECK_COST, RED_FLAGS, hireCost, postCost, type Applicant } from "../../game/linkedout";
import { policiesFor, policy, type PolicyId } from "../../game/policies";
import { useGeneratorStore, type GeneratorId } from "../../state/generators.store";
import { useInnovationStore } from "../../state/innovation.store";
import { useLinkedOutStore } from "../../state/linkedout.store";
import { useTeamLeadersEmployeesStore } from "../../state/team-leaders.store";
import { getNetwork } from "../../state/world.store";
import { WORKPLACES, liveSeating } from "../agents/commute";
import type { Grid } from "../grid";

/** What each style runs its people by, most wanted first: tall for output, wide for morale. The kind's own policy is added for either. */
const WANTS: Record<"tall" | "wide", readonly PolicyId[]> = {
  tall: ["crunch", "pipeline", "stack", "freeze"],
  wide: ["lunch", "pipeline", "remote", "freeze"],
};
/** The personalities each style hires first. */
const FITS: Record<"tall" | "wide", readonly PersonalityId[]> = {
  tall: ["overachiever", "burnout_risk", "chaos_agent"],
  wide: ["quiet_quitter", "brown_noser", "thought_leader"],
};
/** And the perks it picks first. */
const PERKS: Record<"tall" | "wide", readonly LeaderPerkId[]> = {
  tall: ["ship", "crunch", "autopilot", "sprint", "reach"],
  wide: ["inspire", "culture", "thick", "reach", "mentor"],
};

const KIND_NAME: Record<GeneratorId, string> = { intern: "interns", vibe_coder: "vibe coders", "10x_dev": "10x devs" };

/** How much the Model wants an applicant: their rank, whether they fit its style, and what their background says. */
function score(a: Applicant, way: "tall" | "wide"): number {
  const bad = a.flagKnown && a.flag && RED_FLAGS[a.flag].bad;
  return a.rank * 2 + (FITS[way].includes(a.personality) ? 1 : 0) + (a.flagKnown && a.flag === "brilliant" ? 2 : 0) - (bad ? 10 : 0);
}

const affords = (n: number) => useInnovationStore.getState().innovation.gte(n);

/**
 * One people step, if there is one to take: what it did, in words for the
 * panel, or null. `tall` is the Model's style, 0 (wide) to 1 (tall).
 */
export function peopleStep(g: Grid, tall: number): string | null {
  const way = tall >= 0.5 ? "tall" : "wide";
  const gen = useGeneratorStore.getState();
  const kinds = gen.generators.filter((x) => x.amount > 0).map((x) => x.id as GeneratorId);

  // POLICIES, in the slots there are, to its style.
  const slots = gen.getPolicySlots();
  for (const k of kinds) {
    const own = policiesFor(k).find((p) => p.only)?.id;
    const want = [...WANTS[way], ...(own ? [own] : [])].slice(0, slots);
    const have = gen.getPolicies(k);
    if (want.length === have.length && want.every((p) => have.includes(p))) continue;
    for (const p of have) if (!want.includes(p)) gen.togglePolicy(k, p);
    for (const p of want) if (!gen.getPolicies(k).includes(p)) gen.togglePolicy(k, p);
    return `${KIND_NAME[k]} run by ${want.map((p) => policy(p).name).join(", ")}`;
  }

  const t = useTeamLeadersEmployeesStore.getState(), lo = useLinkedOutStore.getState();
  if (!useInnovationStore.getState().unlocks.leaders?.unlocked) return null;
  for (const k of kinds) {
    const l = t.employees.find((e) => e.role === k);
    if (!l) {
      // NO LEADER: the best applicant there is, checked before they are hired;
      // and a post, if none is up.
      const best = lo.applicants.filter((a) => a.role === k).sort((a, b) => score(b, way) - score(a, way))[0];
      if (best && !best.flagKnown && affords(CHECK_COST) && lo.check(best.id)) return `a background check on ${best.name}`;
      if (best && best.flagKnown && best.flag && RED_FLAGS[best.flag].bad) { lo.pass(best.id); return `${best.name} passed over: ${RED_FLAGS[best.flag].name.toLowerCase()}`; }
      if (best && affords(hireCost(best.rank)) && lo.hire(best.id)) return `${best.name} hired to lead the ${KIND_NAME[k]}`;
      if (!best && !lo.posts.some((p) => p.role === k) && affords(postCost(lo.postsThisRun)) && lo.post(k)) return `a job posted for a leader of ${KIND_NAME[k]}`;
      continue;
    }
    // PLACED where most of their kind sit, or moved there when their building goes.
    const net = getNetwork();
    const there = l.placedAt !== null ? g.structures.get(l.placedAt) : undefined;
    if (net && (!there || there.build)) {
      const best = busiestWorkplace(g, liveSeating(g, net).desks, k);
      if (best) { t.placeLeader(l.id, best.id); return `${l.name} put in charge of ${best.used} ${KIND_NAME[k]}`; }
    }
    // A PERK at the rank reached: the one its style likes best.
    const offer = perkOffer(l);
    if (offer.length) {
      const take = [...offer].sort((a, b) => rankOf(a, way) - rankOf(b, way))[0];
      t.pickPerk(l.id, take);
      return `${l.name} took ${LEADER_PERKS[take].name}`;
    }
  }
  return null;
}

/** The standing workplace of a kind with the most people at its desks, or null with none. */
export function busiestWorkplace(g: Grid, desks: ReadonlyMap<number, { used: number }>, kind: GeneratorId): { id: number; used: number } | null {
  let best: { id: number; used: number } | null = null;
  for (const s of g.structures.values()) {
    if (s.build || !WORKPLACES[kind].includes(s.def)) continue;
    const used = desks.get(s.id)?.used ?? 0;
    if (!best || used > best.used) best = { id: s.id, used };
  }
  return best;
}

const rankOf = (p: LeaderPerkId, way: "tall" | "wide") => {
  const i = PERKS[way].indexOf(p);
  return i < 0 ? 99 : i;
};
