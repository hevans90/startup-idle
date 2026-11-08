/**
 * The core run AS THE MAP PLAYS IT: the same greedy player as
 * {@link simulateCoreUpgradeRun} — always the cheapest next thing — but with
 * the company's town gating it, as an abstract town rather than a grid:
 *  - BEDS: nobody is hired without one. More come from a new lot, or from
 *    the town opening a service for a full street, which grows its lots a
 *    tier;
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
import { PROCESSOR_STEP, buildCost, pipeCost } from "../game/build-cost";
import { CAMPUS_BEDS, hasLots, roomFor, setHousingReader } from "../game/housing";
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
import { LAB_SHARE } from "../world/projects/labs";
import { DESKLESS, DESKS } from "../world/agents/commute";
import { SLOP_FROM, SPILL_DEPTH, slopRate } from "../game/slop";
import { DRY_RATE } from "../world/events/sludge";
import { CLEANERS_PER_TILE, CLEAN_RATE } from "../world/events/cleanup";
import { PROCESS_RATE, setProcessorUse } from "../game/processors";
import { sewerFlow } from "../game/mains";
import { MOOD, MOOD_LIMIT, NEED_MOOD } from "../world/agents/mood";
import { setTownMoodReader } from "../game/town-mood";
import { PER_GROWN, PER_SERVICE, PER_WONDER } from "../world/projects/town-worth";
import { TOWN_BONUS_CAP, pendingEquity } from "../game/acquisition";
import { syncUnlockedGenerators } from "../state/generators.store";
import { advanceGameplayOneSecond } from "./run-sim";
import { resetAllGameStores } from "./reset-game-stores";
import { cultureNow } from "../game/culture-now";
import { NEEDS, type ServiceId } from "../world/agents/needs";
import { needOpen, startLadder, stepLadder, wantsAny } from "../world/agents/unlocks";
import { EVENT_HEADCOUNT, FIRST_GAP, GAP } from "../world/events/director";
import { EVENT_DEFS } from "../world/events/defs";
import type { EventKind } from "../world/events/events";
import { EVENTS, company } from "./event-model";

/** Tiles of sewer the run lays from its studio to the water, once there is slop, and again for each sewer's worth more. */
const SIM_SEWER_TILES = 20;

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
  /** Slop: seen to with sewers and refineries (the default), or content farms; sewers alone, or left to spill. */
  slop?: "refine" | "farm" | "sewer" | "spill";
  /** Map events, on the director's clock and left to their defaults (the default); false for none. @see eventDraw */
  events?: boolean;
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
  /** Services the town opened. */
  services: number;
  /** When each service unlocked, in order. @see stepLadder */
  unlocks: { id: ServiceId; at: number }[];
  /** Spent on hiring, for scale. */
  spentOnHires: number;
  /** Seconds some site sat stalled for want of money. */
  stalledSeconds: number;
  /** Seconds the cheapest next thing was a lot rather than a hire or an upgrade. */
  lots: number;
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
  /** The map events drawn, when, and what their defaults cost, money. @see eventDraw */
  events: { kind: string; at: number; cost: number }[];
  /** When slop started, and when a sewer for it was paid for; null for never. @see SIM_SEWER_TILES */
  slopAt: number | null;
  seweredAt: number | null;
  /** When a slop refinery was paid for, after the sewer: a project's price, not built tile by tile. */
  refineryAt: number | null;
  /** Refineries and sewers bought, what they all cost, and the most slop made a second. */
  refineries: number;
  sewers: number;
  spentOnSlop: number;
  peakSlop: number;
  /** Vibe coders away mopping, at most; and when a sale would first pay any Equity. */
  peakMopping: number;
  saleAt: number | null;
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

const GATES: readonly ProjectId[] = ["garage", "studio", "campus", "datacentre", "conference", "ipo"];
/** Lots a street, beds a lot by tier. */
const STREET = 6;
const TIER_SLOTS = [2, 5, 12, 30];
/**
 * THE TOWN OPENS A SERVICE for a full street this often, a need at a time —
 * a tier a need, as far as two: a tower wants more than its needs.
 * @see stepTown, NEEDS_FOR
 */
