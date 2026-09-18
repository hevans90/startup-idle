/**
 * The channels, and the water in them.
 *
 * THE VALLEY IS ALREADY THERE BY THE TIME ANY OF THIS RUNS. `gen/valley.ts`
 * chooses the courses before the land exists and builds ground that falls
 * from each river's inlet to its mouth, so what is left here is cutting the
 * channel into a floor that already descends — and that is a far smaller job
 * than it used to be. Most of what this file held was scaffolding propping up
 * a river that had no gradient:
 *
 *  - A SINGLE WATERLINE for the whole course, because a surface that stepped
 *    down needed a weir at every step. Gone: the valley floor IS the
 *    waterline, and it descends.
 *  - A WEIR at every step of that line, each one a wall across the valley.
 *    They are what made a river read as a chain of ponds, and measured over
 *    three seeds they put back 100, 10 and 88 half steps of CLIMB into beds
 *    whose whole net fall was 14 to 16.
 *  - A BAR ACROSS EACH END, damming the map's own edge to stop the river
 *    pouring out of the side of the world. A river is supposed to pour out of
 *    the side of the world. That is what the outlet is.
 *
 * WHAT FEEDS IT IS THE EDGE ITSELF, not a spring standing near it. An inflow
 * holds the rim at a level and delivers whatever discharge that level drives,
 * so the river fills and then stops filling; a spring is a rate that has to be
 * guessed against a channel's grade and section, and the guess was wrong on
 * most maps. Half the old spring cells sat ON the boundary too, where the open
 * edge empties the outer ring every substep — a tap there keeps about a sixth
 * of what one three tiles in keeps. @see Grid.inflow
 */
import { edited, idx, inBounds, setInflow, type Grid } from "../grid";
import { HEIGHT_MIN } from "../edit/height-tools";
import { valueNoise } from "./noise";
import type { GenParams } from "./params";
import {
  CLEARANCE, STEPS, UNREACHED, free, spread, walk, type RiverPlan,
} from "./valley";

/** The fluid index water is stored under. @see FLUIDS */
const WATER = 1;

/** No channel here: lower than any ground the map can have. @see standWater */
const DRY_LEVEL = -32768;

/**
 * The most bank a valley may flare, in tiles either side.
 *
 * The carve stamps a disc per spine cell, so its cost is the square of this
 * and a hundred-cell river pays it a hundred times. Six is a thirteen-tile
 * valley, which on a 64² map is already a fifth of the way across.
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
  /** Tiles of the map's rim fed from off the map. */
  springs: number;
  /** Spine cells walked, across every river and side stream. */
  length: number;
};

const terraceTo = (v: number, step: number) => Math.round(v / step) * step;

/**
 * Cut the planned channels, feed them, and put the water in.
 *
 * `dist` is the road's distance field, which is what keeps everything clear of
 * the street. `plan` is where the rivers go and was decided before the land
 * was made — see the note at the top of the file.
 */
