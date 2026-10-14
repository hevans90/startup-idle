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
import { AGENTS_A_RACK } from "../game/agents";
import { agentTrade, useAgentsStore } from "../state/agents.store";
import { buildCost } from "../game/build-cost";
import { roomFor, setHousingReader } from "../game/housing";
import {
  PROJECTS, buildersFor, projectCost, setProjectReader, type ProjectDef, type ProjectId,
} from "../game/projects";
import { useFounderStore } from "../state/founder.store";
import { useGeneratorStore, type GeneratorId } from "../state/generators.store";
import { useInnovationStore } from "../state/innovation.store";
import { useMoneyStore } from "../state/money.store";
import { useValuationStore } from "../state/valuation.store";
import { syncAvailableUpgrades, UPGRADES_CORE, useUpgradeStore } from "../state/upgrades.store";
import { getGeneratorCost } from "../utils/generator-utils";
import { structureDef } from "../world/structures/def";
import { STALL_GRACE } from "../world/projects/works";
import { landPrice, STARTING_PARCELS } from "../world/land";
import { LAB_SHARE } from "../world/projects/labs";
import { DESKLESS, DESKS } from "../world/agents/commute";
import { useSlopPitStore } from "../state/slop-pit.store";
import { HAUL_LOAD } from "../world/events/sludge";
import { MOOD, MOOD_LIMIT } from "../world/agents/mood";
import { setTownMoodReader } from "../game/town-mood";
import { PER_GROWN, PER_SERVICE, PER_WONDER } from "../world/projects/town-worth";
import { TOWN_BONUS_CAP, pendingEquity } from "../game/acquisition";
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
  /** Seconds to go on playing once the core upgrades are done: the late game. */
  afterCore?: number;
  /** Who founds it, by id: their modifiers and their rule on the map, at no exits. @see FOUNDERS */
  founder?: string;
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
  /** Parcels of land bought, and what they cost. @see world/land */
  parcels: number;
  spentOnLand: number;
  /** When the core upgrades were done, seconds from the start. */
  coreAt: number | null;
  /** Offices bought, and what they cost. @see seat */
  offices: number;
  spentOnOffices: number;
  /** R&D labs bought, and what they cost. @see world/projects/labs */
  labs: number;
  spentOnLabs: number;
  /** Each kind's mood at the end, as the town leans its satisfaction. @see moodOffsets */
  mood: Partial<Record<GeneratorId, number>>;
  /** What the town would add to the Equity offer at the end. @see townBonusOf */
  townBonus: number;
  /** Income a second at the end. */
  income: number;
  /** Times the slop pit was emptied by sludge trucks, and drained outright. */
  slopTrucked: number;
  slopDrained: number;
  /** Headcount by kind, every half hour of the run. */
  headcount: { at: number; owned: Partial<Record<GeneratorId, number>> }[];
  /**
   * WHEN ANYTHING NEW HAPPENED: an upgrade bought, a project opened, a kind
   * hired for the first time. The gaps between are the stretches where
   * nothing new was in reach. @see longestFlat
   */
  milestones: number[];
  /** When the run stopped: the core, plus however long it played on. */
  endedAt: number;
  /** AI agents spun up, and the racks built for them. @see game/agents */
  agents: number;
  racks: number;
  /** When the first agent was spun up. */
  firstAgent: number | null;
};

/**
 * THE LONGEST STRETCH WITH NOTHING NEW, seconds, from the start to `until`:
 * the biggest gap between milestones, and from the last one to the end. The
 * measure of a wall. @see MapRunReport.milestones
 */
export function longestFlat(report: MapRunReport, until = report.endedAt): { seconds: number; from: number } {
  const ms = [0, ...report.milestones.filter((m) => m <= until).sort((a, b) => a - b), until];
  let best = { seconds: 0, from: 0 };
  for (let k = 1; k < ms.length; k++) if (ms[k] - ms[k - 1] > best.seconds) best = { seconds: ms[k] - ms[k - 1], from: ms[k - 1] };
  return best;
}

const GATES: readonly ProjectId[] = ["garage", "townhall", "studio", "campus", "datacentre", "conference", "ipo"];
/** Lots a street, beds a lot by tier, and the service each tier grows with. */
const STREET = 6;
/**
 * LAND: lots a parcel takes, roads, services and sites allowing — a 16-tile
 * parcel with a road through it, both sides. A new lot past what the land
 * owned takes is the next parcel's price on top. @see world/land
 */
