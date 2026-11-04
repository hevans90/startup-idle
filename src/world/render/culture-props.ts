/**
 * World v2 — THE CULTURE DECK, SEEN IN THE TOWN: each card in force puts
 * something by the buildings it touches — a flag, a sign, a food truck, a
 * palm — so how the company is run can be read off the map. A kind's own card
 * by that kind's workplaces only. @see game/culture, plans/culture-deck.md §4
 *
 * WHERE: a GROUND prop on a free tile beside its building, front sides first,
 * one prop a tile — or, the town built up round it, on the pavement of a
 * street beside it, against the building; a MOUNTED one inside the
 * building's front tile, before its front corner; a food truck at the kerb of
 * a street beside it. A house's sign by one house in `HOUSE_EVERY`: a sign on
 * every door was thousands.
 *
 * DRAWN ONCE, a Graphics a prop, among the movers of its tile's band — over
 * the building there, and ordered with whoever walks or drives past it — and redrawn only when the map or the cards change: a Graphics redrawn
 * every frame rebuilds its band's draw list. @see render-group rebuilds
 */
import { Graphics } from "pixi.js";

import { card, inForce, type CardId, type Deck } from "../../game/culture";
import { housedBy } from "../../game/housing";
import { workplaceKind } from "../agents/commute";
import { fluidAt, idx, inBounds, pavedAt, rampAt, structureAt, terrainAt, VOID, type Grid, type Structure } from "../grid";
import { bandOf, HW } from "../iso";
import type { BandLayer } from "./bands";
import { makePen, mix, type Pen } from "../structures/projects/pen";

type Where = "ground" | "mount" | "street";
export type Prop = {
  card: CardId; x: number; y: number; where: Where;
  /** Which of a building's mounts, or a variant. */
  k: number;
  /** Along `v` (else `u`), for a street prop. */
  alongV?: boolean;
  /** Moved off the tile's middle, tiles: onto the pavement, against the building. */
  du?: number; dv?: number;
};

/** Of the houses, the one in this many that shows its sign. */
const HOUSE_EVERY = 4;
/** How far from the building's wall a prop on the pavement stands, tiles. */
const AGAINST = 0.2;

const work = (s: Structure) => !s.build && workplaceKind(s.def) !== null;
const workOf = (kind: string) => (s: Structure) => !s.build && workplaceKind(s.def) === kind;
const house = (s: Structure) => !s.build && housedBy(s.def) !== null && s.id % HOUSE_EVERY === 0;
/** The HQ, and the Boardroom and IPO Tower it grows into. @see LANDMARKS */
const hq = (s: Structure) => !s.build && (s.def === "hq" || s.def === "boardroom" || s.def === "ipo");
const park = (s: Structure) => !s.build && s.def === "park";

/** What each card puts by which buildings. */
const PLACES: Partial<Record<CardId, { at: (s: Structure) => boolean; where: Where }>> = {
  stack: { at: work, where: "ground" },
  hotdesk: { at: work, where: "ground" },
  lunch: { at: work, where: "street" },
  sabbatical: { at: workOf("10x_dev"), where: "ground" },
  therapy: { at: hq, where: "mount" },
  fourday: { at: park, where: "mount" },
  pipeline: { at: work, where: "ground" },
  freeze: { at: work, where: "ground" },
  housing: { at: house, where: "mount" },
  mentorship: { at: workOf("intern"), where: "ground" },
  hackathon: { at: workOf("vibe_coder"), where: "ground" },
  // Building sites too: it is about the building.
  movefast: { at: (s) => workplaceKind(s.def) !== null, where: "ground" },
  vibesonly: { at: workOf("vibe_coder"), where: "ground" },
  pivot: { at: hq, where: "mount" },
};

