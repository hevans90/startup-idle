/**
 * World v2 — THE COMPANY'S OWN BUILDING, as a model: the Founder's Garage and
 * what it grows into — the HQ, the Boardroom, the IPO Tower — each with the
 * YARD its lorries work out of. Baked by the vehicles' rasteriser, lit as the
 * houses and the lorries are. @see dev/bake-landmarks.ts
 *
 * THE BUILDING IS THE ONE THAT WAS BUILT. Its masses are the very ones the
 * site raised a floor at a time (`projects/looks`), stood up in three
 * dimensions: every window a reveal with a frame and a pane, a curtain wall
 * its mullions and spandrels, fins that stand off the glass, a parapet with a
 * deck inside it — so the frame that goes up is the frame of this.
 *
 * In metres, `x` toward the screen's lower right (the plot's `u`), `y` toward
 * its lower left (`v`), `z` up, the middle of the plot at the origin.
 */
import { HALF_STEPS_PER_M, TILES_PER_M, modelById, type Mat } from "../agents/cars/models";
import { face, modelTris, type Tri, type V3 } from "../agents/cars/raster";
import { box, lathe } from "../props/models";
import { lookOf } from "../structures/projects/looks";
import { bays, floorsOf, type Building, type Facade, type Mass } from "../structures/projects/model";

/** The plot the company's building stands on: the building's three tiles by three, and two more across for the yard. */
export const YARD_PLOT = { w: 5, h: 3 } as const;
/** The building's share of it. */
export const HOUSE_PLOT = { w: 3, h: 3 } as const;
/** The tiers, first to last. */
export const LANDMARK_IDS = ["garage", "hq", "boardroom", "ipo"] as const;
export type LandmarkId = (typeof LANDMARK_IDS)[number];

const MT = 1 / TILES_PER_M, MH = 1 / HALF_STEPS_PER_M;
const X = (u: number) => (u - YARD_PLOT.w / 2) * MT, Y = (v: number) => (v - YARD_PLOT.h / 2) * MT, Z = (z: number) => z * MH;
/**
 * A colour as the building's drawing gives it — the tone of its face in the light — made the tone this light gives
 * that face: the rasteriser's sun leaves the lit face at about three quarters of a material's own colour.
 */
const GAIN = 1.27;
const rgb = (hex: number, k = GAIN): V3 => [Math.min(1, (((hex >> 16) & 255) / 255) * k), Math.min(1, (((hex >> 8) & 255) / 255) * k), Math.min(1, ((hex & 255) / 255) * k)];
type Out = Tri[];
/** A box of a colour of its own. */
function cb(o: Out, x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, colour: number, mat: Mat = "concrete") {
  if (x1 <= x0 || y1 <= y0 || z1 <= z0) return;
  const k = o.length, c = rgb(colour);
  box(x0, x1, y0, y1, z0, z1, mat, o);
  for (let i = k; i < o.length; i++) o[i].c = c;
}
/** Whatever `make` adds, of one colour. */
function tinted(o: Out, colour: number, make: () => void) { const k = o.length, c = rgb(colour); make(); for (let i = k; i < o.length; i++) o[i].c = c; }

/** A length of pipe lying along `y`: a ten-sided tube, its near end a dark bore in a ring. */
function tubeY(o: Out, x: number, z: number, y0: number, y1: number, r: number, colour: number) {
  const N = 10, at = (k: number, y: number): V3 => { const a = (k / N) * Math.PI * 2; return [x + Math.cos(a) * r, y, z + Math.sin(a) * r]; };
  tinted(o, colour, () => {
    for (let k = 0; k < N; k++) face([at(k, y0), at(k + 1, y0), at(k + 1, y1), at(k, y1)], "iron", [x, (y0 + y1) / 2, z], o);
    face(Array.from({ length: N }, (_, k) => at(k, y1)), "iron", [x, y0, z], o);
  });
  const k = o.length;
  face(Array.from({ length: N }, (_, q): V3 => { const a = (q / N) * Math.PI * 2; return [x + Math.cos(a) * r * 0.78, y1 + 0.01, z + Math.sin(a) * r * 0.78]; }), "iron", [x, y0, z], o);
  for (let i = k; i < o.length; i++) o[i].c = [0.08, 0.08, 0.09];
}
/** A tank lying along `x`. */
function tubeX(o: Out, y: number, z: number, x0: number, x1: number, r: number, colour: number) {
  const N = 12, at = (k: number, x: number): V3 => { const a = (k / N) * Math.PI * 2; return [x, y + Math.cos(a) * r, z + Math.sin(a) * r]; };
  tinted(o, colour, () => {
    for (let k = 0; k < N; k++) face([at(k, x0), at(k + 1, x0), at(k + 1, x1), at(k, x1)], "paint", [(x0 + x1) / 2, y, z], o);
    face(Array.from({ length: N }, (_, k) => at(k, x1)), "paint", [x0, y, z], o);
    face(Array.from({ length: N }, (_, k) => at(k, x0)), "paint", [x1, y, z], o);
  });
}

