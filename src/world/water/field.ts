/**
 * World v2 — the map's water, as a field of columns.
 *
 * LIVE STATE, not a map layer. Depth is a float that changes every frame, so it
 * does not belong in the undo system alongside `terrain` and `height`: it sits
 * outside the grid the way the road network and the dirty set do.
 *
 * WHICH MEANS NO WATER EDIT IS UNDOABLE — not the pour and not the drain. This
 * used to claim the pour was. What undo reverses is the `fluid` layer, which
 * records what was poured where for the save file; the depth it put on the
 * columns stays. @see world.store, where the measurement is.
 *
 * The columns are FINER than the tiles. Terrain height is per tile, so every
 * column of a tile starts from the same ground — but a finer grid gives the
 * surface somewhere to vary within a tile, which is what stops a lake reading
 * as a row of flat plates, and it gives the flow room to turn.
 */
import {
  FLOW_DEFAULTS, addWater, createColumnField, setMaterialDrag, setOpenEdge, stepFlow, surfaceAt, totalWater, wantDepth, type ColumnField, type FlowParams,
} from "../../fluid/columns";
import { waterInDrips } from "../../fluid/drips";
import { idx, inBounds, structureAt, type Grid } from "../grid";
import { fluidChoices } from "./materials";
import {
  createPipeNets, findPipeNets, pipeCellCount, type PipeNets,
} from "./pipe-net";

/**
 * Columns per map tile, per axis.
 *
 * PURELY a detail setting: the solver works in tiles, not in columns, so the
 * water goes to the same places at the same speed however finely a tile is
 * divided — only the surface it is drawn with gets finer. That was not always
 * true, and the fix is in `fluid/columns.ts`: every length in the scheme is
 * divided by the cell size.
 *
 * Four, because at one per tile the surface can only be flat across a whole
 * tile and a pond looks tiled, and the ground under the columns is per tile
 * anyway, so the extra columns buy surface detail rather than terrain detail.
 * Each step up costs a factor of four in memory and in solver work — 1.7MB and
 * 10ms a frame for a completely flooded 64x64 map at four.
 */
export const COLUMNS_PER_TILE = 4;

/**
 * How many half steps of water one pour puts down.
 *
 * A pour is a volume, not a level: the point of the whole thing is that where
 * it ends up is the simulation's business and not the brush's.
 */
export const POUR_AMOUNT = 6;

export type WaterField = {
  columns: ColumnField;
  /** Map size in TILES, so a resize can be detected. */
  w: number;
  h: number;
  /**
   * How much of a drop each cell's pipe has grown so far.
   *
   * Live state and not map data: a pipe is a thing you placed, and how far
   * through its next drop it happens to be is the simulation's business. One
   * number per cell because a nozzle's whole state is how much it is holding.
   */
  held: Float32Array;
  /**
   * Water standing IN the pipes, per cell.
   *
   * Live state and not map data, the same as depth: a pipe is a thing you
   * placed, what happens to be lying in it is the simulation's business. Per
   * cell rather than per network so that joining two runs and cutting one are
   * both free — see the note in `pipes.ts`.
   */
  pipe: Float32Array;
  /**
   * Discharge on the edge between two pipe cells: the `+x` edge of each cell
   * and its `+y` edge, the same layout the solver uses for its own fluxes.
   *
   * This is the MOMENTUM, and it is the whole of why the water in a pipe can
   * slosh — a level without one settles and cannot overshoot.
   */
  pipeFlux: Float32Array;
  /** The networks, rebuilt from the grid when the map changes. @see findPipeNets */
  nets: PipeNets;
  /** The `grid.rev` the orphans were last swept at. @see spillOrphaned */
  spilled: number;
  /**
   * THE CELLS THAT HAVE A SPRING OR A DRAIN ON THEM, and nothing else.
   *
   * `runSources` walked all four thousand cells of a 64² map every frame to
   * find three of them, and the walk grows with the map while the number of
   * taps on it does not — a spring is something a hand puts down. Built when
   * `grid.rev` says the map has changed and kept until it changes again.
   */
  taps: CellList;
};

/** A list of cell indices built off the grid, and the `rev` it was built at. */
export type CellList = { at: Int32Array; n: number; rev: number };

/** An empty list, which every `rev` but the grid's own disagrees with. */
export const emptyCellList = (n: number): CellList =>
  ({ at: new Int32Array(n), n: 0, rev: -1 });

/**
 * Whether a new map lets water off its edge.
 *
 * On, because a map is a piece of somewhere larger and a river has to end
 * somewhere. Walled in, a spring fills the world and the only way out is a
 * hole you dug — which is fine for a reservoir and useless for a river.
 */
