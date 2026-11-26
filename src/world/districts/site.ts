/**
 * WHERE A DISTRICT GOES: the nearest stretch of dry, bare, nearly level ground
 * its size, and the road that joins it to the town. Every corner on the map
 * is weighed at once by sums over the map (what is in the way, how much the
 * ground climbs), the best few then routed to the network. Pure.
 * @see layoutDistrict, routeRoad
 */
import { idx, structureAt, VOID, type Grid } from "../grid";
import { hasSewer } from "../sewers/solve";
import { routeRoad, type Cell } from "./route";

export type DistrictSite = {
  x0: number; y0: number;
  /** The road from the district's ring to the network, ring tile first; null when the map has no road to join, or it is already on one. */
  connector: Cell[] | null;
};

export type SiteOptions = {
  /** Where it would best be: the town's middle, by default the map's. */
  near?: Cell;
  /** Land it may use: by default all of it. */
  owned?: (x: number, y: number) => boolean;
  /** The most the ground may climb across it, in half steps. */
  maxRelief?: number;
  /** Keep this many tiles clear of the map's edge. */
  margin?: number;
  /** Whether it must be joined to the roads there are, when there are any. */
  connect?: boolean;
  /** Where its own roads run, from its corner: road already there may lie on these, and is welcome. @see districtRoadAt */
  roadAt?: (dx: number, dy: number) => boolean;
};
/** What a tile of road already there, under one of its own, takes off a site's score: a tile less to lay. */
const REUSED = 0.5;
/** What a tile further from where it would best be costs, against the rest: the commute, which is most of a house's mood. */
const FAR = 2;

/** How many of the nearest sites are routed before the best is chosen. */
const ROUTED = 8;

/** A tile a district cannot be laid over: no ground, water, a building, a sewer, land not ours. (Road is weighed apart.) */
function badAt(g: Grid, x: number, y: number, owned?: (x: number, y: number) => boolean): boolean {
  const i = idx(g, x, y);
  return g.terrain[i] === VOID || g.pool[i] > 0 || g.deckPool[i] > 0
    || structureAt(g, x, y) >= 0 || hasSewer(g, i) || (!!owned && !owned(x, y));
}

/** The best place for a district `w` by `h`, or null when none fits. */
export function findDistrictSite(g: Grid, w: number, h: number, opts: SiteOptions = {}): DistrictSite | null {
  const near = opts.near ?? { x: g.w / 2, y: g.h / 2 };
  const maxRelief = opts.maxRelief ?? 4;
  const margin = opts.margin ?? 2;
  const connect = opts.connect ?? true;
  // A SUM OVER THE MAP of what is in the way: a rectangle's count in four reads.
  const W = g.w + 1;
  const bad = new Int32Array(W * (g.h + 1));
  for (let y = 0; y < g.h; y++) for (let x = 0; x < g.w; x++)
    bad[(y + 1) * W + x + 1] = (badAt(g, x, y, opts.owned) ? 1 : 0) + bad[y * W + x + 1] + bad[(y + 1) * W + x] - bad[y * W + x];
  const badIn = (x0: number, y0: number) => bad[(y0 + h) * W + x0 + w] - bad[y0 * W + x0 + w] - bad[(y0 + h) * W + x0] + bad[y0 * W + x0];
  // HOW THE GROUND CLIMBS across it: its highest and lowest, read every other tile (a district's lots are flattened anyway).
  const relief = (x0: number, y0: number) => {
    let lo = Infinity, hi = -Infinity;
    for (let y = y0; y < y0 + h; y += 2) for (let x = x0; x < x0 + w; x += 2) {
      const z = g.height[idx(g, x, y)];
      if (z < lo) lo = z;
      if (z > hi) hi = z;
    }
    return hi - lo;
  };
  // ROAD ALREADY THERE: only where its own roads run, and each tile of it one less to lay.
  const paved: { x: number; y: number }[] = [];
  for (let y = 0; y < g.h; y++) for (let x = 0; x < g.w; x++) if (g.paved[idx(g, x, y)] !== 0) paved.push({ x, y });
  const roadAt = opts.roadAt ?? (() => false);
  const reused = (x0: number, y0: number): number => {
    let n = 0;
    for (const p of paved) {
      if (p.x < x0 || p.y < y0 || p.x >= x0 + w || p.y >= y0 + h) continue;
      if (!roadAt(p.x - x0, p.y - y0)) return -1;
      n++;
    }
    return n;
  };
  const found: { x0: number; y0: number; score: number }[] = [];
  for (let y0 = margin; y0 + h + margin <= g.h; y0++) for (let x0 = margin; x0 + w + margin <= g.w; x0++) {
    if (badIn(x0, y0)) continue;
    const r = relief(x0, y0);
    if (r > maxRelief) continue;
    const re = reused(x0, y0);
    if (re < 0) continue;
    found.push({ x0, y0, score: Math.hypot(x0 + w / 2 - near.x, y0 + h / 2 - near.y) * FAR + r - re * REUSED });
  }
  if (!found.length) return null;
  found.sort((a, b) => a.score - b.score);
  const anyRoad = g.paved.some((p) => p !== 0);
  if (!connect || !anyRoad) return { x0: found[0].x0, y0: found[0].y0, connector: null };
  // THE NEAREST FEW, joined to the town: the cheapest join wins among them, its length weighed with the rest.
  let best: (DistrictSite & { score: number }) | null = null;
  const tried: typeof found = [];
  for (const f of found) {
    // Not one beside one already tried: a step over is the same site.
    if (tried.some((t) => Math.abs(t.x0 - f.x0) < w / 2 && Math.abs(t.y0 - f.y0) < h / 2)) continue;
    tried.push(f);
    if (tried.length > ROUTED) break;
    const ring: Cell[] = [];
    for (let x = f.x0; x < f.x0 + w; x++) ring.push({ x, y: f.y0 }, { x, y: f.y0 + h - 1 });
    for (let y = f.y0 + 1; y < f.y0 + h - 1; y++) ring.push({ x: f.x0, y }, { x: f.x0 + w - 1, y });
    const inside = (x: number, y: number) => x >= f.x0 && y >= f.y0 && x < f.x0 + w && y < f.y0 + h;
    const path = routeRoad(g, ring, { blocked: inside, maxLength: g.w + g.h });
    if (!path) continue;
    const score = f.score + path.length * 1.5;
    if (!best || score < best.score) best = { x0: f.x0, y0: f.y0, connector: path.length > 1 ? path : null, score };
  }
  return best && { x0: best.x0, y0: best.y0, connector: best.connector };
}
