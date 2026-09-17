/**
 * World v2 — pipes, and the water standing in them.
 *
 * A pipe is a cell plus a FACING. It hangs at the top of that face and opens
 * over whatever is beyond it, which is why the facing matters and a spring's
 * does not: a spring wells up out of the ground it is on, a pipe sticks out of
 * a wall and the side it sticks out of is the whole point.
 *
 * PIPES THAT TOUCH ARE ONE PIPE. That is the whole of the network model —
 * adjacency, the same rule roads use, so a run you paint is a run that
 * carries. A network HOLDS water, and the cells of one network share a LEVEL:
 * connected vessels, equalised every step. That is a quasi-steady assumption
 * and it is worth naming, because it is the one thing here that is a
 * simplification rather than a model. It says water inside a pipe rearranges
 * itself much faster than the water outside does, which is true — the wave
 * speed in a conduit is far above a pond's — and it is what a 1-D Saint-Venant
 * pipe gives you in that limit. What it costs is SLOSHING: a level that
 * equalises instantly cannot slosh, and nothing here will until the level is
 * allowed to vary along the pipe.
 *
 * The water is held PER CELL, which is what makes editing safe. Networks merge
 * when you join two runs and split when you cut one, and a volume booked
 * against a network would have to be divided on every split and summed on
 * every merge — bookkeeping with no right answer, since nothing records which
 * half the water was in. Held per cell there is no question to ask: cut a run
 * and each side keeps what was standing in it.
 *
 * EVERY OPENING IS THE SAME THING. There is no inlet here and no outlet, and
 * no direction of flow written down anywhere. A port compares the level inside
 * the pipe with the surface of whatever is outside and moves water down the
 * difference — Torricelli, through an orifice. Everything anyone wants from a
 * drain falls out of that one signed number:
 *
 *   - an end under a pool DRAWS, because the pool stands above the pipe;
 *   - an end in the air DISCHARGES, through the same mouth the drips already
 *     come out of, so it drips and splashes and foams exactly as before;
 *   - an end whose pool rises above the pipe's own level REVERSES, and the
 *     network BACKS UP — which a fixed rate can never do, and which is most of
 *     the reason to have done this at all.
 *
 * What is NOT here: the level does not vary along a pipe, so there is no
 * sloshing and no travel time, and a full pipe stops accepting rather than
 * going under pressure — pressurised flow is a different regime and wants a
 * Preissmann slot to stay one code path. Both are the next stage.
 *
 * The dripping itself is `fluid/drips` and everything interesting about it is
 * there. This file knows about tiles: which column a mouth hangs over, how
 * high it is, which way to point a pipe when it is placed, and how much water
 * crosses each opening this step.
 */
import { FALL_GRAVITY } from "../../fluid/falls";
import { addWater, surfaceAt, type ColumnField } from "../../fluid/columns";
import { DIR, NEIGHBOUR } from "../../iso/dir";
import { heightAt, inBounds, idx, type Grid } from "../grid";
import { resetMouths, runMouth } from "../../fluid/drips";
import { COLUMNS_PER_TILE, columnOf, type WaterField } from "./field";
import { findPipeNets } from "./pipe-net";
import {
  PIPE_HEAD, PIPE_D, invertOf, pipeDepth, pipeTop, pipeVolume,
  spillOrphaned, stepPipeFlow,
} from "./pipe-flow";

/** The four facings a pipe can have, in the order a cycle should visit them. */
export const PIPE_FACINGS = [DIR.S, DIR.W, DIR.N, DIR.E] as const;

// The bore's shape, how much it holds and how the water in it moves are all
// `pipe-flow`, which is where the hydraulics live. Re-exported because this is
// the file everything else asks about pipes.
export { PIPE_D, PIPE_FULL, PIPE_HEAD, pipeDepth, pipeLevel, pipeVolume } from "./pipe-flow";

/**
 * The opening at a port: how big the hole is, in column areas, and how much of
 * an ideal jet gets through it.
 *
 * `Cd` for a sharp-edged orifice is about 0.62, and that is not a tuning knob
 * — it is the vena contracta, the jet necking down past the hole to about that
 * fraction of its area, and it has measured the same since the eighteenth
 * century.
 */
export const PIPE_PORT = 0.5;
const PIPE_CD = 0.62;

