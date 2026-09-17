import { create } from "zustand";
import { persist } from "zustand/middleware";
import {
  EMPLOYEE_TRAITS,
  getActivePairSynergies,
  getNamePool,
  skillMult,
  stepEmployeeStat,
  type TeamLeaderSkillId,
  type TeamLeaderTraitId,
} from "../game/team-leaders.catalog";
import { pickAvatarIds } from "../game/team-leader-avatars";
import type { GeneratorId } from "./generators.store";
import { useInnovationStore } from "./innovation.store";

let _idSeq = 0;
function genId(): string {
  return `tl_${Date.now()}_${_idSeq++}`;
}

export type TeamLeaderEmployee = {
  id: string;
  role: GeneratorId;
  name: string;
  traitId: TeamLeaderTraitId;
  outputStat: number;
  moraleStat: number;
  rank: number;
  unspentPoints: number;
  skills: Partial<Record<TeamLeaderSkillId, number>>;
  /** The 3 skills randomly drawn from this employee's trait pool at candidate creation. */
  skillPool: readonly TeamLeaderSkillId[];
  /** Filename from the role's avatar pool (e.g. "alex.jpg"). Undefined if pool is empty. */
  avatarId?: string;
};

export type LegacyBonus = {
  role: GeneratorId;
  /** Additive fractional revenue bonus, e.g. 0.08 = +8% */
  revenueMult: number;
  /** Additive fractional IPS bonus */
  ipsMult: number;
};

/** Base cost in innovation for first reroll per slot; doubles each subsequent reroll. */
export const REROLL_BASE_COST = 50;
/** Innovation cost to fire an employee per rank they've accumulated. */
export const FIRE_COST_PER_RANK = 100;

type TeamLeaderState = {
  employees: TeamLeaderEmployee[];
  legacies: LegacyBonus[];
  /** Candidate pools per role — shown in the hire dialog before committing. */
  candidatePool: Partial<Record<GeneratorId, TeamLeaderEmployee[]>>;
  /** How many times each role's pool has been rerolled since last hire (drives cost escalation). */
  rerollCounts: Partial<Record<GeneratorId, number>>;

  generateCandidates: (role: GeneratorId) => void;
  hireCandidateFromPool: (role: GeneratorId, candidateId: string) => void;
  rerollCandidates: (role: GeneratorId) => void;
  getRerollCost: (role: GeneratorId) => number;
  fireEmployee: (id: string) => boolean;
  spendRankPoint: (id: string, skillId: TeamLeaderSkillId) => void;

  tickTeamLeaders: (
    seconds: number,
    satScores: Record<GeneratorId, number>,
    amounts: Record<GeneratorId, number>,
  ) => void;

  reset: () => void;
};

const ALL_TRAIT_IDS = Object.keys(EMPLOYEE_TRAITS) as TeamLeaderTraitId[];

function pickRandom<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function pickSkillPool(traitId: TeamLeaderTraitId): TeamLeaderSkillId[] {
  const pool = [...EMPLOYEE_TRAITS[traitId].skills];
  // Shuffle and take 3 of the 4-skill pool so each candidate feels distinct
  pool.sort(() => Math.random() - 0.5);
  return pool.slice(0, 3) as TeamLeaderSkillId[];
}

function makeCandidates(role: GeneratorId): TeamLeaderEmployee[] {
  const namePool = getNamePool(role);
  // Pick 3 distinct names if possible
  const names: string[] = [];
  const usedNames = new Set<string>();
  while (names.length < 3) {
    const n = pickRandom(namePool);
    if (!usedNames.has(n) || usedNames.size >= namePool.length) {
      usedNames.add(n);
      names.push(n);
    }
  }
  // Pick 3 distinct traits
  const shuffled = [...ALL_TRAIT_IDS].sort(() => Math.random() - 0.5);
  const traits = shuffled.slice(0, 3) as TeamLeaderTraitId[];

  // Assign distinct avatars from the role pool (undefined if pool is empty)
  const avatarIds = pickAvatarIds(role, 3);

  return names.map((name, i) => ({
    id: genId(),
    role,
    name,
    traitId: traits[i],
    outputStat: 0,
    moraleStat: 0,
    rank: 0,
    unspentPoints: 0,
    skills: {},
    skillPool: pickSkillPool(traits[i]),
    avatarId: avatarIds[i],
  }));
}

const defaultState = {
  employees: [] as TeamLeaderEmployee[],
  legacies: [] as LegacyBonus[],
  candidatePool: {} as Partial<Record<GeneratorId, TeamLeaderEmployee[]>>,
  rerollCounts: {} as Partial<Record<GeneratorId, number>>,
};

