/**
 * Water falling in drops.
 *
 * The questions worth asking are about the SHAPE of it: does a mouth let go at
 * a fixed size rather than dribbling continuously, does a drop take the time a
 * falling thing takes, does a slow pipe drip and a fast one run, and is the
 * water still there while it is in the air.
 */
import { describe, expect, test } from "bun:test";

import {
  DROP, SPLASH_LIFE, createDrips, dripFrom, fadeSplashes, markSplash,
  resetMouths, runMouth, stepDrips, waterInDrips, wobbleOf,
} from "./drips";
import { FALL_GRAVITY } from "./falls";
import {
  FLOW_DEFAULTS, addWater, createColumnField, setOpenEdge, stepFlow, totalWater,
} from "./columns";

/** A flat floor at zero, and a place for drops to land. */
const floor = () => ({
  surface: () => 0,
  landed: [] as { cx: number; cy: number; volume: number }[],
});

describe("a drop in the air", () => {
  test("takes the time a falling thing takes, not a frame", () => {
    // Free fall: `t = sqrt(2h/g)`. A drop from twenty half steps should be
    // most of a second arriving, and the whole point is that it is not there
    // until it is.
    const d = createDrips(8, 8);
    const f = floor();
    dripFrom(d, 4, 4, 20, DROP, 1);
    const expected = Math.sqrt((2 * 20) / FALL_GRAVITY);

    let t = 0;
    while (d.live > 0 && t < 5) {
      stepDrips(d, 1 / 240, f.surface, (cx, cy, volume) => { f.landed.push({ cx, cy, volume }); return 0; });
      t += 1 / 240;
    }
    expect(f.landed.length).toBe(1);
    expect(t).toBeCloseTo(expected, 1);
  });

  test("a longer drop takes longer, as the square root of it", () => {
    const fall = (h: number) => {
      const d = createDrips(8, 8);
      const f = floor();
      dripFrom(d, 4, 4, h, DROP, 1);
      let t = 0;
      while (d.live > 0 && t < 10) {
        stepDrips(d, 1 / 240, f.surface, () => 0);
        t += 1 / 240;
      }
      return t;
    };
    // Four times the height is twice the time.
    expect(fall(40) / fall(10)).toBeCloseTo(2, 1);
  });

  test("and it is still water while it is up there", () => {
    const d = createDrips(8, 8);
    dripFrom(d, 4, 4, 20, DROP, 1);
    expect(waterInDrips(d)).toBeCloseTo(DROP, 6);
    stepDrips(d, 1 / 60, () => 0, () => 0);
    expect(waterInDrips(d)).toBeCloseTo(DROP, 6);
  });
});

describe("a drop that hits rock", () => {
  test("does not climb it", () => {
    // The landing test asks what the surface is UNDER the drop and puts the
    // water there. So a drop drifting sideways past a cliff at half the
    // cliff's height finds the cliff TOP under it and lands on top of the
    // cliff — ten half steps of water that climbed, out of nothing. It shows
    // up wherever drops travel beside rock, which since a breaking waterfall
    // sheds its spray hard against the wall is everywhere.
    const d = createDrips(8, 8);
    // A wall at x >= 4, twenty half steps of it; open floor before that.
    const surface = (cx: number) => (Math.round(cx) >= 4 ? 20 : 0);
    const landed: { cx: number; z: number }[] = [];
    // Thrown at the wall from beside it, well below the top.
    dripFrom(d, 2.9, 4, 10, DROP, 1, 4, 0, 0);
    let t = 0;
    while (d.live > 0 && t < 3) {
      stepDrips(d, 1 / 240, surface, (cx) => { landed.push({ cx, z: 0 }); return 0; });
      t += 1 / 240;
    }
    expect(landed.length).toBe(1);
    // It stopped at the face and went down it, rather than over the top.
    expect(landed[0].cx).toBeLessThan(3.5);
  });
});

