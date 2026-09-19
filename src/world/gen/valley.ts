/**
 * Where the rivers go, and the shape of the ground that makes them go there.
 *
 * THE COURSE IS DRAWN BEFORE THERE IS ANY LAND, and that inversion is the
 * whole module. The generator used to shape the country out of noise and then
 * cut a channel through whatever it had made, which is the wrong way round and
 * measurably so: over eight seeds the finished bed CLIMBED 38 half steps along
 * its own course against a net fall of 15, and on the worst of them 100
 * against 14. A bed that goes back uphill is not a river, it is a row of
 * basins, and no amount of water makes it flow.
 *
 * It could not have come out otherwise. `relief` is 16 half steps and the
 * river's entire fall was 14, so the noise was bigger than the gradient it was
 * being asked to run down. Nothing in the pipeline ever made the bed DESCEND;
 * it inherited whatever the noise happened to do between two edges.
 *
 * So the river is decided first, geometrically, and the land is built around
 * it: a floor that falls from the inlet to the mouth, ground that climbs away
 * from the spine, and the noise laid on top as detail that fades out as it
 * nears the water. The valley is then a fact about the terrain rather than a
 * trench dug through it, and the bed descends because it was never allowed to
 * do anything else.
 *
 * @see planRivers for the course, {@link valleyGround} for the ground.
 */
import { idx, inBounds, type Grid } from "../grid";
import { valueNoise } from "./noise";
import type { GenParams } from "./params";

/**
 * Tiles of clearance a LAKE keeps from any paved cell.
 *
 * Rivers no longer keep any. A river that meets the street is carried under a
 * bridge — see {@link import("./water").carveChannel} — and that is a
 * crossing, which is a thing a map is allowed to have. A lake is not: it has
 * no span over it and nothing to gain from drowning somebody's frontage.
 */
export const CLEARANCE = 2;

export const STEPS = [[1, 0], [-1, 0], [0, 1], [0, -1]] as const;

/**
 * Whether a cell may be cut: on the map, and that is now the whole rule.
 *
 * IT USED TO MEAN "CLEAR OF THE STREET", and that one condition shaped every
 * map this generator has ever made. With one surface per cell a river meeting
 * a road is a choice between damming the river and washing out the road, so
 * the river was simply forbidden to go near one — and the consequence was not
 * a detail. The road spans the map and the corridor round it is uncuttable,
 * so the cells a river may use fall into two regions with no way between
 * them: every course had to begin and end on ONE side of the street, and
 * river and road ran roughly parallel on every seed because that is the only
 * shape left.
 *
 * A deck is the third answer. @see Grid.deck, clearOfRoad
 */
export const free = (g: Grid, x: number, y: number) => inBounds(g, x, y);

/** Whether a cell is clear of the street, for the things that must be. */
export const clearOfRoad = (g: Grid, dist: Int16Array, x: number, y: number) =>
  inBounds(g, x, y) && dist[idx(g, x, y)] > CLEARANCE;

/** No way there, as far as {@link spread} is concerned. */
export const UNREACHED = 0x7fffffff;

export type RiverPlan = {
  /** Each river's spine, inlet first and mouth last. Both ends are on an edge. */
  paths: number[][];
  /** Tiles to the nearest spine cell, over the WHOLE map. */
  near: Float32Array;
  /** How far down its river that nearest cell is: 0 at an inlet, 1 at a mouth. */
  along: Float32Array;
};

/**
 * Pick the courses, before the land exists.
 *
 * Every river runs from one edge of the map to another, and both ends are on
 * the SAME SIDE of the street, because there is no bridge. That is structural
 * rather than checked: `outletField` is a breadth-first distance over the
 * cells a channel may cut, so two boundary cells that can reach one another
 * are two cells on one side of the road, and nothing has to work out where the
 * road is.
 */