export function carveWater(
  g: Grid, p: GenParams, rng: () => number, dist: Int16Array, plan: RiverPlan,
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
   * The level the channel is FULL to, per cell, or dry.
   *
   * The valley floor, which is where a river's surface is: the channel is cut
   * below it and fills back up to it. It is not guesswork about what the flow
   * will hold — the flow is held at this line by the inflow at the head, and
   * anything above it goes over the mouth and off the map.
   */
  const brim = new Int16Array(g.w * g.h).fill(DRY_LEVEL);
  // Spine cells carved so far, so a side stream can find the river it joins.
  const channel = new Uint8Array(g.w * g.h);

  for (const path of plan.paths) {
    carveChannel(g, p, land, dist, path, channel, brim, out, 1);
    out.length += path.length;

    // AND IT IS FED AT THE EDGE IT COMES IN BY, over the boundary rather than
    // out of the ground. @see inflowAt
    if (p.springs > 0) out.springs += inflowAt(g, p, land, path);

    // SIDE STREAMS, walked towards the river rather than towards the sea — the
    // same walker, a different thing to head for. They are what stops a river
    // looking like one line drawn across a map: a catchment has branches, and
    // the branches are where the ground reads as sloping TOWARDS something.
    // These DO read the land, because by now there is a valley to find.
    for (let t = 0; t < p.tributaries; t++) {
      const join = joinField(g, dist, channel);
      const th = pickHead(g, rng, dist, join);
      if (th < 0 || channel[th]) continue;
      const tp = walk(g, p, rng, th, join, dist, channel, land);
      // A SIDE STREAM THAT DID NOT REACH ITS RIVER IS NOT A SIDE STREAM. The
      // walk can be boxed in by the street or by ground it has already used,
      // and carving it anyway leaves an orphan watercourse starting nowhere
      // and ending nowhere.
      if (tp.length < 3 || !channel[tp[tp.length - 1]]) continue;
      carveChannel(g, p, land, dist, tp, channel, brim, out, TRIBUTARY);
      out.length += tp.length;
    }
  }

  for (let n = 0; n < p.lakes; n++) sinkLake(g, p, land, rng, dist, out);

  // AND THEN THE WATER, all of it at once, once the ground is finished.
  // Nothing asked for, nothing made — the flood is a fact about the whole map
  // and would fill any hollow the noise left, on a map that wanted none.
  out.wet = plan.paths.length || p.lakes > 0 ? standWater(g, dist, brim) : 0;
  if (out.cut) edited(g);
  return out;
}

/**
 * Hold the map's edge at the river's own surface, across the whole inlet.
 *
 * A RIVER ENTERING A MAP IS A CROSS-SECTION, not a point, and holding one tile
 * of it at a level while its neighbours are held at nothing is a hole in a
 * wall rather than a river.
 *
 * The level is the brim the channel was cut to, a slab PROUD of it, which is
 * the same choice the `inlet` fixture makes: the head of a river sits a little
 * above the flat it will spread onto, and the surplus has somewhere to go. It
 * cannot flood the map, because a level is a ceiling — once the channel has
 * backed up to the line, nothing more arrives. @see Grid.inflow
 *
 * ONLY WHERE THE COURSE REALLY REACHES THE EDGE. A walk can be boxed in by the
 * street and stop inland, and an inflow stamped there would be water welling
 * out of a hillside.
 */
function inflowAt(
  g: Grid, p: GenParams, land: Int8Array, path: readonly number[],
): number {
  if (!path.length) return 0;
  const at = path[0];
  const cx = at % g.w, cy = (at / g.w) | 0;
  if (cx > 0 && cy > 0 && cx < g.w - 1 && cy < g.h - 1) return 0;
  const r = Math.max(1, reachAt(p, 0).half + 1);
  const surface = terraceTo(land[at], p.terrace) + p.terrace;
  let n = 0;
  for (let y = Math.ceil(cy - r); y <= cy + r; y++) {
    for (let x = Math.ceil(cx - r); x <= cx + r; x++) {
      if (x < 0 || y < 0 || x >= g.w || y >= g.h) continue;
      // The RIM only: an inflow is the world beyond the map arriving, and one
      // tile in there is no world beyond the map to arrive from.
      if (x > 0 && y > 0 && x < g.w - 1 && y < g.h - 1) continue;
      if (Math.hypot(x - cx, y - cy) > r) continue;
      const stage = surface - g.height[idx(g, x, y)];
      if (stage <= 0) continue;
      setInflow(g, x, y, Math.min(127, stage));
      n++;
    }
  }
  return n;
}

/**
 * How wide and how deep the channel is, a fraction `t` along its course.
 *
 * TAPERED, BUT NOT FROM NOTHING. It used to run from one tile at the head to
 * `riverWidth` at the mouth, because the head was a spring in the hills and a
 * spring starts as a trickle. A river that arrives over the map's edge does
 * not: it is already a river somewhere off the map, and the only reason it
 * grows on the way across is the side streams joining it. So it enters at
 * sixty per cent of full size and reaches full at the mouth.
 *
 * `scale` is how much of a river this is: a side stream gets a fraction, so it
 * is never wider than the thing it runs into.
 */
