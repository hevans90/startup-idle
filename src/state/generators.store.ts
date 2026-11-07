import { create } from "zustand";
import { questIncomeMult } from "../game/quests/effects";
import { agentBonus } from "../game/agents";
import { runningAgents } from "./agents.store";
import { skillOf, training } from "./training.store";
import { ITSELF_BOOST } from "../game/training";

import {
  createJSONStorage,
  persist,
  type StateStorage,
} from "zustand/middleware";
import { roomFor } from "../game/housing";
import { attendance, deskBonus, labBonus, needsBonus, wonderBonus } from "../game/projects";
import { moralePartsNow } from "../game/morale-parts";
import * as culture from "../game/culture";
import { setDeckReader } from "../game/culture-now";
import { cultureEffects, emptyDeck, readDeck, workMorale, type CardId, type CultureEffects, type Deck, type Track } from "../game/culture";
import { cultureNow } from "../game/culture-now";
import { useGenerationStore } from "./generation.store";
import { fusionNow } from "../game/fusion";
import {
  calcGeneratorIncome,
  calcGeneratorPerSecond,
} from "../game/generator-income";
import {
  applyEffectiveSatisfaction,
  computeModifiers,
  type GameModifiers,
} from "../game/modifiers";
import {
  defaultSatisfactionScores,
  SATISFACTION_MAX,
  SATISFACTION_MIN,
  stepSatisfactionScores,
  TO_MORALE,
  satisfactionRevenueMultiplier,
  type SatisfactionScores,
} from "../game/satisfaction";
import { leadersNow } from "../game/leader-economy";
import {
  getGeneratorCost,
  getUnlockedGeneratorIds,
} from "../utils/generator-utils";
import { useAiSingularityStore } from "./ai-singularity.store";
import { useFounderStore } from "./founder.store";
import { getManagementTierTotal, useInnovationStore } from "./innovation.store";
import { useMoneyStore } from "./money.store";
import { usePrestigeStore } from "./prestige.store";
import { useLinkedOutStore } from "./linkedout.store";
import { useTeamLeadersEmployeesStore } from "./team-leaders.store";
import { syncAvailableUpgrades } from "./upgrades.store";
import { setSlopRate, slopPerCoder, slopSpilling } from "../game/slop";
import { isDaytime } from "../world/daylight";
import { contentFarmBonus, refineryBonus } from "../game/processors";
import { useValuationStore } from "./valuation.store";

/**
 * What the agents running add to income: nothing while they train — that is
 * a training run's price — and more for an AI that has studied itself.
 * @see game/training, ITSELF_BOOST
 */
/** The agents' boost: none while they train — but under Autonomous Agents' rule. @see game/culture */
const trainedAgentBonus = () => training() && !cultureNow().trainWhileWorking ? 1 : 1 + (agentBonus(runningAgents()) - 1) * (skillOf("itself") >= 3 ? ITSELF_BOOST : 1);

export type UnlockCondition = {
  requiredId: GeneratorId;
  requiredAmount: number;
};

export type Generator = {
  id: GeneratorId;
  name: string;
  cost: number;
  costExponent: number;
  baseProduction: number;
  interval: number;
  unlockConditions?: UnlockCondition[];
  innovationProduction: number;
};

export type OwnedGenerator = Generator & {
  amount: number; // amount owned
  lastTick: number; // timestamp of last tick
  multiplier: number; // persistent multiplier from upgrades
  costMultiplier: number; // persistent multiplier from upgrades
  innovationMultiplier: number; // persistent multiplier from upgrades
};


export type GeneratorId = "intern" | "vibe_coder" | "10x_dev";

/** Per-hire ratio must stay above 1 or costs tend to 0 at high counts; upgrades clamp to this floor. */
export const MIN_GENERATOR_COST_EXPONENT = 1.02;

type EmployeeManagementData = {
  /** The culture deck: how the company is run, as cards. @see game/culture */
  deck: Deck;
  autoBuyAcc: Partial<Record<GeneratorId, number>>;
};

/** A full, human-readable breakdown of a per-second resource (money / innovation). */
export type ResourceBreakdown = {
  total: number;
  /** Multipliers applied to every employee's output. */
  globals: { label: string; mult: number; modKey?: string }[];
  /** Per-employee-type contribution + its own multipliers. */
  perGenerator: {
    id: GeneratorId;
    name: string;
    amount: number;
    perUnit: number;
    total: number;
    factors: { label: string; mult: number; modKey?: string }[];
  }[];
};

/**
 * Where valuation/sec comes from: a revenue "engine" (a sub-linear function of
 * $/sec) scaled by board/satisfaction/founder multipliers. Not per-generator, so it
 * has its own shape rather than reusing {@link ResourceBreakdown}.
 */
export type ValuationBreakdown = {
  /** Valuation accrued per second (the engine after all multipliers). */
  total: number;
  /** Engine output before the multiplier factors. */
  base: number;
  /** The $/sec feeding the engine. */
  mps: number;
  /** Multipliers applied to the engine (managers / satisfaction / founder). */
  factors: { label: string; mult: number; modKey?: string }[];
};