/**
 * How many bites a port takes at the water in one frame.
 *
 * Because a surcharged port is STIFF. Past the crown the surface is a
 * hairline, so a very small volume is a very large change in level, and the
 * cap below — which stops a port moving more than would level the two sides —
 * ends up allowing far less than the flow the head calls for. Measured, a pipe
 * fed at one unit a second and discharging into a pond it was drawing from sat
 * a whole half step above that pond's surface, because a whole half step of
 * head was what it took to get a unit a second past the cap.
 *
 * Taking the same frame in several bites relaxes it several times over, which
 * is the cheap version of solving the port implicitly. Six brings that error
 * down to about a seventh of a half step, which is under the resolution of
 * anything that looks at it.
 */
const PORT_BITES = 6;

/**
 * How far towards level one step may go, as a fraction.
 *
 * A port moves water down a head, and moving more than the head is worth
 * OVERSHOOTS: the pipe ends up above the pool it was draining, so next step it
 * drains backwards, and the two ring against each other at the frame rate.
 * Capped at half of what would equalise them, the exchange approaches level
 * rather than crossing it. The orifice is almost always the binding limit and
 * this almost never is — it is the guard for a hair of water over a deep
 * network, where the ideal jet would empty the pool in one frame.
 */
const SETTLE = 0.5;

const FACING_OF: Record<number, keyof typeof DIR> = {
  [DIR.N]: "N", [DIR.E]: "E", [DIR.S]: "S", [DIR.W]: "W",
};

/**
 * Which column a pipe's mouth hangs over, and how high.
 *
 * Just BEYOND the face, over the neighbour's own edge column, because that is
 * where something sticking out of a wall is. Where there is no neighbour — a
 * pipe on the rim of the map — it opens over its own edge column instead,
 * which is the honest answer for a mouth pointing at nothing.
 *
 * `z` is the opening AND the pipe's invert — the pipe's OWN level, which is
 * not the ground's. A run laid across a rise keeps its grade and goes under
 * the rise, and its openings go under with it, which is what {@link isSealed}
 * is for: a hole in the side of a buried pipe opens onto rock.
 */
export function pipeMouth(grid: Grid, x: number, y: number, facing: number) {
  const name = FACING_OF[facing];
  if (!name) return null;
  const [dx, dy] = NEIGHBOUR[name];
  const out = inBounds(grid, x + dx, y + dy);
  const tx = out ? x + dx : x, ty = out ? y + dy : y;
  const last = COLUMNS_PER_TILE - 1;
  // The neighbour's edge column nearest the face, or our own if we are it.
  const near = (d: number, t: number) =>
    columnOf(t) + (out ? (d > 0 ? 0 : d < 0 ? last : Math.floor(last / 2))
      : (d > 0 ? last : d < 0 ? 0 : Math.floor(last / 2)));
  return { cx: near(dx, tx), cy: near(dy, ty), z: grid.pipeZ[idx(grid, x, y)] };
}

/** Whether the cell across this face carries a pipe. */
export function pipeAcross(grid: Grid, x: number, y: number, facing: number): boolean {
  const name = FACING_OF[facing];
  if (!name) return false;
  const [dx, dy] = NEIGHBOUR[name];
  return inBounds(grid, x + dx, y + dy) && grid.pipe[idx(grid, x + dx, y + dy)] !== 0;
}

/** Whether this cell's facing opens on the world rather than into the run. */
export const isPort = (grid: Grid, x: number, y: number): boolean => {
  const facing = grid.pipe[idx(grid, x, y)];
  return facing !== 0 && !pipeAcross(grid, x, y, facing);
};

/**
 * Whether a port's opening is buried, and so no opening at all.
 *
 * A hole in the side of a pipe only lets water through if there is somewhere
 * for the water to be. Under a hillside there is not: the mouth is in rock,
 * and rock is not a thing a pipe can discharge into or draw from. So a port
 * whose mouth sits below the ground it opens onto is SEALED, and reads exactly
 * like a capped end.
 *
 * This is the rule that makes a buried run behave like a buried run. Its
 * openings are wherever it comes back up to daylight — its inlet and its
 * outfall — and everywhere in between it is a closed conduit, which is the
 * whole reason for burying anything.
 */
export const isSealed = (columns: ColumnField, cx: number, cy: number, z: number) =>
  columns.ground[cy * columns.nx + cx] > z;