const OPENS_EVERY = 90;
const TOP_TIER = 2;
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
  /**
   * SLOP SPILLED a second, and the vibe coders out mopping it: each tile of
   * sludge, kept wet as fast as it is mopped and dries, wants its crew.
   * @see stepCleanup, dryUp
   */
  let spilling = 0, mopping = 0;
  const away = (): Partial<Record<GeneratorId, number>> => {
    const out: Partial<Record<GeneratorId, number>> = {};
    for (const h of pending) out[h.id] = (out[h.id] ?? 0) + 1;
    if (mopping) out.vibe_coder = Math.min(owned().vibe_coder ?? 0, (out.vibe_coder ?? 0) + mopping);
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
  /**
   * STREETS: lots in sixes, each street served by the services the town
   * opens it, its lots grown to the tier those allow. A service serves about
   * a street of lots. @see world/agents/services
   */
  const streets: Record<GeneratorId, { lots: number; tier: number; wait: number }[]> = { intern: [], vibe_coder: [], "10x_dev": [] };
  const stopProjects = setProjectReader(() => ({
    built, away: away(), commute: { intern: commuteOf("intern"), vibe_coder: commuteOf("vibe_coder"), "10x_dev": commuteOf("10x_dev") },
    labs: { count: labs, mult: 1 + labs * LAB_SHARE * 1.5 },
    racks: { powered: racks * AGENTS_A_RACK, unpowered: 0 },
    needs: needsNow(),
  }));
  /** THE LADDER, as the game climbs it: by headcount, one at a time. @see stepLadder */
  const ladderKey = {}, ladder = startLadder(ladderKey, []);
  const unlockedNeeds = (id: GeneratorId) => NEEDS[id].filter((n) => needOpen(ladderKey, n)).length;
  /** The share of each kind's beds with every need met: streets grown a tier a need, all of them. @see needsShare */
  const needsNow = (): Partial<Record<GeneratorId, number>> => {
    const out: Partial<Record<GeneratorId, number>> = {};
    for (const [id, list] of Object.entries(streets) as [GeneratorId, { lots: number; tier: number }[]][]) {
      let all = 0, met = 0;
      for (const st of list) { const b = st.lots * TIER_SLOTS[st.tier]; all += b; if (st.tier >= NEEDS[id].length) met += b; }
      if (all) out[id] = met / all;
    }
    return out;
  };
  /**
   * MOOD, a street at a time, as the game scores each of its houses: the
   * commute, and its services or the want of them. Weighted by beds, as
   * `moodOffsets` weights by residents. @see moodsOf
   */
  const streetMood = (id: GeneratorId, tier: number) => {
    let m = Math.round((1 - commute) * 10 * MOOD.perTenthLost);
    m += tier > 0 ? tier * NEED_MOOD[id] : wantsAny(ladderKey, id) ? MOOD.unmet : 0;
    return Math.max(-MOOD_LIMIT, Math.min(MOOD_LIMIT, m));
  };
  const moodNow = (): Partial<Record<GeneratorId, number>> => {
    const out: Partial<Record<GeneratorId, number>> = {};
    for (const [id, list] of Object.entries(streets) as [GeneratorId, { lots: number; tier: number }[]][]) {
      let sum = 0, n = 0;
      // SLUDGE on the street nearest the studio while it spills. @see sludgedHouses
      list.forEach((st, k) => { const b = st.lots * TIER_SLOTS[st.tier]; sum += (streetMood(id, st.tier) + (spilling > 0 && id === "vibe_coder" && k === 0 ? MOOD.sludge : 0)) * b; n += b; });
      if (n) out[id] = sum / n;
    }
    return out;
  };
  const stopMood = setTownMoodReader(moodNow);
  // The roster as the gates now see it: no interns before the garage.
  syncUnlockedGenerators();
  useMoneyStore.getState().increaseMoney(getGeneratorCost("intern", 1).toNumber() || 5);

  const slopMode = options.slop ?? "refine";
  setProcessorUse({ refinery: 0, dataplant: 0, contentfarm: 0 });
  const report: MapRunReport = {
    totalSeconds: 0, opened: {}, firstHire: {}, tenth: {},
    spentOnLots: 0, spentOnProjects: 0, spentOnHires: 0, services: 0, unlocks: [], stalledSeconds: 0, lots: 0,
    coreAt: null, offices: 0, spentOnOffices: 0, labs: 0, spentOnLabs: 0, mood: {}, townBonus: 0, income: 0, headcount: [], slopAt: null, seweredAt: null, refineryAt: null, refineries: 0, sewers: 0, spentOnSlop: 0, peakSlop: 0, peakMopping: 0, saleAt: null, milestones: [], endedAt: 0, events: [], agents: 0, racks: 0, firstAgent: null,
  };
  const money = () => useMoneyStore.getState().money.toNumber();
  const spend = (n: number) => { useMoneyStore.getState().spendMoney(n); };

  /**
   * The way to more beds for a kind: a new lot, on the last street, at its
   * tier once it has grown. The town grows a street itself. @see OPENS_EVERY
   */
  const bestBeds = (id: GeneratorId): { kind: "lot"; cost: number; beds: number } => {
    const list = streets[id];
    const last = list[list.length - 1];
    const lotTier = last && last.lots < STREET ? last.tier : 0;
    return { kind: "lot", cost: buildCost(`kit:${id}.t0`)!.toNumber(), beds: TIER_SLOTS[lotTier] };
  };
  /** The town opening services for its full streets, a second of it; each grows every lot on its street a tier. */
  const stepServices = () => {
    for (const [id, list] of Object.entries(streets) as [GeneratorId, (typeof streets)[GeneratorId]][]) {
      let grew = false;
      for (const st of list) {
        // A tier a need, of those its kind has unlocked. @see stepLadder
        if (st.lots < STREET || st.tier >= TOP_TIER || ++st.wait < OPENS_EVERY || unlockedNeeds(id) <= st.tier) continue;
        st.wait = 0; st.tier++; grew = true;
        report.services++;
      }
      if (grew) beds[id] = (id === "intern" ? 2 : 0) + list.reduce((n, st) => n + st.lots * TIER_SLOTS[st.tier], 0);
    }
  };

  /** One second of the town: projects started, worked, supplied and opened; hires arriving. */
  const stepTown = () => {
    const o = owned();
    for (const id of stepLadder(ladder, o, 1)) report.unlocks.push({ id, at: t });
    eventDraw();
    stepServices();
    // SLOP, seen to as a player would: once the vibe coders make it, a sewer
    // from the studio to the water, and then a refinery for it to feed, each
    // paid for as soon as it can be. @see game/slop, game/processors
    // Made at the desks only: those on the map with a desk to sit at. @see stepSlop
    const slop = (o.vibe_coder ?? 0) >= SLOP_FROM ? slopRate() * Math.min(onMap("vibe_coder"), desksOf("vibe_coder")) : 0;
    if (slop > 0) {
      report.slopAt ??= t;
      report.peakSlop = Math.max(report.peakSlop, slop);
    }
    if (slop > 0 && slopMode !== "spill") {
      // A SEWER for each sewer's worth of slop. @see sewerFlow
      const sewer = pipeCost(SIM_SEWER_TILES).toNumber();
      if (report.sewers * sewerFlow() < slop && money() >= sewer) {
        spend(sewer);
        report.spentOnSlop += sewer;
        report.sewers++;
        report.seweredAt ??= t;
      }
      if ((slopMode === "refine" || slopMode === "farm") && report.seweredAt !== null) {
        // THE FIRST by its project; the rest bought while the slop outruns them. @see wantsRefinery
        const kind = slopMode === "farm" ? "contentfarm" : "refinery";
        const price = report.refineries === 0
          ? projectCost(PROJECTS.find((p) => p.id === kind)!, useGeneratorStore.getState().getMoneyPerSecond())
          : buildCost(kind)!.toNumber() * PROCESSOR_STEP ** report.refineries;
        if (slop > report.refineries * PROCESS_RATE && money() >= price) {
          spend(price);
          report.spentOnSlop += price;
          report.refineries++;
          report.refineryAt ??= t;
        }
        // WHAT THEY TAKE, as far as the sewers bring it. @see stepSlop
        const taken = Math.min(slop, report.sewers * sewerFlow(), report.refineries * PROCESS_RATE);
        setProcessorUse({ refinery: 0, dataplant: 0, contentfarm: 0, [kind]: taken / PROCESS_RATE });
      }
    }
    // WHAT THE SEWERS CANNOT CARRY SPILLS, and is mopped. @see stepSlop
    spilling = Math.max(0, slop - (slopMode === "spill" ? 0 : report.sewers * sewerFlow()));
    mopping = Math.ceil(CLEANERS_PER_TILE * (spilling * SPILL_DEPTH) / (CLEANERS_PER_TILE * CLEAN_RATE + DRY_RATE));
    report.peakMopping = Math.max(report.peakMopping, mopping);
    if (report.saleAt === null && t % 60 === 0 && pendingEquity().toNumber() > 0) report.saleAt = t;
    // The upgrades bought: what a gate is met by. @see Gate
    const unlocked = new Set(useUpgradeStore.getState().unlockedUpgradeIds);
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
      if (there && s.stalled <= STALL_GRACE) s.done = Math.min(cultureNow().noMaterialWait ? s.p.work : cap, s.done + crew * cultureNow().buildSpeed);
      if (s.done >= s.p.work - 1e-6 && s.delivered >= s.p.deliveries) {
        built.add(s.p.id);
        report.opened[s.p.id] = t;
        // THE CAMPUS is where the 10x devs live: room for every one hired. @see CAMPUS_BEDS
        if (s.p.id === "campus") beds["10x_dev"] = CAMPUS_BEDS;
        // What it opens, as in the game. @see grantFeatures
        useInnovationStore.getState().grantFeatures(s.p.grants);
        report.milestones.push(t);
        sites.splice(sites.indexOf(s), 1);
        syncUnlockedGenerators();
      }
    }
    for (let k = pending.length - 1; k >= 0; k--) if (pending[k].at <= t) pending.splice(k, 1);
  };

  type Next = { kind: "gen" | "upgrade" | "lot" | "lab" | "office" | "rack"; id: string; cost: number };
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
      else if (hasLots(id)) {
        // No bed: the next of them costs a lot first.
        const way = bestBeds(id);
        consider({ kind: way.kind, id, cost: way.cost });
      }
    }
    return best;
  };

  /**
   * MAP EVENTS, a deterministic draw: none till the company is
   * EVENT_HEADCOUNT strong, the first FIRST_GAP after, then one every GAP —
   * each a kind the model prices, for a company drawn by the same seed, left
   * to its default, and charged at once in seconds of the income then. A
   * cost past the money in hand takes what there is. @see director, event-model
   */
  let seed = 11;
  const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
  // Not a follow-up: those come only after another. @see EventDef.followUp
  const kinds = Object.keys(EVENTS).filter((k) => !EVENT_DEFS[k as EventKind].followUp);
  let nextEvent: number | null = null;
  const eventDraw = () => {
    if (options.events === false) return;
    if (nextEvent === null) {
      const hired = Object.values(owned()).reduce((n, v) => n + (v ?? 0), 0);
      if (hired >= EVENT_HEADCOUNT) nextEvent = t + FIRST_GAP;
      return;
    }
    if (t < nextEvent) return;
    nextEvent = t + GAP[0] + Math.floor(rand() * (GAP[1] - GAP[0]));
    const kind = kinds[Math.floor(rand() * kinds.length)];
    const cost = EVENTS[kind][EVENT_DEFS[kind as EventKind].default](company(rand)) * useGeneratorStore.getState().getMoneyPerSecond();
    if (cost >= 0) spend(Math.min(money(), cost));
    else useMoneyStore.getState().increaseMoney(-cost);
    report.events.push({ kind, at: t, cost: Math.round(cost) });
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
      if (next.kind === "lot") {
        const id = next.id as GeneratorId;
        spend(next.cost);
        report.spentOnLots += next.cost;
        report.lots++;
        const list = streets[id], last = list[list.length - 1];
        if (last && last.lots < STREET) last.lots++;
        else list.push({ lots: 1, tier: 0, wait: 0 });
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
    setProcessorUse({ refinery: 0, dataplant: 0, contentfarm: 0 });
  }
  // The core run's length, as it always was; the late game is extra.
  report.totalSeconds = report.coreAt ?? t;
  report.endedAt = t;
  return report;
}
