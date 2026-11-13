/**
 * A COMPANY PLAYED ON A REAL MAP WITH NO SCREEN: a generated map, the
 * economy ticking, the town's own rules stepped as the scene steps them —
 * people arriving and moving about, houses growing, the town opening its
 * shops, projects going up — and whoever is driving given each frame to act
 * in. What the balance sim (`simulate-map-run`) models as an abstract town,
 * this plays on the grid: it is how AI mode is held to "plays a whole run".
 * @see stepPeople, stepGrowth, stepSites, plans/ai-mode-rebuild.md phase 0
 *
 * NOT STEPPED YET, each the scene's still: the water and its pipes (the
 * river stands as it was generated; nothing drinks, nothing spills), the
 * boats and what ports are paid, the events, repairs. A port built here
 * earns nothing and a Data Centre is never short of water.
 */
import { canAcquire, setTownBonusReader } from "../game/acquisition";
import { foundingRemoteBeds, housedBy, residentsIn, setHousingReader } from "../game/housing";
import { setProjectReader, type ProjectId } from "../game/projects";
import { setTermReader } from "../game/term-sheets";
import { setTownMoodReader } from "../game/town-mood";
import { markWorldGone, markWorldReady } from "../game/world-ready";
import { useFounderStore } from "../state/founder.store";
import { useGeneratorStore, type GeneratorId } from "../state/generators.store";
import { useInnovationStore } from "../state/innovation.store";
import { useMoneyStore } from "../state/money.store";
import { useSessionStore } from "../state/session.store";
import { useUpgradeStore } from "../state/upgrades.store";
import { getNetwork, useWorldStore } from "../state/world.store";
import type { Unrest } from "../world/agents/mood";
import type { Grid } from "../world/grid";
import { bedsReading, foundPlayedProjects, projectReader, termReading, townMoodReading } from "../world/play-wiring";
import { townBonusOf } from "../world/projects/town-worth";
import { builtProjects } from "../world/projects/works";
import { isPaved } from "../world/roads/mask";
import { stepGrowth, stepPeople, stepSites, type WorksSeen } from "../world/step-world";
import { resetAllGameStores } from "./reset-game-stores";
import { advanceGameplayOneSecond } from "./run-sim";

/** The town's movers take a twentieth of a second a step and no more. @see stepTown */
export const FRAMES_A_SECOND = 20;

export type PilotRunOptions = {
  seed: number;
  size?: number;
  founder?: string;
  /** Game minutes to play, at most. */
  minutes: number;
  /** Money on top of what the founder starts with. */
  money?: number;
  /** Once, the company founded and its map in hand: switch the driver on. */
  begin?: (g: Grid) => void;
  /** Each frame, after the town has moved and before it grows: the driver's turn. */
  drive: (g: Grid, dt: number, now: number) => void;
  /** What the driver has done so far, as a count, and in words: for the waits and the timeline. */
  steps: () => number;
  said: () => string | null;
  /** Stop as soon as the company could be sold. */
  untilSale?: boolean;
};

export type PilotRunReport = {
  seed: number;
  size: number;
  /** Game seconds played. */
  seconds: number;
  /** When the company could first be sold, game seconds; undefined if never. */
  saleAt?: number;
  /** When each kind was first hired, and how many there are at the end. */
  firstHire: Partial<Record<GeneratorId, number>>;
  staff: Partial<Record<GeneratorId, number>>;
  /** When each project stood finished. */
  opened: Partial<Record<ProjectId, number>>;
  upgrades: { bought: number; of: number };
  lots: number;
  residents: number;
  paved: number;
  money: number;
  income: number;
  steps: number;
  /** The longest the driver went without doing anything, game seconds, and when it began. */
  longestWait: { seconds: number; from: number };
  /** Every wait of a minute or more: when, how long, the money then, and what it had last done. */
  waits: { from: number; seconds: number; money: number; after: string | null }[];
  /** What it did, in its own words, each the first time it said it and when. */
  timeline: { at: number; did: string }[];
};

