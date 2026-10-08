/**
 * World v2 — projects going up: who is building, what has been delivered, and
 * how far it has got. @see game/projects for what projects there are.
 *
 * A SITE is a structure with a `build` record. Each frame, for each site:
 *
 *  - ITS CREW is set by its priority — a share of the employees who can build
 *    it, as many as the site has room for — and they are AWAY from their desks
 *    from the moment they are called. They walk there from their homes along
 *    the roads, as people, and work only once they arrive: a site far from
 *    where its builders live is a slow site. @see buildersFor
 *  - ITS MATERIALS come a truckload at a time, from where a road leaves the
 *    map, and each load is PAID FOR WHEN IT IS SENT. Work can run only as far
 *    as the materials on site allow, so a company that cannot pay for the next
 *    load STALLS — and a crew stood idle for a while walks home, which at least
 *    puts them back at their desks. @see STALL_GRACE
 *  - WORK is the builders on site, a builder-second each a second.
 *  - When the work is done and every load delivered, IT OPENS: the record
 *    comes off, the building stands finished, and the crew walks home.
 *
 * Time away is caught up all at once on load, as if the whole crew had been
 * there throughout. @see catchUpWorks
 */
import { housedBy } from "../../game/housing";
import {
  BUILDERS_PER_TILE, buildersFor, projectForStructure, type ProjectDef, type ProjectId,
} from "../../game/projects";
import type { GeneratorId } from "../../state/generators.store";
import { idx, type Build, type Grid, type Structure } from "../grid";
import { placeCommand, validatePlacement, type PlaceRules } from "../structures/place";
import { structureDef, type StructureDef } from "../structures/def";
import type { Command } from "../edit/commands";
import type { Network } from "../roads/network";
import { placesOf, type Place } from "../agents/roads";
import { sendOnJob, type Mover, type Town } from "../agents/town";

/** Seconds a crew stands idle for want of materials before it walks home. */
export const STALL_GRACE = 6;
/** Loads a site keeps on hand ahead of its work. */
const STOCK = 2;
/** Seconds between one builder setting off and the next, per site. */
const DISPATCH_EVERY = 0.35;

export type Crew = {
  /** On their way there. */
  walking: number;
  /** On site, working. */
  working: number;
  untilNext: number;
};

export type Works = {
  crews: Map<number, Crew>;
  /** Loads on their way, per site. */
  trucks: Map<number, number>;
  /** Seconds each site has stood waiting for materials it cannot afford. */
  stalled: Map<number, number>;
  /** Employees away building, per kind, as the economy reads them. */
  away: Partial<Record<GeneratorId, number>>;
  /** Projects that opened since the last look, for whoever announces them. */
  opened: ProjectId[];
  /** Bumped on a delivery, a stall, an opening: anything worth saving. */
  rev: number;
};

export const createWorks = (): Works => ({
  crews: new Map(), trucks: new Map(), stalled: new Map(), away: {}, opened: [], rev: 0,
});

/** Every site still going up. */
export const sitesOf = (g: Grid): Structure[] => [...g.structures.values()].filter((s) => s.build);

/** The projects whose buildings stand finished. */
export function builtProjects(g: Grid): Set<ProjectId> {
  const out = new Set<ProjectId>();
  for (const s of g.structures.values()) {
    const p = projectForStructure(s.def);
    if (p && !s.build) out.add(p.id);
  }
  return out;
}

/** The site of a project, if it has been started and is not finished. */
export const siteOf = (g: Grid, p: ProjectDef): Structure | null =>
  [...g.structures.values()].find((s) => s.def === p.structure && s.build) ?? null;

/** A fresh build record for a project. */
export const newBuild = (p: ProjectDef, now: number): Build => ({
  done: 0, need: p.work, delivered: 0, deliveries: p.deliveries, cost: p.cost, priority: 2, updatedAt: now,
});

/**
 * The command that lays out a project's site, or null if it may not go there:
 * placed as its building is, with the build record on it. Nothing is paid
 * here — materials are paid for as they are sent.
 */
