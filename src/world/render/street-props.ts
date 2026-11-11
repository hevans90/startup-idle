/**
 * World v2 — A STREET MADE FINE, SEEN: what each level of a street puts on
 * its pavements (@see liveBeauty):
 *  1. trees and bins;
 *  2. lamp posts, benches, and a zebra at its ends with a beacon either side;
 *  3. café tables, bunting between some of its lamps, and murals on its houses.
 *
 * The pavements themselves, relaid by level, and the zebras are the road's
 * own paint: what {@link roadDressOf} says goes to `render/road-paint.ts`.
 *
 * DRAWN AS THE CULTURE PROPS ARE: a Graphics a band among the movers of the
 * band, built only when the streets' levels or the map change — never a
 * frame at a time. @see createCultureProps, render-group rebuilds
 */
import { Graphics, type Container } from "pixi.js";

import { housedBy } from "../../game/housing";
import type { Beauty } from "../agents/beauty";
import { idx, inBounds, type Grid } from "../grid";
import { bandOf } from "../iso";
import { streetsOf, type Streets } from "../roads/streets";
import { isPaved } from "../roads/mask";
import { dressOf } from "../roads/looks";
import { makePen, mix, tone, type Pen } from "../structures/projects/pen";
import { tree } from "../structures/projects/looks";
import type { BandLayer } from "./bands";
import type { Seat } from "../agents/town";
import { NEIGHBOUR } from "../../iso/dir";
import type { Bay, Crossing } from "../agents/lanes/graph";
import { TILES_PER_M } from "../agents/cars/models";
import { SEATS_M } from "../props/models";
import { PROP_TINT } from "../props/props-format";
import { bakedProps, propSprite, propSprites, propsLoaded, turnOf, type PropSprites } from "../props/props-sheet";
import { faceOf } from "./shopfronts";

/** A prop on a road tile: which, its tile, and the kerb it stands by. */
export type StreetProp = {
  kind: "tree" | "bin" | "lamp" | "bench" | "beacon" | "table" | "bunting";
  x: number; y: number;
  /** The street's level, 1–3: what it has grown into. */
  level?: number;
  /** Bunting's piece of its span: how many tiles along from the lamp it is tied to. @see SPAN */
  span?: number;
  /** The kerb: the side of the tile with no road beyond it. */
  side: "N" | "E" | "S" | "W";
};
/** A house's mural: on the face away from its street. */
export type Mural = { id: number; x: number; y: number; face: "u" | "v" };

/** Tiles from one lamp to the next along a kerb: the length of a run of bunting. */
const SPAN = 4;

const SIDES = { N: [0, -1], E: [1, 0], S: [0, 1], W: [-1, 0] } as const;

/** Whether a road tile is at a street's end: next to a junction. */
const endOfStreet = (g: Grid, streets: Streets, x: number, y: number) =>
  (Object.values(SIDES) as readonly (readonly [number, number])[]).some(([dx, dy]) => inBounds(g, x + dx, y + dy) && isPaved(g, x + dx, y + dy) && streets.of[idx(g, x + dx, y + dy)] < 0);

/** A road tile's level: its street's, or at a junction the finest street meeting there. */
function levelOf(g: Grid, streets: Streets, b: Beauty, x: number, y: number): number {
  const i = idx(g, x, y);
  let level = b.tile[i];
  if (streets.of[i] < 0) for (const [dx, dy] of Object.values(SIDES)) if (inBounds(g, x + dx, y + dy)) level = Math.max(level, b.tile[idx(g, x + dx, y + dy)]);
  return level;
}

/**
 * WHAT THE ROAD ITSELF WEARS, per cell: its street's level, which its
 * pavement is relaid by, and a zebra where a street from level 2 meets a
 * junction. @see dressOf, render/road-paint
 */
/** Where a long street is crossed along it, as its cells: a zebra there, on a fine enough street. @see agents/lanes/graph alongCrossings */
function zebrasAlong(crossings: readonly Crossing[]): Set<number> {
  const along = new Set<number>();
  for (const c of crossings) if (c.long) for (const i of c.cells) along.add(i);
  return along;
}