/** A vehicle of the fleet, parked: at (`x`, `y`) on ground `z`, turned `turn`, its paint `colour`. */
function parked(o: Out, id: string, x: number, y: number, z: number, turn: number, colour: number) {
  const m = modelById.get(id);
  if (!m) return;
  const c = Math.cos(turn), s = Math.sin(turn), paint = rgb(colour, 1);
  const put = (p: V3): V3 => [x + p[0] * c - p[1] * s, y + p[0] * s + p[1] * c, z + p[2]];
  const dir = (n: V3): V3 => [n[0] * c - n[1] * s, n[0] * s + n[1] * c, n[2]];
  for (const t of modelTris(m)) {
    const back = t.paint && ((p: V3): Mat => t.paint!([(p[0] - x) * c + (p[1] - y) * s, -(p[0] - x) * s + (p[1] - y) * c, p[2] - z]));
    o.push({ p: [put(t.p[0]), put(t.p[1]), put(t.p[2])], mat: t.mat, n: dir(t.n), ...(t.ns ? { ns: [dir(t.ns[0]), dir(t.ns[1]), dir(t.ns[2])] as [V3, V3, V3] } : {}), ...(back ? { paint: back } : {}), ...(t.mat === "paint" || t.paint ? { c: paint } : {}) });
  }
}

// ─── A MASS, STOOD UP ────────────────────────────────────────────────────────

/** A mass's two faces the camera sees: the lit one at `y = y1`, along `x`; the shaded one at `x = x1`, along `y`. */
type Face = { on: "x" | "y"; at: number; a0: number; a1: number };
/** Something on a face: from `a0` to `a1` along it, `z0` to `z1` up, standing `d` proud of it. */
function onFace(o: Out, f: Face, a0: number, a1: number, z0: number, z1: number, d: number, colour: number, mat: Mat = "concrete") {
  if (f.on === "y") cb(o, a0, a1, f.at, f.at + d, z0, z1, colour, mat);
  else cb(o, f.at, f.at + d, a0, a1, z0, z1, colour, mat);
}

/** A floor's skin on a face: `z0` to `z1`. */
function skin(o: Out, f: Face, fa: Facade, wall: number, z0: number, z1: number) {
  const len = f.a1 - f.a0;
  if (fa.kind === "plain") {
    if (fa.lines !== undefined && fa.every) for (let z = z0 + fa.every * MH; z < z1 - 0.05; z += fa.every * MH) onFace(o, f, f.a0, f.a1, z - 0.03, z + 0.03, 0.025, fa.lines);
  } else if (fa.kind === "windows") {
    const zs = z0 + fa.sill * MH, zh = z1 - fa.head * MH;
    for (const [a, b] of bays(len / MT, fa.w, fa.gap, fa.edge ?? 0.12)) {
      const p0 = f.a0 + a * MT, p1 = f.a0 + b * MT;
      // A reveal: the frame proud of the wall, the pane back in it, a bar up its middle and a sill under it.
      onFace(o, f, p0 - 0.12, p1 + 0.12, zs - 0.12, zh + 0.12, 0.1, fa.frame);
      onFace(o, f, p0, p1, zs, zh, 0.13, fa.glass, "pane");
      onFace(o, f, (p0 + p1) / 2 - 0.04, (p0 + p1) / 2 + 0.04, zs, zh, 0.16, fa.frame);
      onFace(o, f, p0 - 0.2, p1 + 0.2, zs - 0.26, zs - 0.12, 0.2, fa.frame);
    }
  } else if (fa.kind === "ribbon") {
    const e = (fa.edge ?? 0.1) * MT, zs = z0 + fa.sill * MH, zh = z1 - fa.head * MH;
    if (fa.frame !== undefined) onFace(o, f, f.a0 + e - 0.1, f.a1 - e + 0.1, zs - 0.1, zh + 0.1, 0.08, fa.frame);
    onFace(o, f, f.a0 + e, f.a1 - e, zs, zh, 0.11, fa.glass, "pane");
    for (let a = f.a0 + e + 1.6; a < f.a1 - e - 0.4; a += 1.6) onFace(o, f, a - 0.04, a + 0.04, zs, zh, 0.14, fa.frame ?? wall);
  } else if (fa.kind === "curtain") {
    onFace(o, f, f.a0 + 0.06, f.a1 - 0.06, z0, z1, 0.06, fa.glass, "pane");
    if (fa.spandrel !== undefined) onFace(o, f, f.a0 + 0.06, f.a1 - 0.06, z0, z0 + 0.7, 0.09, fa.spandrel, "pane");
    const n = Math.max(1, Math.round(len / (fa.every * MT)));
    for (let k = 0; k <= n; k++) { const a = f.a0 + (len * k) / n; onFace(o, f, Math.max(f.a0, a - 0.06), Math.min(f.a1, a + 0.06), z0, z1, 0.2, fa.mullion, "chrome"); }
    onFace(o, f, f.a0, f.a1, z0 - 0.06, z0 + 0.06, 0.16, fa.mullion, "chrome");
  } else if (fa.kind === "fins") {
    onFace(o, f, f.a0 + 0.06, f.a1 - 0.06, z0, z1, 0.06, fa.glass, "pane");
    const n = Math.max(1, Math.round(len / (fa.every * MT)));
    for (let k = 0; k <= n; k++) { const a = f.a0 + (len * k) / n; onFace(o, f, Math.max(f.a0, a - 0.07), Math.min(f.a1, a + 0.07), z0, z1, 0.45, fa.fin, "chrome"); }
  } else if (fa.kind === "louvres") {
    const e = (fa.edge ?? 0.06) * MT;
    for (let z = z0 + 0.1; z < z1 - 0.1; z += fa.every * MH) onFace(o, f, f.a0 + e, f.a1 - e, z, z + 0.09, 0.12, fa.slat, "chrome");
  }
}

