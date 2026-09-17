/**
 * The compare harness, which is itself the thing under test here.
 *
 * A falsifier nobody has tried to fool is a decoration. There is no GPU solver
 * yet, so every one of these runs the CPU solver against the CPU solver — once
 * honestly, which must come out at nothing, and then against copies broken in
 * the specific ways a port goes wrong. If it cannot tell those apart now, it
 * will not tell them apart in three weeks with WGSL on the other side.
 */
import { describe, expect, test } from "bun:test";

import {
  FLOW_DEFAULTS, addWater, at, createColumnField, stepFlow, type ColumnField,
} from "./columns";
import { HORIZON, compareSolvers, cpuCandidate, snapshotOf } from "./compare";

const CALM = { ...FLOW_DEFAULTS, wind: 0 };

/** A pond on a lumpy bed, with a cliff at one end so falls are in play too. */
function pond(params = CALM) {
  const f = createColumnField(24, 16, params, 0.5);
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 24; x++) {
      f.ground[at(f, x, y)] = x > 16 ? -12 : ((x * 7 + y * 3) % 5) - 2;
    }
  }
  for (let y = 4; y <= 11; y++) for (let x = 3; x <= 14; x++) addWater(f, x, y, 8, 1);
  return f;
}

const pair = (params = CALM) => [pond(params), pond(params)] as const;

describe("the harness reports nothing when there is nothing to report", () => {
  test("the same solver against itself is zero, everywhere, for ever", () => {
    // The first thing to establish, and the one people skip. A harness that
    // reports phantom differences gets its tolerance widened until it reports
    // nothing at all, and then it is furniture.
    const [a, b] = pair();
    return compareSolvers(
      cpuCandidate("cpu", a, stepFlow), cpuCandidate("cpu again", b, stepFlow),
      { frames: 240, every: 20 },
    ).then((r) => {
      expect(r.verdict).toBe("same");
      expect(r.worst.depth).toBe(0);
      expect(r.worst.fx).toBe(0);
      expect(r.worst.air).toBe(0);
      expect(r.worst.volume).toBe(0);
      expect(r.firstOver).toBeNull();
    });
  });

  test("and with the wind on, which is what makes a scene move at all", () => {
    // The wind is analytic in `f.t`, not random — see `stirWind`. If it were
    // random this whole harness would be impossible and it is worth having a
    // test say so, because "add a bit of noise to the gusts" is an obvious
    // thing for someone to do later.
    const [a, b] = pair(FLOW_DEFAULTS);
    return compareSolvers(
      cpuCandidate("cpu", a, stepFlow), cpuCandidate("cpu again", b, stepFlow),
      { frames: 120, every: 20 },
    ).then((r) => {
      expect(r.verdict).toBe("same");
      expect(r.worst.depth).toBe(0);
    });
  });
});