export function roadDressOf(g: Grid, streets: Streets, b: Beauty, crossings: readonly Crossing[] = []): Uint8Array {
  const out = new Uint8Array(g.w * g.h);
  const along = zebrasAlong(crossings);
  for (let y = 0; y < g.h; y++) for (let x = 0; x < g.w; x++) {
    if (!isPaved(g, x, y)) continue;
    const i = idx(g, x, y), level = Math.max(0, Math.min(3, levelOf(g, streets, b, x, y)));
    out[i] = dressOf(level, streets.of[i] >= 0 && level >= 2 && (endOfStreet(g, streets, x, y) || along.has(i)));
  }
  return out;
}

/**
 * What every street's level puts where. On each road tile of a street, by
 * each kerb — a side with no road beyond it — the tile's place along the
 * street, `(x + y)`, saying which. Pure, for tests.
 */
export function streetPropsOf(g: Grid, streets: Streets, b: Beauty, crossings: readonly Crossing[] = [], bays: readonly Bay[] = []): { props: StreetProp[]; murals: Mural[] } {
  const props: StreetProp[] = [];
  const along = zebrasAlong(crossings);
  // (Nothing on the narrow pavement beside a lay-by.)
  const layby = new Set(bays.filter((q) => q.layby).map((q) => `${q.cell},${NEIGHBOUR[q.kerb].join(",")}`));
  const paved = (x: number, y: number) => inBounds(g, x, y) && isPaved(g, x, y);
  for (let y = 0; y < g.h; y++) {
    for (let x = 0; x < g.w; x++) {
      if (!paved(x, y)) continue;
      const i = idx(g, x, y);
      // A junction is as fine as the finest street meeting at it.
      const junction = streets.of[i] < 0;
      const level = levelOf(g, streets, b, x, y);
      if (level < 1) continue;
      if (junction) continue;
      const k = x + y;
      // AT A STREET'S END, where it meets a junction: its zebra, painted on
      // the road (@see roadDressOf), and a beacon on a striped pole at either kerb.
      // (Or along a long street, where its zebra is.)
      const end = endOfStreet(g, streets, x, y) || along.has(i);
      if (level >= 2 && end) {
        for (const side of Object.keys(SIDES) as StreetProp["side"][]) {
          const [dx, dy] = SIDES[side];
          if (!isPaved(g, x + dx, y + dy)) props.push({ kind: "beacon", x, y, side, level });
        }
      }
      for (const side of Object.keys(SIDES) as StreetProp["side"][]) {
        const [dx, dy] = SIDES[side];
        if (isPaved(g, x + dx, y + dy) || layby.has(`${i},${dx},${dy}`)) continue;
        // Each kerb its own beat, so the two sides of a street do not match.
        const n = k + (side === "S" || side === "E" ? 2 : 0);
        if (end) continue;
        const at = (kind: StreetProp["kind"]) => props.push({ kind, x, y, side, level });
        if (level >= 2 && n % 4 === 0) at("lamp");
        else if (n % 4 === 2) at("tree");
        else if (level >= 3 && n % 8 === 1) at("table");
        else if (level >= 2 && n % 8 === 3) at("bench");
        else if (n % 8 === 7) at("bin");
      }
    }
  }
  // BUNTING, LAMP TO LAMP: on the finest streets, from every other lamp on a
  // kerb to the next one along it, where that one is there.
  const lamps = new Set(props.filter((pr) => pr.kind === "lamp").map((pr) => `${pr.x},${pr.y},${pr.side}`));
  for (const pr of props.filter((q) => q.kind === "lamp" && (q.level ?? 0) >= 3)) {
    const n = pr.x + pr.y + (pr.side === "S" || pr.side === "E" ? 2 : 0);
    if (n % 8 !== 0) continue;
    const [ax, ay] = pr.side === "N" || pr.side === "S" ? [1, 0] : [0, 1];
    if (!lamps.has(`${pr.x + ax * SPAN},${pr.y + ay * SPAN},${pr.side}`)) continue;
    for (let t = 0; t <= SPAN; t++) props.push({ kind: "bunting", x: pr.x + ax * t, y: pr.y + ay * t, side: pr.side, level: pr.level, span: t });
  }
  // MURALS: on every other house of the finest streets with no shop, on the face away from its street.
  const murals: Mural[] = [];
  for (const [st, ids] of b.homes) {
    if (b.street[st] < 3) continue;
    for (const id of ids) {
      const s = g.structures.get(id);
      if (!s || s.shop || id % 2 || !housedBy(s.def)) continue;
      const x = s.x + s.w - 1, y = s.y + s.h - 1;
      murals.push({ id, x, y, face: isPaved(g, x, y + 1) ? "u" : "v" });
    }
  }
  return { props, murals };
}

