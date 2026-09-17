/**
 * The column solver. These are the properties the whole feature rests on, so
 * they are asserted as properties and not as snapshots of a particular scene.
 *
 * Conservation and non-negativity first: a flow sim that leaks or that lets a
 * depth go below zero cannot be reasoned about anywhere downstream, and a
 * negative depth at a shoreline is the classic way these schemes blow up.
 */
import { describe, expect, test } from "bun:test";

import {
  FLOW_DEFAULTS, MAX_FLOW_SPEED, addWater, at, createColumnField, flowEnergy, maxStep,
  setMaterialDrag, setOpenEdge,
  stepFlow, substepsFor, surfaceAt, totalWater, velocityAt, type ColumnField,
} from "./columns";

/**
 * A field at the resolution the game runs at: two columns to the tile.
 *
 * Not one, though one would read more simply, because these tolerances were
 * measured against what ships and a coarser grid has coarser friction — the
 * threshold that stops the flow is a slope, so a cell twice as wide has twice
 * the head across it before anything moves.
 */
/**
 * A dead calm, which is what almost everything here wants.
 *
 * The wind is real behaviour and has its own tests at the bottom, but a test of
 * how fast a wave runs should no more have weather in it than a flume should
 * have a fan pointed at it.
 */
const CALM = { ...FLOW_DEFAULTS, wind: 0 };

const flat = (nx = 16, ny = 16, ground = 0) => {
  const f = createColumnField(nx, ny, CALM, 0.5);
  f.ground.fill(ground);
  return f;
};

const run = (f: ColumnField, seconds: number) => {
  for (let n = 0; n < Math.round(seconds * 60); n++) stepFlow(f, 1 / 60);
};

const depths = (f: ColumnField) => [...f.depth];
const wet = (f: ColumnField) => f.depth.reduce((n, d) => n + (d > f.params.dryDepth ? 1 : 0), 0);

describe("conservation", () => {
  test("not one drop is gained or lost, over a thousand steps", () => {
    const f = flat();
    addWater(f, 8, 8, 40);
    const before = totalWater(f);
    for (let n = 0; n < 1000; n++) stepFlow(f, 1 / 60);
    expect(totalWater(f)).toBeCloseTo(before, 3);
  });

  test("nor over rough ground, where the flow is doing real work", () => {
    const f = flat(20, 20);
    for (let i = 0; i < f.ground.length; i++) {
      f.ground[i] = ((i * 7919) % 13) - 6;             // lumpy, deterministic
    }
    for (let k = 0; k < 12; k++) addWater(f, 3 + k, 10, 8);
    const before = totalWater(f);
    run(f, 20);
    expect(totalWater(f)).toBeCloseTo(before, 2);
  });

  test("a long frame is split, and still conserves", () => {
    const f = flat();
    addWater(f, 8, 8, 30);
    const before = totalWater(f);
    for (let n = 0; n < 40; n++) stepFlow(f, 0.25);     // 250ms frames
    expect(totalWater(f)).toBeCloseTo(before, 3);
    expect(f.depth.every((d) => d >= 0)).toBe(true);
  });
});

describe("no negative depth, ever", () => {
  test("not at a spreading shoreline", () => {
    const f = flat(24, 24);
    addWater(f, 12, 12, 60);
    for (let n = 0; n < 2000; n++) {
      stepFlow(f, 1 / 60);
      for (let i = 0; i < f.depth.length; i++) expect(f.depth[i]).toBeGreaterThanOrEqual(0);
    }
  });

  test("not when water is dropped onto a cliff edge", () => {
    const f = flat(16, 16);
    for (let y = 0; y < 16; y++) for (let x = 8; x < 16; x++) f.ground[at(f, x, y)] = -20;
    addWater(f, 7, 8, 50);
    run(f, 15);
    expect(f.depth.every((d) => d >= 0 && Number.isFinite(d))).toBe(true);
  });
});

describe("a breaking wave loses energy, and nothing else does", () => {
  /** How uneven the surface is, over the wet columns. */
  const chop = (f: ColumnField) => {
    const vals: number[] = [];
    for (let i = 0; i < f.depth.length; i++) {
      if (f.depth[i] > f.params.dryDepth) vals.push(surfaceAt(f, i));
    }
    const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
    return Math.sqrt(vals.reduce((a, b) => a + (b - mean) * (b - mean), 0) / vals.length);
  };

  const pond = (size: number, depth: number, params: typeof FLOW_DEFAULTS) => {
    const f = createColumnField(size, size, params, 0.25);
    f.ground.fill(0);
    setOpenEdge(f, false);
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) addWater(f, x, y, depth, 1);
    run(f, 5);
    return f;
  };

  /** A pond shoved, and how tall the surface stands a second later. */
  const shoved = (slug: number, breaking: number) => {
    const f = pond(24, 12, { ...CALM, breaking });
    for (let y = 10; y < 14; y++) for (let x = 10; x < 14; x++) addWater(f, x, y, slug, 1);
    run(f, 1);
    return chop(f);
  };

  test("it takes the top off a wave that is breaking", () => {
    // The whole point, and the thing the foam in `render/foam` only ever drew.
    // Breaking is where a wave's organised motion goes to turbulence, and in
    // deep water it is the dominant sink there is — without it the only ones
    // here are a flat per-second drag and a bed friction that falls off as one
    // over the depth squared, neither of which can tell a ten tile swell from
    // a one column spike.
    expect(shoved(8, 1)).toBeLessThan(shoved(8, 0) * 0.7);
  });

  test("and leaves a wave that is not alone", () => {
    // Selectivity is the whole difficulty. A dissipation that cannot tell the
    // difference is just more drag, and this engine already has two of those.
    const on = shoved(1, 1), off = shoved(1, 0);
    expect(Math.abs(on - off)).toBeLessThan(off * 0.02);
  });

  test("the weather can still work a pond up, exactly as far as before", () => {
    // The wind is the only thing putting energy IN. If breaking ate what the
    // weather makes, a pond would go dead flat and the whole of "the water is
    // never quite still" would go with it.
    const lively = chop(pond(64, 12, FLOW_DEFAULTS));
    const damped = chop(pond(64, 12, { ...FLOW_DEFAULTS, breaking: 1 }));
    run(lively, 0);
    expect(damped).toBeCloseTo(lively, 2);
  });

  test("water poured in for ten seconds stops standing up in spikes", () => {
    // What this was brought in for: while the pour tool is running, the
    // surface used to hold a roughness of twelve half steps at COLUMN scale
    // and shed it only slowly after you stopped.
    const size = 96, perTile = 4;
    const f = createColumnField(size, size, CALM, 0.25);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const tx = Math.floor(x / perTile), ty = Math.floor(y / perTile);
        f.ground[y * size + x] =
          Math.round(10 * Math.sin(tx * 0.4) * Math.cos(ty * 0.33) + 6 * Math.sin((tx + ty) * 0.21));
      }
    }
    setOpenEdge(f, false);
    for (let n = 0; n < 10 * 60; n++) {
      if (n % 6 === 0) {
        for (let y = 40; y < 56; y++) for (let x = 40; x < 56; x++) addWater(f, x, y, 6, 1);
      }
      stepFlow(f, 1 / 60);
    }
    let worst = 0;
    for (let y = 1; y < size - 1; y++) {
      for (let x = 1; x < size - 1; x++) {
        const i = y * size + x;
        if (f.depth[i] <= f.params.dryDepth) continue;
        const round = [i - 1, i + 1, i - size, i + size];
        if (round.some((j) => f.depth[j] <= f.params.dryDepth)) continue;
        const mean = round.reduce((a, j) => a + surfaceAt(f, j), 0) / 4;
        worst = Math.max(worst, Math.abs(surfaceAt(f, i) - mean));
      }
    }
    // 3.31 half steps left to itself, 1.29 with the breaking on.
    expect(worst).toBeLessThan(2);
  });

  test("and it does not lose a drop doing it", () => {
    // A diffusion of the flux moves momentum, never water: what one edge gains
    // its neighbour loses, and the divergence sees the same total either way.
    const f = pond(24, 12, { ...CALM, breaking: 1 });
    for (let y = 10; y < 14; y++) for (let x = 10; x < 14; x++) addWater(f, x, y, 24, 1);
    const before = totalWater(f);
    run(f, 20);
    expect(Math.abs(totalWater(f) - before) / before).toBeLessThan(1e-5);
  });
});

