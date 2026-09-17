/**
 * Water moving along a pipe.
 *
 * The questions worth asking here are about MOMENTUM, because that is the
 * whole of what this adds: does a disturbance overshoot rather than settle,
 * does it come back at about the period the pipe's length and wave speed say
 * it should, does a surge take time to cross, and does a round pipe behave
 * like a round pipe rather than a rectangular trough.
 */
import { describe, expect, test } from "bun:test";

import { DIR } from "../../iso/dir";
import { createGrid, fillTerrain, heightAt, idx, setHeight } from "../grid";
import { createWaterField, setWaterEdge, waterInPipes } from "./field";
import { createPipeNets, findPipeNets } from "./pipe-net";
import { layPipe } from "./pipes";
import {
  PIPE_D, PIPE_FULL, pipeCelerity, pipeDepth, pipeTop, pipeVolume, stepPipeFlow,
} from "./pipe-flow";

const flat = (w = 24, h = 24) => {
  const g = createGrid(w, h);
  fillTerrain(g, 1);
  return g;
};

/** A sealed run of `n` cells along `y`, starting at x = 4. */
const run = (n: number, y = 12, w = 24) => {
  const g = flat(w, w);
  const f = createWaterField(g);
  setWaterEdge(f, false);
  for (let x = 4; x < 4 + n; x++) layPipe(g, x, y, DIR.S);
  layPipe(g, 4 + n - 1, y, DIR.N);           // both ends turned inwards
  const nets = findPipeNets(g, createPipeNets(g.w, g.h));
  const step = (dt: number) => stepPipeFlow(f, g, nets.cells, nets.at[0], nets.at[1], dt);
  const depth = (x: number) => pipeDepth(f.pipe[idx(g, x, y)]);
  const set = (x: number, v: number) => { f.pipe[idx(g, x, y)] = v; };
  return { g, f, step, depth, set };
};

describe("a round pipe is round", () => {
  test("half the water is half the depth, which only a circle gives you", () => {
    // A circle is symmetric about its middle, so half its area is exactly half
    // its diameter. It is the one point where the shape is easy to check.
    expect(pipeDepth(PIPE_FULL / 2)).toBeCloseTo(PIPE_D / 2, 3);
  });

  test("and depth and volume are inverses of each other", () => {
    for (const f of [0.05, 0.2, 0.5, 0.75, 0.95]) {
      const v = f * PIPE_FULL;
      expect(pipeVolume(pipeDepth(v))).toBeCloseTo(v, 3);
    }
  });

  test("the surface NARROWS towards the crown, which is the whole character", () => {
    // Wide in the middle, nothing at the top, and a hairline past it. It is
    // why the last of a pipe fills hard — the same trickle lifts the level
    // further and further — and why a pipe surcharges suddenly rather than
    // gently. Tested as a TREND, because the number at any one fill is just
    // the number and the shape is the claim.
    const at = (f: number) => pipeTop(PIPE_FULL * f);
    expect(at(0.5)).toBeGreaterThan(at(0.9));
    expect(at(0.9)).toBeGreaterThan(at(0.99));
    expect(at(0.99)).toBeGreaterThan(at(0.999));
    expect(at(1.01)).toBeLessThan(at(0.5) * 0.05);   // the slot
  });

  test("and past the crown there is only the slot, so the wave speed jumps", () => {
    // Preissmann. A full pipe has no free surface and is a pressure problem;
    // the slot keeps it a free-surface problem with a very fast one.
    const part = pipeCelerity(PIPE_FULL * 0.8);
    const pressed = pipeCelerity(PIPE_FULL * 1.05);
    expect(pressed).toBeGreaterThan(part * 5);
  });

  test("and the level past the crown is a PRESSURE head", () => {
    // Water standing above the top of a closed pipe is not water the pipe is
    // holding, it is the height it would stand at in a standpipe.
    const surcharged = pipeDepth(PIPE_FULL * 1.1);
    expect(surcharged).toBeGreaterThan(PIPE_D * 2);
  });
});