const IRON = 0x2b2f33, LAMP_ON = 0xffe2a0, WOOD = 0xa67a4a;
const BUNTING = [0xe0533d, 0xf2c230, 0x3d8be0, 0x45b07a, 0xf27aa8, 0xf2efe6];
const MURAL = [[0xf27aa8, 0x3fc1c9, 0xf2c230], [0x7a4fd0, 0xe58a2b, 0x45b07a], [0x3d8be0, 0xf2efe6, 0xe0533d]];
const PARASOL = [0xe0533d, 0x2f8f6b, 0x3d6fb5, 0xe58a2b];

/**
 * Where along a kerb, and how far in from it: `a` along the kerb from 0 to 1,
 * `d` in from the tile's edge, as the tile's (u, v).
 */
const onKerb = (side: StreetProp["side"], a: number, d: number): [number, number] =>
  side === "N" ? [a, d] : side === "S" ? [a, 1 - d] : side === "W" ? [d, a] : [1 - d, a];
/** Whether a kerb runs along `u`: the north and south ones. */
const alongU = (side: StreetProp["side"]) => side === "N" || side === "S";

/** How far in from the edge a prop stands: on the pavement. */
const IN = 0.1;

/** A street tree's crown: a lime, round; a hornbeam, upright; a cherry, in blossom. */
function streetTree(p: Pen, u: number, v: number, kind: number) {
  // Its pit, an iron grate in the paving.
  p.flat(u - 0.08, v - 0.08, u + 0.08, v + 0.08, 0.008, IRON);
  for (const k of [-0.04, 0, 0.04]) p.flat(u + k - 0.006, v - 0.07, u + k + 0.006, v + 0.07, 0.009, 0x4a5058);
  p.flat(u - 0.22, v - 0.1, u + 0.2, v + 0.18, 0.01, 0x000000, 0.1);
  p.box(u - 0.02, v - 0.02, u + 0.02, v + 0.02, 0, 0.6, 0x6d4a2a);
  if (kind === 0) { tree(p, u, v, 0, 0.55); return; }
  if (kind === 1) {
    // Upright: a column of foliage, darker at its foot.
    const L = 0x4f8a3e;
    for (let k = 0; k < 5; k++) p.dot(u, v, 0.75 + k * 0.17, 0.11 - Math.abs(k - 1.8) * 0.012, tone(L, 0.8 + k * 0.1));
    p.dot(u - 0.03, v, 1.35, 0.05, tone(L, 1.35));
    return;
  }
  // In blossom.
  const B = 0xf2a6c2;
  p.dot(u, v, 0.78, 0.15, tone(B, 0.82));
  p.dot(u + 0.06, v, 0.86, 0.11, tone(B, 0.92));
  p.dot(u - 0.04, v, 0.92, 0.12, B);
  p.dot(u - 0.06, v, 1.0, 0.06, mix(B, 0xffffff, 0.4));
  for (let k = 0; k < 4; k++) p.flat(u - 0.15 + k * 0.09, v + 0.06 - k * 0.03, u - 0.13 + k * 0.09, v + 0.08 - k * 0.03, 0.012, B);
}