/** A mass of a building: its walls, a skin on each floor of its two seen faces, and its courses, piers, cornice and roof. */
function massTris(o: Out, m: Mass) {
  const x0 = X(m.u0), x1 = X(m.u1), y0 = Y(m.v0), y1 = Y(m.v1), z0 = Z(m.z0), z1 = Z(m.z1);
  cb(o, x0, x1, y0, y1, z0, z1, m.wall);
  const faces: Face[] = [{ on: "y", at: y1, a0: x0, a1: x1 }, { on: "x", at: x1, a0: y0, a1: y1 }];
  const { n, h } = floorsOf(m);
  for (let k = 0; k < n; k++) {
    const fa = k === 0 && m.ground ? m.ground : m.facade;
    for (const f of faces) skin(o, f, fa, m.wall, z0 + Z(k * h), z0 + Z((k + 1) * h));
  }
  if (m.bands) for (let k = 1; k < n; k++) { const z = z0 + Z(k * h), hb = Z(m.bands.h); cb(o, x0 - 0.1, x1 + 0.1, y0 - 0.1, y1 + 0.1, z - hb / 2, z + hb / 2, m.bands.colour); }
  if (m.base) cb(o, x0 - 0.14, x1 + 0.14, y0 - 0.14, y1 + 0.14, z0, z0 + Z(m.base.h), m.base.colour, "stone");
  if (m.piers) {
    const w = ((m.piers.w ?? 0.07) * MT) / 2;
    for (const f of faces) {
      const len = f.a1 - f.a0, cnt = Math.max(1, Math.round(len / (m.piers.every * MT)));
      for (let k = 0; k <= cnt; k++) { const a = f.a0 + (len * k) / cnt; onFace(o, f, Math.max(f.a0 - 0.12, a - w), Math.min(f.a1 + 0.12, a + w), z0, z1, 0.26, m.piers.colour); }
    }
  }
  if (m.cornice) { const out = m.cornice.out * MT + 0.12; cb(o, x0 - out, x1 + out, y0 - out, y1 + out, z1 - Z(m.cornice.h), z1 + 0.02, m.cornice.colour, "stone"); }
  // THE ROOF: a deck inside a parapet that stands up round it; or flush; or planted.
  const r = m.roof;
  if (r.kind === "flat") cb(o, x0 + 0.02, x1 - 0.02, y0 + 0.02, y1 - 0.02, z1, z1 + 0.05, r.deck, "roofing");
  else {
    const t = (r.kind === "parapet" ? r.t ?? 0.05 : 0.05) * MT, hp = Z(r.kind === "parapet" ? r.h ?? 0.15 : 0.1);
    cb(o, x0 + t, x1 - t, y0 + t, y1 - t, z1, z1 + 0.04, r.deck, r.kind === "garden" ? "hedge" : "roofing");
    for (const [a0, a1, b0, b1] of [[x0, x1, y0, y0 + t], [x0, x1, y1 - t, y1], [x0, x0 + t, y0, y1], [x1 - t, x1, y0, y1]]) cb(o, a0, a1, b0, b1, z1, z1 + hp, r.rim, "stone");
  }
}

// ─── THE YARD ────────────────────────────────────────────────────────────────

const STEEL = 0x6f7880, YELLOW = 0xe9a71b, PIPE = 0xa6a9aa, IRON_PIPE = 0x7d5c40, BLOCK = 0xbdb8ad, LORRY_BLUE = 0x2e63b8;

