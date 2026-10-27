import { create } from "zustand";
import { questIncomeMult } from "../game/quests/effects";
import { agentBonus } from "../game/agents";
import { runningAgents } from "./agents.store";
import { skillOf, training } from "./training.store";
import { ITSELF_BOOST } from "../game/training";

import {
  createJSONStorage,
  persist,
  type StateStorage,
} from "zustand/middleware";
import { roomFor } from "../game/housing";
import { attendance, deskBonus, labBonus, wonderBonus } from "../game/projects";
import { moralePartsNow } from "../game/morale-parts";
import { policyEffects, policySlots, SLOT_TIERS, validPolicies, type PolicyEffects, type PolicyId } from "../game/policies";
import { fusionNow } from "../game/fusion";
import {
  calcGeneratorIncome,
  calcGeneratorPerSecond,
} from "../game/generator-income";
import {
  applyEffectiveSatisfaction,
  computeModifiers,
  type GameModifiers,
} from "../game/modifiers";
import {
  defaultSatisfactionScores,
  SATISFACTION_MAX,
  SATISFACTION_MIN,
  stepSatisfactionScores,
  TO_MORALE,
  vibeSlopMultiplier,
  satisfactionRevenueMultiplier,
  type SatisfactionScores,
} from "../game/satisfaction";
import { leadersNow } from "../game/leader-economy";
import {
  getGeneratorCost,
  getUnlockedGeneratorIds,
} from "../utils/generator-utils";
import { useAiSingularityStore } from "./ai-singularity.store";
import { useFounderStore } from "./founder.store";
import { getManagementTierTotal, useInnovationStore } from "./innovation.store";
import { useMoneyStore } from "./money.store";
import { usePrestigeStore } from "./prestige.store";
import { useLinkedOutStore } from "./linkedout.store";
import { useTeamLeadersEmployeesStore } from "./team-leaders.store";
import { syncAvailableUpgrades } from "./upgrades.store";
import { useSlopPitStore } from "./slop-pit.store";
import { useValuationStore } from "./valuation.store";

/**
 * What the agents running add to income: nothing while they train — that is
 * a training run's price — and more for an AI that has studied itself.
 * @see game/training, ITSELF_BOOST
 */
const trainedAgentBonus = () => training() ? 1 : 1 + (agentBonus(runningAgents()) - 1) * (skillOf("itself") >= 3 ? ITSELF_BOOST : 1);

export type UnlockCondition = {
  requiredId: GeneratorId;
  requiredAmount: number;
};

export type Generator = {
  id: GeneratorId;
  name: string;
  cost: number;
  costExponent: number;
  baseProduction: number;
  interval: number;
  unlockConditions?: UnlockCondition[];
  innovationProduction: number;
};

export type OwnedGenerator = Generator & {
  amount: number; // amount owned
  lastTick: number; // timestamp of last tick
  multiplier: number; // persistent multiplier from upgrades
  costMultiplier: number; // persistent multiplier from upgrades
  innovationMultiplier: number; // persistent multiplier from upgrades
};


export type GeneratorId = "intern" | "vibe_coder" | "10x_dev";

/** Per-hire ratio must stay above 1 or costs tend to 0 at high counts; upgrades clamp to this floor. */
export const MIN_GENERATOR_COST_EXPONENT = 1.02;

type EmployeeManagementData = {
  /** Each kind's work policies, in the slots manager tiers give. @see game/policies */
  policies: Record<GeneratorId, PolicyId[]>;
  autoBuyAcc: Partial<Record<GeneratorId, number>>;
};

/** A full, human-readable breakdown of a per-second resource (money / innovation). */
export type ResourceBreakdown = {
  total: number;
  /** Multipliers applied to every employee's output. */
  globals: { label: string; mult: number; modKey?: string }[];
  /** Per-employee-type contribution + its own multipliers. */
  perGenerator: {
    id: GeneratorId;
    name: string;
    amount: number;
    perUnit: number;
    total: number;
    factors: { label: string; mult: number; modKey?: string }[];
  }[];
};

/**
 * Where valuation/sec comes from: a revenue "engine" (a sub-linear function of
 * $/sec) scaled by board/satisfaction/founder multipliers. Not per-generator, so it
 * has its own shape rather than reusing {@link ResourceBreakdown}.
 */
