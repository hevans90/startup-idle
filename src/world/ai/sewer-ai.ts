/**
 * World v2 — THE AI SEES TO ITS SLOP: which vibe workplace has slop and no
 * sewer, and the route for one from its slop port — to a processor's inlet
 * first, else onto a sewer already laid, else to water for an outfall; and
 * another refinery when there is more slop than the refineries standing can
 * take. Laid and bought through the player's own actions. AI mode.
 * @see neededPipe, game/slop, game/processors
 */
import { pipeCost, buildCost } from "../../game/build-cost";
import { PROCESS_RATE, processorKind } from "../../game/processors";
import { slopMaking } from "../../game/slop";
import { featureGateOpen } from "../../game/projects";
import { mainWet } from "../../state/world.store";
import { WORKPLACES } from "../agents/commute";
import { idx, inBounds, structureAt, type Grid, type Structure } from "../grid";
import { hasMain, isSewer, planMain } from "../water/mains";
import { portsOf } from "../water/ports";

type Cell = { x: number; y: number };

/** The furthest, in tiles, it will lay a sewer. */
export const SEWER_REACH = 60;

/** Each vibe workplace with a slop port free and no sewer at it. */
function unsewered(g: Grid): { s: Structure; port: Cell }[] {
  const out: { s: Structure; port: Cell }[] = [];
  for (const s of g.structures.values()) {
    if (s.build || !WORKPLACES.vibe_coder.includes(s.def)) continue;
    const p = portsOf(g, s).find((q) => q.port.fluid === "slop" && q.port.dir === "out");
    if (!p || structureAt(g, p.x, p.y) >= 0 || hasMain(g, p.i)) continue;
    // A sewer beside the port: the stub will join it by itself. @see sewerStubs
    if ([[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => inBounds(g, p.x + dx, p.y + dy) && isSewer(g, idx(g, p.x + dx, p.y + dy)))) continue;
    out.push({ s, port: { x: p.x, y: p.y } });
  }
  return out;
}

/**
 * A SEWER'S ROUTE from a slop port, by the roads and the open ground — never
 * through a building, over water, or across another main: to the nearest
 * processor inlet if there is one in reach, else onto the nearest sewer, else
 * to the nearest tile beside water. Null with none. Pure.
 */
export function routeSewer(g: Grid, from: Cell, wet: (x: number, y: number) => boolean): Cell[] | null {
  const inlets = new Set<number>();
  for (const s of g.structures.values()) {
    if (!processorKind(s.def) || s.build) continue;
    for (const p of portsOf(g, s)) if (p.port.fluid === "slop" && p.port.dir === "in" && structureAt(g, p.x, p.y) < 0) inlets.add(p.i);
  }
  const prev = new Int32Array(g.w * g.h).fill(-2);
  const dist = new Int32Array(g.w * g.h);
  const start = idx(g, from.x, from.y);
  prev[start] = -1;
  const queue = [start];
  let processor = -1, sewer = -1, water = -1;
  for (let q = 0; q < queue.length && processor < 0; q++) {
    const i = queue[q], x = i % g.w, y = (i / g.w) | 0;
    if (dist[i] > SEWER_REACH) break;
    if (i !== start && inlets.has(i)) { processor = i; break; }
    if (water < 0 && i !== start && [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => inBounds(g, x + dx, y + dy) && wet(x + dx, y + dy))) water = i;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (!inBounds(g, nx, ny)) continue;
      const j = idx(g, nx, ny);
      if (prev[j] !== -2) continue;
      if (structureAt(g, nx, ny) >= 0 || wet(nx, ny)) continue;
      // ONTO A SEWER: it ends there, joined. Any other main is in the way.
      if (hasMain(g, j)) {
        if (isSewer(g, j) && sewer < 0) { prev[j] = i; dist[j] = dist[i] + 1; sewer = j; }
        continue;
      }
      prev[j] = i;
      dist[j] = dist[i] + 1;
      queue.push(j);
    }
  }
  const end = processor >= 0 ? processor : sewer >= 0 ? sewer : water;
  if (end < 0) return null;
  const path: Cell[] = [];
  for (let k = end; k !== -1; k = prev[k]) path.push({ x: k % g.w, y: (k / g.w) | 0 });
  return path.reverse();
}

/** The sewer most wanted, and its price: for a workplace with slop and none; null with no slop or no way. */
export function neededSewer(g: Grid): { s: Structure; cells: Cell[]; price: number } | null {
  if (slopMaking() <= 0) return null;
  const wet = mainWet(g);
  for (const { s, port } of unsewered(g)) {
    const cells = routeSewer(g, port, wet);
    if (!cells || cells.length < 2) continue;
    const plan = planMain(g, cells, wet, false, true);
    if ("refused" in plan) continue;
    const fresh = plan.cells.filter((c) => !hasMain(g, idx(g, c.x, c.y))).length;
    return { s, cells, price: pipeCost(fresh).toNumber() };
  }
  return null;
}

/** Whether there is more slop made than the refineries standing can take, and another can be bought. */
export function wantsRefinery(g: Grid): { price: number } | null {
  if (!featureGateOpen("refinery")) return null;
  let n = 0;
  for (const s of g.structures.values()) if (s.def === "refinery") n++;
  if (slopMaking() <= n * PROCESS_RATE) return null;
  const price = buildCost("refinery")?.toNumber();
  return price === undefined ? null : { price };
}
