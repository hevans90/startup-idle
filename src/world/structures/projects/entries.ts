/**
 * World v2 — WHERE A PIPE GOES IN: every port's outlet is FLANGED STRAIGHT
 * ONTO ITS BUILDING'S OWN WALL, and the pipe runs on past the edge of the
 * plot to that wall, however far back it stands. Nothing is built in front
 * of a building to take a pipe: each building with a port is drawn with a
 * wall behind it — the AI's and the processors' as they always were, a vibe
 * workplace's as a service wing of its own block (`studio` in `looks`).
 *
 * @see outlet (the plate, spigot and flange, drawn with the mains), world/water/ports
 */
import type { Port } from "../def";
import type { Building, Footprint, Mass } from "./model";

/** Where there is no wall behind it to find, how far in from the edge it reaches, tiles. */
const NO_WALL = 0.35;
/** Half the width of wall an outlet's plate wants behind it, tiles. */
export const PLATE_HALF = 0.15;

/** A port's place along its face, local: the middle of its tile. */
export function along(p: Port, f: Footprint): number {
  return Math.min(p.at, (p.face === "S" || p.face === "N" ? f.h : f.w) - 1) + 0.5;
}

/** The lowest masses standing across a place along a +u (S) or +v (W) face: the ones a wall there is made of. */
function groundAt(b: Building, s: boolean, a: number): Mass[] {
  const over = b.masses.filter((m: Mass) => (s ? m.v0 <= a && a <= m.v1 : m.u0 <= a && a <= m.u1));
  const low = over.length ? Math.min(...over.map((m) => m.z0)) : 0;
  return over.filter((m) => m.z0 <= low + 1e-6);
}

/**
 * How far out the building's wall stands behind a port on a +u (S) or +v (W)
 * face, local: the nearest face of the lowest masses across its place.
 */
export function wallBehind(b: Building, f: Footprint, p: Port): number {
  const s = p.face === "S", ground = groundAt(b, s, along(p, f));
  const edge = s ? f.w : f.h;
  if (!ground.length) return edge - NO_WALL;
  return Math.min(edge, Math.max(...ground.map((m) => (s ? m.u1 : m.v1))));
}

/**
 * Whether a wall stands the whole width of a port's plate, at the face the
 * outlet is flanged to: one mass across it, or two meeting flush behind it.
 * What every building with a port must be drawn with.
 */
export function wallAcross(b: Building, f: Footprint, p: Port): boolean {
  const s = p.face === "S", a = along(p, f), wall = wallBehind(b, f, p);
  return [a - PLATE_HALF, a, a + PLATE_HALF].every((at) =>
    groundAt(b, s, at).some((m) => Math.abs((s ? m.u1 : m.v1) - wall) < 1e-6));
}

/**
 * How far in from the edge of the plot a port's outlet stands, tiles: at the
 * building's wall, on the faces the camera sees (S and W); on the others, at
 * the edge.
 */
export function portSetback(b: Building, f: Footprint, port: Port): number {
  if (port.face !== "S" && port.face !== "W") return 0;
  return Math.max(0, (port.face === "S" ? f.w : f.h) - wallBehind(b, f, port));
}
