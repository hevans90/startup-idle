/**
 * World v2 — THE PILOT'S TOWN DESK: somewhere for people to live and
 * somewhere for them to work, A DISTRICT AT A TIME.
 *
 * A district is planned whole (`layoutDistrict`): a square of blocks in a ring
 * of road, its lots and its office sites, on the nearest bare ground joined to
 * the town (`findDistrictSite`). Then it is built in order:
 *
 *  - ITS STREETS FIRST, the join to the town, then the ring, then the streets
 *    inside (`street`): each laid ahead of need, worth the lots it fronts.
 *  - A LOT for a kind whose beds are nearly all taken (`beds:<kind>`), on the
 *    district's next site that fronts a street OPEN to traffic — never one
 *    still being built; it waits for that.
 *  - AN OFFICE for a kind short of desks (`desks:<kind>`), counted by the beds
 *    its houses have now, not what they may grow to; on an office site of the
 *    district, where its slop has open ground to come out on.
 *
 * When its lots are all built, or an office is needed and it has no site
 * left, the next district is planned beside the town. @see world/districts
 */
import { buildCost, roadCost } from "../../../../game/build-cost";
import { fusedInto } from "../../../../game/fusion";
import { hasLots, housedBy, roomFor } from "../../../../game/housing";
import { useFounderStore } from "../../../../state/founder.store";
import { useGeneratorStore, type GeneratorId } from "../../../../state/generators.store";
import { aiRules, getNetwork, playRules, useWorldStore } from "../../../../state/world.store";
import { netIdAt } from "../../../roads/network";
import { DESKLESS, DESKS, WORKPLACES } from "../../../agents/commute";
import { idx, inBounds, structureAt, type Grid } from "../../../grid";
import { paveRoad, placeStructure } from "../../../play/build-actions";
import { nearestSpot } from "../../../projects/works";
import { onRoadJob } from "../../../roads/jobs";
import { isPaved } from "../../../roads/mask";
import { structureDef } from "../../../structures/def";
import { validatePlacement, type PlaceRules } from "../../../structures/place";
import { districtRoadAt, districtSize, layoutDistrict, type DistrictPlan, type DistrictSpec } from "../../../districts/layout";
import { routeRoad, runsOf, type Cell } from "../../../districts/route";
import { findDistrictSite } from "../../../districts/site";
import { townCentre } from "../../masterplan/plan";
import { desksShort, type Wants } from "../../masterplan/schedule";
import { PLAIN, styleOf, type Style } from "../../masterplan/style";
import type { Job, Need, Outcome } from "../job";
import type { Desk } from "../pilot";
import { lateralGround } from "../../../sewers/reach";
import { portTileSet, portTiles } from "../../../water/ports";
import { inYard } from "./landmarks";
import { sewerAsks } from "./water";

/** Looks between two tries at planning a district when the last found nowhere: planning walks the whole map. */
const PLAN_AGAIN = 40;
/** What a lot's beds are taken to be worth, against a hire into each: they have still to be hired into. */
const BED_WORTH = 0.5;
/** What desks nobody is short of yet are worth, against desks for people perched now. */
const AHEAD_WORTH = 0.25;
/** Houses the company may have off its districts, on any open street near work: while the first district's streets go in. */
const STARTER_LOTS = 4;
/** The farthest a lot is zoned from desks for its kind, tiles each way: past it the commute makes a house too unhappy to move into. */
const REACH = 14;
/** District streets being built at once, at most. */
const STREETS_AT_ONCE = 2;
/** Tries at joining a district cut off from the town before it is left. */
const REJOINS = 3;
/** What a street is worth for each lot it opens, against the lot's own worth: it is laid ahead of the lots. */
const FRONTAGE_WORTH = 0.25;
/** The AI's districts: two blocks by two strips. */
const DISTRICT = { across: 2, strips: 2 } as const;
/** The beds a lot is planned for, sizing a district's office sites: a house grown. Its offices go up only as beds are filled. */
const PLANNED_TIER = "t2";