describe("deep water settles like shallow water", () => {
  /**
   * How uneven the surface is, over the wet columns.
   *
   * A pond at rest reads near zero whatever is in it; a pond that is ringing
   * reads whatever the waves are worth. It is the surface and not the energy
   * because the failure this describes is visible before it is large.
   */
  const chop = (f: ColumnField) => {
    const vals: number[] = [];
    for (let i = 0; i < f.depth.length; i++) {
      if (f.depth[i] > f.params.dryDepth) vals.push(surfaceAt(f, i));
    }
    const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
    return Math.sqrt(vals.reduce((a, b) => a + (b - mean) * (b - mean), 0) / vals.length);
  };

  /**
   * A walled pond of a given depth, at rest.
   *
   * Filled through `addWater` and not by writing the depths: the active box is
   * what the solver walks, and it is maintained by the things that add water.
   * Filled behind its back the pond is there and nothing ever happens to it —
   * which is a very convincing way for a test of whether water settles to pass.
   */
  const pond = (depth: number, params = CALM, size = 24) => {
    const f = createColumnField(size, size, params, 0.25);
    f.ground.fill(0);
    setOpenEdge(f, false);
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) addWater(f, x, y, depth, 1);
    run(f, 5);
    return f;
  };

  test("a pool over ROLLING ground settles, and does not stand up in spikes", () => {
    // The report this comes from: lower the ground under a pool and the waves
    // never settle. It looks exactly like a damping failure and is not one —
    // it survived the wind being turned off, the bed drag raised eightfold and
    // the fluid drag doubled, and it went away entirely at half the substep.
    //
    // What makes rolling ground harder than flat is that the bed is a
    // STAIRCASE: height belongs to a tile and there are several columns to a
    // tile, so every tile boundary is a step under the water, and every step
    // reflects a little of every wave that crosses it. The same relief
    // smoothed to column resolution is stable at a step this comes apart at,
    // which is what says it is the steps and not the slope.
    const size = 96, perTile = 4;
    const f = createColumnField(size, size, CALM, 0.25);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const tx = Math.floor(x / perTile), ty = Math.floor(y / perTile);
        f.ground[y * size + x] =
          Math.round(10 * Math.sin(tx * 0.4) * Math.cos(ty * 0.33) + 6 * Math.sin((tx + ty) * 0.21));
      }
    }
    setOpenEdge(f, false);
    for (let y = 24; y < 72; y++) for (let x = 24; x < 72; x++) addWater(f, x, y, 60, 1);
    run(f, 45);

    // The spikes are at COLUMN scale, so this is what they show up in: how far
    // each column stands off the mean of the four around it.
    let worst = 0;
    for (let y = 1; y < size - 1; y++) {
      for (let x = 1; x < size - 1; x++) {
        const i = y * size + x;
        if (f.depth[i] <= f.params.dryDepth) continue;
        const round = [i - 1, i + 1, i - size, i + size];
        if (round.some((j) => f.depth[j] <= f.params.dryDepth)) continue;
        const mean = round.reduce((a, j) => a + surfaceAt(f, j), 0) / 4;
        worst = Math.max(worst, Math.abs(surfaceAt(f, i) - mean));
      }
    }
    // Stepped to the depth it is at, 1.1 half steps. Stepped at a flat 1/60,
    // 32 — which is the screenshot this came from.
    expect(worst).toBeLessThan(3);
  });

  test("a shove in deep water dies out, the same as in shallow", () => {
    // The bug: the CFL guard on the flux was written from the ONE dimensional
    // Courant condition, and this grid is two dimensional, where the limit is
    // a factor of root two stricter. Between them the scheme rings instead of
    // settling, and nothing damps it — it survived the wind being turned off,
    // the bed drag being raised tenfold and the fluid drag being doubled.
    // Measured at a depth of 64, a shove came back at 1.12 times its own size
    // a minute later rather than a quarter of it.
    for (const depth of [16, 64, 96]) {
      const f = pond(depth);
      for (let y = 10; y < 14; y++) {
        for (let x = 10; x < 14; x++) addWater(f, x, y, depth / 4, 1);
      }
      run(f, 2);
      const shoved = chop(f);
      run(f, 58);
      expect(chop(f)).toBeLessThan(shoved * 0.5);
    }
  });

  test("and the wind cannot work a deep pond up into a frenzy", () => {
    // The same fault seen from the other side: with the weather on, a pond
    // deeper than the guard allowed settled at a chop of 18 to 49 half steps
    // where a shallower one settles at a third of one.
    // Wide enough for a gust to vary across it: the weather's two gusts are
    // 23 and 13 TILES long, and on a pond narrower than one of them the wind
    // is a uniform push that tilts the whole thing once and goes quiet.
    const shallow = pond(32, FLOW_DEFAULTS, 64);
    const deep = pond(96, FLOW_DEFAULTS, 64);
    run(shallow, 30);
    run(deep, 30);
    expect(chop(shallow)).toBeGreaterThan(0);
    expect(chop(deep)).toBeLessThan(chop(shallow) * 3);
  });

  test("it does not invent water while it rings, either", () => {
    // The runaway pumped volume as well as energy: a pool with a pit lowered
    // under it dug the pit deeper than the lowering, 112 half steps against
    // the 58 that was actually made.
    const f = pond(96);
    const before = totalWater(f);
    for (let y = 10; y < 14; y++) {
      for (let x = 10; x < 14; x++) addWater(f, x, y, 24, 1);
    }
    run(f, 60);
    // Loose only against float32's own accumulation over thirty thousand
    // columns — the failure this catches was four orders of magnitude bigger.
    const expected = before + 16 * 24;
    expect(Math.abs(totalWater(f) - expected) / expected).toBeLessThan(1e-5);
  });
});

