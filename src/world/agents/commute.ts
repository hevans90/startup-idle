/**
 * World v2 — GOING TO WORK: how far each house is from somewhere its people
 * can work, and what that costs the company.
 *
 * Each kind of employee works at the building that opened them — interns at
 * the Founder's Garage, vibe coders at the Studio, 10x devs at the Campus — or
 * at an OFFICE for their kind, which the player can build anywhere on the
 * road. A house's COMMUTE is the way along the roads from its door to the
 * nearest of those, in tiles; and a long commute is time not at a desk:
 *  - up to `FREE` tiles, nothing lost;
 *  - beyond, a little lost a tile, down to `WORST`;
 *  - and no road to any workplace at all, `STRANDED`.
 * So where housing goes, and where offices go, is a choice the economy feels:
 * a sprawling town with one office at the end of it works at half speed.
 *
 * AND EVERY WORKPLACE HAS SO MANY DESKS. People take the nearest free desk:
 * the closest house and workplace fill first, and a house whose nearest is
 * full commutes on to the next. When every desk of a kind is taken, the rest
 * work without one, at `DESKLESS`. So a growing company needs desks as it
 * needs beds — an office is room to work as well as a shorter walk.
 * @see commuteFactor, attendance
 *
 * People living off the map work remotely, and lose nothing.
 */
import { housedBy, residentsIn } from "../../game/housing";
import { NEIGHBOUR } from "../../iso/dir";
import type { GeneratorId } from "../../state/generators.store";
import { idx, type Grid } from "../grid";
import { FERRY_TILES, ferryLinks } from "../boats/ferry-links";
import { connects } from "../roads/mask";
import { roadsKey } from "../roads/streets";
import { SETTLE_SEATS, lanesSettle } from "./lanes/graph";
import type { Network } from "../roads/network";
import { placesOf, type Place } from "./roads";
import { notable } from "../../game/machine";
import { cultureNow, cultureVersion } from "../../game/culture-now";
import { closuresVersion, houseWork, isClosed } from "../events/closures";

/** Where each kind works: the building that opened them, and their offices. */
export const WORKPLACES: Record<GeneratorId, readonly string[]> = {
  // The Garage, and the HQ it grows into: still where the interns go.
  intern: ["garage", "hq", "boardroom", "ipo", "office-intern"],
  vibe_coder: ["studio", "office-vibe"],
  // The Campus, and the Agency it grows into. @see LANDMARKS
  "10x_dev": ["campus", "agency", "office-10x"],
};

/** The kind a workplace is for, or null. */
export function workplaceKind(defId: string): GeneratorId | null {
  for (const [id, defs] of Object.entries(WORKPLACES)) if (defs.includes(defId)) return id as GeneratorId;
  return null;
}

/** Desks at each kind of workplace. @see seat */
export const DESKS: Record<string, number> = {
  garage: 20, hq: 20, boardroom: 20, ipo: 20, "office-intern": 40,
  studio: 30, "office-vibe": 40,
  campus: 10, agency: 10, "office-10x": 10,
};
/** What people manage with no desk to go to: perched wherever they can. */
export const DESKLESS = 0.35;
/** And with the Machine's Night Shift: working the empty desks at night. @see game/machine "nightshift" */
export const NIGHT_SHIFT = 0.7;
export const desklessShare = (): number => (notable("nightshift") ? NIGHT_SHIFT : DESKLESS);

/** Tiles of commute that cost nothing, what each one past them costs, and the least a commute leaves. */
export const FREE = 8;
export const PER_TILE = 0.0125;
export const WORST = 0.5;
/** What people with no road to any workplace manage. */
export const STRANDED = 0.25;
/** Tiles of road a house's door is from a workplace's to be beside it. @see Rules.nextDoor */
export const NEXT_DOOR = 3;

/** The share of a day's work a commute of `tiles` leaves; `null` tiles is no way there. */
export const commuteEfficiency = (tiles: number | null): number =>
  // And as far again as Shuttle Bus takes them. @see CARDS
  tiles === null ? STRANDED : Math.max(WORST, Math.min(1, 1 - (tiles - FREE - cultureNow().freeCommute) * PER_TILE));

/**
 * One house's commute: how far its people go (to the desk most of them
 * have), what it leaves of their work — the commute for those with a desk,
 * DESKLESS for those without — where to, and how many found no desk.
 */
export type Commute = { tiles: number | null; eff: number; to: number | null; deskless: number };

const DIRS = ["N", "E", "S", "W"] as const;

/**
 * Every house's commute, by its id: a breadth-first search along the roads,
 * one per kind, from the doors of every finished workplace of that kind at
 * once — so each house finds its nearest in one pass, however many offices
 * there are.
 */
