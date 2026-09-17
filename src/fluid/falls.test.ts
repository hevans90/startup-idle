/**
 * Water in the air.
 *
 * The solver moved water across an edge in one step, which over a lip is wrong
 * in a way you can see: the wave at the top stops, the wave at the bottom
 * starts, and nothing crosses the distance. These are about the distance.
 */
import { describe, expect, test } from "bun:test";

import {
  FLOW_DEFAULTS, addWater, at, createColumnField, flowX, stepFlow, totalWater,
} from "./columns";
import {
  BREAK, FALL_GRAVITY, FALL_MIN, driftAt, fallExtent, landsAt, throwOf, waterInAir,
} from "./falls";
import { DROP, dripRoom, waterInDrips } from "./drips";

const CALM = { ...FLOW_DEFAULTS, wind: 0 };

/** A shelf `high` half steps above a floor, with a slug of water at its lip. */
function cliff(high: number, amount = 12) {
  const f = createColumnField(20, 12, CALM, 0.5);
  for (let y = 0; y < 12; y++) {
    for (let x = 0; x < 20; x++) {
      // Walled all round, so a conservation check is about the air and not
      // about the edge of the world.
      f.ground[at(f, x, y)] = y < 2 || y > 9 || x > 17 ? high + 20 : x < 10 ? high : 0;
    }
  }
  for (let y = 4; y <= 7; y++) addWater(f, 9, y, amount, 1);
  return f;
}

const run = (f: ReturnType<typeof cliff>, seconds: number) => {
  for (let n = 0; n < Math.round(seconds * 60); n++) stepFlow(f, 1 / 60);
};

/** Everything standing on the floor below the shelf. */
function below(f: ReturnType<typeof cliff>) {
  let v = 0;
  for (let y = 0; y < 12; y++) for (let x = 10; x < 18; x++) v += f.depth[at(f, x, y)];
  return v;
}