describe("water finds its level", () => {
  test("a heap on flat ground spreads out and levels off", () => {
    const f = flat(21, 21);
    addWater(f, 10, 10, 100);
    run(f, 60);
    // every wet column ends at the same surface, to a small tolerance
    const surfaces = [...f.depth.keys()]
      .filter((i) => f.depth[i] > f.params.dryDepth)
      .map((i) => surfaceAt(f, i));
    const lo = Math.min(...surfaces), hi = Math.max(...surfaces);
    // Not dead flat: friction leaves a RIM, and the rim is what the two
    // friction terms leave behind — the slope below which nothing accelerates,
    // and the bed holding back what is left. A couple of times the first is
    // about what to expect of the pair.
    expect(hi - lo).toBeLessThan(f.params.minSlope * f.cell * 3);
    expect(surfaces.length).toBeGreaterThan(50);         // it really did spread
  });

  test("it fills a basin to one surface, whatever the bottom looks like", () => {
    const f = flat(16, 16, 10);
    // a bowl with a lumpy floor
    for (let y = 4; y <= 11; y++) {
      for (let x = 4; x <= 11; x++) f.ground[at(f, x, y)] = -4 + ((x * y) % 3);
    }
    for (let y = 5; y <= 10; y++) for (let x = 5; x <= 10; x++) addWater(f, x, y, 6);
    // A minute is not enough any more: the fluid keeps almost all of its own
    // momentum now, so a basin spends a good while ringing before it is level.
    run(f, 150);
    const inside = [];
    for (let y = 4; y <= 11; y++) {
      for (let x = 4; x <= 11; x++) {
        const i = at(f, x, y);
        if (f.depth[i] > f.params.dryDepth) inside.push(surfaceAt(f, i));
      }
    }
    expect(Math.max(...inside) - Math.min(...inside)).toBeLessThan(f.params.minSlope * f.cell * 2.5);
    // and the depth under that surface is NOT uniform — the floor is lumpy
    const ds = [];
    for (let y = 5; y <= 10; y++) for (let x = 5; x <= 10; x++) ds.push(f.depth[at(f, x, y)]);
    expect(Math.max(...ds) - Math.min(...ds)).toBeGreaterThan(0.5);
  });

  test("it does not climb out of the basin it is in", () => {
    const f = flat(16, 16, 20);
    for (let y = 6; y <= 9; y++) for (let x = 6; x <= 9; x++) f.ground[at(f, x, y)] = 0;
    for (let y = 6; y <= 9; y++) for (let x = 6; x <= 9; x++) addWater(f, x, y, 3);
    run(f, 40);
    for (let y = 0; y < 16; y++) {
      for (let x = 0; x < 16; x++) {
        const inBasin = x >= 6 && x <= 9 && y >= 6 && y <= 9;
        if (!inBasin) expect(f.depth[at(f, x, y)]).toBeLessThanOrEqual(f.params.dryDepth);
      }
    }
  });

  test("and in a dead calm it stops — still water does not keep jittering", () => {
    const f = flat(16, 16);
    addWater(f, 8, 8, 30);
    run(f, 90);
    const moving = flowEnergy(f);
    const before = depths(f);
    run(f, 5);
    expect(moving).toBeLessThan(1);
    for (let i = 0; i < f.depth.length; i++) {
      expect(Math.abs(f.depth[i] - before[i])).toBeLessThan(0.02);
    }
  });
});

describe("but the water is never quite still", () => {
  /** How far the surface moves over a second, once it has found its level. */
  const stir = (f: ColumnField) => {
    const before = f.depth.map((d, i) => (d > f.params.dryDepth ? surfaceAt(f, i) : 0));
    run(f, 1);
    let sum = 0, n = 0;
    for (let i = 0; i < f.depth.length; i++) {
      if (f.depth[i] > f.params.dryDepth && before[i]) {
        sum += (surfaceAt(f, i) - before[i]) ** 2;
        n++;
      }
    }
    return Math.sqrt(sum / Math.max(1, n));
  };

  /** A bowl with walls, filled and left for a minute. */
  const bowl = (wind: number) => {
    const f = createColumnField(32, 32, { ...CALM, wind }, 0.5);
    for (let y = 0; y < 32; y++) {
      for (let x = 0; x < 32; x++) {
        f.ground[at(f, x, y)] = Math.hypot(x - 16, y - 16) < 11 ? -8 : 4;
      }
    }
    for (let y = 0; y < 32; y++) {
      for (let x = 0; x < 32; x++) {
        if (Math.hypot(x - 16, y - 16) < 11) addWater(f, x, y, 8);
      }
    }
    run(f, 60);
    return f;
  };

  test("a settled pond keeps moving, and a calm one does not", () => {
    // Every other term in the scheme takes energy out, so without this one the
    // answer to "what does water do when you leave it alone" is "nothing at
    // all, forever", which is the one thing real water never does.
    expect(stir(bowl(0))).toBe(0);
    expect(stir(bowl(FLOW_DEFAULTS.wind))).toBeGreaterThan(0.05);
  });

  test("it stirs the water without adding a drop or losing one", () => {
    // The gusts push the FLUX, and the divergence step moves exactly what the
    // fluxes say wherever they came from. Forcing cannot create water.
    const f = bowl(FLOW_DEFAULTS.wind);
    const held = totalWater(f);
    run(f, 60);
    expect(totalWater(f)).toBeCloseTo(held, 3);
  });

  test("and without blowing the pond out of its basin", () => {
    const f = bowl(FLOW_DEFAULTS.wind);
    run(f, 120);
    let out = 0;
    for (let y = 0; y < 32; y++) {
      for (let x = 0; x < 32; x++) {
        if (Math.hypot(x - 16, y - 16) >= 11) out += f.depth[at(f, x, y)];
      }
    }
    expect(out).toBe(0);
  });

  test("a shallow puddle is ruffled, not thrown about", () => {
    // Wind is a stress on the surface and does not care what is under it, so
    // ungated it moved a puddle in waves as deep as the puddle. The depth gate
    // is what keeps a pour on flat ground looking like a pour on flat ground.
    const f = flat(61, 61);
    const windy = createColumnField(61, 61, FLOW_DEFAULTS, 0.5);
    addWater(f, 30, 30, 100);
    addWater(windy, 30, 30, 100);
    run(f, 60);
    run(windy, 60);
    const spread = (g: ColumnField) => {
      const ss = [...g.depth.keys()]
        .filter((i) => g.depth[i] > g.params.dryDepth)
        .map((i) => surfaceAt(g, i));
      return Math.max(...ss) - Math.min(...ss);
    };
    expect(stir(windy)).toBeGreaterThan(0);            // it is alive
    expect(spread(windy)).toBeLessThan(spread(f) * 2); // and still a puddle
    expect(wet(windy)).toBeGreaterThan(wet(f) * 0.7);  // that has not run off
  });

  test("the gusts wander rather than pulsing, so the water never arrives", () => {
    // Two waves at periods that do not divide into one another. A single one,
    // or a steady wind, would tilt the pond to a new balance and go quiet
    // again — the point is that the balance keeps moving.
    const f = bowl(FLOW_DEFAULTS.wind);
    const samples: number[] = [];
    for (let n = 0; n < 12; n++) {
      samples.push(stir(f));
      run(f, 4);
    }
    // It is moving at every sample, and by visibly different amounts.
    expect(Math.min(...samples)).toBeGreaterThan(0.01);
    expect(Math.max(...samples)).toBeGreaterThan(Math.min(...samples) * 1.5);
  });

  test("a dead calm is exactly what it used to be", () => {
    // `wind: 0` has to leave the solver bit for bit as it was, or every test
    // above this one is measuring something other than what it says.
    const a = flat(24, 24), b = createColumnField(24, 24, { ...CALM, wind: 0 }, 0.5);
    for (const f of [a, b]) {
      for (let y = 0; y < 24; y++) for (let x = 0; x < 24; x++) f.ground[at(f, x, y)] = (24 - x) * 0.3;
      addWater(f, 4, 12, 40, 1);
    }
    run(a, 20);
    run(b, 20);
    for (let i = 0; i < a.depth.length; i++) expect(a.depth[i]).toBe(b.depth[i]);
  });
});

