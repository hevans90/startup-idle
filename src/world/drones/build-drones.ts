/**
 * World v2 — BUILD DRONES: AI mode builds without crews. From the first
 * Ascension the founder's garage keeps a DRONE PORT in its yard; whatever AI
 * mode orders — a road, an office, a lot, a landmark — a drone flies out to it
 * from there, and where it lands the work goes up at once and fast: no
 * surveyors, no diggers, no lorries, its materials paid as it lands.
 *
 * Pipes, mains and sewers the AI lays are laid at once already. @see orderLine
 *
 * Kept on the job itself (`RoadJob.drone`, `Build.drone`): saved with the map,
 * flown on after a reload. Stepped by `stepSites`, in the scene and the
 * headless runs alike. @see stepBuildDrones
 */
import { useFounderStore } from "../../state/founder.store";
import { useGenerationStore } from "../../state/generation.store";
import type { Build, Grid } from "../grid";
import { YARD_DEFS, hasYard, inYard } from "../landmarks/yard";
import { ROAD_CREWS, type RoadJob } from "../roads/jobs";

export type Cell = { x: number; y: number };

/** A build drone's flight: from the port to the work, `t` of `fly` seconds flown. */
export type BuildDrone = { from: Cell; to: Cell; t: number; fly: number };

/** Tiles a second a build drone flies. */
export const BUILD_DRONE_SPEED = 6;
/** How much faster a road goes in under a drone than under its crews. */
export const DRONE_ROAD_PACE = 8;
/** Seconds a building takes to go up under a drone, whatever its size. */
export const DRONE_SITE_SECONDS = 8;
/** Where the port stands in the yard, in plot tiles: on the open ground by the gate, clear of the bays and the crane. @see YARD_PARKING */
export const DRONE_PORT = { u: 4.45, v: 1.5 } as const;

/** Whether drones are the company's: from the first Ascension — the Model's runs come no sooner. */
export const dronesEarned = (): boolean => useGenerationStore.getState().generation > 1 || useFounderStore.getState().selectedFounderId === "model";

/** The drone port: in the yard of the founder's garage (or what it grew into), finished — from the first Ascension. */
export function dronePort(g: Grid): Cell | null {
  if (!dronesEarned()) return null;
  for (const s of g.structures.values()) {
    if (s.build || !YARD_DEFS.includes(s.def) || !hasYard(s)) continue;
    const p = inYard(DRONE_PORT, s);
    return { x: s.x + p.u - 0.5, y: s.y + p.v - 0.5 };
  }
  return null;
}

/** Where a drone is now, and whether it has landed. */
export function droneNow(d: BuildDrone): { x: number; y: number; landed: boolean } {
  const k = d.fly > 0 ? Math.min(1, d.t / d.fly) : 1;
  return { x: d.from.x + (d.to.x - d.from.x) * k, y: d.from.y + (d.to.y - d.from.y) * k, landed: d.t >= d.fly };
}

const flight = (from: Cell, to: Cell): BuildDrone => ({ from, to, t: 0, fly: Math.hypot(to.x - from.x, to.y - from.y) / BUILD_DRONE_SPEED });

/**
 * AI MODE'S OWN ACTIONS: set while a pilot job runs, so what it orders goes by drone. The company's AI (its
 * district, from the Overseer) acts as the AI too, and keeps its own ways. @see pilot
 */
let piloting = 0;
export function asPilot<T>(act: () => T): T {
  piloting++;
  try { return act(); } finally { piloting--; }
}
export const pilotActing = () => piloting > 0;

/** What there is to fly to on a map now, to tell new from old: its road jobs and its sites. */
export const worksOn = (g: Grid) => ({ roads: new Set(g.roadJobs.map((j) => j.id)), sites: new Set([...g.structures.values()].filter((s) => s.build).map((s) => s.id)) });

/**
 * SENT FOR WHAT WAS JUST ORDERED: a drone to each road job and each site that is new since `before`, if the port
 * stands. Before any crew or lorry is sent: the work waits for the drone. How many were sent.
 */
export function sendDrones(g: Grid, before: ReturnType<typeof worksOn>): number {
  const port = dronePort(g);
  if (!port) return 0;
  let n = 0;
  for (const j of g.roadJobs) {
    if (before.roads.has(j.id) || j.drone) continue;
    const mid = j.cells[Math.floor(j.cells.length / 2)];
    j.drone = flight(port, { x: mid.x, y: mid.y });
    j.gangs = {};
    n++;
  }
  for (const s of g.structures.values()) {
    if (!s.build || before.sites.has(s.id) || s.build.drone) continue;
    s.build.drone = flight(port, { x: s.x + (s.w - 1) / 2, y: s.y + (s.h - 1) / 2 });
    s.build.plant = false;
    n++;
  }
  return n;
}

/** What is left of a job's materials to pay for, at its price. */
const owedRoad = (j: RoadJob) => (j.deliveries > 0 ? j.cost * (1 - j.delivered / j.deliveries) : 0);
const owedSite = (b: Build) => (b.deliveries > 0 ? b.cost * (1 - b.delivered / b.deliveries) : 0);

/**
 * A FRAME OF THE BUILD DRONES: each flown on; landed, the materials paid (it hovers till they can be) and the work
 * begun — a road's every crew there at once, with nothing to drive; a site's its own. Whether anything landed.
 */
export function stepBuildDrones(g: Grid, dt: number, pay: (amount: number) => boolean): boolean {
  let landed = false;
  for (const j of g.roadJobs) {
    const d = j.drone;
    if (!d || d.t >= d.fly) continue;
    d.t = Math.min(d.fly, d.t + dt);
    if (d.t < d.fly) continue;
    if (!pay(owedRoad(j))) { d.t = d.fly - 1e-3; continue; }
    j.delivered = j.deliveries;
    j.overland = [];
    j.gangs = Object.fromEntries(ROAD_CREWS.map((c) => [c, { plant: false }]));
    landed = true;
  }
  for (const s of g.structures.values()) {
    const d = s.build?.drone;
    if (!s.build || !d || d.t >= d.fly) continue;
    d.t = Math.min(d.fly, d.t + dt);
    if (d.t < d.fly) continue;
    if (!pay(owedSite(s.build))) { d.t = d.fly - 1e-3; continue; }
    s.build.delivered = s.build.deliveries;
    landed = true;
  }
  return landed;
}

/** Whether a road job waits on its drone, or is worked fast under it. */
export const droneWaiting = (j: { drone?: BuildDrone }) => !!j.drone && j.drone.t < j.drone.fly;

/** Every build drone in the air or at work, for the scene: where it is, and the port it flew from. */
export function buildDronesOn(g: Grid): { x: number; y: number; landed: boolean }[] {
  const out: { x: number; y: number; landed: boolean }[] = [];
  for (const j of g.roadJobs) if (j.drone) out.push(droneNow(j.drone));
  for (const s of g.structures.values()) if (s.build?.drone) out.push(droneNow(s.build.drone));
  return out;
}