export function startSiteCommand(
  g: Grid, p: ProjectDef, x: number, y: number, rules: PlaceRules, now: number,
): Command | null {
  const def = structureDef(p.structure);
  const cmd = def && placeCommand(g, def, x, y, rules);
  if (!cmd?.structures?.added.length) return null;
  cmd.structures.added[0].build = newBuild(p, now);
  return cmd;
}

/** The share of a site's crew that is each kind of builder, by how many of each the company has. */
function splitCrew(p: ProjectDef, crew: number, owned: Partial<Record<GeneratorId, number>>) {
  const total = p.builders.reduce((n, id) => n + (owned[id] ?? 0), 0);
  const out: Partial<Record<GeneratorId, number>> = {};
  if (!total) return out;
  let left = crew;
  p.builders.forEach((id, k) => {
    const n = k === p.builders.length - 1 ? left : Math.round((crew * (owned[id] ?? 0)) / total);
    out[id] = (out[id] ?? 0) + n;
    left -= n;
  });
  return out;
}

/** The crew a site wants now: none while it has stood idle too long for want of materials. */
function wantedCrew(w: Works, s: Structure, p: ProjectDef, owned: Partial<Record<GeneratorId, number>>) {
  if ((w.stalled.get(s.id) ?? 0) > STALL_GRACE) return 0;
  return buildersFor(p, s.build!.priority, owned, s.w * s.h);
}

/** Where a site's builders come from: the doors of their housing, else any door, else the rim. */
function homesFor(places: readonly Place[], g: Grid, p: ProjectDef, net: number): Place[] {
  const inNet = places.filter((pl) => pl.net === net && !pl.building);
  const housing = inNet.filter((pl) => {
    const s = pl.structure !== undefined ? g.structures.get(pl.structure) : undefined;
    const h = s && housedBy(s.def);
    return h && p.builders.includes(h.id);
  });
  if (housing.length) return housing;
  const doors = inNet.filter((pl) => pl.kind === "door");
  return doors.length ? doors : inNet;
}

/** How far through the work the materials on site allow. */
export const materialCap = (b: Build) => (b.need * b.delivered) / b.deliveries;

/**
 * One frame of every site. `spend` pays for a load if the money is there and
 * says whether it was. Returns nothing; what happened is on `w`.
 */
