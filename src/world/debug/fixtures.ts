/**
 * Test terrain for verticality (plan, Phase 3 tool section).
 *
 * A flat map proves nothing about picking under elevation, and hand-raising
 * cells in the editor gives a shape nobody can describe in a bug report. These
 * build the exact awkward cases on demand, so "the cursor lands on the wrong
 * cell" becomes reproducible.
 */
import { DIR } from "../../iso/dir";
import { layPipe } from "../water/pipes";
import { RAMP, packRamp, type RampDir } from "../iso";
import { fillTerrain, idx, inBounds, recomputeHeightRange, type Grid } from "../grid";

export type FixtureId =
  | "flat" | "ziggurat" | "occluder" | "rampFan"
  | "roadShapes" | "avenue" | "plaza" | "splitTrap"
  | "river" | "cascade" | "lake" | "islands" | "pipes" | "culvert" | "plunge"
  | "waterfall" | "brink";

const set = (g: Grid, x: number, y: number, h: number, ramp = 0) => {
  if (!inBounds(g, x, y)) return;
  const i = idx(g, x, y);
  g.height[i] = h;
  g.ramp[i] = ramp;
};

const clear = (g: Grid, material: number) => {
  fillTerrain(g, material);
  g.height.fill(0);
  g.ramp.fill(0);
  g.paved.fill(0);
  g.source.fill(0);
  g.fluid.fill(0);
  g.pool.fill(0);
  g.pipe.fill(0);
};

/**
 * Water that is ALREADY THERE, filled to a waterline.
 *
 * Every fixture used to have to be a spring, because the grid could say a
 * lake had been poured but never how deep — so water arrived by being run in
 * from somewhere and the map had to be watched while it filled. Anything about
 * water at rest, or about what a fall does to a pool that is already there,
 * could only be waited for.
 *
 * Authored as a LEVEL rather than a depth, because a pond is a thing with a
 * waterline: every cell in the box whose ground is under it gets the
 * difference, and everything standing above it stays dry. So a basin fills
 * and the rim round it does not, without anything having to say where the
 * basin is.
 */
const pond = (
  g: Grid, level: number, fluid = 1,
  x0 = 0, y0 = 0, x1 = g.w - 1, y1 = g.h - 1,
) => {
  for (let y = Math.max(0, y0); y <= Math.min(g.h - 1, y1); y++) {
    for (let x = Math.max(0, x0); x <= Math.min(g.w - 1, x1); x++) {
      const i = idx(g, x, y);
      const deep = level - g.height[i];
      if (deep <= 0) continue;
      g.pool[i] = Math.min(255, Math.round(deep));
      g.fluid[i] = fluid;
    }
  }
};

/** A tap: positive feeds, negative drains. See the `source` layer. */
const tap = (g: Grid, x: number, y: number, rate: number) => {
  if (inBounds(g, x, y)) g.source[idx(g, x, y)] = rate;
};

/** How hard a fixture's springs run, in half steps a second. */
const SPRING = 8;

const pave = (g: Grid, x: number, y: number) => {
  if (inBounds(g, x, y)) g.paved[idx(g, x, y)] = 1;
};
const paveRun = (g: Grid, x0: number, y0: number, x1: number, y1: number) => {
  const dx = Math.sign(x1 - x0), dy = Math.sign(y1 - y0);
  let x = x0, y = y0;
  for (;;) {
    pave(g, x, y);
    if (x === x1 && y === y1) break;
    x += dx; y += dy;
  }
};

/**
 * Stepped ziggurat with a ramp climbing each face.
 *
 * The point is that every tier has a ramp on it, so picking has to resolve a
 * tilted face that sits directly above and below other tilted faces — the case
 * a flat-diamond test gets wrong without ever looking obviously broken.
 */