export function reachAt(
  p: GenParams, t: number, scale = 1,
): { half: number; deep: number } {
  return {
    half: p.riverWidth * (0.6 + 0.4 * Math.sqrt(t)) * scale / 2,
    deep: Math.max(2, p.riverDepth * (0.6 + 0.4 * t) * scale),
  };
}

/**
 * Cut the channel into the valley floor, and record what it fills to.
 *
 * THE BED IS THE FLOOR LESS THE CHANNEL'S DEPTH, and that is the whole rule
 * now. There is no running minimum and no sill that only goes down, because
 * the floor it is measured against already descends — `valleyGround` saw to
 * that before any of this ran. A bed cut a fixed depth below a descending
 * floor descends by construction, which is the property the old version spent
 * three mechanisms failing to enforce.
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
  path: readonly number[], channel: Uint8Array, brim: Int16Array,
  out: WaterReport, scale: number,
): void {
  const bank = p.riverBank;
  /** Whether anything will keep this channel full once the map is open. */
  const fed = p.springs > 0;
  if (scale === 1) { lastPath.length = 0; lastPath.push(...path); }
  /**
   * THE FLOOR ONLY EVER GOES DOWN, as a running minimum along the course.
   *
   * The valley was BUILT to descend and does: measured on the seed that shows
   * it worst, the planned floor climbs by exactly nothing over 235 cells. What
   * puts the climb back is the STREET — the land is clamped into a cone around
   * it that rises a slab a tile, and where a river passes close the cone lifts
   * its floor towards the road's level. On that same seed it lifted 115 of the
   * 235 spine cells, by as much as 20.9 half steps, and 50 half steps of climb
   * came back into a bed that had none.
   *
   * So this is a repair of a conflict between two carves, not the mechanism
   * that makes the river descend — which is the difference from the version
   * this replaced, where a running minimum was the ONLY thing pushing the bed
   * downhill and had to quarry a valley out of raw noise to do it. Here the
   * floor is already right nearly everywhere and this bites in the few places
   * the street disagrees. It can only ever LOWER ground, and it is clipped to
   * what may be cut, so the road and its frontage are untouched.
   */
  let floor = Infinity;

  for (let k = 0; k < path.length; k++) {
    const t = path.length > 1 ? k / (path.length - 1) : 1;
    const { half, deep } = reachAt(p, t, scale);
    const i = path[k];
    channel[i] = 1;

    floor = Math.min(floor, terraceTo(land[i], p.terrace));
    const bed = terraceTo(floor - deep, p.terrace);
    // THE VALLEY FLARES WITH ITS OWN DEPTH, which is the difference between a
    // valley and a canyon. A fixed number of bank tiles climbs a fixed amount,
    // so wherever the channel is cut deeper than that the bank runs out before
    // it reaches the land and the cut ends in a sheer face. Measured per SLAB
    // of cut instead: each slab of depth buys `riverBank` tiles of bank.
    const cut = Math.max(0, land[i] - bed);
    const reach = half + Math.min(BANK_MAX, bank * cut / p.terrace);
    const cx = i % g.w, cy = (i / g.w) | 0;

    for (let y = Math.ceil(cy - reach); y <= cy + reach; y++) {
      for (let x = Math.ceil(cx - reach); x <= cx + reach; x++) {
        // CLIPPED TO WHAT MAY BE CUT, and this is not belt and braces. The
        // spine keeps its distance from the street, but the valley stamped
        // around it is wider than the spine — so a course running past the
        // road at the clearance limit took its banks straight through it.
        // Nothing threw: the paving stayed, the ground under it dropped, and
        // the road graph came apart into fifteen pieces.
        if (!free(g, dist, x, y)) continue;
        const d = Math.hypot(x - cx, y - cy);
        if (d > reach) continue;
        const j = idx(g, x, y);
        // The bank eases UP from the bed as you go out, so the cut is a valley.
        const grade = bank > 0 ? p.terrace / bank : 99;    // 0 banks: a slot
        const target = terraceTo(bed + Math.max(0, d - half) * grade, p.terrace);
        if (g.height[j] > target) { g.height[j] = Math.max(HEIGHT_MIN, target); out.cut++; }
        // AND THE LEVEL THIS CELL FILLS TO. The whole cut, not just the bed:
        // the banks are the sides of the channel and the river fills against
        // them. What is above the line stays dry because the depth comes out
        // negative there, which is the same arithmetic the flood uses and not
        // a second rule.
        //
        // THE LOWEST OF THE DISCS THAT REACH IT, not the highest. A meander
        // comes back alongside itself and one cell can lie under two reaches
        // hundreds of steps apart on the course; water there stands at the
        // level of the LOWER one, because that is where it would run to.
        // Taking the higher stood the river twelve half steps over its own
        // bank wherever a loop passed close to its own tail.
        //
        // ONLY WHERE THERE IS FLOW TO HOLD IT. The brim says what a RUNNING
        // channel carries; unfed there is nothing to carry it, and filling an
        // open trench just puts water in it for the solver to pour out of
        // both ends — measured with the feed off, it left water standing ten
        // half steps over its own bank. Unfed, the flood's answer is the
        // whole truth and it is exact.
        if (p.springs > 0) {
          //
        // ONLY WHERE THERE IS FLOW TO HOLD IT, which is why this asks. The
        // brim is what a RUNNING channel carries, and the inflow at the head
        // is what holds it there; with the feed off there is nothing to hold
        // anything and a course open at both ends drains, so filling it just
        // puts water in a trench for the solver to pour out of. Measured
        // unfed, it left water standing ten half steps over its own bank.
        // Unfed, the flood's answer is the whole truth and it is exact.
        if (fed) {
          brim[j] = brim[j] === DRY_LEVEL ? floor : Math.min(brim[j], floor);
        }
        }
      }
    }
  }
}