type GeneratorState = {
  generators: OwnedGenerator[];
  globalLastTick: number;
  purchaseMode: "single" | "max";
  setPurchaseMode: (mode: "single" | "max") => void;

  employeeManagement: EmployeeManagementData;
  satisfactionScores: SatisfactionScores;
  /** A role's satisfaction score after skill-tree keystones (Crunch Mode → 0,
   * Enshittify → positive side scaled). All satisfaction multipliers read this. */
  getEffectiveSatisfaction: (id: GeneratorId) => number;

  _buildModifiers: () => GameModifiers;

  addGenerator: (gen: OwnedGenerator) => void;
  increaseGenerator: (id: string, count?: number) => void;
  tickGenerators: () => void;
  purchaseGenerator: (id: string, amount: number) => void;

  getMoneyPerSecond: () => number;
  /** $/sec for `units` of one generator, with the full multiplier chain. */
  getGeneratorMoneyPerSecond: (id: GeneratorId, units: number) => number;
  /** Full per-employee + global breakdown of $/sec (for the money popover). */
  getMoneyBreakdown: () => ResourceBreakdown;
  getInnovationPerSecond: () => number;
  /** Innovation/sec for `units` of one generator, with the full multiplier chain. */
  getGeneratorInnovationPerSecond: (id: GeneratorId, units: number) => number;
  /** Full per-employee + global breakdown of innovation/sec. */
  getInnovationBreakdown: () => ResourceBreakdown;
  /** Valuation accrued per second (drives the board/mandate economy). */
  getValuationPerSecond: () => number;
  /** Full breakdown of valuation/sec (for the valuation popover). */
  getValuationBreakdown: () => ValuationBreakdown;

  /** What the slotted cards do to a kind, together. @see game/culture */
  getCultureEffects: (id: GeneratorId) => CultureEffects;
  /** Points to spend on slots and ranks: manager tiers not yet spent, once employee management is open. */
  getDeckPoints: () => number;
  /** Take a card from an offer. */
  takeCard: (offer: number, id: CardId) => void;
  /** A hackathon's ideas dealt onto the deck: null with the deck not open, or nothing to give. @see hackathonDeal */
  dealHackathon: () => culture.HackathonGain;
  /** Deal an offer again, for innovation. @see rerollSeconds */
  rerollOffer: (offer: number) => void;
  /** Self-Improving's rule: every card a rank up, from now for `SURGE_SECONDS`. */
  surgeDeck: (now?: number) => void;
  /** Buy a slot, or a card's next rank, with points. */
  buySlot: () => void;
  rankUpCard: (id: CardId) => void;
  /** Put an owned card in a free slot, or take it out. */
  toggleCard: (id: CardId) => void;
  /** Put an owned card in a slot, what was there taken out. */
  placeCard: (id: CardId, at: number) => void;
  getEmployeeOutputMults: (id: GeneratorId) => {
    money: number;
    innovation: number;
  };
  getEmployeeCostMult: (id: GeneratorId) => number;
  getAutoBuyRate: (id: GeneratorId) => number;

  reset: () => void;
};

export const GENERATOR_TYPES: Generator[] = [
  {
    id: "intern",
    name: "intern",
    baseProduction: 1,
    interval: 1000,
    cost: 5,
    costExponent: 1.1,
    innovationProduction: 1e-7,
  },
  {
    id: "vibe_coder",
    name: "vibe coder",
    baseProduction: 5,
    interval: 1000,
    cost: 100,
    costExponent: 1.2,
    unlockConditions: [{ requiredId: "intern", requiredAmount: 10 }],
    innovationProduction: 1e-6,
  },
  {
    id: "10x_dev",
    name: "10x dev",
    baseProduction: 100,
    interval: 1000,
    cost: 1000,
    costExponent: 10,
    unlockConditions: [{ requiredId: "vibe_coder", requiredAmount: 10 }],
    innovationProduction: 1e-3,
  },
];

const GENERATOR_PERSIST_KEY = "generators";
/** Legacy split save; read once for migration into the persist blob. */
const EMPLOYEE_MGMT_STORAGE_KEY = "employeeManagement";
const MAX_CATCH_UP_MS = 7 * 24 * 60 * 60 * 1000;

/** The scale saved scores are on, saved beside them: before it was saved, ±100. @see TO_MORALE */
const MORALE_SCALE = SATISFACTION_MAX;

function clampPersistedScore(n: unknown, scale = 1): number {
  if (typeof n !== "number" || Number.isNaN(n)) return 0;
  return Math.min(SATISFACTION_MAX, Math.max(SATISFACTION_MIN, n * scale));
}

const defaultEmployeeManagement = (): EmployeeManagementData => ({
  deck: emptyDeck(),
  autoBuyAcc: {},
});

const parseEmployeeManagementJson = (
  raw: string | null,
): EmployeeManagementData => {
  if (!raw) return defaultEmployeeManagement();
  try {
    // A save from before the culture deck: its work policies become cards,
    // the tiers that earned their slots points to spend. @see readDeck
    const parsed = JSON.parse(raw) as {
      deck?: unknown;
      policies?: Partial<Record<GeneratorId, unknown[]>>;
      autoBuyAcc?: Partial<Record<GeneratorId, number>>;
    };
    return { deck: readDeck(parsed.deck, parsed.policies), autoBuyAcc: parsed.autoBuyAcc ?? {} };
  } catch {
    return defaultEmployeeManagement();
  }
};

