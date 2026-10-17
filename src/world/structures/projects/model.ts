/**
 * World v2 — a project's building as DATA: the masses it is made of, the skin
 * on each, and the roof on top. The same model draws the finished building
 * and every stage of the site, so a site turns into exactly what it was
 * going to be. @see schedule, site, looks
 *
 * The site this replaced was one grey box for every building, swapped at the
 * end for whatever the building really was — a tower rose as a block of the
 * wrong width, a campus as a rectangle that became an L.
 */
import { RIGHT, mix, tone, type Pen } from "./pen";

/** The skin on a mass's two visible faces, storey by storey. */
export type Facade =
  /** Wall, and nothing on it — or courses of block every `every` half steps. */
  | { kind: "plain"; lines?: number; every?: number }
  /** A window in a frame, `w` tiles wide, `gap` apart, from `sill` to `head` below the next floor. */
  | { kind: "windows"; glass: number; frame: number; w: number; gap: number; sill: number; head: number; edge?: number }
  /** A band of glass the length of the face, from `sill` to `head` below the next floor. */
  | { kind: "ribbon"; glass: number; frame?: number; sill: number; head: number; edge?: number }
  /** Glass the whole face, mullions every `every` tiles and a spandrel at each floor. */
  | { kind: "curtain"; glass: number; mullion: number; every: number; spandrel?: number }
  /** Glass behind upright fins every `every` tiles. */
  | { kind: "fins"; glass: number; fin: number; every: number }
  /** Louvres: a slat every `every` half steps, the length of the face. */
  | { kind: "louvres"; slat: number; every: number; edge?: number };

export type Roof =
  /** A deck inside a parapet `h` high and `t` thick. */
  | { kind: "parapet"; deck: number; rim: number; h?: number; t?: number }
  /** A deck flush with the walls. */
  | { kind: "flat"; deck: number }
  /** Planted, inside a low rim. */
  | { kind: "garden"; deck: number; rim: number };

/** A box of building in local coordinates. @see Pen */
export type Mass = {
  u0: number; v0: number; u1: number; v1: number; z0: number; z1: number;
  wall: number;
  /** Half steps a floor. Floors are counted off the mass's own height. */
  storey: number;
  facade: Facade;
  /** The ground floor's skin, where it differs: a lobby, a shopfront. */
  ground?: Facade;
  roof: Roof;
  /** A band round the top, standing `out` proud of the walls. */
  cornice?: { colour: number; h: number; out: number };
};

export type Footprint = { w: number; h: number };

export type Building = {
  /** The stone the building stands on, `inset` in from the plot. */
  plinth: { inset: number; h: number; colour: number; top?: number };
  /** Drawn in order. Lower first, then back to front. @see sortMasses */
  masses: Mass[];
  /** The plot round the building once it is open: paving, lawn, planting. */
  grounds?: (p: Pen, f: Footprint) => void;
  /** Signs, plant, flags: the fit-out, drawn on the finished building. */
  details?: (p: Pen, f: Footprint) => void;
  /** What lifts the materials: a tower crane, or nothing for a little building. */
  crane: "tower" | "none";
};

/**
 * A safe order to paint masses in: lower first, then back to front. A tower
 * on a podium goes after the podium, two blocks side by side the nearer last.
 */
export function sortMasses(ms: readonly Mass[]): Mass[] {
  return [...ms].sort((a, b) => a.z0 - b.z0 || (a.u1 + a.v1) - (b.u1 + b.v1));
}

/** The floors of a mass: how many, and how tall each really is. */
export function floorsOf(m: Mass): { n: number; h: number } {
  const n = Math.max(1, Math.round((m.z1 - m.z0) / m.storey));
  return { n, h: (m.z1 - m.z0) / n };
}

/** How far up a mass whole floors reach, at or below `z`. */
export function wholeFloors(m: Mass, z: number): number {
  const { h } = floorsOf(m);
  if (z >= m.z1 - 1e-6) return m.z1;
  if (z <= m.z0) return m.z0;
  return m.z0 + Math.floor((z - m.z0) / h + 1e-6) * h;
}

const WHITE = 0xffffff;

/**
 * Rectangles on a mass's two visible faces: `along` from 0 to the face's
 * length, shaded for the face they are on.
 */
function onFaces(
  p: Pen, m: Mass, a0: number, a1: number, z0: number, z1: number, colour: number, alpha = 1,
  which: "both" | "v" | "u" = "both",
) {
  if (which !== "u") p.onV(m.v1, m.u0 + a0, m.u0 + a1, z0, z1, colour, alpha);
  if (which !== "v") p.onU(m.u1, m.v0 + a0, m.v0 + a1, z0, z1, tone(colour, RIGHT), alpha);
}

