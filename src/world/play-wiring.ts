/**
 * World v2 — THE MAP TOLD TO THE ECONOMY: what the game reads off a played
 * map — its beds, how its houses feel, what is built and who is away from
 * their desk — and what a company is given when its map is first shown.
 * The canvas registers these while a map is mounted; a simulation registers
 * the same ones with no canvas at all. @see WorldCanvas, wirePlayedMap,
 * plans/ai-mode-rebuild.md phase 0
 */
import { processorKind, type ProcessorKind } from "../game/processors";
import { eventCrew } from "./events/events";
import { addBeds, awaitingArrival, housingCapacity, housingResidents } from "../game/housing";
import { useGeneratorStore, type GeneratorId } from "../state/generators.store";
import { getNetwork, getWorks, useWorldStore } from "../state/world.store";
import { housedBy, residentsIn } from "../game/housing";
import { projectDef, projectForStructure, type FeatureId, type ProjectId } from "../game/projects";
import { liveLeadership } from "./agents/leaders";
import { deskShare } from "./agents/desk-perks";
import { useTeamLeadersEmployeesStore } from "../state/team-leaders.store";
import { useInnovationStore } from "../state/innovation.store";
import { commuteFactor, liveCommutes, liveSeating, workplaceKind } from "./agents/commute";
import { cultureNow, cultureVersion } from "../game/culture-now";
import { liveMoods, moodOffsets } from "./agents/mood";
import { needsShare } from "./agents/services";
import { structureDef } from "./structures/def";
import { builtProjects, catchUpWorks } from "./projects/works";
import { announceOpened, ownedNow, payForLoad } from "./projects/economy";
import { useSessionStore } from "../state/session.store";
import { evacuatedAway } from "./events/flood";
import { damagedAway, damagedDesksAway } from "./events/damage";
import { cleanupAway } from "./events/cleanup";
import { labReading } from "./projects/labs";
import { rackReading } from "./projects/racks";
import { allTanks, cooledSpires, hotAgents } from "./projects/cooling";

/** How long, at most, a map reading is kept for the economy, ms. @see held */
export const HELD_MS = 250;

/**
 * A MAP READING KEPT for the economy: worked out again when the map changes —
 * an edit, a project, an event, a hire — and otherwise at most every
 * `HELD_MS`. The economy asks constantly: every readout of a rate asks, on
 * every change to its store, and each ask walked a big town's two thousand
 * buildings several times over — most of a tenth of a second for each second
 * of the economy's tick. @see setProjectReader, setHousingReader
 */
export function held<T>(read: () => T): () => T {
  let grid: unknown = null, rev = -1, projects = -1, events: unknown = null, staff = "", cards = -1, at = -Infinity, value!: T;
  return () => {
    const st = useWorldStore.getState(), now = performance.now();
    const people = useGeneratorStore.getState().generators.map((g) => g.amount).join();
    // And the culture deck, which moves beds, desks and moods. @see cultureNow
    const deck = cultureVersion();
    if (st.grid !== grid || st.revision !== rev || st.projectRev !== projects || st.events !== events || people !== staff || deck !== cards || now - at > HELD_MS) {
      grid = st.grid; rev = st.revision; projects = st.projectRev; events = st.events; staff = people; cards = deck; at = now;
      value = read();
    }
    return value;
  };
}

/** The beds the economy may hire into: the map's, and in the game the company's own off it. @see setHousingReader */
export function bedsReading(play: boolean) {
  const built = housingCapacity(useWorldStore.getState().grid);
  return play ? addBeds(built, useSessionStore.getState().remoteBeds ?? {}) : built;
}

/** How the town feels, by kind: each kind's Home part of morale. @see moodOffsets */
export function townMoodReading() {
  const net = getNetwork(), g = useWorldStore.getState().grid;
  // Those still waiting for a bed count as nought. @see awaitingArrival
  const away = awaitingArrival(ownedNow(), useSessionStore.getState().remoteBeds ?? {}, housingResidents(g));
  return net ? moodOffsets(g, liveMoods(g, net), away) : {};
}

/** The map's side of the term sheet: houses lived in, wonders standing, projects built. @see game/term-sheets */
export function termReading() {
  let houses = 0, wonders = 0, projects = 0;
  for (const s of useWorldStore.getState().grid.structures.values()) {
    if (s.build) continue;
    if (housedBy(s.def) && residentsIn(s) > 0) houses++;
    const p = projectForStructure(s.def);
    if (p) projects++;
    if (p?.bonus) wonders++;
  }
  return { houses, wonders, projects };
}

/**
 * WHAT A COMPANY'S MAP IS GIVEN when it is first shown in the game: what it
 * already earned stood up finished, whoever was on their way arrived, the time
 * away caught up. @see foundEarnedProjects
 */
export function foundPlayedProjects(): void {
  const owned = ownedNow();
  const features = new Set<FeatureId>();
  // (Not managers, leaders nor mandates: they open later tiers, which are
  // never stood up on a guess — and mandates and rehired leaders say
  // nothing of this company's map. @see foundEarnedProjects)
  // A map that already has ports has already earned them.
  for (const s of useWorldStore.getState().grid.structures.values()) {
    if (structureDef(s.def)?.port) features.add("ports");
  }
  useWorldStore.getState().foundEarnedProjects(owned, features);
  // Whoever was on their way has arrived while the map was not looked at.
  useWorldStore.getState().settleHousing(owned, useSessionStore.getState().remoteBeds ?? {});
  const opened = catchUpWorks(useWorldStore.getState().grid, owned, payForLoad, Date.now());
  if (opened.length) announceOpened(opened);
  // And the roads being built. @see roads/jobs
  useWorldStore.getState().catchUpRoadWorks(Date.now());
  // WHAT THE BUILDINGS STANDING HAVE OPENED, had: a save from before projects opened them. @see grantFeatures
  for (const id of builtProjects(useWorldStore.getState().grid)) useInnovationStore.getState().grantFeatures(projectDef(id)?.grants);
}