describe("a mouth lets go in drops", () => {
  const run = (rate: number, seconds: number) => {
    const d = createDrips(8, 8);
    const pending = { held: 0 };
    let released = 0, volume = 0;
    const before = () => d.live;
    for (let n = 0; n < seconds * 60; n++) {
      const was = before();
      runMouth(d, pending, rate, 1 / 60, 4, 4, 100, 1);
      released += d.live - was;
      // Keep them in the air; this is about what comes OUT of the mouth.
    }
    for (let k = 0; k < d.live; k++) volume += d.volume[k];
    return { released, volume, pending: pending.held };
  };

  test("a slow pipe drips, and the drops are all the same size", () => {
    // Tate's law is the useful part: a nozzle lets go at a fixed volume, so
    // the RATE changes how often, never how big.
    const r = run(DROP, 4);                       // one drop's worth a second
    expect(r.released).toBe(4);
  });

  test("a fast one runs, because the drops come faster than they separate", () => {
    const slow = run(DROP, 2).released;
    const fast = run(DROP * 20, 2).released;
    expect(fast).toBeGreaterThan(slow * 10);
  });

  test("and what comes out is what went in, to the last drop", () => {
    // The remainder stays hanging at the mouth rather than being rounded away.
    const r = run(DROP * 3.7, 3);
    expect(r.volume + r.pending).toBeCloseTo(DROP * 3.7 * 3, 5);
  });

  test("a torrent goes out as fewer, fatter drops rather than a thousand slots", () => {
    // A fire hose is not a thousand drips, and drawing it as one costs a
    // thousand parcels to make something that reads as a column of water.
    const r = run(DROP * 600, 1);
    expect(r.released).toBeLessThan(60 * 5);
    expect(r.volume).toBeCloseTo(DROP * 600, 3);
  });
});

describe("a drop landing in the simulation", () => {
  const pond = () => {
    const f = createColumnField(16, 16, { ...FLOW_DEFAULTS, wind: 0 }, 0.25);
    f.ground.fill(0);
    setOpenEdge(f, false);
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) addWater(f, x, y, 4, 1);
    for (let n = 0; n < 60; n++) stepFlow(f, 1 / 60);
    return f;
  };

  test("arrives in the water, and nothing is lost on the way", () => {
    const f = pond();
    const before = totalWater(f);
    dripFrom(f.drips, 8, 8, 30, DROP, 1);
    // Counted the moment it leaves the mouth, all the way down, and after.
    expect(totalWater(f)).toBeCloseTo(before + DROP, 4);
    for (let n = 0; n < 120; n++) {
      stepFlow(f, 1 / 60);
      expect(totalWater(f)).toBeCloseTo(before + DROP, 3);
    }
    expect(f.drips.live).toBe(0);
  });

  test("it lands on the WATER, not on the bed underneath it", () => {
    // A pipe over a filling pool has a shorter and shorter fall as the pool
    // comes up to meet it.
    const f = pond();
    dripFrom(f.drips, 8, 8, 30, DROP, 1);
    let frames = 0;
    while (f.drips.live > 0 && frames < 600) { stepFlow(f, 1 / 60); frames++; }
    const shallow = frames;

    const g = createColumnField(16, 16, { ...FLOW_DEFAULTS, wind: 0 }, 0.25);
    g.ground.fill(0);
    setOpenEdge(g, false);
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) addWater(g, x, y, 20, 1);
    for (let n = 0; n < 60; n++) stepFlow(g, 1 / 60);
    dripFrom(g.drips, 8, 8, 30, DROP, 1);
    frames = 0;
    while (g.drips.live > 0 && frames < 600) { stepFlow(g, 1 / 60); frames++; }
    expect(frames).toBeLessThan(shallow);
  });

  test("and it leaves a mark for the foam, which does not outlast it", () => {
    // A drop arrives through the side door: the surface rate the breaking test
    // reads never sees it, so the splash has to be left somewhere.
    const f = pond();
    dripFrom(f.drips, 8, 8, 10, DROP, 1);
    while (f.drips.live > 0) stepFlow(f, 1 / 60);
    const i = 8 * f.nx + 8;
    expect(f.drips.splash[i]).toBeGreaterThan(0);

    for (let n = 0; n < 60; n++) fadeSplashes(f.drips, 1 / 60);
    expect(f.drips.splash[i]).toBe(0);
    expect(f.drips.splashed).toBe(false);
  });
});

