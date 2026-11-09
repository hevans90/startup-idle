/**
 * World v2 — HOW FINE EACH STREET IS: by the share of the homes on it with
 * every need of their kind met, three levels (`BEAUTY_AT`). A street rising a
 * level gets trees, then lamps and benches, then café tables, and bunting outside its shops
 * (@see street-props), and its houses get a little more to like.
 * @see BEAUTY_MOOD, plans/services-overhaul.md §4
 */
import { housedBy, residentsIn } from "../../game/housing";
import type { Grid, Structure } from "../grid";
import type { Network } from "../roads/network";
import { streetsOf, type Streets } from "../roads/streets";
import { NEEDS } from "./needs";
import { placesOf } from "./roads";
import { liveCoverage, needsMet, type Coverage } from "./services";
import { streetAt } from "./town-services";

/** The share of a street's homes with every need met for each level. */
export const BEAUTY_AT = [0.33, 0.66, 0.9] as const;
/** What each level adds to the mood of the houses on the street. */
export const BEAUTY_MOOD = [0, 2, 4, 6] as const;

export type Beauty = {
  /** Each street's level, 0–3, by its number. */
  street: Int8Array;
  /** The level of the street each road tile is on; -1 for a junction or no road. */
  tile: Int8Array;
  /** The level of the street each home is on, by id. */
  home: Map<number, number>;
  /** The homes on each street, by its number. */
  homes: Map<number, number[]>;
};

/** The level a share of homes with every need met makes. */
export const levelFor = (share: number) => BEAUTY_AT.filter((at) => share >= at).length;

/** A home with its every need met. */
export const fullyServed = (s: Structure, cover: Coverage) => {
  const who = housedBy(s.def)?.id;
  return !!who && NEEDS[who].length > 0 && needsMet(s, cover).length >= NEEDS[who].length;
};

/**
 * Every street's level: the homes with people in them on it — by the street
 * their door opens on — and the share of them served in full. Pure, for tests.
 */
export function beautyOf(g: Grid, streets: Streets, doors: ReadonlyMap<number, number>, served: (s: Structure) => boolean): Beauty {
  const homes = new Map<number, number[]>();
  for (const s of g.structures.values()) {
    if (s.build || !housedBy(s.def) || !residentsIn(s)) continue;
    const door = doors.get(s.id);
    const st = door === undefined ? -1 : streetAt(g, streets, door);
    if (st < 0) continue;
    homes.set(st, [...(homes.get(st) ?? []), s.id]);
  }
  const street = new Int8Array(streets.tiles.length);
  const home = new Map<number, number>();
  for (const [st, ids] of homes) {
    const level = levelFor(ids.filter((id) => served(g.structures.get(id)!)).length / ids.length);
    street[st] = level;
    for (const id of ids) home.set(id, level);
  }
  const tile = new Int8Array(g.w * g.h).fill(-1);
  for (let i = 0; i < tile.length; i++) if (streets.of[i] >= 0) tile[i] = street[streets.of[i]];
  return { street, tile, home, homes };
}

/** Each structure's door tile, by id. */
export function doorsOf(g: Grid, net: Network): Map<number, number> {
  const doors = new Map<number, number>();
  for (const p of placesOf(g, net)) if (p.kind === "door" && p.structure !== undefined) doors.set(p.structure, p.y * g.w + p.x);
  return doors;
}

/**
 * A FIXTURE'S STREETS, AT THE LEVELS IT SAYS: each street the level its first
 * tile is given, whatever is met on it — so every level can be looked at
 * side by side. Only ever set by a fixture. @see buildStreets
 */
const pinned = new WeakMap<Grid, (x: number, y: number) => number>();
export function pinBeauty(g: Grid, levelAt: (x: number, y: number) => number) { pinned.set(g, levelAt); }

/** A beauty with its streets set to the levels pinned for its map. Pure. */
export function pinnedBeauty(g: Grid, streets: Streets, b: Beauty, levelAt: (x: number, y: number) => number): Beauty {
  const street = new Int8Array(b.street.length);
  streets.tiles.forEach((ts, st) => { if (ts.length) street[st] = levelAt(ts[0] % g.w, Math.floor(ts[0] / g.w)); });
  const tile = new Int8Array(g.w * g.h).fill(-1);
  for (let i = 0; i < tile.length; i++) if (streets.of[i] >= 0) tile[i] = street[streets.of[i]];
  const home = new Map<number, number>();
  for (const [st, ids] of b.homes) for (const id of ids) home.set(id, street[st]);
  return { street, tile, home, homes: b.homes };
}

let memo: { g: Grid | null; rev: number; cover: Coverage | null; value: Beauty | null } = { g: null, rev: -1, cover: null, value: null };

/** Every street's level on this map now, worked out again when the map or what is met has changed. */
export function liveBeauty(g: Grid, net: Network): Beauty {
  const cover = liveCoverage(g, net);
  if (memo.g !== g || memo.rev !== g.rev || memo.cover !== cover || !memo.value) {
    const streets = streetsOf(g);
    const b = beautyOf(g, streets, doorsOf(g, net), (s) => fullyServed(s, cover));
    const pin = pinned.get(g);
    memo = { g, rev: g.rev, cover, value: pin ? pinnedBeauty(g, streets, b, pin) : b };
  }
  return memo.value!;
}
