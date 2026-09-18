/**
 * Rivers and lakes, cut into ground that is already shaped.
 *
 * A RIVER ALWAYS REACHES AN EDGE, and that is a rule about the simulation
 * rather than about scenery. The map's boundary is open by default
 * (@see OPEN_EDGE_DEFAULT), so an edge is the only outlet a map has; a spring
 * feeding a channel that ends inland has nowhere to put its water, and the
 * basin it feeds rises for ever until the whole map is a lake. Cutting to the
 * edge is what makes a fed river a steady state instead of a slow flood.
 *
 * AND IT NEVER CROSSES THE STREET. There is no bridge in the tileset yet, so a
 * river that crossed the road would either dam itself against it or wash over
 * it, and both break the promise that a player can build along the whole
 * street. The head picks the edge on its OWN side of the road and walks
 * straight at it, which makes not crossing structural rather than a check that
 * might miss: a path whose cross coordinate moves one tile towards its edge
 * every step cannot come back round.
 *
 * The bed only ever goes DOWN. The running minimum is what makes the channel a
 * watercourse rather than a trench with puddles in it — water in a bed that
 * rises again is water that stops.
 */
import { edited, idx, inBounds, setSource, type Grid } from "../grid";
import { HEIGHT_MIN } from "../edit/height-tools";
import { valueNoise } from "./noise";
import type { GenParams } from "./params";

/** The fluid index water is stored under. @see FLUIDS */
const WATER = 1;

/**
 * The inflow, laid ACROSS the channel rather than on one cell.
 *
 * A river entering a map is a cross-section, not a point, and the difference is
 * not cosmetic: `Grid.source` is an Int8Array, so one cell can express at most
 * 127 half steps a second however hard you push it, and a single cell at any
 * rate leaves a channel that drains faster than it fills. Measured on a course
 * that had been running dry: one cell at the old rate wet nothing at all; the
 * same rate over the channel's own width took it to 56% of its length with
 * three cells of spill anywhere else on the map.
 */
function feed(g: Grid, p: GenParams, at: number, dist: Int16Array): number {
  const r = Math.max(1, reachAt(p, 0).half + 1);
  const cx = at % g.w, cy = (at / g.w) | 0;
  let n = 0;
  for (let y = Math.ceil(cy - r); y <= cy + r; y++) {
    for (let x = Math.ceil(cx - r); x <= cx + r; x++) {
      if (!free(g, dist, x, y)) continue;
      if (Math.hypot(x - cx, y - cy) > r) continue;
      setSource(g, x, y, SPRING_RATE);
      n++;
    }
  }
  return n;
}

/**
 * How hard a river's head runs, in half steps a second over its tile.
 *
 * ONE, AND IT IS LOW ON PURPOSE. A spring that outruns the channel it feeds
 * does not make a bigger river, it makes a marsh: the flow spills the banks
 * wherever the cut runs through ground that was already low, and spreads. The
 * cost was measured on the seed that shows it worst, over seven simulated
 * minutes, by how many of the map's 4,096 tiles end up under water and whether
 * the volume is still climbing —
 *
 *     rate 6: 922 tiles, still rising by 1,308 a minute
 *     rate 3: 521 tiles, still rising by 336
 *     rate 2: 308 tiles, still rising by 135
 *     rate 1: 111 tiles, settled to within 17
 *
 * — while every other seed tried is stable at any of them. So the rate is set
 * by the worst channel rather than the average one, because the failure is not
 * a wetter map, it is a drowned one that never stops getting wetter.
 */
const SPRING_RATE = 16;

/** No channel here: lower than any ground the map can have. @see standWater */
const DRY_LEVEL = -32768;

/** Tiles of clearance a channel keeps from any paved cell. */
const CLEARANCE = 2;

/**
 * The most bank a valley may flare, in tiles either side.
 *
 * The carve stamps a disc per spine cell, so its cost is the square of this and
 * a hundred-cell river pays it a hundred times. Six is a thirteen-tile valley,
 * which on a 64² map is already a fifth of the way across.
 */
const BANK_MAX = 6;

/**
 * How much of a river a side stream is.
 *
 * Under a half, so a tributary is visibly the smaller of the two where they
 * meet — a confluence of equals reads as a fork, and a fork on a map with one
 * outlet reads as a mistake.
 */
const TRIBUTARY = 0.55;

export type WaterReport = {
  /** Cells a channel or basin was cut into. */
  cut: number;
  /** Cells holding water at the start. */
  wet: number;
  /** Springs placed at river heads. */
  springs: number;
  /** Spine cells walked, across every river and side stream. */
  length: number;
};

const terraceTo = (v: number, step: number) => Math.round(v / step) * step;

/**
 * Run the rivers and sink the lakes. Heights and water are written in place.
 *
 * `dist` is the road's distance field, which is what keeps everything clear of
 * the street — recomputed by the caller if the road has moved since.
 */
