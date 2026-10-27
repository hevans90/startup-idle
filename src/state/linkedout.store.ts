/**
 * LINKEDOUT, as it stands: the posts open and the applicants who answered
 * them, how many posts and departures there have been this run, the morale it
 * remembers for the company's reputation — and the connections, every leader
 * of every company before, who outlast a sale. @see game/linkedout, LinkedOut
 */
import { create } from "zustand";
import { persist } from "zustand/middleware";

import { XP_AT, type Leader } from "../game/leaders";
import {
  ARRIVES_EVERY, APPLICANTS_AT, CHECK_COST, POST_OPEN, REHIRE_COST, REPUTATION_MEMORY,
  hireCost, makeApplicant, postCost, reputation, type Applicant,
} from "../game/linkedout";
import type { GeneratorId } from "./generators.store";
import { useInnovationStore } from "./innovation.store";
import { useTeamLeadersEmployeesStore } from "./team-leaders.store";

export type Post = { id: string; role: GeneratorId; closesAt: number; nextAt: number; left: number };

/** A leader from a company before: who they were, their red flag known. */
export type Connection = Pick<Leader, "id" | "role" | "name" | "avatarId" | "personality" | "flag"> & { rankWas: number };

type LinkedOutState = {
  posts: Post[];
  applicants: Applicant[];
  postsThisRun: number;
  letGoThisRun: number;
  /** The company's morale as remembered, over about ten minutes. @see REPUTATION_MEMORY */
  moraleRemembered: number;
  connections: Connection[];
  /** Whether the window is open. Not saved. */
  open: boolean;

  stars: () => number;
  setOpen: (open: boolean) => void;
  /** Post a job for a kind, for innovation. False if it cannot be afforded, or one is open for them. */
  post: (role: GeneratorId) => boolean;
  /** Applicants arriving and leaving, and the morale remembered: `avgMorale` the company's now. */
  tick: (now: number, seconds: number, avgMorale: number) => void;
  /** Pay for a background check: the flag, or that there is none, known. */
  check: (id: string) => boolean;
  /** Take an applicant on as their kind's leader, for innovation; whoever led it goes. */
  hire: (id: string) => boolean;
  /** Turn an applicant down. */
  pass: (id: string) => void;
  /** Let a leader go, and have it remembered. */
  letGo: (leaderId: string) => boolean;
  /** Bring a connection back for this company, at rank 1. */
  rehire: (id: string) => boolean;
  /** A sale: every leader becomes a connection; the posts and the counts go; the reputation drifts home. */
  newCompany: () => void;
  reset: () => void;
};

const fresh = { posts: [] as Post[], applicants: [] as Applicant[], postsThisRun: 0, letGoThisRun: 0 };

/** Spend innovation if there is enough. */
const pay = (n: number): boolean => {
  const inn = useInnovationStore.getState();
  if (inn.innovation.lt(n)) return false;
  inn.spendInnovation(n);
  return true;
};

const between = ([lo, hi]: readonly [number, number]) => (lo + Math.random() * (hi - lo)) * 1000;

/** A leader as a connection: who they were. */
const asConnection = (l: Leader): Connection => ({ id: l.id, role: l.role, name: l.name, avatarId: l.avatarId, personality: l.personality, flag: l.flag ?? null, rankWas: l.rank });