/** The tiles round a footprint, the two front sides first, then the corner, then the back. */
function ring(s: Structure): [number, number][] {
  const out: [number, number][] = [];
  for (let y = s.y; y < s.y + s.h; y++) out.push([s.x + s.w, y]);
  for (let x = s.x; x < s.x + s.w; x++) out.push([x, s.y + s.h]);
  out.push([s.x + s.w, s.y + s.h]);
  for (let y = s.y; y < s.y + s.h; y++) out.push([s.x - 1, y]);
  for (let x = s.x; x < s.x + s.w; x++) out.push([x, s.y - 1]);
  return out;
}

/** Where the cards in force put their props. Pure, for tests. */
export function propsOf(g: Grid, d: Deck): Prop[] {
  // A kind's own cards first: they have the fewer buildings to show at.
  const cards = inForce(d).filter((id) => PLACES[id]).sort((a, b) => +!card(a).only - +!card(b).only);
  if (!cards.length) return [];
  const out: Prop[] = [];
  const taken = new Set<number>();
  const free = (x: number, y: number) =>
    inBounds(g, x, y) && !taken.has(idx(g, x, y)) && structureAt(g, x, y) < 0 && terrainAt(g, x, y) !== VOID
    && fluidAt(g, x, y) === 0 && rampAt(g, x, y) === 0;
  for (const s of g.structures.values()) {
    let mounts = 0;
    for (const id of cards) {
      const p = PLACES[id]!;
      if (!p.at(s)) continue;
      if (p.where === "mount") {
        out.push({ card: id, x: s.x + s.w - 1, y: s.y + s.h - 1, where: "mount", k: mounts++ });
        continue;
      }
      const paved = (x: number, y: number) => pavedAt(g, x, y) !== VOID;
      const street = p.where === "street";
      const at = ring(s).find(([x, y]) => free(x, y) && paved(x, y) === street)
        ?? (street ? undefined : ring(s).find(([x, y]) => free(x, y) && paved(x, y)));
      if (!at) continue;
      taken.add(idx(g, at[0], at[1]));
      // Which side of the building it is on: a street on its +u side runs along v.
      const du = at[0] === s.x + s.w ? -1 : at[0] === s.x - 1 ? 1 : 0;
      const dv = at[1] === s.y + s.h ? -1 : at[1] === s.y - 1 ? 1 : 0;
      const pave = !street && paved(at[0], at[1]);
      out.push({
        card: id, x: at[0], y: at[1], where: p.where, k: s.id,
        ...(street ? { alongV: du !== 0 } : {}),
        ...(pave ? { du: du * (0.5 - AGAINST), dv: dv * (0.5 - AGAINST) } : {}),
      });
    }
  }
  return out;
}

const WOOD = 0x8a6a48, POLE = 0x9aa3ad, WHITE = 0xf3f1ea;
const SKINS = [0xf1d0b0, 0xc68c5d, 0x9c6a43, 0xe0b48e];
const SHIRTS = [0x4f7cac, 0xd0694e, 0x5e9e6e, 0xe0b04a, 0x8a6bb0];
/** Pivot Weekly's logos: a new colour for each new line-up. */
const LOGOS = [0xe0533d, 0x3d8be0, 0x45b07a, 0xe0b23d, 0xa65ad6, 0x2fb5b5];

/** A person standing at `(u, v)`, facing the camera. */
function person(p: Pen, u: number, v: number, n: number) {
  const r = 0.035;
  p.box(u - r, v - r * 0.6, u + r, v + r * 0.6, 0, 0.55, 0x3a3f4b);
  p.box(u - r * 1.15, v - r * 0.7, u + r * 1.15, v + r * 0.7, 0.55, 1.0, SHIRTS[n % SHIRTS.length]);
  p.dot(u, v, 1.18, 0.028, SKINS[n % SKINS.length]);
}