export function carveWater(
  g: Grid, p: GenParams, rng: () => number, dist: Int16Array,
): WaterReport {
  const out: WaterReport = { cut: 0, wet: 0, springs: 0, length: 0 };
  // THE LAND AS IT WAS, and every bed is measured against it.
  //
  // A meandering course comes back alongside itself, and a disc stamped at one
  // point overlaps discs stamped forty cells earlier. Reading the LIVE height
  // to decide how deep to cut therefore feeds the cut back into itself: the
  // channel reads ground it has already lowered, takes another river's depth
  // off it, and ratchets. It is not subtle once it starts — a default map came
  // out with a chasm to the floor of the world, height −126, because a
  // hundred-cell river crossed its own valley twenty times at six half steps a
  // crossing. Everything that asks "how high is the ground here" for the
  // purpose of cutting asks this instead.
  const land = g.height.slice();
  /**
   * The level a channel is PRIMED to, per cell, or `DRY` where none.
   *
   * A fed river reaches its own level in about a minute, and a map that opens
   * with an empty trench and fills while you watch is a map that opens wrong.
   * The flood cannot supply this: a course runs onto the map and off it again,
   * so both its ends drain and a basin-filling algorithm correctly reports
   * that nothing stands in it. What stands in it is what the FLOW will hold,
   * and the carve already knows that number — it is the waterline the channel
   * was cut to. @see carveChannel
   */
  const prime = new Int16Array(g.w * g.h).fill(DRY_LEVEL);
  const outlet = outletField(g, dist);
  // Spine cells carved so far, so a side stream can find the river it joins.
  const channel = new Uint8Array(g.w * g.h);

  for (let n = 0; n < p.rivers; n++) {
    // FROM AN EDGE TO AN EDGE, which is what makes it a river rather than a
    // watercourse that starts nowhere. A river is a piece of something larger:
    // it arrives from off the map, crosses it, and leaves. Both ends have to be
    // on the SAME SIDE of the street, because there is no bridge — and the
    // street's clearance splits the map in two, so "the same side" is just the
    // two ends being reachable from one another. @see banks
    const ends = pickCourse(g, rng, dist, outlet);
    if (!ends) continue;
    const [from, to] = ends;
    const path = walk(g, p, rng, from, spread(g, dist, [to]), dist, null);
    if (path.length < 2) continue;
    carveChannel(g, p, land, dist, path, channel, prime, out, 1);
    out.length += path.length;

    // AND IT IS FED, at the edge it comes in by.
    //
    // A river is full because water keeps arriving, not because somebody put
    // some in it. The channel leaves by the far edge, which is open, so the
    // spring has somewhere to send it and the two balance instead of the map
    // slowly drowning — which is exactly what happened when a fed channel
    // stopped inland. @see SPRING_RATE
    if (p.springs > 0) out.springs += feed(g, p, from, dist);

    // SIDE STREAMS, walked towards the river rather than towards the sea — the
    // same walker, a different thing to head for. They are what stops a river
    // looking like one line drawn across a map: a catchment has branches, and
    // the branches are where the ground reads as sloping TOWARDS something.
    for (let t = 0; t < p.tributaries; t++) {
      const join = joinField(g, dist, channel);
      const th = pickHead(g, rng, dist, join);
      if (th < 0 || channel[th]) continue;
      const tp = walk(g, p, rng, th, join, dist, channel);
      // A SIDE STREAM THAT DID NOT REACH ITS RIVER IS NOT A SIDE STREAM. The
      // walk can be boxed in by the street or by ground it has already used,
      // and carving it anyway leaves an orphan watercourse starting nowhere
      // and ending nowhere — which on fifteen seeds left three maps with the
      // water in two or three disconnected pieces. Same rule as the spring:
      // the thing is only real if it got where it was going.
      if (tp.length < 3 || !channel[tp[tp.length - 1]]) continue;
      // Ends where it meets the river, and is never wider than what it joins.
      carveChannel(g, p, land, dist, tp, channel, prime, out, TRIBUTARY);
      out.length += tp.length;
    }
  }

  for (let n = 0; n < p.lakes; n++) sinkLake(g, p, land, rng, dist, out);

  // AND THEN THE WATER, all of it at once, once the ground is finished.
  // @see fillDepressions
  // Nothing asked for, nothing made — the flood is a fact about the whole map
  // and would fill any hollow the noise left, on a map that wanted none.
  out.wet = p.rivers > 0 || p.lakes > 0 ? standWater(g, dist, prime) : 0;
  if (out.cut) edited(g);
  return out;
}

/**
 * Put water in every hollow, to the exact height its lowest rim allows.
 *
 * A MINIMUM DEPTH, because terraced ground is full of one-slab dimples and a
 * map speckled with puddles reads as a bug rather than as weather. Anything
 * shallower than a slab is left dry; what is left is the pools of the rivers,
 * the lakes, and the hollows deep enough to be worth calling one.
 */
function standWater(g: Grid, dist: Int16Array, prime: Int16Array): number {
  const level = fillDepressions(g, dist);
  let wet = 0;
  // THE HIGHER OF THE TWO, then settled. The flood says what a basin holds
  // STANDING; the prime says what a channel holds RUNNING, which the flood
  // cannot see because a course drains at both ends and the standing answer
  // there is correctly nothing. Taking the larger is right and is not yet
  // consistent: the prime is a line the carve drew, and where the cut runs
  // close to the road's clearance or to ground outside it the line can end up
  // a slab or two above a dry cell next door. That is water perched on a bank,
  // and the solver tips it over within a second of the map opening.
  //
  // IT IS NOT SETTLED, and that was the mistake worth recording. Relaxing the
  // level until every cell sits below its lowest way out computes the NO-FLOW
  // equilibrium — which is precisely what the flood already returned, so it
  // drained the channel straight back to 8% and undid the whole point. A
  // flowing surface stands above the static one in places; that is what flow
  // IS. The overshoot is bounded at about a slab and the solver trims it in
  // the first second. @see "the water is never far over its banks"
  for (let i = 0; i < level.length; i++) {
    if (prime[i] > level[i]) level[i] = prime[i];
  }

  for (let i = 0; i < g.pool.length; i++) {
    const deep = level[i] - g.height[i];
    // NOTHING IS CLIPPED HERE. Every rule the water obeys — the street's
    // frontage, the map's open edge, the rim of every basin — is something the
    // flood was told before it ran, so what comes back is already the answer.
    // A cell wiped afterwards is a cell the solver fills a second later.
    if (deep <= 0) { g.pool[i] = 0; continue; }
    g.pool[i] = Math.min(255, deep);
    g.fluid[i] = WATER;
    wet++;
  }
  return wet;
}

