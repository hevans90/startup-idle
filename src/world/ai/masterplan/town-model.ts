/**
 * World v2 — THE TOWN MODEL: what a town would earn once it has settled, from
 * the game's own rules, without running it. @see settledTown — the planner's
 * measure of a layout.
 * @see planTown, plans/singularity.md §4b
 *
 * IT CHANGES THE GRID IT IS GIVEN (houses grown, people moved in): hand it a
 * copy. @see cloneGrid
 */
import { housedBy, isLot } from "../../../game/housing";
import { serializeWorld, deserializeWorld } from "../../io/serialize";
import type { Grid, Structure } from "../../grid";
import { createNetwork } from "../../roads/network";
import { placesOf } from "../../agents/roads";
import { desireAt, desireMapsOf, type DesireMaps } from "../../agents/desirability";
import { DECLINE_MARGIN, GROW_AT, MOOD, MOOD_LIMIT, MOVE_IN_AT, needsCounted, type MoodParts } from "../../agents/mood-rules";
import { NEEDS, needsAt } from "../../agents/needs";
import { seat, type Commute } from "../../agents/commute";
import { TIERS, coverageOf, desirabilityAt, tierOf, withTier, type Tier } from "../../agents/services";
import { CHECK_EVERY, createTownServices, stepTown, type TownHands } from "../../agents/town-services";
import { commit, createHistory } from "../../edit/commands";
import { structureDef } from "../../structures/def";
import { placeCommand, validatePlacement } from "../../structures/place";
import { satisfactionRevenueMultiplier } from "../../../game/satisfaction";
import type { GeneratorId } from "../../../state/generators.store";

/** A copy of a grid, to plan on. */
export const cloneGrid = (g: Grid): Grid =>
  deserializeWorld(JSON.parse(JSON.stringify(serializeWorld(g, { terrain: [], paved: [null] })))).grid;

/** The kinds of people, for per-kind sums. */
const KINDS: readonly GeneratorId[] = ["intern", "vibe_coder", "10x_dev"];

/** What a settled town comes to. @see settledTown */
export type Settled = {
  /** Beds once grown, and how many of them are lived in. */
  beds: number;
  /** The day's work: residents times what the walk to work leaves them. */
  work: number;
  /** Steady income, in units of work: each kind's work times what its mood does to its pay. */
  income: number;
  /** Each kind's mood, resident-weighted, as the town leans it. @see moodOffsets */
  moodByKind: Partial<Record<GeneratorId, number>>;
  /** The tier each house settles at. */
  tiers: Map<number, Tier>;
};

/**
 * THE TIER A HOUSE'S MOOD WOULD GROW IT TO, from `from`: up a tier at a time
 * while the mood holds the next one's, crowding counted, and its needs met
 * allow it. @see desirabilityAt, needsAt
 */
export function projectTier(m: MoodParts, who: GeneratorId, from: Tier = "t0"): Tier {
  let t = from;
  const met = needsCounted(m);
  for (let k = TIERS.indexOf(from) + 1; k < TIERS.length; k++) {
    const next = TIERS[k];
    if (desirabilityAt(m, t, next, NEEDS[who].includes("quiet")) < GROW_AT[next] || met < needsAt(who, next)) break;
    t = next;
  }
  return t;
}
/** Whether one tier is at least another. */
export const atLeast = (t: Tier, want: Tier) => TIERS.indexOf(t) >= TIERS.indexOf(want);

/** Looks the town takes at what it needs, at most, each round. */
const OPEN_LOOKS = 12;

/**
 * WHAT THE TOWN WOULD OPEN FOR ITSELF, opened: its own look at what its people
 * lack (`stepTown`), again and again, with no wait between, till it opens
 * nothing more — the first service of each need, so the plan comes out the
 * same each time. Whether anything opened. @see stepTown
 */
function townOpens(g: Grid): boolean {
  const t = createTownServices(), h = createHistory();
  const rules = { needsRoad: true };
  const hands: TownHands = {
    canPlace: (def, x, y) => { const d = structureDef(def); return !!d && validatePlacement(g, d, x, y, rules).ok; },
    place: (def, x, y) => {
      const cmd = placeCommand(g, structureDef(def)!, x, y, rules);
      if (!cmd) return null;
      commit(g, h, cmd);
      return cmd.structures?.added[0]?.id ?? null;
    },
    clear: () => {},
    rand: () => 0,
  };
  let opened = false;
  for (let k = 0; k < OPEN_LOOKS; k++) {
    const net = createNetwork(g);
    t.since = CHECK_EVERY;
    t.wait.clear();
    if (!stepTown(t, g, net, coverageOf(g, placesOf(g, net)), 0, hands).some((e) => e.kind === "open")) break;
    opened = true;
  }
  return opened;
}

/** Rounds of a tier at a time: three to grow from nought to a tower, and some to settle. */
const ROUNDS = 8;

/** A house's mood with the commute it actually has, desks and all, in place of the walk alone. */
function moodWith(g: Grid, maps: DesireMaps, s: Structure, who: GeneratorId, c: Commute | undefined): MoodParts | null {
  const m = desireAt(g, maps, s.x, s.y, who);
  if (!m) return null;
  if (!c) return m;
  const parts = m.parts.filter((p) => p.why !== "long commute" && p.why !== "no road to work");
  if (c.tiles === null) parts.push({ why: "no road to work", points: MOOD.stranded });
  else if (c.eff < 1) parts.push({ why: c.deskless > 0 ? "no desk" : "long commute", points: Math.round((1 - c.eff) * 10 * MOOD.perTenthLost) });
  const total = Math.max(-MOOD_LIMIT, Math.min(MOOD_LIMIT, parts.reduce((n, p) => n + p.points, 0)));
  return { total, parts };
}