export function buildZiggurat(g: Grid, material: number, cx: number, cy: number, tiers = 4) {
  clear(g, material);
  for (let t = 0; t < tiers; t++) {
    const r = (tiers - t) * 3;             // shrinking terrace
    const h = t * 2;                       // one full step per tier
    for (let y = cy - r; y <= cy + r; y++) {
      for (let x = cx - r; x <= cx + r; x++) set(g, x, y, h);
    }
  }
  // One ramp per face, on the terrace just outside each tier, pointing inward
  // and up. NEIGHBOUR: N=(−1,0) E=(0,−1) S=(1,0) W=(0,1).
  for (let t = 1; t < tiers; t++) {
    const r = (tiers - t) * 3;
    const base = (t - 1) * 2;              // the ramp starts on the tier below
    const up = packRamp(RAMP.N as RampDir, 2);
    const down = packRamp(RAMP.S as RampDir, 2);
    const left = packRamp(RAMP.E as RampDir, 2);
    const right = packRamp(RAMP.W as RampDir, 2);
    set(g, cx + r + 1, cy, base, up);      // rises toward −x, i.e. inward
    set(g, cx - r - 1, cy, base, down);    // rises toward +x
    set(g, cx, cy + r + 1, base, left);    // rises toward −y
    set(g, cx, cy - r - 1, base, right);   // rises toward +y
  }
  recomputeHeightRange(g);
}

/**
 * A tall ridge that lands exactly on top of the ground behind it.
 *
 * The offset is not arbitrary. A cell `n` bands NEARER at height `h` projects
 * to the same screen point as level ground `n` bands away when
 * `h·HEIGHT_UNIT = n·HH`, i.e. `h = 2n` in half steps. So a ridge at height 16
 * covers ground exactly 8 bands behind it, and a click there must resolve to
 * the RIDGE, not to the ground it hides. Getting that wrong is invisible on a
 * flat map and maddening on a hilly one.
 */
export const OCCLUDER_HEIGHT = 16;
/** Bands between the ridge and the ground it covers — see OCCLUDER_HEIGHT. */
export const OCCLUDER_GAP = OCCLUDER_HEIGHT / 2;

export function buildOccluder(g: Grid, material: number, cx: number, cy: number) {
  clear(g, material);
  const band = cx + cy;
  const k = cx - cy;
  // Three bands thick so the ridge is a wall rather than a line, and the
  // occlusion holds for points anywhere on the covered cell's face.
  for (let db = 0; db <= 2; db++) {
    for (let dk = -12; dk <= 12; dk += 2) {
      const b = band + db, kk = k + dk;
      if (((b + kk) & 1) !== 0) continue;          // x must come out integral
      set(g, (b + kk) / 2, (b - kk) / 2, OCCLUDER_HEIGHT);
    }
  }
  recomputeHeightRange(g);
}

/** One ramp of every direction and rise, side by side, for eyeballing the art. */
export function buildRampFan(g: Grid, material: number, cx: number, cy: number) {
  clear(g, material);
  const dirs: RampDir[] = [RAMP.N, RAMP.E, RAMP.S, RAMP.W];
  dirs.forEach((dir, i) => {
    for (const [j, rise] of ([1, 2] as const).entries()) {
      const x = cx + i * 3, y = cy + j * 3;
      set(g, x, y, 0, packRamp(dir, rise));
      // the cell the ramp climbs to, so the join is visible
      const step = [[-1, 0], [0, -1], [1, 0], [0, 1]][dirs.indexOf(dir)];
      set(g, x + step[0], y + step[1], rise);
    }
  });
  recomputeHeightRange(g);
}

/**
 * One of every junction the autotiler can produce: ends, straights on both
 * axes, all four bends, both T orientations and a crossroads. If any mask has
 * no art, this is the fixture that shows it.
 */
export function buildRoadShapes(g: Grid, material: number, cx: number, cy: number) {
  clear(g, material);
  // a cross
  paveRun(g, cx - 4, cy, cx + 4, cy);
  paveRun(g, cx, cy - 4, cx, cy + 4);
  // an L in each quadrant, offset so they stay separate networks
  const bends: [number, number, number, number][] = [
    [cx - 10, cy - 10, 1, 1], [cx + 10, cy - 10, -1, 1],
    [cx - 10, cy + 10, 1, -1], [cx + 10, cy + 10, -1, -1],
  ];
  for (const [bx, by, sx, sy] of bends) {
    paveRun(g, bx, by, bx + 3 * sx, by);
    paveRun(g, bx, by, bx, by + 3 * sy);
  }
  // a lone paved square, which must resolve to fill rather than nothing
  pave(g, cx + 14, cy - 14);
  recomputeHeightRange(g);
}

/** A 2-wide avenue: both columns must resolve to lane tiles, not T-junctions. */
export function buildAvenue(g: Grid, material: number, cx: number, cy: number) {
  clear(g, material);
  for (let d = -10; d <= 10; d++) { pave(g, cx + d, cy); pave(g, cx + d, cy + 1); }
  for (let d = -10; d <= 10; d++) { pave(g, cx, cy + 6 + d); pave(g, cx + 1, cy + 6 + d); }
  recomputeHeightRange(g);
}