/** Whether a cell may be cut: on the map, and well clear of the street. */
const free = (g: Grid, dist: Int16Array, x: number, y: number) =>
  inBounds(g, x, y) && dist[idx(g, x, y)] > CLEARANCE;

/**
 * Tiles to the nearest edge of the map, THROUGH ground a channel may cut.
 *
 * This is what replaced "walk at the nearer edge and hope". The street spans
 * the map and a channel keeps clear of it, so the cells it may cut fall into
 * two regions with no way between them — and a breadth-first search from every
 * edge cell, over those cells only, gives each side its own distance to its own
 * outlets without anyone having to work out which side they are on. Three
 * outlets per side, not one: the edge across the street's line and the two
 * along it.
 *
 * It also makes arrival a PROOF rather than a hope. Any walk that strictly
 * decreases this number reaches nought, and nought is the edge.
 */
function outletField(g: Grid, dist: Int16Array): Int32Array {
  const seeds: number[] = [];
  for (let x = 0; x < g.w; x++) {
    for (const y of [0, g.h - 1]) if (free(g, dist, x, y)) seeds.push(idx(g, x, y));
  }
  for (let y = 0; y < g.h; y++) {
    for (const x of [0, g.w - 1]) if (free(g, dist, x, y)) seeds.push(idx(g, x, y));
  }
  return spread(g, dist, seeds);
}

/** The same, but measured to the nearest cell of a river already carved. */
function joinField(g: Grid, dist: Int16Array, channel: Uint8Array): Int32Array {
  const seeds: number[] = [];
  for (let i = 0; i < channel.length; i++) if (channel[i]) seeds.push(i);
  return spread(g, dist, seeds);
}

/**
 * Multi-source breadth-first distance over cuttable ground.
 *
 * A flat queue rather than `shift()`: a 64² map is four thousand cells and
 * `Array.shift` is linear in what is left, which makes the walk quadratic.
 * Unreachable cells keep `Infinity` so a walker can tell "no way there" from
 * "a long way there" — the difference between a side stream that cannot find
 * its river and one that has far to go.
 */
function spread(g: Grid, dist: Int16Array, seeds: readonly number[]): Int32Array {
  const n = g.w * g.h;
  const out = new Int32Array(n).fill(0x7fffffff);
  const queue = new Int32Array(n);
  let head = 0, tail = 0;
  for (const i of seeds) if (out[i] !== 0) { out[i] = 0; queue[tail++] = i; }

  while (head < tail) {
    const i = queue[head++];
    const x = i % g.w, y = (i / g.w) | 0, d = out[i] + 1;
    for (const [dx, dy] of STEPS) {
      if (!free(g, dist, x + dx, y + dy)) continue;
      const j = idx(g, x + dx, y + dy);
      if (out[j] <= d) continue;
      out[j] = d;
      queue[tail++] = j;
    }
  }
  return out;
}

const STEPS = [[1, 0], [-1, 0], [0, 1], [0, -1]] as const;

/**
 * The two edges a river runs between, high one first.
 *
 * BOTH ON THE SAME SIDE OF THE STREET. The road spans the map and a channel
 * keeps clear of it, so the cells a river may cut fall into two regions with no
 * way between them — and `outlet`, being a breadth-first distance over exactly
 * those cells, already knows which: a boundary cell reachable from another is
 * one on the same side of the road as it. Nothing has to work out where the
 * road is.
 *
 * THE HIGHER END IS THE SOURCE, so the channel runs downhill and the water
 * leaves by the lower one. Sampled rather than swept: the exact highest and
 * lowest edge cells are not the interesting property — a long run with a fall
 * along it is — and a sweep would put every river on a map at the same place.
 */
function pickCourse(
  g: Grid, rng: () => number, dist: Int16Array, outlet: Int32Array,
): [number, number] | null {
  const edge: number[] = [];
  for (let i = 0; i < outlet.length; i++) {
    if (outlet[i] !== 0) continue;                       // not on the boundary
    edge.push(i);
  }
  if (edge.length < 2) return null;

  let best: [number, number] | null = null, bestScore = -Infinity;
  for (let n = 0; n < 200; n++) {
    const a = edge[Math.floor(rng() * edge.length)];
    const b = edge[Math.floor(rng() * edge.length)];
    if (a === b) continue;
    const ax = a % g.w, ay = (a / g.w) | 0, bx = b % g.w, by = (b / g.w) | 0;
    const apart = Math.abs(ax - bx) + Math.abs(ay - by);
    if (apart < (g.w + g.h) / 4) continue;               // not a crossing
    // Reachable from one another, or they are on opposite sides of the road.
    const to = spread(g, dist, [b]);
    if (to[a] === 0x7fffffff) continue;
    // LOW ENDS, and that is a constraint on the whole river rather than on its
    // mouth. The course is held at ONE waterline, so every tile of land above
    // that line has to be cut away — and a crossing that starts high enough
    // turns the map into a quarry: fifteen tiles wide and twenty half steps
    // deep, which is what picking the highest edge for a source produced.
    // Rivers live in the lowest ground there is, and picking the ends that way
    // is what keeps the cut a valley.
    const lie = (g.height[a] + g.height[b]) / 2 - g.minHeight;
    const score = apart - lie * 4;
    if (score <= bestScore) continue;
    bestScore = score;
    best = g.height[a] >= g.height[b] ? [a, b] : [b, a];
  }
  return best;
}

