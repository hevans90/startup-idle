import Decimal from "break_infinity.js";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import {
  buildAdjacency,
  isReachable,
  nodeById,
  SKILL_TREE,
} from "../game/skill-tree";
import {
  coerceDecimal,
  decimalReplacer,
  decimalReviver,
} from "./_break_infinity.decimals";

const LOCAL_STORAGE_KEY = "prestige";

// Precomputed once — the tree is static.
const ADJACENCY = buildAdjacency(SKILL_TREE);
const NODES = nodeById(SKILL_TREE);

/**
 * Company Acquisition prestige: spend Equity (earned by getting acquired) on a
 * Path-of-Exile-style skill tree. PROTOTYPE — allocation + persistence are real;
 * Equity earning (acquisition) and the node EFFECTS get wired up later.
 */
type PrestigeState = {
  /** Spendable prestige currency. */
  equity: Decimal;
  /** Number of acquisitions (prestiges) so far. */
  exits: number;
  /** Allocated skill-tree node ids. */
  allocated: string[];

  /** A node is allocatable if reachable (root/adjacent), unallocated, affordable. */
  canAllocate: (id: string) => boolean;
  /** Spend Equity to allocate a node (no-op if not allocatable). */
  allocate: (id: string) => void;
  /** Bank an acquisition payout: add Equity and increment the exit count. */
  bankAcquisition: (gain: Decimal) => void;
  /** Dev only: hand out Equity to exercise the tree before acquisition exists. */
  grantEquity: (amount: number) => void;
  reset: () => void;
};

export const usePrestigeStore = create<PrestigeState>()(
  persist(
    (set, get) => ({
      equity: new Decimal(0),
      exits: 0,
      allocated: [],

      canAllocate: (id) => {
        const node = NODES.get(id);
        if (!node) return false;
        const allocated = new Set(get().allocated);
        if (!isReachable(SKILL_TREE, allocated, id, ADJACENCY)) return false;
        return get().equity.gte(node.cost);
      },

      allocate: (id) => {
        if (!get().canAllocate(id)) return;
        const node = NODES.get(id)!;
        set((s) => ({
          equity: s.equity.sub(node.cost),
          allocated: [...s.allocated, id],
        }));
      },

      bankAcquisition: (gain) => {
        if (gain.lte(0)) return;
        set((s) => ({ equity: s.equity.add(gain), exits: s.exits + 1 }));
      },

      grantEquity: (amount) => {
        if (amount <= 0) return;
        set((s) => ({ equity: s.equity.add(amount) }));
      },

      reset: () => {
        set({ equity: new Decimal(0), exits: 0, allocated: [] });
        usePrestigeStore.persist.clearStorage();
      },
    }),
    {
      name: LOCAL_STORAGE_KEY,
      storage: createJSONStorage(() => localStorage, {
        replacer: decimalReplacer,
        reviver: decimalReviver,
      }),
      partialize: (s) => ({
        equity: s.equity,
        exits: s.exits,
        allocated: s.allocated,
      }),
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<PrestigeState>;
        return {
          ...current,
          ...p,
          equity: coerceDecimal(p.equity, current.equity),
          // Drop any allocated ids that no longer exist in the tree.
          allocated: (p.allocated ?? []).filter((id) => NODES.has(id)),
        };
      },
    },
  ),
);