/** A paved blob: interior fill, a rim of lanes, and four corners. */
export function buildPlaza(g: Grid, material: number, cx: number, cy: number) {
  clear(g, material);
  for (let y = cy - 4; y <= cy + 4; y++) {
    for (let x = cx - 4; x <= cx + 4; x++) pave(g, x, y);
  }
  paveRun(g, cx, cy + 5, cx, cy + 12);   // an access road off one side
  recomputeHeightRange(g);
}

/**
 * A road that LOOKS continuous but is two networks, plus the ramp that fixes it.
 *
 * The left arm runs onto a plateau with no ramp — visually a straight road, two
 * components. The right arm has the ramp, so it is one. Side by side the
 * component overlay makes the difference obvious, which is the whole reason the
 * graph exists.
 */
export function buildSplitTrap(g: Grid, material: number, cx: number, cy: number) {
  clear(g, material);
  for (const [arm, withRamp] of [[-6, false], [6, true]] as const) {
    const x = cx + arm;
    paveRun(g, x, cy - 8, x, cy + 8);
    // a plateau over the second half of the run
    for (let y = cy + 1; y <= cy + 9; y++) {
      for (let dx = -2; dx <= 2; dx++) set(g, x + dx, y, 2);
    }
    if (withRamp) {
      // the cell just below the step ramps up toward W, which is +y
      set(g, x, cy, 0, packRamp(RAMP.W as RampDir, 2));
    }
  }
  recomputeHeightRange(g);
}

/**
 * WATER FIXTURES.
 *
 * The others exist so a picking bug is reproducible; these exist so the water
 * is. Every one of them carries its own taps in the `source` layer, so loading
 * it starts a flow rather than handing you a shape to pour into — which is the
 * difference between a scene and a still life, and half an hour of raising
 * terrain by hand before you can look at anything.
 */

/**
 * A graded valley with a spring at its head.
 *
 * The plain river: a source up top, a slope, and the open edge of the map at
 * the bottom. It reaches a standing flow — as much water arriving as leaving —
 * within about half a minute.
 */
export function buildRiver(g: Grid, material: number) {
  clear(g, material);
  const mid = g.h / 2, halfWidth = Math.max(2, Math.round(g.h * 0.09));
  for (let y = 0; y < g.h; y++) {
    const bank = Math.abs(y - mid) > halfWidth ? 10 : 0;
    for (let x = 0; x < g.w; x++) set(g, x, y, Math.round((g.w - 1 - x) * 0.4) + bank);
  }
  for (let d = -1; d <= 1; d++) tap(g, 1, Math.round(mid) + d, SPRING);
}

/**
 * Terraces, each a full step down from the last, with a spring at the top.
 *
 * Falls, and what they do to a ledge they land on. The treads are wide enough
 * that the water pools on each before it goes over the next, so every riser
 * has a body of water standing at its lip rather than a film racing past it.
 */
export function buildCascade(g: Grid, material: number) {
  clear(g, material);
  const mid = g.h / 2, halfWidth = Math.max(2, Math.round(g.h * 0.11));
  const tread = Math.max(3, Math.round(g.w / 9));
  for (let y = 0; y < g.h; y++) {
    const bank = Math.abs(y - mid) > halfWidth ? 14 : 0;
    for (let x = 0; x < g.w; x++) {
      const step = Math.floor((g.w - 1 - x) / tread);
      // A lip on the downhill side of each tread, so each one holds a pool.
      const lip = (g.w - 1 - x) % tread === 0 ? 1 : 0;
      set(g, x, y, step * 4 + lip + bank);
    }
  }
  for (let d = -1; d <= 1; d++) tap(g, 1, Math.round(mid) + d, SPRING);
}

/**
 * A basin fed from a shelf and drained through a notch in its rim.
 *
 * A body of water with an inflow and an outflow, which is a different thing
 * from a pour: the level finds itself and then stays, and the fall coming into
 * it never stops.
 */