describe("it flows downhill, at any height, to any other", () => {
  test("down a ramp, and it arrives at the bottom", () => {
    const f = flat(24, 8);
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 24; x++) f.ground[at(f, x, y)] = (24 - x) * 1.5;
    }
    for (let y = 2; y <= 5; y++) addWater(f, 1, y, 12);
    const startedAt = totalWater(f);
    run(f, 30);
    let farEnd = 0;
    for (let y = 0; y < 8; y++) farEnd += f.depth[at(f, 22, y)] + f.depth[at(f, 23, y)];
    expect(farEnd).toBeGreaterThan(startedAt * 0.4);     // most of it ran down
    expect(totalWater(f)).toBeCloseTo(startedAt, 2);
  });

  test("OFF A CLIFF — a big drop is just a big head difference", () => {
    const f = flat(20, 8);
    for (let y = 0; y < 8; y++) {
      for (let x = 10; x < 20; x++) f.ground[at(f, x, y)] = -30;   // sheer drop
    }
    for (let y = 2; y <= 5; y++) addWater(f, 2, y, 20);
    run(f, 30);
    let below = 0;
    for (let y = 0; y < 8; y++) for (let x = 10; x < 20; x++) below += f.depth[at(f, x, y)];
    expect(below).toBeGreaterThan(0);
    // it landed at the bottom rather than piling up at the lip
    expect(f.depth[at(f, 9, 3)]).toBeLessThan(f.depth[at(f, 12, 3)] + 1);
  });

  test("UP a step it will not go, however much is behind it", () => {
    const f = flat(20, 8);
    for (let y = 0; y < 8; y++) for (let x = 10; x < 20; x++) f.ground[at(f, x, y)] = 25;
    for (let y = 2; y <= 5; y++) addWater(f, 2, y, 6);
    run(f, 30);
    let beyond = 0;
    for (let y = 0; y < 8; y++) for (let x = 10; x < 20; x++) beyond += f.depth[at(f, x, y)];
    expect(beyond).toBeLessThanOrEqual(f.params.dryDepth * 80);
  });

  test("over a saddle between two basins, until both are level", () => {
    const f = flat(24, 8, 0);
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 24; x++) f.ground[at(f, x, y)] = x >= 11 && x <= 12 ? 4 : -6;
    }
    // Enough to raise the near basin just over the sill once it has spread: the
    // left side is 11x8 cells at ground -6, so a surface over +4 needs more
    // than 10 deep across all of them.
    for (let y = 0; y < 8; y++) for (let x = 1; x <= 9; x++) addWater(f, x, y, 12);
    run(f, 90);
    let far = 0;
    for (let y = 0; y < 8; y++) for (let x = 16; x <= 22; x++) far += f.depth[at(f, x, y)];
    expect(far).toBeGreaterThan(1);                       // it got over the sill

    // And then it STOPS at the sill, which is the right answer and not the
    // obvious one: a sill cannot drain the basin behind it below its own top by
    // any steady flow, so the upper side settles about level with it and the
    // lower side sits wherever what crossed put it. Equal levels either side
    // would mean the water had found a way through the ridge.
    const upper = surfaceAt(f, at(f, 4, 4));
    const lower = surfaceAt(f, at(f, 20, 4));
    const sillTop = 4;
    expect(upper).toBeGreaterThan(sillTop - 1.5);
    expect(upper).toBeLessThan(sillTop + 1);
    expect(lower).toBeLessThan(upper - 1);
  });

  test("and the BED is what keeps a flood from emptying it past the sill", () => {
    const dam = (fill: number, bedDrag: number) => {
      const f = createColumnField(24, 8, { ...CALM, bedDrag }, 0.5);
      for (let y = 0; y < 8; y++) {
        for (let x = 0; x < 24; x++) f.ground[at(f, x, y)] = x >= 11 && x <= 12 ? 4 : -6;
      }
      for (let y = 0; y < 8; y++) for (let x = 1; x <= 9; x++) addWater(f, x, y, fill);
      run(f, 90);
      return surfaceAt(f, at(f, 4, 4));
    };
    // Momentum alone overshoots, and what crosses a ridge cannot come back, so
    // a surge drags the basin under the sill that should have held it. Bed
    // friction is quadratic in the flow, so the harder the surge the harder it
    // is braked — and at every size of release it is the bed that leaves more
    // behind.
    for (const fill of [12, 16, 20]) {
      const withBed = dam(fill, FLOW_DEFAULTS.bedDrag);
      expect(withBed).toBeGreaterThan(dam(fill, 0));
      expect(withBed).toBeLessThan(5);
    }
    // And the worst of it is a clear difference, not a rounding one.
    expect(dam(16, FLOW_DEFAULTS.bedDrag)).toBeGreaterThan(dam(16, 0) + 1);
  });
});