/** A lamp post: a plinth, a fluted column, a collar, an arm out over the road and a lantern on it, lit. */
function lampPost(p: Pen, u: number, v: number, side: StreetProp["side"], basket: boolean) {
  // The arm reaches toward the road: away from the kerb.
  const [du, dv] = side === "N" ? [0, 1] : side === "S" ? [0, -1] : side === "W" ? [1, 0] : [-1, 0];
  const lu = u + du * 0.16, lv = v + dv * 0.16;
  const column = () => {
    p.box(u - 0.04, v - 0.04, u + 0.04, v + 0.04, 0, 0.18, IRON, { top: tone(IRON, 1.3) });
    p.box(u - 0.022, v - 0.022, u + 0.022, v + 0.022, 0.18, 1.1, IRON);
    p.box(u - 0.014, v - 0.014, u + 0.014, v + 0.014, 1.1, 2.5, IRON);
    p.box(u - 0.03, v - 0.03, u + 0.03, v + 0.03, 1.08, 1.14, tone(IRON, 1.4));
    p.dot(u, v, 2.53, 0.016, IRON);
  };
  // THE LANTERN HANGS from the end of the arm on a short rod, the arm running
  // over its cap: drawn before the arm, which is above it.
  const lantern = () => {
    // Bottom up: its base, the glass lit warm, the cap over it, the rod.
    p.box(lu - 0.028, lv - 0.028, lu + 0.028, lv + 0.028, 1.94, 1.98, IRON, { noTop: true });
    p.box(lu - 0.036, lv - 0.036, lu + 0.036, lv + 0.036, 1.98, 2.22, LAMP_ON, { noTop: true });
    p.box(lu - 0.046, lv - 0.046, lu + 0.046, lv + 0.046, 2.22, 2.27, IRON);
    p.box(lu - 0.02, lv - 0.02, lu + 0.02, lv + 0.02, 2.27, 2.3, IRON);
    p.box(lu - 0.004, lv - 0.004, lu + 0.004, lv + 0.004, 2.3, 2.44, IRON);
  };
  const arm = () => {
    p.strut([u, v, 2.44], [lu, lv, 2.44], 0.012, IRON);
    p.strut([u, v, 2.2], [u + du * 0.09, v + dv * 0.09, 2.44], 0.008, IRON);
  };
  // A basket hung off the column on its kerb side, flowers spilling: behind it where the arm is in front.
  const hang = () => {
    if (!basket) return;
    p.dot(u - du * 0.06, v - dv * 0.06, 1.55, 0.06, 0x4f7a34);
    for (const [k, c] of [[0, 0xf27aa8], [1, 0xf2c230], [2, 0x9b6bd6], [3, 0xf2efe6]] as const) {
      p.dot(u - du * 0.06 + (k - 1.5) * 0.025, v - dv * 0.06, 1.5 + (k % 2) * 0.05, 0.02, c);
    }
  };
  // FARTHER FIRST: an arm reaching back over the road (from a front kerb) is
  // behind the column and its basket in front; from a back kerb the other way.
  if (du + dv < 0) { lantern(); arm(); column(); hang(); } else { hang(); column(); lantern(); arm(); }
}

/** A painted pole in black and white bands, an amber globe on top: where to cross. */
function beacon(p: Pen, u: number, v: number) {
  for (let k = 0; k < 8; k++) p.box(u - 0.016, v - 0.016, u + 0.016, v + 0.016, k * 0.22, (k + 1) * 0.22, k % 2 ? 0xf2efe6 : 0x1d2024);
  p.dot(u, v, 1.84, 0.055, 0xf2a83a);
  p.dot(u - 0.015, v, 1.86, 0.02, 0xffe2a0);
}