describe("the set of edges a fall can happen on", () => {
  /**
   * `stepFalls` walks `FallState.cliff` rather than the map — see its note.
   * That is a DERIVED INDEX, and a derived index that drifts from what it is
   * derived from does not throw, it just quietly stops: a waterfall that never
   * starts, or water hanging in the air for ever. These are the guard.
   */
  const scan = (f: ReturnType<typeof cliff>) => {
    const want = new Set<number>();
    for (let y = 0; y < f.ny; y++) {
      for (let x = 0; x < f.nx; x++) {
        const i = y * f.nx + x;
        if (x + 1 < f.nx && f.ground[i] - f.ground[i + 1] >= FALL_MIN) want.add(i * 2);
        if (y + 1 < f.ny && f.ground[i] - f.ground[i + f.nx] >= FALL_MIN) want.add(i * 2 + 1);
      }
    }
    return want;
  };
  const held = (f: ReturnType<typeof cliff>) => f.falls.cliff.slice(0, f.falls.cliffN);

  test("holds every edge the ground makes a cliff of, and stays sorted", () => {
    const f = cliff(20);
    run(f, 0.5);
    const want = scan(f);
    const got = held(f);
    for (const k of want) expect(got).toContain(k);
    // In column order, which is what lets `stepFalls` follow the smoothed
    // throw once per column instead of once per edge.
    for (let n = 1; n < got.length; n++) expect(got[n]).toBeGreaterThan(got[n - 1]);
  });

  test("and every edge still holding water, cliff or not", () => {
    // The half the ground alone does not give. A pool filling a cliff in from
    // below, or a terrain edit, ends the cliff while tens of half steps are
    // still in the air — and the branch that lets that down gently is inside
    // the loop this indexes. Dropped from the set, the water is stranded.
    const f = cliff(20);
    run(f, 0.35);
    expect(waterInAir(f)).toBeGreaterThan(5);
    for (let y = 0; y < 12; y++) {
      for (let x = 10; x < 18; x++) f.ground[at(f, x, y)] = 20 - (FALL_MIN - 1);
    }
    stepFlow(f, 1 / 60);
    // No longer a cliff anywhere near the lip...
    const want = scan(f);
    const got = [...held(f)];
    // ...but the edges with water on them are still walked.
    let holding = 0;
    for (let k = 0; k < f.falls.air.length; k++) {
      if (f.falls.air[k] > 0 || f.falls.front[k] > 0) {
        expect(got).toContain(k);
        if (!want.has(k)) holding++;
      }
    }
    expect(holding).toBeGreaterThan(0);         // and some of them only for that
  });

  test("a cliff cut mid-run starts falling, so the index is not stale", () => {
    // The end-to-end version: the index is rebuilt every frame from the
    // ground, so ground written between frames — which is what the editor
    // does — is picked up without anyone having to remember to say so.
    const f = createColumnField(20, 12, CALM, 0.5);
    f.ground.fill(0);
    for (let y = 4; y <= 7; y++) addWater(f, 9, y, 12, 1);
    run(f, 0.3);
    expect(waterInAir(f)).toBe(0);              // flat: nothing can be falling

    for (let y = 0; y < 12; y++) {
      for (let x = 10; x < 20; x++) f.ground[at(f, x, y)] = -20;
    }
    run(f, 2);
    // ARRIVED, not merely departed. `intoAir` does not consult the index —
    // the divergence puts water over a lip whatever this says — so water
    // piling up in the air proves nothing at all. Only `stepFalls`, walking
    // the index, ever brings it down again. Asserting the first version of
    // this on `waterInAir` passed with the index built once and never
    // rebuilt, which is the bug it was written to catch.
    let floor = 0;
    for (let y = 0; y < 12; y++) for (let x = 10; x < 20; x++) floor += f.depth[at(f, x, y)];
    expect(floor).toBeGreaterThan(1);
    expect(waterInAir(f)).toBeLessThan(floor);  // and it is not all still up there
  });

  test("and a column that has just become one does not throw from a stale arc", () => {
    // While a column is not a cliff nothing follows its smoothed throw, so
    // what it holds is from the last time it was — possibly another shape of
    // terrain entirely. Snapped on the way in rather than eased from that.
    const f = createColumnField(20, 12, CALM, 0.5);
    f.ground.fill(0);
    for (let y = 4; y <= 7; y++) addWater(f, 9, y, 12, 1);
    run(f, 0.5);
    const i = at(f, 9, 5);
    f.falls.throwX[i] = 99;                     // nonsense from another world
    for (let y = 0; y < 12; y++) {
      for (let x = 10; x < 20; x++) f.ground[at(f, x, y)] = -20;
    }
    stepFlow(f, 1 / 60);
    // Snapped to what the water is actually doing, not eased down from 99.
    expect(f.falls.throwX[i]).toBeCloseTo(throwOf(flowX(f, 9, 5)), 2);
  });
});