const STREET: Need = { id: "street", says: "a street with room beside it" };
const OPENING: Need = { id: "street:open", says: "the district's streets to open" };
/** What a building that makes slop waits on where there is ground for it and no sewer by it: the Water desk's to lay. */
const sewerFor = (who: GeneratorId): Need => ({ id: `sewer:${who}`, says: "a sewer to take its slop" });
const NO_ROOM: Need = { id: "room", says: "room to grow, and none is left on this map" };

type Run = { from: Cell; to: Cell };
type Site = { x: number; y: number };

/** The district in hand: its plan, its roads as strokes (the join first), its lot and office sites. */
type Hand = { plan: DistrictPlan; runs: Run[]; lots: Site[]; offices: Site[] };

/** How it lays a town out: the Model's by the traits fused into it; anyone else's plainly. */
export const townStyle = (): Style => (useFounderStore.getState().selectedFounderId === "model" ? styleOf(fusedInto("model")) : PLAIN);

/** The tiles of a straight run. */
function tilesOf(r: Run): Cell[] {
  const out: Cell[] = [];
  const dx = Math.sign(r.to.x - r.from.x), dy = Math.sign(r.to.y - r.from.y);
  for (let x = r.from.x, y = r.from.y; ; x += dx, y += dy) {
    out.push({ x, y });
    if (x === r.to.x && y === r.to.y) break;
  }
  return out;
}
/** A run's stretches still to lay, each a stroke: road already there is never stroked over again, and regraded. */
function stretches(g: Grid, r: Run): Run[] {
  const out: Run[] = [];
  let from: Cell | null = null, to: Cell | null = null;
  for (const c of tilesOf(r)) {
    const lay = inBounds(g, c.x, c.y) && !isPaved(g, c.x, c.y) && !onRoadJob(g, c.x, c.y);
    if (lay) { from ??= c; to = c; continue; }
    if (from && to) out.push({ from, to });
    from = to = null;
  }
  if (from && to) out.push({ from, to });
  return out;
}
/** Tiles of a run still to be ordered: not paved, not on order. */
const unlaid = (g: Grid, r: Run) => tilesOf(r).filter((c) => inBounds(g, c.x, c.y) && !isPaved(g, c.x, c.y) && !onRoadJob(g, c.x, c.y)).length;
/** Tiles of a run ordered and not open yet. */
const building = (g: Grid, r: Run) => tilesOf(r).some((c) => inBounds(g, c.x, c.y) && onRoadJob(g, c.x, c.y));

/**
 * FRONTAGE THAT IS OPEN: a footprint beside a paved tile no road job is still
 * building. The player may build beside a road on order; the AI waits till it
 * is open, so what it builds can be reached the day it is done.
 */
export function frontsOpenRoad(g: Grid, def: string, x: number, y: number, joined: (x: number, y: number) => boolean = () => true): boolean {
  const d = structureDef(def);
  if (!d) return false;
  const { w, h } = d.footprint;
  const open = (x: number, y: number) => isPaved(g, x, y) && !onRoadJob(g, x, y) && joined(x, y);
  for (let k = 0; k < w; k++) for (const yy of [y - 1, y + h]) if (open(x + k, yy)) return true;
  for (let k = 0; k < h; k++) for (const xx of [x - 1, x + w]) if (open(xx, y + k)) return true;
  return false;
}

/**
 * THE TOWN'S ROADS: those joined to a way in off the map, which is how
 * everyone arrives. A street cut off from them is no frontage at all.
 */
function townRoads(g: Grid): (x: number, y: number) => boolean {
  const net = getNetwork();
  if (!net) return () => true;
  const ids = new Set<number>();
  for (let x = 0; x < g.w; x++) for (const y of [0, g.h - 1]) if (isPaved(g, x, y)) ids.add(netIdAt(net, g, x, y));
  for (let y = 0; y < g.h; y++) for (const x of [0, g.w - 1]) if (isPaved(g, x, y)) ids.add(netIdAt(net, g, x, y));
  return (x, y) => ids.has(netIdAt(net, g, x, y));
}