describe("the bed shapes the flow, not just its direction", () => {
  test("an edge carries in proportion to the water standing over its sill", () => {
    // The term this whole behaviour rests on. Three cells in a line with the
    // same surfaces and the same head, and only the FLOOR between them
    // changing: the flux out of the middle is exactly proportional to how much
    // water the sill lets past. Before this, all four were identical, so a
    // ridge with an inch over it drained the lake behind it at the lake's full
    // weight.
    const across = (sill: number) => {
      const f = createColumnField(4, 1, CALM, 0.5);
      f.ground[0] = -8; f.ground[1] = sill; f.ground[2] = -8; f.ground[3] = -8;
      addWater(f, 0, 0, 12);            // surface +4
      addWater(f, 1, 0, 4 - sill);      // surface +4, sitting over the sill
      addWater(f, 2, 0, 10);            // surface +2, so a head of 2
      stepFlow(f, 1 / 60);
      return f.fx[1];
    };
    const deep = across(-8), half = across(0), thin = across(2);
    expect(deep).toBeGreaterThan(0);
    expect(half / deep).toBeCloseTo(4 / 12, 3);     // water over the sill: 4 of 12
    expect(thin / deep).toBeCloseTo(2 / 12, 3);     // and 2 of 12
  });

  test("a wave runs at the square root of the depth it runs through", () => {
    // Shallow water's own dispersion relation, which is what makes a surface
    // read as water rather than as jelly: a swell crosses a deep pool quickly
    // and crawls over a shoal.
    const front = (depth: number) => {
      const f = createColumnField(60, 4, CALM, 0.5);
      for (let y = 0; y < 4; y++) for (let x = 0; x < 60; x++) addWater(f, x, y, depth);
      for (let y = 0; y < 4; y++) addWater(f, 2, y, depth * 0.5);   // a bump
      run(f, 1.5);
      let far = 2;
      for (let x = 2; x < 60; x++) if (f.depth[at(f, x, 2)] > depth * 1.02) far = x;
      return (far - 2) * f.cell;                                    // tiles
    };
    for (const depth of [1, 4, 16]) {
      const expected = Math.sqrt(FLOW_DEFAULTS.gravity * depth) * 1.5;
      expect(front(depth)).toBeGreaterThan(expected * 0.8);
      expect(front(depth)).toBeLessThan(expected * 1.2);
    }
    expect(front(16)).toBeGreaterThan(front(4) * 1.5);
    expect(front(4)).toBeGreaterThan(front(1) * 1.5);
  });

  test("how far the ground falls away BEYOND an edge does not drive the water over it", () => {
    // Hydrostatic reconstruction, and the thing it is for. A sheet standing on
    // a plateau with water far below was driven by the whole surface
    // difference — ten half steps of pressure gradient across a quarter of a
    // tile, which no depth of water in the cell could produce. It evacuated
    // the cell in a tenth of a second and left a mound where a sheet should
    // have been, worse the higher the plateau, because the head WAS the cliff.
    const sheet = (height: number) => {
      const f = createColumnField(24, 24, CALM, 0.25);
      for (let y = 8; y < 16; y++) for (let x = 8; x < 16; x++) f.ground[at(f, x, y)] = height;
      for (let y = 8; y < 16; y++) for (let x = 8; x < 16; x++) addWater(f, x, y, 2, 1);
      run(f, 0.1);
      return [...Array(8).keys()].map((k) => f.depth[at(f, 8 + k, 11)]);
    };
    const low = sheet(4), high = sheet(30);
    // The same, to the last bit, on a four step step and a thirty step cliff.
    high.forEach((d, k) => expect(d).toBe(low[k]));
    // And it leaves as a SHEET: the middle is still full, the edges have given
    // up a third, and there is a gradient between rather than a collapse.
    expect(low[3]).toBeCloseTo(2, 2);
    expect(low[0]).toBeGreaterThan(1);
    expect(low[0]).toBeLessThan(low[1]);
  });

  test("a river outruns a film over the same ground", () => {
    // Bed friction, and the reason it is not just more `drag`. A flat per
    // second retention takes the same fraction off a torrent and a trickle;
    // the ground does not. Chézy's law is quadratic in the flow and falls off
    // with the depth, so a deep channel barely feels the bed it runs over and
    // a sheet a fraction as deep is stopped by the same ground.
    const steady = (depth: number, bedDrag: number) => {
      // A gentle slope on purpose: down a steeper one the river runs into
      // `MAX_FLOW_SPEED` and the two stop being comparable at all.
      const f = createColumnField(60, 4, { ...CALM, bedDrag }, 0.5);
      for (let y = 0; y < 4; y++) {
        for (let x = 0; x < 60; x++) f.ground[at(f, x, y)] = (60 - x) * 0.25;
      }
      // Held topped up at the head of the slope, so it reaches a steady flow.
      for (let n = 0; n < 60 * 20; n++) {
        for (let y = 0; y < 4; y++) {
          for (const x of [0, 1]) addWater(f, x, y, depth - f.depth[at(f, x, y)]);
        }
        stepFlow(f, 1 / 60);
      }
      return velocityAt(f, 25, 2).vx;
    };
    const bed = FLOW_DEFAULTS.bedDrag;
    const film = steady(0.4, bed), river = steady(3, bed);
    expect(film).toBeGreaterThan(0);                   // the film still creeps
    expect(river).toBeGreaterThan(film * 1.7);         // 1.00 against 2.32

    // Without a bed there is nothing to tell them apart, and the thin one is
    // if anything the faster, having less of itself to drag along.
    expect(steady(3, 0)).toBeLessThan(steady(0.4, 0));
  });

  test("a groove down a hillside gathers the sheet running over it", () => {
    // The consequence anyone would actually notice. Water released across the
    // top of a plane spreads evenly; cut a shallow valley down the middle and
    // it finds it, because the water that gets there is deeper and deeper
    // water pulls harder.
    const share = (groove: boolean) => {
      const f = createColumnField(40, 16, CALM, 0.5);
      for (let y = 0; y < 16; y++) {
        for (let x = 0; x < 40; x++) {
          const dip = groove && y >= 7 && y <= 8 ? 2 : 0;     // one half step deep
          f.ground[at(f, x, y)] = (40 - x) * 0.35 - dip;
        }
      }
      for (let y = 0; y < 16; y++) for (let x = 1; x <= 3; x++) addWater(f, x, y, 6);
      run(f, 12);
      let mid = 0, all = 0;
      for (let y = 0; y < 16; y++) {
        for (let x = 25; x < 40; x++) {
          const d = f.depth[at(f, x, y)];
          all += d;
          if (y >= 7 && y <= 8) mid += d;
        }
      }
      return mid / all;
    };
    // Two rows of sixteen: an even sheet puts an eighth of itself in them.
    expect(share(false)).toBeCloseTo(0.125, 2);
    expect(share(true)).toBeGreaterThan(0.2);
  });
});

