import Decimal from "break_infinity.js";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import {
  buildAdjacency,
  canRemoveWithoutOrphan,
  frontierPath,
  isReachable,
  nodeById,
  nodeCost,
  nodesToRemove,
  NEUTRAL_PRESTIGE_MODIFIERS,
  type PrestigeModifiers,
  resolvePrestigeModifiers,
  SKILL_TREE,
} from "../game/skill-tree";
import {
  coerceDecimal,
  decimalReplacer,
  decimalReviver,
} from "./_break_infinity.decimals";

const LOCAL_STORAGE_KEY = "prestige";

/** Respec points granted per Exit spent (design doc §1). */
export const RESPECS_PER_EXIT = 20;

// Precomputed once — the tree is static.
const ADJACENCY = buildAdjacency(SKILL_TREE);
const NODES = nodeById(SKILL_TREE);

/**
 * Company Acquisition prestige: spend Equity (earned by getting acquired) on a
 * Path-of-Exile-style skill tree. Node cost ESCALATES with how many you've
 * allocated (each costs more than the last). Respeccing refunds nodes for respec
 * points, which you buy with Exits.
 */
type PrestigeState = {
  /** Spendable prestige currency. */
  equity: Decimal;
  /** Spendable acquisition count (1 banked per acquisition, spent on respecs). */
  exits: number;
  /** Persistent respec points (bought with Exits, spent refunding nodes). */
  respecPoints: number;
  /** Allocated skill-tree node ids. */
  allocated: string[];
  /** Resolved economy modifiers from `allocated` (derived; recomputed on every
   * change, never persisted). Read at the founder-style chokepoints. */
  modifiers: PrestigeModifiers;

  /** Equity cost of the next node (escalates with allocation count). */
  getNextCost: () => number;
  /** A node is allocatable if reachable (root/adjacent), unallocated, affordable. */
  canAllocate: (id: string) => boolean;
  /** Spend Equity to allocate a node (no-op if not allocatable). */
  allocate: (id: string) => void;
  /** Allocate the whole cheapest route to `id` in one go (the affordable prefix
   * if you can't afford all of it). Single click → multi-node allocation. */
  allocatePath: (id: string) => void;

  /** Whether a node can be refunded right now (has points + safe to remove). */
  canRespec: (id: string) => boolean;
  /** Refund a node: −1 respec point, +its marginal Equity back, deallocate. */
  respecNode: (id: string) => void;
  /** Refund `id` and its dependent subtree leaf-ward in one go, bounded by your
   * respec points (1 per node). Single click → multi-node respec. */
  respecPath: (id: string) => void;
  /** Spend 1 Exit for RESPECS_PER_EXIT respec points. */
  buyRespecs: () => void;

  /** Bank an acquisition payout: add Equity and increment the exit count. */
  bankAcquisition: (gain: Decimal) => void;
  /** Dev only: hand out Equity to exercise the tree. */
  grantEquity: (amount: number) => void;
  reset: () => void;
};

export const usePrestigeStore = create<PrestigeState>()(
  persist(
    (set, get) => ({
      equity: new Decimal(0),
      exits: 0,
      respecPoints: 0,
      allocated: [],
      modifiers: { ...NEUTRAL_PRESTIGE_MODIFIERS },

      getNextCost: () => nodeCost(get().allocated.length),

      canAllocate: (id) => {
        if (!NODES.has(id)) return false;
        const allocated = new Set(get().allocated);
        if (!isReachable(SKILL_TREE, allocated, id, ADJACENCY)) return false;
        return get().equity.gte(get().getNextCost());
      },

      allocate: (id) => {
        if (!get().canAllocate(id)) return;
        const cost = get().getNextCost();
        set((s) => {
          const allocated = [...s.allocated, id];
          return {
            equity: s.equity.sub(cost),
            allocated,
            modifiers: resolvePrestigeModifiers(allocated),
          };
        });
      },

      allocatePath: (id) => {
        const s = get();
        if (!NODES.has(id)) return;
        const allocatedSet = new Set(s.allocated);
        if (allocatedSet.has(id)) return;
        const path = frontierPath(SKILL_TREE, allocatedSet, id, ADJACENCY);
        if (!path.length) return;
        // Buy along the route, stopping at the affordable prefix.
        let equity = s.equity;
        let count = s.allocated.length;
        const added: string[] = [];
        for (const nid of path) {
          const cost = nodeCost(count);
          if (equity.lt(cost)) break;
          equity = equity.sub(cost);
          added.push(nid);
          count += 1;
        }
        if (!added.length) return;
        set((st) => {
          const allocated = [...st.allocated, ...added];
          return { equity, allocated, modifiers: resolvePrestigeModifiers(allocated) };
        });
      },

      canRespec: (id) => {
        const s = get();
        if (s.respecPoints < 1) return false;
        return canRemoveWithoutOrphan(
          SKILL_TREE,
          new Set(s.allocated),
          id,
          ADJACENCY,
        );
      },

      respecNode: (id) => {
        if (!get().canRespec(id)) return;
        // Refund the current top marginal cost (symmetric with allocate), so
        // Equity is fully recoverable regardless of removal order.
        const refund = nodeCost(get().allocated.length - 1);
        set((s) => {
          const allocated = s.allocated.filter((n) => n !== id);
          return {
            respecPoints: s.respecPoints - 1,
            equity: s.equity.add(refund),
            allocated,
            modifiers: resolvePrestigeModifiers(allocated),
          };
        });
      },

      respecPath: (id) => {
        const start = get();
        if (start.respecPoints < 1 || !start.allocated.includes(id)) return;
        const target = new Set(
          nodesToRemove(SKILL_TREE, new Set(start.allocated), id, ADJACENCY),
        );
        if (target.size === 0) return;
        // Refund leaf-ward (always removing a currently-safe node), bounded by
        // available respec points — so a partial refund never orphans anything.
        let allocated = [...start.allocated];
        let points = start.respecPoints;
        let equity = start.equity;
        while (points > 0 && target.size > 0) {
          const cur = new Set(allocated);
          const removable = [...target].find((t) =>
            canRemoveWithoutOrphan(SKILL_TREE, cur, t, ADJACENCY),
          );
          if (!removable) break;
          equity = equity.add(nodeCost(allocated.length - 1));
          allocated = allocated.filter((nid) => nid !== removable);
          target.delete(removable);
          points -= 1;
        }
        set({
          allocated,
          respecPoints: points,
          equity,
          modifiers: resolvePrestigeModifiers(allocated),
        });
      },

      buyRespecs: () => {
        if (get().exits < 1) return;
        set((s) => ({
          exits: s.exits - 1,
          respecPoints: s.respecPoints + RESPECS_PER_EXIT,
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
        set({
          equity: new Decimal(0),
          exits: 0,
          respecPoints: 0,
          allocated: [],
          modifiers: { ...NEUTRAL_PRESTIGE_MODIFIERS },
        });
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
        respecPoints: s.respecPoints,
        allocated: s.allocated,
      }),
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<PrestigeState>;
        // Drop any allocated ids that no longer exist in the tree.
        const allocated = (p.allocated ?? []).filter((id) => NODES.has(id));
        return {
          ...current,
          ...p,
          equity: coerceDecimal(p.equity, current.equity),
          allocated,
          modifiers: resolvePrestigeModifiers(allocated),
        };
      },
    },
  ),
);