describe("the marks a landing leaves are a LIST", () => {
  const marks = (d: ReturnType<typeof createDrips>) => {
    let n = 0;
    for (let i = 0; i < d.splash.length; i++) if (d.splash[i] > 0) n++;
    return n;
  };

  test("and the list is exactly the marks, however they come and go", () => {
    // What fades them walks the list, so a mark the list has lost is a mark
    // nothing will ever clear — it would sit at its value for the rest of the
    // session and be drawn as fresh white water whenever anything else lit up.
    const d = createDrips(24, 24);
    for (const i of [5, 5, 300, 12, 300]) markSplash(d, i, 0.5);
    expect(d.nlit).toBe(3);                       // three columns, not five marks
    expect(marks(d)).toBe(3);
    expect(d.splashed).toBe(true);

    // A brighter mark on a lit column is the same column, not another entry.
    markSplash(d, 5, 0.9);
    expect(d.splash[5]).toBeCloseTo(0.9, 6);
    expect(d.nlit).toBe(3);
    // And a dimmer one does not dim it.
    markSplash(d, 5, 0.1);
    expect(d.splash[5]).toBeCloseTo(0.9, 6);

    // Fading drops them as they go out, and the list tracks it the whole way.
    for (let n = 0; n < 200; n++) {
      fadeSplashes(d, 1 / 60);
      expect(d.nlit).toBe(marks(d));
      expect(d.splashed).toBe(d.nlit > 0);
    }
    expect(d.nlit).toBe(0);
    // Still usable afterwards: the compaction must not have left the array in
    // a state where the next mark lands on a stale entry.
    markSplash(d, 77, 0.4);
    expect(d.nlit).toBe(1);
    expect(d.lit[0]).toBe(77);
  });

  test("a mark out of bounds is no mark, and does not take a slot", () => {
    const d = createDrips(8, 8);
    markSplash(d, -1, 1);
    markSplash(d, 64, 1);
    expect(d.nlit).toBe(0);
    expect(d.splashed).toBe(false);
  });

  test("and they fade on the clock, not on being looked at", () => {
    const d = createDrips(8, 8);
    markSplash(d, 3, 1);
    fadeSplashes(d, SPLASH_LIFE);
    expect(d.splash[3]).toBeCloseTo(Math.exp(-1), 5);
    expect(d.nlit).toBe(1);
  });
});

