/**
 * The core run AS THE MAP PLAYS IT: the same greedy player as
 * {@link simulateCoreUpgradeRun} — always the cheapest next thing — but with
 * the company's town gating it, as an abstract town rather than a grid:
 *  - BEDS: nobody is hired without one. More come from a new lot, or from
 *    the next café, park or gym for a street of lots, which grows them all a
 *    tier — whichever is cheaper a bed, at today's prices;
 *  - ARRIVALS: a hire takes a while to get to the map, and does not work until
 *    they have;
 *  - PROJECTS: the garage, the studio and the campus gate hiring, and are
 *    built by employees off their desks, with materials paid for load by load
 *    as the work needs them — and a company short of the next load stalls;
 *  - COMMUTE: a flat share of each day lost getting to work.
 * What it reports is WHEN things happen, to be held against the ungated run.
 * @see setHousingReader, setProjectReader
 */
import { buildCost } from "../game/build-cost";
import { roomFor, setHousingReader } from "../game/housing";
import {
  PROJECTS, buildersFor, projectCost, setProjectReader, type ProjectDef, type ProjectId,
} from "../game/projects";
import { useGeneratorStore, type GeneratorId } from "../state/generators.store";
import { useInnovationStore } from "../state/innovation.store";
import { useMoneyStore } from "../state/money.store";
import { syncAvailableUpgrades, UPGRADES_CORE, useUpgradeStore } from "../state/upgrades.store";
import { getGeneratorCost } from "../utils/generator-utils";
import { structureDef } from "../world/structures/def";
import { STALL_GRACE } from "../world/projects/works";
import { syncUnlockedGenerators } from "../state/generators.store";
import { advanceGameplayOneSecond } from "./run-sim";
import { resetAllGameStores } from "./reset-game-stores";

export type MapRunOptions = {
  maxSimulatedSeconds?: number;
  /** Seconds a hire takes to arrive and move in, by kind. */
  arrival?: Partial<Record<GeneratorId, number>>;
  /** The share of a day's work commuting leaves. */
  commute?: number;
  /** Seconds a crew takes to get to a new site; the founder drives. */
  walkIn?: number;
  founderDrive?: number;
  /** Seconds a load takes to arrive once paid for. */
  truck?: number;
};

export type MapRunReport = {
  totalSeconds: number;
  /** When each project opened, seconds from the start. */
  opened: Partial<Record<ProjectId, number>>;
  /** When each kind was first hired, and when it reached ten. */
  firstHire: Partial<Record<GeneratorId, number>>;
  tenth: Partial<Record<GeneratorId, number>>;
  /** Spent on lots, and on project materials. */
  spentOnLots: number;
  spentOnProjects: number;
  /** Cafés, parks and gyms bought, and what they cost. */
  services: number;
  spentOnServices: number;
  /** Spent on hiring, for scale. */
  spentOnHires: number;
  /** Seconds some site sat stalled for want of money. */
  stalledSeconds: number;
  /** Seconds the cheapest next thing was a lot rather than a hire or an upgrade. */
  lots: number;
};

const GATES: readonly ProjectId[] = ["garage", "townhall", "studio", "campus"];
/** Lots a street, beds a lot by tier, and the service each tier grows with. */
const STREET = 6;
const TIER_SLOTS = [2, 5, 12, 30];
const SERVICE_ORDER = ["cafe", "park", "gym"] as const;
const STOCK = 2;

type Site = {
  p: ProjectDef; done: number; delivered: number; inFlight: number[]; cost: number; startedAt: number; tiles: number;
  /** Seconds it has sat out of materials with no money for more; past STALL_GRACE its crew has gone home. */
  stalled: number;
};

