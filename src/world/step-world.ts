/**
 * World v2 — THE TOWN'S RULES, A FRAME AT A TIME, with nothing drawn: who
 * moves about and who arrives, how the houses feel and grow, what the town
 * opens, and the projects going up. The scene calls these from its tick, in
 * its order, and draws what they changed; a simulation calls the same three
 * with no scene at all — which is the point: a company can be played from an
 * empty map to its sale without a renderer, by the rules the game plays by.
 * @see WorldScene, simulation/pilot-run, plans/ai-mode-rebuild.md phase 0
 *
 * What is NOT here, and stays the scene's for now: the water's own flow
 * (the scene has a device to solve it on), the boats, the events and what
 * they do to the map, repairs and cooling.
 */
import { pumpUpkeep } from "../game/cooling";
import { slopRate } from "../game/slop";
import { section } from "../hitches";
import { useGeneratorStore } from "../state/generators.store";
import { useMoneyStore } from "../state/money.store";
import { getArrivals, getEvolution, getExports, getFleet, getNetwork, getTown, getTownServices, getTraffic, getWorks, aiRules, useWorldStore } from "../state/world.store";
import { useSessionStore } from "../state/session.store";
import type { GeneratorId } from "../state/generators.store";
import { stepArrivals } from "./agents/arrivals";
import { liveSeating } from "./agents/commute";
import { liveBeauty } from "./agents/beauty";
import { PORT_LORRY_COLOUR } from "./agents/cars/fleet";
import { createEmergency, stepEmergency } from "./agents/emergency";
import { liveMoods, stepMood, type Unrest } from "./agents/mood";
import { liveCoverage, stepEvolution, townChanged } from "./agents/services";
import { sendOnJob, stepTown, type Mover } from "./agents/town";
import { stepTown as stepTownServices, type TownEvent } from "./agents/town-services";
import { ladderOf, stepLadder } from "./agents/unlocks";
import { classOf } from "./boats/classes";
import { perMinute, recordCall } from "./boats/exports";
import { fitting } from "./boats/fittings";
import { stepFleet } from "./boats/fleet";
import { BARGE_COST, BARGE_HOLDS, bargeLoad, bargeTakes } from "./boats/slop-loader";
import { creditTrade, stepTrade } from "./boats/trade";
import { stepTraffic, trafficSteer } from "./boats/traffic";
import { stepYards } from "./boats/yard";
import { CONVOY_PAYS, convoyPays } from "./events/convoy";
import { ROUTE_BONUS } from "./events/defs/convoy";
import { portShut } from "./events/flood";
import { tallyCall } from "./events/town-events";
import { portCallFee } from "../game/build-cost";
import { damagedNow } from "./events/damage";
import type { Grid } from "./grid";
import { announceOpened, ownedNow, payForLoad } from "./projects/economy";
import { stepPipes } from "./pipes/tick";
import { stepWorks } from "./projects/works";
import type { Network } from "./roads/network";
import { structureDef } from "./structures/def";
import { validatePlacement } from "./structures/place";
import { keepsPorts, portTileSet } from "./water/ports";
import { runSources, type WaterField } from "./water/field";
import { stepPollution } from "./water/pollution";

type Owned = Partial<Record<GeneratorId, number>>;

/** Pump houses paid from the company's money, a second's upkeep at a time. @see pumpUpkeep */
const PAID_PUMPS = {
  pay: (seconds: number) => {
    const cost = pumpUpkeep(useGeneratorStore.getState().getMoneyPerSecond()) * seconds;
    const money = useMoneyStore.getState();
    if (money.money.lt(cost)) return false;
    money.spendMoney(cost);
    return true;
  },
};

/**
 * WHAT GOES INTO THE WATER AND THROUGH THE PIPES, before the water itself is
 * stepped: the springs; EVERY PIPE, in one call — the water mains solved and
 * delivered, and in the game the slop, made by who sits at the vibe
 * workplaces' desks, drained by the sewers, spilled when a tank is full, with
 * pumps and lift stations paid for while they run; and the slop in the water,
 * carried and diluted by it. The caller steps the water after: the scene on
 * its device, a simulation with `stepWater`. @see stepPipes, stepPollution
 */
export function stepPlumbing(g: Grid, field: WaterField, dt: number, playing: boolean, springs = true): void {
  // (A simulation that steps the water's flow less often than its pipes runs the springs only when it does.)
  if (springs) runSources(field, g, dt);
  const roads = getNetwork();
  stepPipes(g, field, dt, {
    pumps: playing ? PAID_PUMPS : undefined,
    slop: playing && roads ? { desks: liveSeating(g, roads).desks, perCoder: slopRate() } : null,
  });
  stepPollution(field, dt);
}

/**
 * THE TOWN MOVING: cars and people on their trips, the emergency services to
 * what is damaged, and — in the game — new hires arriving from the edge of
 * the map to a lot with room, and moving in. `fake` is development's: people
 * to send for that nobody has hired.
 */