const normalizeEmployeeManagement = (
  value: unknown,
): EmployeeManagementData => {
  if (!value || typeof value !== "object") return defaultEmployeeManagement();
  return parseEmployeeManagementJson(JSON.stringify(value));
};

const reconcileGeneratorsFromSavedArray = (
  savedData: OwnedGenerator[],
): OwnedGenerator[] => {
  const ownedMap = Object.fromEntries(savedData.map((g) => [g.id, g]));
  const unlockedIds = getUnlockedGeneratorIds(savedData);

  return GENERATOR_TYPES.filter((gen) => unlockedIds.includes(gen.id)).map(
    (gen) => {
      const saved = ownedMap[gen.id];
      return {
        ...gen,
        amount: saved?.amount ?? 0,
        multiplier: saved?.multiplier ?? 1,
        costExponent: Math.max(
          MIN_GENERATOR_COST_EXPONENT,
          saved?.costExponent ?? gen.costExponent,
        ),
        costMultiplier: saved?.costMultiplier ?? 1,
        lastTick: saved?.lastTick ?? Date.now(),
        innovationMultiplier: saved?.innovationMultiplier ?? 1,
      } satisfies OwnedGenerator;
    },
  );
};

const readLegacyEmployeeManagementFromStorage = (): EmployeeManagementData => {
  return parseEmployeeManagementJson(
    localStorage.getItem(EMPLOYEE_MGMT_STORAGE_KEY),
  );
};

const generatorStateStorage: StateStorage = {
  getItem: (name) => {
    const raw = localStorage.getItem(name);
    if (!raw) {
      const emOnly = localStorage.getItem(EMPLOYEE_MGMT_STORAGE_KEY);
      if (!emOnly) return null;
      return JSON.stringify({
        state: {
          generators: reconcileGeneratorsFromSavedArray([]),
          employeeManagement: parseEmployeeManagementJson(emOnly),
        },
        version: 0,
      });
    }
    try {
      const parsed: unknown = JSON.parse(raw);
      if (
        parsed &&
        typeof parsed === "object" &&
        "state" in (parsed as object)
      ) {
        return raw;
      }
      if (Array.isArray(parsed)) {
        const em = readLegacyEmployeeManagementFromStorage();
        return JSON.stringify({
          state: {
            generators: reconcileGeneratorsFromSavedArray(
              parsed as OwnedGenerator[],
            ),
            employeeManagement: em,
          },
          version: 0,
        });
      }
    } catch {
      return null;
    }
    return raw;
  },
  setItem: (name, value) => localStorage.setItem(name, value),
  removeItem: (name) => localStorage.removeItem(name),
};

export const syncUnlockedGenerators = (): void => {
  const state = useGeneratorStore.getState();
  const unlockedIds = getUnlockedGeneratorIds(state.generators);
  const byId = new Map(state.generators.map((g) => [g.id, g]));

  // Reconcile the roster to exactly the unlocked set: keep existing entries,
  // add newly-unlocked ones, and DROP any that are no longer buildable (e.g. a
  // founder restriction like the Agentic Delusionist's vibe-coders-only). In
  // normal play unlocks are monotonic so nothing is ever dropped.
  const next: OwnedGenerator[] = unlockedIds.map((id) => {
    const existing = byId.get(id);
    if (existing) return existing;
    const base = GENERATOR_TYPES.find((g) => g.id === id)!;
    return {
      ...base,
      amount: 0,
      multiplier: 1,
      costMultiplier: 1,
      innovationMultiplier: 1,
      lastTick: Date.now(),
    } satisfies OwnedGenerator;
  });

  const unchanged =
    next.length === state.generators.length &&
    next.every((g, i) => g.id === state.generators[i].id);
  if (!unchanged) useGeneratorStore.setState({ generators: next });
};

// ─── tickGenerators helpers ───────────────────────────────────────────────────

function buildAmountsMap(generators: OwnedGenerator[]): Record<GeneratorId, number> {
  const amounts: Record<GeneratorId, number> = { intern: 0, vibe_coder: 0, "10x_dev": 0 };
  for (const g of generators) amounts[g.id] = g.amount;
  return amounts;
}

/** Manager tiers for the deck, points to spend: none until employee management is open. */
function deckTiers(): number {
  // And Company Handbook's points, on top of the managers'. @see HANDBOOK_POINTS
  return useInnovationStore.getState().unlocks.employeeManagement?.unlocked ? getManagementTierTotal() + usePrestigeStore.getState().modifiers.culturePoints : 0;
}
/** Each track's tiers, which pace its offers. @see cardAt */
function trackTiers(): Record<Track, number> {
  const { managers } = useInnovationStore.getState();
  return { agile: managers.agile.tier.floor().toNumber(), corpo: managers.corpo.tier.floor().toNumber(), sales: managers.sales.tier.floor().toNumber() };
}