export function planRivers(g: Grid, p: GenParams, rng: () => number): RiverPlan {
  const paths: number[][] = [];
  if (p.rivers > 0) {
    const outlet = outletField(g);
    for (let n = 0; n < p.rivers; n++) {
      // A COURSE THAT STOPS INLAND IS NOT A RIVER, so one is tried again
      // rather than kept. The walk is bounded by the street and by ground it
      // has already used and can be boxed in — measured before this, a fifth
      // of seeds ended twenty-six tiles short of the edge, which leaves a
      // channel with no outlet: the map's only way out is its boundary, so a
      // river that never reaches one has nowhere to put what is fed into it.
      let path: number[] = [];
      for (let tries = 0; tries < 6 && !path.length; tries++) {
        const ends = pickCrossing(g, rng, outlet);
        if (!ends) break;
        const got = walk(g, p, rng, ends[0], spread(g, [ends[1]]), null, null);
        if (got.length >= 2 && onRim(g, got[got.length - 1])) path = got;
      }
      if (path.length) paths.push(path);
    }
  }
  const { near, along } = valleyField(g, paths);
  return { paths, near, along };
}

/** Tiles from a cell to the nearest edge of the map. */
export const rimOf = (g: Grid, i: number) => {
  const x = i % g.w, y = (i / g.w) | 0;
  return Math.min(x, y, g.w - 1 - x, g.h - 1 - y);
};

/**
 * How far a wandering course tries to stay from the map's edge.
 *
 * Three, which is one more than the valley's own half-width at its narrowest:
 * a channel whose bank reaches the rim still spills over it. @see walk
 */
const RIM_KEEP = 3;

/** Whether a cell is on the map's outermost ring. */
export const onRim = (g: Grid, i: number) => {
  const x = i % g.w, y = (i / g.w) | 0;
  return x === 0 || y === 0 || x === g.w - 1 || y === g.h - 1;
};

/**
 * Two boundary cells a long way apart, with a way between them.
 *
 * NOT THE LOWEST ONES, which is what this used to pick and could not help
 * picking: there was already a landscape by the time the course was chosen, so
 * a crossing that started high meant quarrying the whole course down to one
 * waterline, and picking low ends was the only defence. Choosing first, there
 * is nothing to defend against — the ends are low because the valley is built
 * to make them low.
 *
 * SAMPLED, and one taken at random from those long enough, rather than the
 * longest. The exact longest crossing on a square map is corner to corner, so
 * maximising it puts the river in the same place on every seed.
 */
function pickCrossing(
  g: Grid, rng: () => number, outlet: Int32Array,
): [number, number] | null {
  const edge: number[] = [];
  for (let i = 0; i < outlet.length; i++) if (outlet[i] === 0) edge.push(i);
  if (edge.length < 2) return null;

  const long = (g.w + g.h) / 2, short = (g.w + g.h) / 4;
  // AND IT HAS TO CROSS THE MAP, not run round the outside of it.
  //
  // Two edge cells a long way apart can both be near one corner — (1,63) and
  // (0,0) are sixty-four apart on a 64² map and the line between them is the
  // left-hand edge. A course laid along that line is a course laid ON the
  // absorbing boundary, leaking off the side of the world down its whole
  // length, and it showed: that seed's river held 19% of its channel where
  // one crossing the middle held all of it. So the midpoint of the chord has
  // to be properly inland. @see rimOf
  const inland = Math.min(g.w, g.h) / 5;
  const found: [number, number][] = [];
  let fallback: [number, number] | null = null;
  for (let n = 0; n < 240; n++) {
    const a = edge[Math.floor(rng() * edge.length)];
    const b = edge[Math.floor(rng() * edge.length)];
    if (a === b) continue;
    const apart = Math.abs((a % g.w) - (b % g.w)) + Math.abs(((a / g.w) | 0) - ((b / g.w) | 0));
    if (apart < short) continue;
    const mx = ((a % g.w) + (b % g.w)) / 2, my = (((a / g.w) | 0) + ((b / g.w) | 0)) / 2;
    if (Math.min(mx, my, g.w - 1 - mx, g.h - 1 - my) < inland) continue;
    if (spread(g, [b])[a] === UNREACHED) continue;         // no way between
    if (apart >= long) found.push([a, b]);
    else fallback = fallback ?? [a, b];
  }
  if (found.length) return found[Math.floor(rng() * found.length)];
  return fallback;
}

