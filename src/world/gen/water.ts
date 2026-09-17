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
const SPRING_RATE = 1;

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

/** The lowest ground anywhere, in half steps. */
function lowest(land: Int8Array): number {
  let lo = Infinity;
  for (const h of land) if (h < lo) lo = h;
  return lo;
}

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
  const outlet = outletField(g, dist);
  // Spine cells carved so far, so a side stream can find the river it joins.
  const channel = new Uint8Array(g.w * g.h);

  for (let n = 0; n < p.rivers; n++) {
    const head = pickHead(g, rng, dist, outlet);
    if (head < 0) continue;
    const path = walk(g, p, rng, head, outlet, dist, null);
    if (path.length < 2) continue;
    carveChannel(g, p, land, dist, path, channel, out, 1);
    out.length += path.length;

    // A SPRING ONLY WHERE THE CHANNEL GOT OUT. The map's edge is its only
    // outlet, so feeding a channel that stopped short is feeding a bathtub with
    // the plug in — and the map floods, slowly, for as long as it is open. A
    // dry gully is a far better failure than a drowned map.
    const reached = outlet[path[path.length - 1]] === 0;
    if (p.springs > 0 && reached) {
      setSource(g, head % g.w, (head / g.w) | 0, SPRING_RATE);
      out.springs++;
    }

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
      carveChannel(g, p, land, dist, tp, channel, out, TRIBUTARY);
      out.length += tp.length;
    }
  }

  for (let n = 0; n < p.lakes; n++) sinkLake(g, p, land, rng, dist, out);
  if (out.cut) edited(g);
  return out;
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
 * Where a river starts: high ground, a long way from where it has to end.
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
 * How far down a river's bed has fallen, a fraction `t` along its course.
 *
 * CONCAVE, which is the shape every river on earth has and the thing a straight
 * line gets wrong. Most of the drop happens in the first part of the course and
 * the lower reaches are nearly flat — so the headwaters are a steep notch in
 * the hills and the mouth is a wide, slow, shallow thing, instead of one
 * uniform ramp from the top of the map to the bottom.
 */
export const bedGuide = (rise: number, floor: number, t: number): number =>
  rise + (floor - rise) * (1 - (1 - t) ** 2);

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
 * The fall of the bed and the size of the channel are both functions of how far
 * along you are — @see bedGuide and @see reachAt, which is why the course is
 * walked before any of it is cut.
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
  path: readonly number[], channel: Uint8Array, out: WaterReport, scale: number,
): void {
  const floor = lowest(land) - p.riverDepth;
  const rise = land[path[0]];
  const bank = p.riverBank;
  let bed = Infinity;

  for (let k = 0; k < path.length; k++) {
    const t = path.length > 1 ? k / (path.length - 1) : 1;
    const guide = bedGuide(rise, floor, t);
    const { half: halfAt, deep } = reachAt(p, t, scale);
    const i = path[k];
    // THE BED ONLY EVER GOES DOWN. A watercourse whose bed rises again is a
    // trench with puddles in it: the water stops at the first lip.
    bed = Math.min(bed, terraceTo(Math.min(guide, land[i] - deep), p.terrace));
    channel[i] = 1;

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
    const cx = i % g.w, cy = (i / g.w) | 0;
    // Half a step over the bed, so the channel carries water without the first
    // second of a spring going over the banks.
    const level = bed + Math.max(1, Math.round(deep / 2));

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
        // WATER IN THE BED, NOT ON THE BANKS. The bank rises about a slab a
        // tile while the channel carries half its depth, so a bank cell sits
        // below the waterline for the first tile out — which put water a tile
        // wider than the bed on each side and turned every river into a
        // floodplain. A bank is the dry part.
        if (d > half + 0.5) continue;
        // CAPPED AT THE CHANNEL'S OWN DEPTH. A meandering course can come back
        // alongside itself, and where it does, an upstream reach's waterline
        // sits over a downstream reach's much lower bed — which filled the
        // gorge with fifty half steps of standing water on the first seed that
        // did it. A channel holds a channel's depth of water; anything more is
        // a lake, and lakes are sunk deliberately.
        const wet = Math.min(level - g.height[j], Math.round(deep) + p.terrace);
        if (wet <= 0 || g.pool[j] > 0) continue;
        g.pool[j] = Math.min(255, wet);
        g.fluid[j] = WATER;
        out.wet++;
      }
    }
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