describe("water in a pipe SLOSHES", () => {
  test("it overshoots the level rather than settling onto it", () => {
    // The whole of what momentum buys. Levelled by relaxation the closed end
    // falls to the mean and stops there; with momentum it carries past, comes
    // back, and carries past the other way.
    const r = run(8);
    for (let x = 4; x < 12; x++) r.set(x, x < 8 ? 1.2 : 0.2);
    const mean = pipeDepth(waterInPipes(r.f) / 8);

    let low = Infinity, high = -Infinity, crossings = 0;
    let above = r.depth(4) > mean;
    for (let n = 0; n < 60 * 24; n++) {
      r.step(1 / 60);
      const d = r.depth(4);
      if (d < low) low = d;
      if (d > high) high = d;
      if (d > mean !== above) { above = !above; crossings++; }
    }
    expect(low).toBeLessThan(mean - 0.2);         // carried well past, downward
    expect(high).toBeGreaterThan(mean + 0.2);     // and well past, upward
    expect(crossings).toBeGreaterThanOrEqual(3);  // more than once
  });

  test("and comes back at about the period its length and wave speed say", () => {
    // A closed channel rings at `2 L / c` in its fundamental, the same as any
    // other pipe with two closed ends. Nothing here is told that number; it
    // comes out of the arithmetic.
    const N = 8;
    const r = run(N);
    for (let x = 4; x < 4 + N; x++) r.set(x, x < 4 + N / 2 ? 1.2 : 0.2);
    const mean = pipeDepth(waterInPipes(r.f) / N);
    const expected = (2 * N) / pipeCelerity(waterInPipes(r.f) / N);

    // Time from the release to the SECOND crossing of the mean, which is half
    // a period — down through it, and back up through it.
    let above = true, crossings = 0, t = 0, half = 0;
    for (let n = 0; n < 60 * 40 && half === 0; n++) {
      r.step(1 / 60);
      t += 1 / 60;
      if (r.depth(4) > mean !== above) { above = !above; if (++crossings === 2) half = t; }
    }
    expect(half).toBeGreaterThan(0);
    expect(half * 2).toBeGreaterThan(expected * 0.5);
    expect(half * 2).toBeLessThan(expected * 2);
  });

  test("and loses energy as it goes, rather than ringing for ever", () => {
    const r = run(8);
    for (let x = 4; x < 12; x++) r.set(x, x < 8 ? 1.2 : 0.2);
    const swing = (from: number, secs: number) => {
      let low = Infinity, high = -Infinity;
      for (let n = 0; n < 60 * secs; n++) {
        r.step(1 / 60);
        if (n >= 60 * from) {
          const d = r.depth(4);
          if (d < low) low = d;
          if (d > high) high = d;
        }
      }
      return high - low;
    };
    const early = swing(0, 12);
    const late = swing(0, 12);
    expect(late).toBeLessThan(early * 0.8);
  });

  test("and none of it is created or lost while it does", () => {
    const r = run(8);
    for (let x = 4; x < 12; x++) r.set(x, x < 8 ? 1.2 : 0.2);
    const before = waterInPipes(r.f);
    for (let n = 0; n < 60 * 20; n++) {
      r.step(1 / 60);
      expect(waterInPipes(r.f)).toBeCloseTo(before, 5);
    }
  });
});

