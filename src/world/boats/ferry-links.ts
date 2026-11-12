/**
 * World v2 — THE FERRY, AS A WAY TO WORK: a port with a ferry ramp joins the
 * roads on its river's banks to its own gate, as if a short road ran across
 * the water. So a street on the far bank, with no bridge to it, is a few
 * tiles from the port and not cut off: its people get to their desks, and
 * the houses there are worth living in. @see walkFrom, plans/seaports.md §3
 *
 * Pure on the map, and kept until it is next edited.
 */
import { VOID, idx, inBounds, type Grid, type Structure } from "../grid";
import { structureDef } from "../structures/def";
import { quayTiles, steadyRivers } from "./quay";

/** How far along the river from its port a ferry lands, in tiles; how near the water a road must come to be landed at. */
export const FERRY_REACH = 12;
export const FERRY_BANK = 2;
/** What a crossing counts for on the way to work, in tiles of road. */
export const FERRY_TILES = 4;

let kept: { g: Grid; rev: number; links: Map<number, number[]> } | null = null;

const hasFerry = (s: Structure) => !s.build && !!s.facing && !!structureDef(s.def)?.port && !!s.fit?.includes("ferry");

/**
 * Each road tile a ferry joins, and the tiles it is joined to: a port's gate
 * tiles — the road against it — to every road tile by its river within the
 * ferry's reach, and back.
 */
export function ferryLinks(g: Grid): ReadonlyMap<number, readonly number[]> {
  if (kept && kept.g === g && kept.rev === g.rev) return kept.links;
  const links = new Map<number, number[]>();
  const join = (a: number, b: number) => { const l = links.get(a); if (!l) links.set(a, [b]); else if (!l.includes(b)) l.push(b); };
  const ports = [...g.structures.values()].filter(hasFerry);
  if (ports.length) {
    const r = steadyRivers(g);
    const road = (x: number, y: number) => inBounds(g, x, y) && g.paved[idx(g, x, y)] !== VOID;
    for (const s of ports) {
      const river = quayTiles(s, s.facing!).map((q) => (inBounds(g, q.wx, q.wy) ? r.river[idx(g, q.wx, q.wy)] : 0)).find((k) => k > 0);
      if (!river) continue;
      // ITS GATE: the road against its walls.
      const gates: number[] = [];
      for (let y = s.y - 1; y <= s.y + s.h; y++) for (let x = s.x - 1; x <= s.x + s.w; x++) {
        const edge = (x < s.x || x >= s.x + s.w) !== (y < s.y || y >= s.y + s.h);
        if (edge && road(x, y)) gates.push(idx(g, x, y));
      }
      if (!gates.length) continue;
      const cx = s.x + (s.w - 1) / 2, cy = s.y + (s.h - 1) / 2;
      const x0 = Math.max(0, Math.floor(cx - FERRY_REACH)), x1 = Math.min(g.w - 1, Math.ceil(cx + FERRY_REACH));
      const y0 = Math.max(0, Math.floor(cy - FERRY_REACH)), y1 = Math.min(g.h - 1, Math.ceil(cy + FERRY_REACH));
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
        const i = idx(g, x, y);
        if (!road(x, y) || gates.includes(i)) continue;
        let byWater = false;
        for (let dy = -FERRY_BANK; dy <= FERRY_BANK && !byWater; dy++) for (let dx = -FERRY_BANK; dx <= FERRY_BANK; dx++) {
          if (inBounds(g, x + dx, y + dy) && r.river[idx(g, x + dx, y + dy)] === river) { byWater = true; break; }
        }
        if (!byWater) continue;
        for (const gate of gates) { join(gate, i); join(i, gate); }
      }
    }
  }
  kept = { g, rev: g.rev, links };
  return links;
}
