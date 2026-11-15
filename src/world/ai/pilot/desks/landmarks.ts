/**
 * World v2 — THE PILOT'S LANDMARKS DESK: each project as it opens, where to
 * put it, and what it waits for.
 *
 * A project is a job like any other, WORTH WHAT IT OPENS: the Studio the
 * vibe coders behind it (the hire that waits on `project:studio` says so
 * itself), a wonder its bonus on the company's income, a tier the tiers
 * that rise over it. So a landmark competes with a hire and an upgrade on
 * one scale, and is built when it is the best thing to do — not first
 * because it is on a list, nor never because nothing asked for it.
 *
 * WHAT IT WAITS ON is named, and where another desk can do it, is that
 * desk's job: the upgrade its gate asks for, the people, the tier below,
 * the site in hand finished (one project at a time), a street with room.
 *
 * A project's materials are paid for LOAD BY LOAD as it goes up, out of the
 * same money the pilot spends: what a site under way still owes is kept
 * back. @see owedOnSites, PROJECTS
 */
import { GENERATOR_TYPES, useGeneratorStore, type GeneratorId } from "../../../../state/generators.store";
import { LANDMARKS, PROJECTS, gateParts, projectCost, tierBelow, type ProjectDef, type ProjectId } from "../../../../game/projects";
import { nextPerSet, upgradeSet } from "../../../../game/upgrade-sets";
import { UPGRADES, useUpgradeStore } from "../../../../state/upgrades.store";
import { aiRules, getNetwork, playRules, useWorldStore } from "../../../../state/world.store";
import { placesOf } from "../../../agents/roads";
import { hasRiver, mapRiver, tileDepthOf } from "../../../boats/river";
import { loadPriceMult } from "../../../events/convoy";
import { idx, type Grid } from "../../../grid";
import { startProject, whyNot } from "../../../play/build-actions";
import { builtProjects, projectUnderWay, ruledOut, upgradeFrom } from "../../../projects/works";
import { lateralGround } from "../../../sewers/reach";
import { structureDef, type StructureDef } from "../../../structures/def";
import { validatePlacement, type PlaceRules } from "../../../structures/place";
import { keepsPorts, portTileSet, portTiles } from "../../../water/ports";
import { townCentre } from "../../masterplan/plan";
import type { Purse } from "../chooser";
import type { Job, Need } from "../job";
import type { Desk } from "../pilot";

/** The slop processors' projects: the Water desk's, with the sewers they stand on. */
const WATERS: readonly ProjectId[] = ["refinery", "dataplant", "contentfarm"];
/**
 * THE CORE: what opens a kind, and the head office through every tier. One
 * project goes up at a time, so anything else waits till these stand: begun
 * the moment it opened, the Harbour — cheap, worth a little, and a long way
 * from the yard — took twenty-one minutes to build with the Campus and the HQ
 * waiting behind it, and the company could be sold eleven minutes later.
 */
const isCore = (p: ProjectDef) => !!p.unlocks || LANDMARKS.find((l) => l.id === "hq")!.tiers.includes(p.id);
/** Looks between two searches of the map for a site, at the least. @see town desk LOOK_AGAIN */
const LOOK_AGAIN = 6;
/** How many of a kind a project that opens it is taken to bring, for its worth. */
const FIRST_HIRES = 10;
/**
 * What a project is worth that opens a part of the game rather than income —
 * managers, mandates, ports, leaders — or multiplies something other than
 * money, as a share of income. Set high on purpose: a project costs little
 * against the company and takes a long time to go up, a load at a time, so
 * the one thing to do with it is start it early. At a twentieth of income the
 * HQ stood open for twenty minutes before it was begun, and the Boardroom and
 * the IPO Tower over it each waited on the last.
 */
const UNLOCK_WORTH = 1;
const OPENS_WORTH = 0.25;
const OTHER_BONUS_WORTH = 0.3;

/**
 * How far in from where the road leaves the map the garage is put, tiles.
 * THE GARAGE IS THE COMPANY'S YARD: every other site's loads come from it —
 * but its own line's, the HQ, the Boardroom and the IPO Tower that rise over
 * it, come one truck at a time from where a road leaves the map. Put in the
 * middle of the map, thirty-five tiles from there, the Boardroom's fourteen
 * loads took forty-six minutes with its crew of thirty-six stood waiting.
 * @see depotFor
 */
const GARAGE_IN = 6;

/**
 * How far round the yard is kept for the company's own buildings, tiles: no
 * lot is zoned there. Houses go on the best frontage there is, and took the
 * road by the garage before the Campus was open to build — which then stood
 * in the middle of town, twenty tiles of the one busy road from its loads,
 * three minutes a truck. @see yardSite, town desk `forLots`
 */
export const YARD_KEPT = 8;

