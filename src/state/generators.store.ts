import { create } from "zustand";
import {
  createJSONStorage,
  persist,
  type StateStorage,
} from "zustand/middleware";
import { setEmployeeSatisfactionReaders } from "../game/employee-satisfaction-read";
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
  type SatisfactionScores,
} from "../game/satisfaction";
import {
  computeTeamLeaderEmpSatOffsets,
  skillMult,
} from "../game/team-leaders.catalog";
import {
  getGeneratorCost,
  getUnlockedGeneratorIds,
} from "../utils/generator-utils";
import { useAiSingularityStore } from "./ai-singularity.store";
import { useDirectivesStore } from "./directives.store";
import { useFounderStore } from "./founder.store";
import { getManagementTierTotal, useInnovationStore } from "./innovation.store";
import { useMoneyStore } from "./money.store";
import { usePrestigeStore } from "./prestige.store";
import {
  useTeamLeadersEmployeesStore,
  type TeamLeaderEmployee,
} from "./team-leaders.store";
import { syncAvailableUpgrades } from "./upgrades.store";
import { useValuationStore } from "./valuation.store";

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

export type EmployeePerks = {
  moneyLevel: number;
  innovationLevel: number;
  costLevel: number;
  autoBuyLevel: number;
};

export type EmployeePerkBranch = "money" | "innovation" | "cost" | "auto";

export type GeneratorId = "intern" | "vibe_coder" | "10x_dev";

/** Per-hire ratio must stay above 1 or costs tend to 0 at high counts; upgrades clamp to this floor. */
export const MIN_GENERATOR_COST_EXPONENT = 1.02;

const MAX_MONEY_INNO_LEVEL = 25;
const MAX_COST_LEVEL = 15;
const MAX_AUTO_LEVEL = 5;

const MONEY_MULT_PER_LEVEL = 0.2;
const INNO_MULT_PER_LEVEL = 0.2;
/** Per −Cost level; stronger than legacy 0.985 so tier spend meaningfully cuts hire price. */
const COST_DISCOUNT_BASE = 0.968;
const AUTO_BUY_PER_LEVEL = 0.175;