/** A cushion on the ground at `(u, v)`, squashed as the tiles are: `r` tiles across, `up` half steps high. */
function blob(p: Pen, u: number, v: number, r: number, up: number, colour: number) {
  const [x, y] = p.P(u, v, 0), [, y1] = p.P(u, v, up);
  const rx = r * HW * p.sc, ry = rx * 0.5;
  const ring = (cy: number, k: number) => Array.from({ length: 16 }, (_, i) => {
    const a = (i / 16) * Math.PI * 2;
    return [x + Math.cos(a) * rx * k, cy + Math.sin(a) * ry * k] as [number, number];
  });
  // Its sides, down to the ground, then its slumped top.
  p.poly([...ring(y, 1).slice(0, 9), ...ring(y1, 0.92).slice(0, 9).reverse()], mix(colour, 0x000000, 0.28));
  p.poly(ring(y1, 0.92), colour);
  p.poly(ring(y1 - ry * 0.18, 0.5), mix(colour, 0xffffff, 0.18));
}

/** Paints on a sign's face: from `d0` to `d1` along it, from its middle, `z0` to `z1` up. */
type Face = (d0: number, d1: number, z0: number, z1: number, colour: number) => void;

/**
 * A board on a post at `(u, v)`: its face colour, its top, its half width —
 * facing down and left, or, `alongV`, down and right. Returns a brush for its face.
 */
function sign(p: Pen, u: number, v: number, face: number, top = 1.9, w = 0.16, alongV = false): Face {
  p.box(u - 0.012, v - 0.012, u + 0.012, v + 0.012, 0, top - 0.4, POLE);
  if (alongV) {
    p.box(u - 0.015, v - w, u + 0.015, v + w, top - 0.75, top, face);
    return (d0, d1, z0, z1, c) => p.onU(u + 0.016, v + d0, v + d1, z0, z1, c);
  }
  p.box(u - w, v - 0.015, u + w, v + 0.015, top - 0.75, top, face);
  return (d0, d1, z0, z1, c) => p.onV(v + 0.016, u + d0, u + d1, z0, z1, c);
}

/** A building's mount `k`: either side of its front corner, where the least is in front of it. */
const mountAt = (k: number) => (k % 2 ? { u: 0.9, v: 0.68, alongV: true } : { u: 0.68, v: 0.9, alongV: false });