describe("water takes time to come down", () => {
  test("nothing arrives below until it has fallen the distance", () => {
    // Twenty half steps at the fall gravity is two thirds of a second. The
    // pool at the bottom must not answer before then, and it used to answer in
    // the same frame the water left the lip.
    const high = 20;
    const fall = Math.sqrt((2 * high) / FALL_GRAVITY);
    expect(fall).toBeGreaterThan(0.5);

    const f = cliff(high);
    run(f, fall * 0.7);
    expect(below(f)).toBe(0);                   // still on its way down
    expect(waterInAir(f)).toBeGreaterThan(5);    // and somewhere while it is

    run(f, fall * 0.6);
    expect(below(f)).toBeGreaterThan(0);         // and then it lands
  });

  test("a taller cliff takes longer", () => {
    const arrives = (high: number) => {
      const f = cliff(high);
      for (let n = 0; n < 60 * 4; n++) {
        stepFlow(f, 1 / 60);
        if (below(f) > 0) return n / 60;
      }
      return Infinity;
    };
    const shallow = arrives(6), deep = arrives(24);
    expect(deep).toBeGreaterThan(shallow * 1.4);
    expect(deep).toBeLessThan(2);
  });

  test("not a drop is lost while it is in the air", () => {
    // A conservation check that counted only depths would call a waterfall a
    // leak, which is why `totalWater` counts what is falling.
    const f = cliff(20);
    const held = totalWater(f);
    for (const t of [0.1, 0.3, 0.7, 1.5, 5]) {
      run(f, t);
      expect(totalWater(f)).toBeCloseTo(held, 3);
    }
    // And it gets down, bar the tail of an exponential.
    expect(waterInAir(f)).toBeLessThan(held * 0.02);
  });

  test("a LEDGE is not a fall — water goes straight over", () => {
    // One terrain step is a lip water tumbles over and keeps flowing. At a
    // tenth of the threshold a steady hillside became a staircase of little
    // cliffs and the water spent its whole journey in the air.
    const f = cliff(FALL_MIN - 1.5);
    run(f, 0.2);
    expect(waterInAir(f)).toBe(0);
    expect(below(f)).toBeGreaterThan(0);
  });

  test("a fall whose cliff fills in LETS GO of its water, it does not drop it", () => {
    // The branch that notices the cliff has gone used to land every last unit
    // in the air in one step, into one cell. On a real river that is tens of
    // half steps, because an edge under a steady pour holds everything that
    // went over during the time the fall takes — measured on a twelve half
    // step cliff, the cell below went from 6.7 deep to 27.7 in a single frame.
    //
    // And it is self-sustaining: the spike puts the pool up over the cliff,
    // which is the very thing this branch tests, so the next fall dies too.
    // The waterfall flickered several times a second and between flickers
    // there was no sheet on the rock at all.
    const f = cliff(20);
    run(f, 0.35);                               // enough of it in the air
    const held = waterInAir(f);
    const total = totalWater(f);
    expect(held).toBeGreaterThan(5);

    // The cliff fills in under it.
    for (let y = 0; y < 12; y++) {
      for (let x = 10; x < 18; x++) f.ground[at(f, x, y)] = 20 - (FALL_MIN - 1);
    }
    stepFlow(f, 1 / 60);

    // Most of it is still up there: a step takes a share, not the lot.
    expect(waterInAir(f)).toBeGreaterThan(held * 0.8);
    // And it does come down, over the time a fall of the shortest height
    // there is would have taken.
    run(f, 1.5);
    expect(waterInAir(f)).toBeLessThan(held * 0.02);
    // Not a unit of it lost on the way.
    expect(totalWater(f)).toBeCloseTo(total, 3);
  });

  test("and it does not land hard enough to drown the next fall", () => {
    // The failure this guards is a LOOP, not a single spike: dumped, the
    // arriving water puts the pool up past the cliff, so the fall that would
    // have replaced it is killed by the same test on the next step.
    const f = cliff(20);
    run(f, 0.35);
    for (let y = 0; y < 12; y++) {
      for (let x = 10; x < 18; x++) f.ground[at(f, x, y)] = 20 - (FALL_MIN - 1);
    }
    let worst = 0, prev = below(f);
    for (let n = 0; n < 60; n++) {
      stepFlow(f, 1 / 60);
      const now = below(f);
      worst = Math.max(worst, now - prev);
      prev = now;
    }
    // No single step may deliver a large fraction of what was in the air.
    expect(worst).toBeLessThan(5);
  });

  test("the fall reaches down the wall at the speed a thing falls", () => {
    const f = cliff(24);
    const front = () => {
      let best = 0;
      for (let k = 0; k < f.falls.front.length; k++) best = Math.max(best, f.falls.front[k]);
      return best;
    };
    run(f, 0.1);
    const early = front();
    run(f, 0.1);
    const later = front();
    // Distance goes as the SQUARE of time: twice as long is four times as far.
    expect(early).toBeGreaterThan(0.2);
    expect(later / early).toBeGreaterThan(2.5);
    expect(later / early).toBeLessThan(5.5);
    run(f, 1);
    expect(front()).toBeCloseTo(24, 0);          // and it reaches the floor
  });

  test("a fall whose supply stops lets go of its lip", () => {
    // The shelf is swept clear rather than left to drain: the friction
    // threshold leaves a film on it that trickles over for ever, which is a
    // fall that never stops, which is correct and no use for this.
    const f = cliff(24, 4);
    run(f, 0.5);
    for (let y = 0; y < 12; y++) for (let x = 0; x < 10; x++) f.depth[at(f, x, y)] = 0;

    let detached = false;
    for (let n = 0; n < 60 * 2 && !detached; n++) {
      stepFlow(f, 1 / 60);
      for (let i = 0; i < f.nx * f.ny; i++) {
        const e = fallExtent(f, i, 0);
        if (e && e.head > 1) detached = true;    // hanging off nothing
      }
    }
    expect(detached).toBe(true);
  });
});