export type ValuationBreakdown = {
  /** Valuation accrued per second (the engine after all multipliers). */
  total: number;
  /** Engine output before the multiplier factors. */
  base: number;
  /** The $/sec feeding the engine. */
  mps: number;
  /** Multipliers applied to the engine (managers / satisfaction / founder). */
  factors: { label: string; mult: number; modKey?: string }[];
};

type GeneratorState = {
  generators: OwnedGenerator[];
  globalLastTick: number;
  purchaseMode: "single" | "max";
  setPurchaseMode: (mode: "single" | "max") => void;

  employeeManagement: EmployeeManagementData;
  satisfactionScores: SatisfactionScores;
  /** A role's satisfaction score after skill-tree keystones (Crunch Mode → 0,
   * Enshittify → positive side scaled). All satisfaction multipliers read this. */
  getEffectiveSatisfaction: (id: GeneratorId) => number;

  _buildModifiers: () => GameModifiers;

  addGenerator: (gen: OwnedGenerator) => void;
  increaseGenerator: (id: string, count?: number) => void;
  tickGenerators: () => void;
  purchaseGenerator: (id: string, amount: number) => void;

  getMoneyPerSecond: () => number;
  /** $/sec for `units` of one generator, with the full multiplier chain. */
  getGeneratorMoneyPerSecond: (id: GeneratorId, units: number) => number;
  /** Full per-employee + global breakdown of $/sec (for the money popover). */
  getMoneyBreakdown: () => ResourceBreakdown;
  getInnovationPerSecond: () => number;
  /** Innovation/sec for `units` of one generator, with the full multiplier chain. */
  getGeneratorInnovationPerSecond: (id: GeneratorId, units: number) => number;
  /** Full per-employee + global breakdown of innovation/sec. */
  getInnovationBreakdown: () => ResourceBreakdown;
  /** Valuation accrued per second (drives the board/mandate economy). */
  getValuationPerSecond: () => number;
  /** Full breakdown of valuation/sec (for the valuation popover). */
  getValuationBreakdown: () => ValuationBreakdown;

  /** A kind's policies, and what they do together. @see game/policies */
  getPolicies: (id: GeneratorId) => PolicyId[];
  getPolicyEffects: (id: GeneratorId) => PolicyEffects;
  /** How many policies each kind may have now. */
  getPolicySlots: () => number;
  /** Turn a policy on or off for a kind, within its slots. */
  togglePolicy: (id: GeneratorId, policy: PolicyId) => void;
  getEmployeeOutputMults: (id: GeneratorId) => {
    money: number;
    innovation: number;
  };
  getEmployeeCostMult: (id: GeneratorId) => number;
  getAutoBuyRate: (id: GeneratorId) => number;

  reset: () => void;
};

export const GENERATOR_TYPES: Generator[] = [
  {
    id: "intern",
    name: "intern",
    baseProduction: 1,
    interval: 1000,
    cost: 5,
    costExponent: 1.1,
    innovationProduction: 1e-7,
  },
  {
    id: "vibe_coder",
    name: "vibe coder",
    baseProduction: 5,
    interval: 1000,
    cost: 100,
    costExponent: 1.2,
    unlockConditions: [{ requiredId: "intern", requiredAmount: 10 }],
    innovationProduction: 1e-6,
  },
  {
    id: "10x_dev",
    name: "10x dev",
    baseProduction: 100,
    interval: 1000,
    cost: 1000,
    costExponent: 10,
    unlockConditions: [{ requiredId: "vibe_coder", requiredAmount: 10 }],
    innovationProduction: 1e-3,
  },
];

const GENERATOR_PERSIST_KEY = "generators";
/** Legacy split save; read once for migration into the persist blob. */
const EMPLOYEE_MGMT_STORAGE_KEY = "employeeManagement";
const MAX_CATCH_UP_MS = 7 * 24 * 60 * 60 * 1000;

/** The scale saved scores are on, saved beside them: before it was saved, ±100. @see TO_MORALE */
const MORALE_SCALE = SATISFACTION_MAX;

function clampPersistedScore(n: unknown, scale = 1): number {
  if (typeof n !== "number" || Number.isNaN(n)) return 0;
  return Math.min(SATISFACTION_MAX, Math.max(SATISFACTION_MIN, n * scale));
}

const noPolicies = (): Record<GeneratorId, PolicyId[]> => ({ intern: [], vibe_coder: [], "10x_dev": [] });

const defaultEmployeeManagement = (): EmployeeManagementData => ({
  policies: noPolicies(),
  autoBuyAcc: {},
});

