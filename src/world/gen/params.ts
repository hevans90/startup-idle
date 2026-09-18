/**
 * Every knob the map generator has, in one place, as data.
 *
 * TWO INPUTS, NOT ONE. The seed picks WHICH map — the shape of the hills, where
 * the street wanders, where the water lies. These pick WHAT KIND of map: how
 * tall the hills are, how much of the land is plain, how wet it is, how wooded.
 * Holding the seed and moving a slider therefore gives you the same map again
 * with different weather, which is the only way to tune terrain generation by
 * eye — change both at once and you cannot tell what your change did.
 *
 * That split is a constraint on the code, not just a description of it: every
 * random draw must come from the seed alone and every parameter must enter as a
 * magnitude, never as an extra source of randomness. A parameter that reseeds
 * anything breaks the promise above, and the tests hold it.
 *
 * THE SLIDER TABLE IS THE UI. `GEN_SLIDERS` carries the range and the label for
 * each knob, so the editor's panel is generated from this file rather than
 * hand-written beside it — a new parameter is one entry here and appears in the
 * panel with its own slider, correctly bounded.
 */

export type GenParams = {
  /**
   * Tiles across the map, both ways.
   *
   * THE ONE PARAMETER `generateMap` DOES NOT READ, and it cannot: the grid is
   * allocated before there is anything to generate into it, and it is the
   * caller that owns it. `generateWorld` is what honours this — it makes the
   * grid this big and then generates. It lives here anyway because it is
   * plainly one of the things that decides what kind of map you get, and a
   * size that lived somewhere else would be a size you could set and then not
   * have applied by the button marked generate.
   */
  size: number;
  /** Half steps between the highest ground and the lowest, before carving. */
  relief: number;
  /** Tiles across one feature of the landscape — bigger is broader hills. */
  feature: number;
  /**
   * How hard the land is pushed away from its middle.
   *
   * Noise is densest in the middle of its range, so terrain taken straight off
   * it is gently undulating EVERYWHERE and flat nowhere. Above one this pulls
   * the middle towards nought and leaves the extremes alone: most of the map
   * settles into plains you can build on, and what is left rises into hills
   * worth the levelling. At one it is raw noise; below one there is nothing but
   * slope.
   */
  contrast: number;
  /**
   * Octaves of noise in the land.
   *
   * The fourth octave's wavelength is under two tiles at the default feature
   * size, so all it can express is a one-cell bump — which is a full 16.5px
   * ledge that has to be levelled before anything stands on it. Three reads as
   * landscape; four reads as static.
   */
  octaves: number;
  /**
   * Half steps the land is quantised to.
   *
   * TWO is one full slab, which is the step the tileset is drawn for: a ground
   * frame is a diamond top plus a 33px skirt, and that skirt is exactly one
   * step of wall. Terraced to it, every cliff lines up with its art. One puts
   * half the map on half-step ledges the wall art has to fake; four gives mesas.
   */
  terrace: number;
  /**
   * Half steps the land may climb per tile away from the road.
   *
   * THE FRONTAGE GUARANTEE. A cone around the street rather than a shoulder
   * beside it: a shoulder blends the land towards the road by a FRACTION of the
   * drop, so it stays gentle only until somebody raises the relief, while a cap
   * on the climb per tile is absolute and stops binding by itself once it is
   * wider than the hills.
   */
  rise: number;
  /** Tiles the street wanders either side of its straight line. */
  wander: number;
  /** Lanes the street is wide. Two, or the autotiler draws a path. */
  roadWidth: number;
  /** Half steps below the street at which ground becomes sand. */
  lowland: number;
  /** Half steps above the street at which ground becomes bare earth. */
  upland: number;
  /** Rivers to run down the land. */
  rivers: number;
  /**
   * Half steps a river's channel is cut below its banks AT ITS MOUTH.
   *
   * At the mouth, because a river that is the same depth all the way along is
   * a canal. The headwaters are cut a third of this and the bed deepens
   * downstream. @see carveChannel
   */
  riverDepth: number;
  /** Tiles a river's channel is wide AT ITS MOUTH. @see reachAt */
  riverWidth: number;
  /**
   * Half steps the valley floor lies below the plain around it.
   *
   * The valley and the CHANNEL are different things and this is the first of
   * them: the floor is the flat the river wanders over, and the channel is cut
   * into that. A river with no valley is a slot in a field, which is what the
   * generator used to make.
   */
  valleyDepth: number;
  /** Tiles from the river to the top of its valley side. */
  valleyWidth: number;
  /**
   * Half steps the valley floor falls from the inlet to the mouth.
   *
   * THE ONE NUMBER THE OLD GENERATOR HAD NO WAY TO SET, and its absence is why
   * rivers did not flow. The bed took whatever fall the noise happened to
   * leave between two edges, which over eight seeds was 15 half steps of net
   * descent against 38 of CLIMB. Set here, the floor descends because it is
   * built to and the noise is faded out where it would argue.
   */
  riverFall: number;
  /**
   * Tiles the valley flares, PER SLAB the channel is cut.
   *
   * The difference between a valley and a canyon. Measured against the depth of
   * the cut rather than as a fixed width, so a shallow reach gets a lip and a
   * gorge gets a proper side instead of a sheer face where the bank ran out.
   * Nought cuts a trench with vertical walls, which is what a ditch looks like.
   */
  riverBank: number;
  /**
   * How far a river runs, as a multiple of the straight line to its outlet.
   *
   * A river that goes straight at the sea is a drain. This is the budget it
   * has to follow the land instead — spend it, and the last stretch makes for
   * the outlet directly so the channel always gets off the map.
   */
  riverLength: number;
  /**
   * How much a river wanders across the slope rather than straight down it.
   *
   * Nought is steepest descent, which on terraced ground is a staircase of
   * straight runs. One is a river that barely reads the land at all.
   */
  riverMeander: number;
  /** Side streams joining each river. */
  tributaries: number;
  /** Standing lakes to sink into low ground, over and above the rivers. */
  lakes: number;
  /** Tiles across a lake. */
  lakeSize: number;
  /**
   * Whether each river is fed from beyond the map's edge.
   *
   * ON, and it is what makes a river a river rather than a long pond. The
   * water arrives over the boundary at the head and leaves over it at the
   * mouth, so the map is a reach of something larger.
   *
   * It is a LEVEL and not a rate, which is why it can be on by default. A
   * spring delivers the same amount whatever the channel is already holding,
   * so the number has to be guessed against each map's own grade and section
   * and is wrong on most of them — too little and the river is a trickle, too
   * much and the country drowns. A held level delivers what the channel will
   * take and nothing once it is full. @see Grid.inflow
   */
  springs: number;
  /** Share of the grass that is wooded, nought to one. */
  trees: number;
  /** Tiles across one stand of trees — bigger is fewer, larger woods. */
  woodSize: number;
};

