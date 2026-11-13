/**
 * World v2 — THE PILOT'S PEOPLE DESK: who to hire, and which upgrade to buy.
 *
 *  - A HIRE for EACH kind — interns, vibe coders, 10x devs — sized to the
 *    beds standing empty and to what there is to spend. A kind with no bed
 *    waits on one, and says so; a kind not open yet waits on what opens it.
 *  - EVERY UPGRADE the Employees tab offers: the next of each set, as a
 *    player is offered them — not only the one a landmark is gated on.
 *
 * It proposes; it does not choose. What a hire or an upgrade is WORTH is the
 * game's own rate for it, as near as can be told. @see Desk, choose
 */
import { roomFor } from "../../../../game/housing";
import { PROJECTS } from "../../../../game/projects";
import { nextPerSet } from "../../../../game/upgrade-sets";
import { GENERATOR_TYPES, useGeneratorStore, type GeneratorId } from "../../../../state/generators.store";
import { useUpgradeStore, type Upgrade } from "../../../../state/upgrades.store";
import { useWorldStore } from "../../../../state/world.store";
import { getGeneratorCost } from "../../../../utils/generator-utils";
import { DESKS, WORKPLACES, desklessShare } from "../../../agents/commute";
import { builtProjects } from "../../../projects/works";
import type { Purse } from "../chooser";
import type { Job, Need } from "../job";
import type { Desk } from "../pilot";

/** The most hired in one job; and how far the average price of a batch may run over the first's. */
export const MOST_AT_ONCE = 1000;
export const BATCH_PREMIUM = 1.5;
/** Seconds before a purchase that failed for want of money or a bed is tried again. */
const TRY_AGAIN = 5;
/**
 * The least any upgrade is taken to be worth, as a share of income: what it
 * does for costs is real and hard to price, and none should be left unbought
 * for ever because its worth could not be told.
 */
export const UPGRADE_FLOOR = 0.01;
/** A cut in a kind's price, taken as this share of the same cut in its output; and a step off its cost curve, as so many such cuts. */
const COST_CUT_WORTH = 0.5;
const EXPONENT_WORTH = 5;

const plural = (name: string, n: number) => (n === 1 ? name : `${name}s`);
const an = (name: string) => (/^[aeiou]/i.test(name) ? `an ${name}` : `a ${name}`);

const amountOf = (id: GeneratorId) => useGeneratorStore.getState().generators.find((g) => g.id === id)?.amount ?? 0;

/** The most of a kind to hire at once: what there is room and money for, the batch not much dearer a head than the first. At least one. */
function batch(id: GeneratorId, room: number, have: number): number {
  const one = getGeneratorCost(id, 1).toNumber();
  let lo = 1, hi = Math.max(1, Math.min(MOST_AT_ONCE, Math.floor(room)));
  while (lo < hi) {
    const mid = Math.floor((lo + hi + 1) / 2);
    const cost = getGeneratorCost(id, mid).toNumber();
    if (cost <= have && cost <= mid * one * BATCH_PREMIUM) lo = mid; else hi = mid - 1;
  }
  return lo;
}

/** Desks standing empty for a kind: its workplaces' desks, less everyone it employs. */
function freeDesks(id: GeneratorId): number {
  let desks = 0;
  for (const s of useWorldStore.getState().grid.structures.values()) {
    if (!s.build && (WORKPLACES[id] as readonly string[] | undefined)?.includes(s.def)) desks += DESKS[s.def] ?? 0;
  }
  return Math.max(0, desks - amountOf(id));
}

/**
 * What `n` more of a kind would earn: in full for those with a desk to go to,
 * and what the deskless manage for the rest. Taken at full whatever the
 * desks, a hire always beat the office its people needed.
 */
function earns(id: GeneratorId, n: number): number {
  const each = useGeneratorStore.getState().getGeneratorMoneyPerSecond(id, 1);
  const seated = Math.min(n, freeDesks(id));
  return each * (seated + (n - seated) * desklessShare());
}

