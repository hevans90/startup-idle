/**
 * World v2 — LIFE ON THE PAVEMENTS: walkers keeping to the right of theirs,
 * getting by the slow ones on the left when nobody is coming, and squeezing
 * over for those who are; walking in twos and threes, a child by the hand;
 * joggers; dogs on leads, stopping to sniff; and now and then somebody
 * stopping to look in a shop window, or two who meet stopping for a chat.
 *
 * A 1-D walk along each walker's own line, a step a frame: who is near is
 * found by where they are, and all a walker does about them is how far to the
 * side of its line it walks and how fast it may go. @see town stepTown
 */
import { NEIGHBOUR } from "../../iso/dir";
import { TILES_PER_M } from "./cars/models";
import { structureAt, type Grid } from "../grid";
import { serviceDef, serviceIn } from "./needs";
import { HOLD_GAP_M, type Breed } from "./people/people-format";
import type { Place } from "./roads";
import { along, type Mover, type Town } from "./town";

/** How far right of its line a walker keeps, tiles; and as far as it goes either way. */
export const KEEP = 0.03;
const SIDE_MAX = 0.06;
/** Out to the left, getting by someone slower. */
const OVERTAKE = -0.045;
/** Abreast, side to side; a child, hand in hand; and in file, one behind the other, tiles. */
const ABREAST = 0.065;
export const HAND_GAP = HOLD_GAP_M * TILES_PER_M;
const IN_FILE = 0.12;
/** How far ahead a walker minds those in front, and those coming. */
const LOOK = 0.6;
/** Closer than this to someone in the way, and they slow to their pace. */
const BEHIND = 0.14;
/**
 * STOPPING: the chance two who meet stop for a chat, and one passing a shop
 * stops at its window; and for how long, least and most, seconds.
 */
const CHAT = 0.12;
const BROWSE = 0.2;
const PAUSE = [4, 12] as const;
/** A DOG: how far ahead of its walker on the lead, tiles; and its sniffs, how often and how long. */
const DOG_AHEAD = 0.13;
const DOG_SIDE = -0.045;
const SNIFF_EVERY = [5, 14] as const;
const SNIFF_FOR = [1.5, 4] as const;
/** The lead's length: further back than this, and the walker waits for the dog. */
const LEAD = 0.1;

/** A dog on a lead, walking along its walker's line: where along and to the side, and what it is doing. */
export type Dog = {
  breed: Breed; coat: number;
  s: number; side: number; x: number; y: number; z: number; heading: number; phase: number;
  /** Seconds left of a sniff, and till the next. */
  sniff: number; next: number;
};

/** A small hash, 0–1. */
export const hash = (a: number, b: number, salt: number) => {
  let h = Math.imul(a ^ salt, 0x9e3779b1);
  h = Math.imul(h ^ b ^ (h >>> 15), 0x85ebca6b);
  // Mixed through, so ids one apart are nothing alike.
  h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
};

/** Walking, as walkers go: on foot, on the pavements, not sat or at work. */
const walking = (m: Mover) => m.kind === "person" && !!m.walk && !m.sit && !m.job;

/** On a crossing now: out in the road. */
const crossing = (m: Mover) => {
  const w = m.walk;
  if (!w) return false;
  const x = w.crossings[w.k];
  // (Set off over it from the kerb too: not stopping there now.)
  return !!x && (m.s > x.s0 - 0.05 || w.on) && m.s < x.s1 + 0.05;
};

/** The shop windows: a point on the pavement before each shop door, and the way to face it. */
type Window = { x: number; y: number; face: number };
let windowsFor: { places: Place[]; out: Window[] } | null = null;
function windowsOf(t: Town, g: Grid): Window[] {
  if (windowsFor?.places === t.places) return windowsFor.out;
  const out: Window[] = [];
  for (const p of t.places) {
    if (p.kind !== "door" || p.structure === undefined || p.building) continue;
    const s = g.structures.get(p.structure);
    const sv = s && serviceIn(s);
    if (!sv || !serviceDef(sv)?.shop) continue;
    for (const d of ["N", "E", "S", "W"] as const) {
      const [dx, dy] = NEIGHBOUR[d];
      if (structureAt(g, p.x + dx, p.y + dy) !== p.structure) continue;
      out.push({ x: p.x + dx * 0.37, y: p.y + dy * 0.37, face: Math.atan2(dy, dx) });
    }
  }
  windowsFor = { places: t.places, out };
  return out;
}

/**
 * A STEP OF PAVEMENT LIFE, before the walkers move: for each, how far to the
 * side of its line it means to be (`sideTo`) and the fastest it may go
 * (`cap`); who stops, and for how long. Then, after they have moved, their
 * dogs. @see stepDogs
 */