/**
 * Where a side stream starts: high ground, a long way from where it has to end.
 *
 * BOTH HALVES MATTER, and getting the second one wrong is what made the first
 * draft's rivers puddles. Picking purely the highest cell sounds right, but the
 * carve clamps the land into a cone around the street, so the highest ground on
 * any map is as far from the street as it can get — which is hard against an
 * edge. The sources were three tiles from their own outlets, and measured over
 * twenty seeds the whole river came to twenty-five wet cells in a bounding box
 * of four by five. A source has to be high AND inland, so the two are scored
 * together and the run to the sea is what is actually being maximised.
 */
function pickHead(
  g: Grid, rng: () => number, dist: Int16Array, target: Int32Array,
): number {
  // INLAND IS A REQUIREMENT, NOT A PREFERENCE, and that distinction is the
  // whole fix. Scored together, height wins — the cone puts the top of every
  // map hard against an edge — so the requirement comes first and height only
  // chooses between the cells that already have a river's worth of run in
  // them. The fallback exists for small maps and for a side stream whose river
  // is close by, where there may be nothing that far out.
  const want = Math.round((g.w + g.h) / 6);
  return highest(g, rng, dist, target, want) ?? highest(g, rng, dist, target, 4) ?? -1;
}

/** The highest sampled cell at least `want` from `target`, or null. */
function highest(
  g: Grid, rng: () => number, dist: Int16Array, target: Int32Array, want: number,
): number | null {
  let best: number | null = null, bestH = -Infinity;
  for (let n = 0; n < 400; n++) {
    const x = Math.floor(rng() * g.w), y = Math.floor(rng() * g.h);
    if (!free(g, dist, x, y)) continue;
    const i = idx(g, x, y);
    if (target[i] === 0x7fffffff || target[i] < want) continue;
    if (g.height[i] <= bestH) continue;
    bestH = g.height[i];
    best = i;
  }
  return best;
}

/**
 * Walk a watercourse from its head to `target`'s nought, and return the cells.
 *
 * WALKED FIRST AND CARVED AFTERWARDS, which is the change everything else here
 * depends on. A river's depth, its width and the fall of its bed are all
 * functions of HOW FAR ALONG IT YOU ARE — and you cannot know that until you
 * know how long it is. Cutting as it went is why the first draft had one width
 * and one depth from source to sea.
 *
 * TWO PHASES, because following the land and arriving somewhere are different
 * jobs. While there is budget the walk reads the ground: downhill, with enough
 * noise across the slope to meander, which on terraced land is what stops it
 * being a staircase of straight runs. When the budget is gone it makes for the
 * outlet — every step strictly decreasing the distance to it — which is what
 * guarantees the channel gets off the map however much it wandered first.
 */
function walk(
  g: Grid, p: GenParams, rng: () => number,
  head: number, target: Int32Array, dist: Int16Array,
  /** Stop on reaching one of these, for a side stream meeting its river. */
  stopAt: Uint8Array | null,
): number[] {
  const straight = target[head];
  if (straight === 0x7fffffff) return [];
  const budget = Math.round(straight * p.riverLength);
  const cap = budget + straight + 4;                      // outfall is bounded
  const seen = new Uint8Array(g.w * g.h);
  const phase = rng() * 1000;

  const path: number[] = [];
  let cur = head;
  for (let step = 0; step < cap; step++) {
    path.push(cur);
    seen[cur] = 1;
    if (target[cur] === 0) break;
    if (stopAt && path.length > 1 && stopAt[cur]) break;

    const x = cur % g.w, y = (cur / g.w) | 0;
    const forced = step >= budget;
    let next = -1, bestScore = Infinity;
    for (const [dx, dy] of STEPS) {
      if (!free(g, dist, x + dx, y + dy)) continue;
      const j = idx(g, x + dx, y + dy);
      if (seen[j]) continue;
      if (forced && target[j] >= target[cur]) continue;
      // Downhill first; the noise is a sideways nudge of about a slab, which
      // is enough to break the ties that terraced ground is made of without
      // ever sending the river up a hill it could have gone round.
      const wobble = (valueNoise(4, phase + (x + dx) / 7, phase + (y + dy) / 7) - 0.5)
        * 2 * p.riverMeander * 3;
      const pull = forced ? 0 : target[j] * 0.15;
      const score = g.height[j] + wobble + pull;
      if (score < bestScore) { bestScore = score; next = j; }
    }
    // Boxed in during the wandering phase — take the shortest way out instead
    // of stopping, which is the difference between a river and a dead end.
    if (next < 0 && !forced) {
      for (const [dx, dy] of STEPS) {
        if (!free(g, dist, x + dx, y + dy)) continue;
        const j = idx(g, x + dx, y + dy);
        if (target[j] < target[cur] && (next < 0 || target[j] < target[next])) next = j;
      }
    }
    if (next < 0) break;
    cur = next;
  }
  return path;
}