export function commutesOf(g: Grid, places: readonly Place[]): Map<number, Commute> {
  return seat(g, places).commutes;
}

/** Every house's commute, how full each workplace is — desks taken, and desks — and how many of each kind work from home. */
export type Seating = { commutes: Map<number, Commute>; desks: Map<number, { used: number; of: number }>; home: Partial<Record<GeneratorId, number>> };

/** What a step of road up or down a level — onto a ramp — counts for on the way to work: a hill town's walk is longer. */
export const CLIMB = 2;

/**
 * The walk along the roads from some doors to every cell, in tiles — a ramp
 * counting `CLIMB` — and -1 where there is no way.
 */
export function walkFrom(g: Grid, starts: readonly number[], joins?: Uint8Array): Int32Array {
  const dist = new Int32Array(g.w * g.h).fill(-1);
  // A FERRY is a few tiles of road across the water, from its port's gate to the roads on the banks. @see ferryLinks
  const ferries = ferryLinks(g);
  // Steps of one or two: a bucket a distance, worked through in order.
  const buckets: number[][] = [[]];
  for (const i of starts) if (dist[i] < 0) { dist[i] = 0; buckets[0].push(i); }
  for (let d = 0; d < buckets.length; d++) {
    const bucket = buckets[d];
    if (!bucket) continue;
    for (let q = 0; q < bucket.length; q++) {
      const i = bucket[q];
      if (dist[i] !== d) continue;
      const x = i % g.w, y = (i - x) / g.w;
      for (let k = 0; k < 4; k++) {
        const dir = DIRS[k];
        if (joins ? !(joins[i] & (1 << k)) : !connects(g, x, y, dir)) continue;
        const [dx, dy] = NEIGHBOUR[dir];
        const j = idx(g, x + dx, y + dy);
        // CLOSED for road works: no way through. @see ROAD_WORKS
        if (isClosed(j)) continue;
        // Onto a ramp is up or down a level. @see Grid.ramp
        const nd = d + (g.ramp[j] && !g.deck[j] ? CLIMB : 1);
        if (dist[j] >= 0 && dist[j] <= nd) continue;
        dist[j] = nd;
        (buckets[nd] ??= []).push(j);
      }
      for (const j of ferries.get(i) ?? []) {
        const nd = d + FERRY_TILES;
        if (isClosed(j) || (dist[j] >= 0 && dist[j] <= nd)) continue;
        dist[j] = nd;
        (buckets[nd] ??= []).push(j);
      }
    }
  }
  return dist;
}

/**
 * WHICH WAYS ON EACH ROAD CELL HAS, a bit a way in {@link DIRS}' order: worked out once for many walks of the same
 * map — each asks it of every cell of road, and each asking is a look at both cells' heights, ramps and decks.
 * @see walkFrom
 */
export function joinsOf(g: Grid): Uint8Array {
  const out = new Uint8Array(g.w * g.h);
  for (let i = 0; i < out.length; i++) {
    if (!g.paved[i]) continue;
    const x = i % g.w, y = (i - x) / g.w;
    let m = 0;
    for (let k = 0; k < 4; k++) if (connects(g, x, y, DIRS[k])) m |= 1 << k;
    out[i] = m;
  }
  return out;
}

/**
 * WHO SITS WHERE: each kind's people living on the map, given desks at its
 * finished workplaces, the nearest pairs of house and workplace first. A
 * search along the roads from each workplace's door — a town has a handful
 * of workplaces of a kind, and the roads are a few thousand cells.
 */