function tickSatisfaction(
  scores: SatisfactionScores,
  work: Record<GeneratorId, number>,
  seconds: number,
  prestige: { satisfactionGainMult: number },
  led: ReturnType<typeof leadersNow>,
): SatisfactionScores {
  // EVERY PART BUT WORK, which the step adds itself: home, leaders, events,
  // the founder's fused lean. @see moralePartsNow
  const parts = moralePartsNow(work, led);
  const satOffsets = Object.fromEntries(
    Object.entries(parts).map(([id, p]) => [id, p.home + p.leaders + p.events + p.founder]),
  ) as Partial<Record<GeneratorId, number>>;
  const driftMult = 1;
  // Culture Capital mandate: multiplies satisfaction recovery speed.
  const mandateSatGain = useValuationStore.getState().getEconomyMultipliers().satisfactionGain;
  return stepSatisfactionScores(
    scores,
    work,
    seconds * prestige.satisfactionGainMult * driftMult * mandateSatGain,
    satOffsets,
  );
}

function accrueGeneratorIncome(
  gen: OwnedGenerator,
  m: GameModifiers,
  out: { money: number; innovation: number },
  ticks: number,
): void {
  const { money, innovation } = calcGeneratorIncome(gen, m, out, ticks);
  useMoneyStore.getState().increaseMoney(money);
  useInnovationStore.getState().increaseInnovation(innovation);
}