const parseEmployeeManagementJson = (
  raw: string | null,
): EmployeeManagementData => {
  if (!raw) return defaultEmployeeManagement();
  try {
    // A save from before policies had perks and management points: they go,
    // nothing to give back — the tiers that earned them give slots now.
    const parsed = JSON.parse(raw) as {
      policies?: Partial<Record<GeneratorId, unknown[]>>;
      autoBuyAcc?: Partial<Record<GeneratorId, number>>;
    };
    const policies = noPolicies();
    for (const id of ["intern", "vibe_coder", "10x_dev"] as GeneratorId[]) {
      policies[id] = validPolicies(id, parsed.policies?.[id] ?? [], SLOT_TIERS.length);
    }
    return { policies, autoBuyAcc: parsed.autoBuyAcc ?? {} };
  } catch {
    return defaultEmployeeManagement();
  }
};

const normalizeEmployeeManagement = (
  value: unknown,
): EmployeeManagementData => {
  if (!value || typeof value !== "object") return defaultEmployeeManagement();
  return parseEmployeeManagementJson(JSON.stringify(value));
};

const reconcileGeneratorsFromSavedArray = (
  savedData: OwnedGenerator[],
): OwnedGenerator[] => {
  const ownedMap = Object.fromEntries(savedData.map((g) => [g.id, g]));
  const unlockedIds = getUnlockedGeneratorIds(savedData);

  return GENERATOR_TYPES.filter((gen) => unlockedIds.includes(gen.id)).map(
    (gen) => {
      const saved = ownedMap[gen.id];
      return {
        ...gen,
        amount: saved?.amount ?? 0,
        multiplier: saved?.multiplier ?? 1,
        costExponent: Math.max(
          MIN_GENERATOR_COST_EXPONENT,
          saved?.costExponent ?? gen.costExponent,
        ),
        costMultiplier: saved?.costMultiplier ?? 1,
        lastTick: saved?.lastTick ?? Date.now(),
        innovationMultiplier: saved?.innovationMultiplier ?? 1,
      } satisfies OwnedGenerator;
    },
  );
};

const readLegacyEmployeeManagementFromStorage = (): EmployeeManagementData => {
  return parseEmployeeManagementJson(
    localStorage.getItem(EMPLOYEE_MGMT_STORAGE_KEY),
  );
};

const generatorStateStorage: StateStorage = {
  getItem: (name) => {
    const raw = localStorage.getItem(name);
    if (!raw) {
      const emOnly = localStorage.getItem(EMPLOYEE_MGMT_STORAGE_KEY);
      if (!emOnly) return null;
      return JSON.stringify({
        state: {
          generators: reconcileGeneratorsFromSavedArray([]),
          employeeManagement: parseEmployeeManagementJson(emOnly),
        },
        version: 0,
      });
    }
    try {
      const parsed: unknown = JSON.parse(raw);
      if (
        parsed &&
        typeof parsed === "object" &&
        "state" in (parsed as object)
      ) {
        return raw;
      }
      if (Array.isArray(parsed)) {
        const em = readLegacyEmployeeManagementFromStorage();
        return JSON.stringify({
          state: {
            generators: reconcileGeneratorsFromSavedArray(
              parsed as OwnedGenerator[],
            ),
            employeeManagement: em,
          },
          version: 0,
        });
      }
    } catch {
      return null;
    }
    return raw;
  },
  setItem: (name, value) => localStorage.setItem(name, value),
  removeItem: (name) => localStorage.removeItem(name),
};

export const syncUnlockedGenerators = (): void => {
  const state = useGeneratorStore.getState();
  const unlockedIds = getUnlockedGeneratorIds(state.generators);
  const byId = new Map(state.generators.map((g) => [g.id, g]));

  // Reconcile the roster to exactly the unlocked set: keep existing entries,
  // add newly-unlocked ones, and DROP any that are no longer buildable (e.g. a
  // founder restriction like the Agentic Delusionist's vibe-coders-only). In
  // normal play unlocks are monotonic so nothing is ever dropped.
  const next: OwnedGenerator[] = unlockedIds.map((id) => {
    const existing = byId.get(id);
    if (existing) return existing;
    const base = GENERATOR_TYPES.find((g) => g.id === id)!;
    return {
      ...base,
      amount: 0,
      multiplier: 1,
      costMultiplier: 1,
      innovationMultiplier: 1,
      lastTick: Date.now(),
    } satisfies OwnedGenerator;
  });

  const unchanged =
    next.length === state.generators.length &&
    next.every((g, i) => g.id === state.generators[i].id);
  if (!unchanged) useGeneratorStore.setState({ generators: next });
};

