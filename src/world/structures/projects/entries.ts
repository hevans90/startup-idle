/**
 * World v2 — WHERE A PIPE GOES IN, so a main always joins something standing:
 *
 *  - an AI building's water inlet is FLANGED STRAIGHT ONTO ITS WALL: the main
 *    runs on past the edge of the plot to the wall, however far back it is;
 *  - a slop port has an ENTRY, part of the building: a concrete service
 *    housing from its wall out to the edge of the plot, where the outlet is
 *    bolted to its face — a cap on top, a band in the fluid's colour round
 *    it, and a vent on its side where it is long enough to have one.
 *
 * @see outlet (the plate, spigot and flange, drawn with the mains), world/water/ports
 */
import type { Port } from "../def";
import type { Building, Footprint, Mass } from "./model";
import { RIGHT, tone, type Pen } from "./pen";

/** Its width along the face, tiles; its height, half steps. Clear of the outlet's plate all round. */
export const ENTRY_W = 0.44, ENTRY_H = 2.4;
/** The cap: how far it overhangs, tiles, and how thick, half steps. */
const CAP_OUT = 0.025, CAP_H = 0.18;
/** The fluid's band: from and to, half steps up. */
const BAND = [1.96, 2.12] as const;
/** A housing standing at least this far out has a vent on its side, tiles. */
const VENT_FROM = 0.3;
const CONCRETE = 0xc9c4b8, CAP = 0xa9a396, VENT = 0x4a4f55, SLAT = 0x7d838a;
/** The fluid's colour on the band. @see PORT_COLOUR */
const FLUID = { water: 0x3f86c6, slop: 0x7a5230 } as const;
/** Where there is no wall behind it to find, how far in from the edge it reaches, tiles. */
const NO_WALL = 0.35;

/** A port's place along its face, local: the middle of its tile. */
function along(p: Port, f: Footprint): number {
  return Math.min(p.at, (p.face === "S" || p.face === "N" ? f.h : f.w) - 1) + 0.5;
}

/**
 * How far out the building's wall stands behind a port on a +u (S) or +v (W)
 * face, local: the nearest face of the lowest masses across its place.
 */
export function wallBehind(b: Building, f: Footprint, p: Port): number {
  const a = along(p, f), s = p.face === "S";
  const over = b.masses.filter((m: Mass) => (s ? m.v0 <= a && a <= m.v1 : m.u0 <= a && a <= m.u1));
  const low = over.length ? Math.min(...over.map((m) => m.z0)) : 0;
  const ground = over.filter((m) => m.z0 <= low + 1e-6);
  const edge = s ? f.w : f.h;
  if (!ground.length) return edge - NO_WALL;
  return Math.min(edge, Math.max(...ground.map((m) => (s ? m.u1 : m.v1))));
}

/** Whether a port's outlet is flanged straight onto the wall: an AI building's water inlet. */
export const direct = (port: Port) => port.fluid === "water";

/**
 * How far in from the edge of the plot a port's outlet stands, tiles: at the
 * wall for one flanged straight onto it; else at the edge, on its entry's face.
 */
export function portSetback(b: Building, f: Footprint, port: Port): number {
  if (!direct(port) || (port.face !== "S" && port.face !== "W")) return 0;
  return Math.max(0, (port.face === "S" ? f.w : f.h) - wallBehind(b, f, port));
}

/** Each slop port's entry, on the faces the camera sees (S and W), in front of the building. */
export function drawEntries(p: Pen, b: Building, f: Footprint, ports: readonly Port[]) {
  for (const port of ports) {
    if ((port.face !== "S" && port.face !== "W") || direct(port)) continue;
    const s = port.face === "S", a = along(port, f), edge = s ? f.w : f.h;
    // Into the wall a little, so no seam shows; at the plot's edge, where its outlet is.
    const inner = Math.min(wallBehind(b, f, port), edge - 0.12) - 0.04;
    const half = ENTRY_W / 2, band = FLUID[port.fluid];
    // In local (u, v): out along u from a S face, along v from a W one.
    const rect = (o0: number, o1: number, c0: number, c1: number) =>
      s ? ([o0, c0, o1, c1] as const) : ([c0, o0, c1, o1] as const);
    const [u0, v0, u1, v1] = rect(inner, edge, a - half, a + half);
    p.box(u0, v0, u1, v1, 0, ENTRY_H, CONCRETE);
    // The cap, overhanging all but the wall side.
    const [cu0, cv0, cu1, cv1] = rect(inner, edge + 0, a - half - CAP_OUT, a + half + CAP_OUT);
    p.box(cu0, cv0, cu1, cv1, ENTRY_H, ENTRY_H + CAP_H, CAP);
    // The fluid's band round the two faces that show.
    if (s) {
      p.onU(edge, a - half, a + half, BAND[0], BAND[1], tone(band, RIGHT));
      p.onV(a + half, inner, edge, BAND[0], BAND[1], band);
    } else {
      p.onV(edge, a - half, a + half, BAND[0], BAND[1], band);
      p.onU(a + half, inner, edge, BAND[0], BAND[1], tone(band, RIGHT));
    }
    // A vent on its long side, if it has one: a dark panel, slats across it.
    const depth = edge - inner;
    if (depth >= VENT_FROM) {
      const o0 = inner + depth * 0.3, o1 = edge - depth * 0.25, z0 = 0.7, z1 = 1.6;
      const side = (o: number, o2: number, za: number, zb: number, c: number) =>
        s ? p.onV(a + half, o, o2, za, zb, c) : p.onU(a + half, o, o2, za, zb, tone(c, RIGHT));
      side(o0, o1, z0, z1, VENT);
      for (let z = z0 + 0.18; z < z1 - 0.05; z += 0.22) side(o0 + 0.01, o1 - 0.01, z, z + 0.06, SLAT);
    }
  }
}