describe("resolution is a detail setting", () => {
  /**
   * The same physical scene at a given number of columns per tile: a plateau
   * eight tiles across with a pour standing on top of it.
   *
   * The pour is a DEPTH, so it is the same body of water however finely the
   * tile is divided — which is the whole point. Everything measured below is
   * in tiles and in half steps, never in columns.
   */
  const TILES = 20;
  function plateau(cpt: number) {
    const n = TILES * cpt;
    const f = createColumnField(n, n, CALM, 1 / cpt);
    for (let cy = 0; cy < n; cy++) {
      for (let cx = 0; cx < n; cx++) {
        const tx = Math.floor(cx / cpt), ty = Math.floor(cy / cpt);
        f.ground[cy * n + cx] = tx >= 6 && tx <= 13 && ty >= 6 && ty <= 13 ? 8 : 0;
      }
    }
    for (let ty = 8; ty <= 11; ty++) {
      for (let tx = 8; tx <= 11; tx++) {
        for (let dy = 0; dy < cpt; dy++) {
          for (let dx = 0; dx < cpt; dx++) addWater(f, tx * cpt + dx, ty * cpt + dy, 14, 1);
        }
      }
    }
    return f;
  }

  const wetTiles = (f: ColumnField, cpt: number) => {
    let n = 0;
    for (let ty = 0; ty < TILES; ty++) {
      for (let tx = 0; tx < TILES; tx++) {
        let any = false;
        for (let dy = 0; dy < cpt && !any; dy++) {
          for (let dx = 0; dx < cpt && !any; dx++) {
            if (f.depth[at(f, tx * cpt + dx, ty * cpt + dy)] > f.params.dryDepth) any = true;
          }
        }
        if (any) n++;
      }
    }
    return n;
  };

  /**
   * How far the water has got from the middle, weighted by how much of it is
   * there, in TILES.
   *
   * Volume-weighted on purpose. Counting wet columns, or averaging over them,
   * measures the FRINGE as much as the water — and the fringe is exactly what
   * a finer grid resolves more of, so those metrics drift with resolution even
   * when the body of water has not moved at all.
   */
  const meanRadius = (f: ColumnField, cpt: number) => {
    let vol = 0, sum = 0;
    const mid = TILES / 2;
    for (let cy = 0; cy < f.ny; cy++) {
      for (let cx = 0; cx < f.nx; cx++) {
        const d = f.depth[at(f, cx, cy)];
        if (d <= 0) continue;
        vol += d;
        sum += d * Math.hypot(cx / cpt - mid, cy / cpt - mid);
      }
    }
    return sum / vol;
  };

  test("the same pour off the same plateau settles the same however fine the grid", () => {
    // The bug this guards. Every length in the scheme used to be counted in
    // CELLS, so halving the cell size halved the head across one of them for
    // the same hillside and the water became slower and stickier: the same
    // pour settled over 986 tiles at two columns and 385 at four.
    const runs = [1, 2, 4].map((cpt) => {
      const f = plateau(cpt);
      run(f, 60);
      return { cpt, tiles: wetTiles(f, cpt), radius: meanRadius(f, cpt), water: totalWater(f) / cpt ** 2 };
    });

    const tiles = runs.map((r) => r.tiles);
    const lo = Math.min(...tiles), hi = Math.max(...tiles);
    // Within a seventh of each other — 348, 368 and 390 tiles as it stands.
    // Not identical: a finer grid resolves a thinner fringe at the edge of the
    // sheet, and that IS the detail being bought. What must not change is
    // where the water ends up, and before the fix these were 986 and 385.
    expect(lo).toBeGreaterThan(200);
    expect(hi - lo).toBeLessThan(lo * 0.15);

    // And it is the same body of water in the same place, which is the claim
    // the tile count can only gesture at: 8.71, 8.32 and 8.42 tiles out. Half a
    // tile of slack, not the quarter it used to take — the fluid keeps its
    // momentum now, and a livelier one lands a little differently on a coarse
    // grid than on a fine one. On a body eight tiles across that is 5%.
    const radii = runs.map((r) => r.radius);
    expect(Math.max(...radii) - Math.min(...radii)).toBeLessThan(0.5);

    // And the same water in physical terms: depth is a height, so a tile's
    // worth of it is the sum over that tile's columns divided by their number.
    for (const r of runs) expect(r.water).toBeCloseTo(runs[0].water, 3);
  });

  test("and it gets there in the same time", () => {
    const spread = [1, 2, 4].map((cpt) => {
      const f = plateau(cpt);
      run(f, 5);
      const early = wetTiles(f, cpt);
      run(f, 55);
      return early / wetTiles(f, cpt);
    });
    // Most of the way there after five seconds, at every resolution. Before the
    // fix the fine grid was still less than half settled at that point.
    for (const s of spread) expect(s).toBeGreaterThan(0.8);
  });

  test("a released slug travels the same distance whatever the grid", () => {
    // What makes the above true: the only speed in the scheme is gravity and
    // the depth, and both are in tiles, so the grid cannot touch either.
    const travel = (cpt: number) => {
      const n = 40 * cpt;
      const f = createColumnField(n, 4 * cpt, CALM, 1 / cpt);
      // One tile of water, four deep, released along the left edge.
      for (let cy = 0; cy < 4 * cpt; cy++) {
        for (let d = 0; d < cpt; d++) addWater(f, d, cy, 4);
      }
      // Where the water IS, weighted by how much of it, not how far the
      // thinnest trace of it got.
      const centre = () => {
        let vol = 0, sum = 0;
        for (let cy = 0; cy < f.ny; cy++) {
          for (let cx = 0; cx < n; cx++) {
            const d = f.depth[at(f, cx, cy)];
            vol += d;
            sum += d * (cx / cpt);
          }
        }
        return sum / vol;
      };
      // How far it MOVED. A finer grid puts the slug's centre a fraction of a
      // tile further in to start with, which is the initial condition being
      // drawn more precisely and has nothing to do with the flow.
      const from = centre();
      run(f, 2);
      return centre() - from;
    };
    const reach = [1, 2, 4].map(travel);
    expect(Math.min(...reach)).toBeGreaterThan(1);          // it really moved
    expect(Math.max(...reach) - Math.min(...reach)).toBeLessThan(0.7);
  });
});