// ─── tickGenerators helpers ───────────────────────────────────────────────────

function buildAmountsMap(generators: OwnedGenerator[]): Record<GeneratorId, number> {
  const amounts: Record<GeneratorId, number> = { intern: 0, vibe_coder: 0, "10x_dev": 0 };
  for (const g of generators) amounts[g.id] = g.amount;
  return amounts;
}

function tickSatisfaction(
  scores: SatisfactionScores,
  policies: Record<GeneratorId, PolicyId[]>,
  seconds: number,
  prestige: { satisfactionGainMult: number },
  led: ReturnType<typeof leadersNow>,
): SatisfactionScores {
  // EVERY PART BUT WORK, which the step adds itself: home, leaders, events,
  // the founder's fused lean. @see moralePartsNow
  const parts = moralePartsNow(policies, led);
  const satOffsets = Object.fromEntries(
    Object.entries(parts).map(([id, p]) => [id, p.home + p.leaders + p.events + p.founder]),
  ) as Partial<Record<GeneratorId, number>>;
  const driftMult = 1;
  // Culture Capital mandate: multiplies satisfaction recovery speed.
  const mandateSatGain = useValuationStore.getState().getEconomyMultipliers().satisfactionGain;
  return stepSatisfactionScores(
    scores,
    policies,
    seconds * prestige.satisfactionGainMult * driftMult * mandateSatGain,
    satOffsets,
  );
}

function accrueGeneratorIncome(
  gen: OwnedGenerator,
  m: GameModifiers,
  out: { money: number; innovation: number },
  ticks: number,
  moneyMult = 1,
): void {
  const { money, innovation } = calcGeneratorIncome(gen, m, out, ticks);
  useMoneyStore.getState().increaseMoney(money * moneyMult);
  useInnovationStore.getState().increaseInnovation(innovation);
}