export const OPEN_EDGE_DEFAULT = true;

export function createWaterField(
  grid: Grid,
  params: FlowParams = FLOW_DEFAULTS,
): WaterField {
  const field: WaterField = {
    columns: createColumnField(
      grid.w * COLUMNS_PER_TILE,
      grid.h * COLUMNS_PER_TILE,
      params,
      1 / COLUMNS_PER_TILE,
    ),
    w: grid.w,
    h: grid.h,
    held: new Float32Array(grid.w * grid.h),
    pipe: new Float32Array(grid.w * grid.h),
    pipeFlux: new Float32Array(grid.w * grid.h * 2),
    nets: createPipeNets(grid.w, grid.h),
    spilled: -1,
    taps: emptyCellList(grid.w * grid.h),
  };
  // Each fluid keeps its own momentum differently — the only thing that makes
  // one behave unlike another now that depth and levels are gone.
  for (const { index, material } of fluidChoices()) {
    setMaterialDrag(field.columns, index, material.drag);
  }
  setOpenEdge(field.columns, OPEN_EDGE_DEFAULT);
  syncGround(field, grid);
  fillPools(field, grid);
  return field;
}

/** Tile a column sits in. */
export const tileOf = (cx: number) => Math.floor(cx / COLUMNS_PER_TILE);

/** The first column of a tile, per axis. */
export const columnOf = (tx: number) => tx * COLUMNS_PER_TILE;

/**
 * Copy terrain heights into the column grounds.
 *
 * Called after any height edit. A structure's footprint is treated as solid
 * ground raised out of reach, so water goes round a building rather than
 * through it — the alternative is a pond appearing inside someone's office.
 */
/**
 * Put the map's standing water where the map says it is.
 *
 * Once, at the moment the field is built, because {@link Grid.pool} is an
 * initial condition and not a mirror — see its own note. After the ground, so
 * a pool knows what it is standing on.
 *
 * The depth goes on every COLUMN of the tile rather than being spread across
 * them, which is the same thing `pourAt` means by an amount: a tile two half
 * steps deep is two half steps deep everywhere on it, not half a step in each
 * quarter. The solver takes it from there and it is level within a frame.
 */
export function fillPools(field: WaterField, grid: Grid) {
  for (let y = 0; y < grid.h; y++) {
    for (let x = 0; x < grid.w; x++) {
      const i = idx(grid, x, y);
      const deep = grid.pool[i];
      if (deep > 0) pourAt(field, x, y, deep, grid.fluid[i] || 1);
    }
  }
}

/**
 * The water as it stands RIGHT NOW, as a {@link Grid.pool} layer.
 *
 * The other end of {@link fillPools}, and what makes saving a map keep the
 * water on it. Pouring is not an edit — it puts water into the running world
 * rather than into the map, which is why it is not undoable and why the grid
 * knows nothing about it — so the only moment at which the map can be told
 * what water it has is the moment it is written out.
 *
 * Returns the layer rather than writing it into the grid, deliberately.
 * `Grid.pool` is an initial condition and not a mirror; a SAVE is a snapshot,
 * and those are different things. Reloading the file makes this snapshot the
 * new map's initial condition, which is exactly "save the world as it stands,
 * open it as it was".
 *
 * Per tile and rounded to a half step, because that is what the layer holds.
 * A film thinner than half a half step rounds away — on a flat plain friction
 * always leaves one, and a saved map that came back with a millimetre of water
 * over every tile of it would be worse than one that came back dry. What is in
 * the AIR is not here either: a fall in flight, a drop, what is standing in a
 * pipe. That is a fraction of a second of the map's water and it refills from
 * the ports and springs that made it.
 *
 * AND IT STOPS AT 255, which is the layer's type and not a choice: `pool` is a
 * `Uint8Array`, so a tile holding more than 255 half steps saves as 255 and
 * reloads shallower than it was.
 *
 * It is REACHABLE, which is why this is written down rather than waved at. The
 * editor clamps terrain to [-126, 126] half steps, so a basin cut to the floor
 * beside a wall at the ceiling is 252 deep — just inside — and any of it
 * poured over the brim of that wall goes past. Nobody builds that by accident
 * and nothing in play approaches it, but "cannot happen" would be wrong.
 *
 * Widening it is a change to the FILE FORMAT and wants a version bump, which
 * is why this says so rather than doing it.
 * @see WORLD_FILE_VERSION, HEIGHT_MAX
 */
export function poolSnapshot(field: WaterField, grid: Grid): Uint8Array {
  const out = new Uint8Array(grid.w * grid.h);
  for (let y = 0; y < grid.h; y++) {
    for (let x = 0; x < grid.w; x++) {
      out[idx(grid, x, y)] = Math.min(255, Math.round(depthAt(field, x, y)));
    }
  }
  return out;
}