/**
 * Tiles to the nearest edge of the map, THROUGH ground a channel may cut.
 *
 * The street spans the map and a channel keeps clear of it, so the cells it
 * may cut fall into two regions with no way between them — and a search from
 * every edge cell over those cells only gives each side its own distance to
 * its own outlets without anyone working out which side they are on. It also
 * makes arrival a PROOF: any walk that strictly decreases this reaches nought,
 * and nought is the edge.
 */
export function outletField(g: Grid): Int32Array {
  const seeds: number[] = [];
  for (let x = 0; x < g.w; x++) {
    for (const y of [0, g.h - 1]) seeds.push(idx(g, x, y));
  }
  for (let y = 0; y < g.h; y++) {
    for (const x of [0, g.w - 1]) seeds.push(idx(g, x, y));
  }
  return spread(g, seeds);
}

/**
 * Multi-source breadth-first distance over cuttable ground.
 *
 * A flat queue rather than `shift()`: a 64² map is four thousand cells and
 * `Array.shift` is linear in what is left, which makes the walk quadratic.
 * Unreachable cells keep {@link UNREACHED}, so a walker can tell "no way
 * there" from "a long way there".
 */
export function spread(g: Grid, seeds: readonly number[]): Int32Array {
  const n = g.w * g.h;
  const out = new Int32Array(n).fill(UNREACHED);
  const queue = new Int32Array(n);
  let head = 0, tail = 0;
  for (const i of seeds) if (out[i] !== 0) { out[i] = 0; queue[tail++] = i; }

  while (head < tail) {
    const i = queue[head++];
    const x = i % g.w, y = (i / g.w) | 0, d = out[i] + 1;
    for (const [dx, dy] of STEPS) {
      if (!free(g, x + dx, y + dy)) continue;
      const j = idx(g, x + dx, y + dy);
      if (out[j] <= d) continue;
      out[j] = d;
      queue[tail++] = j;
    }
  }
  return out;
}

/**
 * Walk a watercourse from its head to `target`'s nought, and return the cells.
 *
 * WALKED FIRST AND CARVED AFTERWARDS. A river's depth, its width and the fall
 * of its bed are all functions of how far along it you are, and you cannot
 * know that until you know how long it is.
 *
 * TWO PHASES, because following the land and arriving somewhere are different
 * jobs. While there is budget it wanders; when the budget is gone every step
 * strictly decreases the distance to the outlet, which is what guarantees the
 * channel gets off the map however much it strayed first.
 *
 * `lie` is the ground to read, or NULL for a walk over country that does not
 * exist yet — which is how a river's own course is chosen. Flat, the score is
 * the noise and the pull alone, so the line meanders on its own terms and the
 * land is then built to suit it. A side stream passes the real heights,
 * because by then there is a valley for it to find.
 */