/** Spans of `w` with `gap` between, centred on a face `len` long inside `edge`. */
export function bays(len: number, w: number, gap: number, edge = 0.12): [number, number][] {
  const room = len - edge * 2;
  const n = Math.floor((room + gap) / (w + gap));
  if (n <= 0) return [];
  const used = n * w + (n - 1) * gap;
  const start = edge + (room - used) / 2;
  const out: [number, number][] = [];
  for (let k = 0; k < n; k++) out.push([start + k * (w + gap), start + k * (w + gap) + w]);
  return out;
}

/** One floor of a facade, between `z0` and `z1`, on both faces. */
function drawFloor(p: Pen, m: Mass, f: Facade, z0: number, z1: number) {
  const faces: ["v" | "u", number][] = [["v", m.u1 - m.u0], ["u", m.v1 - m.v0]];
  const glassy = (glass: number, a0: number, a1: number, b0: number, b1: number, face: "v" | "u") => {
    onFaces(p, m, a0, a1, b0, b1, glass, 1, face);
    // A sky reflection across the upper part of the pane.
    onFaces(p, m, a0, a1, b0 + (b1 - b0) * 0.62, b1, mix(glass, WHITE, 0.28), 1, face);
  };
  switch (f.kind) {
    case "plain": {
      if (!f.lines) return;
      const every = f.every ?? 0.4;
      for (const [face, len] of faces) {
        for (let z = z0 + every; z < z1 - 0.02; z += every) onFaces(p, m, 0, len, z - 0.015, z + 0.015, f.lines, 1, face);
      }
      return;
    }
    case "windows": {
      for (const [face, len] of faces) {
        for (const [a, b] of bays(len, f.w, f.gap, f.edge)) {
          const s0 = z0 + f.sill, s1 = z1 - f.head;
          if (s1 <= s0) continue;
          onFaces(p, m, a - 0.025, b + 0.025, s0 - 0.05, s1 + 0.04, f.frame, 1, face);
          glassy(f.glass, a, b, s0, s1, face);
          // A sill, catching the light.
          onFaces(p, m, a - 0.04, b + 0.04, s0 - 0.07, s0 - 0.03, mix(f.frame, WHITE, 0.3), 1, face);
        }
      }
      return;
    }
    case "ribbon": {
      const e = f.edge ?? 0.1;
      for (const [face, len] of faces) {
        const s0 = z0 + f.sill, s1 = z1 - f.head;
        if (f.frame !== undefined) onFaces(p, m, e - 0.02, len - e + 0.02, s0 - 0.04, s1 + 0.04, f.frame, 1, face);
        glassy(f.glass, e, len - e, s0, s1, face);
        // Mullions down the band.
        if (f.frame !== undefined) {
          for (let a = e + 0.33; a < len - e - 0.1; a += 0.33) onFaces(p, m, a - 0.012, a + 0.012, s0, s1, f.frame, 1, face);
        }
      }
      return;
    }
    case "curtain": {
      for (const [face, len] of faces) {
        glassy(f.glass, 0, len, z0, z1, face);
        if (f.spandrel !== undefined) onFaces(p, m, 0, len, z0, z0 + 0.22, f.spandrel, 1, face);
        for (let a = f.every; a < len - 0.02; a += f.every) onFaces(p, m, a - 0.014, a + 0.014, z0, z1, f.mullion, 1, face);
        onFaces(p, m, 0, len, z1 - 0.03, z1, f.mullion, 1, face);
      }
      return;
    }
    case "fins": {
      for (const [face, len] of faces) {
        glassy(f.glass, 0.02, len - 0.02, z0 + 0.05, z1, face);
        for (let a = f.every / 2; a < len - 0.02; a += f.every) onFaces(p, m, a - 0.022, a + 0.022, z0, z1, f.fin, 1, face);
      }
      return;
    }
    case "louvres": {
      const e = f.edge ?? 0.14;
      for (const [face, len] of faces) {
        onFaces(p, m, e, len - e, z0 + 0.25, z1 - 0.2, tone(f.slat, 0.62), 1, face);
        for (let z = z0 + 0.25 + f.every; z < z1 - 0.2; z += f.every) onFaces(p, m, e, len - e, z - 0.035, z, f.slat, 1, face);
      }
      return;
    }
  }
}

/** A mass's walls and skin from its foot to `top`, topped with `cap`. */
export function drawClad(p: Pen, m: Mass, top: number, cap: number) {
  if (top <= m.z0 + 1e-6) return;
  const { h } = floorsOf(m);
  p.box(m.u0, m.v0, m.u1, m.v1, m.z0, top, m.wall, { top: cap });
  for (let k = 0, z = m.z0; z < top - 1e-6; k++, z += h) {
    drawFloor(p, m, k === 0 && m.ground ? m.ground : m.facade, z, Math.min(top, z + h));
  }
}