describe("velocity", () => {
  test("points downhill where water is running", () => {
    const f = flat(20, 8);
    for (let y = 0; y < 8; y++) for (let x = 0; x < 20; x++) f.ground[at(f, x, y)] = (20 - x) * 2;
    for (let y = 2; y <= 5; y++) addWater(f, 1, y, 10);
    // Sampled while the front is passing. Three seconds later it has run to the
    // bottom and that cell is dry again, which is the sim working, not failing.
    run(f, 1);
    const { vx } = velocityAt(f, 6, 3);
    expect(vx).toBeGreaterThan(0);                        // toward the low end
  });

  test("a thin film does not report a runaway speed", () => {
    // Velocity is flux over depth, and that ratio explodes across a film: an
    // unclamped 0.07-deep front measured 58 units per second.
    const f = flat(20, 8);
    for (let y = 0; y < 8; y++) for (let x = 0; x < 20; x++) f.ground[at(f, x, y)] = (20 - x) * 2;
    for (let y = 2; y <= 5; y++) addWater(f, 1, y, 10);
    for (let n = 0; n < 600; n++) {
      stepFlow(f, 1 / 60);
      for (let x = 0; x < 20; x++) {
        const { vx, vy } = velocityAt(f, x, 3);
        expect(Math.abs(vx)).toBeLessThanOrEqual(MAX_FLOW_SPEED);
        expect(Math.abs(vy)).toBeLessThanOrEqual(MAX_FLOW_SPEED);
      }
    }
  });

  test("is zero where there is no water", () => {
    const f = flat();
    expect(velocityAt(f, 4, 4)).toEqual({ vx: 0, vy: 0 });
  });
});

describe("edges", () => {
  test("the map boundary is a wall — nothing leaks off the side", () => {
    const f = flat(12, 12);
    for (let y = 0; y < 12; y++) for (let x = 0; x < 12; x++) f.ground[at(f, x, y)] = -x;
    addWater(f, 1, 6, 40);
    const before = totalWater(f);
    run(f, 40);
    expect(totalWater(f)).toBeCloseTo(before, 2);
  });

  test("unless the edge is OPEN, when what reaches it has left the world", () => {
    // A map is a piece of somewhere larger. Walled in, a spring eventually
    // floods the whole of it and the only way out is a hole somebody had to
    // dig — which is a plughole, not somewhere to go.
    const spread = (open: boolean) => {
      const f = flat(24, 24);
      setOpenEdge(f, open);
      for (let y = 10; y <= 13; y++) for (let x = 10; x <= 13; x++) addWater(f, x, y, 20);
      run(f, 60);
      return totalWater(f);
    };
    expect(spread(false)).toBeCloseTo(320, 3);      // walled in, every drop stays
    // Open, most of it goes. Not all: this is a flat plain, and friction
    // leaves a film on one whatever is at the far side of it. An open edge
    // lets water off, it does not suck.
    expect(spread(true)).toBeLessThan(320 * 0.3);
  });

  test("and on ground that slopes towards it, all of it goes", () => {
    const f = flat(24, 24);
    setOpenEdge(f, true);
    for (let y = 0; y < 24; y++) {
      for (let x = 0; x < 24; x++) f.ground[at(f, x, y)] = (24 - x) * 0.5;
    }
    for (let y = 10; y <= 13; y++) for (let x = 4; x <= 7; x++) addWater(f, x, y, 20);
    run(f, 60);
    // A twelfth of it left, and none of that standing: the deepest thing on
    // the map is under the slope threshold that stopped it, which is thinner
    // than the renderer's own floor. Nothing you could see stayed behind.
    expect(totalWater(f)).toBeLessThan(320 * 0.12);
    expect(Math.max(...f.depth)).toBeLessThan(f.params.minSlope * f.cell);
  });

  test("an open edge leaves the middle of the map alone", () => {
    // Only the outermost ring is emptied, so a basin that never touches it
    // behaves exactly as it does walled in — to the last bit.
    const bowl = (open: boolean) => {
      const f = flat(24, 24, 0);
      setOpenEdge(f, open);
      for (let y = 0; y < 24; y++) {
        for (let x = 0; x < 24; x++) {
          f.ground[at(f, x, y)] = Math.hypot(x - 12, y - 12) < 7 ? -6 : 8;
        }
      }
      for (let y = 8; y <= 16; y++) {
        for (let x = 8; x <= 16; x++) if (Math.hypot(x - 12, y - 12) < 7) addWater(f, x, y, 6);
      }
      run(f, 30);
      return depths(f);
    };
    const walled = bowl(false), opened = bowl(true);
    walled.forEach((d, i) => expect(opened[i]).toBe(d));
  });

  test("a spring and an open edge settle into a standing flow", () => {
    // What a river is: water arriving at one end, leaving at the other, and
    // the same amount of it on the map from one minute to the next.
    const f = flat(32, 12, 0);
    for (let y = 0; y < 12; y++) {
      for (let x = 0; x < 32; x++) f.ground[at(f, x, y)] = (30 - x) * 0.4;
    }
    setOpenEdge(f, true);
    const pour = (seconds: number) => {
      for (let n = 0; n < seconds * 60; n++) {
        for (let y = 4; y <= 7; y++) addWater(f, 2, y, 8 / 60);
        stepFlow(f, 1 / 60);
      }
    };
    pour(40);
    const a = totalWater(f);
    pour(40);
    // Still holding about as much forty seconds later: what comes in goes off
    // the side. Walled in it would simply have kept filling.
    expect(Math.abs(totalWater(f) - a)).toBeLessThan(a * 0.2);
    expect(a).toBeGreaterThan(1);                    // and there IS a river
  });

  test("adding water outside the field is ignored, not a crash", () => {
    const f = flat(8, 8);
    addWater(f, -1, 4, 10);
    addWater(f, 99, 4, 10);
    expect(totalWater(f)).toBe(0);
  });

  test("wet count grows as it spreads and settles", () => {
    const f = flat(21, 21);
    addWater(f, 10, 10, 80);
    const start = wet(f);
    run(f, 30);
    expect(wet(f)).toBeGreaterThan(start);
  });
});