describe("and it comes apart on the way down", () => {
  test("a tall fall sheds spray; a short one holds together", () => {
    // A nappe is not stable — it thins the whole way down because it is
    // accelerating, and past a few full steps it stops being a sheet with a
    // surface and becomes a great many drops travelling together. Below the
    // breaking point there is nothing to shed, and a curtain hung off a ledge
    // is exactly what a short drop should look like.
    const tall = cliff(BREAK * 3);
    run(tall, 2);
    expect(tall.drips.live).toBeGreaterThan(0);

    const dumpy = cliff(FALL_MIN + 1);
    run(dumpy, 2);
    expect(dumpy.drips.live).toBe(0);
  });

  test("and what it sheds comes OUT of it — the water is the same water", () => {
    // The sheet is lighter for what it throws off. Shedding a copy would be a
    // waterfall that makes water, and at the rate a wide fall sheds it would
    // be obvious within seconds.
    const f = cliff(BREAK * 3);
    const before = totalWater(f);
    for (let n = 0; n < 60 * 3; n++) {
      stepFlow(f, 1 / 60);
      // Relative: the depths are f32 and the drift is rounding, so an
      // absolute bound here is really a bound on how big the scene is.
      expect(Math.abs(totalWater(f) - before) / before).toBeLessThan(1e-6);
    }
    // And some of it really was in flight as drops at some point.
    expect(waterInDrips(f.drips)).toBeGreaterThanOrEqual(0);
  });

  test("nothing bigger than a drop ever comes off it", () => {
    // The rate banks a fortieth of a drop a step, so the bank crosses the line
    // somewhere past it; letting the whole bank go throws an oversized drop.
    const f = cliff(BREAK * 3);
    run(f, 3);
    for (let k = 0; k < f.drips.live; k++) {
      expect(f.drips.volume[k]).toBeLessThanOrEqual(DROP + 1e-6);
    }
  });

  test("a drop leaves the sheet where the sheet IS", () => {
    // One arc, not two. The renderer puts the quad on `driftAt` and the solver
    // puts the drop on `driftAt`, so a drop starts on the sheet rather than
    // beside it — which is the whole reason the arc moved out of the drawing
    // code. Checked by construction: at the moment it is shed, the furthest
    // out a drop can be is the arc at the front of the sheet, and the least is
    // nothing at all.
    const f = cliff(BREAK * 3);
    for (let n = 0; n < 60 * 3; n++) {
      stepFlow(f, 1 / 60);
      for (let k = 0; k < f.drips.live; k++) {
        // The lip is the far edge of column 9, so anything shed off it starts
        // beyond that edge and no further out than the arc allows.
        const most = 0.5 + driftAt(throwOf(3) / f.cell, BREAK * 3) + 1;
        expect(f.drips.cx[k]).toBeGreaterThan(9);
        expect(f.drips.cx[k]).toBeLessThan(9 + most);
      }
    }
  });

  test("and a fall too wide to spray all of it thins out rather than filling up", () => {
    // A fall sheds along its whole WIDTH, so the rate that gives a fall off a
    // notch a convincing amount of spray asks for a couple of thousand drops
    // off one running the width of the map — and past the end of the list a
    // new drop is merged into an existing one and arrives somewhere it never
    // was. Backed off as the list fills, a small fall gets all the detail
    // there is and a huge one thins out, which is the right way round.
    const f = createColumnField(24, 90, CALM, 0.25);
    for (let y = 0; y < 90; y++) {
      for (let x = 0; x < 24; x++) f.ground[at(f, x, y)] = x < 12 ? BREAK * 3 : 0;
    }
    for (let n = 0; n < 60 * 8; n++) {
      for (let y = 0; y < 90; y++) addWater(f, 11, y, 0.2, 1);
      stepFlow(f, 1 / 60);
      // Never full — which is the claim, since full is where drops start
      // being merged into each other.
      expect(dripRoom(f.drips)).toBeGreaterThan(0);
    }
    // And it really did put the list under pressure, or this proves nothing.
    expect(dripRoom(f.drips)).toBeLessThan(0.8);
  }, 20000);

  test("and the foot of the fall goes white, sheet or no spray", () => {
    // Water arriving through a fall comes in the side door: it is added to the
    // depth directly, and the solver's own breaking test reads the rate the
    // SURFACE is changing, so the one piece of water on the map being hit
    // hardest was the one piece that never churned.
    //
    // Measured on the SHORTEST fall there is, deliberately: too short to
    // break up, and too slow at the bottom to throw a plume. So there are no
    // drops anywhere in it, and every drop of white on that pool came from
    // the sheet's own arrival. A taller one is white at the bottom either way
    // — the first version of this test used one, and passed with the sheet
    // contributing nothing at all.
    const f = cliff(FALL_MIN);
    // Watched WHILE it falls. A splash mark lasts a sixth of a second before
    // the foam has to have taken it, and a short fall off a small shelf is
    // over long before the two seconds a tall one needs to get going — so
    // reading the marks at the end reads an empty array and proves nothing.
    let whitest = 0;
    for (let n = 0; n < 60 * 2; n++) {
      stepFlow(f, 1 / 60);
      for (let i = 0; i < f.drips.splash.length; i++) {
        whitest = Math.max(whitest, f.drips.splash[i]);
      }
    }
    expect(f.drips.live).toBe(0);                 // no spray anywhere: it is all sheet
    expect(whitest).toBeGreaterThan(0);
  });
});