/** Whether a tile is in the yard, kept for landmarks. */
export function inYard(g: Grid, x: number, y: number): boolean {
  const at = yardSite(g);
  return Math.abs(x - at.x) <= YARD_KEPT && Math.abs(y - at.y) <= YARD_KEPT;
}

/** Where the garage should stand: a little in from the road's way out of the map, toward the middle; the town's middle with no way out. */
export function yardSite(g: Grid): { x: number; y: number } {
  if (yard && yard.grid === g) return yard.at;
  const at = yardNow(g);
  yard = { grid: g, at };
  return at;
}
let yard: { grid: Grid; at: { x: number; y: number } } | null = null;
function yardNow(g: Grid): { x: number; y: number } {
  const net = getNetwork();
  const out = net ? placesOf(g, net).find((pl) => pl.kind === "gateway") : undefined;
  if (!out) return townCentre(g);
  const dx = g.w / 2 - out.x, dy = g.h / 2 - out.y, d = Math.hypot(dx, dy) || 1;
  return { x: Math.round(out.x + (dx / d) * GARAGE_IN), y: Math.round(out.y + (dy / d) * GARAGE_IN) };
}

/**
 * THE GAME'S RULES WITH THE RIVERS AS THEY STAND, for what must be on a bank
 * or near one: the click that places one reads them the same. @see playRules
 */
export function riverRules(g: Grid): PlaceRules {
  const field = useWorldStore.getState().getWaterField();
  return { ...playRules(g), ...(field ? { rivers: mapRiver(g, tileDepthOf(field.columns)) } : {}) };
}

/**
 * WHERE A LANDMARK GOES: the nearest spot to the yard that keeps the ports —
 * covering no building's, and with its own slop let out on open ground, where
 * a sewer connection can be laid. The Studio put by the road with its port on
 * the asphalt spilled from the fiftieth vibe coder on, and no job could mend
 * it. @see nearestSpot, keepsPorts, town desk `drained`
 */
function siteFor(g: Grid, def: StructureDef, rules: PlaceRules): { x: number; y: number } | null {
  const near = yardSite(g), taken = portTileSet(g), { w, h } = def.footprint;
  let best: { x: number; y: number } | null = null, bestD = Infinity;
  for (let y = 0; y < g.h; y++) {
    for (let x = 0; x < g.w; x++) {
      const d = Math.hypot(x - near.x, y - near.y);
      if (d >= bestD || !validatePlacement(g, def, x, y, rules).ok || !keepsPorts(g, taken, def.id, x, y, w, h)) continue;
      const out = portTiles(g, def.id, x, y, w, h).filter((p) => p.port.fluid === "slop" && p.port.dir === "out");
      if (!out.every((p) => lateralGround(g, idx(g, p.x, p.y)))) continue;
      best = { x, y };
      bestD = d;
    }
  }
  return best;
}

const STREET: Need = { id: "street", says: "a street with room beside it" };
/**
 * What a building that stands at the water waits on, with nowhere to stand:
 * NOT a street. The town's blocks are laid where the town is, not down to the
 * river, and no number of them makes a quay — said to wait on a street, the
 * Harbour had block after block paved for it, one over the last, till the
 * middle of town was a slab of asphalt and it still had nowhere. The Harbour
 * desk lays it. @see harbourDesk
 */
const QUAY: Need = { id: "quay", says: "a road at the water's edge" };

const kindName = (id: GeneratorId, n = 2) => { const name = GENERATOR_TYPES.find((g) => g.id === id)?.name ?? id; return n === 1 ? name : `${name}s`; };

/** What a project does, in a line. */
function opens(p: ProjectDef): string {
  if (p.unlocks) return `it opens hiring ${kindName(p.unlocks)}`;
  if (p.bonus) return Object.entries(p.bonus).map(([k, v]) => `${k} ×${v}`).join(", ") + " for good";
  if (p.grants) return `it opens ${p.grants}`;
  return p.pitch;
}

/** Income a second a project is worth, itself: what waits on it adds its own. @see choose */
function gainOf(p: ProjectDef, income: number): number {
  let gain = 0;
  // A NEW KIND is taken to be worth the company over again — each has been worth far more — and never less than its first few at their bare rate.
  if (p.unlocks) gain += Math.max(FIRST_HIRES * (GENERATOR_TYPES.find((g) => g.id === p.unlocks)?.baseProduction ?? 0), income * UNLOCK_WORTH);
  if (p.bonus?.money) gain += (p.bonus.money - 1) * income;
  if (p.bonus?.valuation) gain += (p.bonus.valuation - 1) * income * OTHER_BONUS_WORTH;
  if (p.bonus?.innovation) gain += (p.bonus.innovation - 1) * income * OTHER_BONUS_WORTH;
  if (p.grants) gain += income * OPENS_WORTH;
  return gain;
}

/** What a site under way still owes for its loads: money the pilot keeps back, or the site stalls. */
export function owedOnSites(g: Grid): number {
  let owed = 0;
  for (const s of g.structures.values()) {
    const b = s.build;
    if (b && b.deliveries > 0) owed += b.cost * (1 - b.delivered / b.deliveries);
  }
  return owed * loadPriceMult();
}