export function stepWalkers(t: Town, g: Grid, h: number): void {
  const walkers = t.movers.filter(walking);
  const byId = new Map<number, Mover>();
  for (const m of walkers) byId.set(m.id, m);
  // Who is near: by where they are, half a tile to a bucket.
  const grid = new Map<number, Mover[]>();
  const key = (x: number, y: number) => (Math.floor(x * 2) + 4096) * 8192 + Math.floor(y * 2) + 4096;
  for (const m of walkers) {
    const k = key(m.x, m.y), l = grid.get(k);
    if (l) l.push(m); else grid.set(k, [m]);
  }
  const near = (m: Mover, fn: (o: Mover) => void) => {
    const bx = Math.floor(m.x * 2), by = Math.floor(m.y * 2);
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
      for (const o of grid.get((bx + i + 4096) * 8192 + by + j + 4096) ?? []) if (o !== m) fn(o);
    }
  };
  // Each leader's company, and who is holding whose hand.
  const company = new Map<number, Mover[]>();
  for (const m of walkers) {
    const lead = m.group && byId.get(m.group.lead);
    if (!lead) { m.group = undefined; continue; }
    const l = company.get(lead.id);
    if (l) l.push(m); else company.set(lead.id, [m]);
  }
  for (const m of walkers) if (m.hand !== undefined && !byId.has(m.hand)) m.hand = undefined;
  const windows = windowsOf(t, g);

  for (const m of walkers) {
    m.cap = Infinity;
    // STOOD STILL a while: turned to the window, or to whoever they are talking to.
    if (m.pause) {
      m.pause.left -= h;
      if (m.pause.left <= 0) m.pause = undefined;
      else { m.cap = 0; continue; }
    }
    const p = along(m, m.s), rx = -p.dy, ry = p.dx;
    const lead = m.group && byId.get(m.group.lead);
    if (lead) {
      // IN COMPANY: in their place by whoever leads, at their pace. Side by
      // side, or one behind the other when someone is coming; a child always
      // by the hand.
      const k = m.group!.k, busy = lead.busy ?? false;
      const abreast = m.hand !== undefined || (k === 1 && !busy);
      const slot = abreast ? lead.s : lead.s - IN_FILE * (busy ? k : 1);
      const gap = m.hand !== undefined ? HAND_GAP : ABREAST;
      m.sideTo = abreast ? clampSide((lead.side ?? KEEP) - gap) : (lead.side ?? KEEP) - 0.01 * k;
      m.cap = Math.max(0, lead.speed + 2.5 * (slot - m.s));
      continue;
    }
    // ALONE, OR LEADING: to the right, and by the slow on the left when it is clear.
    let side = KEEP + (hash(m.id, 1, 0x51de) - 0.5) * 0.02, slow: Mover | null = null, coming = false, comingLeft = false;
    near(m, (o) => {
      if (o.group?.lead === m.id || m.group?.lead === o.id) return;
      const dx = o.x - m.x, dy = o.y - m.y, a = dx * p.dx + dy * p.dy, l = dx * rx + dy * ry;
      if (a < -0.05 || a > LOOK || Math.abs(l) > 0.14) return;
      const dot = Math.cos(o.heading) * p.dx + Math.sin(o.heading) * p.dy;
      if (dot < -0.5) {
        coming = true;
        if (l < 0.02) comingLeft = true;
        // Meeting someone: squeeze over to the right for them.
        if (a < 0.4 && Math.abs(l) < 0.08) side = Math.max(side, 0.05);
        // Two who meet, alone, now and then stop and talk.
        if (a < 0.25 && Math.abs(l) < 0.12) maybeChat(m, o, company);
      } else if (dot > 0.5 && a > 0 && Math.abs(l) < 0.05 && !(crossing(m) && !crossing(o))) {
        // Someone ahead going the same way, slower: in the way. (Out in the road, only one out there too: off it, past whoever stands at the kerb.)
        if (o.speed < m.cruise * 0.85 && (!slow || a < (slow.x - m.x) * p.dx + (slow.y - m.y) * p.dy)) slow = o;
      }
    });
    m.busy = coming;
    const mine = company.get(m.id);
    const s0 = slow as Mover | null;
    if (s0) {
      const a = (s0.x - m.x) * p.dx + (s0.y - m.y) * p.dy;
      // Out round them, if nobody is coming on the left and nobody walks beside: else behind, at their pace.
      if (!comingLeft && !mine?.length && !m.dog && !crossing(m)) side = OVERTAKE;
      else if (a < BEHIND + 0.1) m.cap = Math.min(m.cap, s0.speed + Math.max(0, a - BEHIND) * 3);
    }
    m.sideTo = clampSide(side);
    // Waiting for the company left behind: not out in the road.
    if (mine?.length && !crossing(m)) {
      const lag = Math.max(...mine.map((f) => m.s - f.s - (f.hand !== undefined || f.group!.k === 1 ? 0 : IN_FILE)));
      if (lag > 0.3) m.cap = 0;
      else if (lag > 0.15) m.cap = Math.min(m.cap, m.cruise * 0.5);
    }
    // At the end of the lead: the dog stopped to sniff, behind.
    if (m.dog && m.dog.s < m.s - LEAD && !crossing(m)) m.cap = 0;
    // PASSING A SHOP: a look in the window, now and then, alone.
    if (!m.browsed && !mine?.length && !m.dog && !m.jog && !crossing(m)) {
      for (const w of windows) {
        if (Math.abs(w.x - m.x) > 0.12 || Math.abs(w.y - m.y) > 0.12) continue;
        m.browsed = true;
        if (m.at[m.at.length - 1] - m.s > 0.6 && hash(m.id, Math.round(w.x * 97 + w.y), 0xb40) < BROWSE) {
          m.pause = { left: PAUSE[0] + (PAUSE[1] - PAUSE[0]) * hash(m.id, 7, 0x9a), face: w.face };
          m.cap = 0;
        }
        break;
      }
    }
  }
}