describe("a drop hitting the water", () => {
  /** A still, deep, walled pond — so anything moving in it came from the drop. */
  const still = (depth = 6) => {
    const f = createColumnField(24, 24, { ...FLOW_DEFAULTS, wind: 0 }, 0.25);
    f.ground.fill(0);
    setOpenEdge(f, false);
    for (let y = 0; y < 24; y++) for (let x = 0; x < 24; x++) addWater(f, x, y, depth, 1);
    for (let n = 0; n < 240; n++) stepFlow(f, 1 / 60);
    return f;
  };
  const surface = (f: ReturnType<typeof still>, x: number, y: number) =>
    f.ground[y * f.nx + x] + f.depth[y * f.nx + x];

  test("digs a crater, and the rim of it stands proud", () => {
    // A drop arrives with `m v` of downward momentum and the surface has to do
    // something with it. What it does is get out of the way: the water is
    // pushed aside, the middle goes DOWN below the rest of the pond, and what
    // came out of the middle is standing around the edge of the hole.
    //
    // Measured frame by frame on a six deep pond, the middle runs +0.15 (the
    // drop's own mound), then -0.31 (the crater), then +0.39 (the rebound —
    // the Worthington jet, which nobody put in), with the ring in antiphase
    // the whole way. So the moment to look at is the bottom of the crater and
    // not a fixed frame: frame four happens to be the crossing.
    const f = still();
    const flat = surface(f, 12, 12);
    dripFrom(f.drips, 12, 12, 40, DROP, 1);
    while (f.drips.live > 0) stepFlow(f, 1 / 60);

    let lowest = flat, rimThen = flat;
    for (let n = 0; n < 20; n++) {
      stepFlow(f, 1 / 60);
      if (surface(f, 12, 12) < lowest) {
        lowest = surface(f, 12, 12);
        rimThen = surface(f, 13, 12);
      }
    }
    expect(lowest).toBeLessThan(flat - 0.1);      // a hole, not a wobble
    expect(rimThen).toBeGreaterThan(flat);        // and the water it displaced
  });

  test("and the crater becomes a RING, spreading", () => {
    // Nobody draws the ring. It is what this scheme does with a hole in a
    // surface: the walls stand proud, gravity pulls them back and past, and
    // the disturbance runs outward at the wave speed. So the test is that the
    // furthest thing moving gets further away with time.
    const f = still();
    const flat = surface(f, 12, 12);
    dripFrom(f.drips, 12, 12, 40, DROP, 1);
    while (f.drips.live > 0) stepFlow(f, 1 / 60);

    /** How far out the disturbance reaches, along a row through the middle. */
    const reach = () => {
      let far = 0;
      for (let x = 12; x < 24; x++) {
        if (Math.abs(surface(f, x, 12) - flat) > 1e-4) far = x - 12;
      }
      return far;
    };
    for (let n = 0; n < 6; n++) stepFlow(f, 1 / 60);
    const early = reach();
    for (let n = 0; n < 24; n++) stepFlow(f, 1 / 60);
    const later = reach();
    expect(early).toBeGreaterThan(0);
    expect(later).toBeGreaterThan(early);
  });

  test("a crown is thrown, and only by a drop moving fast enough", () => {
    // The threshold is a Weber number in the real thing; with the drop size
    // fixed it is a speed. Below it the drop merges with a ripple and nothing
    // leaves the surface.
    const fast = still();
    dripFrom(fast.drips, 12, 12, 40, DROP, 1);
    let flecks = 0;
    for (let n = 0; n < 120; n++) { stepFlow(fast, 1 / 60); flecks = Math.max(flecks, fast.drips.live); }

    const slow = still();
    dripFrom(slow.drips, 12, 12, 6.2, DROP, 1);  // barely above the surface
    let gentle = 0;
    for (let n = 0; n < 120; n++) { stepFlow(slow, 1 / 60); gentle = Math.max(gentle, slow.drips.live); }

    expect(flecks).toBeGreaterThan(1);            // the drop, plus what it threw
    expect(gentle).toBe(1);                       // just the drop
  });

  test("what a crown throws lands about a column away, not a tile", () => {
    // A crown's rim is a fraction of the drop's own diameter across and
    // everything it flings comes down on top of the splash. Thrown at the
    // impact speed in the WRONG units it went three tiles, which on a cliff
    // is a drizzle landing back on the clifftop.
    const f = still();
    dripFrom(f.drips, 12, 12, 40, DROP, 1);
    let far = 0;
    for (let n = 0; n < 120; n++) {
      stepFlow(f, 1 / 60);
      for (let k = 0; k < f.drips.live; k++) {
        far = Math.max(far, Math.hypot(f.drips.cx[k] - 12, f.drips.cy[k] - 12));
      }
    }
    expect(far).toBeGreaterThan(0);
    expect(far).toBeLessThan(2);
  });

  test("and none of it is invented or lost on the way", () => {
    const f = still();
    const before = totalWater(f);
    dripFrom(f.drips, 12, 12, 40, DROP, 1);
    for (let n = 0; n < 240; n++) {
      stepFlow(f, 1 / 60);
      expect(totalWater(f)).toBeCloseTo(before + DROP, 3);
    }
  });

  test("a drop landing on dry ground just wets it", () => {
    // No water under it, no crater and nothing to throw.
    const f = createColumnField(24, 24, { ...FLOW_DEFAULTS, wind: 0 }, 0.25);
    f.ground.fill(0);
    setOpenEdge(f, false);
    dripFrom(f.drips, 12, 12, 40, DROP, 1);
    while (f.drips.live > 0) stepFlow(f, 1 / 60);
    expect(f.drips.live).toBe(0);
    expect(totalWater(f)).toBeCloseTo(DROP, 6);
  });
});

