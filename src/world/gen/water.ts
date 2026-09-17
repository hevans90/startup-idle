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

export type WaterReport = {
  /** Cells a channel or basin was cut into. */
  cut: number;
  /** Cells holding water at the start. */
  wet: number;
  /** Springs placed at river heads. */
  springs: number;
};

const terraceTo = (v: number, step: number) => Math.round(v / step) * step;

/** The lowest ground anywhere on the map, in half steps. */
function lowest(g: Grid): number {
  let lo = Infinity;
  for (const h of g.height) if (h < lo) lo = h;
  return lo;
}

/**
 * Run the rivers and sink the lakes. Heights and water are written in place.
 *
 * `dist` is the road's distance field, which is what keeps everything clear of
 * the street — recomputed by the caller if the road has moved since.
 */
export function carveWater(
  g: Grid, p: GenParams, rng: () => number, dist: Int16Array, axis: "x" | "y",
): WaterReport {
  const out: WaterReport = { cut: 0, wet: 0, springs: 0 };
  for (let n = 0; n < p.rivers; n++) runRiver(g, p, rng, dist, axis, out);
  for (let n = 0; n < p.lakes; n++) sinkLake(g, p, rng, dist, out);
  if (out.cut) edited(g);
  return out;
}

/** Whether a cell may be cut: on the map, and well clear of the street. */
const free = (g: Grid, dist: Int16Array, x: number, y: number) =>
  inBounds(g, x, y) && dist[idx(g, x, y)] > CLEARANCE;

/**
 * One river, from a head on high ground to the map edge beside it.
 *
 * The walk moves one tile towards its target edge every step and chooses how
 * far to slide ALONG the other axis by what the ground is doing — so it
 * meanders where the land lets it and still arrives in a bounded number of
 * steps. A river that picked its next cell purely by height would sit in the
 * first hollow it found.
 */
function runRiver(
  g: Grid, p: GenParams, rng: () => number, dist: Int16Array,
  axis: "x" | "y", out: WaterReport,
): void {
  // The river's cross axis is the one the ROAD wanders across, because that is
  // the one with an edge on each side of the street.
  const crossW = axis === "x" ? g.h : g.w;
  const longW = axis === "x" ? g.w : g.h;
  const cellAt = (l: number, c: number) => (axis === "x" ? idx(g, l, c) : idx(g, c, l));
  const okAt = (l: number, c: number) =>
    axis === "x" ? free(g, dist, l, c) : free(g, dist, c, l);

  const head = highGround(g, rng, dist, axis);
  if (!head) return;
  let [long, cross] = head;

  // WHICH EDGE: the one on THIS SIDE OF THE STREET, found by looking at where
  // the street actually is beside the head rather than by halving the map.
  //
  // THIS IS THE FLOOD BUG. Heading for the nearer map edge is only the same
  // thing when the street runs down the middle, and it wanders — so a head at
  // cross 20 with the street at 15 would set off towards nought, hit the
  // street's clearance, and stop in the middle of the map. A spring feeding a
  // channel with no outlet has nowhere to put its water: measured on seed 11,
  // the map went from 2,263 units of water to 12,492 over ten simulated
  // minutes and was still climbing, with 932 of its 4,096 tiles under water.
  const street = streetAt(g, axis, long, crossW);
  const step = street < 0 ? (cross < crossW / 2 ? -1 : 1) : cross < street ? -1 : 1;
  // A width of W spans these offsets either side of the spine; an even width
  // is one more to the right than to the left, which is all "centred" can mean
  // on a grid of whole cells.
  const lo = -Math.floor((p.riverWidth - 1) / 2), hi = Math.floor(p.riverWidth / 2);
  const phase = rng() * 1000;

  // THE CHANNEL IS GRADED DOWN TO BELOW THE WHOLE MAP, and this is what makes
  // a fed river drain instead of filling something on the way.
  //
  // Cutting only to "the local ground less a depth" gives a bed that follows
  // the land — which is fine until the land has a basin deeper than the bed
  // beside the channel. Then the flow leaves the channel, falls into the
  // basin, and fills it: nothing is broken, the water is simply finding the
  // lowest thing on the map, and a player watches a lake grow for twenty
  // minutes. Interpolating the bed from the head down past the map's own
  // minimum makes the channel the lowest path there is, so the only place the
  // water can go is out.
  const floor = lowest(g) - p.riverDepth;
  const rise = g.height[cellAt(long, cross)];
  const steps = Math.max(1, step < 0 ? cross : crossW - 1 - cross);
  let bed = Infinity, reached = false;
  for (let guard = 0; guard < crossW + 2; guard++) {
    const guide = rise + (floor - rise) * Math.min(1, guard / steps);
    bed = Math.min(bed, terraceTo(
      Math.min(guide, g.height[cellAt(long, cross)] - p.riverDepth), p.terrace));
    out.cut += cutChannel(g, p, cellAt, long, cross, lo, hi, bed, out);

    if (cross <= 0 || cross >= crossW - 1) { reached = true; break; }
    const next = cross + step;

    // SLIDE TOWARDS THE LOW GROUND, one tile at most, and only where it is
    // legal to cut. The noise breaks ties so a river on level ground still
    // wanders instead of running dead straight.
    let best = long, bestH = Infinity;
    for (const d of [-1, 0, 1]) {
      const l = long + d;
      if (l < 0 || l >= longW || !okAt(l, next)) continue;
      const bias = (valueNoise(2, phase + cross / 9, 0.5) - 0.5) * 3;
      const h = g.height[cellAt(l, next)] + d * bias;
      if (h < bestH) { bestH = h; best = l; }
    }
    if (bestH === Infinity) break;                        // boxed in by the street
    long = best;
    cross = next;
  }

  // A SPRING ONLY WHERE THE CHANNEL GOT OUT. The map's edge is its only
  // outlet, so feeding a channel that stopped short is feeding a bathtub with
  // the plug in — and the map floods, slowly, for as long as it is open. A dry
  // gully is a far better failure than a drowned map.
  if (p.springs > 0 && reached) {
    const [l, c] = head;
    if (axis === "x") setSource(g, l, c, SPRING_RATE);
    else setSource(g, c, l, SPRING_RATE);
    out.springs++;
  }
}