/** Whether nothing stands on a footprint yet. */
function bare(g: Grid, def: string, x: number, y: number): boolean {
  const d = structureDef(def);
  if (!d) return false;
  for (let dy = 0; dy < d.footprint.h; dy++) for (let dx = 0; dx < d.footprint.w; dx++) if (!inBounds(g, x + dx, y + dy) || structureAt(g, x + dx, y + dy) >= 0) return false;
  return true;
}

/** Take a step through the player's own actions, and look: one that changed nothing on the map is a refusal. */
function take(g: Grid, act: () => boolean, def?: string, at?: Site): Outcome {
  const before = g.rev, built = g.structures.size;
  const ok = act();
  if (ok && (g.rev !== before || g.structures.size !== built)) return { ok: true };
  // Why, in the game's own words where it has them.
  if (def && at) {
    const d = structureDef(def);
    const check = d && validatePlacement(g, d, at.x, at.y, playRules(g));
    if (check && !check.ok && check.reason) return { ok: false, because: check.reason.toLowerCase(), retry: "on-change" };
    if ((buildCost(def)?.toNumber() ?? 0) > 0) return { ok: false, because: "not enough money", retry: 5 };
  }
  return { ok: false, because: "the ground would not take it", retry: "on-change" };
}

/** A new district's plan, for these kinds, near the town's middle: null when there is no ground for one. */
export function planDistrict(g: Grid, kinds: readonly GeneratorId[], rules: PlaceRules, near: Cell): Hand | null {
  const spec: DistrictSpec = { ...DISTRICT, houses: kinds.map((k) => `kit:${k}.${PLANNED_TIER}`), desks: true };
  const { w, h } = districtSize(spec);
  const site = findDistrictSite(g, w, h, { near, owned: rules.owned, maxRelief: 6, roadAt: districtRoadAt });
  if (!site) return null;
  const plan = layoutDistrict(g, site.x0, site.y0, spec, { ...rules, needsSewer: false });
  const lots = plan.buildings.filter((b) => housedBy(b.def)).map((b) => ({ x: b.x, y: b.y }));
  const offices = plan.buildings.filter((b) => b.def.startsWith("office")).map((b) => ({ x: b.x, y: b.y }));
  if (!lots.length) return null;
  return { plan, runs: joinedOrder(site.connector ? runsOf(site.connector) : [], plan.runs), lots, offices };
}

/**
 * THE ORDER STREETS ARE LAID IN: the join to the town, then always one that
 * meets what is laid already — so every street open is reachable — rows
 * before cross streets, as the rows are what the lots front.
 */
export function joinedOrder(join: readonly Run[], runs: readonly Run[]): Run[] {
  const out: Run[] = [...join];
  const laid = new Set<string>();
  const lay = (r: Run) => { for (const c of tilesOf(r)) laid.add(`${c.x},${c.y}`); };
  join.forEach(lay);
  const meets = (r: Run) => tilesOf(r).some((c) => [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => laid.has(`${c.x + dx},${c.y + dy}`)));
  const left = [...runs];
  while (left.length) {
    const row = (r: Run) => (r.from.y === r.to.y ? 0 : 1);
    const k = laid.size ? left.map((r, i) => ({ r, i })).filter(({ r }) => meets(r)).sort((a, b) => row(a.r) - row(b.r))[0]?.i ?? 0 : 0;
    const [r] = left.splice(k, 1);
    out.push(r); lay(r);
  }
  return out;
}