const LOTS_A_PARCEL = 20;
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
  if (options.founder) useFounderStore.getState().chooseFounder(options.founder);
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
  /**
   * The crews, site by site, each a share of whoever is still at a desk — as
   * the works size them. A crew stalled long enough has gone home. @see crewPlan
   */
  const crews = (): Map<Site, { crew: number; split: Partial<Record<GeneratorId, number>> }> => {
    const free: Partial<Record<GeneratorId, number>> = { ...owned() };
    const out = new Map<Site, { crew: number; split: Partial<Record<GeneratorId, number>> }>();
    for (const s of sites) {
      if (s.p.founderBuilds) { out.set(s, { crew: 1, split: {} }); continue; }
      const crew = s.stalled > STALL_GRACE ? 0 : buildersFor(s.p, 2, free, s.tiles);
      const eligible = s.p.builders.reduce((n, id) => n + (free[id] ?? 0), 0);
      const split: Partial<Record<GeneratorId, number>> = {};
      for (const id of s.p.builders) {
        split[id] = Math.round((crew * (free[id] ?? 0)) / Math.max(1, eligible));
        free[id] = Math.max(0, (free[id] ?? 0) - split[id]!);
      }
      out.set(s, { crew, split });
    }
    return out;
  };
  const away = (): Partial<Record<GeneratorId, number>> => {
    const out: Partial<Record<GeneratorId, number>> = {};
    for (const h of pending) out[h.id] = (out[h.id] ?? 0) + 1;
    for (const { split } of crews().values()) {
      for (const [id, n] of Object.entries(split)) out[id as GeneratorId] = (out[id as GeneratorId] ?? 0) + (n ?? 0);
    }
    return out;
  };
  const stopBeds = setHousingReader(() => ({ ...beds }));
  // R&D LABS, half of them near the campus. @see labReading
  let labs = 0;
  // AI RACKS, all of them by the Data Centre. @see game/agents
  let racks = 0;
  /**
   * DESKS: each kind's at the building that opened it, once it stands, and
   * at the offices bought for it. Those living on the map past the desks
   * work without one. @see seat
   */
  const offices: Record<GeneratorId, number> = { intern: 0, vibe_coder: 0, "10x_dev": 0 };
  const FIRST: Record<GeneratorId, [ProjectId, string]> = { intern: ["garage", "garage"], vibe_coder: ["studio", "studio"], "10x_dev": ["campus", "campus"] };
  const OFFICE_OF: Record<GeneratorId, string> = { intern: "office-intern", vibe_coder: "office-vibe", "10x_dev": "office-10x" };
  const desksOf = (id: GeneratorId) => (built.has(FIRST[id][0]) ? DESKS[FIRST[id][1]] : 0) + offices[id] * DESKS[OFFICE_OF[id]];
  /** Of a kind's people, those who live on the map (the first two interns live off it). */
  const onMap = (id: GeneratorId) => Math.max(0, (owned()[id] ?? 0) - (id === "intern" ? 2 : 0));
  const commuteOf = (id: GeneratorId) => {
    const total = owned()[id] ?? 0, here = onMap(id);
    if (!total) return commute;
    const seated = Math.min(here, desksOf(id)), without = here - seated;
    return ((total - here) + seated * commute + without * DESKLESS) / total;
  };
  const stopProjects = setProjectReader(() => ({
    built, away: away(), commute: { intern: commuteOf("intern"), vibe_coder: commuteOf("vibe_coder"), "10x_dev": commuteOf("10x_dev") },
    labs: { count: labs, mult: 1 + labs * LAB_SHARE * 1.5 },
    racks: { powered: racks * AGENTS_A_RACK, unpowered: 0 },
  }));
  /**
   * MOOD, a street at a time, as the game scores each of its houses: the
   * commute, and its services or the want of them. Weighted by beds, as
   * `moodOffsets` weights by residents. @see moodsOf
   */
  const streetMood = (tier: number) => {
    let m = Math.round((1 - commute) * 10 * MOOD.perTenthLost);
    if (tier === 0) m += MOOD.noServices;
    if (tier >= 1) m += MOOD.cafe;
    if (tier >= 2) m += MOOD.park;
    if (tier >= 3) m += MOOD.gym;
    return Math.max(-MOOD_LIMIT, Math.min(MOOD_LIMIT, m));
  };
  const moodNow = (): Partial<Record<GeneratorId, number>> => {
    const out: Partial<Record<GeneratorId, number>> = {};
    for (const [id, list] of Object.entries(streets) as [GeneratorId, { lots: number; tier: number }[]][]) {
      let sum = 0, n = 0;
      for (const st of list) { const b = st.lots * TIER_SLOTS[st.tier]; sum += streetMood(st.tier) * b; n += b; }
      if (n) out[id] = sum / n;
    }
    return out;
  };
  const stopMood = setTownMoodReader(moodNow);
  // The roster as the gates now see it: no interns before the garage.
  syncUnlockedGenerators();
  useMoneyStore.getState().increaseMoney(getGeneratorCost("intern", 1).toNumber() || 5);

  const report: MapRunReport = {
    totalSeconds: 0, opened: {}, firstHire: {}, tenth: {},
    spentOnLots: 0, spentOnProjects: 0, spentOnHires: 0, services: 0, spentOnServices: 0, stalledSeconds: 0, lots: 0,
    parcels: 0, spentOnLand: 0, coreAt: null, offices: 0, spentOnOffices: 0, labs: 0, spentOnLabs: 0, mood: {}, townBonus: 0, income: 0, headcount: [], slopTrucked: 0, slopDrained: 0, milestones: [], endedAt: 0, agents: 0, racks: 0, firstAgent: null,
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
    // Past the land owned, a lot costs the next parcel too.
    const lotsAll = Object.values(streets).flat().reduce((n, st) => n + st.lots, 0);
    const landFull = lotsAll >= (STARTING_PARCELS + report.parcels) * LOTS_A_PARCEL;
    const lotPrice = buildCost(lotDef)!.toNumber()
      + (landFull ? landPrice(report.parcels, useGeneratorStore.getState().getMoneyPerSecond()) : 0);
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
    // THE SLOP PIT, seen to as a player would when it is about to overflow:
    // trucks if they can be paid for, a drain if not. @see respondToEvent
    const pit = useSlopPitStore.getState();
    if (pit.fill >= 95) {
      const trucks = Math.max(200, useGeneratorStore.getState().getMoneyPerSecond() * 20);
      if (money() >= trucks) { spend(trucks); pit.haul(3 * HAUL_LOAD); report.slopTrucked++; }
      else { pit.drain(); report.slopDrained++; }
    }
    const o = owned();
    // The innovation unlocks had and the upgrades bought: what a gate is met by. @see Gate
    const unlocked = new Set(Object.entries(useInnovationStore.getState().unlocks).filter(([, u]) => u?.unlocked).map(([k]) => k));
    for (const id of useUpgradeStore.getState().unlockedUpgradeIds) unlocked.add(id);
    // ONE PROJECT AT A TIME, as in the game: the first ready, in order. @see projectUnderWay
    for (const id of GATES) {
      if (sites.length) break;
      const p = PROJECTS.find((x) => x.id === id)!;
      if (built.has(id) || !p.ready(o, unlocked)) continue;
      const def = structureDef(p.structure)!;
      sites.push({
        p, done: 0, delivered: 0, inFlight: [], startedAt: t, stalled: 0,
        cost: projectCost(p, useGeneratorStore.getState().getMoneyPerSecond()),
        tiles: def.footprint.w * def.footprint.h,
      });
    }
    const plan = crews();
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
      const crew = plan.get(s)?.crew ?? 0;
      if (there && s.stalled <= STALL_GRACE) s.done = Math.min(cap, s.done + crew);
      if (s.done >= s.p.work - 1e-6 && s.delivered >= s.p.deliveries) {
        built.add(s.p.id);
        report.opened[s.p.id] = t;
        report.milestones.push(t);
        sites.splice(sites.indexOf(s), 1);
        syncUnlockedGenerators();
      }
    }
    for (let k = pending.length - 1; k >= 0; k--) if (pending[k].at <= t) pending.splice(k, 1);
  };

  type Next = { kind: "gen" | "upgrade" | "lot" | "grow" | "lab" | "office" | "rack"; id: string; cost: number };
  const cheapest = (): Next | null => {
    syncAvailableUpgrades();
    const have = new Set(useUpgradeStore.getState().unlockedUpgradeIds);
    let best: Next | null = null;
    const consider = (c: Next) => { if (!best || c.cost < best.cost) best = c; };
    for (const u of useUpgradeStore.getState().availableUpgrades) {
      if (coreIds.has(u.id) && !have.has(u.id)) consider({ kind: "upgrade", id: u.id, cost: u.cost });
    }
    // A LAB, once the campus stands. @see world/projects/labs
    if (built.has("campus")) consider({ kind: "lab", id: "lab", cost: buildCost("lab")!.toNumber() });
    // A RACK, once the Data Centre stands and the racks are full. @see game/agents
    if (built.has("datacentre") && useAgentsStore.getState().agents >= racks * AGENTS_A_RACK) {
      consider({ kind: "rack", id: "rack", cost: buildCost("rack")!.toNumber() });
    }
    for (const g of useGeneratorStore.getState().generators) {
      const id = g.id as GeneratorId;
      // NO DESK for the next: an office first, as a lot when there is no bed.
      if (onMap(id) + 1 > desksOf(id) && built.has(FIRST[id][0])) consider({ kind: "office", id, cost: buildCost(OFFICE_OF[id])!.toNumber() });
      else if (roomFor(id, g.amount) >= 1) consider({ kind: "gen", id, cost: getGeneratorCost(id, 1).toNumber() });
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
    const afterCore = options.afterCore ?? 0;
    while (t < maxSim) {
      // THE CORE DONE, and then as long again as the late game is asked for.
      if (report.coreAt === null && coreComplete()) report.coreAt = t;
      if (report.coreAt !== null && t >= report.coreAt + afterCore) break;
      if (t >= report.headcount.length * 1800) {
        const o = owned(), income = Math.max(1e-9, useGeneratorStore.getState().getMoneyPerSecond());
        // And what the next of each costs, in seconds of income.
        const wait = Object.fromEntries(Object.keys(o).map((id) => [`${id}·s`, Math.round(getGeneratorCost(id as GeneratorId, 1).toNumber() / income)]));
        // And what selling would pay now, in Equity. @see equityForAccrued
        const equity = Math.round(pendingEquity().toNumber());
        const valuation = Math.round(useValuationStore.getState().accruedThisRun.toNumber());
        const innovation = Number(useInnovationStore.getState().innovation.toNumber().toPrecision(3));
        const ips = Number(useGeneratorStore.getState().getInnovationPerSecond().toPrecision(3));
        const mps = Number(income.toPrecision(3));
        report.headcount.push({ at: t, owned: { ...o, ...wait, valuation, equity, innovation, ips, mps } as Partial<Record<GeneratorId, number>> });
      }
      // AN AGENT, whenever the innovation and a rack's room are there and it
      // is worth it — the innovation it costs is a multiplier too: they cost
      // innovation, not money, so they are not in the money queue. @see agentTrade
      if (agentTrade(useAgentsStore.getState().agents).net > 1.001 && useAgentsStore.getState().spinUp()) {
        report.agents++;
        report.firstAgent ??= t;
        report.milestones.push(t);
      }
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
          const lotsAll = Object.values(streets).flat().reduce((n, st) => n + st.lots, 0);
          if (lotsAll >= (STARTING_PARCELS + report.parcels) * LOTS_A_PARCEL) {
            const land = landPrice(report.parcels, useGeneratorStore.getState().getMoneyPerSecond());
            report.parcels++; report.spentOnLand += land;
            report.spentOnLots += next.cost - land;
          } else report.spentOnLots += next.cost;
          report.lots++;
          const list = streets[id], last = list[list.length - 1];
          if (last && last.lots < STREET) last.lots++;
          else list.push({ lots: 1, tier: 0 });
        } else {
          report.spentOnServices += next.cost; report.services++;
          streets[id][way.street].tier++;
        }
        beds[id] = (id === "intern" ? 2 : 0) + streets[id].reduce((n, st) => n + st.lots * TIER_SLOTS[st.tier], 0);
      } else if (next.kind === "office") {
        spend(next.cost);
        report.spentOnOffices += next.cost; report.offices++;
        offices[next.id as GeneratorId]++;
      } else if (next.kind === "rack") {
        spend(next.cost);
        racks++; report.racks++;
      } else if (next.kind === "lab") {
        spend(next.cost);
        report.spentOnLabs += next.cost; report.labs++;
        labs++;
      } else if (next.kind === "gen") {
        const id = next.id as GeneratorId;
        useGeneratorStore.getState().purchaseGenerator(id, 1);
        report.spentOnHires += next.cost;
        pending.push({ id, at: t + arrivalDelay[id] });
        const n = useGeneratorStore.getState().generators.find((g) => g.id === id)!.amount;
        if (report.firstHire[id] === undefined) report.milestones.push(t);
        report.firstHire[id] ??= t;
        if (n >= 10) report.tenth[id] ??= t;
      } else {
        useUpgradeStore.getState().unlockUpgrade(next.id);
        report.milestones.push(t);
      }
    }
    // WHERE IT ENDED UP: the town's mood, its worth at a sale, and income.
    report.mood = moodNow();
    let worth = 0;
    for (const list of Object.values(streets)) {
      for (const st of list) worth += st.lots * st.tier * PER_GROWN + st.tier * PER_SERVICE;
    }
    worth += PROJECTS.filter((p) => p.bonus && built.has(p.id)).length * PER_WONDER;
    report.townBonus = Math.min(TOWN_BONUS_CAP, worth);
    report.income = useGeneratorStore.getState().getMoneyPerSecond();
  } finally {
    stopBeds();
    stopProjects();
    stopMood();
  }
  // The core run's length, as it always was; the late game is extra.
  report.totalSeconds = report.coreAt ?? t;
  report.endedAt = t;
  return report;
}