export function walk(
  g: Grid, p: GenParams, rng: () => number,
  head: number, target: Int32Array,
  /** Stop on reaching one of these, for a side stream meeting its river. */
  stopAt: Uint8Array | null,
  lie: Int8Array | null,
): number[] {
  const straight = target[head];
  if (straight === UNREACHED) return [];
  const budget = Math.round(straight * p.riverLength);
  const cap = budget + straight + 4;                      // outfall is bounded
  const seen = new Uint8Array(g.w * g.h);
  const phase = rng() * 1000;

  const path: number[] = [];
  let cur = head;
  /** Wandered into a pocket: stop wandering and make for the outlet. */
  let stuck = false;
  for (let step = 0; step < cap; step++) {
    path.push(cur);
    seen[cur] = 1;
    if (target[cur] === 0) break;
    if (stopAt && path.length > 1 && stopAt[cur]) break;

    const x = cur % g.w, y = (cur / g.w) | 0;
    const forced = stuck || step >= budget;
    let next = -1, bestScore = Infinity;
    for (const [dx, dy] of STEPS) {
      if (!free(g, x + dx, y + dy)) continue;
      const j = idx(g, x + dx, y + dy);
      if (seen[j]) continue;
      if (forced && target[j] >= target[cur]) continue;
      const wobble = (valueNoise(4, phase + (x + dx) / 7, phase + (y + dy) / 7) - 0.5)
        * 2 * p.riverMeander * 3;
      const pull = forced ? 0 : target[j] * 0.15;
      // AND IT KEEPS OFF THE RIM until it is time to leave by it. The map's
      // edge is where water goes to disappear, so a reach laid along one is a
      // reach draining sideways off the world for its whole length. Only
      // while wandering: the run-in to the outlet has to be allowed to arrive.
      const hug = forced ? 0 : Math.max(0, RIM_KEEP - rimOf(g, j)) * 3;
      const score = (lie ? lie[j] : 0) + wobble + pull + hug;
      if (score < bestScore) { bestScore = score; next = j; }
    }
    // Boxed in during the wandering phase — take the shortest way out instead
    // of stopping, which is the difference between a river and a dead end.
    //
    // STILL NOT ONTO GROUND IT HAS ALREADY USED. This escape hatch did not
    // check, and a course that doubled back put the same cell in its path
    // twice: the second visit overwrites the first's position ALONG the
    // river, so the valley floor — which is a function of exactly that —
    // jumped back uphill by seven half steps in the middle of the course. A
    // path has to be a path. Boxed in with nowhere new to go it now stops,
    // and the planner tries another crossing. @see planRivers
    if (next < 0) {
      // ANY WAY OUT THAT IS NOT BACKWARDS, nearest the outlet first — and
      // then no more wandering, because a walk that has just been cornered
      // will be cornered again. Stopping here instead is what made a LONGER
      // wander budget produce a SHORTER river: the bigger the budget the
      // more ground a course covers, the more often it painted itself into a
      // pocket, and the planner threw the whole course away and tried
      // another. Asking for six got 513 cells where asking for one got 799.
      for (const [dx, dy] of STEPS) {
        if (!free(g, x + dx, y + dy)) continue;
        const j = idx(g, x + dx, y + dy);
        if (seen[j]) continue;
        if (next < 0 || target[j] < target[next]) next = j;
      }
      stuck = true;
    }
    if (next < 0) break;
    cur = next;
  }
  return path;
}

/**
 * How far every cell is from the nearest river, and where on it.
 *
 * A CHAMFER, not a breadth-first walk. Distance over four neighbours is the
 * Manhattan one, whose contours are diamonds, and a valley built on it comes
 * out with visible corners running down both sides of every river. Three for a
 * step and four for a diagonal, divided by three, is within about two per cent
 * of the straight-line distance and costs two passes over the map.
 *
 * The nearest spine cell's position ALONG its river rides along with the
 * distance, which is what lets the ground know which way is downstream without
 * a second search.
 */
function valleyField(g: Grid, paths: readonly (readonly number[])[]) {
  const n = g.w * g.h;
  const far = 1 << 28;
  const d = new Int32Array(n).fill(far);
  const along = new Float32Array(n);
  for (const path of paths) {
    for (let k = 0; k < path.length; k++) {
      d[path[k]] = 0;
      along[path[k]] = path.length > 1 ? k / (path.length - 1) : 0;
    }
  }
  const put = (i: number, j: number, w: number) => {
    const v = d[j] + w;
    if (v < d[i]) { d[i] = v; along[i] = along[j]; }
  };
  for (let y = 0; y < g.h; y++) {
    for (let x = 0; x < g.w; x++) {
      const i = y * g.w + x;
      if (y > 0) {
        put(i, i - g.w, 3);
        if (x > 0) put(i, i - g.w - 1, 4);
        if (x < g.w - 1) put(i, i - g.w + 1, 4);
      }
      if (x > 0) put(i, i - 1, 3);
    }
  }
  for (let y = g.h - 1; y >= 0; y--) {
    for (let x = g.w - 1; x >= 0; x--) {
      const i = y * g.w + x;
      if (y < g.h - 1) {
        put(i, i + g.w, 3);
        if (x < g.w - 1) put(i, i + g.w + 1, 4);
        if (x > 0) put(i, i + g.w - 1, 4);
      }
      if (x < g.w - 1) put(i, i + 1, 3);
    }
  }
  const near = new Float32Array(n);
  for (let i = 0; i < n; i++) near[i] = d[i] / 3;
  return { near, along };
}