/**
 * How wide and how deep the channel is, a fraction `t` along its course.
 *
 * TAPERED BOTH WAYS, because a river that is the same size from source to sea
 * is a canal. Width runs from one tile at the head to `riverWidth` at the
 * mouth and depth from a third of `riverDepth` to all of it. The square root is
 * what makes it widen quickly at first and then slowly, which is roughly how
 * discharge and width actually relate — linear would make the whole upper half
 * of every river a trickle.
 *
 * `scale` is how much of a river this is: a side stream gets a fraction, so it
 * is never wider than the thing it runs into.
 */
export function reachAt(
  p: GenParams, t: number, scale = 1,
): { half: number; deep: number } {
  return {
    half: (1 + (p.riverWidth - 1) * Math.sqrt(t)) * scale / 2,
    deep: Math.max(2, p.riverDepth * (0.33 + 0.67 * t) * scale),
  };
}

/**
 * Cut the valley, and put the water in it.
 *
 * The size of the channel is a function of how far along you are (@see reachAt),
 * which is why the course is walked before any of it is cut. Its WATERLINE is
 * not: that comes from the land the reach runs through.
 *
 * THE BANKS SLOPE. Every cell within reach of the spine is pulled down towards
 * the bed, by less the further out it is, so the cut is a valley and not a
 * slot. `riverBank` at nought gives the slot, which is what a ditch looks like.
 *
 * Stamped as a DISC per spine cell rather than a cross-section per step: the
 * path turns corners, and a cross-section has to know which way is sideways to
 * do that, while a disc does not and leaves no notch on the inside of a bend.
 */