export function syncGround(field: WaterField, grid: Grid) {
  const { columns } = field;
  // SAID ONCE, HERE, so the device does not have to be told every frame just
  // in case. @see ColumnField.groundRev
  columns.groundRev++;
  for (let cy = 0; cy < columns.ny; cy++) {
    const ty = tileOf(cy);
    for (let cx = 0; cx < columns.nx; cx++) {
      const tx = tileOf(cx);
      const i = cy * columns.nx + cx;
      if (!inBounds(grid, tx, ty)) {
        columns.ground[i] = 127;
        continue;
      }
      const t = idx(grid, tx, ty);
      columns.ground[i] =
        structureAt(grid, tx, ty) >= 0
          ? grid.height[t] + SOLID_LIFT
          : grid.height[t];
    }
  }
}

/** How far above its ground a built-on cell is treated as standing. */
export const SOLID_LIFT = 64;

/** Let water off the edge of the map, or wall it in. */
export const setWaterEdge = (field: WaterField, open: boolean) =>
  setOpenEdge(field.columns, open);

/** Whether water can leave the map at its edge. */
export const waterEdgeIsOpen = (field: WaterField) => field.columns.openEdge;

/** Advance the flow. */
export const stepWater = (field: WaterField, dt: number) =>
  stepFlow(field.columns, dt);

/**
 * Run the springs and drains for `dt` seconds.
 *
 * Before the flow, so water arriving this frame is water the flow can move
 * this frame — a spring that emitted after the step would leave a pulse
 * sitting on its own cell for a frame before anything happened to it.
 *
 * The rate is how fast the water LEVEL rises over the tile, in half steps a
 * second, which is resolution-independent because `pourAt` puts the same depth
 * on every one of the tile's columns rather than sharing an amount between
 * them. Dividing it among them would make the tap run slower the finer the
 * grid got.
 */
export function runSources(field: WaterField, grid: Grid, dt: number) {
  const { source } = grid;
  const taps = findTaps(field, grid);
  for (let k = 0; k < taps.n; k++) {
    const i = taps.at[k];
    const rate = source[i];
    if (rate === 0) continue;
    const x = i % grid.w, y = (i / grid.w) | 0;
    if (rate > 0) pourAt(field, x, y, rate * dt, grid.fluid[i] || 1);
    else drainAt(field, x, y, -rate * dt);
  }
}

/**
 * The cells with a tap on them, walked out of the grid only when it changes.
 *
 * The `rate === 0` test above still stands, because the list is allowed to be
 * a superset: what must never happen is a tap that is running and not on it,
 * and `grid.rev` is what promises that. @see edited
 */
export function findTaps(field: WaterField, grid: Grid): CellList {
  const taps = field.taps;
  if (taps.rev === grid.rev) return taps;
  const { source } = grid;
  let n = 0;
  for (let i = 0; i < source.length; i++) if (source[i] !== 0) taps.at[n++] = i;
  taps.n = n;
  taps.rev = grid.rev;
  return taps;
}

/** How much a spring puts out, and a drain takes, in half steps a second. */
export const SOURCE_RATE = 8;

/** Pour water over the columns of a tile. */
export function pourAt(
  field: WaterField,
  x: number,
  y: number,
  amount: number,
  material: number,
) {
  const { columns } = field;
  const cx0 = columnOf(x),
    cy0 = columnOf(y);
  for (let dy = 0; dy < COLUMNS_PER_TILE; dy++) {
    for (let dx = 0; dx < COLUMNS_PER_TILE; dx++) {
      addWater(columns, cx0 + dx, cy0 + dy, amount, material);
    }
  }
}

/** Take water off the columns of a tile. `Infinity` empties it. */
export function drainAt(
  field: WaterField,
  x: number,
  y: number,
  amount: number,
) {
  const { columns } = field;
  const cx0 = columnOf(x),
    cy0 = columnOf(y);
  for (let dy = 0; dy < COLUMNS_PER_TILE; dy++) {
    for (let dx = 0; dx < COLUMNS_PER_TILE; dx++) {
      addWater(columns, cx0 + dx, cy0 + dy, -amount);
    }
  }
}

/**
 * Mean depth over a tile's columns, for readouts and the inspector.
 *
 * AND IT ASKS FOR NEXT TIME. While the device owns the water this reads a copy
 * some frames old, and the whole depth field only comes back on the slow
 * refresh — so a tile nobody has looked at lately answers from whenever that
 * was. Registering the columns it just read means the pointer's own tile is
 * current from the next readback on, which is what the inspector is for.
 * A no-op on the CPU path. @see wantDepth
 */
