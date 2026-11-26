/**
 * World v2 — THE COMPANY'S CREWS. Not the whole fleet to every job: each trade is a crew of its own — on a road the
 * surveyors, the earthworks, the base, the tarring, the liners; on a pipe the footings or the trench, the laying, the
 * fill — kept at the yard, each working one job at a time. A crew is sent only when its phase is about to begin;
 * done there, it drives by road straight on to the next job that wants it, or home with none. How many of each the
 * company has is its yards'. @see roads/jobs ROAD_CREWS, lines/jobs LINE_CREWS
 */
import type { Place } from "../agents/roads";
import type { Town } from "../agents/town";
import type { Grid } from "../grid";
import { YARD_DEFS } from "../landmarks/yard";
import type { Network } from "../roads/network";
import { headOf } from "../roads/job-loads";
import {
  CREW_PLANT, CREW_TRADE, GANGS, GAP, ROAD_CREWS, frontAt, frontOf, setOutSeconds, tradeBegun, type Gang, type RoadCrew, type RoadJob,
} from "../roads/jobs";
import { LINE_CREWS, LINE_GAPS, lineCrewDone, lineFront, type LineCrew, type LineJob } from "../lines/jobs";
import { lineHead, lineLorryBack, yardFor } from "../lines/line-loads";
import { isYard } from "./fleet";
import { placesOf } from "../agents/roads";
import { stepPlant, type Plant, type PlantKind, type PlantRole } from "./plant";

/** Yards that keep a second crew of the busiest trades: the earthworks and the tarring. */
const TWO_CREWS: Readonly<Record<string, readonly string[]>> = { boardroom: ["earth", "tar"], ipo: ["earth", "tar"] };

/** How many crews of a trade the company has: one a yard, two of some at the biggest; with no yard, {@link GANGS} — worked, unseen. */
export function crewsOf(g: Grid, crew: string): number {
  let n = 0, yards = 0;
  for (const s of g.structures.values()) {
    if (s.build || !YARD_DEFS.includes(s.def)) continue;
    yards++;
    n += TWO_CREWS[s.def]?.includes(crew) ? 2 : 1;
  }
  return yards ? n : GANGS;
}

/** What the dispatcher is told of a kind of job: its crews, in the order they go on it, and what each wants. */
type Spec<J extends { id: number; gangs?: Partial<Record<C, Gang>> }, C extends string> = {
  jobs: readonly J[]; all: readonly C[]; role: PlantRole;
  crews: (j: J) => readonly C[]; plant: (j: J, c: C) => readonly PlantKind[];
  wants: (j: J, c: C) => boolean; done: (j: J, c: C) => boolean; started: (j: J, c: C) => boolean;
  head: (j: J) => Place | null;
  /** Not yet to let its machines go home: lorries still on it. */
  hold?: (j: J, c: C) => boolean;
};

/**
 * A FRAME OF A KIND OF JOB'S CREWS: each sent where it is wanted and there is one to send — straight on from a job
 * it has done there, before one from the yard — each crew's machines stepped, and a crew done with its part sent on
 * or home. Says which crews are at work on which jobs (`on`), and whether a done job's crews have all gone (`over`).
 */
function stepCrews<J extends { id: number; gangs?: Partial<Record<C, Gang>> }, C extends string>(g: Grid, haul: { net: Network; town: Town }, dt: number, S: Spec<J, C>) {
  const heads = new Map<J, Place | null>();
  const head = (j: J) => { if (!heads.has(j)) heads.set(j, S.head(j)); return heads.get(j)!; };
  const keyOf = (j: J, c: C) => j.id * 8 + S.all.indexOf(c);
  for (const j of S.jobs) j.gangs ??= {};
  // SENT: oldest job first, each that wants a crew it has not got.
  for (const crew of S.all) {
    let busy = 0;
    for (const j of S.jobs) { const gang = j.gangs![crew]; if (gang && !gang.gone && gang.onward === undefined) busy++; }
    const cap = crewsOf(g, crew);
    for (const j of S.jobs) {
      if (!S.crews(j).includes(crew) || j.gangs![crew] || !S.wants(j, crew) || S.done(j, crew)) continue;
      // (Straight on from a job it has done, its machines all still there — not home and out again.)
      const kinds = S.plant(j, crew).join();
      const from = S.jobs.find((o) => {
        const gang = o.gangs?.[crew], p = gang?.plant;
        return o !== j && !!p && !gang!.gone && gang!.onward === undefined && p.leaving !== undefined && !p.to
          && S.plant(o, crew).join() === kinds && (p.home === undefined || p.home.length === S.plant(o, crew).length);
      });
      const hd = head(j);
      if (from && hd) {
        from.gangs![crew]!.onward = j.id;
        j.gangs![crew] = { plant: { queue: [], t: 0, here: false, head: { x: hd.x, y: hd.y }, inbound: S.plant(j, crew).length } };
        continue;
      }
      if (busy >= cap) continue;
      j.gangs![crew] = {};
      busy++;
    }
  }
  // STEPPED: each crew's machines on their way, at work, or going.
  const state = new Map<Gang, ReturnType<typeof stepPlant>>();
  for (const j of S.jobs) for (const crew of S.crews(j)) {
    const gang = j.gangs![crew];
    if (!gang || gang.gone) continue;
    let onward: { key: number; head: Place; into: Plant } | undefined;
    if (gang.onward !== undefined) {
      const to = S.jobs.find((o) => o.id === gang.onward), into = to?.gangs?.[crew]?.plant, hd = to && head(to);
      if (to && into && hd) onward = { key: keyOf(to, crew), head: hd, into };
      // (The job it was going on to gone — cancelled — or no way to it: home after all.)
      else { if (into) into.inbound = 0; gang.onward = undefined; }
    }
    const at = stepPlant(g, haul, gang, { id: keyOf(j, crew), role: S.role }, head(j), S.plant(j, crew), S.started(j, crew), dt, S.hold?.(j, crew) ?? false, 0, onward);
    state.set(gang, at);
    if (at === "gone") gang.gone = true;
    // DONE WITH ITS PART: gathered at the road, and on — or home.
    if (S.done(j, crew) && (at === "work" || at === "none")) {
      if (gang.plant) { gang.plant.leaving ??= 0; gang.plant.t = 0; }
      else gang.gone = true;
    }
  }
  return {
    on: (j: J, crew: C) => { const gang = j.gangs?.[crew]; return !!gang && !gang.gone && (gang.plant === false || state.get(gang) === "work"); },
    over: (j: J) => Object.values<Gang | undefined>(j.gangs ?? {}).every((gang) => !gang || gang.gone || gang.plant === false),
  };
}