export const useGeneratorStore = create<GeneratorState>()(
  persist(
    (set, get) => {
      const runAutoBuy = (
        em: EmployeeManagementData,
        seconds: number,
      ): EmployeeManagementData => {
        const acc = { ...em.autoBuyAcc };

        for (const gen of get().generators) {
          const rate = get().getAutoBuyRate(gen.id);
          if (rate <= 0 || gen.amount === 0) continue;

          let frac = (acc[gen.id] ?? 0) + rate * seconds;
          const maxIter = 500;
          let iter = 0;
          while (frac >= 1 && iter < maxIter) {
            const cost = getGeneratorCost(gen.id, 1);
            const money = useMoneyStore.getState().money;
            if (money.lt(cost)) break;
            useMoneyStore.getState().spendMoney(cost.toNumber());
            get().increaseGenerator(gen.id, 1);
            frac -= 1;
            iter += 1;
          }
          acc[gen.id] = frac;
        }

        return { ...em, autoBuyAcc: acc };
      };

      return {
        purchaseMode: "single",
        generators: reconcileGeneratorsFromSavedArray([]),
        globalLastTick: Date.now(),
        employeeManagement: defaultEmployeeManagement(),
        satisfactionScores: defaultSatisfactionScores(),

        getPolicies: (id) => get().employeeManagement.policies[id] ?? [],

        getPolicyEffects: (id) => policyEffects(get().getPolicies(id)),

        // SLOTS from manager tiers in all, once employee management is open. @see SLOT_TIERS
        getPolicySlots: () =>
          useInnovationStore.getState().unlocks.employeeManagement?.unlocked ? policySlots(getManagementTierTotal()) : 0,

        togglePolicy: (id, policy) => {
          const had = get().getPolicies(id);
          const next = had.includes(policy) ? had.filter((p) => p !== policy) : [...had, policy];
          // Never more than the slots: a full row takes nothing new.
          if (next.length > get().getPolicySlots()) return;
          set((state) => ({
            employeeManagement: {
              ...state.employeeManagement,
              policies: { ...state.employeeManagement.policies, [id]: validPolicies(id, next, SLOT_TIERS.length) },
            },
          }));
        },

        getEmployeeOutputMults: (id) => {
          const e = get().getPolicyEffects(id);
          // AWAY BUILDING: a desk with nobody at it makes nothing. One here,
          // so the live tick and every readout agree. @see attendance
          const here = attendance(id, get().generators.find((g) => g.id === id)?.amount ?? 0);
          // AT THEIR DESKS: led by a team leader, a café next door. @see deskShare
          const atDesks = deskBonus(id);
          // AND THE WONDERS standing on the map, its R&D labs, and the AI
          // agents running in its racks. @see wonderBonus, labBonus, agentBonus
          return {
            money: e.output * here * atDesks * wonderBonus("money") * trainedAgentBonus() * fusionNow().incomeMult * questIncomeMult(),
            innovation: e.innovation * here * atDesks * wonderBonus("innovation") * labBonus(),
          };
        },

        getEmployeeCostMult: (id) => get().getPolicyEffects(id).hireCost,

        getEffectiveSatisfaction: (id) => {
          const m = usePrestigeStore.getState().modifiers;
          return applyEffectiveSatisfaction(get().satisfactionScores[id], m);
        },

        getAutoBuyRate: (id) => {
          // Always Be Hiring, and a leader who is Always Recruiting. @see POLICIES, LEADER_PERKS
          const leaders = useInnovationStore.getState().unlocks.leaders?.unlocked ? leadersNow(buildAmountsMap(get().generators)).of[id]?.autoBuy ?? 0 : 0;
          const rate = get().getPolicyEffects(id).autoBuy + leaders;
          if (rate <= 0) return 0;
          // Founder "Operator" + skill-tree automation modifiers.
          return rate * useFounderStore.getState().autoBuyMult * usePrestigeStore.getState().modifiers.autoBuyMult;
        },

        addGenerator: (gen) =>
          set((state) => {
            const exists = state.generators.find((g) => g.id === gen.id);
            if (exists) return {};
            return { generators: [...state.generators, gen] };
          }),

        /**
         * THE HOUSING GATE LIVES HERE, because this is the one door.
         *
         * Both hiring paths end at this function — `purchaseGenerator` for a
         * manual hire, and `runAutoBuy` (through `tickGenerators`) for an
         * automatic one, which is also what offline progress replays. Gating
         * here covers all three at once; gating in `purchaseGenerator` alone
         * would let auto-buy and every absence walk straight past it.
         *
         * IT CLAMPS RATHER THAN REFUSING. Asked for five when there are beds
         * for two, it hires two. A refusal would make auto-buy stall
         * permanently the moment a player asked for more than they had room
         * for, and the honest answer to "hire as many as you can" is "as many
         * as you can". @see roomFor
         */
        increaseGenerator: (id, count = 1) => {
          const gid = id as GeneratorId;
          const owned = get().generators.find((g) => g.id === id)?.amount ?? 0;
          const take = Math.min(count, roomFor(gid, owned));
          if (take <= 0) return;
          set((state) => ({
            generators: state.generators.map((gen) =>
              gen.id === id ? { ...gen, amount: gen.amount + take } : gen,
            ),
          }));
        },

        _buildModifiers: (): GameModifiers => {
          const generators = get().generators;
          const totalEmployees = generators.reduce((n, g) => n + g.amount, 0);
          const emUnlocked =
            useInnovationStore.getState().unlocks.employeeManagement
              ?.unlocked ?? false;
          return computeModifiers({
            totalEmployees,
            emUnlocked,
            rawScores: get().satisfactionScores,
            owned: buildAmountsMap(generators),
          });
        },

        tickGenerators: () => {
          const now = Date.now();
          const rawInterval = now - get().globalLastTick;
          const globalTickInterval = Math.min(rawInterval, MAX_CATCH_UP_MS);
          if (globalTickInterval < 1000) return;

          const seconds = globalTickInterval / 1000;
          const prestige = usePrestigeStore.getState().modifiers;
          // Raw satisfaction evolves normally; Crunch Mode / Enshittify keystones
          // are applied at read time via getEffectiveSatisfaction.
          const emUnlocked =
            useInnovationStore.getState().unlocks.employeeManagement?.unlocked ?? false;
          const amounts = buildAmountsMap(get().generators);

          // ── 1. Team leaders + satisfaction ───────────────────────────────────
          // Compute the new satisfaction scores as a local variable; we pass
          // them directly to computeModifiers below so the modifier snapshot
          // already reflects the updated scores without an intermediate set().
          // LEADERS work once the Talent Agency has opened them, ranking up
          // from their teams' work; morale is felt from the start. @see game/leaders
          const tlStore = useTeamLeadersEmployeesStore.getState();
          const leadersOpen = useInnovationStore.getState().unlocks.leaders?.unlocked ?? false;
          const outputAt = (id: GeneratorId) => satisfactionRevenueMultiplier(applyEffectiveSatisfaction(get().satisfactionScores[id], prestige));
          const led = leadersOpen ? leadersNow(amounts, outputAt) : { of: {}, everyone: 0 };
          if (leadersOpen) {
            tlStore.tickTeamLeaders(seconds, (l) => led.of[l.role]?.xpPerSecond ?? 0);
            // LINKEDOUT: applicants coming and going, and the company's
            // morale remembered for its reputation. @see useLinkedOutStore
            const kinds = get().generators.filter((g) => g.amount > 0);
            const avg = kinds.length ? kinds.reduce((n, g) => n + get().satisfactionScores[g.id], 0) / kinds.length : 0;
            useLinkedOutStore.getState().tick(now, seconds, avg);
          }
          const satisfactionScores = tickSatisfaction(
            get().satisfactionScores,
            get().employeeManagement.policies,
            seconds,
            prestige,
            led,
          );

          // ── 2. Build full modifier snapshot ──────────────────────────────────
          // Use the freshly computed satisfaction scores so the snapshot is
          // consistent even though we haven't committed them to state yet.
          const totalEmployees = get().generators.reduce((n, g) => n + g.amount, 0);
          const m = computeModifiers({ totalEmployees, emUnlocked, rawScores: satisfactionScores, owned: amounts });

          // ── 3. AI singularity: the agents running push it. @see singularityRate
          useAiSingularityStore.getState().tick(seconds);

          // ── 4. Income accrual (side effects only) ────────────────────────────
          // Slop pit fills from vibe coders and penalises all income when full.
          // Happy vibe coders ship cleaner; miserable ones rage-ship. @see vibeSlopMultiplier
          // And their policies: Hackathon Culture ships faster, and dirtier. @see POLICIES
          useSlopPitStore.getState().tick(amounts.vibe_coder, seconds, vibeSlopMultiplier(m.effectiveScores.vibe_coder ?? 0) * get().getPolicyEffects("vibe_coder").slop);
          const slopPenaltyMult = useSlopPitStore.getState().getMoneyPenaltyMult();

          // Track which gens fire this tick; stamp lastTick after auto-buy so
          // increaseGenerator's set() calls are not overwritten by ours.
          const firingGenIds = new Set<string>();
          for (const gen of get().generators) {
            if (gen.amount === 0) continue;
            const ticks = Math.floor(globalTickInterval / gen.interval);
            if (ticks === 0) continue;
            firingGenIds.add(gen.id);
            accrueGeneratorIncome(gen, m, get().getEmployeeOutputMults(gen.id), ticks, slopPenaltyMult);
          }

          // ── 5. Auto-buy ───────────────────────────────────────────────────────
          // runAutoBuy calls increaseGenerator (its own set() calls) — must run
          // before we read generators for the lastTick stamp below.
          const employeeManagement = runAutoBuy(get().employeeManagement, seconds);

          // ── Commit all four mutations in a single set() call ─────────────────
          // Read generators NOW (after auto-buy) so purchased units are preserved.
          const generators = get().generators.map((gen) =>
            firingGenIds.has(gen.id) ? { ...gen, lastTick: now } : gen,
          );
          set({ globalLastTick: now, satisfactionScores, generators, employeeManagement });

          syncUnlockedGenerators();
          syncAvailableUpgrades();

          // ── 6. Valuation accrual ──────────────────────────────────────────────
          // getValuationPerSecond() is the single source of truth — includes all
          // active multipliers so the toolbar always matches actual accrual.
          const valuationGain = get().getValuationPerSecond() * seconds;
          if (valuationGain > 0) useValuationStore.getState().increaseValuation(valuationGain);

        },

        purchaseGenerator: (id: string, amount = 1) => {
          // BEDS BEFORE MONEY, and this order is the whole point. The clamp in
          // `increaseGenerator` keeps the count honest, but this function
          // charges FIRST and increases after — so without this check a player
          // at capacity would pay full price for employees who never arrive.
          // @see increaseGenerator
          const owned = get().generators.find((g) => g.id === id)?.amount ?? 0;
          if (roomFor(id as GeneratorId, owned) < amount) return;

          const cost = getGeneratorCost(id, amount);
          const moneyState = useMoneyStore.getState();

          if (moneyState.money.gte(cost)) {
            moneyState.spendMoney(cost.toNumber());
            get().increaseGenerator(id, amount);
            syncUnlockedGenerators();
            syncAvailableUpgrades();
          }
        },

        getGeneratorMoneyPerSecond: (id, units) => {
          const gen = get().generators.find((g) => g.id === id);
          if (!gen || units <= 0) return 0;
          const m = get()._buildModifiers();
          const out = get().getEmployeeOutputMults(id);
          // AND THE SLOP PIT'S CUT, as the tick takes it: without it the rate
          // shown — and every price set in seconds of income — was up to six
          // times what was really coming in. @see getMoneyPenaltyMult
          return calcGeneratorPerSecond(gen, m, out, units).money * useSlopPitStore.getState().getMoneyPenaltyMult();
        },
        // Sum each generator's full-chain output (single source of truth: the
        // employee-tab popovers and this getter stay in lockstep).
        getMoneyPerSecond: () =>
          get().generators.reduce(
            (sum, gen) =>
              sum + get().getGeneratorMoneyPerSecond(gen.id, gen.amount),
            0,
          ),

        getMoneyBreakdown: () => {
          const m = get()._buildModifiers();

          const globals = [
            {
              label: "Innovation",
              mult: m.innovationCurve,
              modKey: "innovationCurve",
            },
            { label: "Managers", mult: m.managerMoney, modKey: "managerMoney" },
            {
              label: "Board mandates",
              mult: m.mandateMoney,
              modKey: "mandateMoney",
            },
            { label: "Vape juice", mult: m.juiceMoney, modKey: "juiceMoney" },
            { label: "Slop pit", mult: useSlopPitStore.getState().getMoneyPenaltyMult() },
            {
              label: "Headcount synergy",
              mult: m.headcountMoney,
              modKey: "headcountMoney",
            },
            {
              label: "Skill tree",
              mult: m.prestigeMoney * m.prestigeEmployeeOutput,
              modKey: "skillTreeMoney",
            },
          ];

          const perGenerator = get()
            .generators.filter((g) => g.amount > 0)
            .map((gen) => {
              const out = get().getEmployeeOutputMults(gen.id);
              return {
                id: gen.id,
                name: gen.name,
                amount: gen.amount,
                perUnit: get().getGeneratorMoneyPerSecond(gen.id, 1),
                total: get().getGeneratorMoneyPerSecond(gen.id, gen.amount),
                factors: [
                  { label: "upgrades", mult: gen.multiplier },
                  { label: "policies & the map", mult: out.money },
                  {
                    label: "morale",
                    mult: m.satisfactionRevenue[gen.id] ?? 1,
                    modKey: `satisfactionRevenue.${gen.id}`,
                  },
                  { label: "leader", mult: m.teamLeaderEmpRoleRevenue[gen.id] ?? 1, modKey: `leader.${gen.id}` },
                  { label: "founder", mult: m.founderMoney[gen.id] ?? 1 },
                ],
              };
            });

          return { total: get().getMoneyPerSecond(), globals, perGenerator };
        },

        getGeneratorInnovationPerSecond: (id, units) => {
          const gen = get().generators.find((g) => g.id === id);
          if (!gen || units <= 0) return 0;
          const m = get()._buildModifiers();
          const out = get().getEmployeeOutputMults(id);
          return calcGeneratorPerSecond(gen, m, out, units).innovation;
        },
        getInnovationPerSecond: () =>
          get().generators.reduce(
            (sum, gen) =>
              sum + get().getGeneratorInnovationPerSecond(gen.id, gen.amount),
            0,
          ),

        getInnovationBreakdown: () => {
          const m = get()._buildModifiers();

          const globals = [
            {
              label: "Innovation curve",
              mult: m.innovationCurve,
              modKey: "innovationCurve",
            },
            {
              label: "Managers",
              mult: m.managerInnovation,
              modKey: "managerInnovation",
            },
            {
              label: "Board mandates",
              mult: m.mandateInnovation,
              modKey: "mandateInnovation",
            },
            {
              label: "Vape juice",
              mult: m.juiceInnovation,
              modKey: "juiceInnovation",
            },
            {
              label: "Intern morale",
              mult: m.internIpsMult,
              modKey: "internIpsMult",
            },
            {
              label: "Skill tree",
              mult: m.prestigeInnovation * m.prestigeEmployeeOutput,
              modKey: "skillTreeInnovation",
            },
          ];

          const perGenerator = get()
            .generators.filter((g) => g.amount > 0)
            .map((gen) => {
              const out = get().getEmployeeOutputMults(gen.id);
              return {
                id: gen.id,
                name: gen.name,
                amount: gen.amount,
                perUnit: get().getGeneratorInnovationPerSecond(gen.id, 1),
                total: get().getGeneratorInnovationPerSecond(
                  gen.id,
                  gen.amount,
                ),
                factors: [
                  { label: "upgrades", mult: gen.innovationMultiplier },
                  { label: "policies & the map", mult: out.innovation },
                  { label: "leader", mult: m.teamLeaderEmpRoleIps[gen.id] ?? 1, modKey: `leader.${gen.id}` },
                  {
                    label: "founder",
                    mult: m.founderInnovation[gen.id] ?? 1,
                  },
                ],
              };
            });

          return {
            total: get().getInnovationPerSecond(),
            globals,
            perGenerator,
          };
        },

        getValuationBreakdown: () => {
          const mps = get().getMoneyPerSecond();
          const m = get()._buildModifiers();

          // Mirror of the accrual in tickGenerators: a sub-linear function of $/sec,
          // scaled by board (sales), intern satisfaction, founder, and skill-tree modifiers.
          const base = Math.pow(Math.max(1, mps), 0.38) * 1e-4;
          const factors = [
            {
              label: "Sales managers",
              mult: m.managerSalesValuation,
              modKey: "managerSalesValuation",
            },
            {
              label: "Founder",
              mult: m.founderValuation,
              modKey: "founderValuation",
            },
            {
              label: "Skill tree",
              mult: m.prestigeValuation,
              modKey: "prestigeValuation",
            },
            {
              label: "Vape shop",
              mult: m.juiceValuation,
              modKey: "juiceValuation",
            },
            // The wonders on the map. @see wonderBonus
            { label: "Wonders", mult: wonderBonus("valuation") },
          ];
          const total = factors.reduce((acc, f) => acc * f.mult, base);
          return { total, base, mps, factors };
        },
        getValuationPerSecond: () => get().getValuationBreakdown().total,

        setPurchaseMode: (purchaseMode) => set({ purchaseMode }),

        reset: () => {
          localStorage.removeItem(EMPLOYEE_MGMT_STORAGE_KEY);
          useGeneratorStore.persist.clearStorage();
          useTeamLeadersEmployeesStore.getState().reset();
          set({
            generators: reconcileGeneratorsFromSavedArray([]),
            globalLastTick: Date.now(),
            employeeManagement: defaultEmployeeManagement(),
            satisfactionScores: defaultSatisfactionScores(),
          });
        },
      };
    },
    {
      name: GENERATOR_PERSIST_KEY,
      storage: createJSONStorage(() => generatorStateStorage),
      partialize: (state) => ({
        generators: state.generators,
        employeeManagement: state.employeeManagement,
        satisfactionScores: state.satisfactionScores,
        moraleScale: MORALE_SCALE,
      }),
      merge: (persisted, current) => {
        const p = persisted as Partial<{
          generators: OwnedGenerator[];
          employeeManagement: EmployeeManagementData;
          satisfactionScores: SatisfactionScores;
          moraleScale: number;
        }> | null;
        if (!p) return current;
        // A save from before Morale: its scores on ±100, brought to ±40.
        const scale = p.moraleScale === MORALE_SCALE ? 1 : TO_MORALE;
        const mergedScores = p.satisfactionScores
          ? {
              intern: clampPersistedScore(p.satisfactionScores.intern, scale),
              vibe_coder: clampPersistedScore(p.satisfactionScores.vibe_coder, scale),
              "10x_dev": clampPersistedScore(p.satisfactionScores["10x_dev"], scale),
            }
          : current.satisfactionScores;
        return {
          ...current,
          generators: p.generators
            ? reconcileGeneratorsFromSavedArray(p.generators)
            : current.generators,
          employeeManagement: p.employeeManagement
            ? normalizeEmployeeManagement(p.employeeManagement)
            : current.employeeManagement,
          satisfactionScores: mergedScores,
        };
      },
    },
  ),
);

// Re-sync the buildable roster whenever the chosen founder changes (e.g. the
// Agentic Delusionist restricting it to vibe coders, or a reset clearing it).
// One-directional dependency (generators → founder) avoids an import cycle.
useFounderStore.subscribe(() => syncUnlockedGenerators());