export function seat(g: Grid, places: readonly Place[]): Seating {
  const doorOf = new Map<number, Place>();
  for (const p of places) if (p.kind === "door" && p.structure !== undefined) doorOf.set(p.structure, p);
  const commutes = new Map<number, Commute>();
  const desks = new Map<number, { used: number; of: number }>();
  const home: Partial<Record<GeneratorId, number>> = {};
  // THE CULTURE DECK'S RULES: Move Fast's sites open as they go up, and Hot
  // Desking's desks are anyone's. @see Rules
  const rules = cultureNow();
  const open = [...g.structures.values()].filter((s) => (!s.build || rules.openSites) && workplaceKind(s.def));
  // Each workplace's desks, as its own kind's cards make them.
  for (const w of open) desks.set(w.id, { used: 0, of: Math.round((DESKS[w.def] ?? 0) * cultureNow(workplaceKind(w.def)!).desks) });
  // (The roads' joins once for every workplace's search, and each workplace's search once for every kind that asks.)
  let joins: Uint8Array | undefined;
  const walks = new Map<number, Int32Array>();
  const roadsFrom = (start: number) => walks.get(start) ?? walks.set(start, walkFrom(g, [start], (joins ??= joinsOf(g)))).get(start)!;
  for (const who of Object.keys(WORKPLACES) as GeneratorId[]) {
    const houses = [...g.structures.values()].filter((s) => housedBy(s.def)?.id === who);
    const works = rules.anyDesk ? open : open.filter((s) => workplaceKind(s.def) === who);
    // THE CULTURE DECK: what the deskless manage, and who works from home —
    // needing no desk, walking nowhere. @see CARDS
    const deck = cultureNow(who);
    const deskless = Math.max(desklessShare(), deck.deskless);
    if (!houses.length) continue;
    // Every house and workplace a road joins, nearest first.
    // (Sorted as numbers — the tiles, then the house by its id, then the workplace as it came — and not by a
    // comparison called for every two of some thousands of pairs: the same order.)
    const byId = [...houses].sort((p, q) => p.id - q.id), rank = new Map(byId.map((h, k) => [h.id, k]));
    const NH = houses.length, NW = works.length;
    const keys: number[] = [];
    works.forEach((w, wi) => {
      const wd = doorOf.get(w.id);
      if (!wd) return;
      const dist = roadsFrom(idx(g, wd.x, wd.y));
      for (const h of houses) {
        const hd = doorOf.get(h.id);
        const t = hd ? dist[idx(g, hd.x, hd.y)] : -1;
        if (t >= 0) keys.push((t * NH + rank.get(h.id)!) * NW + wi);
      }
    });
    const sorted = Float64Array.from(keys).sort();
    const pairs: { house: number; work: number; tiles: number }[] = new Array(sorted.length);
    for (let k = 0; k < sorted.length; k++) {
      const v = sorted[k], wi = v % NW, r = (v - wi) / NW, hk = r % NH;
      pairs[k] = { house: byId[hk].id, work: works[wi].id, tiles: (r - hk) / NH };
    }
    const reachable = new Set(pairs.map((p) => p.house));
    // (Each house's nearest: its first pair, as they are sorted — not looked for down the whole list for every house.)
    const nearestOf = new Map<number, (typeof pairs)[number]>();
    for (const p of pairs) if (!nearestOf.has(p.house)) nearestOf.set(p.house, p);
    // Company Housing's rule: a house beside a workplace is all at work, at no desk.
    const beside = new Set(deck.nextDoor ? pairs.filter((p) => p.tiles <= NEXT_DOOR && workplaceKind(g.structures.get(p.work)!.def) === who).map((p) => p.house) : []);
    // Shuttle Bus's rule: those with no road are taken, and work in full.
    const atHome = (h: number, n: number) => (beside.has(h) || (deck.noStranded && !reachable.has(h)) ? n : Math.round(n * deck.remote));
    const left = new Map(houses.map((h) => [h.id, residentsIn(h) - atHome(h.id, residentsIn(h))]));
    const sat = new Map<number, { work: number; tiles: number; n: number }[]>();
    for (const p of pairs) {
      const want = left.get(p.house) ?? 0, room = desks.get(p.work)!;
      const n = Math.min(want, room.of - room.used);
      if (n <= 0) continue;
      room.used += n;
      left.set(p.house, want - n);
      const list = sat.get(p.house) ?? [];
      list.push({ work: p.work, tiles: p.tiles, n });
      sat.set(p.house, list);
    }
    for (const h of houses) {
      const n = residentsIn(h), list = sat.get(h.id) ?? [], desklessN = left.get(h.id) ?? 0, homeN = atHome(h.id, n);
      home[who] = (home[who] ?? 0) + homeN;
      if (!reachable.has(h.id)) {
        // No road to anywhere its people could work — but those at home.
        commutes.set(h.id, { tiles: null, eff: n ? (homeN + (n - homeN) * STRANDED) / n : homeN ? 1 : STRANDED, to: null, deskless: 0 });
        continue;
      }
      // An empty house: the commute its people would have, to the nearest.
      const nearest = nearestOf.get(h.id)!;
      if (n === 0) {
        commutes.set(h.id, { tiles: nearest.tiles, eff: commuteEfficiency(nearest.tiles), to: nearest.work, deskless: 0 });
        continue;
      }
      const main = list.reduce<{ work: number; tiles: number; n: number } | null>((m, x) => (!m || x.n > m.n ? x : m), null);
      const work = list.reduce((sum, x) => sum + x.n * commuteEfficiency(x.tiles), 0) + desklessN * deskless + homeN;
      commutes.set(h.id, {
        tiles: main?.tiles ?? nearest.tiles, eff: work / n, to: main?.work ?? nearest.work, deskless: desklessN,
      });
    }
  }
  return { commutes, desks, home };
}