/** The roof on a mass that is clad to the top. */
export function drawRoof(p: Pen, m: Mass) {
  const r = m.roof;
  const z = m.z1;
  if (m.cornice) {
    const o = m.cornice.out;
    p.box(m.u0 - o, m.v0 - o, m.u1 + o, m.v1 + o, z - m.cornice.h, z, m.cornice.colour, { noTop: true });
  }
  if (r.kind === "flat") return;
  const t = r.kind === "parapet" ? r.t ?? 0.07 : 0.05;
  const hh = r.kind === "parapet" ? r.h ?? 0.22 : 0.12;
  const rim = r.rim;
  // The back two lengths of the rim, then the front two over the deck's edge.
  p.box(m.u0, m.v0, m.u1, m.v0 + t, z, z + hh, rim);
  p.box(m.u0, m.v0 + t, m.u0 + t, m.v1, z, z + hh, rim);
  if (r.kind === "garden") {
    // Shrubs in rows across the deck.
    for (let u = m.u0 + 0.22; u < m.u1 - 0.12; u += 0.36) {
      for (let v = m.v0 + 0.22; v < m.v1 - 0.12; v += 0.36) {
        p.box(u - 0.08, v - 0.08, u + 0.08, v + 0.08, z, z + 0.22, tone(r.deck, 0.85), { top: tone(r.deck, 1.18) });
      }
    }
  }
  // The right length before the front one, which runs the full width and
  // owns the corner: drawn after it, the right length's end — a face turned
  // to the camera — painted over the corner's top, a notch in the near vertex.
  p.box(m.u1 - t, m.v0, m.u1, m.v1 - t, z, z + hh, rim);
  p.box(m.u0, m.v1 - t, m.u1, m.v1, z, z + hh, rim);
}

/** The finished mass. */
export function drawMass(p: Pen, m: Mass) {
  drawClad(p, m, m.z1, m.roof.deck);
  drawRoof(p, m);
}

/** Colours of a building going up. */
export const CONCRETE = 0xbdb8ad;
export const CONCRETE_DARK = 0x8f8a80;
export const REBAR = 0x9a5a3a;

/** Where the columns of a frame stand along a length, about every half tile. */
function posts(len: number): number[] {
  const n = Math.max(1, Math.round(len / 0.5));
  const out: number[] = [];
  for (let k = 0; k <= n; k++) out.push((len * k) / n);
  return out;
}

/**
 * THE BARE FRAME of a mass from `from` to `to`: concrete columns round its
 * edge, a slab at every floor, and the lift core in the middle running a
 * little ahead of it all. Floors whole up to `to`; the floor going up shows
 * its columns rising and no slab yet.
 */
export function drawFrame(p: Pen, m: Mass, from: number, to: number) {
  if (to <= from + 1e-6) return;
  const { h } = floorsOf(m);
  const C = 0.035;
  const us = posts(m.u1 - m.u0).map((a) => m.u0 + Math.min(m.u1 - m.u0 - C, Math.max(C, a)));
  const vs = posts(m.v1 - m.v0).map((b) => m.v0 + Math.min(m.v1 - m.v0 - C, Math.max(C, b)));
  const cu = (m.u0 + m.u1) / 2, cv = (m.v0 + m.v1) / 2;
  const core = Math.min(0.22, (m.u1 - m.u0) / 5, (m.v1 - m.v0) / 5);
  const column = (u: number, v: number, z0: number, z1: number) =>
    p.box(u - C, v - C, u + C, v + C, z0, z1, CONCRETE, { right: tone(CONCRETE, 0.72) });
  for (let z = from; z < to - 1e-6; z += h) {
    const z1 = Math.min(to, z + h);
    const whole = z1 >= z + h - 1e-6;
    const colTop = whole ? z1 - 0.12 : z1;
    // The far rows first: along the back, and down the far side.
    for (const u of us) column(u, vs[0], z, colTop);
    for (const v of vs.slice(1)) column(us[0], v, z, colTop);
    // The core, a floor ahead.
    p.box(cu - core, cv - core, cu + core, cv + core, z, Math.min(m.z1, z1 + (whole ? 0.5 : 0.3)), CONCRETE_DARK);
    // Then the near rows.
    for (const v of vs.slice(1, -1)) column(us[us.length - 1], v, z, colTop);
    for (const u of us.slice(1)) column(u, vs[vs.length - 1], z, colTop);
    if (whole) p.box(m.u0, m.v0, m.u1, m.v1, z1 - 0.12, z1, CONCRETE, { top: tone(CONCRETE, 1.08) });
    else {
      // Starter bars out of the tops of the columns going up.
      for (const u of us) p.strut([u, vs[vs.length - 1], z1], [u, vs[vs.length - 1], z1 + 0.25], 0.012, REBAR);
    }
  }
}