export function buildLake(g: Grid, material: number) {
  clear(g, material);
  const cx = g.w / 2, cy = g.h / 2, r = Math.min(g.w, g.h) * 0.3;
  for (let y = 0; y < g.h; y++) {
    for (let x = 0; x < g.w; x++) {
      const d = Math.hypot(x - cx, y - cy);
      // A shelf on the up-slope side, the basin in the middle, and a rim.
      const shelf = x < cx - r ? 12 : 0;
      set(g, x, y, d < r ? -6 : Math.max(2, shelf));
    }
  }
  // The notch: one tile of the rim cut down to the basin floor, so the lake
  // overflows there and runs off the map rather than rising for ever.
  for (let y = Math.round(cy) - 1; y <= Math.round(cy) + 1; y++) {
    for (let x = Math.round(cx + r) - 1; x < g.w; x++) set(g, x, y, -4);
  }
  // And it is a LAKE on the first frame, rather than a hole that becomes one
  // in half a minute. Filled to just under the notch, so the spring still has
  // somewhere to take it and the overflow is the thing you watch.
  pond(g, -5);
  for (let d = -1; d <= 1; d++) tap(g, 1, Math.round(cy) + d, SPRING);
}

/**
 * A river off a tall cliff into a pool that is already there.
 *
 * What a waterfall DOES to the water under it is the whole point of this one,
 * and it is the thing that could not be set up before {@link Grid.pool}: the
 * pool had to fill itself from the fall, so for the first half minute the fall
 * was landing on rock and by the time there was anything to plunge into the
 * interesting part had been and gone.
 *
 * A parapet round the plain keeps the pool where it is put, and the shelf is
 * cut with a channel so the river arrives as one fall rather than a curtain
 * along the whole cliff.
 */
export function buildPlunge(g: Grid, material: number) {
  clear(g, material);
  const mid = Math.round(g.h / 2), lip = Math.round(g.w * 0.45);
  const rim = g.w - 2;
  for (let y = 0; y < g.h; y++) {
    for (let x = 0; x < g.w; x++) {
      const banked = Math.abs(y - mid) > 2 ? 24 : 0;
      const wall = y < 1 || y > g.h - 2 || x > rim ? 40 : 0;
      // A shelf sloping gently down to the lip, then nothing.
      set(g, x, y, x < lip ? 24 + Math.max(0, lip - 4 - x) + banked : Math.max(0, wall));
    }
  }
  // The pool it falls into, four half steps of it, held in by the parapet.
  pond(g, 4, 1, lip, 0, g.w - 1, g.h - 1);
  for (let d = -1; d <= 1; d++) tap(g, 2, mid + d, SPRING);
}

/**
 * ONE STRAIGHT CLIFF, WITH THE RIVER ALREADY OVER IT.
 *
 * The plainest waterfall that can exist, and it exists for looking at. The
 * others in here each bend the water some way to prove something — `plunge`
 * banks its channel, `cascade` steps it, `lake` makes it find a level — and
 * every one of those puts a corner or a slope in the one place you want
 * nothing: the lip. This is a straight edge across the map, square to it, so
 * anything you can see at the brink is the brink and not the shape of the
 * channel.
 *
 * AND IT IS ALREADY RUNNING. A fixture fed only by a spring is dry at the lip
 * for the first several seconds, so every look at a waterfall began by
 * watching a puddle spread — and worse, what you finally saw was a front
 * arriving, which is not what a waterfall looks like once it has settled. The
 * shelf is poured to a level ABOVE the lip, so it is going over on the first
 * frame; the springs behind it are only there to keep it going.
 *
 * There is a pool at the bottom for the same reason: a plunge into bare rock
 * for the first two seconds is a different thing from a plunge into water,
 * and the one worth looking at is the second.
 */
export function buildWaterfall(g: Grid, material: number) {
  clear(g, material);
  const lip = Math.round(g.w * 0.45);
  const TOP = 20, BANK = 34;
  for (let y = 0; y < g.h; y++) {
    for (let x = 0; x < g.w; x++) {
      // Banked at the north and south rims so the river stays on the map and
      // arrives at the cliff square to it, and walled at the back so the head
      // of water cannot simply run away behind the springs.
      const rim = y < 2 || y > g.h - 3 || x < 1;
      set(g, x, y, rim ? BANK : x < lip ? TOP : 0);
    }
  }
  // Standing water over the shelf, two half steps above the lip, so the first
  // frame already has a river going over. The bank is higher than the level,
  // so `pond` leaves it dry without being told where the channel is.
  pond(g, TOP + 2, 1, 0, 0, lip - 1, g.h - 1);
  // And something for it to land in.
  pond(g, 3, 1, lip, 0, g.w - 1, g.h - 1);
  // Kept running. Along the whole width, so the sheet is even across the lip
  // rather than a tongue in the middle with dry rock either side of it.
  for (let y = 3; y < g.h - 3; y++) tap(g, 1, y, SPRING);
}