/**
 * Which way a pipe placed here should point.
 *
 * At the lowest neighbour that is not ALREADY PIPE, which is the side it would
 * actually open onto. Two rules in one and both are about not doing what
 * nobody means to do: a pipe pointing into a hillside does not drip, and a
 * pipe pointing into the run it has just been added to is a capped end — a
 * thing you may well want, and never the thing you want by default.
 *
 * Ties go to the first facing in {@link PIPE_FACINGS}, which is why that list
 * starts with the faces you can SEE: on flat ground every side ties, and N and
 * E point away from the camera, so defaulting to either puts the pipe behind
 * its own tile.
 *
 * Whatever this picks, clicking the cell again turns it — including round to a
 * facing that points into the network, which is how an end gets capped.
 */
export function facingFor(grid: Grid, x: number, y: number): number {
  let best: number = PIPE_FACINGS[0];
  let lowest = Infinity;
  let free = false;
  for (const facing of PIPE_FACINGS) {
    const [dx, dy] = NEIGHBOUR[FACING_OF[facing]];
    const at = heightAt(grid, x + dx, y + dy) ?? Infinity;   // off-map is no choice
    const open = !pipeAcross(grid, x, y, facing);
    // An open side beats a lower one outright: the first open side found takes
    // over from whatever closed side was winning, and from then on only open
    // sides are compared with each other.
    if (open && !free) { free = true; lowest = at; best = facing; continue; }
    if (open === free && at < lowest) { lowest = at; best = facing; }
  }
  return best;
}

/**
 * What level a new length of pipe should be laid at.
 *
 * The grade of whatever it is joining, or the ground where it is joining
 * nothing — and never above the ground, so a run follows the ground down and
 * daylights rather than sailing off into the air. Where two runs at different
 * levels meet it takes the LOWER, because that is the one the water is going
 * to.
 *
 * That one rule is the whole of laying a buried main. A run lies on the ground
 * while the ground behaves, burrows under anything that rises in front of it,
 * and comes back up to daylight wherever the ground falls away — with nothing
 * to set and nothing to choose, which is the only version of this that
 * survives being drawn with a mouse.
 */
export function pipeGrade(grid: Grid, x: number, y: number): number {
  let z = heightAt(grid, x, y) ?? 0;
  for (const facing of PIPE_FACINGS) {
    const [dx, dy] = NEIGHBOUR[FACING_OF[facing]];
    if (!inBounds(grid, x + dx, y + dy)) continue;
    const j = idx(grid, x + dx, y + dy);
    if (grid.pipe[j] && grid.pipeZ[j] < z) z = grid.pipeZ[j];
  }
  return z;
}

/**
 * Lay a length of pipe: the facing, and the level that goes with it.
 *
 * One call, because a pipe without an invert is a pipe lying on the map's
 * floor, and setting the two separately is a thing that gets forgotten.
 */
export function layPipe(grid: Grid, x: number, y: number, facing: number, z?: number): void {
  if (!inBounds(grid, x, y)) return;
  const i = idx(grid, x, y);
  grid.pipe[i] = facing;
  grid.pipeZ[i] = z ?? pipeGrade(grid, x, y);
}

/**
 * Run every pipe on the map for `dt`.
 *
 * Alongside `runSources` and for the same reason: both are taps the map
 * carries rather than water the simulation is holding, and both have to be
 * given their moment before the solver takes its step.
 */