/** What is built, who is away and how well the rest work, for the economy: asked every tick, worked out again only as the map changes. @see setProjectReader */
export function projectReader() {
  // What is built changes only with the map, so it is worked out again only
  // then: the economy asks every tick.
  let seenGrid: unknown = null, seenRev = -1, seenProjects = -1;
  let built: Set<ProjectId> = new Set();
  let residents = housingResidents(useWorldStore.getState().grid);
  let labs = labReading(useWorldStore.getState().grid);
  let racks = rackReading(useWorldStore.getState().grid);
  return () => {
    const st = useWorldStore.getState();
    if (st.grid !== seenGrid || st.revision !== seenRev || st.projectRev !== seenProjects) {
      seenGrid = st.grid; seenRev = st.revision; seenProjects = st.projectRev;
      built = builtProjects(st.grid);
      residents = housingResidents(st.grid);
      labs = labReading(st.grid);
      racks = rackReading(st.grid);
    }
    // AWAY FROM THEIR DESKS: building, and — hired but not arrived — on
    // their way to the map, or waiting for somewhere to live on it.
    // @see awaitingArrival
    const away = { ...getWorks().away };
    const coming = awaitingArrival(ownedNow(), useSessionStore.getState().remoteBeds ?? {}, residents);
    for (const [id, n] of Object.entries(coming)) away[id as GeneratorId] = (away[id as GeneratorId] ?? 0) + n;
    // EVACUATED from a flood, for as long as their homes are under water.
    // @see evacuatedAway
    for (const [id, n] of Object.entries(evacuatedAway(st.grid))) away[id as GeneratorId] = (away[id as GeneratorId] ?? 0) + n;
    // OUT OF HOMES A FLOOD DAMAGED, until the repair crew has been. @see damage
    for (const [id, n] of Object.entries(damagedAway(st.grid))) away[id as GeneratorId] = (away[id as GeneratorId] ?? 0) + n;
    // MOPPING UP SLUDGE spilled from a full slop tank. @see stepCleanup
    const mopping = cleanupAway();
    if (mopping) away.vibe_coder = Math.min(ownedNow().vibe_coder ?? 0, (away.vibe_coder ?? 0) + mopping);
    // AND WHOEVER AN EVENT'S CHOICE TOOK OFF WORK: sandbaggers until the
    // flood passes, hands at the quays while the convoy is in, tidiers
    // until the investors come, everyone at a hackathon. @see eventCrew
    for (const [id, n] of Object.entries(eventCrew(st.events, ownedNow()))) {
      away[id as GeneratorId] = Math.min(ownedNow()[id as GeneratorId] ?? 0, (away[id as GeneratorId] ?? 0) + n);
    }
    const remote = useSessionStore.getState().remoteBeds ?? {};
    const net = getNetwork();
    const commute = net ? commuteFactor(st.grid, liveCommutes(st.grid, net), ownedNow(), remote) : undefined;
    // AT THEIR DESKS: a café next door. @see deskShare
    const seated = net ? liveSeating(st.grid, net) : undefined, seating = seated?.desks;
    // OUT OF A WORKPLACE closed by the inspector, or damaged: those at its desks. @see closeFor
    if (seating) {
      for (const [id, n] of Object.entries(damagedDesksAway(st.grid, seating, workplaceKind))) {
        away[id as GeneratorId] = Math.min(ownedNow()[id as GeneratorId] ?? 0, (away[id as GeneratorId] ?? 0) + n);
      }
    }
    const desks = net && seating ? deskShare(
      st.grid,
      liveLeadership(st.grid, net, useTeamLeadersEmployeesStore.getState().employees, liveMoods(st.grid, net)),
      seating, ownedNow(),
    ) : undefined;
    // EACH LEADER'S TEAM: the people at the desks of the building they lead. @see game/leaders
    const teams: Partial<Record<GeneratorId, number>> = {};
    for (const l of useTeamLeadersEmployeesStore.getState().employees) {
      // And under Remote Fridays' rule, everyone of the kind at home. @see Rules.homeTeam
      if (l.placedAt !== null) teams[l.role] = (seating?.get(l.placedAt)?.used ?? 0) + (cultureNow(l.role).homeTeam ? seated?.home[l.role] ?? 0 : 0);
    }
    // COOLING: agents the water does not reach run at half, and a dry spire
    // adds nothing. @see stepCooling
    // Before the first drink — time away, credited on load — the tanks are full.
    const hot = Math.min(racks.powered, Math.round(hotAgents()));
    const cooled = hot ? { powered: racks.powered - hot, unpowered: racks.unpowered + hot } : racks;
    let spires = 0, farms = 0, monolith = false;
    // AND THE SLOP PROCESSORS standing, by kind, for their prices. @see game/processors
    const processors: Partial<Record<ProcessorKind, number>> = {};
    for (const s of st.grid.structures.values()) {
      if (s.build) continue;
      if (s.def === "compute-spire") spires++;
      if (s.def === "gpu-farm") farms++;
      if (s.def === "monolith") monolith = true;
      const k = processorKind(s.def);
      if (k) processors[k] = (processors[k] ?? 0) + 1;
    }
    // AT HOME: the share of each kind with every need met. @see needsBonus
    const needs = net ? needsShare(st.grid, liveMoods(st.grid, net)) : undefined;
    return { built, away, commute, labs, racks: cooled, desks, teams, needs, processors, spires: allTanks().size ? cooledSpires() : spires, farms, monolith };
  };
}