export const DEFAULT_GEN: GenParams = {
  size: 64,
  relief: 16,
  feature: 34,
  contrast: 3,
  octaves: 3,
  terrace: 2,
  rise: 2,
  wander: 7,
  roadWidth: 2,
  lowland: 4,
  upland: 8,
  rivers: 1,
  riverDepth: 6,
  riverWidth: 3,
  valleyDepth: 6,
  valleyWidth: 5,
  riverFall: 12,
  riverBank: 1,
  riverLength: 1,
  riverMeander: 0.55,
  tributaries: 1,
  lakes: 1,
  lakeSize: 9,
  springs: 1,
  trees: 0.28,
  woodSize: 7,
};

/** A knob, as the editor's panel needs to draw it. */
export type Slider = {
  key: keyof GenParams;
  label: string;
  min: number;
  max: number;
  step: number;
  /** Which fieldset it belongs under. */
  group: "map" | "land" | "road" | "water" | "cover";
  /** What moving it does, for the control's title. */
  hint: string;
};

/**
 * Ranges, and they are the SAFE range rather than the whole number line.
 *
 * A generator is only worth tuning by hand if every position of every slider
 * still makes a map — so the bounds here are the ones the guarantees survive,
 * not the ones the arithmetic survives. `rise` may not go to nought, because a
 * cone of nought would flatten the entire map to the street's level; `octaves`
 * stops at six because the seventh is finer than a cell and can only add noise
 * nothing can be built on.
 */
