/**
 * THE LEADERS ON THE PAYROLL: one a kind, each placed in a building of their
 * kind's or not yet; candidates to hire from, rerolled for innovation; and
 * what those let go leave behind. Ranks come from their team's work and a
 * perk is picked at each. @see game/leaders, LeadersPanel
 */
import { create } from "zustand";
import { persist } from "zustand/middleware";

import {
  MAX_LEADER_RANK,
  PERSONALITIES,
  XP_AT,
  perkOffer,
  rankAt,
  type Leader,
  type LeaderPerkId,
  type PersonalityId,
} from "../game/leaders";
import { getNamePool } from "../game/team-leaders.catalog";
import { pickAvatarIds } from "../game/team-leader-avatars";
import type { GeneratorId } from "./generators.store";
import { useInnovationStore } from "./innovation.store";

/** Kept under its old name, for those who read it. */
export type TeamLeaderEmployee = Leader;

let _idSeq = 0;
const genId = () => `tl_${Date.now()}_${_idSeq++}`;

export type LegacyBonus = {
  role: GeneratorId;
  /** Additive fractional revenue bonus, e.g. 0.08 = +8% */
  revenueMult: number;
  /** Additive fractional IPS bonus */
  ipsMult: number;
};

/** Innovation for the first reroll of a kind's candidates; doubling each time after. */
export const REROLL_BASE_COST = 50;

const PERSONALITY_IDS = Object.keys(PERSONALITIES) as PersonalityId[];

type TeamLeaderState = {
  employees: Leader[];
  legacies: LegacyBonus[];
  /** Candidates for each kind with no leader, shown before one is hired. */
  candidatePool: Partial<Record<GeneratorId, Leader[]>>;
  /** Rerolls of each kind's candidates since its last hire: the cost doubles. */
  rerollCounts: Partial<Record<GeneratorId, number>>;
  /** The kind whose leader is being placed on the map, if one is. Not saved. */
  placing: GeneratorId | null;

  generateCandidates: (role: GeneratorId) => void;
  hireCandidateFromPool: (role: GeneratorId, candidateId: string) => void;
  rerollCandidates: (role: GeneratorId) => void;
  getRerollCost: (role: GeneratorId) => number;
  /** Let a leader go: what they built up stays behind as a small lasting bonus. */
  fireEmployee: (id: string) => boolean;
  /** Take one of the three perks offered at a rank. */
  pickPerk: (id: string, perk: LeaderPerkId) => void;
  /** Put a leader in a building (a structure id), or take them out of it. */
  placeLeader: (id: string, at: number | null) => void;
  setPlacing: (role: GeneratorId | null) => void;
  /** XP from their teams' work: `rate` says each leader's a second. */
  tickTeamLeaders: (seconds: number, rate: (l: Leader) => number) => void;

  reset: () => void;
};

const pickRandom = <T,>(arr: readonly T[]): T => arr[Math.floor(Math.random() * arr.length)];

function makeCandidates(role: GeneratorId): Leader[] {
  const namePool = getNamePool(role);
  const names: string[] = [];
  while (names.length < 3) {
    const n = pickRandom(namePool);
    if (!names.includes(n) || names.length >= namePool.length) names.push(n);
  }
  const personalities = [...PERSONALITY_IDS].sort(() => Math.random() - 0.5).slice(0, 3);
  const avatarIds = pickAvatarIds(role, 3);
  return names.map((name, i) => ({
    id: genId(), role, name, avatarId: avatarIds[i], personality: personalities[i], rank: 0, xp: 0, perks: [], placedAt: null,
  }));
}

/**
 * A LEADER FROM AN OLD SAVE, the stat-and-skills kind: the same person and
 * personality (the traits were these), at their rank with its XP, perks to
 * pick for every rank they hold, not yet placed. @see plans/innovation-overhaul.md §8
 */
function fromSaved(raw: Record<string, unknown>): Leader | null {
  if (typeof raw.id !== "string" || typeof raw.role !== "string" || typeof raw.name !== "string") return null;
  if (raw.personality && typeof raw.xp === "number") {
    const l = raw as unknown as Leader;
    return { ...l, perks: [...(l.perks ?? [])], placedAt: typeof l.placedAt === "number" ? l.placedAt : null };
  }
  const personality = PERSONALITY_IDS.includes(raw.traitId as PersonalityId) ? (raw.traitId as PersonalityId) : "overachiever";
  const rank = Math.max(0, Math.min(MAX_LEADER_RANK, Math.floor(Number(raw.rank) || 0)));
  return {
    id: raw.id, role: raw.role as GeneratorId, name: raw.name, avatarId: typeof raw.avatarId === "string" ? raw.avatarId : undefined,
    personality, rank, xp: XP_AT[rank], perks: [], placedAt: null,
  };
}