/** A road crew's machines' name on the road: a number of their own for each crew of each job. */
export const crewKey = (j: { id: number }, crew: RoadCrew) => j.id * 8 + ROAD_CREWS.indexOf(crew);

/** Whether a crew's part of a road is done: the line set out; its trade's front at the end. */
export function crewDone(j: RoadJob, crew: RoadCrew): boolean {
  const k = CREW_TRADE[crew];
  return k < 0 ? j.t >= setOutSeconds(j) : tradeBegun(j, k) && frontOf(j, k) >= j.cells.length;
}

/**
 * WHETHER A ROAD IS READY FOR A CREW: the surveyors at the order; the earthworks once the setting out has begun; each
 * trade after, once the one ahead of it is far enough on that it will soon have room — its own crew's drive there
 * the rest of the way.
 */
export function wantsCrew(j: RoadJob, crew: RoadCrew): boolean {
  const k = CREW_TRADE[crew], n = j.cells.length;
  if (k < 0) return true;
  if (k === 0) return j.t > 0;
  return tradeBegun(j, k - 1) && frontAt(j, k - 1) >= Math.min(n, GAP) - 1;
}

/** A frame of the road crews. @see stepCrews */
export function stepRoadCrews(g: Grid, haul: { net: Network; town: Town }, dt: number) {
  return stepCrews<RoadJob, RoadCrew>(g, haul, dt, {
    // (Not those under a drone: every crew of them is there, with nothing to drive. @see build-drones)
    jobs: g.roadJobs.filter((j) => !j.drone), all: ROAD_CREWS, role: "road-plant", crews: () => ROAD_CREWS, plant: (_j, c) => CREW_PLANT[c],
    wants: wantsCrew, done: crewDone, started: (j, c) => (CREW_TRADE[c] < 0 ? j.t > 0 : tradeBegun(j, CREW_TRADE[c])),
    head: (j) => headOf(g, haul.net, j),
  });
}

/** Every pipe crew there is, in the order they may go on a job. */
export const LINE_CREW_NAMES: readonly LineCrew[] = ["footing", "trench", "laying", "fill"];
const lineCrews = (j: LineJob) => LINE_CREWS[j.kind].map((c) => c.crew);
/**
 * A FRAME OF THE PIPE CREWS: the first at the order; each after once the one ahead has begun its last trade. Its
 * lorries are let off its track — each back down it and home — before the layers go. @see stepCrews
 */
export function stepLineCrews(g: Grid, haul: { net: Network; town: Town }, dt: number) {
  const jobs = g.lineJobs.filter((j) => LINE_CREWS[j.kind].length);
  return stepCrews<LineJob, LineCrew>(g, haul, dt, {
    jobs, all: LINE_CREW_NAMES, role: "line-plant", crews: lineCrews,
    plant: (j, c) => LINE_CREWS[j.kind].find((q) => q.crew === c)?.plant ?? [],
    wants: (j, c) => {
      const cs = LINE_CREWS[j.kind], k = cs.findIndex((q) => q.crew === c);
      return k === 0 || lineCrewDone(j, k - 1) || lineFront(j, cs[k - 1].last) > LINE_GAPS[j.kind] * 0.5;
    },
    done: (j, c) => lineCrewDone(j, LINE_CREWS[j.kind].findIndex((q) => q.crew === c)),
    started: (j, c) => (j.tc?.[LINE_CREWS[j.kind].findIndex((q) => q.crew === c)] ?? 0) > 0,
    head: (j) => {
      const hd = lineHead(g, haul.net, j);
      if (hd && !j.head) { j.head = { x: hd.x, y: hd.y }; const from = yardFor(g, placesOf(g, haul.net), hd); if (isYard(g, from)) j.depot = from.structure; }
      return hd;
    },
    hold: (j, c) => {
      if (c !== "laying" || j.gangs?.laying?.plant === false || j.gangs?.laying?.plant?.leaving === undefined) return false;
      // (Whatever lorries are still on it let off first: each back down the track and home.)
      if (j.head) { const places = placesOf(g, haul.net); while ((j.gone ?? 0) < j.delivered) lineLorryBack(g, haul, j, places); }
      return !!(j.back?.length || j.drive?.length);
    },
  });
}