describe("a puddle has an edge", () => {
  test("a film stops spreading instead of staining outward forever", () => {
    // Frictionless water on a perfectly flat plane really does spread without
    // limit, so this is the stick depth doing its job, not the physics.
    const f = flat(41, 41);
    addWater(f, 20, 20, 60);
    run(f, 40);
    // Measured at a depth you could SEE. Below the stick depth the rule leaves
    // a damp fringe behind, which is the point of it — that is ground the water
    // passed over, not water.
    const VISIBLE = 0.14;
    const reach = (min: number) => {
      let r = 0;
      for (let y = 0; y < 41; y++) {
        for (let x = 0; x < 41; x++) {
          if (f.depth[at(f, x, y)] > min) {
            r = Math.max(r, Math.abs(x - 20) + Math.abs(y - 20));
          }
        }
      }
      return r;
    };
    const settled = reach(VISIBLE);
    run(f, 60);
    expect(reach(VISIBLE)).toBeLessThanOrEqual(settled + 1);
    expect(settled).toBeLessThan(20);                  // a bounded puddle
    expect(totalWater(f)).toBeCloseTo(60, 2);          // and nothing was lost
  });

  test("but it does NOT cling to a slope, which a depth threshold would cause", () => {
    // The rule is a minimum SLOPE, not a minimum depth. A depth threshold stops
    // a shallow sheet wherever it happens to be, including halfway down a
    // hillside; a hillside always has a gradient, so it drains whatever its
    // depth. Poured onto the TOP of a continuous incline, with a flat floor at
    // the bottom to collect in: nothing should be left on the slope itself.
    const f = flat(24, 8);
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 24; x++) f.ground[at(f, x, y)] = x < 20 ? (20 - x) * 1.5 : 0;
    }
    for (let y = 2; y <= 5; y++) addWater(f, 2, y, 10, 1);
    run(f, 60);
    let onSlope = 0, atFoot = 0, deepest = 0;
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 18; x++) {
        onSlope += f.depth[at(f, x, y)];
        deepest = Math.max(deepest, f.depth[at(f, x, y)]);
      }
      for (let x = 18; x < 24; x++) atFoot += f.depth[at(f, x, y)];
    }
    expect(atFoot).toBeGreaterThan(onSlope * 3);       // most of it is at the bottom
    // And what is left is a FILM, not a puddle: nothing standing on the
    // hillside is deeper than the slope threshold leaves behind, which is
    // thinner than the renderer's floor and so is nothing you can see.
    expect(deepest).toBeLessThan(f.params.minSlope * f.cell);
  });
});

describe("per-material drag", () => {
  test("a thicker fluid keeps less of its momentum on near-level ground", () => {
    // The one property distinguishing one fluid from another now that depth,
    // rest level and choppiness are gone with the flat plane.
    //
    // Measured on the FLAT, not on a slope: down a steep drop the flow is
    // limited by how much water there is rather than by momentum, so drag makes
    // no difference there at all — which is correct, and cost me a test.
    //
    // And measured on a GENTLE release rather than a collapsing pile, which
    // cost me the same test twice. The bed's drag is quadratic in the flow, so
    // in anything violent it is the bed that decides and the fluid's own
    // damping barely registers. A fluid is unlike another fluid where the flow
    // is slow, which is the regime a linear damping describes.
    // And measured on the values that SHIP, not on a pair chosen to make the
    // point. This used to hardcode 0.30 and 0.55; when water's damping was cut
    // the fluids were retuned around it and this went on passing while the two
    // of them had become all but indistinguishable in the game.
    const reach = (retain: number) => {
      const f = flat(61, 61);
      setMaterialDrag(f, 1, retain);
      for (let y = 28; y <= 32; y++) for (let x = 28; x <= 32; x++) addWater(f, x, y, 4, 1);
      run(f, 90);
      // How far it got, weighted by how much of it got there. Counting wet
      // cells measures the fringe, and the fringe is not monotone in damping:
      // a fluid that keeps its momentum heaps and slops rather than creeping
      // evenly outward, so by that measure sludge can look the further-spread
      // of the two.
      let vol = 0, sum = 0;
      for (let y = 0; y < 61; y++) {
        for (let x = 0; x < 61; x++) {
          const d = f.depth[at(f, x, y)];
          if (d <= 0) continue;
          vol += d;
          sum += d * Math.hypot(x - 30, y - 30);
        }
      }
      return sum / vol;
    };
    // The shipped pair. `world/water/materials` owns the numbers; the solver
    // only has to make a difference of them, and this is the size of difference
    // that difference has to make.
    expect(reach(0.45)).toBeLessThan(reach(0.9) * 0.9);     // 9.3 against 11.0
  });

  test("a material with no drag set uses the field default", () => {
    const f = flat(8, 8);
    expect(f.dragOf[2]).toBe(0);
    addWater(f, 4, 4, 5, 2);
    run(f, 2);
    expect(f.depth.some((d) => d > 0)).toBe(true);     // it still flows
  });
});

/**
 * WHAT A FRAME ACTUALLY INTEGRATES, which is not what it was asked for.
 *
 * `substepsFor` stops at MAX_SUBSTEPS and drops the rest, so the simulation
 * runs slower than real time on a long frame. That is the backstop and it is
 * right. What is NOT right is handing the whole frame to everything else —
 * the springs, the pipes, the drips — while the flow only advanced part of
 * it, which is a map gaining water it has had no time to move.
 *
 * A backgrounded tab is the case that matters: rAF throttles to about one
 * frame a second, sixty times what the water can take in one go.
 */
describe("a frame longer than the water can take", () => {
  test("stops at the ceiling and says so, rather than stretching a step", () => {
    const f = flat(16, 16);
    addWater(f, 8, 8, 4, 1);
    const asked = 1.0;
    const plan = substepsFor(f, asked);
    const got = plan.reduce((a, b) => a + b, 0);
    expect(plan.length).toBe(12);                    // MAX_SUBSTEPS
    expect(got).toBeLessThan(asked);                 // the rest is dropped
    expect(got).toBeCloseTo(maxStep(f), 12);         // and this is how much
  });

  test("maxStep is what a caller must clamp to, and clamping makes it exact", () => {
    const f = flat(16, 16);
    addWater(f, 8, 8, 4, 1);
    const clamped = Math.min(1.0, maxStep(f));
    const plan = substepsFor(f, clamped);
    expect(plan.reduce((a, b) => a + b, 0)).toBeCloseTo(clamped, 12);
  });

  /**
   * THE FAULT ITSELF, as volume. A spring pours in proportion to the time it
   * is given, so giving it the frame while the flow takes the ceiling puts
   * water on the map at several times the rate the map can move it.
   */
  test("a source given the whole frame outruns a flow given the ceiling", () => {
    const pourFor = (dt: number, steps: number, clamp: boolean) => {
      const f = flat(16, 16);
      for (let n = 0; n < steps; n++) {
        const h = clamp ? Math.min(dt, maxStep(f)) : dt;
        addWater(f, 8, 8, 2 * h, 1);                 // a spring: rate x time
        stepFlow(f, h);
      }
      return totalWater(f);
    };
    // Five seconds of wall clock, in frames a second long.
    const loose = pourFor(1.0, 5, false);
    const tight = pourFor(1.0, 5, true);
    // The flow advanced the same either way — five ceilings — but the loose
    // run poured five whole seconds into it.
    expect(loose).toBeGreaterThan(tight * 4);
    const f = flat(16, 16);
    expect(tight).toBeCloseTo(5 * 2 * maxStep(f), 6);
  });
});
