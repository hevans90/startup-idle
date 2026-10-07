/**
 * World v2 — boats: where they are, and what the water under them is doing.
 *
 * A boat is LIVE state, like the water it floats on: placed with a tool, not
 * an edit, and not undoable. It reads the surface the mesh draws — the mean of
 * the wet columns round it, the same thing a corner of the water is — so it
 * sits on the water you can see rather than on a number the solver keeps.
 *
 * BOBBING is a spring and a damper on that surface: the boat is pulled toward
 * the water's height and carries a little momentum, so a wave lifts it a
 * moment late and lets it settle with an overshoot, which is what reads as
 * floating rather than as being glued to the sheet. It PITCHES and ROLLS with
 * the surface's slope along and across its heading.
 *
 * It DRIFTS down the surface's slope — water stands sloped where it is
 * flowing, so a river carries it and a lake that is sloshing rocks it back
 * and forth — against a drag, and stops where the water is too shallow to
 * float in. There is no wind on it and it does not push the water: it is a
 * passenger.
 *
 * On the device the host's depths are refreshed a slice at a time, so every
 * boat asks for the columns it reads, every frame, the way a falling drop
 * does. @see wantFleet, wantDepth
 */
import { wantDepth, type ColumnField } from "../../fluid/columns";
import { COLUMNS_PER_TILE } from "../water/field";

export type Boat = {
  id: number;
  /** Where its middle is, in tile coordinates — a tile's centre is an integer. */
  x: number;
  y: number;
  /** Tiles a second. */
  vx: number;
  vy: number;
  /** Which way the bow points, in radians in the tile plane (atan2 of y, x). */
  heading: number;
  /** The height its waterline is at, in half steps, and how fast that moves. */
  z: number;
  vz: number;
  /** Slope it is riding, along and across its heading, half steps a tile. */
  pitch: number;
  roll: number;
  /** Whether there is water enough under it to float. */
  afloat: boolean;
  /** A phase of its own, so a harbour full of them does not bob in step. */
  phase: number;
};

export type Fleet = { boats: Boat[]; next: number; t: number };

/** How deep the water has to be for a boat to float, in half steps. */
export const DRAFT = 0.5;
/** How long, and how wide, in tiles. @see boats-render */
export const BOAT_LENGTH = 0.84;
export const BOAT_BEAM = 0.36;

/** The spring that holds a boat to the surface, a second squared, and its damper. */
const BOB_STIFF = 70;
const BOB_DAMP = 7;
/** A bob of its own on still water, in half steps, and how fast. */
const IDLE_BOB = 0.06;
const IDLE_RATE = 1.7;
/** How hard a sloped surface pushes it, tiles a second squared per half step a tile. */
const SLOPE_PUSH = 2.4;
/** And how fast it slows, a second. */
const DRAG = 1.1;
/** The fastest it drifts, tiles a second. */
const MAX_SPEED = 1.4;
/** How fast it turns to face its drift, radians a second. */
const TURN = 1.8;
/** Two boats closer than this push apart. */
const KEEP_APART = 0.62;

export const createFleet = (): Fleet => ({ boats: [], next: 1, t: 0 });

/** The water a boat reads, at a point in tile coordinates. */
export type Sample = { surface: number; depth: number; ground: number; wet: boolean };

/** Column coordinates of a point in tile coordinates: a tile is four columns. */
const toColumns = (t: number) => (t + 0.5) * COLUMNS_PER_TILE - 0.5;

/**
 * The surface at a point, the way the mesh draws it: the wet columns of the
 * four round it, weighted by how near, and their ground where none is wet.
 * In storey nought — the water a boat could be on, under a bridge or not.
 */
export function sampleWater(c: ColumnField, x: number, y: number): Sample {
  const fx = toColumns(x), fy = toColumns(y);
  const x0 = Math.floor(fx), y0 = Math.floor(fy);
  const tx = fx - x0, ty = fy - y0;
  const dry = c.params.dryDepth;
  let sw = 0, ss = 0, sd = 0, gw = 0, gs = 0;
  for (let j = 0; j < 2; j++) {
    for (let k = 0; k < 2; k++) {
      const cx = Math.min(c.nx - 1, Math.max(0, x0 + k));
      const cy = Math.min(c.ny - 1, Math.max(0, y0 + j));
      const w = (k ? tx : 1 - tx) * (j ? ty : 1 - ty);
      const i = cy * c.nx + cx;
      const d = c.depth[i], g = c.ground[i];
      gw += w; gs += w * g;
      if (d > dry) { sw += w; ss += w * (g + d); sd += w * d; }
    }
  }
  if (sw <= 1e-6) {
    const ground = gw > 0 ? gs / gw : 0;
    return { surface: ground, depth: 0, ground, wet: false };
  }
  return { surface: ss / sw, depth: sd / sw, ground: gw > 0 ? gs / gw : 0, wet: true };
}

/** Whether a boat could float with its middle here. */
const floats = (c: ColumnField, x: number, y: number) => {
  if (x < -0.5 || y < -0.5 || x > c.nx / COLUMNS_PER_TILE - 0.5 || y > c.ny / COLUMNS_PER_TILE - 0.5) {
    return false;
  }
  return sampleWater(c, x, y).depth > DRAFT;
};

