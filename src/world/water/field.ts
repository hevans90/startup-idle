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
  FLOW_DEFAULTS, NO_INFLOW, addWater, createColumnField, rimAt, rimLength,
  setMaterialDrag, setOpenEdge, setRim, stepFlow, surfaceAt, totalWater,
  wantDepth, type ColumnField, type FlowParams,
} from "../../fluid/columns";
import { OPEN_SKY } from "../../fluid/slots";
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
  /**
   * Whether the field was built with room for a second storey. @see STOREYS
   *
   * There is no second FIELD any more — see `fluid/slots`. A column has
   * slots in it and a deck is the roof of one and the floor of the next,
   * which is the whole of what makes water cross onto a bridge instead of
   * being handed between two simulations by four rules somebody wrote down.
   *
   * What is left is a size: a slot costs memory whether anything stands in
   * it or not, and at a hundred and twenty eight tiles a spare storey is
   * about a hundred megabytes. So a map with no decks on it is built with
   * one, and one is the field the solver has always been.
   */
  storeys: number;
  /**
   * BUMPED WHEN THE COLUMN FIELD ITSELF IS REPLACED, which is rare and is
   * not the same thing as the ground moving.
   *
   * A field's slot count is fixed when it is made, so putting the first deck
   * on a map that had none needs a new one. Anything holding the old field —
   * the device solver above all — has to be told, and `groundRev` cannot say
   * it: that means "the terrain moved", and everything reading it would
   * re-upload a ground array into a solver that is the wrong shape.
   */
  fieldRev: number;
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

/**
 * How many slots a column gets on a map that has bridges on it.
 *
 * Two: the ground, and the deck over it. A deck over a deck would be three
 * and nothing here would have to change but this number — the solver takes
 * the count off the field and the geometry below is written per storey — but
 * nothing builds one, and a storey nothing uses is a storey everybody pays
 * for. @see ColumnField.layers
 */
export const STOREYS = 2;

/** Whether any tile on the map carries a deck. @see syncSlots */
export function anyDeck(grid: Grid): boolean {
  for (let i = 0; i < grid.deck.length; i++) if (grid.deck[i] !== 0) return true;
  return false;
}