function carveChannel(
  g: Grid, p: GenParams, land: Int8Array, dist: Int16Array,
  path: readonly number[], channel: Uint8Array, prime: Int16Array,
  out: WaterReport, scale: number,
): void {
  const bank = p.riverBank;

  /**
   * ONE WATERLINE FOR THE WHOLE RIVER, and this is what finally made it look
   * like one.
   *
   * A surface that stepped down along the course needed a weir at every step,
   * and a weir is a wall across the valley: the map came out as a row of
   * separate ponds with dry gravel between them, which is what a staircase of
   * basins is. A river is one body of water. Held at a single level by the one
   * weir at its mouth, the whole course fills — and since that weir sits ON
   * the map's edge, everything above the line goes over it and off the map
   * rather than backing up.
   *
   * The LOWEST the land allows, so the line is under the ground everywhere
   * along the course and the banks are the natural ground. Where the land
   * stands well above it the channel is a gorge; where it barely does, a
   * brimming ditch. Both are rivers.
   */
  const surface = waterline(p, land, path, scale);
  if (scale === 1) { lastPath.length = 0; lastPath.push(...path); lastSurface.length = 0; lastSurface.push(...surface); }
  /** Where the bed steps down, to what, and how wide the cut is there. */
  const lips: [number, number, number, boolean][] = [];

  for (let k = 0; k < path.length; k++) {
    const t = path.length > 1 ? k / (path.length - 1) : 1;
    const { half: halfAt, deep } = reachAt(p, t, scale);
    const i = path[k];
    // THE SILL ONLY EVER GOES DOWN. A watercourse whose bed rises again is a
    // trench with puddles in it: the water stops at the first lip.
    channel[i] = 1;

    // POOLS AND LIPS, which is the whole of how a river holds water.
    //
    // A bed that descends smoothly cannot hold any: the water runs down it and
    // ends up in a heap at the bottom, which is a deep dry trench with a
    // ribbon in it. What holds water is a DEPRESSION, and a depression needs
    // something DOWNSTREAM that is higher than its floor. So the bed is cut a
    // pool deep and a lip is left standing wherever the sill steps down; the
    // reach above each lip is then a basin whose outflow is that lip, and it
    // stands full to within a step of its own sill — bank to bank, rather than
    // a trickle along the bottom.
    //
    // THE LIPS ARE PUT BACK AFTERWARDS, not left in place as we go. The carve
    // stamps a disc per spine cell and the discs overlap, so the pool either
    // side of a lip cuts straight through it — on the first seed that happened
    // to step every few cells it took every lip on the river and the map came
    // out with no standing water at all.
    // THE LIP GOES AT THE SILL ABOVE IT, not the one below. A barrier at the
    // new, lower sill holds nothing — the pool upstream of it stands at the
    // OLD sill, so that is the height the water has to be stopped at. Put at
    // the lower one it is a step the water walks straight down, which is how
    // a river ends up with two inches in the bottom of a gorge.
    const sill = surface[k];
    const bed = terraceTo(sill - deep, p.terrace);

    const half = halfAt;
    // THE VALLEY FLARES WITH ITS OWN DEPTH, which is the difference between a
    // valley and a canyon. A fixed number of bank tiles climbs a fixed amount,
    // so wherever the channel is cut deeper than that the bank runs out before
    // it reaches the land and the cut ends in a sheer face — which is what a
    // quarry looks like. Measured per SLAB of cut instead: each slab of depth
    // buys `riverBank` tiles of bank, so a shallow reach has a lip and a gorge
    // has a proper side to it. Capped, because the disc is stamped per spine
    // cell and its area is the square of this.
    const cut = Math.max(0, land[i] - bed);
    const bankTiles = Math.min(BANK_MAX, bank * cut / p.terrace);
    const reach = half + bankTiles;
    // A WEIR WHERE THE WATERLINE STEPS, holding the reach above it.
    if (k > 0 && surface[k] !== surface[k - 1]) lips.push([i, surface[k - 1], reach, false]);
    const cx = i % g.w, cy = (i / g.w) | 0;

    for (let y = Math.ceil(cy - reach); y <= cy + reach; y++) {
      for (let x = Math.ceil(cx - reach); x <= cx + reach; x++) {
        // CLIPPED TO WHAT MAY BE CUT, and this is not belt and braces. The
        // spine keeps its distance from the street, but the valley stamped
        // around it is wider than the spine — so a course running past the
        // road at the clearance limit took its banks straight through it.
        // Nothing threw: the paving stayed, the ground under it dropped, and
        // the road graph came apart into fifteen pieces, which is a map where
        // almost nothing can be built.
        if (!free(g, dist, x, y)) continue;
        const d = Math.hypot(x - cx, y - cy);
        if (d > reach) continue;
        const j = idx(g, x, y);
        // The bank eases UP from the bed as you go out, so the cut is a valley.
        const grade = bank > 0 ? p.terrace / bank : 99;    // 0 banks: a slot
        const target = terraceTo(bed + Math.max(0, d - half) * grade, p.terrace);
        if (g.height[j] > target) { g.height[j] = Math.max(HEIGHT_MIN, target); out.cut++; }
        // AND THE WATERLINE THIS CELL WILL RUN AT, recorded for the fill.
        //
        // The whole cut, not just the bed: the banks are the sides of the
        // channel and the river fills against them. What is above the line
        // stays dry because the depth comes out negative there, which is the
        // same arithmetic the flood uses and not a second rule.
        // A STEP UNDER THE LINE THE CHANNEL WAS CUT TO. Filled right to it,
        // the prime stood a slab above ground just outside the cut on some
        // courses, and a slab of freeboard costs nothing to look at.
        //
        // ONLY WHERE THERE IS FLOW TO HOLD IT. The prime says what a RUNNING
        // channel carries; with no spring there is nothing to carry it, and
        // priming an unfed course just puts water in a trench for the solver
        // to pour out of both ends. Unfed, the flood's answer is the whole
        // truth and it is exact.
        if (p.springs > 0) {
          const at = sill - p.terrace;
          if (at > prime[j]) prime[j] = at;
        }
      }
    }
  }

  // AND A SILL AT THE MOUTH, which is what makes the whole thing hold.
  //
  // The walk always reaches the map edge, because a river that is fed has to
  // have somewhere to put its water. With no spring that is exactly backwards:
  // an open channel to an open edge drains, completely, and the map opens with
  // a dry trench. Measured on the seed that showed it, the sill never stepped
  // once in eighty-one cells of flat country, so the entire river was a single
  // basin with its plug out.
  //
  // A bar across the mouth closes the last reach, and with a level sill that
  // is the whole river — full from head to mouth, with anything extra spilling
  // over the bar and off the map exactly as it did before.
  //
  // FED OR NOT. The bar sits ON the map's edge, so it is a weir and not a plug:
  // water stands behind it at its own height and everything above that goes
  // over it and off the map. Unfed, that is a full still river; fed, it is a
  // full running one with an outflow. The two used to want opposite things
  // only because the channel ended inland, where a bar really is a plug.
  // BOTH ENDS, and leaving the first one out is why the river ran dry.
  //
  // A course now starts at the map's edge as well as finishing at one, and the
  // edge is OPEN — so the channel's upstream end was a hole in the side of the
  // world with the whole river draining out of it. Measured over twelve seeds,
  // twenty per cent of what had been dug held any water at all and one seed
  // held none: a deep, wide, carefully graded trench with nothing in it.
  //
  // A bar at each end holds the water between them. The one at the mouth is a
  // weir the river pours over and off the map; the one at the source is simply
  // the bank it arrives through, and the spring sits inside it.
  for (const k of [0, path.length - 1]) {
    if (!path.length) break;
    // ONLY WHERE THE COURSE REALLY REACHES THE EDGE. A walk can be boxed in by
    // the street or by ground it has already used and stop inland — and a bar
    // stamped there is an embankment in the middle of the map, which is the
    // one thing the carve is not allowed to build. Measured before this
    // guard: 22 tiles in on a 64 tile map, a third of the way across.
    const cell = path[k];
    const cx = cell % g.w, cy = (cell / g.w) | 0;
    if (cx > 0 && cy > 0 && cx < g.w - 1 && cy < g.h - 1) continue;
    const at = surface[k];
    const t = path.length > 1 ? k / (path.length - 1) : 1;
    const { deep, half } = reachAt(p, t, scale);
    const cut = Math.max(0, land[cell] - (at - deep));
    lips.push([cell, at, half + Math.min(BANK_MAX, bank * cut / p.terrace), true]);
  }

  // THE WEIRS, restored over the channel they belong to.
  //
  // Never above the land that was there: a sill is at most the local ground
  // less a channel's depth, so putting one back cannot raise the map above
  // what the noise made — which is the rule the carve is held to.
  for (const [i, at, reach, edge] of lips) {
    const cx = i % g.w, cy = (i / g.w) | 0;
    // WIDER THAN THE CUT AT THE LIP ITSELF. The reach either side of a weir is
    // cut deeper, so its valley is flared wider — and the water simply walked
    // round the end of the weir through the neighbouring reach's own bank.
    // Widening it costs nothing that matters, because the clamp below never
    // puts ground back above what the land was: this can only undo the carve,
    // never build an embankment.
    const wide = reach + BANK_MAX;
    for (let y = Math.ceil(cy - wide); y <= cy + wide; y++) {
      for (let x = Math.ceil(cx - wide); x <= cx + wide; x++) {
        if (!free(g, dist, x, y)) continue;
        if (Math.hypot(x - cx, y - cy) > wide) continue;
        const j = idx(g, x, y);
        // THE TWO END BARS MAY STAND PROUD OF THE LAND; a weir in the middle
        // of the map may not. Everywhere inland, putting ground back above
        // what the noise made is building an embankment across somebody's
        // valley. At the boundary it is not ground at all — it is where the
        // map stops and the river carries on, and without it the river simply
        // pours out of the side of the world: the ends are the LOWEST cells on
        // the course, because low ends are what keep the cut a valley rather
        // than a quarry, so a bar clamped to the land there can never hold.
        g.height[j] = edge ? Math.max(g.height[j], at) : Math.min(land[j], at);
      }
    }
  }
}