/** Cut one cross-section of channel and put water in it. */
function cutChannel(
  g: Grid, p: GenParams, cellAt: (l: number, c: number) => number,
  long: number, cross: number, lo: number, hi: number, bed: number, out: WaterReport,
): number {
  let n = 0;
  for (let d = lo; d <= hi; d++) {
    const l = long + d;
    if (l < 0) continue;
    const i = cellAt(l, cross);
    if (i < 0 || i >= g.height.length) continue;
    // CUT ONLY WHERE THERE IS SOMETHING TO CUT — the channel crosses ground
    // that is already below its bed, and lifting that to the bed would dam it.
    // The water goes in either way, or the river has gaps in it exactly where
    // the land was lowest.
    if (g.height[i] > bed) { g.height[i] = Math.max(HEIGHT_MIN, bed); n++; }
    // HALF FULL, not brim full. A channel filled to its banks has nowhere to
    // put the spring's first second and spills over ground that was never
    // meant to be wet.
    const deep = Math.max(1, Math.round(p.riverDepth / 2));
    g.pool[i] = Math.min(255, deep);
    g.fluid[i] = WATER;
    out.wet++;
  }
  return n;
}

/**
 * Where the street crosses the given line, or -1 if it does not.
 *
 * The street spans its whole long axis, so this finds it beside any cell — and
 * which side of it you are on is the only thing that decides which way is out.
 */
function streetAt(g: Grid, axis: "x" | "y", long: number, crossW: number): number {
  for (let c = 0; c < crossW; c++) {
    const i = axis === "x" ? idx(g, long, c) : idx(g, c, long);
    if (g.paved[i] !== 0) return c;
  }
  return -1;
}

/**
 * The highest cell clear of the street, from a sample rather than a sweep.
 *
 * Sampled because the exact summit is not the interesting property — "somewhere
 * high, and different on a different seed" is — and a sweep would put every
 * river on a map with the same parameters at the same source.
 */
function highGround(
  g: Grid, rng: () => number, dist: Int16Array, axis: "x" | "y",
): [number, number] | null {
  let best: [number, number] | null = null, bestH = -Infinity;
  for (let n = 0; n < 200; n++) {
    const x = Math.floor(rng() * g.w), y = Math.floor(rng() * g.h);
    if (!free(g, dist, x, y)) continue;
    const h = g.height[idx(g, x, y)];
    if (h <= bestH) continue;
    bestH = h;
    best = axis === "x" ? [x, y] : [y, x];
  }
  return best;
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
  g: Grid, p: GenParams, rng: () => number, dist: Int16Array, out: WaterReport,
): void {
  const hollow = lowGround(g, rng, dist, p.lakeSize);
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
      if (g.height[i] <= target) continue;
      g.height[i] = Math.max(HEIGHT_MIN, target);
      out.cut++;
      const deep = rim - p.terrace - g.height[i];
      if (deep <= 0) continue;
      g.pool[i] = Math.min(255, deep);
      g.fluid[i] = WATER;
      out.wet++;
    }
  }
}

/** The lowest cell clear of the street with room for a basin around it. */
function lowGround(
  g: Grid, rng: () => number, dist: Int16Array, size: number,
): [number, number] | null {
  const pad = Math.ceil(size / 2) + 1;
  let best: [number, number] | null = null, bestH = Infinity;
  for (let n = 0; n < 200; n++) {
    const x = pad + Math.floor(rng() * Math.max(1, g.w - 2 * pad));
    const y = pad + Math.floor(rng() * Math.max(1, g.h - 2 * pad));
    if (!free(g, dist, x, y)) continue;
    const h = g.height[idx(g, x, y)];
    if (h >= bestH) continue;
    bestH = h;
    best = [x, y];
  }
  return best;
}
