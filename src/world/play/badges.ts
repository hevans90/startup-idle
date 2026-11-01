/**
 * World v2 — A BADGE ON A BUILDING: an icon and a few characters, coloured by
 * how things stand, in place of a label that talks all the time. What a
 * building wears depends on what the player is looking at:
 *  - AT REST, only a PROBLEM — something that wants the player: a tank
 *    spilling, an unhappy house, a stalled site, a building short of water;
 *    everything that is fine wears nothing;
 *  - in the WATER view, what water is about: cooling, slop, processors;
 *  - in the MOOD view, every house's morale;
 *  - with the BUILD tool in hand, free beds and desks near the pointer.
 * The full label is the pointer's to ask for. @see BuildingLabels, infoFor
 */
import { processorKind } from "../../game/processors";
import { housedBy, isLot, residentsIn } from "../../game/housing";
import { projectForStructure } from "../../game/projects";
import type { GeneratorId } from "../../state/generators.store";
import type { Structure } from "../grid";
import { structureDef } from "../structures/def";
import { workplaceKind } from "../agents/commute";
import { tankFor } from "../projects/cooling";
import { processorBusy, slopTankOf } from "../slop/tanks";
import type { InfoContext } from "./building-info";

export type BadgeTone = "bad" | "warn" | "ok" | "info";
export type BadgeIcon = "spill" | "slop" | "mood" | "stalled" | "paused" | "damage" | "cool" | "power" | "desk" | "idle" | "road" | "busy" | "bed";
export type Badge = { icon: BadgeIcon; text: string; tone: BadgeTone };
export type BadgeView = "rest" | "water" | "mood" | "build";

/** What a badge's colour says, worst first: the one kept where two meet. */
export const TONE_RANK: Record<BadgeTone, number> = { bad: 3, warn: 2, ok: 1, info: 0 };

/** Cooled under this, a building wants water; under the second, badly. */
const COOLED = 0.95, COOLED_BADLY = 0.6;
/** A slop tank this full is worth a look before it spills. */
const SLOP_HIGH = 0.9;
/** Morale this low is not just down but bad. */
const MORALE_BAD = -15;

/** Extra the badges need from the live game, beside what labels do. */
export type BadgeContext = InfoContext & {
  /** People of each kind living on the map with no desk to go to. @see liveSeating */
  deskless?: Partial<Record<GeneratorId, number>>;
  /** Houses whose unhappiness comms says for the whole town: no badge of their own. @see townProblems */
  quiet?: ReadonlySet<number>;
};

const pct = (f: number) => `${Math.round(f * 100)}%`;
const signed = (n: number) => (n > 0 ? `+${n}` : `${n}`);

/** A building's badge for a view, or null for none. */
export function badgeFor(s: Structure, ctx: BadgeContext, view: BadgeView): Badge | null {
  if (view === "water") return waterBadge(s);
  if (view === "mood") return moodBadge(s, ctx);
  if (view === "build") return buildBadge(s, ctx);
  return problemOf(s, ctx);
}

/** WHAT IS WRONG with a building, the worst of it, or null with nothing. */
export function problemOf(s: Structure, ctx: BadgeContext): Badge | null {
  const def = structureDef(s.def);
  if (!def || s.def === "levee") return null;
  if (ctx.repairedIn?.(s.id) != null) return { icon: "damage", text: "Flood damaged", tone: "bad" };
  // A SITE: stalled for money, or paused.
  if (s.build) {
    if (!projectForStructure(s.def)) return null;
    if (s.build.priority === 0) return { icon: "paused", text: "Paused", tone: "warn" };
    if (ctx.stalled.has(s.id)) return { icon: "stalled", text: "Stalled", tone: "bad" };
    return null;
  }
  // A HOUSE: unhappy, or cut off from work.
  const h = housedBy(s.def);
  if (h) {
    if (residentsIn(s) <= 0) return null;
    if (ctx.commutes.get(s.id)?.tiles === null) return { icon: "road", text: "No road to work", tone: "warn" };
    const mood = ctx.moods.get(s.id)?.total;
    if (mood !== undefined && mood < 0 && !ctx.quiet?.has(s.id)) return { icon: "mood", text: signed(mood), tone: mood <= MORALE_BAD ? "bad" : "warn" };
    return null;
  }
  // SLOP: a tank spilling, or about to.
  const tank = slopTankOf(s.id);
  if (tank && tank.rate > 0) {
    if (tank.spilling) return { icon: "spill", text: "Slop spilling", tone: "bad" };
    if (tank.capacity > 0 && tank.level / tank.capacity >= SLOP_HIGH) return { icon: "slop", text: `Slop ${pct(tank.level / tank.capacity)}`, tone: "warn" };
  }
  // SHORT OF WATER, what drinks.
  const cool = tankFor(s.id);
  if (cool && cool.share < COOLED) return { icon: "cool", text: `${pct(cool.share)} cooled`, tone: cool.share < COOLED_BADLY ? "bad" : "warn" };
  if (s.def === "rack" && ctx.racksPowered && !ctx.racksPowered.has(s.id)) return { icon: "power", text: "Half power", tone: "warn" };
  // A PROCESSOR with nothing coming in.
  if (processorKind(s.def) && processorBusy(s.id) < 0.02) return { icon: "idle", text: "Idle", tone: "warn" };
  // DESKS FULL, while people of its kind have none. @see seat
  const kind = workplaceKind(s.def);
  const d = ctx.desks?.get(s.id);
  if (kind && d && d.used >= d.of && (ctx.deskless?.[kind] ?? 0) > 0) return { icon: "desk", text: "Desks full", tone: "warn" };
  return null;
}