export function townDesk(): Desk {
  let hand: Hand | null = null;
  /** Looks since a district was asked for and none found. */
  let sinceNone = PLAN_AGAIN;
  let seen: Grid | null = null;
  /** Sites refused, and runs refused: not offered again in this district. */
  const bad = new Set<number>(), skipped = new Set<string>();
  /** Set when a district has no office site left and one is wanted: the next is planned. */
  let full = false;
  /** Times this district has been joined to the town again. */
  let rejoins = 0;

  /** Take a step; refused, it is not offered again. */
  const attempt = (_g: Grid, out: Outcome, refuse: () => void): Outcome => {
    if (!out.ok && out.because !== "not enough money") { refuse(); return { ...out, retry: 3 }; }
    return out;
  };

  /** A site of the hand's that is still to build and may be built on one day. */
  const pending = (g: Grid, s: Site) => !bad.has(idx(g, s.x, s.y)) && structureAt(g, s.x, s.y) < 0;

  const propose = (): Job[] => {
    const g = useWorldStore.getState().grid;
    const gens = useGeneratorStore.getState();
    const kinds = gens.generators.map((x) => x.id as GeneratorId).filter(hasLots);
    if (!kinds.length) return [];
    const style = townStyle();
    const base = aiRules(g);
    // EVERY PORT KEPT CLEAR: a house on the tile an office's slop comes out at, and it spills for good. @see portTileSet
    const ports = portTileSet(g);
    const rules: PlaceRules = { ...base, owned: (x, y) => (base.owned?.(x, y) ?? true) && !inYard(g, x, y) && !ports.has(idx(g, x, y)) };
    if (seen !== g) { hand = null; bad.clear(); skipped.clear(); sinceNone = PLAN_AGAIN; full = false; seen = g; }
    sinceNone++;

    // THE DISTRICT IN HAND, or the next: when every lot of this one is built or refused, or it has no office site left for one wanted.
    const spent = hand && (full || !hand.lots.some((s) => pending(g, s)));
    // NOT BEFORE THERE IS WORK: planned before the garage, the first district went where the map's middle was, a commute away.
    const work = [...g.structures.values()].some((s) => Object.values(WORKPLACES).some((d) => d.includes(s.def)));
    if ((!hand || spent) && work && sinceNone >= PLAN_AGAIN) {
      const next = planDistrict(g, kinds, rules, townCentre(g, style));
      // What is left of the last, kept: its lots still to build come first, its streets still to lay with them.
      if (next && hand) {
        const old = hand;
        next.lots = [...old.lots.filter((s) => pending(g, s)), ...next.lots];
        next.runs = [...old.runs.filter((r) => !skipped.has(JSON.stringify(r)) && unlaid(g, r) > 0), ...next.runs];
      }
      if (next || !hand) { hand = next; skipped.clear(); full = false; rejoins = 0; }
      sinceNone = next ? PLAN_AGAIN : 0;
    }
    const h = hand;

    const joined = townRoads(g);
    const fronts = (def: string, x: number, y: number) => frontsOpenRoad(g, def, x, y, joined);
    // CUT OFF FROM THE TOWN, its streets all laid: its join was refused, or built over. Joined again, by the cheapest way there is now.
    if (h && !h.runs.some((r) => !skipped.has(JSON.stringify(r)) && unlaid(g, r) > 0) && !h.runs.some((r) => building(g, r))
      && !h.plan.roads.some((c) => isPaved(g, c.x, c.y) && joined(c.x, c.y)) && rejoins < REJOINS) {
      rejoins++;
      const { x0, y0, w, h: hh } = h.plan;
      const ring = h.plan.roads.filter((c) => c.x === x0 || c.y === y0 || c.x === x0 + w - 1 || c.y === y0 + hh - 1);
      const inside = (x: number, y: number) => x >= x0 && y >= y0 && x < x0 + w && y < y0 + hh;
      const path = routeRoad(g, ring, { blocked: inside, goal: (x, y) => isPaved(g, x, y) && joined(x, y) });
      if (path && path.length > 1) h.runs.push(...runsOf(path));
    }

    /** The district's ground and its join's: no starter lot on them. */
    const planned = new Set<number>();
    if (h) {
      for (let y = h.plan.y0; y < h.plan.y0 + h.plan.h; y++) for (let x = h.plan.x0; x < h.plan.x0 + h.plan.w; x++) if (inBounds(g, x, y)) planned.add(idx(g, x, y));
      for (const r of h.runs) for (const c of tilesOf(r)) if (inBounds(g, c.x, c.y)) planned.add(idx(g, c.x, c.y));
    }

    const jobs: Job[] = [];
    const earns = (who: GeneratorId) => gens.getGeneratorMoneyPerSecond(who, 1);
    const name = (who: GeneratorId) => gens.generators.find((x) => x.id === who)?.name ?? who;

    // THE NEXT STREET OF THE DISTRICT: the join first, then the ring, then the streets inside.
    // A FEW AT A TIME: the crews are the town's, shared with its landmarks, and nine streets ordered at once opened none for minutes.
    const underWay = h ? h.runs.filter((r) => building(g, r)).length : 0;
    const opening = underWay > 0;
    const run = underWay >= STREETS_AT_ONCE ? null : h?.runs.find((r) => !skipped.has(JSON.stringify(r)) && unlaid(g, r) > 0) ?? null;
    if (run) {
      const piece = stretches(g, run)[0];
      const fresh = unlaid(g, piece);
      // Worth the lots along it, and more for the first, which joins the district to the town.
      const along = h!.lots.filter((s) => pending(g, s) && tilesOf(run).some((c) => Math.abs(c.x - s.x) + Math.abs(c.y - s.y) === 1)).length;
      const lotWorth = Math.max(...kinds.map((k) => (housedBy(`kit:${k}.t0`)?.slots ?? 0) * earns(k) * BED_WORTH));
      jobs.push({
        id: "street", desk: "town", says: "Lay a street of the district", why: "the district's lots front it",
        at: piece.to, cost: roadCost(fresh).toNumber(), gain: Math.max(1, along) * lotWorth * FRONTAGE_WORTH,
        run: () => attempt(g, take(g, () => paveRoad(piece.from, piece.to)), () => skipped.add(JSON.stringify(run))),
      });
    }
    /** What a building with no open frontage waits on: a street to lay, a street being built, or room. */
    const wait: Need[] = [run ? STREET : opening ? OPENING : NO_ROOM];

    /** Whether desks for a kind stand, or are going up, within a commute of a tile. */
    const workplaces = [...g.structures.values()].filter((x) => DESKS[x.def]);
    const reached = (who: GeneratorId, s: Site) => workplaces.some((x) => (WORKPLACES[who] ?? []).includes(x.def)
      && Math.max(0, x.x - s.x, s.x - (x.x + x.w - 1)) + Math.max(0, x.y - s.y, s.y - (x.y + x.h - 1)) <= REACH);
    /** The district's office sites an office of a kind could go on now: bare, its slop with ground to come out on, on an open street. */
    const officeSites = (who: GeneratorId) => {
      const def = (WORKPLACES[who] ?? []).find((x) => x.startsWith("office")) ?? "";
      const d = structureDef(def);
      if (!d || !h) return { def, d, all: [] as Site[], open: [] as Site[] };
      const drained = (s: Site) => portTiles(g, def, s.x, s.y, d.footprint.w, d.footprint.h)
        .filter((p) => p.port.fluid === "slop" && p.port.dir === "out").every((p) => lateralGround(g, idx(g, p.x, p.y)));
      const all = h.offices.filter((s) => pending(g, s) && bare(g, def, s.x, s.y) && drained(s));
      return { def, d, all, open: all.filter((s) => fronts(def, s.x, s.y)) };
    };

    // A LOT, for each kind whose beds are nearly all taken: the district's next site on an open street, within a commute of desks.
    for (const who of kinds) {
      const def = `kit:${who}.t0`, beds = housedBy(def)?.slots ?? 0;
      const amount = gens.generators.find((x) => x.id === who)?.amount ?? 0;
      const room = Math.floor(roomFor(who, amount));
      if (!(beds > 0) || room >= beds) continue;
      const d = structureDef(def)!;
      const ready = h?.lots.filter((s) => pending(g, s) && fronts(def, s.x, s.y) && validatePlacement(g, d, s.x, s.y, rules).ok) ?? [];
      const inDistrict = ready.find((s) => reached(who, s)) ?? null;
      // DESKS FIRST, where the district is past a commute from any: an office on its own ground, then its houses.
      if (!inDistrict && ready.length) {
        const o = officeSites(who);
        const at = o.d && o.open.find((s) => validatePlacement(g, o.d!, s.x, s.y, rules).ok);
        if (at && o.def) {
          const odef = o.def;
          jobs.push({
            id: `near:${who}`, desk: "town", says: `An office for the ${name(who)}s' new district`, why: "their houses would be too far from a desk",
            at, puts: odef, cost: buildCost(odef)?.toNumber() ?? 0, gain: beds * earns(who) * BED_WORTH,
            run: () => attempt(g, take(g, () => placeStructure(odef, at), odef, at), () => bad.add(idx(g, at.x, at.y))),
          });
        }
      }
      // THE FIRST FEW, on whatever open street is nearest work, while the district's streets go in: off the district and its join.
      const houses = [...g.structures.values()].filter((x) => housedBy(x.def)).length;
      const site = inDistrict ?? (houses < STARTER_LOTS && work
        ? nearestSpot(g, d, { ...rules, owned: (x, y) => (rules.owned?.(x, y) ?? true) && fronts(def, x, y) && !planned.has(idx(g, x, y)) }, townCentre(g, style))
        : null);
      jobs.push({
        id: `beds:${who}`, desk: "town",
        says: `Zone a lot for ${name(who)}s`, why: room > 0 ? `only ${room} ${room === 1 ? "bed" : "beds"} left` : "every bed is taken",
        at: site ?? undefined, puts: def, cost: buildCost(def)?.toNumber() ?? 0, gain: beds * earns(who) * BED_WORTH,
        needs: site ? undefined : !inDistrict && ready.length ? [{ id: `near:${who}`, says: "an office near the district" }] : wait,
        run: () => (site ? attempt(g, take(g, () => placeStructure(def, site), def, site), () => bad.add(idx(g, site.x, site.y))) : { ok: false, because: "no open frontage", retry: "on-change" }),
      });
    }

    // AN OFFICE, for each kind short of desks, on an office site of the district.
    sewerAsks.clear();
    const wants: Wants = { rules, kinds, offices: true, style };
    for (const short of desksShort(g, wants)) {
      const who = short.who;
      const { def, d, all: sites, open } = officeSites(who);
      if (!d) continue;
      if (h && !sites.length) full = true;
      const site = open.find((s) => validatePlacement(g, d, s.x, s.y, rules).ok) ?? null;
      // NOWHERE FOR IT but for a sewer: there is ground, and the Water desk is asked for one. @see sewerAsks
      const dry = site ? null : rules.needsSewer ? open.find((s) => validatePlacement(g, d, s.x, s.y, { ...rules, needsSewer: false }).ok) ?? null : null;
      if (dry) sewerAsks.set(who, { x: dry.x, y: dry.y, w: d.footprint.w, h: d.footprint.h });
      const desks = DESKS[def] ?? 0;
      const perched = Math.min(desks, Math.max(0, short.now)), coming = Math.min(desks, Math.max(0, short.ahead)) - perched;
      jobs.push({
        id: `desks:${who}`, desk: "town",
        says: `An office for the ${name(who)}s`,
        why: short.now > 0 ? `${short.now} ${name(who)}${short.now === 1 ? " has" : "s have"} no desk` : "their houses have more beds than desks",
        at: (site ?? dry) ?? undefined, puts: def, cost: buildCost(def)?.toNumber() ?? 0,
        gain: earns(who) * (1 - DESKLESS) * (perched + Math.max(0, coming) * AHEAD_WORTH),
        needs: site ? undefined : dry ? [sewerFor(who)] : wait,
        run: () => (site ? attempt(g, take(g, () => placeStructure(def, site), def, site), () => bad.add(idx(g, site.x, site.y))) : { ok: false, because: "no open frontage", retry: "on-change" }),
      });
    }
    return jobs;
  };

  return { id: "town", propose };
}