export function depthAt(field: WaterField, x: number, y: number): number {
  const { columns } = field;
  const cx0 = columnOf(x),
    cy0 = columnOf(y);
  let sum = 0,
    n = 0;
  for (let dy = 0; dy < COLUMNS_PER_TILE; dy++) {
    for (let dx = 0; dx < COLUMNS_PER_TILE; dx++) {
      const cx = cx0 + dx,
        cy = cy0 + dy;
      if (cx >= columns.nx || cy >= columns.ny) continue;
      const i = cy * columns.nx + cx;
      sum += columns.depth[i];
      wantDepth(columns, i);
      n++;
    }
  }
  return n ? sum / n : 0;
}

/** Surface height over a tile, or null where it is dry. */
export function surfaceOver(
  field: WaterField,
  x: number,
  y: number,
): number | null {
  const { columns } = field;
  const cx0 = columnOf(x),
    cy0 = columnOf(y);
  let sum = 0,
    n = 0;
  for (let dy = 0; dy < COLUMNS_PER_TILE; dy++) {
    for (let dx = 0; dx < COLUMNS_PER_TILE; dx++) {
      const cx = cx0 + dx,
        cy = cy0 + dy;
      if (cx >= columns.nx || cy >= columns.ny) continue;
      const i = cy * columns.nx + cx;
      if (columns.depth[i] <= columns.params.dryDepth) continue;
      sum += surfaceAt(columns, i);
      n++;
    }
  }
  return n ? sum / n : null;
}

/** Tiles holding any water, for the debug readout. */
export function wetTiles(field: WaterField): number {
  let n = 0;
  for (let y = 0; y < field.h; y++) {
    for (let x = 0; x < field.w; x++) {
      if (depthAt(field, x, y) > field.columns.params.dryDepth) n++;
    }
  }
  return n;
}

/**
 * Every drop the map is holding, wherever it happens to be.
 *
 * Columns, water in the air off a lip, drops in flight — and now what is
 * standing in the pipes and what is hanging at their mouths. A conservation
 * check is only worth anything if it counts ALL of it: water that moves into
 * a pipe has not been destroyed, and a total that stopped counting it would
 * report a leak every time a drain worked.
 */
export const totalVolume = (field: WaterField, grid: Grid, onTheMap?: number) =>
  (onTheMap === undefined
    ? totalWater(field.columns)
    // THE MAP'S SHARE, COUNTED ELSEWHERE. When the device solver is running it
    // has already summed both the depths and what is in the air — see
    // `createMeta` and `createFallout` — and the alternative is walking sixty
    // five thousand columns and a hundred and thirty thousand edges every
    // tick to work out a number somebody has already worked out. The DROPS
    // still come from here: the drip list is the host's own.
    : onTheMap + waterInDrips(field.columns.drips))
  + waterInPipes(field, grid) + waterAtMouths(field, grid);

/**
 * Every drop standing in a pipe anywhere on the map.
 *
 * OVER THE PIPE CELLS, which is where the only non-zero entries can be —
 * water gets into `pipe` by flowing along a run, and every cell of a run
 * carries pipe. Both of these ran down the whole four thousand cell array
 * every frame for a readout in the corner of the screen.
 *
 * EXCEPT WITH AN EDIT OUTSTANDING, which is the one moment the two disagree.
 * Cut a run and its middle cell is off the networks at once while the water
 * standing in it is still there, waiting for the sweep — so the list is short
 * by that cell, and a total taken from it would report the water as lost. The
 * flag the sweep keeps says exactly when that can be true, and while it is,
 * this walks the array as it always did. {@link spillOrphaned} clears it on
 * the next step and the list is exact again.
 *
 * TAKES THE GRID for that comparison, which also rules out the version of
 * this that reads nought on a map whose networks nobody has built yet.
 */
export function waterInPipes(field: WaterField, grid: Grid): number {
  return overPipes(field, grid, field.pipe);
}

/** What is hanging at the mouths, grown but not yet let go. @see waterInPipes */
export function waterAtMouths(field: WaterField, grid: Grid): number {
  return overPipes(field, grid, field.held);
}

/** Sum a per-cell array over the pipes, by whichever route is exact. */
function overPipes(field: WaterField, grid: Grid, of: Float32Array): number {
  let sum = 0;
  if (field.spilled !== grid.rev) {
    for (let i = 0; i < of.length; i++) sum += of[i];
    return sum;
  }
  const nets = findPipeNets(grid, field.nets);
  const { cells } = nets;
  const upto = pipeCellCount(nets);
  for (let k = 0; k < upto; k++) sum += of[cells[k]];
  return sum;
}