/**
 * The height the water stands at, cell by cell along a course.
 *
 * A FEW LONG REACHES, and the number is the whole design. The two extremes
 * both fail and they fail in opposite directions.
 *
 * Track the land closely and the line steps down every few cells; every step
 * needs a weir, a weir is a wall across the valley, and the map comes out as a
 * row of separate ponds with dry gravel between them. Hold ONE line for the
 * whole river and it is continuous — but every tile of land above that line
 * has to be cut away, and measured over twenty seeds that quarried 1,164 cells
 * of a 4,096-cell map to a depth of thirty-two half steps. A river is not an
 * open-cast mine.
 *
 * So the line only drops when the land has fallen a whole channel's depth
 * below it. That bounds the cut at about that depth — the deepest it can be is
 * the drop it was waiting for — and leaves the reaches as long as the country
 * takes to fall that far, which on gentle ground is most of the river.
 */
function waterline(
  p: GenParams, land: Int8Array, path: readonly number[], scale: number,
): number[] {
  const out: number[] = [];
  let at = Infinity;
  for (let k = 0; k < path.length; k++) {
    const t = path.length > 1 ? k / (path.length - 1) : 1;
    const { deep } = reachAt(p, t, scale);
    const want = terraceTo(land[path[k]] - p.terrace, p.terrace);
    if (want <= at - deep) at = want;
    out.push(at);
  }
  return out;
}

/**
 * Where the water actually stands, once the ground has stopped moving.
 *
 * NOT DECIDED CELL BY CELL WHILE CARVING, which is what this replaced and why
 * every river ran half empty. A channel was filled to a fixed depth over its
 * own bed, so a course that descends — every course — got water at a level
 * that the cell downstream was already below. The solver then did the obvious
 * thing and moved it all to the bottom, leaving a deep dry trench with a
 * ribbon in it, and any attempt to pour in more simply ran over the banks. The
 * level is not a property of a cell; it is a property of the BASIN the cell is
 * in, and nothing local can know it.
 *
 * So it is a priority flood, the standard way to fill depressions. Every
 * boundary cell drains, so the search starts there at its own ground height
 * and always takes the LOWEST frontier cell next: whatever it reaches, it
 * reaches over the lowest rim there is, and the level it arrives with is that
 * rim. A basin comes out filled exactly to its spill point and a slope comes
 * out dry, which is the definition of full without overflowing — and it holds
 * for the lakes and for any hollow the terrain happens to have, not just for
 * what was carved.
 *
 * It is also already at equilibrium, so the solver has nothing to do with it.
 * The old fill left a settling transient of several seconds after every
 * generate, which on a big map is the first thing anybody sees.
 */
export const lastPath: number[] = [];
export const lastSurface: number[] = [];

export function fillDepressions(g: Grid, dist: Int16Array): Int16Array {
  const n = g.w * g.h;
  const level = new Int16Array(n);
  const seen = new Uint8Array(n);
  const heap = new Heap(n);

  for (let x = 0; x < g.w; x++) {
    for (const y of [0, g.h - 1]) seed(g, x, y, level, seen, heap);
  }
  for (let y = 0; y < g.h; y++) {
    for (const x of [0, g.w - 1]) seed(g, x, y, level, seen, heap);
  }
  // AND THE STREET DRAINS, which is how the frontage stays dry HONESTLY.
  //
  // Clipping the answer afterwards — filling everywhere and then wiping the
  // cells near the road — leaves water standing against ground that is lower
  // than its own surface. It looks right for exactly as long as nobody runs
  // the solver, and a second later the map has water on the one strip it
  // promised would never have any. Seeded as an outlet instead, the flood can
  // never raise water above the road corridor beside it, so there is nothing
  // to clip and nothing to spill.
  for (let i = 0; i < level.length; i++) {
    if (dist[i] > CLEARANCE) continue;
    seed(g, i % g.w, (i / g.w) | 0, level, seen, heap);
  }

  while (heap.size) {
    const i = heap.pop();
    const x = i % g.w, y = (i / g.w) | 0;
    for (const [dx, dy] of STEPS) {
      if (!inBounds(g, x + dx, y + dy)) continue;
      const j = idx(g, x + dx, y + dy);
      if (seen[j]) continue;
      seen[j] = 1;
      // OVER THE RIM, or over its own ground if that is higher. This one line
      // is the algorithm: a cell can only be reached across the lowest lip
      // between it and the sea, so that lip is how high the water gets.
      level[j] = Math.max(g.height[j], level[i]);
      heap.push(j, level[j]);
    }
  }
  return level;
}