/**
 * THE SMALLEST POSSIBLE WATERFALL, with far too much water going over it.
 *
 * A measuring rig rather than a scene. Everything else in here is a map you
 * can look at; this is five tiles square, so a single lip fills the screen and
 * every column of it can be printed in one line. When something at a brink is
 * wrong by a few pixels, that is the difference between reading it off a
 * screenshot and reading it off the numbers.
 *
 * DELIBERATELY DROWNED. A brink holding a third of a half step and a brink
 * holding ten behave differently, and only the deep one shows the faults that
 * scale with depth — the sheet's top folding over, the drawdown having
 * something to actually sag by. A trickle over an edge looks fine even when
 * the arithmetic under it is wrong, which is exactly how a fold that goes as
 * `depth` survived being looked at for a long time.
 *
 * So: two tiles of shelf, walled on three sides to hold a head of water, a
 * twenty-four half step drop, and a spring feeding it faster than the lip can
 * take. What goes over is a wave, not a film.
 */
export function buildBrink(g: Grid, material: number) {
  clear(g, material);
  const TOP = 24, WALL = 48, LIP = 2;
  for (let y = 0; y < g.h; y++) {
    for (let x = 0; x < g.w; x++) {
      // Walled at the back and along the far rim, so the head cannot escape
      // except over the lip, and the lip is square to the map.
      //
      // AND OPEN ALONG THE NEAR ONE, past the lip. A band is `x + y`, so the
      // near rim is the last thing drawn and a wall there stands in front of
      // the very thing this fixture exists to look at — on five tiles it is
      // not a frame round the picture, it IS the picture. It is kept where it
      // holds the shelf up (a rig with no head of water measures nothing) and
      // dropped over the floor, where all it was doing was hiding the fall and
      // the pool it lands in.
      const rim = y === g.h - 1;
      const held = x === 0 || y === 0 || (rim && x < LIP);
      set(g, x, y, held ? WALL : x < LIP ? TOP : 0);
    }
  }
  // Ten half steps standing on the shelf, which is a wave and not a film.
  pond(g, TOP + 10, 1, 1, 1, LIP - 1, g.h - 2);
  // And enough below to plunge into rather than onto.
  pond(g, 4, 1, LIP, 1, g.w - 1, g.h - 2);
  // Fed harder than the lip can pass, so it stays drowned.
  for (let y = 1; y < g.h - 1; y++) tap(g, 1, y, SPRING * 6);
}

/**
 * Blocks at every elevation, each with a spring on top, in a shallow flood.
 *
 * The render bed. Water on a raised tile has been wrong at one step and right
 * at ten, and wrong at ten and right at one, more than once — so here they all
 * are at once: one step, two, four and eight, each pouring off its own edges
 * into water that is already there.
 */
export function buildIslands(g: Grid, material: number) {
  clear(g, material);
  const heights = [2, 4, 8, 16];
  const size = Math.max(3, Math.round(Math.min(g.w, g.h) / 10));
  const gap = size * 2;
  let n = 0;
  for (let row = 0; row < 2; row++) {
    for (let col = 0; col < 2; col++) {
      const x0 = Math.round(g.w / 2 - gap + col * gap);
      const y0 = Math.round(g.h / 2 - gap + row * gap);
      const h = heights[n++];
      for (let y = y0; y < y0 + size; y++) {
        for (let x = x0; x < x0 + size; x++) set(g, x, y, h);
      }
      tap(g, x0 + (size >> 1), y0 + (size >> 1), SPRING);
    }
  }
  // A rim, so the flood they pour into stays on the map and finds a level.
  for (let y = 0; y < g.h; y++) {
    for (let x = 0; x < g.w; x++) {
      if (x < 2 || y < 2 || x >= g.w - 2 || y >= g.h - 2) set(g, x, y, 20);
    }
  }
}