export const useLinkedOutStore = create<LinkedOutState>()(
  persist(
    (set, get) => ({
      ...fresh,
      moraleRemembered: 0,
      connections: [],
      open: false,

      stars: () => reputation(get().moraleRemembered, get().letGoThisRun),

      setOpen: (open) => set({ open }),

      post: (role) => {
        const s = get();
        if (s.posts.some((p) => p.role === role)) return false;
        if (!pay(postCost(s.postsThisRun))) return false;
        const now = Date.now();
        set({
          posts: [...s.posts, { id: `post_${now}`, role, closesAt: now + POST_OPEN * 1000, nextAt: now + between(ARRIVES_EVERY) / 3, left: APPLICANTS_AT[s.stars()] }],
          postsThisRun: s.postsThisRun + 1,
        });
        return true;
      },

      tick: (now, seconds, avgMorale) => {
        const s = get();
        // REMEMBERED MORALE: drifting toward now's over ten minutes.
        const k = Math.min(1, seconds / REPUTATION_MEMORY);
        const moraleRemembered = s.moraleRemembered + (avgMorale - s.moraleRemembered) * k;
        let applicants = s.applicants.filter((a) => a.leavesAt > now);
        const posts: Post[] = [];
        for (const p of s.posts) {
          let next = { ...p };
          // Everyone due, however long it has been. @see makeApplicant
          while (next.left > 0 && next.nextAt <= Math.min(now, next.closesAt)) {
            const a = makeApplicant(p.role, reputation(moraleRemembered, s.letGoThisRun), next.nextAt);
            if (a.leavesAt > now) applicants = [...applicants, a];
            next = { ...next, left: next.left - 1, nextAt: next.nextAt + between(ARRIVES_EVERY) };
          }
          if (next.left > 0 && now < next.closesAt) posts.push(next);
        }
        const changed = applicants.length !== s.applicants.length || posts.length !== s.posts.length || posts.some((p, i) => p.left !== s.posts[i]?.left);
        set(changed ? { moraleRemembered, applicants, posts } : { moraleRemembered });
      },

      check: (id) => {
        const a = get().applicants.find((x) => x.id === id);
        if (!a || a.flagKnown || !pay(CHECK_COST)) return false;
        set((s) => ({ applicants: s.applicants.map((x) => (x.id === id ? { ...x, flagKnown: true } : x)) }));
        return true;
      },

      hire: (id) => {
        const a = get().applicants.find((x) => x.id === id);
        if (!a || !pay(hireCost(a.rank))) return false;
        const leader: Leader = { id: a.id, role: a.role, name: a.name, avatarId: a.avatarId, personality: a.personality, rank: a.rank, xp: a.xp, perks: [], placedAt: null, flag: a.flag ?? null };
        const was = useTeamLeadersEmployeesStore.getState().hire(leader);
        set((s) => ({
          applicants: s.applicants.filter((x) => x.id !== id),
          // Whoever led them before leaves: a departure, remembered.
          letGoThisRun: s.letGoThisRun + (was ? 1 : 0),
          connections: was ? [...s.connections, asConnection(was)] : s.connections,
        }));
        return true;
      },

      pass: (id) => set((s) => ({ applicants: s.applicants.filter((x) => x.id !== id) })),

      letGo: (leaderId) => {
        const l = useTeamLeadersEmployeesStore.getState().employees.find((e) => e.id === leaderId);
        if (!l || !useTeamLeadersEmployeesStore.getState().fireEmployee(leaderId)) return false;
        set((s) => ({ letGoThisRun: s.letGoThisRun + 1, connections: [...s.connections, asConnection(l)] }));
        return true;
      },

      rehire: (id) => {
        const c = get().connections.find((x) => x.id === id);
        if (!c || !pay(REHIRE_COST)) return false;
        const leader: Leader = { id: `${c.id}_back_${Date.now()}`, role: c.role, name: c.name, avatarId: c.avatarId, personality: c.personality, rank: 1, xp: XP_AT[1], perks: [], placedAt: null, flag: c.flag ?? null };
        const was = useTeamLeadersEmployeesStore.getState().hire(leader);
        set((s) => ({
          connections: [...s.connections.filter((x) => x.id !== id), ...(was ? [asConnection(was)] : [])],
          letGoThisRun: s.letGoThisRun + (was ? 1 : 0),
        }));
        return true;
      },

      newCompany: () => {
        const leaders = useTeamLeadersEmployeesStore.getState().employees;
        set((s) => ({
          ...fresh,
          connections: [...s.connections, ...leaders.map(asConnection)],
          // Halfway home to an even reputation.
          moraleRemembered: s.moraleRemembered / 2,
          open: false,
        }));
      },

      reset: () => set({ ...fresh, moraleRemembered: 0, connections: [], open: false }),
    }),
    {
      name: "linkedout",
      partialize: (s) => ({
        posts: s.posts, applicants: s.applicants, postsThisRun: s.postsThisRun, letGoThisRun: s.letGoThisRun,
        moraleRemembered: s.moraleRemembered, connections: s.connections,
      }),
    },
  ),
);