/**
 * How steeply a valley side may climb, in half steps a tile.
 *
 * Two, which is one slab — the same grade the street's own cone is held to,
 * and the one the tileset's cliff art is drawn for. Steeper than this stops
 * reading as ground and starts reading as excavation.
 */
const SIDE_GRADE = 2;

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const smoothstep = (v: number) => v * v * (3 - 2 * v);

/**
 * The ground the rivers imply: a valley floor, and how much noise may sit on it.
 *
 * `base` is the shape and `blend` is how much of the fbm to let through, and
 * the second is as load-bearing as the first. Noise at full strength in the
 * channel is noise bigger than the river's whole fall, which is the fault this
 * module exists to fix; faded out as the ground nears the water, the valley
 * floor is clean and the uplands are as rough as they ever were.
 *
 * MEASURED FROM THE PLAIN, which sits at nought. Everything here is negative:
 * the valley is cut into the country rather than the country piled around it,
 * so a map with no rivers on it is the same map it always was.
 *
 * THE FALL IS IN THE VALLEY, and the SIDE IS A GRADE rather than a width.
 * Both of those were got wrong once each, in opposite directions.
 *
 * A fixed number of tiles of side is what made the first version look like a
 * quarry: the floor sinks `riverFall` further as it goes, so by the mouth it
 * was thirty two half steps down with five tiles to climb back out — six
 * half steps a tile, which is a cliff face and not a valley. The side is now
 * as many tiles as it needs to rise at {@link SIDE_GRADE}, so it looks the
 * same everywhere and the valley BROADENS downstream, which is what valleys
 * do.
 *
 * Tilting the whole map instead, so the valley could keep one depth, is the
 * other thing tried and it is worse: {@link RiverPlan.along} is the nearest
 * SPINE CELL's position, which is a sensible number near the water and a
 * patchwork far from it — it jumps across the middle between two loops of a
 * meander. As a tilt that is not a plane, it is a set of terraces facing
 * different ways, and it took the map from 51% level ground to 41%.
 */
export function valleyGround(g: Grid, p: GenParams, plan: RiverPlan) {
  const n = g.w * g.h;
  const base = new Float32Array(n);
  const blend = new Float32Array(n);
  if (!plan.paths.length) { blend.fill(1); return { base, blend }; }

  // A FLOODPLAIN before the sides start to climb, as wide as the channel is.
  // Without one the valley is a V with the river in the crease, and a V has
  // nowhere for a river to be anything but full or empty.
  const flat = Math.max(1, p.riverWidth);
  const wide = Math.max(flat + 1, p.valleyWidth);
  for (let i = 0; i < n; i++) {
    const t = plan.along[i];
    // AND IT BROADENS A LITTLE AS IT GOES, which is what a valley does. The
    // cost of a valley is its FOOTPRINT — measured across a grid of widths
    // and depths, three tiles wide to fourteen takes the map from 53% level
    // to 41%, while flat to twelve half steps deep costs one point. Shape is
    // nearly free and area is not, so the valley is narrow where the river
    // arrives and full width where it leaves.
    const deep = p.valleyDepth + p.riverFall * t;
    // AS WIDE AS IT IS DEEP, at a grade the art is drawn for. `valleyWidth`
    // is the floor of it — the least side a shallow reach gets — and a deep
    // one gets whatever climbing out of it takes.
    const wideAt = flat + Math.max(wide - flat, deep / SIDE_GRADE);
    const u = smoothstep(clamp01((plan.near[i] - flat) / (wideAt - flat)));
    base[i] = -deep * (1 - u);
    blend[i] = u;
  }
  return { base, blend };
}