/** Each card's prop, drawn in its tile: `u`, `v` from 0 to 1 across it. */
const DRAW: Partial<Record<CardId, (p: Pen, prop: Prop, d: Deck) => void>> = {
  // STACK RANKING: a red flag on a tall pole.
  stack: (p) => {
    p.box(0.48, 0.48, 0.51, 0.51, 0, 3.2, POLE);
    p.box(0.51, 0.485, 0.75, 0.505, 2.5, 3.15, 0xd8342c);
    p.dot(0.495, 0.495, 3.25, 0.02, 0xe8e2c8);
  },
  // HOT DESKING: a notice board under sticky notes.
  hotdesk: (p) => {
    const paint = sign(p, 0.5, 0.6, 0x7a5a3c, 1.7, 0.2);
    const notes = [0xf4e04d, 0xf49ac1, 0x8fd3f4, 0xa6e06b, 0xf4e04d, 0xf7b267];
    notes.forEach((c, k) => {
      const d = -0.16 + (k % 3) * 0.12, z = 1.05 + Math.floor(k / 3) * 0.3 + (k % 2) * 0.05;
      paint(d, d + 0.08, z, z + 0.22, c);
    });
  },
  // FREE LUNCH: a food truck at the kerb, its hatch open under an awning.
  lunch: (p, prop) => {
    const along = prop.alongV;
    const [u0, v0, u1, v1] = along ? [0.66, 0.25, 0.86, 0.75] : [0.25, 0.66, 0.75, 0.86];
    p.box(u0, v0, u1, v1, 0.1, 1.35, 0xe8823a, { top: 0xf2f0e8 });
    // The hatch and its awning, on the side that faces the camera.
    if (along) { p.onU(u1, 0.35, 0.65, 0.65, 1.1, 0x2b2b2b); p.box(u1, 0.33, u1 + 0.06, 0.67, 1.12, 1.18, 0xd8342c); }
    else { p.onV(v1, 0.35, 0.65, 0.65, 1.1, 0x2b2b2b); p.box(0.33, v1, 0.67, v1 + 0.06, 1.12, 1.18, 0xd8342c); }
    for (const [u, v] of along ? [[u1, 0.33], [u1, 0.67]] : [[0.33, v1], [0.67, v1]]) p.dot(u, v, 0.12, 0.035, 0x1e1e1e);
  },
  // SABBATICALS: a palm tree, its trunk leaning, its fronds drooping.
  sabbatical: (p) => {
    const base = [0.5, 0.5] as const, lean = 0.12;
    for (let k = 0; k < 6; k++) {
      const t = k / 6;
      p.box(base[0] + lean * t * t - 0.025, base[1] - 0.025, base[0] + lean * t * t + 0.025, base[1] + 0.025, k * 0.5, k * 0.5 + 0.52, 0x9b7650);
    }
    const tu = base[0] + lean, tv = base[1], tz = 3.05;
    for (let k = 0; k < 7; k++) {
      const a = (k / 7) * Math.PI * 2;
      p.strut([tu, tv, tz], [tu + Math.cos(a) * 0.26, tv + Math.sin(a) * 0.26, tz - 0.7], 0.06, k % 2 ? 0x3f9a4a : 0x2f7d3c);
    }
    p.dot(tu, tv, tz, 0.04, 0x6b4a2a);
  },
  // THERAPY BUDGET: a clinic's sign, white with a green cross.
  therapy: (p, prop) => {
    const m = mountAt(prop.k);
    const paint = sign(p, m.u, m.v, WHITE, 2.1, 0.13, m.alongV);
    paint(-0.03, 0.03, 1.45, 1.95, 0x3fae6a);
    paint(-0.09, 0.09, 1.62, 1.78, 0x3fae6a);
  },
  // FOUR-DAY WEEK: a crowd out in the park.
  fourday: (p, prop) => {
    const spots = [[0.3, 0.7], [0.42, 0.62], [0.7, 0.35], [0.62, 0.78], [0.8, 0.6], [0.25, 0.3]];
    spots.forEach(([u, v], k) => person(p, u, v, k + prop.x));
  },
  // ALWAYS BE HIRING: a recruiter's booth, a banner over its table.
  pipeline: (p) => {
    p.box(0.3, 0.5, 0.7, 0.66, 0, 0.65, 0x2f6fb5, { top: WHITE });
    p.box(0.3, 0.42, 0.33, 0.45, 0, 1.9, POLE);
    p.box(0.67, 0.42, 0.7, 0.45, 0, 1.9, POLE);
    p.box(0.3, 0.43, 0.7, 0.445, 1.35, 1.85, 0x2f6fb5);
    p.onV(0.445, 0.36, 0.64, 1.52, 1.68, WHITE);
    person(p, 0.5, 0.35, 3);
  },
  // HIRE FREEZE: a red board, barred across: not hiring.
  freeze: (p) => {
    sign(p, 0.5, 0.6, 0xc8322b, 1.8, 0.15)(-0.12, 0.12, 1.38, 1.5, WHITE);
  },
  // COMPANY HOUSING: a blue dorm sign at the door.
  housing: (p) => {
    const paint = sign(p, 0.86, 0.9, 0x2f5f9e, 1.5, 0.1);
    paint(-0.075, 0.075, 1.0, 1.08, WHITE);
    paint(-0.075, 0.075, 1.18, 1.26, WHITE);
  },
  // MENTORSHIP SCHEME: two at a desk out front, one showing the other.
  mentorship: (p, prop) => {
    p.box(0.32, 0.48, 0.68, 0.6, 0.55, 0.65, WOOD);
    for (const u of [0.35, 0.65]) p.box(u - 0.015, 0.5, u + 0.015, 0.52, 0, 0.55, WOOD);
    p.box(0.44, 0.5, 0.52, 0.56, 0.65, 0.8, 0x2b2b2b);
    person(p, 0.4, 0.7, prop.k);
    person(p, 0.6, 0.7, prop.k + 2);
  },
  // HACKATHON CULTURE: pizza boxes, stacked high.
  hackathon: (p, prop) => {
    for (let k = 0; k < 5; k++) {
      const o = ((k * 37 + prop.k) % 5) * 0.008 - 0.016;
      p.box(0.38 + o, 0.42 - o, 0.62 + o, 0.66 - o, k * 0.14, k * 0.14 + 0.12, 0xe3c896, { top: k === 4 ? 0xf0dcb0 : undefined });
    }
    p.box(0.66, 0.5, 0.82, 0.66, 0, 0.12, 0xe3c896);
  },
  // MOVE FAST: cones, set out round it.
  movefast: (p) => {
    for (const [u, v] of [[0.25, 0.35], [0.5, 0.55], [0.75, 0.75], [0.3, 0.8]]) {
      p.box(u - 0.05, v - 0.05, u + 0.05, v + 0.05, 0, 0.06, 0x2b2b2b);
      for (let k = 0; k < 4; k++) {
        const r = 0.035 * (1 - k / 4);
        p.box(u - r, v - r, u + r, v + r, 0.06 + k * 0.14, 0.2 + k * 0.14, k === 2 ? WHITE : 0xf07a1e);
      }
    }
  },
  // VIBES ONLY: beanbags on the lawn.
  vibesonly: (p, prop) => {
    const bags = [[0.35, 0.4, 0xa64fd6], [0.65, 0.55, 0xf06aa0], [0.4, 0.75, 0x3fc1c9]] as const;
    bags.forEach(([u, v, c], k) => blob(p, u, v, 0.11, 0.35, (k + prop.k) % 2 ? c : mix(c, 0xffffff, 0.1)));
  },
  // PIVOT WEEKLY: a banner of its logo, the colour new at every pivot.
  pivot: (p, prop, d) => {
    const m = mountAt(prop.k);
    const key = [...inForce(d)].join();
    let h = 0;
    for (let k = 0; k < key.length; k++) h = (h * 31 + key.charCodeAt(k)) | 0;
    const c = LOGOS[Math.abs(h) % LOGOS.length];
    const paint = sign(p, m.u, m.v, WHITE, 2.4, 0.14, m.alongV);
    paint(-0.11, 0.11, 1.75, 2.3, c);
    paint(-0.035, 0.035, 1.92, 2.13, WHITE);
  },
};