export function stepPeople(g: Grid, net: Network, revision: number, dt: number, playing: boolean, fake?: Owned): void {
  { const e = section("tick: stepTown"); stepTown(getTown(), g, net, revision, dt); e(); }
  // THE EMERGENCY SERVICES, to what the disasters have damaged. @see world/agents/emergency
  { const town = getTown(); stepEmergency(town.emergency ??= createEmergency(), town, g, damagedNow(), dt); }
  // NEW HIRES ARRIVING, in the game: by bus, car or limousine from the edge of
  // the map to a lot with room, and moving in. Before the works, which clears
  // who arrived. @see world/agents/arrivals
  if (playing || fake) {
    const arrivals = getArrivals();
    const owned = ownedNow();
    for (const [id, n] of Object.entries(fake ?? {})) owned[id as keyof typeof owned] = (owned[id as keyof typeof owned] ?? 0) + (n ?? 0);
    { const e = section("tick: arrivals"); stepArrivals(arrivals, g, net, getTown(), owned, fake ? {} : useSessionStore.getState().remoteBeds ?? {}, dt); e(); }
    if (arrivals.moved.length) useWorldStore.getState().housingMoved(arrivals.moved.splice(0));
  }
}

/**
 * THE TOWN EVOLVING, in the game: people leaving miserable houses; houses
 * growing where their needs are met, and declining when they lose them; and
 * the town opening what its people need, and closing what nobody does. What
 * it opened and closed, for whoever shows it.
 */
export function stepGrowth(g: Grid, net: Network, unrest: Unrest, dt: number): TownEvent[] {
  // PEOPLE LEAVING MISERABLE HOUSES, one now and then. @see stepMood
  const left = stepMood(unrest, g, liveMoods(g, net), dt);
  if (left.length) useWorldStore.getState().housingMoved(left);
  // WHAT IT KNOWS HOW TO OPEN, by its headcount, one at a time. @see stepLadder
  const ladder = ladderOf(g);
  if (ladder && stepLadder(ladder, ownedNow(), dt).length) townChanged();
  const cover = liveCoverage(g, net);
  // THE FINEST STREETS, out for a stroll. @see Town.strollers
  let strollers = 0;
  for (const level of liveBeauty(g, net).home.values()) if (level >= 3) strollers++;
  getTown().strollers = strollers;
  const grew = stepEvolution(getEvolution(), g, liveMoods(g, net), cover, dt);
  if (grew.length) useWorldStore.getState().housingMoved(grew);
  const ws = useWorldStore.getState();
  const changed = stepTownServices(getTownServices(), g, net, cover, dt, {
    // And never over a building's port: a shop on the tile an office's slop comes out at, and it spills for good. @see keepsPorts
    canPlace: (def, x, y) => { const d = structureDef(def); return !!d && validatePlacement(g, d, x, y, aiRules(g)).ok && keepsPorts(g, portsNow(g), def, x, y, d.footprint.w, d.footprint.h); },
    place: ws.townPlace, clear: ws.townClear, rand: Math.random,
  });
  if (changed.length) ws.housingMoved(changed.map((e) => e.structure));
  return changed;
}

/** What the works last told the store, so it is told again only when they change. */
export type WorksSeen = { rev: number };

/**
 * THE PORTS' YARDS AND THE PROJECTS GOING UP: a lorry from each port's door to
 * where its road leaves the map, one on the road a port; and the sites —
 * crews walking out, loads trucked in, work done — paid for out of the
 * company's money under the game's rules, free in the editor, which must
 * never spend anybody's. `lorrySent` is the scene's, for what it shows of one
 * setting off.
 */
export function stepSites(g: Grid, net: Network, seen: WorksSeen, dt: number, playing: boolean, lorrySent?: (lorry: Mover, port: number) => void): void {
  const works = getWorks(), town = getTown();
  stepYards(getTraffic().yards, dt, (port) => {
    const door = town.places.find((pl) => pl.kind === "door" && pl.structure === port);
    const out = door && town.places.find((pl) => pl.kind === "gateway" && pl.net === door.net);
    if (!door || !out) return "none";
    if (town.movers.some((m) => m.job?.role === "freight" && m.job.site === port)) return "busy";
    const lorry = sendOnJob(town, g, "truck", door, out, { site: port, role: "freight" });
    if (lorry) {
      lorry.colour = PORT_LORRY_COLOUR;
      lorrySent?.(lorry, port);
    }
    return lorry ? "sent" : "busy";
  });
  // THE ROADS BEING BUILT, a frame further on — before the sites, which clear the town's arrivals. @see roads/jobs
  if (g.roadJobs.length) useWorldStore.getState().stepRoadWorks(dt, { net, town });
  // AND THE LINES BEING LAID: mains, sewers, channels. @see lines/jobs
  if (g.lineJobs.length || g.razeJobs.length) useWorldStore.getState().stepLineWorks(dt);
  stepWorks(works, g, net, town, ownedNow(), playing ? payForLoad : () => true, dt, Date.now());
  if (works.opened.length) announceOpened(works.opened.splice(0));

  if (works.rev !== seen.rev) {
    seen.rev = works.rev;
    useWorldStore.setState({ projectRev: useWorldStore.getState().projectRev + 1 });
  }
}