describe("a drop's shape", () => {
  test("starts stretched and RINGS, rather than settling straight out", () => {
    // Surface tension is a restoring force, so a drop that pinched off long
    // does not simply relax: it overshoots into oblate and back. The test is
    // the overshoot — the shape has to cross zero.
    const d = createDrips(8, 8);
    dripFrom(d, 4, 4, 400, DROP, 1);
    const start = d.shape[0];
    expect(start).toBeGreaterThan(0);             // stretched by the neck
    let lowest = start;
    for (let n = 0; n < 30; n++) {
      stepDrips(d, 1 / 240, () => -1e9, () => 0);
      lowest = Math.min(lowest, d.shape[0]);
    }
    expect(lowest).toBeLessThan(0);               // it went past round
  });

  test("and it dies away, so an old drop is round", () => {
    const d = createDrips(8, 8);
    dripFrom(d, 4, 4, 4000, DROP, 1);
    const start = Math.abs(d.shape[0]);
    for (let n = 0; n < 480; n++) stepDrips(d, 1 / 240, () => -1e9, () => 0);
    expect(Math.abs(d.shape[0])).toBeLessThan(start * 0.35);
  });

  test("a smaller drop rings FASTER, as one over the root of its volume", () => {
    // The Rayleigh frequency goes as `a^-3/2`, and volume as `a^3`. Kept, so
    // a fleck off a crown shivers faster than the drop that made it without
    // anything having to say so.
    expect(wobbleOf(DROP / 8) / wobbleOf(DROP)).toBeCloseTo(Math.sqrt(8), 5);
  });
});

describe("the drop still hanging at a mouth", () => {
  test("is on the list, whether or not the mouth let go this step", () => {
    // It is the mouth's own pending volume and always was. What was missing
    // was anywhere to look it up, which is what it takes to DRAW a drop
    // growing rather than a drop appearing.
    const d = createDrips(8, 8);
    const pending = { held: 0 };
    resetMouths(d);
    runMouth(d, pending, DROP, 1 / 60, 4, 4, 12, 1);
    expect(d.mouths).toBe(1);
    expect(d.mheld[0]).toBeCloseTo(DROP / 60, 6);
    expect(d.live).toBe(0);                       // nothing has let go yet
    expect(d.mz[0]).toBe(12);
  });

  test("and the list is a view of the frame, not a thing that grows", () => {
    const d = createDrips(8, 8);
    const pending = { held: 0 };
    for (let n = 0; n < 50; n++) {
      resetMouths(d);
      runMouth(d, pending, DROP, 1 / 60, 4, 4, 12, 1);
    }
    expect(d.mouths).toBe(1);
  });
});

/**
 * THE RINGING HAS A TIMESTEP IT CANNOT OUTRUN.
 *
 * `wobbleOf` goes as the inverse square root of the volume, so the smaller the
 * drop the faster it rings, and the semi-implicit integrator holds only while
 * `w * dt` stays near two. A crown fleck is small enough to break it.
 */
describe("a fleck ringing faster than the step", () => {
  test("the shape stays finite where it used to reach NaN", () => {
    const d = createDrips(64);
    const volume = DROP * 0.002;                 // an ordinary crown fleck
    dripFrom(d, 4, 4, 20, volume, 1, 0, 0, -1);
    // Unclamped this is 12.9 radians a step, and the shape grew about 167x a
    // step and was NaN inside forty frames.
    expect(wobbleOf(volume) * (1 / 60)).toBeGreaterThan(2);
    for (let n = 0; n < 240; n++) stepDrips(d, 1 / 60, () => -1000, () => 0);
    expect(Number.isFinite(d.shape[0])).toBe(true);
    expect(Math.abs(d.shape[0])).toBeLessThan(2);
  });

  test("and at a frame long enough to break even a whole drop", () => {
    const d = createDrips(64);
    dripFrom(d, 4, 4, 400, DROP, 1, 0, 0, -1);
    // 0.2 s is the solver's own ceiling on a frame, and a whole DROP rings at
    // 34.6 — seven radians a step.
    expect(wobbleOf(DROP) * 0.2).toBeGreaterThan(2);
    for (let n = 0; n < 60; n++) stepDrips(d, 0.2, () => -1000, () => 0);
    expect(Number.isFinite(d.shape[0])).toBe(true);
  });

  test("an ordinary drop at an ordinary frame is not touched by the clamp", () => {
    // 0.58 radians a step — nowhere near the limit, so the shape it rings
    // through must be the unclamped one.
    expect(wobbleOf(DROP) * (1 / 60)).toBeLessThan(1.5);
  });
});