/** A run of fence along `x` or `y`: posts and rails, or — a company that has made it — steel pales. */
function fence(o: Out, on: "x" | "y", at: number, a0: number, a1: number, z: number, tier: number) {
  const put = (a: number, b: number, d0: number, d1: number, zz0: number, zz1: number, colour: number, mat: Mat = "iron") =>
    on === "x" ? cb(o, a, b, at + d0, at + d1, zz0, zz1, colour, mat) : cb(o, at + d0, at + d1, a, b, zz0, zz1, colour, mat);
  if (tier === 0) {
    for (let a = a0; a <= a1 + 1e-6; a += (a1 - a0) / Math.max(1, Math.round((a1 - a0) / 2.4))) put(a - 0.07, a + 0.07, -0.07, 0.07, z, z + 1.3, 0x8a6a44, "timber");
    for (const zz of [0.45, 0.85, 1.2]) put(a0, a1, -0.025, 0.025, z + zz, z + zz + 0.09, 0x9a7a52, "timber");
    return;
  }
  const colour = tier >= 3 ? 0x2c3a44 : 0x4d5a63;
  for (let a = a0; a < a1 - 0.05; a += 0.24) put(a, a + 0.09, -0.02, 0.02, z + 0.08, z + 2.2 + (Math.round(a / 0.24) % 2 ? 0 : 0.06), colour);
  for (const zz of [0.4, 1.8]) put(a0, a1, -0.04, 0.04, z + zz, z + zz + 0.07, colour);
  for (let a = a0; a <= a1 + 1e-6; a += (a1 - a0) / Math.max(1, Math.round((a1 - a0) / 2.8))) put(a - 0.06, a + 0.06, -0.06, 0.06, z, z + 2.3, colour);
}

/** A stack of pipe lying along `y`: `n` on the ground, fewer on each row up; chocked. */
function pipeStack(o: Out, x: number, y0: number, y1: number, z: number, n: number, r: number, colour: number) {
  for (let row = 0; row < 3 && n - row > 0; row++) for (let k = 0; k < n - row; k++) tubeY(o, x + (k - (n - row - 1) / 2) * r * 2.04, z + 0.12 + r + row * r * 1.76, y0, y1, r, colour);
  for (const y of [y0 + 0.6, y1 - 0.6]) cb(o, x - n * r * 1.1, x + n * r * 1.1, y - 0.1, y + 0.1, z, z + 0.12, 0x8a6a44, "timber");
}
/** A pallet of blocks, or of bags: a timber base and what is stacked on it, wrapped. */
function pallet(o: Out, x: number, y: number, z: number, h: number, colour: number) {
  cb(o, x - 0.6, x + 0.6, y - 0.5, y + 0.5, z, z + 0.14, 0x9a7a52, "timber");
  cb(o, x - 0.55, x + 0.55, y - 0.45, y + 0.45, z + 0.14, z + 0.14 + h, colour, "brick");
  cb(o, x - 0.57, x + 0.57, y - 0.47, y + 0.47, z + 0.14 + h * 0.45, z + 0.14 + h * 0.52, 0x2a2e33, "iron");
}
/** A bay of aggregate: three concrete walls and a heap in them. */
function bay(o: Out, x0: number, x1: number, y0: number, y1: number, z: number, heap: number) {
  cb(o, x0, x1, y0, y0 + 0.3, z, z + 1.7, BLOCK);
  cb(o, x0, x0 + 0.3, y0, y1, z, z + 1.7, BLOCK);
  cb(o, x1 - 0.3, x1, y0, y1, z, z + 1.7, BLOCK);
  const r = Math.min(x1 - x0, y1 - y0) / 2 - 0.35;
  tinted(o, heap, () => lathe((x0 + x1) / 2, (y0 + y1) / 2 + 0.1, [[r, z], [r * 0.55, z + 0.75], [0.12, z + 1.25], [0, z + 1.3]], "gravel", o, 14, false));
}

/**
 * THE YARD: the two tiles beside the building, the plot's whole depth. Hardstanding at the building's own level and
 * a ramp down to the road in front; fenced, a gate standing open; a shed at the back with the lorries nose out
 * under it; pipe, blocks and stone stacked along the fence; a cabin, a fuel tank and a lamp. It grows with the
 * company: a tin lean-to and a gravel patch behind a garage, a logistics hall under a tower. Its crane, and the
 * lorry it loads, are the game's own: they move.
 */
