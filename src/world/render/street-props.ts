/**
 * World v2 — A STREET MADE FINE, SEEN: what each level of a street puts on
 * its pavements (@see liveBeauty):
 *  1. trees, planters and bins;
 *  2. lamp posts, benches, brick along the kerb and crossings at its ends;
 *  3. café tables, bunting between the lamps, and murals on its houses.
 *
 * DRAWN AS THE CULTURE PROPS ARE: a Graphics a band among the movers of the
 * band, built only when the streets' levels or the map change — never a
 * frame at a time. @see createCultureProps, render-group rebuilds
 */
import { Graphics } from "pixi.js";

import { housedBy } from "../../game/housing";
import type { Beauty } from "../agents/beauty";
import { idx, inBounds, type Grid } from "../grid";
import { bandOf } from "../iso";
import { streetsOf, type Streets } from "../roads/streets";
import { isPaved } from "../roads/mask";
import { makePen, mix, tone, type Pen } from "../structures/projects/pen";
import { tree } from "../structures/projects/looks";
import type { BandLayer } from "./bands";
import { faceOf } from "./shopfronts";

/** A prop on a road tile: which, its tile, and the kerb it stands by. */
export type StreetProp = {
  kind: "tree" | "planter" | "bin" | "lamp" | "bench" | "brick" | "crossing" | "beacon" | "table" | "bunting";
  x: number; y: number;
  /** The street's level, 1–3: what it has grown into. */
  level?: number;
  /** The kerb: the side of the tile with no road beyond it. */
  side: "N" | "E" | "S" | "W";
};
/** A house's mural: on the face away from its street. */
export type Mural = { id: number; x: number; y: number; face: "u" | "v" };

const SIDES = { N: [0, -1], E: [1, 0], S: [0, 1], W: [-1, 0] } as const;

/**
 * What every street's level puts where. On each road tile of a street, by
 * each kerb — a side with no road beyond it — the tile's place along the
 * street, `(x + y)`, saying which. Pure, for tests.
 */