/**
 * What a town comes to once it has settled, by the game's own rules: what
 * the town opens for its people opened (`townOpens`); every
 * house grown — from the tier it was bought at, never below — as far as its
 * mood holds, crowding and all (`desirabilityAt`), and its needs met allow
 * (`needsAt`); filled, but
 * for 10x devs who will not move into a house under their mood (`MOVE_IN_AT`);
 * everyone seated, and the commute that leaves them — desks running out
 * included — fed back into the mood, round again till it holds. Then its
 * work, and its income: the work each kind does times what its mood does to
 * its pay. @see satisfactionRevenueMultiplier
 */
export function settledTown(g: Grid): Settled {
  const net = createNetwork(g);
  const places = placesOf(g, net);
  let maps = desireMapsOf(g, places);
  // LOTS, which grow: not the Campus, whose beds are as many as there are 10x devs. @see CAMPUS_BEDS
  const houses = [...g.structures.values()].filter((s) => !s.build && isLot(s.def));
  // THE TIER BOUGHT: what it was, less what it has grown since.
  const floor = new Map(houses.map((s) => {
    const k = TIERS.indexOf(tierOf(s.def) ?? "t0");
    return [s.id, TIERS[Math.max(0, k - (s.grown ?? 0))]] as const;
  }));
  const tiers = new Map(floor);
  const moods = new Map<number, MoodParts>();
  let commutes = new Map<number, Commute>();
  /** Each house's tier the round before, to tell a house that settled from one that swings. */
  let before = new Map(tiers);
  const house = (s: Structure, t: Tier, m: MoodParts | undefined) => {
    tiers.set(s.id, t);
    s.def = withTier(s.def, t);
    const who = housedBy(s.def)!.id, fussy = MOVE_IN_AT[who];
    s.residents = fussy !== undefined && (m?.total ?? -Infinity) < fussy ? 0 : housedBy(s.def)!.slots;
  };
  // A TIER AT A TIME, as the game grows them: up when the mood holds the next
  // tier's, down — only what grew, and only well below — as the game declines
  // them; then everyone seated again, and the commute felt.
  for (let round = 0; round < ROUNDS; round++) {
    before = new Map(tiers);
    let moved = false;
    for (const s of houses) {
      const who = housedBy(s.def)!.id;
      const m = moodWith(g, maps, s, who, round ? commutes.get(s.id) : undefined);
      if (!m) continue;
      moods.set(s.id, m);
      const t = tiers.get(s.id)!, k = TIERS.indexOf(t), next = TIERS[k + 1];
      let to = t;
      const met = needsCounted(m);
      if (next && desirabilityAt(m, t, next, NEEDS[who].includes("quiet")) >= GROW_AT[next] && met >= needsAt(who, next)) to = next;
      else if (k > TIERS.indexOf(floor.get(s.id)!) && (m.total < GROW_AT[t] - DECLINE_MARGIN || met < needsAt(who, t))) to = TIERS[k - 1];
      if (to !== t) moved = true;
      house(s, to, m);
    }
    // What the town opens for the people it now has, felt next round.
    if (townOpens(g)) { moved = true; maps = desireMapsOf(g, placesOf(g, createNetwork(g))); }
    commutes = seat(g, placesOf(g, createNetwork(g))).commutes;
    if (!moved) break;
  }
  // A HOUSE STILL SWINGING is taken at the lower of its last two tiers.
  let swung = false;
  for (const s of houses) {
    const now = tiers.get(s.id)!, was = before.get(s.id)!;
    if (TIERS.indexOf(was) < TIERS.indexOf(now)) { swung = true; house(s, was, moods.get(s.id)); }
  }
  if (swung) commutes = seat(g, placesOf(g, createNetwork(g))).commutes;
  // AND WHAT IT DOES.
  let beds = 0, work = 0;
  const kindWork: Partial<Record<GeneratorId, number>> = {}, kindMood: Partial<Record<GeneratorId, number>> = {}, kindPeople: Partial<Record<GeneratorId, number>> = {};
  for (const s of houses) {
    const who = housedBy(s.def)!.id, n = s.residents ?? 0;
    beds += housedBy(s.def)!.slots;
    const w = n * (commutes.get(s.id)?.eff ?? 1);
    work += w;
    kindWork[who] = (kindWork[who] ?? 0) + w;
    kindMood[who] = (kindMood[who] ?? 0) + n * (moods.get(s.id)?.total ?? 0);
    kindPeople[who] = (kindPeople[who] ?? 0) + n;
  }
  const moodByKind: Partial<Record<GeneratorId, number>> = {};
  let income = 0;
  for (const who of KINDS) {
    const n = kindPeople[who] ?? 0;
    if (!n) continue;
    moodByKind[who] = (kindMood[who] ?? 0) / n;
    income += (kindWork[who] ?? 0) * satisfactionRevenueMultiplier(moodByKind[who]!);
  }
  return { beds, work, income, moodByKind, tiers };
}