function yard(o: Out, tier: number, level: number) {
  const x0 = X(HOUSE_PLOT.w) + 0.4, x1 = X(YARD_PLOT.w) - 0.5, y0 = Y(0) + 0.5, y1 = Y(YARD_PLOT.h) - 0.5, z = level, mid = (x0 + x1) / 2;
  // THE GROUND: gravel, then tarmac — a kerb round it, bays lined out in front of the shed.
  cb(o, x0, x1, y0, y1, 0, z, tier === 0 ? 0x9c968a : 0x5c6066, tier === 0 ? "gravel" : "roofing");
  if (tier > 0) for (const [a0, a1, b0, b1] of [[x0, x1, y0, y0 + 0.25], [x0, x0 + 0.25, y0, y1], [x1 - 0.25, x1, y0, y1]]) cb(o, a0, a1, b0, b1, 0, z + 0.06, 0xa7a39b);
  // THE RAMP down the front to the road, at the gate.
  const gate0 = mid - 3.6, gate1 = mid + 3.6;
  tinted(o, tier === 0 ? 0x8f897d : 0x53575c, () => {
    face([[gate0, y1, z], [gate1, y1, z], [gate1, y1 + 0.45, 0.02], [gate0, y1 + 0.45, 0.02]], "roofing", [mid, y1, -1], o);
    face([[gate1, y1, 0], [gate1, y1, z], [gate1, y1 + 0.45, 0.02]], "roofing", [mid, y1, 0], o);
  });
  // THE FENCE: along the back and the far side, and the front either side of the gate; the gate slid open behind it.
  fence(o, "x", y0 + 0.15, x0, x1, z, tier);
  fence(o, "y", x1 - 0.15, y0, y1, z, tier);
  fence(o, "x", y1 - 0.15, x0, gate0, z, tier);
  fence(o, "x", y1 - 0.15, gate1, x1, z, tier);
  if (tier > 0) {
    fence(o, "x", y1 - 0.5, gate1 + 0.3, Math.min(x1 - 0.3, gate1 + 6.6), z, tier);
    for (const g of [gate0, gate1]) { cb(o, g - 0.16, g + 0.16, y1 - 0.31, y1 + 0.01, z, z + 2.6, YELLOW, "livery"); cb(o, g - 0.17, g + 0.17, y1 - 0.32, y1 + 0.02, z + 0.9, z + 1.3, 0x1f2226, "iron"); }
  } else for (const g of [gate0, gate1]) cb(o, g - 0.12, g + 0.12, y1 - 0.27, y1 - 0.03, z, z + 1.6, 0x8a6a44, "timber");

  // THE SHED across the back: a steel frame, a roof falling to the back, clad behind and at its ends, open in front.
  const bays2 = [1, 2, 3, 3][tier], bw = tier === 0 ? 4.4 : 4.6, sx1 = x1 - 0.7, sx0 = sx1 - bays2 * bw, sy0 = y0 + 0.7, sy1 = sy0 + (tier === 0 ? 8 : 10.5);
  const eave = [3.6, 4.6, 5.2, 6.4][tier], ridge = eave + [0.5, 0.7, 0.9, 1.1][tier], clad = [0x8f9aa3, 0x3f6b4a, 0x6b6258, 0x2c3a44][tier], roofC = [0x7a838c, 0x8a9198, 0x8f897b, 0xd8b04a][tier];
  for (let k = 0; k <= bays2; k++) {
    const a = sx0 + k * bw;
    for (const y of [sy0, sy1]) cb(o, a - 0.13, a + 0.13, y - 0.13, y + 0.13, z, z + (y === sy0 ? eave : ridge), STEEL, "iron");
    tinted(o, STEEL, () => face([[a - 0.1, sy0, z + eave - 0.3], [a + 0.1, sy0, z + eave - 0.3], [a + 0.1, sy1, z + ridge - 0.3], [a - 0.1, sy1, z + ridge - 0.3]], "iron", [a, (sy0 + sy1) / 2, z + 20], o));
  }
  cb(o, sx0 - 0.1, sx1 + 0.1, sy0 - 0.12, sy0, z + 0.3, z + eave, clad, "paint");
  cb(o, sx1, sx1 + 0.12, sy0, sy1 - 2.2, z + 0.3, z + eave, clad, "paint");
  tinted(o, roofC, () => {
    face([[sx0 - 0.5, sy0 - 0.4, z + eave], [sx1 + 0.5, sy0 - 0.4, z + eave], [sx1 + 0.5, sy1 + 0.7, z + ridge + 0.05], [sx0 - 0.5, sy1 + 0.7, z + ridge + 0.05]], tier >= 3 ? "chrome" : "roofing", [mid, (sy0 + sy1) / 2, -5], o);
    face([[sx0 - 0.5, sy1 + 0.7, z + ridge - 0.25], [sx1 + 0.5, sy1 + 0.7, z + ridge - 0.25], [sx1 + 0.5, sy1 + 0.7, z + ridge + 0.05], [sx0 - 0.5, sy1 + 0.7, z + ridge + 0.05]], "roofing", [mid, sy0, z], o);
    face([[sx1 + 0.5, sy0 - 0.4, z + eave - 0.25], [sx1 + 0.5, sy1 + 0.7, z + ridge - 0.25], [sx1 + 0.5, sy1 + 0.7, z + ridge + 0.05], [sx1 + 0.5, sy0 - 0.4, z + eave]], "roofing", [mid, sy0, z], o);
  });
  // (Its fascia in the company's colour; a lamp under it at each bay.)
  cb(o, sx0 - 0.3, sx1 + 0.3, sy1 + 0.68, sy1 + 0.76, z + ridge - 0.7, z + ridge - 0.22, [0x2f6d4f, 0x2e63b8, 0xd8b04a, 0xd8b04a][tier], "livery");
  for (let k = 0; k < bays2; k++) cb(o, sx0 + (k + 0.5) * bw - 0.35, sx0 + (k + 0.5) * bw + 0.35, sy1 + 0.2, sy1 + 0.5, z + ridge - 0.5, z + ridge - 0.4, 0xfff1c4, "lamp");
  // THE LORRIES under it, nose out: what the works are supplied with.
  const fleet = ["flatbed", "tipper", "boxLorry", "flatbed"], tints = [LORRY_BLUE, YELLOW, 0xe8e2d0, LORRY_BLUE];
  for (let k = 0; k < bays2; k++) parked(o, fleet[k], sx0 + (k + 0.5) * bw, sy0 + 4.4 + (k % 2) * 0.5, z, Math.PI / 2, tints[k]);

  // ALONG THE FRONT, inside the fence: pipe for the mains and the sewers; blocks on pallets; stone in a bay.
  const fy = y1 - 1.2;
  pipeStack(o, x0 + 2.3, fy - 6.2, fy - 0.3, z, tier === 0 ? 2 : 3, 0.5, PIPE);
  if (tier > 0) pipeStack(o, x0 + 6.0, fy - 6.2, fy - 0.3, z, 3, 0.56, IRON_PIPE);
  for (let k = 0; k < 1 + tier; k++) pallet(o, x1 - 1.6 - (k % 2) * 1.5, fy - 0.3 - Math.floor(k / 2) * 1.3, z, 0.9 + (k % 3) * 0.2, k % 2 ? 0xa4543a : BLOCK);
  if (tier > 0) bay(o, x1 - 4.2, x1 - 0.5, sy1 + 2.4, sy1 + 6.2, z, 0x8f8a80);
  // A CABIN for the yard's foreman, a fuel tank in its bund, a lamp on a mast, a skip.
  const cx0 = x0 + 0.7, cy0 = sy0 + 0.2;
  if (sx0 - cx0 > 6.4) {
    cb(o, cx0, cx0 + 6, cy0, cy0 + 2.7, z + 0.25, z + 2.9, 0xe8e2d0, "paint");
    cb(o, cx0 - 0.05, cx0 + 6.05, cy0 - 0.05, cy0 + 2.75, z + 2.9, z + 3.0, 0x8a9198, "roofing");
    cb(o, cx0 + 0.6, cx0 + 1.5, cy0 + 2.7, cy0 + 2.76, z + 0.3, z + 2.3, 0x3f6b4a, "paint");
    for (const a of [2.3, 4.0]) cb(o, cx0 + a, cx0 + a + 1.2, cy0 + 2.7, cy0 + 2.76, z + 1.3, z + 2.2, 0x6f93a8, "pane");
    for (const a of [0.3, 5.5]) cb(o, cx0 + a, cx0 + a + 0.2, cy0 + 0.2, cy0 + 2.5, z, z + 0.25, 0x6a6e73, "iron");
  }
  cb(o, cx0, cx0 + 4.4, cy0 + 4.3, cy0 + 7.1, z, z + 0.5, BLOCK);
  tubeX(o, cy0 + 5.7, z + 1.35, cx0 + 0.6, cx0 + 3.8, 0.85, 0x3f6b4a);
  for (const a of [1.2, 3.2]) cb(o, cx0 + a - 0.12, cx0 + a + 0.12, cy0 + 5.0, cy0 + 6.4, z + 0.5, z + 0.75, 0x4d5a63, "iron");
  const lx = x1 - 1.0, ly = y1 - 1.0, lh = [5.5, 7.5, 9, 11][tier];
  tinted(o, STEEL, () => lathe(lx, ly, [[0.16, z], [0.1, z + 0.6], [0.07, z + lh]], "iron", o, 8));
  cb(o, lx - 0.9, lx + 0.25, ly - 0.25, ly + 0.25, z + lh - 0.1, z + lh + 0.12, 0x3a3f45, "iron");
  cb(o, lx - 0.85, lx + 0.1, ly - 0.2, ly + 0.2, z + lh - 0.16, z + lh - 0.1, 0xfff1c4, "lamp");
  // (A skip: its four sides and what has been thrown in it.)
  const kx = gate0 - 3.4, ky = fy - 8.6;
  if (kx - 1.5 > x0 + 7 || tier === 0) {
    const sx = tier === 0 ? x1 - 2.6 : kx, sy = tier === 0 ? sy1 + 5.2 : ky;
    cb(o, sx - 1.5, sx + 1.5, sy - 0.9, sy + 0.9, z + 0.15, z + 0.3, YELLOW, "livery");
    for (const [a0, a1, b0, b1] of [[-1.5, 1.5, -0.9, -0.8], [-1.5, 1.5, 0.8, 0.9], [-1.5, -1.4, -0.9, 0.9], [1.4, 1.5, -0.9, 0.9]]) cb(o, sx + a0, sx + a1, sy + b0, sy + b1, z + 0.3, z + 1.25, YELLOW, "livery");
    cb(o, sx - 1.4, sx + 1.4, sy - 0.8, sy + 0.8, z + 0.3, z + 0.95, 0x6f5338, "gravel");
  }
  // (Between the stacks and the gate the ground is kept clear: the yard's CRANE stands there, and the lorry it is loading. @see line-works)
}