export function stepWorks(
  w: Works, g: Grid, net: Network, town: Town, owned: Partial<Record<GeneratorId, number>>,
  spend: (amount: number) => boolean, dt: number, now: number,
): void {
  const sites = sitesOf(g);
  const places = placesOf(g, net);
  w.away = {};
  const live = new Set(sites.map((s) => s.id));
  for (const id of w.crews.keys()) if (!live.has(id)) w.crews.delete(id);

  // WHO HAS ARRIVED, since the last frame: builders, and loads.
  for (const m of town.arrived) {
    const job = m.job;
    if (!job) continue;
    const s = g.structures.get(job.site);
    const crew = w.crews.get(job.site);
    if (job.role === "truck") {
      w.trucks.set(job.site, Math.max(0, (w.trucks.get(job.site) ?? 0) - 1));
      if (s?.build) { s.build.delivered = Math.min(s.build.deliveries, s.build.delivered + 1); w.rev++; }
    } else if (job.role === "builder" && crew) {
      crew.walking = Math.max(0, crew.walking - 1);
      // Arrived to a site that wants fewer now — paused, or lowered — and
      // straight back home again.
      const p = s?.build && projectForStructure(s.def);
      if (s?.build && p && crew.working < wantedCrew(w, s, p, owned)) { crew.working++; putToWork(town, g, s, m); }
      else if (s && p) sendHome(town, g, placesOf(g, net), s, p, placesOf(g, net).find((pl) => pl.structure === s.id));
    }
  }
  town.arrived.length = 0;

  for (const s of sites) {
    const b = s.build!, p = projectForStructure(s.def);
    if (!p) continue;
    const door = places.find((pl) => pl.structure === s.id);
    let crew = w.crews.get(s.id);
    if (!crew) {
      crew = { walking: 0, working: 0, untilNext: 0 };
      w.crews.set(s.id, crew);
      // A SITE ALREADY UNDER WAY when the map was loaded has its crew on it
      // still: they were there when you left. Walking them all back from home
      // made every reload cost a minute of work. Only a new site sends for them.
      if (b.done > 0 && door) {
        for (let k = wantedCrew(w, s, p, owned); k > 0; k--) {
          crew.working++;
          putToWork(town, g, s, { ...placeholder, id: town.next, colour: SHIRTS[town.next % SHIRTS.length] } as Mover);
        }
      }
    }

    // MATERIALS: kept a little ahead of the work — the next load sent while
    // fewer than `STOCK` loads are on hand unused — because a truck from the
    // edge of the map takes longer than a crew takes to use a load, and
    // ordering only once half of one was left stood every crew idle for most
    // of every journey. Sent, it is paid; unpaid, the site waits.
    const inFlight = w.trucks.get(s.id) ?? 0;
    const caughtUp = b.done >= materialCap(b) - 1e-6;
    const onHand = (materialCap(b) - b.done) / (b.need / b.deliveries);
    if (onHand < STOCK && inFlight === 0 && b.delivered < b.deliveries) {
      if (spend(b.cost / b.deliveries)) {
        w.trucks.set(s.id, 1);
        w.stalled.delete(s.id);
        const from = door && pickGateway(places, door.net);
        // With no road out of the map in its network, a load comes by
        // means unseen — it still has to be paid for.
        if (!door || !from || !sendOnJob(town, g, "truck", from, door, { site: s.id, role: "truck" })) {
          w.trucks.set(s.id, 0);
          b.delivered++;
        }
        w.rev++;
      } else if (caughtUp) {
        // STALLED only once the work has run out: short of money for the
        // next load with some of this one left is not yet a stall.
        if (!w.stalled.has(s.id)) w.rev++;
        w.stalled.set(s.id, (w.stalled.get(s.id) ?? 0) + dt);
      }
    }

    // THE CREW: called up to what the priority asks for, sent home past it.
    const want = door ? wantedCrew(w, s, p, owned) : 0;
    crew.untilNext -= dt;
    if (crew.walking + crew.working < want && crew.untilNext <= 0) {
      const homes = homesFor(places, g, p, door!.net);
      const home = homes[(s.id * 7 + crew.working + crew.walking) % Math.max(1, homes.length)];
      if (home && sendOnJob(town, g, "person", home, door!, { site: s.id, role: "builder" })) crew.walking++;
      else crew.working++;    // nowhere to walk from: they are simply there
      crew.untilNext = DISPATCH_EVERY;
    }
    while (crew.working > 0 && crew.walking + crew.working > want) {
      crew.working--;
      sendHome(town, g, places, s, p, door);
    }

    // WORK, by those on site, as far as the materials go.
    b.done = Math.min(materialCap(b), b.done + crew.working * dt);
    b.updatedAt = now;
    // AWAY FROM THEIR DESKS: everyone the site has called, from the moment it
    // calls them. Paused or lowered, they are back on the books at once —
    // anyone still walking there turns round when they arrive.
    const split = splitCrew(p, want, owned);
    for (const [id, n] of Object.entries(split)) w.away[id as GeneratorId] = (w.away[id as GeneratorId] ?? 0) + (n ?? 0);

    // OPENING.
    if (b.done >= b.need - 1e-6 && b.delivered >= b.deliveries) {
      delete s.build;
      for (let k = crew.working; k > 0; k--) sendHome(town, g, places, s, p, door);
      w.crews.delete(s.id);
      w.trucks.delete(s.id);
      w.stalled.delete(s.id);
      w.opened.push(p.id);
      w.rev++;
      // Its door is a door now, not a site's: the town looks again.
      town.placesAt = -1;
    }
  }
}

/** A road out of the map on a network, for a load to come in by. */
function pickGateway(places: readonly Place[], net: number): Place | null {
  return places.find((pl) => pl.kind === "gateway" && pl.net === net) ?? null;
}

/** Shirts for a crew found already on site. */
const SHIRTS = [0xd35454, 0x4a7fc1, 0xe6c35c, 0x5aa36b, 0x9b6bc2, 0xe08a3c];