export function simulateMapRun(
  advanceTimersByTime: (ms: number) => void,
  options: MapRunOptions = {},
): MapRunReport {
  const maxSim = options.maxSimulatedSeconds ?? 86400 * 14;
  const arrivalDelay = { intern: 15, vibe_coder: 12, "10x_dev": 15, ...options.arrival };
  const commute = options.commute ?? 0.85;
  const walkIn = options.walkIn ?? 20, founderDrive = options.founderDrive ?? 35, truck = options.truck ?? 15;
  const coreIds = new Set(UPGRADES_CORE.map((u) => u.id));

  resetAllGameStores();
  const now = Date.now();
  useGeneratorStore.setState({ globalLastTick: now });
  useInnovationStore.setState({ globalLastTick: now });

  // THE TOWN.
  const beds: Record<GeneratorId, number> = { intern: 2, vibe_coder: 0, "10x_dev": 0 };
  const built = new Set<ProjectId>();
  const sites: Site[] = [];
  const pending: { id: GeneratorId; at: number }[] = [];
  let t = 0;
  const owned = (): Partial<Record<GeneratorId, number>> =>
    Object.fromEntries(useGeneratorStore.getState().generators.map((g) => [g.id, g.amount]));
  const away = (): Partial<Record<GeneratorId, number>> => {
    const out: Partial<Record<GeneratorId, number>> = {};
    for (const h of pending) out[h.id] = (out[h.id] ?? 0) + 1;
    const o = owned();
    for (const s of sites) {
      // A crew stalled long enough has gone home, and is back at its desks. @see STALL_GRACE
      if (s.p.founderBuilds || s.stalled > STALL_GRACE) continue;
      const crew = buildersFor(s.p, 2, o, s.tiles);
      // Split by headcount, as the works do.
      const eligible = s.p.builders.reduce((n, id) => n + (o[id] ?? 0), 0);
      for (const id of s.p.builders) out[id] = (out[id] ?? 0) + Math.round((crew * (o[id] ?? 0)) / Math.max(1, eligible));
    }
    return out;
  };
  const stopBeds = setHousingReader(() => ({ ...beds }));
  const stopProjects = setProjectReader(() => ({
    built, away: away(), commute: { intern: commute, vibe_coder: commute, "10x_dev": commute },
  }));
  // The roster as the gates now see it: no interns before the garage.
  syncUnlockedGenerators();
  useMoneyStore.getState().increaseMoney(getGeneratorCost("intern", 1).toNumber() || 5);

  const report: MapRunReport = {
    totalSeconds: 0, opened: {}, firstHire: {}, tenth: {},
    spentOnLots: 0, spentOnProjects: 0, spentOnHires: 0, services: 0, spentOnServices: 0, stalledSeconds: 0, lots: 0,
  };
  const money = () => useMoneyStore.getState().money.toNumber();
  const spend = (n: number) => { useMoneyStore.getState().spendMoney(n); };

  /**
   * STREETS: lots in sixes, each street served by the services the player
   * has bought it, its lots grown to the tier those allow. A service serves
   * about a street of lots. @see world/agents/services
   */
  const streets: Record<GeneratorId, { lots: number; tier: number }[]> = { intern: [], vibe_coder: [], "10x_dev": [] };
  /**
   * The cheapest way to more beds for a kind, a bed at a time: a new lot (on
   * the last street, at its tier once it has grown), or the next service for
   * a street, which grows every lot on it a tier.
   */
  const bestBeds = (id: GeneratorId): { kind: "lot" | "grow"; cost: number; beds: number; street: number } => {
    const lotDef = `kit:${id}.t0`;
    const list = streets[id];
    const last = list[list.length - 1];
    const lotTier = last && last.lots < STREET ? last.tier : 0;
    const lotPrice = buildCost(lotDef)!.toNumber();
    let best = { kind: "lot" as "lot" | "grow", cost: lotPrice, beds: TIER_SLOTS[lotTier], street: -1 };
    // Services only once the Town Hall has opened them.
    if (built.has("townhall")) list.forEach((st, k) => {
      if (st.tier >= SERVICE_ORDER.length) return;
      const cost = buildCost(SERVICE_ORDER[st.tier])!.toNumber();
      const gained = st.lots * (TIER_SLOTS[st.tier + 1] - TIER_SLOTS[st.tier]);
      if (cost / gained < best.cost / best.beds) best = { kind: "grow", cost, beds: gained, street: k };
    });
    return best;
  };

  /** One second of the town: projects started, worked, supplied and opened; hires arriving. */
  const stepTown = () => {
    const o = owned();
    const unlocked = new Set(Object.entries(useInnovationStore.getState().unlocks).filter(([, u]) => u?.unlocked).map(([k]) => k));
    for (const id of GATES) {
      const p = PROJECTS.find((x) => x.id === id)!;
      if (built.has(id) || sites.some((s) => s.p.id === id) || !p.ready(o, unlocked)) continue;
      const def = structureDef(p.structure)!;
      sites.push({
        p, done: 0, delivered: 0, inFlight: [], startedAt: t, stalled: 0,
        cost: projectCost(p, useGeneratorStore.getState().getMoneyPerSecond()),
        tiles: def.footprint.w * def.footprint.h,
      });
    }
    for (const s of [...sites]) {
      // Loads arriving, and loads sent while the stock is low and the money is there.
      s.delivered += s.inFlight.filter((at) => at <= t).length;
      s.inFlight = s.inFlight.filter((at) => at > t);
      const perLoad = s.p.work / s.p.deliveries, cap = perLoad * s.delivered;
      const sent = s.delivered + s.inFlight.length;
      if ((cap - s.done) / perLoad + s.inFlight.length < STOCK && sent < s.p.deliveries) {
        const price = s.cost / s.p.deliveries;
        if (money() >= price) { spend(price); report.spentOnProjects += price; s.inFlight.push(t + truck); s.stalled = 0; }
        else report.stalledSeconds++;
      }
      // Out of materials, and none coming: stalled.
      if (s.done >= cap - 1e-6 && s.inFlight.length === 0 && s.delivered < s.p.deliveries) s.stalled++;
      else s.stalled = 0;
      // Work, once the crew is there, as far as the materials go.
      const there = t - s.startedAt >= (s.p.founderBuilds ? founderDrive : walkIn);
      const crew = s.p.founderBuilds ? 1 : buildersFor(s.p, 2, o, s.tiles);
      if (there && s.stalled <= STALL_GRACE) s.done = Math.min(cap, s.done + crew);
      if (s.done >= s.p.work - 1e-6 && s.delivered >= s.p.deliveries) {
        built.add(s.p.id);
        report.opened[s.p.id] = t;
        sites.splice(sites.indexOf(s), 1);
        syncUnlockedGenerators();
      }
    }
    for (let k = pending.length - 1; k >= 0; k--) if (pending[k].at <= t) pending.splice(k, 1);
  };

  type Next = { kind: "gen" | "upgrade" | "lot" | "grow"; id: string; cost: number };
  const cheapest = (): Next | null => {
    syncAvailableUpgrades();
    const have = new Set(useUpgradeStore.getState().unlockedUpgradeIds);
    let best: Next | null = null;
    const consider = (c: Next) => { if (!best || c.cost < best.cost) best = c; };
    for (const u of useUpgradeStore.getState().availableUpgrades) {
      if (coreIds.has(u.id) && !have.has(u.id)) consider({ kind: "upgrade", id: u.id, cost: u.cost });
    }
    for (const g of useGeneratorStore.getState().generators) {
      const id = g.id as GeneratorId;
      if (roomFor(id, g.amount) >= 1) consider({ kind: "gen", id, cost: getGeneratorCost(id, 1).toNumber() });
      else {
        // No bed: the next of them costs a lot, or a service, first.
        const way = bestBeds(id);
        consider({ kind: way.kind, id, cost: way.cost });
      }
    }
    return best;
  };

  const coreComplete = () => UPGRADES_CORE.every((u) => useUpgradeStore.getState().unlockedUpgradeIds.includes(u.id));
  try {
    while (!coreComplete() && t < maxSim) {
      const next = cheapest();
      if (!next) { advanceGameplayOneSecond(advanceTimersByTime); t++; stepTown(); continue; }
      if (money() < next.cost) {
        // Wait a second at a time, looking again every ten: a project opening
        // can put something cheaper on the table.
        for (let k = 0; k < 10 && money() < next.cost && t < maxSim; k++) {
          advanceGameplayOneSecond(advanceTimersByTime); t++; stepTown();
        }
        continue;
      }
      if (next.kind === "lot" || next.kind === "grow") {
        const id = next.id as GeneratorId, way = bestBeds(id);
        spend(next.cost);
        if (way.kind === "lot") {
          report.spentOnLots += next.cost; report.lots++;
          const list = streets[id], last = list[list.length - 1];
          if (last && last.lots < STREET) last.lots++;
          else list.push({ lots: 1, tier: 0 });
        } else {
          report.spentOnServices += next.cost; report.services++;
          streets[id][way.street].tier++;
        }
        beds[id] = (id === "intern" ? 2 : 0) + streets[id].reduce((n, st) => n + st.lots * TIER_SLOTS[st.tier], 0);
      } else if (next.kind === "gen") {
        const id = next.id as GeneratorId;
        useGeneratorStore.getState().purchaseGenerator(id, 1);
        report.spentOnHires += next.cost;
        pending.push({ id, at: t + arrivalDelay[id] });
        const n = useGeneratorStore.getState().generators.find((g) => g.id === id)!.amount;
        report.firstHire[id] ??= t;
        if (n >= 10) report.tenth[id] ??= t;
      } else {
        useUpgradeStore.getState().unlockUpgrade(next.id);
      }
    }
  } finally {
    stopBeds();
    stopProjects();
  }
  report.totalSeconds = t;
  return report;
}