const DRAW: Record<StreetProp["kind"], (p: Pen, pr: StreetProp) => void> = {
  tree: (p, pr) => {
    const [u, v] = onKerb(pr.side, 0.5, IN + 0.02);
    const kind = (pr.level ?? 1) >= 3 && (pr.x + pr.y) % 3 === 0 ? 2 : (pr.x * 7 + pr.y * 3) % 2;
    streetTree(p, u, v, kind);
  },
  bin: (p, pr) => {
    // A litter bin in black, banded gold, and a recycling bin by it.
    const [u, v] = onKerb(pr.side, 0.42, IN);
    p.box(u - 0.04, v - 0.04, u + 0.04, v + 0.04, 0, 0.34, IRON);
    p.box(u - 0.042, v - 0.042, u + 0.042, v + 0.042, 0.22, 0.25, 0xc9a24a);
    p.box(u - 0.046, v - 0.046, u + 0.046, v + 0.046, 0.34, 0.37, tone(IRON, 1.3));
    p.dot(u, v, 0.4, 0.025, tone(IRON, 1.3));
    const [ru, rv] = onKerb(pr.side, 0.6, IN);
    p.box(ru - 0.035, rv - 0.035, ru + 0.035, rv + 0.035, 0, 0.3, 0x2f7a4a, { top: 0x3f9a5a });
    p.box(ru - 0.02, rv - 0.02, ru + 0.02, rv + 0.02, 0.3, 0.305, 0x1d2024);
  },
  lamp: (p, pr) => { const [u, v] = onKerb(pr.side, 0.5, IN); lampPost(p, u, v, pr.side, (pr.level ?? 2) >= 3); },
  bench: (p, pr) => {
    // Cast iron ends, three slats to sit on and two to lean on, its back to the kerb.
    const along = alongU(pr.side);
    const [u, v] = onKerb(pr.side, 0.5, IN);
    const [hu, hv] = along ? [0.16, 0.05] : [0.05, 0.16];
    const back = pr.side === "N" || pr.side === "W" ? -1 : 1;
    for (const s of [-1, 1]) {
      const eu = u + (along ? s * 0.14 : 0), ev = v + (along ? 0 : s * 0.14);
      p.box(eu - (along ? 0.012 : 0.05), ev - (along ? 0.05 : 0.012), eu + (along ? 0.012 : 0.05), ev + (along ? 0.05 : 0.012), 0, 0.2, IRON);
    }
    for (let k = 0; k < 3; k++) {
      const o = -0.04 + k * 0.035;
      if (along) p.box(u - hu, v + o - 0.014, u + hu, v + o + 0.014, 0.18, 0.21, WOOD, { top: tone(WOOD, 1.1) });
      else p.box(u + o - 0.014, v - hv, u + o + 0.014, v + hv, 0.18, 0.21, WOOD, { top: tone(WOOD, 1.1) });
    }
    for (const z of [0.3, 0.4]) {
      if (along) p.box(u - hu, v + back * 0.05 - 0.01, u + hu, v + back * 0.05 + 0.01, z, z + 0.06, WOOD);
      else p.box(u + back * 0.05 - 0.01, v - hv, u + back * 0.05 + 0.01, v + hv, z, z + 0.06, WOOD);
    }
  },
  beacon: (p, pr) => { const [u, v] = onKerb(pr.side, 0.25, IN); beacon(p, u, v); },
  table: (p, pr) => {
    // A round table, two chairs, a parasol open over them, striped.
    const [u, v] = onKerb(pr.side, 0.5, IN + 0.04);
    const along = alongU(pr.side);
    for (const s of [-1, 1]) {
      const cu = along ? u + s * 0.11 : u, cv = along ? v : v + s * 0.11;
      p.box(cu - 0.028, cv - 0.028, cu + 0.028, cv + 0.028, 0, 0.18, 0x3a3f45);
      p.box(cu - 0.028, cv - 0.028, cu + 0.028, cv + 0.028, 0.18, 0.2, WOOD);
    }
    p.box(u - 0.006, v - 0.006, u + 0.006, v + 0.006, 0, 0.3, IRON);
    p.box(u - 0.06, v - 0.06, u + 0.06, v + 0.06, 0.3, 0.33, 0xf2efe6);
    p.box(u - 0.005, v - 0.005, u + 0.005, v + 0.005, 0.33, 0.95, 0xd8dde3);
    const c = PARASOL[(pr.x * 3 + pr.y) % PARASOL.length];
    const n = 8, r = 0.2, top = 1.0, rim = 0.86;
    for (let k = 0; k < n; k++) {
      const a0 = (k / n) * Math.PI * 2, a1 = ((k + 1) / n) * Math.PI * 2;
      const lit = 0.82 + 0.25 * Math.max(0, Math.sin((a0 + a1) / 2 + Math.PI / 4));
      p.poly([p.P(u, v, top), p.P(u + Math.cos(a0) * r, v + Math.sin(a0) * r, rim), p.P(u + Math.cos(a1) * r, v + Math.sin(a1) * r, rim)], tone(k % 2 ? c : 0xf2efe6, lit));
    }
    p.dot(u, v, top + 0.02, 0.012, 0xd8dde3);
  },
  bunting: (p, pr) => {
    // This tile's piece of a run of pennants from one lamp's column to the
    // next one's, sagging between: `g` is along the run, the lamps at its ends.
    const t = pr.span ?? 0, Z = 2.0, sag = 0.3;
    const zAt = (g: number) => Z - Math.sin((Math.PI * (g - 0.5)) / SPAN) * sag;
    const a0 = t === 0 ? 0.5 : 0, a1 = t === SPAN ? 0.5 : 1;
    const steps = Math.max(1, Math.round((a1 - a0) * 4));
    for (let k = 0; k < steps; k++) {
      const b0 = a0 + ((a1 - a0) * k) / steps, b1 = a0 + ((a1 - a0) * (k + 1)) / steps;
      const [u0, v0] = onKerb(pr.side, b0, IN), [u1, v1] = onKerb(pr.side, b1, IN);
      p.strut([u0, v0, zAt(t + b0)], [u1, v1, zAt(t + b1)], 0.006, 0x3a3f45);
    }
    for (let a = a0 + 0.08; a < a1 - 0.08; a += 0.25) {
      const c0 = a - 0.07, c1 = a + 0.07;
      const [u0, v0] = onKerb(pr.side, c0, IN), [u1, v1] = onKerb(pr.side, c1, IN), [um, vm] = onKerb(pr.side, a, IN);
      const c = BUNTING[Math.round((pr.x + pr.y) * 4 + a * 4) % BUNTING.length];
      p.poly([p.P(u0, v0, zAt(t + c0)), p.P(u1, v1, zAt(t + c1)), p.P(um, vm, zAt(t + a) - 0.16)], alongU(pr.side) ? c : tone(c, 0.82));
    }
  },
};

