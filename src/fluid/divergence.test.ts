/**
 * The divergence as a SCATTER and as a GATHER, held together.
 *
 * The CPU scatters: each cell pushes its two moves into its neighbours. A
 * device cannot do that without either atomics or a proof that no two threads
 * write the same word — and the proof exists, because a cell's `delta` is
 * touched by exactly three others and every one of those is one of its own
 * incident edges. So the device gathers instead, and these are what say the
 * two are the same program.
 *
 * BIT-IDENTICAL, not close — between these two, both of which compute a move
 * in double. That is a claim about the SHAPE and not about the arithmetic, and
 * the distinction matters: against the device it is one f32 ULP like every
 * other pass, because the device rounds `fx[i] * spread` and JavaScript does
 * not. What this buys is that when the device disagrees, turning the loop
 * round is not among the suspects.
 *
 * Two things make it hold, and both are pinned below because both are easy to
 * lose:
 *
 *  - THE ORDER. Addition does not associate in floating point. `delta[i]` is
 *    accumulated as the row above's southward move, then the cell before's
 *    eastward one, then this cell's own two subtractions, and a gather has to
 *    add them in that order.
 *  - THE ROUNDING. `delta` is a `Float32Array`, so the scatter rounds on every
 *    accumulation. A gather that sums in double and stores once is a different
 *    number — measured, 1371 cells of 2976. The device rounds every operation
 *    anyway; it is JavaScript that has to be told.
 */
import { describe, expect, test } from "bun:test";

import {
  FLOW_DEFAULTS, activeBox, addWater, at, createColumnField, divergence,
  stepFlow, type ColumnField, type PassConsts,
} from "./columns";
import { dropAt } from "./falls";

function scene(wind = FLOW_DEFAULTS.wind): ColumnField {
  const f = createColumnField(64, 48, { ...FLOW_DEFAULTS, wind }, 0.5);
  for (let y = 0; y < 48; y++) {
    for (let x = 0; x < 64; x++) {
      // A cliff on BOTH the east and the south side, so edges divert into the
      // air on both axes, and a lumpy bed so the moves are not all one sign.
      //
      // One cliff is not enough, and that is not a guess: with only an
      // east-facing one, deleting the gather's southward diversion test
      // changed nothing and every test here still passed. Half the pass was
      // not being run.
      f.ground[at(f, x, y)] = x > 48 || y > 38 ? -16 : ((x * 7 + y * 5) % 7) - 3;
    }
  }
  for (let y = 4; y < 44; y++) for (let x = 4; x < 44; x++) addWater(f, x, y, 6, 1);
  for (let n = 0; n < 120; n++) stepFlow(f, 1 / 60);
  return f;
}

const constsFor = (f: ColumnField, dt = 1 / 60): PassConsts => {
  const r = activeBox(f)!;
  const p = f.params;
  return {
    x0: r.x0, y0: r.y0, x1: r.x1, y1: r.y1,
    gain: p.gravity * dt / f.cell,
    bedGain: p.bedDrag * dt,
    hMax: (f.cell / p.maxDt) ** 2 / (2 * p.gravity),
    minHead: p.minSlope * f.cell,
    spread: dt / f.cell,
    dt,
  };
};

/**
 * What the device does: every cell sums its own four incident edges.
 *
 * This is the REFERENCE THE WGSL IS TRANSCRIBED FROM, which is why it lives
 * here in full rather than being described. `round` is what the device does
 * for nothing and JavaScript has to be asked for; passing the identity instead
 * is how the test below shows the rounding is load-bearing.
 */
function gather(
  f: ColumnField, c: PassConsts, round: (v: number) => number = Math.fround,
) {
  const { x0: X0, y0: Y0, x1: X1, y1: Y1, spread } = c;
  const { nx, ny, fx, fy, delta } = f;
  const air = f.falls.air;
  for (let y = Y0; y <= Y1; y++) {
    for (let x = X0; x <= X1; x++) {
      const i = y * nx + x;
      let d = 0;
      // The row above's southward move, if that row was walked at all.
      if (y - 1 >= Y0) {
        const move = fy[i - nx] * spread;
        if (!(move > 0 && dropAt(f, i - nx, 1) > 0)) d = round(d + move);
      }
      // The cell before's eastward one.
      if (x - 1 >= X0) {
        const move = fx[i - 1] * spread;
        if (!(move > 0 && dropAt(f, i - 1, 0) > 0)) d = round(d + move);
      }
      // And its own two, which leave whether or not they go into the air.
      if (x + 1 < nx) d = round(d - fx[i] * spread);
      if (y + 1 < ny) d = round(d - fy[i] * spread);
      delta[i] = d;

      // An edge belongs to one cell, so this is the same write either way.
      if (x + 1 < nx) {
        const move = fx[i] * spread;
        if (move > 0 && dropAt(f, i, 0) > 0) air[i * 2] += move;
      }
      if (y + 1 < ny) {
        const move = fy[i] * spread;
        if (move > 0 && dropAt(f, i, 1) > 0) air[i * 2 + 1] += move;
      }
    }
  }
}