/** A hire for each kind. */
function hires(purse: Purse): Job[] {
  const gens = useGeneratorStore.getState();
  const have = Math.max(0, purse.money - purse.reserve);
  const out: Job[] = [];
  for (const base of GENERATOR_TYPES) {
    const id = base.id as GeneratorId;
    const gen = gens.generators.find((g) => g.id === id);
    if (!gen) {
      // NOT OPEN YET: waiting on the project that opens it, or the people it takes.
      const needs = opens(id);
      if (needs.length) out.push({
        id: `hire:${id}`, desk: "people", says: `Hire the first ${base.name}`, why: `${plural(base.name, 2)} are not open yet`,
        cost: base.cost, gain: base.baseProduction, needs, run: () => ({ ok: false, because: "not open yet", retry: TRY_AGAIN }),
      });
      continue;
    }
    const room = Math.floor(roomFor(id, gen.amount));
    const n = room >= 1 ? batch(id, room, have) : 1;
    const needs: Need[] | undefined = room >= 1 ? undefined : [{ id: `beds:${id}`, says: `a bed for ${an(base.name)}` }];
    out.push({
      id: `hire:${id}`, desk: "people",
      says: `Hire ${n} ${plural(base.name, n)}`,
      why: room >= 1 ? `${room} ${plural("bed", room)} standing empty` : `no bed for ${an(base.name)}`,
      cost: getGeneratorCost(id, n).toNumber(),
      gain: earns(id, n),
      needs,
      run: () => {
        const before = amountOf(id);
        useGeneratorStore.getState().purchaseGenerator(id, n);
        const got = amountOf(id) - before;
        if (got >= n) return { ok: true };
        return { ok: false, because: roomFor(id, before) < n ? `no bed for ${an(base.name)}` : "not enough money", retry: TRY_AGAIN };
      },
    });
  }
  return out;
}

/** What a kind not yet on the roster waits on: its project, unbuilt; else the people its unlock asks for. */
function opens(id: GeneratorId): Need[] {
  const project = PROJECTS.find((p) => p.unlocks === id);
  if (project && !builtProjects(useWorldStore.getState().grid).has(project.id)) return [{ id: `project:${project.id}`, says: `the ${project.name}` }];
  const base = GENERATOR_TYPES.find((g) => g.id === id);
  return (base?.unlockConditions ?? [])
    .filter((c) => amountOf(c.requiredId) < c.requiredAmount)
    .map((c) => ({ id: `hire:${c.requiredId}`, says: `${c.requiredAmount} ${plural(GENERATOR_TYPES.find((g) => g.id === c.requiredId)?.name ?? c.requiredId, c.requiredAmount)}` }));
}

/** What an upgrade does, in a line. */
function does(u: Upgrade): string {
  const parts: string[] = [];
  for (const e of u.effects) {
    const who = plural(GENERATOR_TYPES.find((g) => g.id === e.genId)?.name ?? e.genId, 2);
    for (const c of e.changes) {
      if (c.type === "multiplier") parts.push(`${who} earn ×${c.value}`);
      else if (c.type === "costMultiplier") parts.push(`${who} cost ×${c.value}`);
      else parts.push(`${who} get dearer more slowly`);
    }
  }
  return parts.length ? parts.join("; ") : u.description;
}

/** Income a second an upgrade adds, as near as can be told. Never under the floor. */
export function upgradeGain(u: Upgrade, income: number): number {
  const gens = useGeneratorStore.getState();
  let gain = 0;
  for (const e of u.effects) {
    const earns = gens.getGeneratorMoneyPerSecond(e.genId, amountOf(e.genId));
    for (const c of e.changes) {
      if (c.type === "multiplier") gain += (c.value - 1) * earns;
      else if (c.type === "costMultiplier") gain += Math.max(0, 1 - c.value) * earns * COST_CUT_WORTH;
      else gain += Math.max(0, -c.delta) * earns * COST_CUT_WORTH * EXPONENT_WORTH;
    }
  }
  return Math.max(gain, Math.max(0, income) * UPGRADE_FLOOR);
}

/** Every upgrade on offer: the next of each set. */
function upgrades(purse: Purse): Job[] {
  const ups = useUpgradeStore.getState();
  return nextPerSet(ups.availableUpgrades).map((u) => ({
    id: `upgrade:${u.id}`, desk: "people" as const,
    says: u.name, why: does(u),
    cost: u.cost, gain: upgradeGain(u, purse.income),
    done: () => useUpgradeStore.getState().unlockedUpgradeIds.includes(u.id),
    run: () => {
      useUpgradeStore.getState().unlockUpgrade(u.id);
      return useUpgradeStore.getState().unlockedUpgradeIds.includes(u.id) ? { ok: true } : { ok: false, because: "not enough money", retry: TRY_AGAIN };
    },
  }));
}

export const peopleDesk = (): Desk => ({ id: "people", propose: (purse) => [...hires(purse), ...upgrades(purse)] });