/** A mural on a house's ground floor and up: one of four pictures, by its id. */
function drawMural(p: Pen, m: Mural) {
  const f = faceOf(p, m.face);
  const [a, b, c] = MURAL[m.id % MURAL.length];
  const w = f.wall;
  const kind = (m.id >> 1) % 4;
  if (kind === 0) {
    // A sunset over mountains.
    for (let k = 0; k < 5; k++) f.on(0.06, 0.94, 0.25 + k * 0.3, 0.55 + k * 0.3, w(mix(0xf27a4a, 0x7a4fd0, k / 4)));
    f.dot(0.5, 0.006, 0.95, 0.16, 0xffd27a);
    f.poly([[0.06, 0.006, 0.25], [0.35, 0.006, 1.05], [0.6, 0.006, 0.25]], w(0x3a2f5a));
    f.poly([[0.4, 0.007, 0.25], [0.7, 0.007, 0.85], [0.94, 0.007, 0.25]], w(0x2a2245));
    f.poly([[0.3, 0.008, 0.9], [0.35, 0.008, 1.05], [0.4, 0.008, 0.9]], w(0xf2efe6));
  } else if (kind === 1) {
    // Shapes in the bold colours, a zigzag through them.
    f.on(0.06, 0.94, 0.25, 1.75, w(0xf2efe6));
    f.dot(0.3, 0.006, 1.3, 0.13, a);
    f.on(0.55, 0.85, 0.4, 0.75, w(b));
    f.poly([[0.12, 0.006, 0.35], [0.4, 0.006, 0.35], [0.26, 0.006, 0.8]], w(c));
    for (let k = 0; k < 6; k++) f.poly([[0.1 + k * 0.13, 0.007, 1.0 + (k % 2) * 0.15], [0.23 + k * 0.13, 0.007, 1.0 + ((k + 1) % 2) * 0.15], [0.23 + k * 0.13, 0.007, 1.06 + ((k + 1) % 2) * 0.15], [0.1 + k * 0.13, 0.007, 1.06 + (k % 2) * 0.15]], w(0x22262b));
    f.dot(0.72, 0.006, 1.45, 0.06, c);
  } else if (kind === 2) {
    // Waves, rolling.
    f.on(0.06, 0.94, 0.25, 1.75, w(0xbfe3ef));
    for (let k = 0; k < 4; k++) {
      const z = 0.3 + k * 0.33, col = w(mix(0x1f6fa8, 0x5fc1d9, k / 3));
      f.on(0.06, 0.94, z, z + 0.2, col);
      for (let j = 0; j < 4; j++) f.dot(0.15 + j * 0.23 + (k % 2) * 0.1, 0.006, z + 0.2, 0.055, col);
    }
    f.dot(0.78, 0.006, 1.6, 0.08, 0xffd27a);
  } else {
    // A robot, waving: the town's mascot.
    f.on(0.06, 0.94, 0.25, 1.75, w(a));
    f.on(0.32, 0.68, 0.95, 1.45, w(0xd8dde3));
    f.on(0.38, 0.47, 1.15, 1.28, w(0x22262b));
    f.on(0.53, 0.62, 1.15, 1.28, w(0x22262b));
    f.dot(0.425, 0.007, 1.22, 0.025, b);
    f.dot(0.575, 0.007, 1.22, 0.025, b);
    f.on(0.42, 0.58, 1.02, 1.06, w(0x22262b));
    f.on(0.36, 0.64, 0.3, 0.9, w(0xb9bec4));
    f.on(0.2, 0.34, 0.6, 0.68, w(0xb9bec4));
    f.poly([[0.64, 0.006, 0.8], [0.8, 0.006, 1.1], [0.84, 0.006, 1.06], [0.68, 0.006, 0.74]], w(0xb9bec4));
    f.on(0.495, 0.505, 1.45, 1.6, w(0x22262b));
    f.dot(0.5, 0.007, 1.62, 0.03, c);
  }
}