/** Play a company on a generated map, the driver acting each frame. Fake timers must be on. */
export function playCompany(advanceTimersByTime: (ms: number) => void, o: PilotRunOptions): PilotRunReport {
  resetAllGameStores();
  useFounderStore.getState().chooseFounder(o.founder ?? "model");
  const at0 = Date.now();
  useGeneratorStore.setState({ globalLastTick: at0 });
  useInnovationStore.setState({ globalLastTick: at0 });
  const size = o.size ?? 64;
  useWorldStore.getState().generateWorld(o.seed, size);

  // THE MAP TOLD TO THE ECONOMY, as the canvas tells it while a map is shown. @see WorldCanvas
  const owned0: Record<string, number> = {};
  for (const g of useGeneratorStore.getState().generators) owned0[g.id] = g.amount;
  useSessionStore.getState().setRemoteBeds(foundingRemoteBeds(owned0));
  const unwire = [
    setHousingReader(() => bedsReading(true)),
    setTownMoodReader(townMoodReading),
    setTownBonusReader(() => townBonusOf(useWorldStore.getState().grid)),
    setTermReader(termReading),
  ];
  useWorldStore.getState().setPlaying(true);
  foundPlayedProjects();
  unwire.push(setProjectReader(projectReader()));
  markWorldReady();
  if (o.money) useMoneyStore.getState().increaseMoney(o.money);

  const g = useWorldStore.getState().grid;
  o.begin?.(g);
  const unrest: Unrest = new Map(), seen: WorksSeen = { rev: 0 };
  const dt = 1 / FRAMES_A_SECOND;
  const report: PilotRunReport = {
    seed: o.seed, size, seconds: 0, firstHire: {}, staff: {}, opened: {}, upgrades: { bought: 0, of: 0 },
    lots: 0, residents: 0, paved: 0, money: 0, income: 0, steps: 0, longestWait: { seconds: 0, from: 0 }, waits: [], timeline: [],
  };
  let lastSteps = o.steps(), waitFrom = 0, lastSaid: string | null = null;
  const said = new Set<string>();
  const endWait = (t: number) => {
    const waited = t - waitFrom;
    if (waited > report.longestWait.seconds) report.longestWait = { seconds: waited, from: waitFrom };
    if (waited >= 60) report.waits.push({ from: waitFrom, seconds: waited, money: Math.round(useMoneyStore.getState().money.toNumber()), after: lastSaid });
  };
  try {
    for (let t = 0; t < o.minutes * 60; t++) {
      advanceGameplayOneSecond(advanceTimersByTime);
      for (let f = 0; f < FRAMES_A_SECOND; f++) {
        const net = getNetwork(), st = useWorldStore.getState();
        if (!net) break;
        stepPeople(g, net, st.revision, dt, true);
        o.drive(g, dt, Date.now());
        stepGrowth(g, net, unrest, dt);
        stepSites(g, net, seen, dt, true);
      }
      report.seconds = t + 1;
      // WHAT HAPPENED this second.
      const steps = o.steps();
      if (steps !== lastSteps) {
        endWait(t);
        waitFrom = t + 1; lastSteps = steps;
        const now = o.said();
        lastSaid = now;
        // Each kind of thing once: "12 interns hired" and "3 interns hired" are one.
        const key = now?.replace(/[\d,.]+/g, "N") ?? "";
        if (now && !said.has(key)) { said.add(key); report.timeline.push({ at: t + 1, did: now }); }
      }
      for (const gen of useGeneratorStore.getState().generators) if (gen.amount > 0) report.firstHire[gen.id as GeneratorId] ??= t + 1;
      for (const id of builtProjects(g)) report.opened[id] ??= t + 1;
      if (report.saleAt === undefined && canAcquire()) { report.saleAt = t + 1; if (o.untilSale) break; }
    }
    endWait(report.seconds);
  } finally {
    // What it stood at, read while the map is still told to the economy.
    for (const gen of useGeneratorStore.getState().generators) report.staff[gen.id as GeneratorId] = gen.amount;
    const ups = useUpgradeStore.getState();
    report.upgrades = { bought: ups.unlockedUpgradeIds.length, of: ups.unlockedUpgradeIds.length + ups.availableUpgrades.length };
    for (const s of g.structures.values()) if (!s.build && housedBy(s.def)) { report.lots++; report.residents += residentsIn(s); }
    for (let y = 0; y < g.h; y++) for (let x = 0; x < g.w; x++) if (isPaved(g, x, y)) report.paved++;
    report.money = Math.round(useMoneyStore.getState().money.toNumber());
    report.income = Math.round(useGeneratorStore.getState().getMoneyPerSecond() * 10) / 10;
    report.steps = o.steps();
    markWorldGone();
    for (const off of unwire.reverse()) off();
    useWorldStore.getState().setPlaying(false);
  }
  return report;
}
