/**
 * World v2 — PORTS: where a pipe may join a building. Each is a nozzle on a
 * face of the footprint (`StructureDef.ports`); a main joins it by ending on
 * the tile in front of it, and nowhere else along the wall. Pure on the map:
 * which tiles are ports, of what, and the nearest one to a point.
 * @see Port, world/water/mains, plans/pipes-and-slop.md §2
 */
import { NEIGHBOUR } from "../../iso/dir";
import { idx, inBounds, structureAt, type Grid, type Structure } from "../grid";
import { structureDef, type Port } from "../structures/def";

/** One port of a building on the map: the tile in front of it, its face, what it is, and whose. */
export type PortCell = { i: number; x: number; y: number; port: Port; building: number };

/** The tile in front of each port a building of `def` would have, set down at (x, y), `w` by `h`: off the map, left out. */
export function portTiles(g: Grid, def: string, x0: number, y0: number, w: number, h: number): { x: number; y: number; port: Port }[] {
  const out: { x: number; y: number; port: Port }[] = [];
  for (const port of structureDef(def)?.ports ?? []) {
    // Along a N/S face runs y; along an E/W face, x. Kept on the face if the footprint was placed smaller.
    const ns = port.face === "N" || port.face === "S";
    const at = Math.min(port.at, (ns ? h : w) - 1);
    const [dx, dy] = NEIGHBOUR[port.face];
    const x = ns ? (dx > 0 ? x0 + w : x0 - 1) : x0 + at;
    const y = ns ? y0 + at : (dy > 0 ? y0 + h : y0 - 1);
    if (inBounds(g, x, y)) out.push({ x, y, port });
  }
  return out;
}

/** A building's ports, the tile in front of each — none for one being built, or off the map. */
export function portsOf(g: Grid, s: Structure): PortCell[] {
  if (s.build) return [];
  return portTiles(g, s.def, s.x, s.y, s.w, s.h).map((t) => ({ ...t, i: idx(g, t.x, t.y), building: s.id }));
}

/**
 * Whether a building of `def` set down at (x, y), `w` by `h`, would have an
 * inlet a main could reach — one with no building on it. True for one with
 * no ports. @see world/ai/planner
 */
export function inletOpen(g: Grid, def: string, x: number, y: number, w: number, h: number): boolean {
  const tiles = portTiles(g, def, x, y, w, h);
  return !structureDef(def)?.ports?.length || tiles.some((t) => structureAt(g, t.x, t.y) < 0);
}

/** The buildings beside a tile, once each. */
function beside(g: Grid, x: number, y: number): Structure[] {
  const out: Structure[] = [];
  for (const [dx, dy] of Object.values(NEIGHBOUR)) {
    if (!inBounds(g, x + dx, y + dy)) continue;
    const s = g.structures.get(structureAt(g, x + dx, y + dy));
    if (s && !out.includes(s)) out.push(s);
  }
  return out;
}

/** The ports a tile is in front of, for a fluid and a direction. */
export function portsAt(g: Grid, i: number, fluid: Port["fluid"] = "water", dir: Port["dir"] = "in"): PortCell[] {
  const x = i % g.w, y = (i / g.w) | 0;
  return beside(g, x, y).flatMap((s) => portsOf(g, s)).filter((p) => p.i === i && p.port.fluid === fluid && p.port.dir === dir);
}

/**
 * The building a tile meets WITHOUT a port of the fluid there — a wall a pipe
 * may not end on — of those `which` picks; or null.
 */
export function wallAt(g: Grid, i: number, which: (s: Structure) => boolean, fluid: Port["fluid"] = "water"): Structure | null {
  if (portsAt(g, i, fluid).length) return null;
  const x = i % g.w, y = (i / g.w) | 0;
  return beside(g, x, y).find((s) => !s.build && which(s) && portsOf(g, s).some((p) => p.port.fluid === fluid)) ?? null;
}

/**
 * The port nearest a tile, of the building `s`: one with nothing standing on
 * it first, and of those, one no other pipe ends on; null with none.
 */
export function nearestPort(g: Grid, s: Structure, from: { x: number; y: number }, taken: (i: number) => boolean, fluid: Port["fluid"] = "water"): PortCell | null {
  const open = portsOf(g, s).filter((p) => p.port.fluid === fluid && structureAt(g, p.x, p.y) < 0);
  const d = (p: PortCell) => Math.abs(p.x - from.x) + Math.abs(p.y - from.y) + (taken(p.i) ? 1000 : 0);
  return open.sort((a, b) => d(a) - d(b))[0] ?? null;
}