/** THE WATER VIEW: how well what drinks is cooled, how full each slop tank, how busy each processor. */
function waterBadge(s: Structure): Badge | null {
  if (s.build) return null;
  const cool = tankFor(s.id);
  if (cool) return { icon: "cool", text: pct(cool.share), tone: cool.share >= COOLED ? "ok" : cool.share >= COOLED_BADLY ? "warn" : "bad" };
  const tank = slopTankOf(s.id);
  if (tank && tank.rate > 0) {
    if (tank.spilling) return { icon: "spill", text: "Spilling", tone: "bad" };
    const f = tank.capacity > 0 ? tank.level / tank.capacity : 0;
    return { icon: "slop", text: pct(f), tone: f >= 0.75 ? "warn" : "ok" };
  }
  if (processorKind(s.def)) {
    const b = processorBusy(s.id);
    return b < 0.02 ? { icon: "idle", text: "Idle", tone: "warn" } : { icon: "busy", text: pct(b), tone: "ok" };
  }
  return null;
}

/** THE MOOD VIEW: every lived-in house's morale. */
function moodBadge(s: Structure, ctx: BadgeContext): Badge | null {
  if (!housedBy(s.def) || residentsIn(s) <= 0) return null;
  const mood = ctx.moods.get(s.id)?.total;
  if (mood === undefined) return null;
  return { icon: "mood", text: signed(mood), tone: mood >= 0 ? "ok" : mood <= MORALE_BAD ? "bad" : "warn" };
}

/** THE BUILD TOOL: beds free in each house, and desks in each workplace. */
function buildBadge(s: Structure, ctx: BadgeContext): Badge | null {
  if (s.build) return null;
  const h = isLot(s.def) ? housedBy(s.def) : null;
  if (h) {
    const free = h.slots - residentsIn(s) - (ctx.arriving.get(s.id) ?? 0);
    return free > 0 ? { icon: "bed", text: `${free} free`, tone: "info" } : null;
  }
  const d = ctx.desks?.get(s.id);
  if (d && workplaceKind(s.def)) return { icon: "desk", text: `${d.used}/${d.of}`, tone: d.used >= d.of ? "warn" : "info" };
  return null;
}

/** Roughly how big a badge is on the screen, px: an icon, the text at 10 px, padding. */
const badgeSize = (b: Badge, more: number) => ({ w: 26 + (b.text.length + (more ? 7 : 0)) * 6.2, h: 18 });

/** Two badges saying the same thing merge from this far apart, px: a street of one problem is one badge. */
const SAME_GAP = 48;

/**
 * WHERE THE BADGES GO: the worst first, each where it stands unless it would
 * meet one already placed — or come near one saying the same — then that one
 * counts it instead. Worst first, so what is kept where two meet is what most
 * wants the player.
 */
export function placeBadges<T extends { x: number; y: number; badge: Badge; band: number }>(items: readonly T[], gap = 2): (T & { more: number })[] {
  const order = [...items].sort((a, b) => TONE_RANK[b.badge.tone] - TONE_RANK[a.badge.tone] || b.band - a.band);
  const placed: (T & { more: number })[] = [];
  for (const it of order) {
    const s = badgeSize(it.badge, 0);
    const hit = placed.find((p) => {
      const t = badgeSize(p.badge, p.more);
      const g = p.badge.icon === it.badge.icon && p.badge.text === it.badge.text ? SAME_GAP : gap;
      return Math.abs(p.x - it.x) * 2 < s.w + t.w + g && Math.abs(p.y - it.y) * 2 < s.h + t.h + g;
    });
    if (hit) hit.more++;
    else placed.push({ ...it, more: 0 });
  }
  return placed;
}