export function landmarksDesk(): Desk {
  /** A site for each project, kept for the map as it stands. */
  const sites = new Map<ProjectId, { x: number; y: number } | null>();
  let seen: { grid: Grid; rev: number } | null = null, since = LOOK_AGAIN;

  const propose = (purse: Purse): Job[] => {
    const g = useWorldStore.getState().grid;
    since++;
    if (!seen || seen.grid !== g || (seen.rev !== g.rev && since >= LOOK_AGAIN)) { seen = { grid: g, rev: g.rev }; since = 0; sites.clear(); }
    const built = builtProjects(g), busy = projectUnderWay(g);
    const owned = Object.fromEntries(useGeneratorStore.getState().generators.map((x) => [x.id, x.amount])) as Partial<Record<GeneratorId, number>>;
    const ups = useUpgradeStore.getState(), unlocked = new Set(ups.unlockedUpgradeIds), offered = nextPerSet(ups.availableUpgrades);
    const river = hasRiver(g);
    const jobs: Job[] = [];
    for (const p of PROJECTS) {
      if (built.has(p.id) || busy?.id === p.id || WATERS.includes(p.id)) continue;
      if (p.needsMap === "river" && !river) continue;
      // A FORK: the one that multiplies money, unless the other is already begun.
      if (p.rival && (ruledOut(g, p) || (!p.bonus?.money && !ruledOut(g, PROJECTS.find((r) => r.id === p.rival)!)))) continue;

      const needs: Need[] = [];
      // ITS GATE: the upgrade, the people, the building it comes after.
      for (const part of gateParts(p.gate, owned, unlocked)) {
        if (part.met) continue;
        if (part.kind === "upgrade") {
          // The next of its set on offer is the one to buy, on the way to it. @see nextPerSet
          const next = offered.find((u) => upgradeSet(u) === upgradeSet({ id: part.id }));
          needs.push({ id: `upgrade:${next?.id ?? part.id}`, says: UPGRADES.find((u) => u.id === part.id)?.name ?? part.id });
        } else if (part.kind === "staff") needs.push({ id: `hire:${part.who}`, says: `${part.need} ${kindName(part.who, part.need)}` });
        else needs.push({ id: `project:${part.project}`, says: `the ${PROJECTS.find((x) => x.id === part.project)?.name ?? part.project}` });
      }
      // THE TIER IT RISES OVER.
      const below = tierBelow(p.id);
      if (below && !built.has(below.id)) needs.push({ id: `project:${below.id}`, says: `the ${below.name}` });
      // THE CORE FIRST.
      const core = isCore(p) ? undefined : PROJECTS.find((x) => isCore(x) && !built.has(x.id));
      if (core && !needs.some((n) => n.id === `project:${core.id}`)) needs.push({ id: `project:${core.id}`, says: `the ${core.name}` });
      // ONE PROJECT AT A TIME.
      if (busy) needs.push({ id: "site", says: `the ${busy.name} finished` });
      // A SITE: where its landmark stands, or the nearest spot to the town there is.
      const from = upgradeFrom(g, p), def = structureDef(p.structure);
      if (!def) continue;
      // (Looked for only once nothing else is in its way: and so never kept as "nowhere" from before it was looked for.)
      const byWater = !!(def.placement?.waterside || def.placement?.riverside || def.placement?.nearRiver);
      if (!from && !needs.length && !sites.has(p.id)) sites.set(p.id, siteFor(g, def, def.placement?.riverside ? riverRules(g) : byWater ? { ...riverRules(g), owned: aiRules(g).owned } : aiRules(g)));
      const at = from ? { x: from.x, y: from.y } : sites.get(p.id) ?? null;
      if (!from && !at && !needs.length) needs.push(byWater ? QUAY : STREET);

      jobs.push({
        id: `project:${p.id}`, desk: "landmarks",
        says: `Build the ${p.name}`, why: opens(p), at: at ?? undefined, puts: p.structure,
        cost: projectCost(p, purse.income), gain: gainOf(p, purse.income),
        needs: needs.length ? needs : undefined,
        done: () => builtProjects(g).has(p.id) || projectUnderWay(g)?.id === p.id,
        run: () => {
          if (!at) return { ok: false, because: "nowhere to put it", retry: "on-change" };
          startProject(p.id, at);
          // BEGUN, where a site of it now stands. Its loads are paid for as they come. @see owedOnSites
          if (projectUnderWay(g)?.id === p.id || builtProjects(g).has(p.id)) return { ok: true };
          sites.delete(p.id);
          return { ok: false, because: whyNot()?.toLowerCase() ?? "it would not start there", retry: "on-change" };
        },
      });
    }
    return jobs;
  };
  return { id: "landmarks", propose };
}