/** Put a boat on the water at tile (x, y), if there is water enough there. */
export function addBoat(f: Fleet, c: ColumnField, x: number, y: number): Boat | null {
  if (!floats(c, x, y)) return null;
  const s = sampleWater(c, x, y);
  const boat: Boat = {
    id: f.next++, x, y, vx: 0, vy: 0,
    // Facing down the screen and to the right, the way the art faces.
    heading: Math.PI / 4,
    z: s.surface, vz: 0, pitch: 0, roll: 0, afloat: true,
    phase: (f.next * 2.399) % (Math.PI * 2),
  };
  f.boats.push(boat);
  return boat;
}

/** Take away the boat nearest (x, y) within `r` tiles. Whether one went. */
export function removeBoatNear(f: Fleet, x: number, y: number, r = 0.6): boolean {
  let best = -1, bestD = r * r;
  for (let k = 0; k < f.boats.length; k++) {
    const b = f.boats[k];
    const d = (b.x - x) ** 2 + (b.y - y) ** 2;
    if (d <= bestD) { best = k; bestD = d; }
  }
  if (best < 0) return false;
  f.boats.splice(best, 1);
  return true;
}

/**
 * Ask for every column the boats will read next frame: a four by four block
 * round each, which covers the sample and the slope either side of it.
 * A no-op on the CPU path. @see wantDepth
 */
export function wantFleet(f: Fleet, c: ColumnField): void {
  for (const b of f.boats) {
    const x0 = Math.floor(toColumns(b.x)) - 1, y0 = Math.floor(toColumns(b.y)) - 1;
    for (let j = 0; j < 4; j++) {
      for (let k = 0; k < 4; k++) {
        const cx = x0 + k, cy = y0 + j;
        if (cx < 0 || cy < 0 || cx >= c.nx || cy >= c.ny) continue;
        wantDepth(c, cy * c.nx + cx);
      }
    }
  }
}

/** One frame of every boat: bob, tilt, drift, turn. */
export function stepFleet(f: Fleet, c: ColumnField, dt: number): void {
  if (dt <= 0) return;
  const h = Math.min(dt, 1 / 20);       // a long frame is not a launch
  f.t += h;
  // ONE COLUMN EITHER SIDE, for the slope: a quarter of a tile.
  const e = 1 / COLUMNS_PER_TILE;
  for (const b of f.boats) {
    const s = sampleWater(c, b.x, b.y);
    b.afloat = s.depth > DRAFT;
    const sx = (sampleWater(c, b.x + e, b.y).surface - sampleWater(c, b.x - e, b.y).surface) / (2 * e);
    const sy = (sampleWater(c, b.x, b.y + e).surface - sampleWater(c, b.x, b.y - e).surface) / (2 * e);

    // BOB: a spring to the surface, and a little of its own on still water.
    const target = b.afloat
      ? s.surface + IDLE_BOB * Math.sin(f.t * IDLE_RATE * Math.PI * 2 + b.phase)
      : s.ground;
    b.vz += (BOB_STIFF * (target - b.z) - BOB_DAMP * b.vz) * h;
    b.z += b.vz * h;
    // Never under the ground it is sitting on.
    if (b.z < s.ground) { b.z = s.ground; b.vz = 0; }

    // TILT: the slope along the bow and across the beam, eased in.
    const ch = Math.cos(b.heading), sh = Math.sin(b.heading);
    const along = b.afloat ? sx * ch + sy * sh : 0;
    const across = b.afloat ? -sx * sh + sy * ch : 0;
    const ease = 1 - Math.exp(-h * 6);
    b.pitch += (along - b.pitch) * ease;
    b.roll += (across - b.roll) * ease;

    // DRIFT down the surface, against a drag. Aground, it does not move.
    if (b.afloat) {
      b.vx += (-SLOPE_PUSH * sx - DRAG * b.vx) * h;
      b.vy += (-SLOPE_PUSH * sy - DRAG * b.vy) * h;
    } else {
      b.vx = 0; b.vy = 0;
    }
    const speed = Math.hypot(b.vx, b.vy);
    if (speed > MAX_SPEED) { b.vx *= MAX_SPEED / speed; b.vy *= MAX_SPEED / speed; }
  }

  // KEEP APART: two boats closer than their own size push each other off.
  for (let i = 0; i < f.boats.length; i++) {
    for (let j = i + 1; j < f.boats.length; j++) {
      const a = f.boats[i], o = f.boats[j];
      const dx = o.x - a.x, dy = o.y - a.y;
      const d = Math.hypot(dx, dy);
      if (d >= KEEP_APART || d < 1e-6) continue;
      const push = (KEEP_APART - d) * 2;
      const ux = dx / d, uy = dy / d;
      a.vx -= ux * push; a.vy -= uy * push;
      o.vx += ux * push; o.vy += uy * push;
    }
  }

  for (const b of f.boats) {
    // MOVE, an axis at a time, and not into water too shallow to float in:
    // a boat drifting onto a shore slides along it rather than stopping dead.
    const nx = b.x + b.vx * h;
    if (floats(c, nx, b.y)) b.x = nx; else b.vx = 0;
    const ny = b.y + b.vy * h;
    if (floats(c, b.x, ny)) b.y = ny; else b.vy = 0;

    // TURN to face the drift, at a boat's pace and not at once.
    const speed = Math.hypot(b.vx, b.vy);
    if (speed > 0.05) {
      let d = Math.atan2(b.vy, b.vx) - b.heading;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      const turn = Math.sign(d) * Math.min(Math.abs(d), TURN * h * Math.min(1, speed / 0.3));
      b.heading += turn;
    }
  }
}