const defaultState = {
  employees: [] as Leader[],
  legacies: [] as LegacyBonus[],
  candidatePool: {} as Partial<Record<GeneratorId, Leader[]>>,
  rerollCounts: {} as Partial<Record<GeneratorId, number>>,
  placing: null as GeneratorId | null,
};

export const useTeamLeadersEmployeesStore = create<TeamLeaderState>()(
  persist(
    (set, get) => ({
      ...defaultState,

      generateCandidates: (role) => {
        const s = get();
        if (s.employees.some((e) => e.role === role) || s.candidatePool[role]?.length) return;
        set((st) => ({ candidatePool: { ...st.candidatePool, [role]: makeCandidates(role) } }));
      },

      hireCandidateFromPool: (role, candidateId) => {
        set((s) => {
          const c = s.candidatePool[role]?.find((x) => x.id === candidateId);
          // One a kind: hired only where there is none.
          if (!c || s.employees.some((e) => e.role === role)) return s;
          return {
            employees: [...s.employees, c],
            candidatePool: { ...s.candidatePool, [role]: undefined },
            rerollCounts: { ...s.rerollCounts, [role]: 0 },
          };
        });
      },

      getRerollCost: (role) => Math.round(REROLL_BASE_COST * Math.pow(2, get().rerollCounts[role] ?? 0)),

      rerollCandidates: (role) => {
        const cost = get().getRerollCost(role);
        const inn = useInnovationStore.getState();
        if (inn.innovation.lt(cost)) return;
        inn.spendInnovation(cost);
        set((s) => ({
          candidatePool: { ...s.candidatePool, [role]: makeCandidates(role) },
          rerollCounts: { ...s.rerollCounts, [role]: (s.rerollCounts[role] ?? 0) + 1 },
        }));
      },

      fireEmployee: (id) => {
        const emp = get().employees.find((e) => e.id === id);
        if (!emp) return false;
        set((s) => {
          const was = s.legacies.find((l) => l.role === emp.role);
          return {
            employees: s.employees.filter((e) => e.id !== id),
            legacies: [
              ...s.legacies.filter((l) => l.role !== emp.role),
              { role: emp.role, revenueMult: (was?.revenueMult ?? 0) + emp.rank * 0.02, ipsMult: (was?.ipsMult ?? 0) + emp.rank * 0.01 },
            ],
            candidatePool: { ...s.candidatePool, [emp.role]: makeCandidates(emp.role) },
            rerollCounts: { ...s.rerollCounts, [emp.role]: 0 },
            placing: s.placing === emp.role ? null : s.placing,
          };
        });
        return true;
      },

      pickPerk: (id, perk) => {
        set((s) => ({
          employees: s.employees.map((e) => (e.id === id && perkOffer(e).includes(perk) ? { ...e, perks: [...e.perks, perk] } : e)),
        }));
      },

      placeLeader: (id, at) => {
        set((s) => ({ employees: s.employees.map((e) => (e.id === id ? { ...e, placedAt: at } : e)), placing: null }));
      },

      setPlacing: (placing) => set({ placing }),

      tickTeamLeaders: (seconds, rate) => {
        const employees = get().employees;
        if (!employees.length) return;
        let changed = false;
        const next = employees.map((e) => {
          const r = rate(e);
          if (r <= 0 || e.xp >= XP_AT[MAX_LEADER_RANK]) return e;
          changed = true;
          const xp = Math.min(XP_AT[MAX_LEADER_RANK], e.xp + r * seconds);
          return { ...e, xp, rank: rankAt(xp) };
        });
        if (changed) set({ employees: next });
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
      // OLD SAVES' LEADERS, converted; one a kind, the highest rank kept; old candidates drawn again.
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as { employees?: unknown[]; legacies?: LegacyBonus[]; candidatePool?: Record<string, unknown[]>; rerollCounts?: TeamLeaderState["rerollCounts"] };
        const byRole = new Map<GeneratorId, Leader>();
        for (const raw of p.employees ?? []) {
          const l = raw && typeof raw === "object" ? fromSaved(raw as Record<string, unknown>) : null;
          if (l && (!byRole.has(l.role) || byRole.get(l.role)!.rank < l.rank)) byRole.set(l.role, l);
        }
        const candidatePool: TeamLeaderState["candidatePool"] = {};
        for (const [role, list] of Object.entries(p.candidatePool ?? {})) {
          const ok = (list ?? []).map((c) => (c && typeof c === "object" ? fromSaved(c as Record<string, unknown>) : null));
          if (ok.length && ok.every((c) => c && (c as Leader).personality && "xp" in (c as object))) candidatePool[role as GeneratorId] = ok as Leader[];
        }
        return {
          ...current,
          employees: [...byRole.values()],
          legacies: p.legacies ?? [],
          candidatePool,
          rerollCounts: p.rerollCounts ?? {},
        };
      },
    },
  ),
);