const seed = (
  g: Grid, x: number, y: number,
  level: Int16Array, seen: Uint8Array, heap: Heap,
) => {
  const i = idx(g, x, y);
  if (seen[i]) return;
  seen[i] = 1;
  level[i] = g.height[i];
  heap.push(i, level[i]);
};

/**
 * A binary heap of cells by water level.
 *
 * Its own, because the flood needs the lowest frontier cell next and sorting
 * an array per pop is quadratic — on a 128² map that is sixteen thousand pops
 * against a frontier that is often hundreds long. Two flat arrays rather than
 * objects: this runs once per generate and allocating sixteen thousand pairs
 * to throw them away is the kind of thing that shows up as a hitch.
 */
class Heap {
  private readonly cell: Int32Array;
  private readonly key: Int32Array;
  size = 0;
  constructor(cap: number) {
    this.cell = new Int32Array(cap);
    this.key = new Int32Array(cap);
  }
  push(cell: number, key: number): void {
    let i = this.size++;
    this.cell[i] = cell;
    this.key[i] = key;
    while (i > 0) {
      const up = (i - 1) >> 1;
      if (this.key[up] <= this.key[i]) break;
      this.swap(up, i);
      i = up;
    }
  }
  pop(): number {
    const top = this.cell[0];
    this.size--;
    if (this.size > 0) {
      this.cell[0] = this.cell[this.size];
      this.key[0] = this.key[this.size];
      let i = 0;
      for (;;) {
        const l = i * 2 + 1, r = l + 1;
        let small = i;
        if (l < this.size && this.key[l] < this.key[small]) small = l;
        if (r < this.size && this.key[r] < this.key[small]) small = r;
        if (small === i) break;
        this.swap(small, i);
        i = small;
      }
    }
    return top;
  }
  private swap(a: number, b: number): void {
    const c = this.cell[a], k = this.key[a];
    this.cell[a] = this.cell[b]; this.key[a] = this.key[b];
    this.cell[b] = c; this.key[b] = k;
  }
}

/**
 * One lake: a bowl sunk into low ground, filled to just under its rim.
 *
 * Under the rim on purpose. A basin filled level with the ground it sits in has
 * no bank, so the first wave of the solver settling puts water on cells that
 * were never cut — and a lake that grew a wet fringe the moment the map opened
 * would look like a bug in the solver rather than a choice here.
 */
function sinkLake(
  g: Grid, p: GenParams, land: Int8Array, rng: () => number,
  dist: Int16Array, out: WaterReport,
): void {
  // Sited on the land as it WAS, or every lake lands in the river: the lowest
  // ground on the map after a river has run is the river's own bed.
  const hollow = lowGround(g, land, rng, dist, p.lakeSize);
  if (!hollow) return;
  const [cx, cy] = hollow;
  const r = Math.max(1, p.lakeSize / 2);
  const rim = g.height[idx(g, cx, cy)];
  const bed = terraceTo(rim - p.riverDepth, p.terrace);
  const phase = rng() * 1000;

  for (let y = Math.ceil(cy - r); y <= cy + r; y++) {
    for (let x = Math.ceil(cx - r); x <= cx + r; x++) {
      if (!free(g, dist, x, y)) continue;
      // A WOBBLY SHORE. A circle reads as a crater; the same slow noise that
      // moves the sand line moves the waterline.
      const wobble = 0.75 + valueNoise(3, phase + x / 5, phase + y / 5) * 0.5;
      const t = Math.hypot(x - cx, y - cy) / (r * wobble);
      if (t > 1) continue;
      const i = idx(g, x, y);
      const target = terraceTo(bed + t * t * p.riverDepth, p.terrace);
      // Ground already lower than the bowl is a channel running through it —
      // left alone, but still UNDER the lake, so it takes the waterline like
      // everything else. Skipping it outright left a dry-looking trench across
      // the middle of a lake.
      if (g.height[i] > target) {
        g.height[i] = Math.max(HEIGHT_MIN, target);
        out.cut++;
      }
      const deep = rim - p.terrace - g.height[i];
      if (deep <= 0) continue;
      if (g.pool[i] === 0) out.wet++;
      g.pool[i] = Math.min(255, deep);
      g.fluid[i] = WATER;
    }
  }
}

/** The lowest cell clear of the street with room for a basin around it. */
function lowGround(
  g: Grid, land: Int8Array, rng: () => number, dist: Int16Array, size: number,
): [number, number] | null {
  const pad = Math.ceil(size / 2) + 1;
  let best: [number, number] | null = null, bestH = Infinity;
  for (let n = 0; n < 200; n++) {
    const x = pad + Math.floor(rng() * Math.max(1, g.w - 2 * pad));
    const y = pad + Math.floor(rng() * Math.max(1, g.h - 2 * pad));
    if (!free(g, dist, x, y)) continue;
    const h = land[idx(g, x, y)];
    if (h >= bestH) continue;
    bestH = h;
    best = [x, y];
  }
  return best;
}