type EmployeeManagementData = {
  spentManagementPoints: number;
  perks: Record<GeneratorId, EmployeePerks>;
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

  getEmployeePerks: (id: GeneratorId) => EmployeePerks;
  getEmployeeOutputMults: (id: GeneratorId) => {
    money: number;
    innovation: number;
  };
  getEmployeeCostMult: (id: GeneratorId) => number;
  getAutoBuyRate: (id: GeneratorId) => number;
  getAvailableManagementPoints: () => number;
  getEmployeePerkNextCost: (
    id: GeneratorId,
    branch: EmployeePerkBranch,
  ) => number;
  canPurchaseEmployeePerk: (
    id: GeneratorId,
    branch: EmployeePerkBranch,
  ) => boolean;
  purchaseEmployeePerk: (id: GeneratorId, branch: EmployeePerkBranch) => void;
  /** Returns management points spent on this role’s perks (sum of historical purchase costs). */
  getManagementPointsSpentOnRow: (id: GeneratorId) => number;
  refundEmployeeManagementRow: (id: GeneratorId) => void;

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

function clampPersistedScore(n: unknown): number {
  if (typeof n !== "number" || Number.isNaN(n)) return 0;
  return Math.min(SATISFACTION_MAX, Math.max(SATISFACTION_MIN, n));
}

const defaultEmployeePerks = (): EmployeePerks => ({
  moneyLevel: 0,
  innovationLevel: 0,
  costLevel: 0,
  autoBuyLevel: 0,
});

const mergeEmployeePerks = (
  partial?: Partial<Record<GeneratorId, EmployeePerks>>,
): Record<GeneratorId, EmployeePerks> => ({
  intern: { ...defaultEmployeePerks(), ...partial?.intern },
  vibe_coder: { ...defaultEmployeePerks(), ...partial?.vibe_coder },
  "10x_dev": { ...defaultEmployeePerks(), ...partial?.["10x_dev"] },
});

const defaultEmployeeManagement = (): EmployeeManagementData => ({
  spentManagementPoints: 0,
  perks: mergeEmployeePerks(),
  autoBuyAcc: {},
});

const parseEmployeeManagementJson = (
  raw: string | null,
): EmployeeManagementData => {
  if (!raw) return defaultEmployeeManagement();
  try {
    const parsed = JSON.parse(raw) as {
      spentManagementPoints?: number;
      perks?: Partial<Record<GeneratorId, Partial<EmployeePerks>>>;
      autoBuyAcc?: Partial<Record<GeneratorId, number>>;
    };
    const perksIn = parsed.perks ?? {};
    const merged: Partial<Record<GeneratorId, EmployeePerks>> = {};
    for (const id of ["intern", "vibe_coder", "10x_dev"] as GeneratorId[]) {
      merged[id] = { ...defaultEmployeePerks(), ...perksIn[id] };
    }
    return {
      spentManagementPoints: parsed.spentManagementPoints ?? 0,
      perks: mergeEmployeePerks(merged),
      autoBuyAcc: parsed.autoBuyAcc ?? {},
    };
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

function employeePerkPurchaseCost(
  branch: EmployeePerkBranch,
  currentLevel: number,
): number {
  if (branch === "money" || branch === "innovation") {
    if (currentLevel >= MAX_MONEY_INNO_LEVEL) return 0;
    return 2 + Math.floor(currentLevel / 6);
  }
  if (branch === "cost") {
    if (currentLevel >= MAX_COST_LEVEL) return 0;
    return 3 + Math.floor(currentLevel / 4);
  }
  if (branch === "auto") {
    if (currentLevel >= MAX_AUTO_LEVEL) return 0;
    return 6 + currentLevel * 3;
  }
  return 0;
}

function totalManagementPointsSpentOnPerks(p: EmployeePerks): number {
  let sum = 0;
  for (let i = 0; i < p.moneyLevel; i++) {
    sum += employeePerkPurchaseCost("money", i);
  }
  for (let i = 0; i < p.innovationLevel; i++) {
    sum += employeePerkPurchaseCost("innovation", i);
  }
  for (let i = 0; i < p.costLevel; i++) {
    sum += employeePerkPurchaseCost("cost", i);
  }
  for (let i = 0; i < p.autoBuyLevel; i++) {
    sum += employeePerkPurchaseCost("auto", i);
  }
  return sum;
}

// ─── tickGenerators helpers ───────────────────────────────────────────────────

function buildAmountsMap(generators: OwnedGenerator[]): Record<GeneratorId, number> {
  const amounts: Record<GeneratorId, number> = { intern: 0, vibe_coder: 0, "10x_dev": 0 };
  for (const g of generators) amounts[g.id] = g.amount;
  return amounts;
}

function tickSatisfaction(
  scores: SatisfactionScores,
  perks: Record<GeneratorId, EmployeePerks>,
  amounts: Record<GeneratorId, number>,
  seconds: number,
  prestige: { satisfactionGainMult: number },
  employees: TeamLeaderEmployee[],
): SatisfactionScores {
  const satOffsets = computeTeamLeaderEmpSatOffsets(employees);
  let driftMult = 1;
  for (const emp of employees) {
    const srLv = emp.skills.sat_recovery ?? 0;
    if (srLv > 0) driftMult *= skillMult("sat_recovery", srLv);
  }
  // Culture Capital mandate: multiplies satisfaction recovery speed.
  const mandateSatGain = useValuationStore.getState().getEconomyMultipliers().satisfactionGain;
  return stepSatisfactionScores(
    scores,
    perks,
    amounts,
    seconds * prestige.satisfactionGainMult * driftMult * mandateSatGain,
    satOffsets,
  );
}

function accrueGeneratorIncome(
  gen: OwnedGenerator,
  m: GameModifiers,
  out: { money: number; innovation: number },
  ticks: number,
): void {
  const { money, innovation } = calcGeneratorIncome(gen, m, out, ticks);
  useMoneyStore.getState().increaseMoney(money);
  useInnovationStore.getState().increaseInnovation(innovation);
  const dir = useDirectivesStore.getState();
  if (dir.everUnlocked) {
    if (money > 0) dir.onMoneyTick(money);
    if (innovation > 0) dir.onInnovationTick(innovation);
  }
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
          let autoBought = 0;
          while (frac >= 1 && iter < maxIter) {
            const cost = getGeneratorCost(gen.id, 1);
            const money = useMoneyStore.getState().money;
            if (money.lt(cost)) break;
            useMoneyStore.getState().spendMoney(cost.toNumber());
            get().increaseGenerator(gen.id, 1);
            frac -= 1;
            iter += 1;
            autoBought += 1;
          }
          if (autoBought > 0) {
            useDirectivesStore.getState().onHired(gen.id as GeneratorId, autoBought);
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

        getEmployeePerks: (id) => get().employeeManagement.perks[id],

        getEmployeeOutputMults: (id) => {
          const p = get().employeeManagement.perks[id];
          return {
            money: 1 + p.moneyLevel * MONEY_MULT_PER_LEVEL,
            innovation: 1 + p.innovationLevel * INNO_MULT_PER_LEVEL,
          };
        },

        getEmployeeCostMult: (id) => {
          const lv = get().employeeManagement.perks[id].costLevel;
          return Math.pow(COST_DISCOUNT_BASE, lv);
        },

        getEffectiveSatisfaction: (id) => {
          const m = usePrestigeStore.getState().modifiers;
          return applyEffectiveSatisfaction(get().satisfactionScores[id], m);
        },

        getAutoBuyRate: (id) => {
          const lv = get().employeeManagement.perks[id].autoBuyLevel;
          if (lv <= 0) return 0;
          // Founder "Operator" + skill-tree automation modifiers.
          return (
            AUTO_BUY_PER_LEVEL *
            lv *
            useFounderStore.getState().autoBuyMult *
            usePrestigeStore.getState().modifiers.autoBuyMult
          );
        },

        getAvailableManagementPoints: () => {
          if (
            !useInnovationStore.getState().unlocks.employeeManagement?.unlocked
          ) {
            return 0;
          }
          const total = getManagementTierTotal();
          return Math.max(
            0,
            total - get().employeeManagement.spentManagementPoints,
          );
        },

        getEmployeePerkNextCost: (id, branch) => {
          const p = get().employeeManagement.perks[id];
          const level =
            branch === "money"
              ? p.moneyLevel
              : branch === "innovation"
                ? p.innovationLevel
                : branch === "cost"
                  ? p.costLevel
                  : p.autoBuyLevel;
          return employeePerkPurchaseCost(branch, level);
        },

        canPurchaseEmployeePerk: (id, branch) => {
          const cost = get().getEmployeePerkNextCost(id, branch);
          if (cost <= 0) return false;
          return get().getAvailableManagementPoints() >= cost;
        },

        purchaseEmployeePerk: (id, branch) => {
          if (
            !useInnovationStore.getState().unlocks.employeeManagement?.unlocked
          ) {
            return;
          }
          if (!get().canPurchaseEmployeePerk(id, branch)) return;

          const cost = get().getEmployeePerkNextCost(id, branch);
          set((state) => {
            const perks = { ...state.employeeManagement.perks };
            const cur = { ...perks[id] };
            if (branch === "money") cur.moneyLevel += 1;
            else if (branch === "innovation") cur.innovationLevel += 1;
            else if (branch === "cost") cur.costLevel += 1;
            else cur.autoBuyLevel += 1;
            perks[id] = cur;
            return {
              employeeManagement: {
                ...state.employeeManagement,
                spentManagementPoints:
                  state.employeeManagement.spentManagementPoints + cost,
                perks,
              },
            };
          });
        },

        getManagementPointsSpentOnRow: (id) =>
          totalManagementPointsSpentOnPerks(get().employeeManagement.perks[id]),

        refundEmployeeManagementRow: (id) => {
          if (
            !useInnovationStore.getState().unlocks.employeeManagement?.unlocked
          ) {
            return;
          }
          const refund = totalManagementPointsSpentOnPerks(
            get().employeeManagement.perks[id],
          );
          if (refund <= 0) return;

          set((state) => {
            const perks = { ...state.employeeManagement.perks };
            perks[id] = defaultEmployeePerks();
            const autoBuyAcc = { ...state.employeeManagement.autoBuyAcc };
            delete autoBuyAcc[id];
            return {
              employeeManagement: {
                ...state.employeeManagement,
                spentManagementPoints: Math.max(
                  0,
                  state.employeeManagement.spentManagementPoints - refund,
                ),
                perks,
                autoBuyAcc,
              },
            };
          });
        },

        addGenerator: (gen) =>
          set((state) => {
            const exists = state.generators.find((g) => g.id === gen.id);
            if (exists) return {};
            return { generators: [...state.generators, gen] };
          }),

        increaseGenerator: (id, count = 1) =>
          set((state) => ({
            generators: state.generators.map((gen) =>
              gen.id === id ? { ...gen, amount: gen.amount + count } : gen,
            ),
          })),

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
          let satisfactionScores = get().satisfactionScores;
          if (emUnlocked) {
            const tlStore = useTeamLeadersEmployeesStore.getState();
            for (const g of get().generators) {
              if (g.amount > 0) tlStore.generateCandidates(g.id);
            }
            tlStore.tickTeamLeaders(seconds, get().satisfactionScores, amounts);
            satisfactionScores = tickSatisfaction(
              get().satisfactionScores,
              get().employeeManagement.perks,
              amounts,
              seconds,
              prestige,
              tlStore.employees,
            );
          }

          // ── 2. Build full modifier snapshot ──────────────────────────────────
          // Use the freshly computed satisfaction scores so the snapshot is
          // consistent even though we haven't committed them to state yet.
          const totalEmployees = get().generators.reduce((n, g) => n + g.amount, 0);
          const m = computeModifiers({ totalEmployees, emUnlocked, rawScores: satisfactionScores });

          // ── 3. AI singularity ─────────────────────────────────────────────────
          if (emUnlocked) {
            useAiSingularityStore
              .getState()
              .tick(seconds, m.effectiveScores["vibe_coder"] ?? 0, emUnlocked);
          }

          // ── 4. Income accrual (side effects only) ────────────────────────────
          // Track which gens fire this tick; stamp lastTick after auto-buy so
          // increaseGenerator's set() calls are not overwritten by ours.
          const firingGenIds = new Set<string>();
          for (const gen of get().generators) {
            if (gen.amount === 0) continue;
            const ticks = Math.floor(globalTickInterval / gen.interval);
            if (ticks === 0) continue;
            firingGenIds.add(gen.id);
            accrueGeneratorIncome(gen, m, get().getEmployeeOutputMults(gen.id), ticks);
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
          const cost = getGeneratorCost(id, amount);
          const moneyState = useMoneyStore.getState();

          if (moneyState.money.gte(cost)) {
            moneyState.spendMoney(cost.toNumber());
            get().increaseGenerator(id, amount);
            syncUnlockedGenerators();
            syncAvailableUpgrades();
            useDirectivesStore.getState().onHired(id as GeneratorId, amount);
          }
        },

        getGeneratorMoneyPerSecond: (id, units) => {
          const gen = get().generators.find((g) => g.id === id);
          if (!gen || units <= 0) return 0;
          const m = get()._buildModifiers();
          const out = get().getEmployeeOutputMults(id);
          return calcGeneratorPerSecond(gen, m, out, units).money;
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
                  { label: "perks", mult: out.money },
                  {
                    label: "satisfaction",
                    mult: m.satisfactionRevenue[gen.id] ?? 1,
                    modKey: `satisfactionRevenue.${gen.id}`,
                  },
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
              label: "Intern satisfaction",
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
                  { label: "perks", mult: out.innovation },
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
          const base = Math.pow(Math.max(1, mps), 0.38) * 4e-5;
          const factors = [
            {
              label: "Sales managers",
              mult: m.managerSalesValuation,
              modKey: "managerSalesValuation",
            },
            {
              label: "Intern satisfaction",
              mult: m.internValuationMult,
              modKey: "internValuationMult",
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
            {
              label: "Team leaders",
              mult: m.teamLeaderEmpValuationMult,
              modKey: "teamLeaderEmpValuationMult",
            },
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
      }),
      merge: (persisted, current) => {
        const p = persisted as Partial<{
          generators: OwnedGenerator[];
          employeeManagement: EmployeeManagementData;
          satisfactionScores: SatisfactionScores;
        }> | null;
        if (!p) return current;
        const mergedScores = p.satisfactionScores
          ? {
              intern: clampPersistedScore(p.satisfactionScores.intern),
              vibe_coder: clampPersistedScore(p.satisfactionScores.vibe_coder),
              "10x_dev": clampPersistedScore(p.satisfactionScores["10x_dev"]),
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

setEmployeeSatisfactionReaders({
  internScore: () =>
    useGeneratorStore.getState().getEffectiveSatisfaction("intern"),
  employeeManagementUnlocked: () =>
    useInnovationStore.getState().unlocks.employeeManagement?.unlocked ?? false,
});

// Re-sync the buildable roster whenever the chosen founder changes (e.g. the
// Agentic Delusionist restricting it to vibe coders, or a reset clearing it).
// One-directional dependency (generators → founder) avoids an import cycle.
useFounderStore.subscribe(() => syncUnlockedGenerators());