export const GEN_SLIDERS: readonly Slider[] = [
  // SIXTEEN TO A HUNDRED AND TWENTY-EIGHT, both ends measured.
  //
  // Sixteen is the smallest that still fits a street with its margins and a
  // buildable side either way. A hundred and twenty-eight is 16,384 cells and
  // 262,144 water columns, and it draws at 119fps on the device solver and
  // 102 on the host one — so it is where the testing stops rather than where
  // the renderer does.
  //
  // IT USED TO STOP AT 96, and the reason given was wrong twice over. The
  // first was real and is fixed: the quad list's stride was a texture WIDTH,
  // and 128 tiles wanted 10,240 of the 8,192 a device is guaranteed
  // (@see quadList). The second was a `RangeError` at boot that looked like it
  // scaled with the band count — it does not. It happens at 64² too, on a
  // fresh load, and has nothing to do with the size of the map.
  { key: "size", label: "tiles", min: 16, max: 128, step: 16, group: "map",
    hint: "tiles across the map, both ways — applied by generate" },
  { key: "relief", label: "relief", min: 0, max: 48, step: 2, group: "land",
    hint: "half steps between the highest ground and the lowest" },
  { key: "feature", label: "feature", min: 6, max: 80, step: 1, group: "land",
    hint: "tiles across one hill — bigger is broader, smoother country" },
  { key: "contrast", label: "plains", min: 1, max: 6, step: 0.1, group: "land",
    hint: "how much of the land settles flat; 1 is raw noise, everywhere sloping" },
  { key: "octaves", label: "detail", min: 1, max: 6, step: 1, group: "land",
    hint: "octaves of noise — past four it is bumps smaller than a tile" },
  { key: "terrace", label: "terrace", min: 1, max: 8, step: 1, group: "land",
    hint: "half steps the land snaps to; 2 is one slab, which the art is drawn for" },
  { key: "rise", label: "grade", min: 1, max: 8, step: 1, group: "road",
    hint: "half steps the land may climb per tile away from the street" },
  { key: "wander", label: "wander", min: 0, max: 20, step: 1, group: "road",
    hint: "tiles the street strays either side of its line; 0 is dead straight" },
  { key: "roadWidth", label: "lanes", min: 1, max: 4, step: 1, group: "road",
    hint: "tiles the street is wide" },
  { key: "lowland", label: "sand at", min: 0, max: 24, step: 1, group: "cover",
    hint: "half steps under the street at which ground turns to sand" },
  { key: "upland", label: "earth at", min: 0, max: 24, step: 1, group: "cover",
    hint: "half steps over the street at which grass gives out" },
  { key: "rivers", label: "rivers", min: 0, max: 4, step: 1, group: "water",
    hint: "channels cut down the land from the high ground" },
  { key: "riverDepth", label: "depth", min: 2, max: 16, step: 2, group: "water",
    hint: "half steps a channel is cut below its banks at its mouth" },
  { key: "riverWidth", label: "width", min: 1, max: 7, step: 1, group: "water",
    hint: "tiles across a channel at its mouth" },
  { key: "valleyDepth", label: "valley", min: 0, max: 24, step: 2, group: "water",
    hint: "half steps the valley floor lies below the plain around it" },
  { key: "valleyWidth", label: "valley wide", min: 2, max: 24, step: 1, group: "water",
    hint: "tiles from the river to the top of its valley side" },
  { key: "riverFall", label: "fall", min: 0, max: 64, step: 2, group: "water",
    hint: "half steps the valley falls from where the river enters to where it leaves" },
  { key: "riverBank", label: "banks", min: 0, max: 3, step: 1, group: "water",
    hint: "tiles the valley flares per slab of depth; 0 cuts a ditch, not a valley" },
  { key: "riverLength", label: "length", min: 1, max: 6, step: 1, group: "water",
    hint: "how far it wanders before making for the sea, against the straight line" },
  { key: "riverMeander", label: "meander", min: 0, max: 1, step: 0.05, group: "water",
    hint: "wandering across the slope vs running straight down it" },
  { key: "tributaries", label: "tributaries", min: 0, max: 3, step: 1, group: "water",
    hint: "side streams joining each river" },
  { key: "lakes", label: "lakes", min: 0, max: 5, step: 1, group: "water",
    hint: "standing water sunk into the low ground" },
  { key: "lakeSize", label: "lake size", min: 3, max: 18, step: 1, group: "water",
    hint: "tiles across a lake" },
  { key: "springs", label: "springs", min: 0, max: 1, step: 1, group: "water",
    hint: "feed each river from its head — living water, but the solver never settles" },
  { key: "trees", label: "woods", min: 0, max: 1, step: 0.02, group: "cover",
    hint: "share of the grass that is wooded" },
  { key: "woodSize", label: "wood size", min: 2, max: 20, step: 1, group: "cover",
    hint: "tiles across one stand — bigger is fewer, larger woods" },
];

/** Fill in whatever a caller left out, and keep every value inside its slider. */
export function withDefaults(p?: Partial<GenParams>): GenParams {
  const out = { ...DEFAULT_GEN, ...p };
  for (const s of GEN_SLIDERS) {
    const v = out[s.key];
    out[s.key] = Number.isFinite(v) ? Math.max(s.min, Math.min(s.max, v)) : DEFAULT_GEN[s.key];
  }
  return out;
}