const clampSide = (s: number) => Math.max(-SIDE_MAX, Math.min(SIDE_MAX, s));

/** Two meeting on the pavement, both alone and neither in a hurry: now and then they stop and talk. */
function maybeChat(m: Mover, o: Mover, company: Map<number, Mover[]>) {
  for (const w of [m, o]) {
    if (w.chatted || w.pause || w.jog || w.dog || w.group || company.get(w.id)?.length || crossing(w) || !w.walk || w.walk.graph !== m.walk!.graph) return;
    if (w.at[w.at.length - 1] - w.s < 0.6) return;
  }
  m.chatted = o.chatted = true;
  if (hash(Math.min(m.id, o.id), Math.max(m.id, o.id), 0xc4a7) >= CHAT) return;
  const left = PAUSE[0] + (PAUSE[1] - PAUSE[0]) * hash(m.id, o.id, 0x7a1);
  m.pause = { left, face: Math.atan2(o.y - m.y, o.x - m.x) };
  o.pause = { left, face: Math.atan2(m.y - o.y, m.x - o.x) };
  m.cap = 0;
}

/** A dog for a walker, by a hash of them: its breed and coat. */
export function dogFor(m: Mover, breeds: readonly Breed[], coats: number): Dog {
  return {
    breed: breeds[Math.floor(hash(m.id, 3, 0xd06) * breeds.length)], coat: Math.floor(hash(m.id, 4, 0xd06) * coats),
    s: m.s + DOG_AHEAD * 0.5, side: (m.side ?? KEEP) + DOG_SIDE, x: m.x, y: m.y, z: m.z, heading: m.heading, phase: 0,
    sniff: 0, next: SNIFF_EVERY[0] + (SNIFF_EVERY[1] - SNIFF_EVERY[0]) * hash(m.id, 5, 0xd06),
  };
}

/**
 * THE DOGS, after their walkers have moved: each a little ahead on its lead,
 * to the left, wandering a little; stopping now and then to sniff while its
 * walker waits at the end of the lead; never out over a crossing before them.
 * `step`, tiles a trot's step for each breed.
 */
export function stepDogs(t: Town, h: number, step: (b: Breed) => number, height: (x: number, y: number) => number): void {
  for (const m of t.movers) {
    const d = m.dog;
    if (!d) continue;
    const end = m.at[m.at.length - 1];
    let to = Math.min(end, m.s + DOG_AHEAD);
    const w = m.walk, x = w?.crossings[w.k];
    if (x && !w!.on) to = Math.min(to, x.s0 - 0.02);
    to = Math.max(to, m.s - LEAD);
    let v = 0;
    if (d.sniff > 0) {
      d.sniff -= h;
      // Dragged on if the walker has gone the length of the lead past.
      if (d.s < m.s - LEAD) { v = Math.min(m.s - LEAD - d.s, m.cruise * h); d.s += v; }
    } else {
      d.next -= h;
      if (d.next <= 0 && !crossing(m) && d.s < end - 0.5) {
        d.sniff = SNIFF_FOR[0] + (SNIFF_FOR[1] - SNIFF_FOR[0]) * hash(m.id, Math.floor(t.t), 0x5f);
        d.next = SNIFF_EVERY[0] + (SNIFF_EVERY[1] - SNIFF_EVERY[0]) * hash(m.id, Math.floor(t.t), 0x5e);
      } else {
        const dv = to - d.s;
        v = Math.sign(dv) * Math.min(Math.abs(dv), m.cruise * 1.6 * h);
        d.s += v;
      }
    }
    const p = along(m, d.s);
    // To the left of its walker, wandering in and out a little.
    const wander = 0.012 * Math.sin(t.t * 1.3 + m.id);
    d.side = clampSide((m.side ?? KEEP) + DOG_SIDE + wander);
    d.x = p.x - p.dy * d.side; d.y = p.y + p.dx * d.side;
    d.z = height(d.x, d.y);
    if (Math.abs(v) > 1e-4) {
      d.heading = Math.atan2(p.dy, p.dx) + (v < 0 ? Math.PI : 0);
      d.phase += (Math.abs(v) * Math.PI) / step(d.breed);
    }
  }
}