export const useGeneratorStore = create<GeneratorState>()(
  persist(
    (set, get) => {
      const runAutoBuy = (
        em: EmployeeManagementData,
        seconds: number,
      ): EmployeeManagementData => {
        const acc = { ...em.autoBuyAcc };

        for (const gen of get().generators) {
          const rate = get().getAutoBuyRate(gen.id);
          if (rate <= 0 || gen.amount === 0) continue;

          let frac = (acc[gen.id] ?? 0) + rate * seconds;
          const maxIter = 500;
          let iter = 0;
          while (frac >= 1 && iter < maxIter) {
            const cost = getGeneratorCost(gen.id, 1);
            const money = useMoneyStore.getState().money;
            if (money.lt(cost)) break;
            useMoneyStore.getState().spendMoney(cost.toNumber());
            get().increaseGenerator(gen.id, 1);
            frac -= 1;
            iter += 1;
          }
          acc[gen.id] = frac;
        }

        return { ...em, autoBuyAcc: acc };
      };

      /** Seconds Pivot Weekly has been slotted since its last swap. Not saved. */
      let pivotFor = 0;
      /** When Hire Freeze's rule came into force, while it holds. Not saved. @see FREEZE_HALVES */
      let frozeAt: number | null = null;
      /** Hire to Fire's rule: the share of a free vibe coder owed. Not saved. */
      let vibeOwed = 0;
      /** What a kind's hire price is down to under Hire Freeze's rule: halved each so long it holds. */
      const thaw = (on: boolean) => {
        if (!on) { frozeAt = null; return 1; }
        frozeAt ??= Date.now();
        return Math.max(culture.FREEZE_LEAST, 0.5 ** ((Date.now() - frozeAt) / 1000 / culture.FREEZE_HALVES));
      };
      /** Mentorship's rule: what a vibe coder earns a second, before anything, over what an intern does. */
      const payAsVibe = () => {
        const per = (id: GeneratorId) => { const g = GENERATOR_TYPES.find((x) => x.id === id); return g ? g.baseProduction / g.interval : 0; };
        return per("intern") > 0 ? Math.max(1, per("vibe_coder") / per("intern")) : 1;
      };
      const setDeck = (deck: Deck) => {
        if (deck !== get().employeeManagement.deck) set((state) => ({ employeeManagement: { ...state.employeeManagement, deck } }));
      };
      /** Whether a first Ascension is made: the AI families are dealt from then. */
      const ascended = () => useGenerationStore.getState().generation > 1;
      /** The kinds employed: their own cards are dealt from then. */
      const employs = () => new Set(get().generators.filter((g) => g.amount > 0).map((g) => g.id as GeneratorId));

      return {
        purchaseMode: "single",
        generators: reconcileGeneratorsFromSavedArray([]),
        globalLastTick: Date.now(),
        employeeManagement: defaultEmployeeManagement(),
        satisfactionScores: defaultSatisfactionScores(),

        getCultureEffects: (id) => cultureEffects(get().employeeManagement.deck, id),

        getDeckPoints: () => culture.pointsLeft(get().employeeManagement.deck, deckTiers()),

        takeCard: (offer, id) => setDeck(culture.take(get().employeeManagement.deck, offer, id)),
        dealHackathon: () => {
          if (!useInnovationStore.getState().unlocks.employeeManagement?.unlocked) return null;
          const { deck, gain } = culture.hackathonDeal(get().employeeManagement.deck, employs());
          setDeck(deck);
          return gain;
        },

        rerollOffer: (offer) => {
          const d = get().employeeManagement.deck, o = d.offers[offer];
          if (!o) return;
          // A MINUTE'S INNOVATION, doubling each reroll of the offer. @see rerollSeconds
          const price = culture.rerollSeconds(o) * get().getInnovationPerSecond();
          const inv = useInnovationStore.getState();
          if (inv.innovation.lt(price)) return;
          inv.spendInnovation(price);
          setDeck(culture.reroll(d, offer, employs(), Math.random, ascended()));
        },

        surgeDeck: (now = Date.now()) => setDeck({ ...get().employeeManagement.deck, surgeUntil: now + culture.SURGE_SECONDS * 1000 }),

        buySlot: () => setDeck(culture.buySlot(get().employeeManagement.deck, deckTiers())),

        rankUpCard: (id) => setDeck(culture.rankUp(get().employeeManagement.deck, id, deckTiers())),

        toggleCard: (id) => setDeck(culture.toggleSlot(get().employeeManagement.deck, id)),

        placeCard: (id, at) => setDeck(culture.place(get().employeeManagement.deck, id, at)),

        getEmployeeOutputMults: (id) => {
          const e = get().getCultureEffects(id);
          // AWAY BUILDING: a desk with nobody at it makes nothing. One here,
          // so the live tick and every readout agree. @see attendance
          const here = attendance(id, get().generators.find((g) => g.id === id)?.amount ?? 0);
          // AT THEIR DESKS: led by a team leader, a café next door. @see deskShare
          const atDesks = deskBonus(id);
          // AT HOME: every need met near it, up to a quarter faster. @see needsBonus
          const atHome = needsBonus(id);
          // THE CARDS' RULES: Crunch Week's days, the Four-Day Week's happy
          // kinds, Mentorship's pay, and the slop's — clean or spilling. @see Rules
          const rules = {
            money: (e.dayOutput !== 1 && isDaytime(Date.now()) ? e.dayOutput : 1) * (e.earnAsVibe ? payAsVibe() : 1)
              * (get().satisfactionScores[id] > culture.HAPPY_AT ? e.happyAttendance : 1),
            innovation: (get().satisfactionScores[id] > culture.HAPPY_AT ? e.happyAttendance : 1) * (slopSpilling() ? e.messInnovation : e.cleanInnovation),
          };
          // THE DICE: Hallucination's cards, rolled this minute. @see hallucination
          const dice = culture.hallucination(get().employeeManagement.deck, Date.now(), e);
          // AND THE WONDERS standing on the map, its R&D labs, and the AI
          // agents running in its racks. @see wonderBonus, labBonus, agentBonus
          return {
            money: e.output * rules.money * dice.money * here * atDesks * atHome * wonderBonus("money") * trainedAgentBonus() * fusionNow().incomeMult * questIncomeMult(),
            // And the slop refineries, by how busy they are. @see game/processors
            innovation: e.innovation * rules.innovation * dice.innovation * here * atDesks * atHome * wonderBonus("innovation") * labBonus() * refineryBonus(),
          };
        },

        getEmployeeCostMult: (id) => { const e = get().getCultureEffects(id); return e.hireCost * thaw(e.freezeFalls); },

        getEffectiveSatisfaction: (id) => {
          const m = usePrestigeStore.getState().modifiers;
          return applyEffectiveSatisfaction(get().satisfactionScores[id], m);
        },

        getAutoBuyRate: (id) => {
          // Always Be Hiring, and a leader who is Always Recruiting. @see CARDS, LEADER_PERKS
          const leaders = useInnovationStore.getState().unlocks.leaders?.unlocked ? leadersNow(buildAmountsMap(get().generators)).of[id]?.autoBuy ?? 0 : 0;
          const e = get().getCultureEffects(id);
          // Hire Freeze: nobody hired but by hand.
          if (e.noAutoBuy) return 0;
          // And Always Be Hiring's rule: faster the more there are. @see Rules.autoBuyPer
          const rate = e.autoBuy + leaders + e.autoBuyPer * (get().generators.find((g) => g.id === id)?.amount ?? 0);
          if (rate <= 0) return 0;
          // Founder "Operator" + skill-tree automation modifiers.
          return rate * useFounderStore.getState().autoBuyMult * usePrestigeStore.getState().modifiers.autoBuyMult;
        },

        addGenerator: (gen) =>
          set((state) => {
            const exists = state.generators.find((g) => g.id === gen.id);
            if (exists) return {};
            return { generators: [...state.generators, gen] };
          }),

        /**
         * THE HOUSING GATE LIVES HERE, because this is the one door.
         *
         * Both hiring paths end at this function — `purchaseGenerator` for a
         * manual hire, and `runAutoBuy` (through `tickGenerators`) for an
         * automatic one, which is also what offline progress replays. Gating
         * here covers all three at once; gating in `purchaseGenerator` alone
         * would let auto-buy and every absence walk straight past it.
         *
         * IT CLAMPS RATHER THAN REFUSING. Asked for five when there are beds
         * for two, it hires two. A refusal would make auto-buy stall
         * permanently the moment a player asked for more than they had room
         * for, and the honest answer to "hire as many as you can" is "as many
         * as you can". @see roomFor
         */
        increaseGenerator: (id, count = 1) => {
          const gid = id as GeneratorId;
          const owned = get().generators.find((g) => g.id === id)?.amount ?? 0;
          const take = Math.min(count, roomFor(gid, owned));
          if (take <= 0) return;
          set((state) => ({
            generators: state.generators.map((gen) =>
              gen.id === id ? { ...gen, amount: gen.amount + take } : gen,
            ),
          }));
          // HIRE TO FIRE'S RULE: a vibe coder free with every so many interns, a bed allowing. @see Rules.vibePerIntern
          const free = gid === "intern" ? get().getCultureEffects("intern").vibePerIntern : 0;
          if (free > 0) {
            vibeOwed += take * free;
            const n = Math.floor(vibeOwed);
            vibeOwed -= n;
            if (n > 0) get().increaseGenerator("vibe_coder", n);
          }
        },

        _buildModifiers: (): GameModifiers => {
          const generators = get().generators;
          const totalEmployees = generators.reduce((n, g) => n + g.amount, 0);
          const emUnlocked =
            useInnovationStore.getState().unlocks.employeeManagement
              ?.unlocked ?? false;
          return computeModifiers({
            totalEmployees,
            emUnlocked,
            rawScores: get().satisfactionScores,
            owned: buildAmountsMap(generators),
          });
        },

        tickGenerators: () => {
          const now = Date.now();
          const rawInterval = now - get().globalLastTick;
          const globalTickInterval = Math.min(rawInterval, MAX_CATCH_UP_MS);
          if (globalTickInterval < 1000) return;

          const seconds = globalTickInterval / 1000;
          const prestige = usePrestigeStore.getState().modifiers;
          // Raw satisfaction evolves normally; Crunch Mode / Enshittify keystones
          // are applied at read time via getEffectiveSatisfaction.
          const emUnlocked =
            useInnovationStore.getState().unlocks.employeeManagement?.unlocked ?? false;
          const amounts = buildAmountsMap(get().generators);

          // ── 1. Team leaders + satisfaction ───────────────────────────────────
          // Compute the new satisfaction scores as a local variable; we pass
          // them directly to computeModifiers below so the modifier snapshot
          // already reflects the updated scores without an intermediate set().
          // LEADERS work once the Talent Agency has opened them, ranking up
          // from their teams' work; morale is felt from the start. @see game/leaders
          const tlStore = useTeamLeadersEmployeesStore.getState();
          const leadersOpen = useInnovationStore.getState().unlocks.leaders?.unlocked ?? false;
          const outputAt = (id: GeneratorId) => satisfactionRevenueMultiplier(applyEffectiveSatisfaction(get().satisfactionScores[id], prestige));
          const led = leadersOpen ? leadersNow(amounts, outputAt) : { of: {}, everyone: 0 };
          if (leadersOpen) {
            tlStore.tickTeamLeaders(seconds, (l) => led.of[l.role]?.xpPerSecond ?? 0);
            // LINKEDOUT: applicants coming and going, and the company's
            // morale remembered for its reputation. @see useLinkedOutStore
            const kinds = get().generators.filter((g) => g.amount > 0);
            const avg = kinds.length ? kinds.reduce((n, g) => n + get().satisfactionScores[g.id], 0) / kinds.length : 0;
            useLinkedOutStore.getState().tick(now, seconds, avg);
          }
          const satisfactionScores = tickSatisfaction(
            get().satisfactionScores,
            workMorale(get().employeeManagement.deck),
            seconds,
            prestige,
            led,
          );

          // ── 2. Build full modifier snapshot ──────────────────────────────────
          // Use the freshly computed satisfaction scores so the snapshot is
          // consistent even though we haven't committed them to state yet.
          const totalEmployees = get().generators.reduce((n, g) => n + g.amount, 0);
          const m = computeModifiers({ totalEmployees, emUnlocked, rawScores: satisfactionScores, owned: amounts });

          // ── 3. AI singularity: the agents running push it. @see singularityRate
          useAiSingularityStore.getState().tick(seconds);

          // ── 4. Income accrual (side effects only) ────────────────────────────
          // SLOP, made by each vibe coder at a desk, for the map's tanks to fill by.
          // Happy vibe coders ship cleaner; miserable ones rage-ship. @see vibeSlopMultiplier
          // And their cards: Hackathon Culture ships faster, and dirtier. @see CARDS
          setSlopRate(slopPerCoder(amounts.vibe_coder, m.effectiveScores.vibe_coder ?? 0, get().getCultureEffects("vibe_coder").slop));

          // Track which gens fire this tick; stamp lastTick after auto-buy so
          // increaseGenerator's set() calls are not overwritten by ours.
          const firingGenIds = new Set<string>();
          for (const gen of get().generators) {
            if (gen.amount === 0) continue;
            const ticks = Math.floor(globalTickInterval / gen.interval);
            if (ticks === 0) continue;
            firingGenIds.add(gen.id);
            accrueGeneratorIncome(gen, m, get().getEmployeeOutputMults(gen.id), ticks);
          }

          // ── 5. Auto-buy ───────────────────────────────────────────────────────
          // runAutoBuy calls increaseGenerator (its own set() calls) — must run
          // before we read generators for the lastTick stamp below.
          const em = runAutoBuy(get().employeeManagement, seconds);
          // ── 6. Offers: each track whose tiers have reached its next card deals one. @see deal
          let employeeManagement = emUnlocked ? { ...em, deck: culture.deal(em.deck, trackTiers(), employs(), Math.random, ascended()) } : em;
          // Self-Improving's surge, over. @see surgeDeck
          if (employeeManagement.deck.surgeUntil && now >= employeeManagement.deck.surgeUntil) {
            employeeManagement = { ...employeeManagement, deck: { ...employeeManagement.deck, surgeUntil: null } };
          }
          // ── 7. Pivot Weekly: another slotted card swapped for one out. @see PIVOT_SECONDS
          if (get().getCultureEffects("intern").pivot) {
            pivotFor += seconds;
            if (pivotFor >= culture.PIVOT_SECONDS) {
              pivotFor = 0;
              employeeManagement = { ...employeeManagement, deck: culture.pivot(employeeManagement.deck) };
            }
          } else pivotFor = 0;

          // ── Commit all four mutations in a single set() call ─────────────────
          // Read generators NOW (after auto-buy) so purchased units are preserved.
          const generators = get().generators.map((gen) =>
            firingGenIds.has(gen.id) ? { ...gen, lastTick: now } : gen,
          );
          set({ globalLastTick: now, satisfactionScores, generators, employeeManagement });

          syncUnlockedGenerators();
          syncAvailableUpgrades();

          // ── 6. Valuation accrual ──────────────────────────────────────────────
          // getValuationPerSecond() is the single source of truth — includes all
          // active multipliers so the toolbar always matches actual accrual.
          const valuationGain = get().getValuationPerSecond() * seconds;
          if (valuationGain > 0) useValuationStore.getState().increaseValuation(valuationGain);

        },

        purchaseGenerator: (id: string, amount = 1) => {
          // BEDS BEFORE MONEY, and this order is the whole point. The clamp in
          // `increaseGenerator` keeps the count honest, but this function
          // charges FIRST and increases after — so without this check a player
          // at capacity would pay full price for employees who never arrive.
          // @see increaseGenerator
          const owned = get().generators.find((g) => g.id === id)?.amount ?? 0;
          if (roomFor(id as GeneratorId, owned) < amount) return;

          const cost = getGeneratorCost(id, amount);
          const moneyState = useMoneyStore.getState();

          if (moneyState.money.gte(cost)) {
            moneyState.spendMoney(cost.toNumber());
            get().increaseGenerator(id, amount);
            syncUnlockedGenerators();
            syncAvailableUpgrades();
          }
        },

        getGeneratorMoneyPerSecond: (id, units) => {
          const gen = get().generators.find((g) => g.id === id);
          if (!gen || units <= 0) return 0;
          const m = get()._buildModifiers();
          const out = get().getEmployeeOutputMults(id);
          return calcGeneratorPerSecond(gen, m, out, units).money;
        },
        // Sum each generator's full-chain output (single source of truth: the
        // employee-tab popovers and this getter stay in lockstep).
        getMoneyPerSecond: () =>
          get().generators.reduce(
            (sum, gen) =>
              sum + get().getGeneratorMoneyPerSecond(gen.id, gen.amount),
            0,
          ),

        getMoneyBreakdown: () => {
          const m = get()._buildModifiers();

          const globals = [
            {
              label: "Innovation's boost",
              mult: m.innovationCurve,
              modKey: "innovationCurve",
            },
            { label: "Managers", mult: m.managerMoney, modKey: "managerMoney" },
            {
              label: "Board mandates",
              mult: m.mandateMoney,
              modKey: "mandateMoney",
            },
            { label: "Vape juice", mult: m.juiceMoney, modKey: "juiceMoney" },
            {
              label: "Per employee",
              mult: m.headcountMoney,
              modKey: "headcountMoney",
            },
            {
              label: "Skill tree",
              mult: m.prestigeMoney * m.prestigeEmployeeOutput,
              modKey: "skillTreeMoney",
            },
          ];

          const perGenerator = get()
            .generators.filter((g) => g.amount > 0)
            .map((gen) => {
              const out = get().getEmployeeOutputMults(gen.id);
              return {
                id: gen.id,
                name: gen.name,
                amount: gen.amount,
                perUnit: get().getGeneratorMoneyPerSecond(gen.id, 1),
                total: get().getGeneratorMoneyPerSecond(gen.id, gen.amount),
                factors: [
                  { label: "upgrades", mult: gen.multiplier },
                  { label: "policies, the map", mult: out.money },
                  {
                    label: "morale",
                    mult: m.satisfactionRevenue[gen.id] ?? 1,
                    modKey: `satisfactionRevenue.${gen.id}`,
                  },
                  { label: "leader", mult: m.teamLeaderEmpRoleRevenue[gen.id] ?? 1, modKey: `leader.${gen.id}` },
                  { label: "founder", mult: m.founderMoney[gen.id] ?? 1 },
                ],
              };
            });

          return { total: get().getMoneyPerSecond(), globals, perGenerator };
        },

        getGeneratorInnovationPerSecond: (id, units) => {
          const gen = get().generators.find((g) => g.id === id);
          if (!gen || units <= 0) return 0;
          const m = get()._buildModifiers();
          const out = get().getEmployeeOutputMults(id);
          return calcGeneratorPerSecond(gen, m, out, units).innovation;
        },
        getInnovationPerSecond: () =>
          get().generators.reduce(
            (sum, gen) =>
              sum + get().getGeneratorInnovationPerSecond(gen.id, gen.amount),
            0,
          ),

        getInnovationBreakdown: () => {
          const m = get()._buildModifiers();

          const globals = [
            {
              label: "Innovation's boost",
              mult: m.innovationCurve,
              modKey: "innovationCurve",
            },
            {
              label: "Managers",
              mult: m.managerInnovation,
              modKey: "managerInnovation",
            },
            {
              label: "Board mandates",
              mult: m.mandateInnovation,
              modKey: "mandateInnovation",
            },
            {
              label: "Vape juice",
              mult: m.juiceInnovation,
              modKey: "juiceInnovation",
            },
            {
              label: "Intern morale",
              mult: m.internIpsMult,
              modKey: "internIpsMult",
            },
            {
              label: "Skill tree",
              mult: m.prestigeInnovation * m.prestigeEmployeeOutput,
              modKey: "skillTreeInnovation",
            },
          ];

          const perGenerator = get()
            .generators.filter((g) => g.amount > 0)
            .map((gen) => {
              const out = get().getEmployeeOutputMults(gen.id);
              return {
                id: gen.id,
                name: gen.name,
                amount: gen.amount,
                perUnit: get().getGeneratorInnovationPerSecond(gen.id, 1),
                total: get().getGeneratorInnovationPerSecond(
                  gen.id,
                  gen.amount,
                ),
                factors: [
                  { label: "upgrades", mult: gen.innovationMultiplier },
                  { label: "policies, the map", mult: out.innovation },
                  { label: "leader", mult: m.teamLeaderEmpRoleIps[gen.id] ?? 1, modKey: `leader.${gen.id}` },
                  {
                    label: "founder",
                    mult: m.founderInnovation[gen.id] ?? 1,
                  },
                ],
              };
            });

          return {
            total: get().getInnovationPerSecond(),
            globals,
            perGenerator,
          };
        },

        getValuationBreakdown: () => {
          const mps = get().getMoneyPerSecond();
          const m = get()._buildModifiers();

          // Mirror of the accrual in tickGenerators: a sub-linear function of $/sec,
          // scaled by board (sales), intern satisfaction, founder, and skill-tree modifiers.
          const base = Math.pow(Math.max(1, mps), 0.38) * 1e-4;
          const factors = [
            {
              label: "Sales managers",
              mult: m.managerSalesValuation,
              modKey: "managerSalesValuation",
            },
            {
              label: "Founder",
              mult: m.founderValuation,
              modKey: "founderValuation",
            },
            {
              label: "Skill tree",
              mult: m.prestigeValuation,
              modKey: "prestigeValuation",
            },
            {
              label: "Vape shop",
              mult: m.juiceValuation,
              modKey: "juiceValuation",
            },
            // The wonders on the map. @see wonderBonus
            { label: "Wonders", mult: wonderBonus("valuation") },
            // The content farms, by how busy they are. @see game/processors
            { label: "Content farms", mult: contentFarmBonus() },
          ];
          const total = factors.reduce((acc, f) => acc * f.mult, base);
          return { total, base, mps, factors };
        },
        getValuationPerSecond: () => get().getValuationBreakdown().total,

        setPurchaseMode: (purchaseMode) => set({ purchaseMode }),

        reset: () => {
          localStorage.removeItem(EMPLOYEE_MGMT_STORAGE_KEY);
          useGeneratorStore.persist.clearStorage();
          useTeamLeadersEmployeesStore.getState().reset();
          set({
            generators: reconcileGeneratorsFromSavedArray([]),
            globalLastTick: Date.now(),
            employeeManagement: defaultEmployeeManagement(),
            satisfactionScores: defaultSatisfactionScores(),
          });
        },
      };
    },
    {
      name: GENERATOR_PERSIST_KEY,
      storage: createJSONStorage(() => generatorStateStorage),
      partialize: (state) => ({
        generators: state.generators,
        employeeManagement: state.employeeManagement,
        satisfactionScores: state.satisfactionScores,
        moraleScale: MORALE_SCALE,
      }),
      merge: (persisted, current) => {
        const p = persisted as Partial<{
          generators: OwnedGenerator[];
          employeeManagement: EmployeeManagementData;
          satisfactionScores: SatisfactionScores;
          moraleScale: number;
        }> | null;
        if (!p) return current;
        // A save from before Morale: its scores on ±100, brought to ±40.
        const scale = p.moraleScale === MORALE_SCALE ? 1 : TO_MORALE;
        const mergedScores = p.satisfactionScores
          ? {
              intern: clampPersistedScore(p.satisfactionScores.intern, scale),
              vibe_coder: clampPersistedScore(p.satisfactionScores.vibe_coder, scale),
              "10x_dev": clampPersistedScore(p.satisfactionScores["10x_dev"], scale),
            }
          : current.satisfactionScores;
        return {
          ...current,
          generators: p.generators
            ? reconcileGeneratorsFromSavedArray(p.generators)
            : current.generators,
          employeeManagement: p.employeeManagement
            ? normalizeEmployeeManagement(p.employeeManagement)
            : current.employeeManagement,
          satisfactionScores: mergedScores,
        };
      },
    },
  ),
);

// Re-sync the buildable roster whenever the chosen founder changes (e.g. the
// Agentic Delusionist restricting it to vibe coders, or a reset clearing it).
// One-directional dependency (generators → founder) avoids an import cycle.
useFounderStore.subscribe(() => syncUnlockedGenerators());

// The map's systems read the deck from here. @see cultureNow
setDeckReader(() => useGeneratorStore.getState().employeeManagement.deck);

// THE JOURNAL: every card offered or owned, the moment it is. @see GenerationState.discovered
const discoverFrom = (d: Deck) => useGenerationStore.getState().discover([...(Object.keys(d.ranks) as CardId[]), ...d.offers.flatMap((o) => o.cards)]);
discoverFrom(useGeneratorStore.getState().employeeManagement.deck);
useGeneratorStore.subscribe((s, prev) => {
  if (s.employeeManagement.deck !== prev.employeeManagement.deck) discoverFrom(s.employeeManagement.deck);
});