/**
 * A pipe carrying water down a channel into a pocket that eventually drowns it.
 *
 * Everything a pipe does, on one map that runs itself, in about half a minute.
 * A spring feeds a walled CHANNEL; a run of pipe lying along the channel has
 * its uphill end open under the flow, so it DRAWS, and its downhill end open
 * over the drop at the far end, so it DISCHARGES — in drops, fourteen half
 * steps, into the pocket below. A branch off the middle of the run is turned
 * back into itself, which is how an end is capped, so it fills and then has
 * nowhere to go. And the pocket is SMALL and walled, so it fills: give it half
 * a minute and the water outside the spout rises above the spout, the head
 * reverses, the run backs up and the whole thing goes under PRESSURE — the
 * capped branch included, drawn pale. Four behaviours, in order, without
 * touching anything.
 *
 * The channel carries water to the same drop the pipe does, and that is not a
 * compromise but the honest arrangement: a pipe lying ON the ground cannot be
 * the only way out of anything, because whatever it crosses to get out, water
 * can cross too. It also cannot be higher than the surface feeding it, which
 * is why the run lies IN the channel rather than climbing out of one — see the
 * note about running UNDER the ground in `world/water/pipes`.
 */
export function buildPipes(g: Grid, material: number) {
  clear(g, material);
  const mid = Math.round(g.h / 2);
  const LANE = 2;                                 // half the channel's width
  const x0 = 4;
  const len = Math.min(20, Math.round(g.w * 0.35));
  const drop = x0 + len;                          // where the channel ends
  const pocket = Math.min(g.w - 3, drop + 3);
  const TOP = 20, FOOT = 14, WALL = 30;

  // The channel SLOPES, so the water runs down it rather than ponding along
  // it: a level channel of this length takes minutes to reach its own end,
  // and the whole point of the fixture is that you can watch it happen.
  const bed = (x: number) =>
    Math.round(TOP - ((TOP - FOOT) * (x - x0)) / Math.max(1, len - 1));
  for (let y = 0; y < g.h; y++) {
    for (let x = 0; x < g.w; x++) {
      const lane = Math.abs(y - mid) <= LANE;
      const channel = lane && x >= x0 && x < drop;
      const basin = lane && x >= drop && x <= pocket;
      set(g, x, y, channel ? bed(x) : basin ? 0 : WALL);
    }
  }
  // Three taps across the head of the channel, so it runs properly rather than
  // seeping — the pocket below has to fill while somebody is watching.
  for (let d = -1; d <= 1; d++) tap(g, x0, mid + d, SPRING);

  // The run, lying along the channel and descending with it. `S` is
  // `(x + 1, y)`, so a cell facing S points at the next one along and is an
  // interior joint; only the two ends open on anything at all.
  const from = x0 + 3;
  for (let x = from; x < drop; x++) layPipe(g, x, mid, DIR.S);
  layPipe(g, from, mid, DIR.N, g.pipeZ[idx(g, from, mid)]);             // the intake, back up the channel

  // And the capped branch. `E` is `(x, y - 1)`, so this runs across the
  // channel, and its last cell turned back down it is an end with no opening.
  const tee = Math.round((from + drop) / 2);
  for (let d = 1; d <= LANE; d++) layPipe(g, tee, mid - d, DIR.E);
  layPipe(g, tee, mid - LANE, DIR.W, g.pipeZ[idx(g, tee, mid - LANE)]);
}

/**
 * Two basins either side of a ridge, joined UNDER it.
 *
 * The thing a surface pipe can never do, and the reason pipes have a level of
 * their own. Over the ground these two are separate worlds: the ridge between
 * them is taller than either basin can fill, so no amount of water in one ever
 * reaches the other, and the terrain solver is right about that. A run laid
 * from the floor of the left basin keeps that grade all the way across — it is
 * buried under twenty-odd half steps of rock in the middle — and the two
 * become one body of water that levels out.
 *
 * This is a culvert, or an inverted siphon, and it is worth naming which: the
 * pipe goes UNDER the obstacle, and its water is pushed up the far side by the
 * head behind it. A true siphon goes OVER, holds itself up by suction, and
 * this scheme cannot do one and should not pretend to — a free surface cannot
 * be at less than nothing.
 *
 * Nothing chooses the burial. `layPipe` takes the lower of the ground it is on
 * and the run it is joining, so a ridge in the way simply fails to lift it.
 */
