/**
 * World v2 — OLD SEWERS, PUT UNDERGROUND. A save from before the sewers went
 * under the ground has them above it, as brown mains: a run from slop ports
 * to an outfall or a processor, joined to workplaces beside it by stubs.
 *
 * Each such network becomes a trunk on the same tiles, under them: its
 * outfalls kept, its processor inlets kept, and for each workplace it took
 * slop from, a manhole on the trunk beside that workplace's port and a
 * one-tile lateral from the port down into it. The ground decides the rest
 * — where an old run went uphill, which nothing stopped, the solve puts a
 * lift station, and conversion costs nothing. A lateral (a sewer main
 * that reaches a manhole) is new already, and left. @see plans/underground-sewers.md §8
 */
import { DIR, NEIGHBOUR } from "../../iso/dir";
import { MAIN_AI, MAIN_BORE, MAIN_END, MAIN_SEWER, MAIN_STUB, SEWER_AI, SEWER_BORE, SEWER_FIT, edited, idx, inBounds, type Grid } from "../grid";
import { findMains } from "../water/mains";
import { portsAt } from "../water/ports";

const SIDES = ["N", "E", "S", "W"] as const;
const OPPOSITE = { N: "S", S: "N", E: "W", W: "E" } as const;

/** Put a map's above-ground sewers underground. Whether anything changed. */
export function sewersUnderground(g: Grid): boolean {
  const old = findMains(g).list.filter((n) => n.sewer && !n.cells.some((i) => g.sewerFit[i] === SEWER_FIT.node));
  if (!old.length) return false;
  for (const net of old) {
    const on = new Set(net.cells);
    // THE TRUNK: every tile but the stubs, which were only ever a port's.
    const trunk = net.cells.filter((i) => !(g.main[i] & MAIN_STUB));
    const isTrunk = new Set(trunk);
    for (const i of trunk) {
      const x = i % g.w, y = (i / g.w) | 0;
      let join = 0;
      for (const side of SIDES) {
        const [dx, dy] = NEIGHBOUR[side];
        if (!(g.main[i] & DIR[side]) || !inBounds(g, x + dx, y + dy)) continue;
        if (isTrunk.has(idx(g, x + dx, y + dy))) join |= DIR[side];
      }
      g.sewer[i] |= join | (g.main[i] & MAIN_BORE ? SEWER_BORE : 0) | (g.main[i] & MAIN_AI ? SEWER_AI : 0);
      const end = g.mainEnd[i];
      if (end === MAIN_END.outfall) g.sewerFit[i] = SEWER_FIT.outfall;
      else if (end === MAIN_END.outlet && portsAt(g, i, "slop", "in").length) g.sewerFit[i] = SEWER_FIT.inlet;
    }
    // EACH PORT IT TOOK FROM: a manhole on the trunk beside it, and a lateral down into it.
    const ports = net.cells.filter((i) => portsAt(g, i, "slop", "out").length);
    const laterals: [number, number][] = [];
    for (const p of ports) {
      const x = p % g.w, y = (p / g.w) | 0;
      const beside = SIDES.map((side) => {
        const [dx, dy] = NEIGHBOUR[side];
        return inBounds(g, x + dx, y + dy) ? { side, j: idx(g, x + dx, y + dy) } : null;
      }).filter((b): b is { side: (typeof SIDES)[number]; j: number } => !!b && isTrunk.has(b.j) && (g.main[p] & DIR[b.side]) !== 0);
      // Beside one with no fitting, or any, or — a port on the trunk with none beside — the port's own tile.
      const at = beside.find((b) => !g.sewerFit[b.j]) ?? beside[0];
      if (at) {
        if (!g.sewerFit[at.j]) g.sewerFit[at.j] = SEWER_FIT.node;
        laterals.push([p, at.j]);
      } else if (isTrunk.has(p) && !g.sewerFit[p]) g.sewerFit[p] = SEWER_FIT.node;
    }
    // THE OLD MAIN COMES UP, all of it; the laterals go down.
    const ai = net.cells.some((i) => g.main[i] & MAIN_AI) ? MAIN_AI : 0;
    for (const i of on) { g.main[i] = 0; g.mainEnd[i] = 0; }
    for (const [p, j] of laterals) {
      const side = SIDES.find((s) => idx(g, (p % g.w) + NEIGHBOUR[s][0], ((p / g.w) | 0) + NEIGHBOUR[s][1]) === j)!;
      g.main[p] |= DIR[side] | MAIN_SEWER | ai;
      g.main[j] |= DIR[OPPOSITE[side]] | MAIN_SEWER | ai;
      g.mainEnd[p] = MAIN_END.drain;
      g.mainEnd[j] = MAIN_END.drop;
    }
  }
  edited(g);
  return true;
}