// ─── WHAT IS ON EACH BUILDING ────────────────────────────────────────────────

/** A way in on a mass's lit face about `x = c`: dark glass in a frame, a canopy over it, a step. */
function entrance(o: Out, m: Mass, c: number, w: number, h: number, frame: number, glass: number) {
  const y = Y(m.v1), z = Z(m.z0);
  cb(o, c - w / 2 - 0.2, c + w / 2 + 0.2, y, y + 0.22, z, z + h + 0.3, frame, "chrome");
  cb(o, c - w / 2, c + w / 2, y, y + 0.26, z + 0.05, z + h, glass, "pane");
  cb(o, c - 0.05, c + 0.05, y, y + 0.3, z + 0.05, z + h, frame, "chrome");
  cb(o, c - w / 2 - 0.7, c + w / 2 + 0.7, y, y + 2.0, z + h + 0.3, z + h + 0.5, frame, "chrome");
  cb(o, c - w / 2 - 0.5, c + w / 2 + 0.5, y, y + 1.2, z - 0.3, z, 0xc9c4b8, "stone");
}
/** Plant on a roof: cased units, a duct between them. */
function roofPlant(o: Out, m: Mass, n: number) {
  const z = Z(m.z1) + 0.04, x0 = X(m.u0) + 1.6, y0 = Y(m.v0) + 1.6;
  for (let k = 0; k < n; k++) {
    const x = x0 + k * 3.4;
    cb(o, x, x + 2.4, y0, y0 + 1.8, z, z + 1.3, 0x9aa3ab, "chrome");
    cb(o, x + 0.2, x + 2.2, y0 + 1.8, y0 + 1.86, z + 0.25, z + 1.05, 0x4d5a63, "iron");
    tinted(o, 0x3a3f45, () => lathe(x + 1.2, y0 + 0.9, [[0.7, z + 1.3], [0.7, z + 1.42], [0, z + 1.42]], "iron", o, 12, false));
  }
  if (n > 1) cb(o, x0 + 2.4, x0 + (n - 1) * 3.4, y0 + 0.6, y0 + 1.1, z + 0.2, z + 0.7, 0xb9c1c8, "chrome");
}
/** A mast on a roof and the red light at its head. */
function mast(o: Out, x: number, y: number, z: number, h: number, colour: number) {
  tinted(o, colour, () => lathe(x, y, [[0.2, z], [0.12, z + h * 0.5], [0.06, z + h]], "iron", o, 8));
  cb(o, x - 0.16, x + 0.16, y - 0.16, y + 0.16, z + h, z + h + 0.3, 0xff3b2f, "tail");
}