export function buildCulvert(g: Grid, material: number) {
  clear(g, material);
  const mid = Math.round(g.h / 2);
  const half = Math.round(g.w / 2);
  const LANE = 3, ROCK = 16, RIDGE = 26;
  // Two pockets in solid rock, and nothing between them but rock. Small on
  // purpose: a basin the size of the map takes minutes to show a level, and a
  // fixture nobody will sit through is a fixture nobody will run.
  // Close together, because a pipe has RESISTANCE: thirty cells of it throttle
  // the flow to a trickle however much head is behind it, and the fixture then
  // shows a full pipe and a dry pocket, which is true and useless.
  const leftFrom = half - 11, leftTo = half - 4;
  // The receiving pocket is the SMALLER of the two, so that what crosses shows
  // as a level rather than as a film. A pipe passes a few units a second
  // against a spring's sixteen or more — that is not a fault in either, it is
  // what a hole of that size does — so the demonstration has to be the water
  // arriving somewhere, not the two coming level.
  const rightFrom = half + 4, rightTo = half + 7;

  for (let y = 0; y < g.h; y++) {
    for (let x = 0; x < g.w; x++) {
      const lane = Math.abs(y - mid) <= LANE;
      const basin = lane && ((x >= leftFrom && x <= leftTo) || (x >= rightFrom && x <= rightTo));
      // A RIDGE across the middle, standing above the rock either side of it,
      // so that what the pipe is going under is unmistakable — and so the
      // pockets are shallow enough to see into, which a hole sunk the ridge's
      // full depth is not.
      const crest = Math.abs(x - half) <= 2;
      set(g, x, y, basin ? 0 : crest ? RIDGE : ROCK);
    }
  }
  // One tap, in the left pocket. The right one has no water of its own, so
  // anything that ever appears in it came through the pipe.
  tap(g, leftFrom + 1, mid, SPRING);

  // Laid from the left pocket's floor, eastward, straight through the rock.
  // `S` is `(x + 1, y)`, so every cell but the last points at the next, and
  // only the two ends open on anything.
  for (let x = leftFrom + 1; x <= rightTo - 1; x++) layPipe(g, x, mid, DIR.S);
  layPipe(g, leftFrom + 1, mid, DIR.N, g.pipeZ[idx(g, leftFrom + 1, mid)]);
}

/**
 * Fixtures that want a map of their own size, rather than the one on screen.
 *
 * A rig is a size as much as it is a shape: `brink` is five tiles because five
 * tiles is what fits in one printed line of numbers, and building it into a
 * sixty-four square map would bury the thing it exists to show.
 */
export const FIXTURE_SIZE: Partial<Record<FixtureId, number>> = { brink: 5 };

/**
 * Every fixture id, so `?fixture=` can be checked against something real.
 *
 * Written out rather than derived, because `FixtureId` is a type and types are
 * gone by the time a query string turns up. The test holds the two together.
 */
export const FIXTURE_IDS: readonly FixtureId[] = [
  "flat", "ziggurat", "occluder", "rampFan", "roadShapes", "avenue", "plaza",
  "splitTrap", "river", "cascade", "lake", "islands", "pipes", "culvert",
  "plunge", "waterfall", "brink",
];

export function applyFixture(g: Grid, id: FixtureId, material: number) {
  const cx = Math.floor(g.w / 2), cy = Math.floor(g.h / 2);
  switch (id) {
    case "flat": clear(g, material); recomputeHeightRange(g); return;
    case "ziggurat": buildZiggurat(g, material, cx, cy); return;
    case "occluder": buildOccluder(g, material, cx, cy); return;
    case "rampFan": buildRampFan(g, material, cx, cy); return;
    case "roadShapes": buildRoadShapes(g, material, cx, cy); return;
    case "avenue": buildAvenue(g, material, cx, cy); return;
    case "plaza": buildPlaza(g, material, cx, cy); return;
    case "splitTrap": buildSplitTrap(g, material, cx, cy); return;
    case "river": buildRiver(g, material); recomputeHeightRange(g); return;
    case "cascade": buildCascade(g, material); recomputeHeightRange(g); return;
    case "lake": buildLake(g, material); recomputeHeightRange(g); return;
    case "islands": buildIslands(g, material); recomputeHeightRange(g); return;
    case "pipes": buildPipes(g, material); recomputeHeightRange(g); return;
    case "culvert": buildCulvert(g, material); recomputeHeightRange(g); return;
    case "plunge": buildPlunge(g, material); recomputeHeightRange(g); return;
    case "waterfall": buildWaterfall(g, material); recomputeHeightRange(g); return;
    case "brink": buildBrink(g, material); recomputeHeightRange(g); return;
  }
}