export const useTeamLeadersEmployeesStore = create<TeamLeaderState>()(
  persist(
    (set, get) => ({
      ...defaultState,

      generateCandidates: (role) => {
        const state = get();
        // Skip if already have an active employee or a pending pool for this role
        if (state.employees.some((e) => e.role === role)) return;
        if (state.candidatePool[role]?.length) return;
        set((s) => ({
          candidatePool: { ...s.candidatePool, [role]: makeCandidates(role) },
        }));
      },

      hireCandidateFromPool: (role, candidateId) => {
        set((s) => {
          const candidate = s.candidatePool[role]?.find(
            (c) => c.id === candidateId,
          );
          if (!candidate) return s;
          return {
            employees: [...s.employees, candidate],
            candidatePool: { ...s.candidatePool, [role]: undefined },
            rerollCounts: { ...s.rerollCounts, [role]: 0 },
          };
        });
      },

      getRerollCost: (role) => {
        const count = get().rerollCounts[role] ?? 0;
        return Math.round(REROLL_BASE_COST * Math.pow(2, count));
      },

      rerollCandidates: (role) => {
        const cost = get().getRerollCost(role);
        const innovStore = useInnovationStore.getState();
        if (innovStore.innovation.lt(cost)) return;
        innovStore.spendInnovation(cost);
        set((s) => ({
          candidatePool: { ...s.candidatePool, [role]: makeCandidates(role) },
          rerollCounts: {
            ...s.rerollCounts,
            [role]: (s.rerollCounts[role] ?? 0) + 1,
          },
        }));
      },

      fireEmployee: (id) => {
        const emp = get().employees.find((e) => e.id === id);
        if (!emp) return false;

        // Firing costs innovation proportional to rank — discourages casual churn
        const fireCost = emp.rank * FIRE_COST_PER_RANK;
        if (fireCost > 0) {
          const innovStore = useInnovationStore.getState();
          if (innovStore.innovation.lt(fireCost)) return false;
          innovStore.spendInnovation(fireCost);
        }

        const legacyMult = skillMult("legacy_amplifier", emp.skills.legacy_amplifier ?? 0);
        const bonusRev = emp.rank * 0.02 * legacyMult;
        const bonusIps = emp.rank * 0.01 * legacyMult;
        set((s) => {
          const existing = s.legacies.find((l) => l.role === emp.role);
          return {
            employees: s.employees.filter((e) => e.id !== id),
            legacies: [
              ...s.legacies.filter((l) => l.role !== emp.role),
              {
                role: emp.role,
                revenueMult: (existing?.revenueMult ?? 0) + bonusRev,
                ipsMult: (existing?.ipsMult ?? 0) + bonusIps,
              },
            ],
            // Immediately generate a fresh candidate pool for this role
            candidatePool: {
              ...s.candidatePool,
              [emp.role]: makeCandidates(emp.role),
            },
            rerollCounts: { ...s.rerollCounts, [emp.role]: 0 },
          };
        });
        return true;
      },

      spendRankPoint: (id, skillId) => {
        set((s) => ({
          employees: s.employees.map((e) => {
            if (e.id !== id || e.unspentPoints <= 0) return e;
            const pool =
              e.skillPool ?? EMPLOYEE_TRAITS[e.traitId].skills.slice(0, 3);
            if (!pool.includes(skillId)) return e;
            const currentLevel = e.skills[skillId] ?? 0;
            if (currentLevel >= 3) return e;
            return {
              ...e,
              unspentPoints: e.unspentPoints - 1,
              skills: { ...e.skills, [skillId]: currentLevel + 1 },
            };
          }),
        }));
      },

      tickTeamLeaders: (seconds, satScores, amounts) => {
        const employees = get().employees;
        if (employees.length === 0) return;

        // Compute pair synergy output growth bonuses per-employee
        const pairSyns = getActivePairSynergies(employees);
        const growthBonus: Record<string, number> = {};
        for (const syn of pairSyns) {
          if (!syn.outputGrowthBonus) continue;
          for (const emp of employees) {
            if (emp.traitId === syn.traitA || emp.traitId === syn.traitB) {
              growthBonus[emp.id] =
                (growthBonus[emp.id] ?? 0) + syn.outputGrowthBonus;
            }
          }
        }

        set((s) => ({
          employees: s.employees.map((emp) => {
            const amount = amounts[emp.role] ?? 0;
            const satScore = satScores[emp.role] ?? 0;
            const pairBonus = growthBonus[emp.id] ?? 0;
            return {
              ...emp,
              ...stepEmployeeStat(emp, satScore, amount, pairBonus, seconds),
            };
          }),
        }));
      },

      reset: () => set(defaultState),
    }),
    {
      name: "team-leaders-store-v1",
      partialize: (s) => ({
        employees: s.employees,
        legacies: s.legacies,
        candidatePool: s.candidatePool,
        rerollCounts: s.rerollCounts,
      }),
      onRehydrateStorage: () => (state) => {
        if (!state) return;
        // Backfill skillPool for employees saved before this field existed.
        // Invested skills are placed first so prior spend history is preserved.
        state.employees = state.employees.map((emp) => {
          if (emp.skillPool?.length) return emp;
          const invested = (Object.keys(emp.skills) as TeamLeaderSkillId[]).filter(
            (id) => (emp.skills[id] ?? 0) > 0,
          );
          const remaining = EMPLOYEE_TRAITS[emp.traitId].skills.filter(
            (id) => !invested.includes(id),
          );
          return {
            ...emp,
            skillPool: [...invested, ...remaining].slice(0, 3) as readonly TeamLeaderSkillId[],
          };
        });
      },
    },
  ),
);