/** The person a builder already on site is drawn as: a passer-by with a job. */
const placeholder: Partial<Mover> = {
  kind: "person", cruise: 0.45, stuck: 0, pushing: 0, colour: 0xe08a3c, phase: 0,
};

/** Stand an arrived builder somewhere on the site, at work. */
function putToWork(town: Town, g: Grid, s: Structure, m: Mover): void {
  const k = town.next;
  const x = s.x - 0.35 + ((k * 0.618) % 1) * (s.w - 0.3);
  const y = s.y - 0.35 + ((k * 0.382) % 1) * (s.h - 0.3);
  const z = g.height[idx(g, s.x, s.y)];
  town.movers.push({
    ...m, id: town.next++, path: [{ x: Math.round(x), y: Math.round(y) }], line: [{ x, y }],
    at: new Float32Array(1), s: 0, speed: 0, x, y, z, heading: (k * 2.4) % (Math.PI * 2),
    job: { site: s.id, role: "working" },
  });
}

/** Take one worker off a site and walk them home. */
function sendHome(
  town: Town, g: Grid, places: readonly Place[], s: Structure, p: ProjectDef, door: Place | undefined,
): void {
  const k = town.movers.findIndex((m) => m.job?.role === "working" && m.job.site === s.id);
  if (k >= 0) town.movers.splice(k, 1);
  if (!door) return;
  const homes = homesFor(places, g, p, door.net);
  const home = homes[(town.next * 5) % Math.max(1, homes.length)];
  if (home) sendOnJob(town, g, "person", door, home, { site: s.id, role: "home" });
}

/**
 * The time away, caught up: every site worked by its whole crew throughout,
 * a load bought whenever the work reached the materials on hand, until the
 * time ran out, the money did, or it opened. Returns the projects that opened.
 */
export function catchUpWorks(
  g: Grid, owned: Partial<Record<GeneratorId, number>>, spend: (amount: number) => boolean, now: number,
  maxSeconds = 2 * 24 * 3600,
): ProjectId[] {
  const opened: ProjectId[] = [];
  for (const s of sitesOf(g)) {
    const b = s.build!, p = projectForStructure(s.def);
    if (!p) continue;
    let left = Math.min(maxSeconds, Math.max(0, (now - b.updatedAt) / 1000));
    const crew = buildersFor(p, b.priority, owned, s.w * s.h);
    while (left > 0 && crew > 0) {
      const cap = materialCap(b);
      const toCap = (cap - b.done) / crew;
      if (toCap > left) { b.done += crew * left; left = 0; break; }
      b.done = cap;
      left -= Math.max(0, toCap);
      if (b.delivered >= b.deliveries || !spend(b.cost / b.deliveries)) break;
      b.delivered++;
    }
    // And the trucks kept coming: the stock on hand as it would have been, so
    // a crew back on site is not left waiting for a load from the map's edge.
    while (crew > 0 && b.delivered < b.deliveries
      && (materialCap(b) - b.done) / (b.need / b.deliveries) < STOCK && spend(b.cost / b.deliveries)) {
      b.delivered++;
    }
    b.updatedAt = now;
    if (b.done >= b.need - 1e-6 && b.delivered >= b.deliveries) {
      delete s.build;
      opened.push(p.id);
    }
  }
  return opened;
}

/**
 * The placeable spot for a building nearest the middle of the map, or null.
 * For a building the company has earned already and is given, not built.
 */
export function nearestSpot(g: Grid, def: StructureDef, rules: PlaceRules): { x: number; y: number } | null {
  const cx = g.w / 2, cy = g.h / 2;
  let best: { x: number; y: number } | null = null, bestD = Infinity;
  for (let y = 0; y < g.h; y++) {
    for (let x = 0; x < g.w; x++) {
      const d = Math.hypot(x - cx, y - cy);
      if (d >= bestD || !validatePlacement(g, def, x, y, rules).ok) continue;
      best = { x, y };
      bestD = d;
    }
  }
  return best;
}

export { BUILDERS_PER_TILE };