/** Every triangle of a tier: the plot's stone under the building, the building, what is on it, and the yard. */
export function landmarkTris(id: LandmarkId): Tri[] {
  const o: Out = [], b: Building = lookOf(id, HOUSE_PLOT), tier = LANDMARK_IDS.indexOf(id), level = Z(b.plinth.h);
  // THE PLINTH under the building's own three tiles: its stone, and its top a shade of its own.
  const i = b.plinth.inset * MT;
  cb(o, X(0) + i, X(HOUSE_PLOT.w) + 0.4, Y(0) + i, Y(HOUSE_PLOT.h) - i, 0, level, b.plinth.colour, "stone");
  if (b.plinth.top !== undefined) cb(o, X(0) + i + 0.1, X(HOUSE_PLOT.w) + 0.4, Y(0) + i + 0.1, Y(HOUSE_PLOT.h) - i - 0.1, level, level + 0.02, b.plinth.top, "pave");
  for (const m of [...b.masses].sort((p, q) => p.z0 - q.z0)) massTris(o, m);
  const m0 = b.masses[0], top = b.masses[b.masses.length - 1], mid = (X(m0.u0) + X(m0.u1)) / 2, front = Y(m0.v1), g = Z(m0.z0);
  if (id === "garage") {
    // THE ROLLER DOOR, half up on the lit workshop: a bench, a monitor's glow; the slats of the door over it.
    const dw = 9.5, dh = 3.6;
    cb(o, mid - dw / 2 - 0.25, mid + dw / 2 + 0.25, front, front + 0.16, g, g + dh + 0.35, 0x8a9198, "chrome");
    cb(o, mid - dw / 2, mid + dw / 2, front, front + 0.2, g, g + 2.1, 0x4a3f2c, "interior");
    cb(o, mid - dw / 2 + 0.8, mid + dw / 2 - 0.8, front, front + 0.24, g + 0.75, g + 0.98, 0x8a6a44, "timber");
    cb(o, mid - 1.6, mid + 0.3, front, front + 0.25, g + 1.1, g + 1.7, 0x9fd3ff, "light");
    for (let z = g + 2.1; z < g + dh; z += 0.26) cb(o, mid - dw / 2, mid + dw / 2, front, front + 0.26, z, z + 0.2, 0xa3abb3, "chrome");
    // The sign over it, painted on a board; a lamp over the sign.
    cb(o, mid - dw / 2, mid + dw / 2, front, front + 0.2, g + dh + 0.55, g + dh + 1.4, 0x2f6d4f, "paint");
    cb(o, mid - dw / 2 + 0.9, mid + dw / 2 - 2.4, front + 0.2, front + 0.24, g + dh + 0.85, g + dh + 1.1, 0xf3eed8, "linen");
    cb(o, mid - 0.4, mid + 0.4, front, front + 1.1, g + dh + 1.5, g + dh + 1.62, 0x3a3f45, "iron");
    cb(o, mid - 0.25, mid + 0.25, front + 0.8, front + 1.05, g + dh + 1.4, g + dh + 1.5, 0xfff1c4, "lamp");
    // A side door and a window in the shaded wall; a downpipe at the corner; a vent and a tank on the roof.
    const sx = X(m0.u1);
    cb(o, sx, sx + 0.1, front - 4.4, front - 3.2, g, g + 2.2, 0x3f6b4a, "paint");
    cb(o, sx, sx + 0.12, Y(m0.v0) + 2.2, Y(m0.v0) + 5.2, g + 1.5, g + 2.9, 0x6f93a8, "pane");
    cb(o, sx - 0.2, sx + 0.14, front - 0.14, front + 0.2, g, Z(m0.z1), 0x8f8a80, "iron");
    cb(o, sx - 4.4, sx - 2.6, Y(m0.v0) + 1.6, Y(m0.v0) + 3.2, Z(m0.z1), Z(m0.z1) + 0.9, 0x9aa3ab, "chrome");
    tinted(o, 0x8a5a36, () => lathe(X(m0.u0) + 3.2, Y(m0.v0) + 2.6, [[0.9, Z(m0.z1) + 0.8], [0.9, Z(m0.z1) + 2.3], [0.45, Z(m0.z1) + 2.7], [0, Z(m0.z1) + 2.75]], "timber", o, 14));
    for (const [dx, dy] of [[-0.6, -0.6], [0.6, -0.6], [-0.6, 0.6], [0.6, 0.6]]) cb(o, X(m0.u0) + 3.2 + dx - 0.06, X(m0.u0) + 3.2 + dx + 0.06, Y(m0.v0) + 2.6 + dy - 0.06, Y(m0.v0) + 2.6 + dy + 0.06, Z(m0.z1), Z(m0.z1) + 0.8, 0x3a3f45, "iron");
    // The bins by the door, and THE FOUNDER'S CAR on the apron.
    cb(o, mid + dw / 2 + 0.7, mid + dw / 2 + 1.5, front + 0.2, front + 1.0, g, g + 1.1, 0x3f6b4a, "paint");
    cb(o, mid + dw / 2 + 1.7, mid + dw / 2 + 2.5, front + 0.2, front + 1.0, g, g + 1.1, 0x2e4f7a, "paint");
    parked(o, "hatchback", mid - 4.5, front + 4.6, level, Math.PI * 0.42, 0xc84a3a);
  } else {
    entrance(o, m0, mid, id === "hq" ? 4.2 : 5.6, id === "ipo" ? 4.4 : 3.6, id === "hq" ? 0x2e3a42 : 0xd8b04a, id === "hq" ? 0x1c2a33 : 0x15181c);
    roofPlant(o, m0, id === "hq" ? 2 : 1);
    const cx = (X(top.u0) + X(top.u1)) / 2, cy = (Y(top.v0) + Y(top.v1)) / 2;
    mast(o, cx, cy, Z(top.z1), id === "hq" ? 5 : id === "boardroom" ? 9 : 6, id === "hq" ? 0xc9d3da : 0xa9852c);
    if (id === "ipo") {
      // THE TICKER: a dark band round the tower near its top, green and red figures on it.
      const t = b.masses[1], z = Z(t.z1) - 5.9, tx0 = X(t.u0), tx1 = X(t.u1), ty0 = Y(t.v0), ty1 = Y(t.v1);
      cb(o, tx0 - 0.3, tx1 + 0.3, ty0 - 0.3, ty1 + 0.3, z, z + 1.4, 0x15181c, "trim");
      for (let a = tx0 + 0.6, k = 0; a < tx1 - 1.2; a += 1.9, k++) cb(o, a, a + 1.2, ty1 + 0.3, ty1 + 0.36, z + 0.45, z + 0.95, (k * 7) % 3 === 0 ? 0xff5a4f : 0x3fe07a, "light");
      for (let a = ty0 + 0.6, k = 0; a < ty1 - 1.2; a += 1.9, k++) cb(o, tx1 + 0.3, tx1 + 0.36, a, a + 1.2, z + 0.45, z + 0.95, (k * 5) % 3 === 1 ? 0xff5a4f : 0x3fe07a, "light");
    }
    // Planters either side of the way in.
    for (const sg of [-1, 1]) { cb(o, mid + sg * 5.4 - 0.9, mid + sg * 5.4 + 0.9, front + 0.6, front + 1.6, g, g + 0.6, 0xc9c4b8, "stone"); cb(o, mid + sg * 5.4 - 0.8, mid + sg * 5.4 + 0.8, front + 0.7, front + 1.5, g + 0.6, g + 1.1, 0x4f7a3f, "hedge"); }
  }
  yard(o, tier, level);
  return o;
}