/** How many cells, and how far, two fields' deltas differ over a box. */
function diff(a: ColumnField, b: ColumnField, c: PassConsts) {
  let cells = 0, worst = 0;
  for (let y = c.y0; y <= c.y1; y++) {
    for (let x = c.x0; x <= c.x1; x++) {
      const i = y * a.nx + x;
      const d = Math.abs(a.delta[i] - b.delta[i]);
      if (d !== 0) { cells++; if (d > worst) worst = d; }
    }
  }
  return { cells, worst };
}

describe("the divergence gathers as exactly as it scatters", () => {
  for (const wind of [0, FLOW_DEFAULTS.wind]) {
    test(`bit for bit, wind ${wind}`, () => {
      const a = scene(wind), b = scene(wind);
      const c = constsFor(a);
      divergence(a, c);
      gather(b, c);
      expect(diff(a, b, c)).toEqual({ cells: 0, worst: 0 });
    });
  }

  test("and the water going over a lip lands on the same edges", () => {
    // `air` is per edge and an edge has one owner, so there is no scatter here
    // at all — which is worth a test, because it is the reason pass 3 needs no
    // atomic and the reason is not obvious from the loop.
    const a = scene(), b = scene();
    const c = constsFor(a);
    divergence(a, c);
    gather(b, c);
    let differ = 0, any = 0;
    for (let k = 0; k < a.falls.air.length; k++) {
      if (a.falls.air[k] !== b.falls.air[k]) differ++;
      if (a.falls.air[k] > 0) any++;
    }
    expect(differ).toBe(0);
    expect(any).toBeGreaterThan(0);              // and some water really did go over
  });

  test("summing in double and storing once is NOT the same number", () => {
    // The trap, and the reason `round` is an argument. It looks like a
    // simplification — one store instead of four — and it silently changes the
    // answer in a third of the cells, by one f32 ULP each. On the device this
    // is free and automatic; here it has to be asked for, and someone tidying
    // this up later will want to know why it is written the long way.
    const a = scene(), b = scene();
    const c = constsFor(a);
    divergence(a, c);
    gather(b, c, (v) => v);                      // no rounding between steps
    const d = diff(a, b, c);
    expect(d.cells).toBeGreaterThan(100);
    // And only ever by a rounding step, which is what says the SHAPE is still
    // right and it is the arithmetic that drifted.
    expect(d.worst).toBeLessThan(1e-6);
  });

  test("and so is adding them in a different order", () => {
    // The other half. Same four numbers, same rounding, wrong sequence.
    const a = scene(), b = scene();
    const c = constsFor(a);
    divergence(a, c);
    const { nx, ny, fx, fy, delta } = b;
    for (let y = c.y0; y <= c.y1; y++) {
      for (let x = c.x0; x <= c.x1; x++) {
        const i = y * nx + x;
        let d = 0;
        // Own outflows first, inflows after — the obvious way to write it.
        if (x + 1 < nx) d = Math.fround(d - fx[i] * c.spread);
        if (y + 1 < ny) d = Math.fround(d - fy[i] * c.spread);
        if (y - 1 >= c.y0) {
          const move = fy[i - nx] * c.spread;
          if (!(move > 0 && dropAt(b, i - nx, 1) > 0)) d = Math.fround(d + move);
        }
        if (x - 1 >= c.x0) {
          const move = fx[i - 1] * c.spread;
          if (!(move > 0 && dropAt(b, i - 1, 0) > 0)) d = Math.fround(d + move);
        }
        delta[i] = d;
      }
    }
    expect(diff(a, b, c).cells).toBeGreaterThan(100);
  });
});