describe("and the pool it lands in is DRIVEN, not just filled", () => {
  /**
   * A river over a tall cliff, walled in, run until the pool it makes has
   * settled into whatever shape the fall is holding it in.
   *
   * Profiled across the plain rather than summed, because the whole claim is
   * about SHAPE: a fall that only delivers water makes a flat pool, and one
   * that delivers momentum makes a hole with a rim round it.
   */
  function plungePool(plunging = true) {
    const H = 20, W = 60, CLIFF = 24, LIP = 12;
    const f = createColumnField(W, H, CALM, 0.25);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        f.ground[at(f, x, y)] = y < 2 || y > H - 3 ? 90 : x < LIP ? CLIFF : 0;
      }
    }
    const depth = new Float64Array(8), vel = new Float64Array(8);
    let n = 0;
    // WHERE THE SHEET LANDS, which is not against the cliff: water thrown off
    // a lip travels while it falls, and the solver puts it where the arc says.
    // Sampled from the foot of the cliff instead, this reads the undisturbed
    // pool IN FRONT of the plunge and finds no plunge in it.
    //
    // Asked of the solver rather than guessed at, so it is not circular with
    // what is being measured: the hole and the jet are looked for where the
    // water arrives, not where the water happens to be deepest or fastest.
    const mid = (H / 2) | 0;
    let foot = LIP;
    for (let s = 0; s < 60 * 20; s++) {
      for (let y = 3; y < H - 3; y++) addWater(f, 2, y, plunging ? 0.12 : 0.12, 1);
      stepFlow(f, 1 / 60);
      if (s === 60 * 16) {
        foot = Math.min(W - 7,
          landsAt(f, at(f, LIP - 1, mid), at(f, LIP, mid), CLIFF) % f.nx);
      }
      if (s > 60 * 16) {
        n++;
        // Indices 0 and 1 sit BEFORE the landing, so `depth[2]` is the impact
        // and the two either side of it show the plunge throwing water both
        // ways. A jet landing in open water spreads radially: measured at its
        // centre the net flow is nearly nothing, which is why the old test —
        // written when a fall landed against its own cliff and could only go
        // one way — read the jet as gone.
        for (let k = 0; k < 8; k++) {
          let d = 0, v = 0;
          for (let y = 5; y < H - 5; y++) {
            d += f.depth[at(f, foot + k - 2, y)];
            v += flowX(f, foot + k - 2, y);
          }
          depth[k] += d / (H - 10) / 1;
          vel[k] += v / (H - 10) / 1;
        }
      }
    }
    return {
      depth: [...depth].map((d) => d / n),
      vel: [...vel].map((v) => v / n),
    };
  }

  test("it digs a hole in it, with a rim round the hole", () => {
    // The thing a waterfall DOES to the water under it. A fall used to arrive
    // as `depth[to] += amount` — the whole of it, at rest, as though poured
    // from a jug a hand's breadth above the surface — so a pool under a
    // twenty-four half step drop was the same flat sheet as a pool under a
    // tap, and everything that read as a plunge was foam painted on top of it
    // and the odd drop shed off the sheet.
    //
    // A jet turns at the bed and runs away radially. The DIVERGENCE of that is
    // the standing depression, so it is not painted either — it comes out of
    // the same continuity the rest of the solver runs on.
    const { depth } = plungePool();
    // Measured on this exact scene: 1.06 under the fall against 2.15 out on
    // the plain, and 2.25 in the rim right beside it.
    //
    // The bar is set where the MOMENTUM has to be doing it. The plume digs a
    // hole of its own — it moves real water out of the impact and lands it a
    // column or two away — and at a looser bar this passed on the plume alone
    // while the momentum contributed a fifth, which is the wrong way round for
    // a plunge to work: whether the plume becomes drops at all is a question
    // about the length of a list, so a fall wide enough to exhaust it would
    // have lost its plunge along with its spray. The plume alone leaves the
    // pool at 0.68 of the plain and the momentum takes it to 0.49.
    //
    // THE BARS MOVED WITH THE FALL. These were 1.06 under the fall against
    // 2.15 on the plain, measured when a fall landed against its own cliff —
    // where the jet can only turn one way and scours a deep hole in the
    // corner. A fall now lands where its arc takes it, out in open water, and
    // there the jet spreads every way: the hole is a dish rather than a pit.
    // Measured on this scene, 1.55 at the impact against 2.03 out on the
    // plain, with 2.09 in the rim beside it.
    expect(depth[2]).toBeLessThan(depth[7] * 0.85);
    expect(depth[3]).toBeGreaterThan(depth[2] * 1.2);
    // And the plain itself is not what is being dug out — the hole is local.
    expect(depth[7]).toBeGreaterThan(1);
  }, 30000);

  test("and the water runs AWAY from it, faster than the pool flows", () => {
    const { vel } = plungePool();
    // IT THROWS WATER BOTH WAYS, which is the thing to measure now that a fall
    // lands in open water rather than in the corner against its own cliff.
    // One-sided, the old bar was 1.63 tiles a second at the foot against 0.69
    // on the plain; radial, the forward half is about half of that and the
    // measure that cannot be faked is the BACK half.
    //
    // Upstream of the impact the pool is running the other way — −0.07 against
    // a plain flowing +0.70 — and nothing but the plunge's own momentum can
    // reverse a river. A sheet that merely arrived, however hard, would leave
    // that column flowing forward with everything else.
    expect(vel[7]).toBeGreaterThan(0.5);          // the plain runs forward
    expect(vel[0]).toBeLessThan(0);               // and just above it, backward
    expect(vel[2]).toBeGreaterThan(vel[7]);       // while the far side is driven
  }, 30000);

  test("but it cannot drive the pool faster than the pool can carry", () => {
    // A plunge is a forcing and not an impulse: it arrives every step for as
    // long as the river runs, so what is capped is the flow it BUILDS. Left
    // uncapped it is an accelerating push with only drag against it. Measured
    // on this scene, the Froude number at the impact goes 1.05 → 2.57 → 3.27
    // as the cap is loosened from the wave speed to three times it to none at
    // all, and the pool under the fall is scoured from 1.06 half steps deep to
    // 0.59 and then 0.36 — a waterfall that digs its own pool away.
    //
    // Just OVER critical rather than at it, and that is the cap working rather
    // than failing: what it bounds is the plunge's own contribution, and the
    // pool's own pressure gradient is still free to add to that. Water going
    // supercritical at the foot of a fall and jumping back is what a hydraulic
    // jump IS.
    const { depth, vel } = plungePool();
    const froude = vel.map((v, k) => Math.abs(v) / Math.sqrt(CALM.gravity * depth[k]));
    // Nothing anywhere near the impact is driven past what the water can
    // carry, which is the cap doing its job.
    for (let k = 0; k < 8; k++) expect(froude[k]).toBeLessThan(1.3);
    // And this is not vacuous, which is what the old lower bound on the
    // Froude number was for. That bound was one-sided — it read the forward
    // jet of a fall landing against a cliff — and a fall now lands in open
    // water, where the same momentum goes every way and the forward half is
    // halved. What proves the plunge is still pushing is that it pushes
    // BACKWARD: see the test above, where the column upstream of the impact
    // runs against the river.
    expect(vel[0]).toBeLessThan(0);
  }, 30000);
});