/**
 * WHAT OF THE MAP WHO SITS WHERE IS READ FROM, as a key: its roads (@see roadsKey) — which cells, at what heights,
 * with which ramps and decks: what joins, and what a step costs; each building's door on them; the buildings, and
 * what each is; and the ferries' links. (Who lives where, the sites, the cards and the closures are kept beside it.)
 */
function seatKey(g: Grid, places: readonly Place[]): string {
  let a = 0, b = 0;
  for (const p of places) if (p.kind === "door" && p.structure !== undefined) a = (Math.imul(a ^ (p.structure + 1), 0x01000193) + p.y * g.w + p.x) | 0;
  for (const s of g.structures.values()) {
    let d = 0;
    for (let k = 0; k < s.def.length; k++) d = (Math.imul(d, 31) + s.def.charCodeAt(k)) | 0;
    b = (Math.imul(b ^ (s.id + 1), 0x01000193) + d + (s.build ? 7 : 0)) | 0;
  }
  const ferries = ferryLinks(g);
  let f = "";
  if (ferries.size) for (const [from, to] of ferries) f += `${from}:${to.join(",")};`;
  return `${roadsKey(g)}|${g.structures.size}|${a}|${b}|${f}`;
}

let memo: { g: Grid | null; rev: number; sites: number; people: string; deck: number; closures: number; what: string; value: Seating } = {
  g: null, rev: -1, sites: -1, people: "", deck: -1, closures: -1, what: "", value: { commutes: new Map(), desks: new Map(), home: {} },
};

/**
 * Who sits where on this map now, worked out again only when the map has
 * been edited, a site has opened, people have moved in or out, or the culture
 * deck has changed — roads, buildings, residents and cards are what it depends on. Shared by the economy,
 * which asks every tick, and the labels. @see Grid.rev
 */
export function liveSeating(g: Grid, net: Network): Seating {
  // And the sites still going up: one opening is a new workplace, though
  // finishing a build is not an edit of the map.
  let sites = 0, a = 0, b = 0;
  for (const st of g.structures.values()) {
    if (st.build) sites++;
    if (housedBy(st.def)) { const n = residentsIn(st); a += n; b = (b * 31 + n * st.id) | 0; }
  }
  const people = `${a}:${b}`;
  // And the culture deck, which moves desks, commutes and who stays home.
  const deck = cultureVersion();
  // And a junction closed, or opened again. @see setClosed
  const closures = closuresVersion();
  // (While the map's new lanes are being built, and the frames after that have their own work, who sat where: a
  // road laid is nobody's way to work in the frame it is laid. @see lanes/graph lanesSettle)
  if (memo.g === g && memo.rev !== g.rev && memo.sites === sites && memo.people === people && memo.deck === deck && memo.closures === closures && lanesSettle(g) > SETTLE_SEATS) return memo.value;
  if (memo.g !== g || memo.rev !== g.rev || memo.sites !== sites || memo.people !== people || memo.deck !== deck || memo.closures !== closures) {
    // AN EDIT THAT TOUCHES NONE OF WHAT IT IS READ FROM leaves everyone sitting where they sat: the roads, the
    // doors on them, the buildings and the ferries. A tile of grass raised in a field was every house's way to
    // every workplace found again. @see seatKey
    const places = placesOf(g, net), what = seatKey(g, places);
    const same = memo.g === g && memo.what === what && memo.sites === sites && memo.people === people && memo.deck === deck && memo.closures === closures;
    memo = { g, rev: g.rev, sites, people, deck, closures, what, value: same ? memo.value : seat(g, places) };
  }
  return memo.value;
}

/** Every house's commute on this map now. @see liveSeating */
export const liveCommutes = (g: Grid, net: Network): Map<number, Commute> => liveSeating(g, net).commutes;

/**
 * WHAT COMMUTING LEAVES of each kind's work: the share of a full day's work
 * its people do, averaged over everyone — those living on the map by their
 * house's commute, and those living off it, remotely, in full. One for a kind
 * with nobody here.
 */
export function commuteFactor(
  g: Grid, commutes: ReadonlyMap<number, Commute>,
  owned: Partial<Record<GeneratorId, number>>, remote: Partial<Record<string, number>>,
): Partial<Record<GeneratorId, number>> {
  const out: Partial<Record<GeneratorId, number>> = {};
  for (const who of Object.keys(WORKPLACES) as GeneratorId[]) {
    // Remote beds count only as far as there are people in them.
    let people = Math.min(remote[who] ?? 0, owned[who] ?? 0), work = people;
    for (const s of g.structures.values()) {
      if (housedBy(s.def)?.id !== who) continue;
      const n = residentsIn(s);
      people += n;
      // On a tenants' strike, at a share. @see setHouseWork
      work += n * (commutes.get(s.id)?.eff ?? 1) * houseWork(s.id);
    }
    out[who] = people > 0 ? work / people : 1;
  }
  return out;
}