export type CultureProps = {
  /** Put the props where the map and the cards say, if either has changed. */
  sync: (g: Grid, d: Deck, rev: number, scale: number) => void;
  destroy: () => void;
};

/**
 * A GRAPHICS A BAND, the band's props all in it: a Graphics a prop was two
 * thousand for a town of houses. In a band the tiles stand side by side, so
 * their props cannot overlap and need no order among themselves.
 */
export function createCultureProps(bands: BandLayer): CultureProps {
  let drawn: Graphics[] = [];
  let key = "";
  const clear = () => {
    for (const g of drawn) { g.parent?.removeChild(g); g.destroy(); }
    drawn = [];
  };
  return {
    sync(g, d, rev, scale) {
      const k = `${rev}|${scale}|${inForce(d).join()}|${d.slotted.map((id) => d.ranks[id]).join()}`;
      if (k === key) return;
      key = k;
      clear();
      const of = new Map<number, Graphics>();
      for (const prop of propsOf(g, d)) {
        const draw = DRAW[prop.card], b = bandOf(prop.x, prop.y);
        const band = bands.dynamicOf[b];
        if (!draw || !band) continue;
        let gr = of.get(b);
        if (!gr) {
          gr = new Graphics();
          gr.eventMode = "none";
          // Where a mover at the tiles' middles would be. @see createTownLayer
          gr.zIndex = 0;
          band.addChild(gr);
          drawn.push(gr);
          of.set(b, gr);
        }
        draw(makePen(gr, prop.x - 0.5 + (prop.du ?? 0), prop.y - 0.5 + (prop.dv ?? 0), g.height[idx(g, prop.x, prop.y)], scale, null), prop, d);
      }
    },
    destroy: clear,
  };
}
