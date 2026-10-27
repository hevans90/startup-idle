/**
 * THE LEADERS ON THE PAYROLL: one a kind, each placed in a building of their
 * kind's or not yet, and what those let go leave behind. They are found on
 * LinkedOut; ranks come from their team's work and a perk is picked at each.
 * @see game/leaders, LeadersPanel, linkedout.store
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
import type { GeneratorId } from "./generators.store";
import { useInnovationStore } from "./innovation.store";

/** Kept under its old name, for those who read it. */
export type TeamLeaderEmployee = Leader;

export type LegacyBonus = {
  role: GeneratorId;
  /** Additive fractional revenue bonus, e.g. 0.08 = +8% */
  revenueMult: number;
  /** Additive fractional IPS bonus */
  ipsMult: number;
};

const PERSONALITY_IDS = Object.keys(PERSONALITIES) as PersonalityId[];

type TeamLeaderState = {
  employees: Leader[];
  legacies: LegacyBonus[];
  /** The kind whose leader is being placed on the map, if one is. Not saved. */
  placing: GeneratorId | null;

  /** Take a leader on for their kind; whoever led it before leaves, and is returned. */
  hire: (leader: Leader) => Leader | null;
  /** Let a leader go: what they built up stays behind as a small lasting bonus. One who sues costs a quarter of the innovation. */
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
  placing: null as GeneratorId | null,
};

export const useTeamLeadersEmployeesStore = create<TeamLeaderState>()(
  persist(
    (set, get) => ({
      ...defaultState,

      hire: (leader) => {
        const was = get().employees.find((e) => e.role === leader.role) ?? null;
        set((s) => ({
          employees: [...s.employees.filter((e) => e.role !== leader.role), { ...leader, placedAt: null }],
          placing: s.placing === leader.role ? null : s.placing,
        }));
        return was;
      },

      fireEmployee: (id) => {
        const emp = get().employees.find((e) => e.id === id);
        if (!emp) return false;
        // SUES IF LET GO: a quarter of the innovation. @see RED_FLAGS
        if (emp.flag === "litigious") {
          const inn = useInnovationStore.getState();
          inn.spendInnovation(inn.innovation.mul(0.25).toNumber());
        }
        set((s) => {
          const was = s.legacies.find((l) => l.role === emp.role);
          return {
            employees: s.employees.filter((e) => e.id !== id),
            legacies: [
              ...s.legacies.filter((l) => l.role !== emp.role),
              { role: emp.role, revenueMult: (was?.revenueMult ?? 0) + emp.rank * 0.02, ipsMult: (was?.ipsMult ?? 0) + emp.rank * 0.01 },
            ],
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
      }),
      // OLD SAVES' LEADERS, converted; one a kind, the highest rank kept.
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as { employees?: unknown[]; legacies?: LegacyBonus[] };
        const byRole = new Map<GeneratorId, Leader>();
        for (const raw of p.employees ?? []) {
          const l = raw && typeof raw === "object" ? fromSaved(raw as Record<string, unknown>) : null;
          if (l && (!byRole.has(l.role) || byRole.get(l.role)!.rank < l.rank)) byRole.set(l.role, l);
        }
        return { ...current, employees: [...byRole.values()], legacies: p.legacies ?? [] };
      },
    },
  ),
);