/**
 * The cells a side stream may aim at: the river it is going to join.
 */
function joinField(g: Grid, dist: Int16Array, channel: Uint8Array): Int32Array {
  const seeds: number[] = [];
  for (let i = 0; i < channel.length; i++) if (channel[i]) seeds.push(i);
  return spread(g, dist, seeds);
}

/**
 * Where a side stream starts: high ground, a long way from where it has to end.
 *
 * BOTH HALVES MATTER. Picking purely the highest cell sounds right, but the
 * carve clamps the land into a cone around the street, so the highest ground
 * on any map is as far from the street as it can get — which is hard against
 * an edge. The sources came out three tiles from their own outlets. A source
 * has to be high AND inland, so the run to the river is what is maximised.
 */
function pickHead(
  g: Grid, rng: () => number, dist: Int16Array, target: Int32Array,
): number {
  // INLAND IS A REQUIREMENT, NOT A PREFERENCE. Scored together, height wins —
  // the cone puts the top of every map hard against an edge — so the
  // requirement comes first and height only chooses between the cells that
  // already have a stream's worth of run in them. The fallback is for small
  // maps and for a side stream whose river is close by.
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
    if (target[i] === UNREACHED || target[i] < want) continue;
    if (g.height[i] <= bestH) continue;
    bestH = g.height[i];
    best = i;
  }
  return best;
}

/**
 * Put water in every hollow, to the exact height its lowest rim allows, and
 * fill every channel to its brim.
 *
 * A MINIMUM DEPTH, because terraced ground is full of one-slab dimples and a
 * map speckled with puddles reads as a bug rather than as weather.
 */
function standWater(g: Grid, dist: Int16Array, brim: Int16Array): number {
  const level = fillDepressions(g, dist);
  let wet = 0;
  // THE HIGHER OF THE TWO. The flood says what a basin holds STANDING; the
  // brim says what a CHANNEL holds, which the flood cannot see, because a
  // course runs onto the map and off it again and the standing answer in a
  // trench open at both ends is correctly nothing. What is in it is what the
  // flow holds, and the inflow at its head is what holds it there.
  for (let i = 0; i < level.length; i++) {
    if (brim[i] > level[i]) level[i] = brim[i];
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

/** The last river's spine, for the debug overlay. */
export const lastPath: number[] = [];

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