export function streetPropsOf(g: Grid, streets: Streets, b: Beauty): { props: StreetProp[]; murals: Mural[] } {
  const props: StreetProp[] = [];
  for (let y = 0; y < g.h; y++) {
    for (let x = 0; x < g.w; x++) {
      const i = idx(g, x, y), level = b.tile[i];
      if (level < 1) continue;
      const k = x + y;
      // AT A STREET'S END, where it meets a junction: its crossing.
      const end = (Object.values(SIDES) as readonly (readonly [number, number])[]).some(([dx, dy]) => inBounds(g, x + dx, y + dy) && isPaved(g, x + dx, y + dy) && streets.of[idx(g, x + dx, y + dy)] < 0);
      // Its side says the way the street runs: "N" along x, its kerbs north and south.
      if (level >= 2 && end) {
        const across = !isPaved(g, x, y - 1) || !isPaved(g, x, y + 1) ? "N" : "E";
        props.push({ kind: "crossing", x, y, side: across });
        // A beacon on a striped pole at either kerb of it.
        for (const side of (across === "N" ? ["N", "S"] : ["W", "E"]) as StreetProp["side"][]) {
          const [dx, dy] = SIDES[side];
          if (!isPaved(g, x + dx, y + dy)) props.push({ kind: "beacon", x, y, side, level });
        }
      }
      for (const side of Object.keys(SIDES) as StreetProp["side"][]) {
        const [dx, dy] = SIDES[side];
        if (isPaved(g, x + dx, y + dy)) continue;
        // Each kerb its own beat, so the two sides of a street do not match.
        const n = k + (side === "S" || side === "E" ? 2 : 0);
        if (level >= 2) props.push({ kind: "brick", x, y, side, level });
        if (end) continue;
        const at = (kind: StreetProp["kind"]) => props.push({ kind, x, y, side, level });
        if (level >= 2 && n % 4 === 0) at("lamp");
        else if (n % 4 === 2) at("tree");
        else if (level >= 3 && n % 8 === 1) at("table");
        else if (level >= 2 && n % 8 === 3) at("bench");
        else if (n % 8 === 5) at("planter");
        else if (n % 8 === 7) at("bin");
        if (level >= 3) at("bunting");
      }
    }
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

const IRON = 0x2b2f33, LAMP_ON = 0xffe2a0, WOOD = 0xa67a4a, BRICK = 0xa85a42, GRANITE = 0xb9b9b2;
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
  p.box(u - 0.04, v - 0.04, u + 0.04, v + 0.04, 0, 0.18, IRON, { top: tone(IRON, 1.3) });
  p.box(u - 0.022, v - 0.022, u + 0.022, v + 0.022, 0.18, 1.1, IRON);
  p.box(u - 0.014, v - 0.014, u + 0.014, v + 0.014, 1.1, 2.25, IRON);
  p.box(u - 0.03, v - 0.03, u + 0.03, v + 0.03, 1.08, 1.14, tone(IRON, 1.4));
  const lu = u + du * 0.16, lv = v + dv * 0.16;
  p.strut([u, v, 2.2], [lu, lv, 2.3], 0.012, IRON);
  p.strut([u, v, 2.05], [u + du * 0.1, v + dv * 0.1, 2.24], 0.008, IRON);
  // The lantern: glass lit warm, a cap and a finial.
  p.box(lu - 0.035, lv - 0.035, lu + 0.035, lv + 0.035, 2.06, 2.24, LAMP_ON, { top: LAMP_ON });
  p.box(lu - 0.045, lv - 0.045, lu + 0.045, lv + 0.045, 2.24, 2.29, IRON);
  p.dot(lu, lv, 2.33, 0.012, IRON);
  p.dot(lu, lv, 2.15, 0.05, LAMP_ON, 0.35);
  if (basket) {
    // A basket hung off the column, flowers spilling.
    p.dot(u - du * 0.06, v - dv * 0.06, 1.55, 0.06, 0x4f7a34);
    for (const [k, c] of [[0, 0xf27aa8], [1, 0xf2c230], [2, 0x9b6bd6], [3, 0xf2efe6]] as const) {
      p.dot(u - du * 0.06 + (k - 1.5) * 0.025, v - dv * 0.06, 1.5 + (k % 2) * 0.05, 0.02, c);
    }
  }
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
  planter: (p, pr) => {
    // A long corten trough along the kerb, grasses and flowers in it.
    const [u, v] = onKerb(pr.side, 0.5, IN);
    const [hu, hv] = alongU(pr.side) ? [0.18, 0.055] : [0.055, 0.18];
    p.box(u - hu, v - hv, u + hu, v + hv, 0, 0.24, 0x9a5634, { top: 0x5a3a26 });
    for (let k = 0; k < 7; k++) {
      const t = (k + 0.5) / 7 - 0.5;
      const pu = u + (alongU(pr.side) ? t * hu * 1.8 : 0), pv = v + (alongU(pr.side) ? 0 : t * hv * 1.8);
      p.dot(pu, pv, 0.31, 0.045, tone(0x5c9a46, 0.85 + (k % 3) * 0.12));
      p.strut([pu, pv, 0.24], [pu + 0.02, pv - 0.01, 0.45 + (k % 2) * 0.06], 0.006, 0x9ab85a);
      p.dot(pu, pv, 0.38 + (k % 2) * 0.03, 0.02, [0xf27aa8, 0xf2c230, 0x9b6bd6, 0xf2efe6][k % 4]);
    }
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
  brick: (p, pr) => {
    // The pavement in brick, laid herringbone, a granite kerb along its road edge.
    const along = alongU(pr.side);
    const [u0, v0] = onKerb(pr.side, 0, 0), [u1, v1] = onKerb(pr.side, 1, 0.17);
    const lu = Math.min(u0, u1), lv = Math.min(v0, v1), hu = Math.max(u0, u1), hv = Math.max(v0, v1);
    p.flat(lu, lv, hu, hv, 0.012, BRICK);
    for (let k = 0; k < 14; k++) {
      const t = k / 14;
      for (let j = 0; j < 2; j++) {
        const c = (k + j) % 2 ? tone(BRICK, 1.12) : tone(BRICK, 0.9);
        if (along) p.flat(lu + t, lv + 0.01 + j * 0.075, lu + t + 0.06, lv + 0.07 + j * 0.075, 0.013, c);
        else p.flat(lu + 0.01 + j * 0.075, lv + t, lu + 0.07 + j * 0.075, lv + t + 0.06, 0.013, c);
      }
    }
    const [g0, h0] = onKerb(pr.side, 0, 0.15), [g1, h1] = onKerb(pr.side, 1, 0.185);
    p.flat(Math.min(g0, g1), Math.min(h0, h1), Math.max(g0, g1), Math.max(h0, h1), 0.014, GRANITE);
  },
  crossing: (p, pr) => {
    // Zebra bars across the road, a broken give-way line before them each way,
    // and buff studded paving at the kerbs for the blind.
    const N = pr.side === "N";
    const rect = (a0: number, a1: number, b0: number, b1: number, z: number, c: number, al = 1) =>
      N ? p.flat(a0, b0, a1, b1, z, c, al) : p.flat(b0, a0, b1, a1, z, c, al);
    for (let k = 0; k < 6; k++) {
      const b = 0.2 + k * 0.105;
      rect(0.32, 0.68, b, b + 0.06, 0.014, 0xf2efe6, 0.92);
    }
    for (const a of [0.2, 0.76]) for (let b = 0.2; b < 0.8; b += 0.08) rect(a, a + 0.04, b, b + 0.04, 0.014, 0xf2efe6, 0.85);
    for (const b of [0.02, 0.86]) {
      rect(0.3, 0.7, b, b + 0.12, 0.015, 0xd9c48a);
      for (let x = 0.33; x < 0.69; x += 0.05) for (let y = b + 0.025; y < b + 0.11; y += 0.045) rect(x, x + 0.018, y, y + 0.018, 0.016, tone(0xd9c48a, 0.82));
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
    // Pennants on a line along the kerb, dipping between the ends of the tile.
    const n = 6, Z = 2.0, sag = 0.22;
    const zAt = (a: number) => Z - Math.sin(Math.PI * a) * sag;
    for (let k = 0; k < 8; k++) {
      const a0 = k / 8, a1 = (k + 1) / 8;
      const [u0, v0] = onKerb(pr.side, a0, IN), [u1, v1] = onKerb(pr.side, a1, IN);
      p.strut([u0, v0, zAt(a0)], [u1, v1, zAt(a1)], 0.006, 0x3a3f45);
    }
    for (let k = 0; k < n; k++) {
      const a0 = (k + 0.15) / n, a1 = (k + 0.85) / n, am = (a0 + a1) / 2;
      const [u0, v0] = onKerb(pr.side, a0, IN), [u1, v1] = onKerb(pr.side, a1, IN), [um, vm] = onKerb(pr.side, am, IN);
      const c = BUNTING[(pr.x + pr.y + k) % BUNTING.length];
      p.poly([p.P(u0, v0, zAt(a0)), p.P(u1, v1, zAt(a1)), p.P(um, vm, zAt(am) - 0.17)], alongU(pr.side) ? c : tone(c, 0.82));
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
  sync: (g: Grid, b: Beauty, rev: number, scale: number) => void;
  destroy: () => void;
};

export function createStreetProps(bands: BandLayer): StreetProps {
  let drawn: Graphics[] = [];
  let key = "";
  const clear = () => {
    for (const gr of drawn) { gr.parent?.removeChild(gr); gr.destroy(); }
    drawn = [];
  };
  return {
    sync(g, b, rev, scale) {
      const k = `${rev}|${scale}|${b.street.join("")}`;
      if (k === key) return;
      key = k;
      clear();
      // THREE TIERS A BAND. Paint on the road under everyone, among the
      // buildings at the back of the band; what stands at a back kerb behind
      // whoever walks the tile, at a front kerb in front of them. @see town-render
      const tiers = new Map<string, Graphics>();
      const graphicsAt = (x: number, y: number, tier: "flat" | "back" | "front") => {
        const band = bandOf(x, y), k = `${band}:${tier}`;
        let gr = tiers.get(k);
        if (gr) return gr;
        const layer = tier === "flat" ? bands.structureOf[band] : bands.dynamicOf[band];
        if (!layer) return null;
        gr = new Graphics();
        gr.eventMode = "none";
        if (tier === "flat") layer.addChildAt(gr, 0);
        else { gr.zIndex = tier === "back" ? -0.4 : 0.4; layer.addChild(gr); }
        drawn.push(gr);
        tiers.set(k, gr);
        return gr;
      };
      const { props, murals } = streetPropsOf(g, streetsOf(g), b);
      for (const pr of props) {
        const tier = pr.kind === "brick" || pr.kind === "crossing" ? "flat" : pr.side === "N" || pr.side === "W" ? "back" : "front";
        const gr = graphicsAt(pr.x, pr.y, tier);
        if (gr) DRAW[pr.kind](makePen(gr, pr.x - 0.5, pr.y - 0.5, g.height[idx(g, pr.x, pr.y)], scale, null), pr);
      }
      for (const m of murals) {
        const gr = graphicsAt(m.x, m.y, "back");
        if (gr) drawMural(makePen(gr, m.x - 0.5, m.y - 0.5, g.height[idx(g, m.x, m.y)], scale, null), m);
      }
    },
    destroy: clear,
  };
}