export type StreetProps = {
  /** Put the streets' props where their levels say, if those or the map have changed. */
  sync: (g: Grid, b: Beauty, rev: number, scale: number, crossings?: readonly Crossing[], bays?: readonly Bay[]) => void;
  /** What the road wears, as of the last sync that changed anything: a new array each time. @see roadDressOf */
  dress: () => Uint8Array | null;
  /** The benches' seats, as last laid out. @see seatsOf */
  seats: () => Seat[];
  destroy: () => void;
};

/** Which way a prop at a kerb faces: away from the kerb, into the street. */
const FACING: Record<StreetProp["side"], number> = { N: Math.PI / 2, S: -Math.PI / 2, W: 0, E: Math.PI };

/** A street tree from the sheet, by kind: a lime, a hornbeam, a cherry in blossom. */
const STREET_TREE = ["lime", "hornbeam", "cherry"] as const;

/** A colour a touch lighter or darker, by a hash of where it is: no two trees quite alike. */
const vary = (c: number, x: number, y: number) => tone(c, 0.9 + 0.2 * (((x * 73856093) ^ (y * 19349663)) >>> 0) % 100 / 100);

/** Where a prop stands, in tiles, and the turn it faces: for the sheet. */
function standOf(pr: StreetProp, a: number, d: number) {
  const [u, v] = onKerb(pr.side, a, d);
  return { u: pr.x - 0.5 + u, v: pr.y - 0.5 + v, turn: turnOf(FACING[pr.side]) };
}

/** What of a street's props comes from the sheet: a container of sprites, or null to draw it as before. */
function bakedProp(P: PropSprites, pr: StreetProp, z: number, scale: number): Container | null {
  if (pr.kind === "tree") {
    const kind = STREET_TREE[(pr.level ?? 1) >= 3 && (pr.x + pr.y) % 3 === 0 ? 2 : (pr.x * 7 + pr.y * 3) % 2];
    const s = standOf(pr, 0.5, IN + 0.02);
    return propSprite(P, kind, (pr.x + pr.y * 3) % 4, s.u, s.v, z, scale, vary(PROP_TINT[kind], pr.x, pr.y), 0.85);
  }
  if (pr.kind === "bench") { const s = standOf(pr, 0.5, IN); return propSprite(P, "bench", s.turn, s.u, s.v, z, scale); }
  if (pr.kind === "table") {
    const s = standOf(pr, 0.5, IN + 0.04);
    return propSprite(P, "cafe", s.turn, s.u, s.v, z, scale, PARASOL[(pr.x * 3 + pr.y) % PARASOL.length]);
  }
  return null;
}