/** Every port's tile on a map, kept till the map changes. @see portTileSet */
let portsKept: { grid: Grid; rev: number; tiles: Set<number> } | null = null;
function portsNow(g: Grid): Set<number> {
  if (!portsKept || portsKept.grid !== g || portsKept.rev !== g.rev) portsKept = { grid: g, rev: g.rev, tiles: portTileSet(g) };
  return portsKept.tiles;
}

/** What the harbour did this step that the scene sounds and says. */
export type HarbourSeen = {
  /** The first coaster or ship to call at a port. @see Traffic.firsts */
  firsts: { port: number; cls: number }[];
  /** Ports whose river has fallen too low for their bigger ships. */
  lows: number[];
  /** The investor's yacht has called. @see callInvestor */
  vip: boolean;
  /** Calls paid for. */
  paid: number;
};

/** When what the ports earn a second was last worked out, on the frame clock: begun a minute ahead, so the first is measured over a whole minute of calls. */
let portRateAt: number | null = null;

/**
 * THE HARBOUR: boats in off the rivers and away, every boat moved, and THE
 * PORTS PAID for the calls they finished — in the game, into the company's
 * money; in the editor, counted and never paid. What the ports earn a second
 * is kept with the company for the time away. @see portCallFee, stepTraffic
 */
export function stepHarbour(g: Grid, field: WaterField, dt: number, playing: boolean, now = performance.now()): HarbourSeen {
  const traffic = getTraffic(), fleet = getFleet();
  stepTraffic(traffic, fleet, g, field.columns, dt);
  stepTrade(dt);
  const seen: HarbourSeen = { firsts: traffic.firsts.splice(0), lows: traffic.lows.splice(0), vip: false, paid: 0 };
  if (traffic.calls.length) {
    const st = useWorldStore.getState();
    for (const call of traffic.calls.splice(0)) {
      const id = call.port;
      const s = g.structures.get(id);
      // By the size of ship that called, and by what its berth is fitted for: less of the fee, and something for the town. @see SHIP_CLASSES, FITTINGS
      const fit = fitting(call.fit);
      let fee = s ? portCallFee(s.def, undefined, call.cls) : null;
      if (call.vip && playing) seen.vip = true;
      // A SLOP BARGE takes a hold of what the loader has, and bills for it by how much: a full one, half a call's fee.
      // What the company cannot pay for is left where it is.
      if (fit.id === "slop" && s && fee !== null && !portShut(id)) {
        const bill = fee * BARGE_COST * (bargeLoad(g, id) / BARGE_HOLDS);
        if (bill > 0 && (!playing || useMoneyStore.getState().money.gte(bill))) {
          bargeTakes(g, id);
          if (playing) useMoneyStore.getState().spendMoney(bill);
        }
        continue;
      }
      if (fee !== null) fee *= fit.pay;
      if (fit.keeps && s && !portShut(id)) creditTrade(fit.keeps, classOf(call.cls).dock * classOf(call.cls).span);
      // A PORT UNDER WATER takes no trade. @see portShut
      if (fee === null || portShut(id)) continue;
      // REGULAR ROUTES, won by serving convoys, add to every call. @see ROUTE_BONUS
      fee *= 1 + ROUTE_BONUS * (useSessionStore.getState().routes ?? 0);
      // A CONVOY IN pays double, and is counted; treble at a port by the Conference Centre. @see convoyPays
      const convoy = st.events.find((e) => e.kind === "convoy" && e.phase === "active");
      if (convoy) { fee *= s ? convoyPays(g, s) : CONVOY_PAYS; tallyCall(convoy.id, fee); }
      if (playing) { useMoneyStore.getState().increaseMoney(fee); seen.paid++; }
      recordCall(getExports(), id, fee, now);
    }
  }
  // WHAT THE PORTS EARN A SECOND — a few times a minute, from the last minute's calls. @see portIncomePerSecond
  if (playing) {
    if (portRateAt === null || now < portRateAt - 60_000) portRateAt = now + 55_000;
    if (now - portRateAt > 5000) {
      portRateAt = now;
      const ex = getExports();
      let perMin = 0;
      for (const id of ex.recent.keys()) perMin += perMinute(ex, id, now);
      useSessionStore.getState().setPortIncome(perMin / 60);
    }
  }
  stepFleet(fleet, field.columns, dt, trafficSteer(traffic));
  return seen;
}