export function runPipes(field: WaterField, grid: Grid, dt: number): void {
  const { columns } = field;
  // The hanging drops are a VIEW of the mouths, rebuilt every frame, so the
  // list starts empty and every mouth that runs puts itself back on it.
  resetMouths(columns.drips);
  const nets = findPipeNets(grid, field.nets);
  const { cells, at } = nets;

  for (let net = 0; net < nets.count; net++) {
    const from = at[net], to = at[net + 1];
    // The water moves ALONG the run under its own momentum before anything at
    // the ends is looked at, so what a port sees is a level that has already
    // had this step's travel in it.
    stepPipeFlow(field, grid, cells, from, to, dt);

    for (let k = from; k < to; k++) {
      const i = cells[k];
      const facing = grid.pipe[i];
      const x = i % grid.w, y = (i / grid.w) | 0;
      // A port is an opening, and an opening is a facing with no pipe across
      // it. Turn a facing into the run beside it and that end is capped.
      if (!facing || pipeAcross(grid, x, y, facing)) continue;
      const mouth = pipeMouth(grid, x, y, facing);
      if (!mouth) continue;

      const j = mouth.cy * columns.nx + mouth.cx;
      // A mouth under the ground opens onto rock, and rock is not something to
      // draw from or discharge into. Sealed, it reads as a capped end — which
      // is what the middle of a buried run IS.
      if (isSealed(columns, mouth.cx, mouth.cy, mouth.z)) continue;
      // The sill is this cell's own invert, which is where the hole is, so the
      // water inside is already measured from it. Outside is measured from the
      // same place — what is below the hole presses on nothing, and without
      // that a dry pipe on a clifftop would be driven by the whole valley.
      const sill = mouth.z;
      const bite = dt / PORT_BITES;
      let air = 0;                                // what left into open air
      let drowned = false;

      for (let b = 0; b < PORT_BITES; b++) {
        const inside = sill + pipeDepth(field.pipe[i]);
        const outside = surfaceAt(columns, j);
        const beyond = outside > sill ? outside : sill;
        const head = inside - beyond;
        if (head === 0) continue;

        // Torricelli through an orifice — the same free-fall velocity a drop
        // leaving this mouth would reach over the same drop, under the same
        // gravity, for the same reason.
        let move = PIPE_CD * PIPE_PORT * Math.sqrt(2 * FALL_GRAVITY * Math.abs(head)) * bite;
        // Never past level. Moving `move` raises one column by `move` and
        // drops this cell by `move / top`, where the top is how much volume a
        // half step of level costs HERE — which collapses towards the slot as
        // the pipe fills, so a nearly full pipe is moved a long way by very
        // little, and this is the cap that matters.
        const top = pipeTop(field.pipe[i]);
        const equalise = (Math.abs(head) / (1 + 1 / top)) * SETTLE;
        if (move > equalise) move = equalise;

        if (head > 0) {
          if (move > field.pipe[i]) move = field.pipe[i];
          if (move <= 0) continue;
          field.pipe[i] -= move;
          if (beyond > sill) {
            // Submerged: the mouth is under water, so there is nothing to drip
            // and whatever drop it had grown simply joins what it is under.
            addWater(columns, mouth.cx, mouth.cy, move, grid.fluid[i] || 1);
            drowned = true;
          } else {
            air += move;
          }
        } else {
          // In, and never more than is out there or than there is room for.
          // Past full there is still the slot, so a port can go on taking
          // water — it just costs an ever steeper level to do it, which IS the
          // pipe going under pressure. What stops it is the head, not a wall.
          const there = columns.depth[j];
          if (move > there) move = there;
          const room = pipeVolume(PIPE_D + PIPE_HEAD) - field.pipe[i];
          if (move > room) move = room;
          if (move <= 0) continue;
          field.pipe[i] += move;
          addWater(columns, mouth.cx, mouth.cy, -move);
        }
      }

      if (drowned && air === 0) {
        // A mouth under water has nothing to drip, and the drop it had grown
        // simply joins what it is under.
        if (field.held[i] > 0) {
          addWater(columns, mouth.cx, mouth.cy, field.held[i], grid.fluid[i] || 1);
          field.held[i] = 0;
        }
        continue;
      }

      // Every port in the air runs its mouth ONCE, whether or not anything
      // came out of it — a mouth that is not run is a mouth the renderer
      // cannot see, and the drop hanging at it would blink out the moment the
      // pipe stopped pushing.
      const pending = { held: field.held[i] };
      runMouth(
        columns.drips, pending, air / dt, dt,
        mouth.cx, mouth.cy, sill, grid.fluid[i] || 1,
      );
      field.held[i] = pending.held;
    }

  }
  // Anything left standing in a cell that is no longer pipe goes back on the
  // ground it was lying on. Deleting a run has to put its water somewhere.
  spillOrphaned(field, grid);
}

/** Where the water in one cell of pipe stands, in half steps. For readouts. */
export const pipeLevelAt = (grid: Grid, field: WaterField, x: number, y: number) =>
  invertOf(grid, idx(grid, x, y)) + pipeDepth(field.pipe[idx(grid, x, y)]);