describe("a surge takes TIME to cross", () => {
  test("the far end of a run answers later than the near end", () => {
    // What a level with no momentum cannot do: relaxation moves a little water
    // everywhere at once, so both ends answer on the same frame.
    const N = 10;
    const r = run(N);
    for (let x = 4; x < 4 + N; x++) r.set(x, PIPE_FULL * 0.5);
    r.set(4, PIPE_FULL * 0.95);                   // a surge at one end

    const near = r.depth(5), far = r.depth(4 + N - 1);
    let nearAt = 0, farAt = 0, t = 0;
    for (let n = 0; n < 60 * 30; n++) {
      r.step(1 / 60);
      t += 1 / 60;
      if (!nearAt && Math.abs(r.depth(5) - near) > 0.02) nearAt = t;
      if (!farAt && Math.abs(r.depth(4 + N - 1) - far) > 0.02) farAt = t;
    }
    expect(nearAt).toBeGreaterThan(0);
    expect(farAt).toBeGreaterThan(nearAt * 2);
  });

  test("and a longer run answers later than a shorter one", () => {
    const arrival = (N: number) => {
      const r = run(N);
      for (let x = 4; x < 4 + N; x++) r.set(x, PIPE_FULL * 0.5);
      r.set(4, PIPE_FULL * 0.95);
      const end = 4 + N - 1;
      const was = r.depth(end);
      let t = 0;
      for (let n = 0; n < 60 * 40; n++) {
        r.step(1 / 60);
        t += 1 / 60;
        if (Math.abs(r.depth(end) - was) > 0.02) return t;
      }
      return Infinity;
    };
    expect(arrival(12)).toBeGreaterThan(arrival(5));
  });
});

describe("over a ridge, and under one", () => {
  test("water laid OVER one cannot climb it, momentum or not", () => {
    // The sill rule, and it has not gone anywhere. A run laid along the
    // surface takes the ground's level, so crossing a ridge means climbing
    // one, and water does not climb: what drives it across an edge is the
    // depth standing above the lip, and there is none.
    const g = flat();
    for (let y = 0; y < 24; y++) setHeight(g, 9, y, 20);
    const f = createWaterField(g);
    setWaterEdge(f, false);
    // Laid explicitly at the GROUND, cell by cell — which is what a pipe you
    // dropped on a hillside is, and what every pipe was before they had an
    // invert of their own.
    for (let x = 4; x <= 14; x++) layPipe(g, x, 12, DIR.S, heightAt(g, x, 12) ?? 0);
    layPipe(g, 14, 12, DIR.N, heightAt(g, 14, 12) ?? 0);
    for (let x = 4; x <= 8; x++) f.pipe[idx(g, x, 12)] = PIPE_FULL * 0.9;
    const nets = findPipeNets(g, createPipeNets(g.w, g.h));
    for (let n = 0; n < 60 * 10; n++) {
      stepPipeFlow(f, g, nets.cells, nets.at[0], nets.at[1], 1 / 60);
    }
    expect(f.pipe[idx(g, 9, 12)]).toBe(0);        // nothing on the ridge
    expect(f.pipe[idx(g, 14, 12)]).toBe(0);       // and nothing beyond it
    expect(f.pipe[idx(g, 4, 12)]).toBeGreaterThan(0);
  });

  test("and the same run laid UNDER it carries straight through", () => {
    // Same terrain, same water, same everything but where the pipe's floor is.
    // Laid from the low side it keeps that grade, so the ridge is over the top
    // of it and there is no lip to climb — which is the entire difference
    // between a pipe on a hillside and a pipe under one.
    const g = flat();
    for (let y = 0; y < 24; y++) setHeight(g, 9, y, 20);
    const f = createWaterField(g);
    setWaterEdge(f, false);
    for (let x = 4; x <= 14; x++) layPipe(g, x, 12, DIR.S);
    layPipe(g, 14, 12, DIR.N, g.pipeZ[idx(g, 14, 12)]);
    expect(g.pipeZ[idx(g, 9, 12)]).toBe(0);       // under twenty half steps of it
    for (let x = 4; x <= 8; x++) f.pipe[idx(g, x, 12)] = PIPE_FULL * 0.9;
    const held = waterInPipes(f);
    const nets = findPipeNets(g, createPipeNets(g.w, g.h));
    for (let n = 0; n < 60 * 10; n++) {
      stepPipeFlow(f, g, nets.cells, nets.at[0], nets.at[1], 1 / 60);
    }
    expect(f.pipe[idx(g, 14, 12)]).toBeGreaterThan(0);   // it got there
    expect(waterInPipes(f)).toBeCloseTo(held, 5);        // and all of it did
  });
});
