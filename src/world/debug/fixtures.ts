/**
 * Test terrain for verticality (plan, Phase 3 tool section).
 *
 * A flat map proves nothing about picking under elevation, and hand-raising
 * cells in the editor gives a shape nobody can describe in a bug report. These
 * build the exact awkward cases on demand, so "the cursor lands on the wrong
 * cell" becomes reproducible.
 */
import { RAMP, packRamp, type RampDir } from "../iso";
import { fillTerrain, idx, inBounds, recomputeHeightRange, type Grid } from "../grid";

export type FixtureId =
  | "flat" | "ziggurat" | "occluder" | "rampFan"
  | "roadShapes" | "avenue" | "plaza" | "splitTrap"
  | "river" | "cascade" | "lake" | "islands";

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
  for (let d = -1; d <= 1; d++) tap(g, 1, Math.round(cy) + d, SPRING);
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
  }
}