/** A street tree's pit in the paving: an iron grate. Drawn under the baked tree. */
function treePit(p: Pen, pr: StreetProp) {
  const [u, v] = onKerb(pr.side, 0.5, IN + 0.02);
  p.flat(u - 0.05, v - 0.05, u + 0.05, v + 0.05, 0.008, IRON);
  for (const k of [-0.025, 0, 0.025]) p.flat(u + k - 0.004, v - 0.045, u + k + 0.004, v + 0.045, 0.009, 0x4a5058);
}

/** A bench's seats: its two places, where a walker sits and which way they face. @see Town.seats */
export function seatsOf(props: readonly StreetProp[]): Seat[] {
  const seats: Seat[] = [];
  for (const pr of props) {
    if (pr.kind !== "bench") continue;
    const [u, v] = onKerb(pr.side, 0.5, IN), bench = `${pr.x},${pr.y},${pr.side}`;
    SEATS_M.forEach((m, k) => {
      const along = m * TILES_PER_M;
      const [du, dv] = alongU(pr.side) ? [along, 0] : [0, along];
      seats.push({ key: `${bench}:${k}`, bench, x: pr.x - 0.5 + u + du, y: pr.y - 0.5 + v + dv, heading: FACING[pr.side] });
    });
  }
  return seats;
}

export function createStreetProps(bands: BandLayer): StreetProps {
  let drawn: Container[] = [];
  let key = "";
  let dress: Uint8Array | null = null;
  let seats: Seat[] = [];
  const clear = () => {
    for (const gr of drawn) { gr.parent?.removeChild(gr); gr.destroy({ children: true }); }
    drawn = [];
  };
  return {
    sync(g, b, rev, scale, crossings, bays) {
      // The sheet once it is in; drawn as before until then, and drawn again when it comes.
      const P = bakedProps() ? propsLoaded() : null;
      if (bakedProps() && !P) void propSprites();
      const k = `${rev}|${scale}|${b.street.join("")}|${P ? "baked" : ""}`;
      if (k === key) return;
      key = k;
      clear();
      // TWO TIERS A BAND: what stands at a back kerb behind whoever walks
      // the tile, at a front kerb in front of them. @see town-render
      const tiers = new Map<string, Graphics>();
      const graphicsAt = (x: number, y: number, tier: "back" | "front") => {
        const band = bandOf(x, y), k = `${band}:${tier}`;
        let gr = tiers.get(k);
        if (gr) return gr;
        const layer = bands.dynamicOf[band];
        if (!layer) return null;
        gr = new Graphics();
        gr.eventMode = "none";
        gr.zIndex = tier === "back" ? -0.4 : 0.4;
        layer.addChild(gr);
        drawn.push(gr);
        tiers.set(k, gr);
        return gr;
      };
      const streets = streetsOf(g);
      dress = roadDressOf(g, streets, b, crossings);
      const { props, murals } = streetPropsOf(g, streets, b, crossings, bays);
      seats = seatsOf(props);
      for (const pr of props) {
        const tier = pr.side === "N" || pr.side === "W" ? "back" : "front";
        const gr = graphicsAt(pr.x, pr.y, tier);
        if (!gr) continue;
        const z = g.height[idx(g, pr.x, pr.y)];
        const pen = makePen(gr, pr.x - 0.5, pr.y - 0.5, z, scale, null);
        const sp = P && bakedProp(P, pr, z, scale);
        if (sp) {
          // FROM THE SHEET, over its tier's drawing, in the same band. @see props-sheet
          if (pr.kind === "tree") treePit(pen, pr);
          sp.zIndex = gr.zIndex + 0.01;
          gr.parent!.addChild(sp);
          drawn.push(sp);
        } else DRAW[pr.kind](pen, pr);
      }
      for (const m of murals) {
        const gr = graphicsAt(m.x, m.y, "back");
        if (gr) drawMural(makePen(gr, m.x - 0.5, m.y - 0.5, g.height[idx(g, m.x, m.y)], scale, null), m);
      }
    },
    dress: () => dress,
    seats: () => seats,
    destroy: clear,
  };
}
