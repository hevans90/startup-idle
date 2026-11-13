/**
 * World v2 — THE TOWN'S RULES, A FRAME AT A TIME, with nothing drawn: who
 * moves about and who arrives, how the houses feel and grow, what the town
 * opens, and the projects going up. The scene calls these from its tick, in
 * its order, and draws what they changed; a simulation calls the same three
 * with no scene at all — which is the point: a company can be played from an
 * empty map to its sale without a renderer, by the rules the game plays by.
 * @see WorldScene, simulation/pilot-run, plans/ai-mode-rebuild.md phase 0
 *
 * What is NOT here, and stays the scene's for now: the water and its pipes,
 * the boats, the events and what they do to the map, repairs and cooling.
 */
import { section } from "../hitches";
import { getArrivals, getEvolution, getTown, getTownServices, getTraffic, getWorks, playRules, useWorldStore } from "../state/world.store";
import { useSessionStore } from "../state/session.store";
import type { GeneratorId } from "../state/generators.store";
import { stepArrivals } from "./agents/arrivals";
import { liveBeauty } from "./agents/beauty";
import { PORT_LORRY_COLOUR } from "./agents/cars/fleet";
import { createEmergency, stepEmergency } from "./agents/emergency";
import { liveMoods, stepMood, type Unrest } from "./agents/mood";
import { liveCoverage, stepEvolution, townChanged } from "./agents/services";
import { sendOnJob, stepTown, type Mover } from "./agents/town";
import { stepTown as stepTownServices, type TownEvent } from "./agents/town-services";
import { ladderOf, stepLadder } from "./agents/unlocks";
import { stepYards } from "./boats/yard";
import { damagedNow } from "./events/damage";
import type { Grid } from "./grid";
import { announceOpened, ownedNow, payForLoad } from "./projects/economy";
import { stepWorks } from "./projects/works";
import type { Network } from "./roads/network";
import { structureDef } from "./structures/def";
import { validatePlacement } from "./structures/place";

type Owned = Partial<Record<GeneratorId, number>>;

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
    canPlace: (def, x, y) => { const d = structureDef(def); return !!d && validatePlacement(g, d, x, y, playRules(g)).ok; },
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
  stepWorks(works, g, net, town, ownedNow(), playing ? payForLoad : () => true, dt, Date.now());
  if (works.opened.length) announceOpened(works.opened.splice(0));
  if (works.rev !== seen.rev) {
    seen.rev = works.rev;
    useWorldStore.setState({ projectRev: useWorldStore.getState().projectRev + 1 });
  }
}