describe("and catches the ways a port actually goes wrong", () => {
  /** Run the reference against a solver broken in some particular way. */
  const against = (broken: (f: ColumnField, dt: number) => void, params = CALM) => {
    const [a, b] = pair(params);
    return compareSolvers(
      cpuCandidate("reference", a, stepFlow), cpuCandidate("broken", b, broken),
      { frames: 120, every: 10 },
    );
  };

  test("a pass that never ran", async () => {
    // The commonest one: a dispatch left out, or dispatched over the wrong
    // range so most of the map is untouched. Nothing subtle about it.
    const r = await against(() => {});
    expect(r.verdict).toBe("different");
    expect(r.firstOver).toBe(10);               // the very first sample
  });

  test("a transposed index, which is the one that looks plausible", async () => {
    // Reading `y * nx + x` as `x * ny + y` somewhere. The scene still evolves,
    // still looks like water, and is not this water. On a square map it is
    // invisible to the eye and obvious here.
    const r = await against((f, dt) => {
      stepFlow(f, dt);
      const d = f.depth, n = f.nx;
      for (let y = 0; y < f.ny; y++) {
        for (let x = y + 1; x < f.nx; x++) {
          const i = y * n + x, j = x * n + y;
          const t = d[i]; d[i] = d[j]; d[j] = t;
        }
      }
    });
    expect(r.verdict).toBe("different");
  });

  test("a term dropped from one pass, so it is the same shape but wrong", async () => {
    // The hard one. Drag left out of the accelerate pass, say: the water still
    // flows downhill, still conserves, still settles. Only a diff finds it.
    const r = await against((f, dt) => {
      stepFlow(f, dt);
      for (let k = 0; k < f.fx.length; k++) f.fx[k] *= 0.999;
    });
    expect(r.verdict).toBe("different");
    expect(r.worst.fx).toBeGreaterThan(0);
  });

  test("water quietly leaking, which the invariants catch and the cells do not", async () => {
    // A scatter that is not atomic, or a landing lost at a boundary. Per cell
    // it is far below any sensible tolerance; it is a bug all the same, and it
    // is the reason total volume is measured separately from the cells.
    const r = await against((f, dt) => {
      stepFlow(f, dt);
      for (let i = 0; i < f.depth.length; i++) f.depth[i] *= 0.99999;
    });
    expect(r.verdict).toBe("different");
    expect(r.worst.volume).toBeGreaterThan(0);
  });

  test("a one-ULP seed is INSIDE tolerance for the horizon, and that is the point", async () => {
    // What the GPU will really do, in miniature. Over `HORIZON` it is not a
    // difference worth the name — which is what makes a per-cell diff a usable
    // test of a port at all, and is measured rather than hoped for.
    const seed = (f: ColumnField, dt: number) => {
      stepFlow(f, dt);
      if (f.t < 0.02) f.depth[at(f, 8, 8)] = Math.fround(f.depth[at(f, 8, 8)] * (1 + 2 ** -23));
    };
    const [a, b] = pair();
    const r = await compareSolvers(
      cpuCandidate("reference", a, stepFlow), cpuCandidate("one ulp", b, seed),
      { frames: HORIZON, every: 10 },
    );
    expect(r.verdict).toBe("same");
    expect(r.worst.depth).toBeLessThan(1e-4);
  });

  test("and PAST the horizon it says drifting, not different", async () => {
    // Five seconds out, the same one ULP has grown five orders of magnitude
    // and moved a hundred cells — two correct solvers simulating different
    // ponds. It has to come back as drifting, because a harness that called
    // that a fault would be turned off inside a week.
    const seed = (f: ColumnField, dt: number) => {
      stepFlow(f, dt);
      if (f.t < 0.02) f.depth[at(f, 8, 8)] = Math.fround(f.depth[at(f, 8, 8)] * (1 + 2 ** -23));
    };
    const [a, b] = pair();
    const r = await compareSolvers(
      cpuCandidate("reference", a, stepFlow), cpuCandidate("one ulp", b, seed),
      { frames: 600, every: 100 },
    );
    expect(r.verdict).toBe("drifting");
    expect(r.worst.depth).toBeGreaterThan(1e-4);   // it really did diverge
    expect(r.worst.volume / 1000).toBeLessThan(1e-4);  // and lost nothing doing it
  });
});

describe("what the trace is for", () => {
  test("it records the SHAPE, so rounding and a fault look different", async () => {
    // Rounding grows out of nothing. A fault is there on the first sample at
    // full size. Being able to see which is the difference between an hour and
    // a week when seven passes have been ported and one of them is wrong.
    const [a, b] = pair();
    const r = await compareSolvers(
      cpuCandidate("reference", a, stepFlow),
      cpuCandidate("broken", b, (f, dt) => { stepFlow(f, dt * 0.5); }),
      { frames: 60, every: 10 },
    );
    expect(r.trace.length).toBeGreaterThan(3);
    expect(r.trace[0].frame).toBe(0);
    // Frame 0 is BEFORE either has stepped: the same scene, or nothing that
    // follows means anything.
    expect(r.trace[0].depth).toBe(0);
    expect(r.trace[1].depth).toBeGreaterThan(0);
  });

  test("a snapshot is a copy, not a view of arrays that keep changing", async () => {
    // `read` handing back the solver's own arrays would make every sample
    // report the latest state twice and agree perfectly with itself, for ever.
    const f = pond();
    const first = snapshotOf(f);
    stepFlow(f, 1 / 60);
    stepFlow(f, 1 / 60);
    let moved = 0;
    for (let i = 0; i < f.depth.length; i++) if (first.depth[i] !== f.depth[i]) moved++;
    expect(moved).toBeGreaterThan(0);
  });
});