export function createWaterField(
  grid: Grid,
  params: FlowParams = FLOW_DEFAULTS,
): WaterField {
  const storeys = anyDeck(grid) ? STOREYS : 1;
  const field: WaterField = {
    columns: createColumnField(
      grid.w * COLUMNS_PER_TILE,
      grid.h * COLUMNS_PER_TILE,
      params,
      1 / COLUMNS_PER_TILE,
      storeys,
    ),
    storeys,
    fieldRev: 0,
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
 *
 * A DECK IS NOT GROUND, and its absence here is the whole feature rather than
 * an oversight. {@link Grid.deck} is a surface in the AIR with a gap under it;
 * the ground below is untouched, so the solver never hears about the bridge
 * and the river runs under it without anything having to say so. Lifting a
 * deck into `ground` the way a structure is lifted would dam the channel it
 * spans, which is the opposite of a bridge.
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
      if (deep <= 0) continue;
      // STRAIGHT ONTO THE GROUND, not through `pourAt`, which now sends a
      // pour to the deck where there is one. `Grid.pool` is standing water on
      // the LAND — the river in a channel, the lake in its basin — and a span
      // over it does not catch it on the way in. Routed through the pour it
      // did exactly that: a map that opened with a river under a bridge put
      // that stretch of it on top of the bridge instead. @see pourAt
      const material = grid.fluid[i] || 1;
      for (let dy = 0; dy < COLUMNS_PER_TILE; dy++) {
        for (let dx = 0; dx < COLUMNS_PER_TILE; dx++) {
          addWater(field.columns, columnOf(x) + dx, columnOf(y) + dy, deep, material);
        }
      }
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
  // A DECK ON A MAP THAT HAD NONE NEEDS A BIGGER FIELD, and a field's slot
  // count is fixed when it is made. @see WaterField.fieldRev
  if (field.columns.layers < STOREYS && anyDeck(grid)) growStoreys(field);
  const { columns } = field;
  // THE RIM'S LEVEL IS A FUNCTION OF THE GROUND UNDER IT, so it is rebuilt
  // here rather than at a call site that would have to remember. Raising the
  // land at a river's mouth raises the water the map is fed at, which is what
  // an inflow measured above its own ground means. @see syncInflow
  syncInflow(field, grid);
  // SAID ONCE, HERE, so the device does not have to be told every frame just
  // in case. @see ColumnField.groundRev
  columns.groundRev++;
  syncSlots(field, grid);
}

/**
 * Give every column its floors and its roofs, from the terrain and the decks.
 *
 * THIS IS THE WHOLE OF WHAT THE WORLD TELLS THE SOLVER ABOUT BRIDGES. There
 * is no second field, no classification of a column into one of four kinds,
 * and no rule anywhere about how a road trades water with a span. There is a
 * stack of gaps per column, and `fluid/slots` intersects them.
 *
 * Slot zero is the ground, roofed by the underside of a deck where there is
 * one and open to the sky where there is not. Slot one is the deck itself,
 * present only over a decked tile and absent — floor and roof equal, which
 * no water can be in — everywhere else.
 *
 * Every behaviour the four rules used to name comes back out of that:
 *
 *   - the road at the end of a span is an ordinary column whose only slot is
 *     level with the deck, so the two overlap and water crosses;
 *   - that same road against the CHANNEL is a slot roofed below its own
 *     floor, so nothing pours in — which is what an abutment was;
 *   - off the side of a span the neighbour is the riverbed with no roof, so
 *     the overlap starts at the deck's own floor and the water goes over and
 *     falls, which is what the falls have always done with a lip.
 */
export function syncSlots(field: WaterField, grid: Grid) {
  const { columns } = field;
  const { nx, ny, cells, layers, ground, roof } = columns;
  for (let cy = 0; cy < ny; cy++) {
    const ty = tileOf(cy);
    for (let cx = 0; cx < nx; cx++) {
      const tx = tileOf(cx);
      const i = cy * nx + cx;
      if (!inBounds(grid, tx, ty)) {
        ground[i] = 127;
        roof[i] = OPEN_SKY;
        for (let a = 1; a < layers; a++) {
          ground[a * cells + i] = 127;
          roof[a * cells + i] = 127;            // absent
        }
        continue;
      }
      const t = idx(grid, tx, ty);
      // A DECK IS NOT GROUND, and its absence from slot zero is the whole
      // feature rather than an oversight. {@link Grid.deck} is a surface in
      // the AIR with a gap under it; the ground below is untouched, so the
      // river runs under a bridge without anything having to say so.
      const floor = structureAt(grid, tx, ty) >= 0
        ? grid.height[t] + SOLID_LIFT
        : grid.height[t];
      ground[i] = floor;
      const decked = layers > 1 && grid.deck[t] !== 0;
      roof[i] = decked ? grid.deckZ[t] - DECK_DEPTH : OPEN_SKY;
      for (let a = 1; a < layers; a++) {
        const ia = a * cells + i;
        if (a === 1 && decked) {
          ground[ia] = grid.deckZ[t] + parapetAt(grid, columns, cx, cy, tx, ty);
          roof[ia] = OPEN_SKY;
        } else {
          // ABSENT: no room at all, which is a slot nothing can be in and
          // nothing can flow through. It needs no flag saying so.
          ground[ia] = floor;
          roof[ia] = floor;
        }
      }
    }
  }
}

/**
 * How far a decked column's own floor stands above the deck: a parapet.
 *
 * A bridge has parapets, and without them water poured on one runs off both
 * sides within half a second and can never stand on a span — which is the
 * thing a bridge was asked to do. It used to be a number written into a
 * second field's ground by a rule that had to work out which columns were
 * "the side" of a deck. Here it is what it is on a real bridge: the edge of
 * the deck is RAISED, and water deep enough to reach the top of it goes over
 * and falls, which needs no rule at all.
 *
 * A quarter of a tile wide, because that is what one column is. Only against
 * open air — where the road carries on at the deck's own level the surface
 * is continuous and a kerb across it would dam the crossing.
 */
function parapetAt(
  grid: Grid, columns: ColumnField, cx: number, cy: number, tx: number, ty: number,
): number {
  const z = grid.deckZ[idx(grid, tx, ty)];
  for (const [dx, dy] of EDGES) {
    const ax = cx + dx, ay = cy + dy;
    if (ax < 0 || ay < 0 || ax >= columns.nx || ay >= columns.ny) continue;
    const atx = tileOf(ax), aty = tileOf(ay);
    if (!inBounds(grid, atx, aty)) continue;
    const a = idx(grid, atx, aty);
    if (grid.deck[a] !== 0) continue;           // still the span
    // The road carrying on at the same level is not a side. Slack for
    // terracing rather than a tolerance anybody tunes: the approach either
    // end of a span is carved to the deck's own level, and at the SIDE of a
    // bridge the ground is the channel, which is nowhere near.
    if (Math.abs(grid.height[a] - z) <= LEVEL_WITH) continue;
    return DECK_KERB;
  }
  return 0;
}

/** Copy the first `n` entries across, whatever pair of typed arrays it is. */
function carry(
  to: Float32Array | Float64Array | Uint8Array | Int32Array,
  from: Float32Array | Float64Array | Uint8Array | Int32Array,
  n: number,
) {
  for (let i = 0; i < n; i++) to[i] = from[i];
}

/**
 * Rebuild the column field with room for a deck, keeping the water.
 *
 * Slot zero of the new field is slot zero of the old one, copied across, so
 * putting a bridge on a map does not empty its river. Everything else starts
 * where a new field starts.
 *
 * SLOT ZERO IS A PREFIX, which is what makes the copying this short. A
 * per-slot array indexes `a * cells + i`, so slot zero is `[0, cells)`
 * whatever `layers` is; a per-pair array indexes `(a * layers + b) * cells`,
 * so pair (0,0) is the same range; and a fall edge indexes
 * `p * cells * 2 + i * 2 + axis`, so pair zero is `[0, cells * 2)`. The old
 * field has one layer, so ALL of it is that prefix.
 *
 * AND THE WATER IN THE AIR IS WATER. Depth alone was kept here once, and the
 * result was that laying the first deck on a map deleted every waterfall
 * running on it and reset the river's momentum to nothing — a bridge dropped
 * next to a fall put the fall out. Momentum, the breaking state and the falls
 * all carry.
 *
 * WHAT IT DOES NOT KEEP is the per-step scratch — the fluxes' kicks and caps,
 * the landing accumulators, the iteration buffers — which is cleared at the
 * top of every step anyway, and the cliff index, which `stepFlow` rebuilds
 * off the ground it is about to be given. @see markCliffs
 *
 * WHAT IT CANNOT KEEP is anything a DEVICE solver is holding: the device owns
 * the water while it is attached and its buffers are the old shape. That is
 * what `fieldRev` is for — the scene tears the solver down and builds it
 * again from the field as it now stands.
 */
function growStoreys(field: WaterField) {
  const old = field.columns;
  const next = createColumnField(old.nx, old.ny, old.params, old.cell, STOREYS);
  const n = old.cells;
  // The surface. `ground` and `roof` are rewritten by the `syncSlots` that
  // follows; they are copied so the field is never briefly inconsistent.
  carry(next.ground, old.ground, n);
  carry(next.roof, old.roof, n);
  carry(next.depth, old.depth, n);
  carry(next.material, old.material, n);
  // The motion. Without these the river stops dead and starts again.
  carry(next.fx, old.fx, n);
  carry(next.fy, old.fy, n);
  carry(next.rate, old.rate, n);
  carry(next.velo, old.velo, n);
  carry(next.broke, old.broke, n);
  carry(next.breakAge, old.breakAge, n);
  next.breaking = old.breaking;
  // The water in the air, on the edges it is falling over and the columns it
  // is being thrown from. @see fallEdge
  const of = old.falls, nf = next.falls;
  for (const k of ["air", "front", "head", "frontSpeed", "headSpeed", "since", "shed"] as const) {
    carry(nf[k], of[k], n * 2);
  }
  carry(nf.throwX, of.throwX, n);
  carry(nf.throwY, of.throwY, n);
  // The spray. A drop is a position over the map rather than an index into
  // it, so the whole live list comes across unchanged; the splash marks are
  // per slot and take the prefix.
  const od = old.drips, nd = next.drips;
  for (const k of ["cx", "cy", "z", "vz", "vx", "vy", "shape", "shaken", "volume", "material"] as const) {
    carry(nd[k], od[k], od.live);
  }
  nd.live = od.live;
  for (const k of ["mcx", "mcy", "mz", "mheld", "mmaterial"] as const) carry(nd[k], od[k], od.mouths);
  nd.mouths = od.mouths;
  carry(nd.splash, od.splash, n);
  carry(nd.lit, od.lit, od.nlit);
  nd.nlit = od.nlit;
  nd.splashed = od.splashed;
  nd.spun = od.spun;
  next.t = old.t;
  next.deepest = old.deepest;
  next.box = { ...old.box };
  setOpenEdge(next, old.openEdge);
  setRim(next, old.rim, old.rimMaterial);
  for (let m = 0; m < old.dragOf.length; m++) next.dragOf[m] = old.dragOf[m];
  field.columns = next;
  field.storeys = STOREYS;
  field.fieldRev++;
}

/**
 * Tell the solver where the map is fed from beyond its edge.
 *
 * READ OFF THE COLUMN, NOT THE STEP. Two of the perimeter's steps land on each
 * corner column, and the boundary condition lets the later one win — so the
 * two must agree, and asking the column which tile it is in gives the same
 * answer whichever step asked. @see rimAt
 *
 * A map with no inflow gets NO ARRAY AT ALL rather than one full of the
 * sentinel: it is the common case by far, and it means the device has nothing
 * to upload and the host's boundary keeps the branch it had.
 */
export function syncInflow(field: WaterField, grid: Grid) {
  const { columns } = field;
  const n = rimLength(columns.nx, columns.ny);
  let rim: Float32Array | null = null;
  for (let k = 0; k < n; k++) {
    const i = rimAt(columns.nx, columns.ny, k);
    const tx = tileOf(i % columns.nx), ty = tileOf((i / columns.nx) | 0);
    if (!inBounds(grid, tx, ty)) continue;
    const t = idx(grid, tx, ty);
    const stage = grid.inflow[t];
    if (stage <= 0) continue;
    rim = rim ?? new Float32Array(n).fill(NO_INFLOW);
    rim[k] = grid.height[t] + stage;
  }
  setRim(columns, rim, WATER_MATERIAL);
}

/**
 * How near a deck's level the land beside it must be to count as the same
 * surface, in half steps.
 *
 * One slab. The road either side of a span is carved to the deck's own level,
 * so this is slack for terracing rather than a tolerance anybody tunes — at
 * the side of a bridge the ground is the channel, which is nowhere near.
 */
const LEVEL_WITH = 2;

/**
 * How far ABOVE a deck its own edge stands, in half steps: a parapet.
 *
 * It was a DROP once, and that was wrong twice over. A flat plate with its
 * edges a slab below it is a permanent downhill into a bottomless drain, so
 * water poured on a bridge ran off both sides within half a second and could
 * never accumulate on one. And a drop at a lip is what the solver spawns
 * FALLS from, so both sides of every span ran as waterfalls for as long as
 * anything was on them.
 *
 * A bridge has parapets. Below the kerb the water stays where it is put;
 * above it, it goes over the side and falls, which is both correct and still
 * possible. @see parapetAt
 */
const DECK_KERB = 2;

/**
 * How deep a deck is, in half steps: the distance from the road surface down
 * to the soffit.
 *
 * One slab, which is what a span looks like. It is the only number in the
 * world that says a bridge has a THICKNESS, and it is load bearing: the
 * underside is the roof of the channel, and the roof is what tells the
 * solver that a road at deck level does not pour into the river twenty half
 * steps below it. At nought the two would meet exactly and, by the strictly
 * greater test in `connected`, still not join — but a deck with no depth is
 * a sheet of paper, and the eye can see the span.
 */
const DECK_DEPTH = 2;

/** The four neighbours a deck's edge can be found across. */
const EDGES = [[1, 0], [-1, 0], [0, 1], [0, -1]] as const;

/**
 * Whether a tile has a deck that water can stand on. @see syncSlots
 *
 * ASKED OF THE FIELD AND NOT THE GRID, because the field is what the water
 * is in: a map may carry decks the field has no room for, in the instant
 * between a deck being placed and `syncGround` growing the field for it.
 */
export const deckedAt = (field: WaterField, x: number, y: number): boolean => {
  const { columns } = field;
  if (columns.layers < 2) return false;
  const i = columns.cells + columnOf(y) * columns.nx + columnOf(x);
  return columns.roof[i] > columns.ground[i];
};

/** The fluid an off-map inflow carries. @see fluidChoices */
const WATER_MATERIAL = 1;

/** How far above its ground a built-on cell is treated as standing. */
export const SOLID_LIFT = 64;

/** Let water off the edge of the map, or wall it in. */
export const setWaterEdge = (field: WaterField, open: boolean) =>
  setOpenEdge(field.columns, open);

/** Whether water can leave the map at its edge. */
export const waterEdgeIsOpen = (field: WaterField) => field.columns.openEdge;

/** Advance the flow. */
export function stepWater(field: WaterField, dt: number) {
  stepFlow(field.columns, dt);
}

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
  // ON THE DECK WHERE THERE IS ONE, which is the answer to "I clicked the
  // bridge and the water went somewhere else". The pick resolves to the
  // surface you can see — a span, if one is over this cell — and an edit has
  // to act on the surface the pick named. It did not: every tool wrote the
  // terrain, so a pour aimed at a bridge landed on the riverbed twenty half
  // steps below it, out of sight under its own span. @see deckedAt
  const { columns } = field;
  const slot = deckedAt(field, x, y) ? 1 : 0;
  const cx0 = columnOf(x),
    cy0 = columnOf(y);
  for (let dy = 0; dy < COLUMNS_PER_TILE; dy++) {
    for (let dx = 0; dx < COLUMNS_PER_TILE; dx++) {
      addWater(columns, cx0 + dx, cy0 + dy, amount, material, slot);
    }
  }
}

/**
 * Take water off the columns of a tile. `Infinity` empties it.
 *
 * ON THE DECK WHERE THERE IS ONE, for the same reason `pourAt` is and by the
 * same test: a drain acts on the surface the pick named. It did not, so a
 * drain dragged across a bridge emptied the CHANNEL twenty half steps under
 * it — out of sight — and left the puddle on the span it was aimed at
 * exactly where it was. @see pourAt, deckedAt
 */
export function drainAt(
  field: WaterField,
  x: number,
  y: number,
  amount: number,
) {
  const { columns } = field;
  const slot = deckedAt(field, x, y) ? 1 : 0;
  const cx0 = columnOf(x),
    cy0 = columnOf(y);
  for (let dy = 0; dy < COLUMNS_PER_TILE; dy++) {
    for (let dx = 0; dx < COLUMNS_PER_TILE; dx++) {
      addWater(columns, cx0 + dx, cy0 + dy, -amount, 0, slot);
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
  // EVERY STOREY, which `totalWater` does on its own now: a depth array is
  // as long as the field has slots, and water standing on a bridge is at an
  // index further down the same array. It used to be a second field and a
  // second term here.
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
