/**
 * Pipes: the part that knows about tiles.
 *
 * How a drop falls is `fluid/drips` and is tested there. What is here is which
 * column a mouth hangs over, which way a pipe points when you place one, and
 * that running the map actually produces water.
 */
import { describe, expect, test } from "bun:test";

import { DIR } from "../../iso/dir";
import { createGrid, fillTerrain, idx, setHeight } from "../grid";
import { createPipeNets, findPipeNets } from "./pipe-net";
import {
  COLUMNS_PER_TILE, columnOf, createWaterField, depthAt, drainAt, pourAt, setWaterEdge, stepWater,
  totalVolume, waterInPipes,
} from "./field";
import {
  PIPE_D, PIPE_FULL, PIPE_HEAD, facingFor, layPipe, pipeLevelAt, pipeMouth, runPipes,
} from "./pipes";
import { DROP } from "../../fluid/drips";

const flat = (w = 12, h = 12) => {
  const g = createGrid(w, h);
  fillTerrain(g, 1);
  return g;
};

describe("where a pipe's mouth is", () => {
  test("just BEYOND the face, over the neighbour's own edge column", () => {
    // Which is where something sticking out of a wall is. Over its own tile it
    // would drip onto the cell it is bolted to, which is not what a pipe does.
    const g = flat();
    setHeight(g, 5, 5, 10);
    layPipe(g, 5, 5, DIR.S);                       // S is (x+1, y)
    const m = pipeMouth(g, 5, 5, DIR.S)!;
    expect(m.cx).toBe(columnOf(6));                // the neighbour's near edge
    expect(m.z).toBe(10);                          // the pipe's own invert
  });

  test("and over its own edge where there is no neighbour", () => {
    // A pipe on the rim of the map points at nothing. It still drips.
    const g = flat();
    const m = pipeMouth(g, 11, 5, DIR.S)!;
    expect(m.cx).toBe(columnOf(11) + COLUMNS_PER_TILE - 1);
  });
});

describe("which way a pipe points when you place one", () => {
  test("at the lowest neighbour, which is the side it would drip off", () => {
    // A pipe pointing into a hillside is not a thing anyone means to place.
    const g = flat();
    setHeight(g, 5, 5, 10);
    for (const [x, y] of [[4, 5], [6, 5], [5, 4]]) setHeight(g, x, y, 10);
    setHeight(g, 5, 6, 0);                         // W is (x, y+1)
    expect(facingFor(g, 5, 5)).toBe(DIR.W);
  });

  test("and on flat ground, at a face you can SEE", () => {
    // Every side ties, so the tie-break is the whole answer. N is the top-left
    // face and E the top-right: both point away from the camera, so a pipe that
    // defaults to one is hidden behind its own tile. It picked N for a while,
    // which is how that got noticed.
    const g = flat();
    expect([DIR.S, DIR.W]).toContain(facingFor(g, 5, 5));
  });

  test("off the map is not a choice", () => {
    // The rim is not "lower", it is absent — a pipe on the edge should point
    // inwards at the real drop rather than out into nothing.
    const g = flat();
    setHeight(g, 0, 5, 10);
    setHeight(g, 0, 4, 10);                        // E
    setHeight(g, 0, 6, 10);                        // W
    // N is (x-1, y), which is off the map. S is the only way down.
    expect(facingFor(g, 0, 5)).toBe(DIR.S);
  });
});

describe("a pipe running", () => {
  /**
   * A pipe with something to carry: a puddle at one end and a cliff at the
   * other.
   *
   * Poured once and never topped up, because a pipe MAKES NO WATER — there is
   * no tap on it and never was one that belonged there. It used to be fed a
   * trickle per network so that a pipe you had just placed did something, and
   * what that actually did was fill every pipe on every map out of nowhere.
   * So the rig has to bring its own, which is the honest arrangement and also
   * the stricter test: with nothing being made anywhere, the total is not
   * merely accounted for, it is CONSTANT.
   */
  const rig = () => {
    const g = flat();
    for (let y = 0; y < 12; y++) for (let x = 0; x < 12; x++) setHeight(g, x, y, x < 6 ? 20 : 0);
    const f = createWaterField(g);
    setWaterEdge(f, false);
    layPipe(g, 4, 6, DIR.N);                 // the intake, under the puddle
    layPipe(g, 5, 6, DIR.S);                 // and out over the lip
    for (let y = 5; y <= 7; y++) for (let x = 1; x <= 3; x++) pourAt(f, x, y, 8, 1);
    return { g, f };
  };
  const live = (f: ReturnType<typeof createWaterField>, g: ReturnType<typeof flat>, secs: number) => {
    for (let n = 0; n < Math.round(secs * 60); n++) { runPipes(f, g, 1 / 60); stepWater(f, 1 / 60); }
  };

  test("a pipe on its own makes NO water, however long you leave it", () => {
    // The whole of this test is the number staying at zero. A pipe is a hole
    // for water to get through, not a source, and an empty one on a dry map is
    // simply a grey stub until something is put where it can reach it.
    const g = flat();
    const f = createWaterField(g);
    setWaterEdge(f, false);
    layPipe(g, 5, 6, DIR.S);
    live(f, g, 20);
    expect(totalVolume(f)).toBe(0);
  });

  test("carries what it is given, and none of it goes missing", () => {
    // Counted with `totalVolume`, which counts ALL of it — the columns, what
    // is in the air, what is standing in the pipe and what is hanging at its
    // mouth. Nothing anywhere is making water, so this is the strictest form
    // the check can take: not "accounted for", but unchanged.
    const { g, f } = rig();
    const before = totalVolume(f);
    for (let n = 0; n < 60 * 4; n++) {
      runPipes(f, g, 1 / 60);
      stepWater(f, 1 / 60);
      expect(totalVolume(f)).toBeCloseTo(before, 3);
    }
    expect(waterInPipes(f)).toBeGreaterThan(0);   // and it did pick some up
  });

  test("in DROPS — it is not a continuous trickle", () => {
    // The thing that makes it a pipe and not a spring. A mouth lets go at a
    // fixed size, so unless it is running hard there are frames with nothing
    // in the air at all.
    const { g, f } = rig();
    let sawEmpty = false, sawFull = false;
    for (let n = 0; n < 60 * 3; n++) {
      runPipes(f, g, 1 / 60);
      stepWater(f, 1 / 60);
      if (f.columns.drips.live === 0) sawEmpty = true;
      if (f.columns.drips.live > 0) sawFull = true;
    }
    expect(sawEmpty).toBe(true);
    expect(sawFull).toBe(true);
  });

  test("and what it lets go of is a DROP, not a dribble", () => {
    // That a mouth releases at a fixed volume is `fluid/drips`' invariant and
    // is tested there, on a mouth with nothing else going on. Here the list
    // also holds what the LANDINGS threw back up — a crown's flecks are
    // deliberately smaller than the drop that made them — so the thing to
    // check at this level is that nothing bigger than a drop ever leaves.
    const { g, f } = rig();
    live(f, g, 2);
    for (let k = 0; k < f.columns.drips.live; k++) {
      expect(f.columns.drips.volume[k]).toBeLessThanOrEqual(DROP + 1e-6);
    }
    expect(f.columns.drips.live).toBeGreaterThan(0);
  });
});

describe("pipes that touch are one pipe", () => {
  const flatNet = () => {
    const g = flat(16, 16);
    const f = createWaterField(g);
    setWaterEdge(f, false);
    return { g, f };
  };

  test("a run is one network and two runs apart are two", () => {
    const g = flat(16, 16);
    for (let x = 4; x <= 8; x++) layPipe(g, x, 6, DIR.S);
    for (let x = 4; x <= 8; x++) layPipe(g, x, 12, DIR.S);
    const nets = findPipeNets(g, createPipeNets(g.w, g.h));
    expect(nets.count).toBe(2);
    expect(nets.at[1] - nets.at[0]).toBe(5);
    expect(nets.at[2] - nets.at[1]).toBe(5);
  });

  test("and a run touching corner to corner is NOT one", () => {
    // Adjacency across a FACE, the same rule roads use. Two runs that pass
    // diagonally do not join, which is what anyone painting them expects.
    const g = flat(16, 16);
    layPipe(g, 5, 5, DIR.S);
    layPipe(g, 6, 6, DIR.S);
    expect(findPipeNets(g, createPipeNets(g.w, g.h)).count).toBe(2);
  });

  test("joining two runs makes one, and cutting one keeps the water put", () => {
    // The reason the water is held per CELL. A volume booked against a network
    // would have to be split on every cut, and nothing records which half it
    // was in.
    const { g, f } = flatNet();
    for (let x = 4; x <= 8; x++) layPipe(g, x, 6, DIR.S);
    for (const i of [4, 5, 6, 7, 8]) f.pipe[idx(g, i, 6)] = 0.4;
    const held = waterInPipes(f);
    layPipe(g, 6, 6, 0);                     // cut it in the middle
    expect(findPipeNets(g, createPipeNets(g.w, g.h)).count).toBe(2);
    // The cut cell's own water is orphaned, but nothing in either half moved.
    expect(f.pipe[idx(g, 4, 6)]).toBeCloseTo(0.4, 6);
    expect(f.pipe[idx(g, 8, 6)]).toBeCloseTo(0.4, 6);
    expect(waterInPipes(f)).toBe(held);
  });
});

describe("a port is one rule, whichever way the water is going", () => {
  const run = (f: ReturnType<typeof createWaterField>, g: ReturnType<typeof flat>, secs: number) => {
    for (let n = 0; n < Math.round(secs * 60); n++) { runPipes(f, g, 1 / 60); stepWater(f, 1 / 60); }
  };

  /** Flat ground under a pool, walled in so nothing runs off. */
  const pond = (depth = 5) => {
    const g = flat(16, 16);
    const f = createWaterField(g);
    setWaterEdge(f, false);
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) pourAt(f, x, y, depth, 1);
    for (let n = 0; n < 120; n++) stepWater(f, 1 / 60);
    return { g, f };
  };

  test("an end under a pool DRAWS from it, with nothing telling it to", () => {
    // The whole point, and the test has to separate it from the mains — which
    // would fill this pipe on its own, just far more slowly. So: the same pipe
    // twice, once standing in a pond and once on dry ground, and a quarter of
    // a second. The pond fills it and the tap has barely started.
    const wet = pond();
    layPipe(wet.g, 5, 7, DIR.S);         // one cell, port under the pond
    const dry = { g: flat(16, 16), f: createWaterField(flat(16, 16)) };
    dry.f = createWaterField(dry.g);
    setWaterEdge(dry.f, false);
    layPipe(dry.g, 5, 7, DIR.S);

    run(wet.f, wet.g, 0.25);
    run(dry.f, dry.g, 0.25);
    expect(waterInPipes(wet.f)).toBeGreaterThan(PIPE_FULL);  // full, and then some
    expect(waterInPipes(dry.f)).toBeLessThan(PIPE_FULL * 0.2);
    // Past full it is communicating vessels: the pipe comes up to the pond's
    // own surface and stops, the extra standing in the slot as pressure.
    expect(pipeLevelAt(wet.g, wet.f, 5, 7)).toBeCloseTo(5, 0);
  });

  test("a drowned spout REVERSES: the same port, the other way", () => {
    // The reason to have done this at all. A fixed rate cannot do it — a pipe
    // that does not know what is outside it goes on pushing into a flood — and
    // here nothing about the pipe changes at all between the two halves of the
    // test. What changes is what is standing outside one of its holes.
    //
    // The spout sits on a LEDGE below the shelf, and that is not decoration:
    // to drown a spout the water outside it has to come up past it, and a
    // spout level with the shelf can only be drowned by a flood that swamps
    // the shelf too. On a ledge there is room to put the water above the one
    // and below the other. (Water is also never pushed ABOVE its source, so
    // there is no version of this where the flood sends water up onto the
    // shelf — it can reach the ledge and no further.)
    const g = flat(16, 16);
    for (let y = 0; y < 16; y++) {
      for (let x = 0; x < 16; x++) setHeight(g, x, y, x <= 4 ? 20 : x === 5 ? 8 : 0);
    }
    const f = createWaterField(g);
    setWaterEdge(f, false);
    layPipe(g, 4, 6, DIR.N);                 // opens on the shelf
    layPipe(g, 5, 6, DIR.S);                 // and over the ledge's edge
    for (let y = 5; y <= 7; y++) for (let x = 1; x <= 3; x++) pourAt(f, x, y, 8, 1);

    const low = () => {
      let sum = 0;
      for (let y = 0; y < 16; y++) for (let x = 6; x < 16; x++) sum += depthAt(f, x, y);
      return sum;
    };
    const shelf = () => {
      let sum = 0;
      for (let y = 0; y < 16; y++) for (let x = 0; x <= 4; x++) sum += depthAt(f, x, y);
      return sum;
    };

    run(f, g, 3);
    const spouting = waterInPipes(f);
    expect(low()).toBeGreaterThan(0);             // it is discharging, downhill

    // Turn it round. The shelf is wiped dry so nothing is feeding the pipe
    // from above, and the bottom is flooded past the spout but not past the
    // shelf — so the only water that can move is water coming back IN.
    for (let y = 0; y < 16; y++) for (let x = 0; x <= 4; x++) drainAt(f, x, y, Infinity);
    for (let y = 0; y < 16; y++) for (let x = 6; x < 16; x++) pourAt(f, x, y, 12, 1);
    for (let n = 0; n < 60 * 2; n++) stepWater(f, 1 / 60);
    // Dry to within a trace — spray from the flood being poured in lands a
    // hundredth of a unit up there, which is not a route for anything.
    expect(shelf()).toBeLessThan(0.01);
    const held = totalVolume(f);
    run(f, g, 4);

    // It has backed up, and it has come to the FLOOD's own level: the two are
    // communicating vessels through the drowned hole, which is the same rule
    // that was carrying water the other way a moment ago.
    expect(waterInPipes(f)).toBeGreaterThan(spouting * 2);
    expect(pipeLevelAt(g, f, 5, 6)).toBeCloseTo(12, 0);
    // Nothing came over the ground, and nothing anywhere made any — so what
    // is now standing in the pipe can only have come up out of the flood.
    expect(shelf()).toBeLessThan(0.01);
    expect(totalVolume(f)).toBeCloseTo(held, 2);
    void low;
  });

  test("a run CARRIES: water goes in one end and out of the other", () => {
    // Compared against the same map with no pipe on it, because the question
    // is what the PIPE did and not what gravity did — and the first version of
    // this compared two maps a puddle could run off either way. It spilled
    // over the cliff on its own at the same rate through both, so the two
    // numbers came out 5.395 and 5.409, and which of them was larger was a
    // coin toss: measured across three revisions the pipe was worth +0.018,
    // +0.012 and −0.015 of a total of five, while carrying 2.287 units the
    // whole time. It passed for as long as the coin came up heads.
    //
    // So the cliff edge is a PARAPET the pool cannot overtop, and the run is
    // buried under it — which is what an absolute invert is for. Now the pipe
    // is the only way down and the comparison is the whole of what it carried.
    const build = (piped: boolean, secs: number) => {
      const g = flat(16, 16);
      for (let y = 0; y < 16; y++) {
        for (let x = 0; x < 16; x++) setHeight(g, x, y, x < 7 ? 20 : x === 7 ? 28 : 0);
      }
      const f = createWaterField(g);
      setWaterEdge(f, false);
      for (let y = 0; y < 16; y++) for (let x = 0; x < 7; x++) pourAt(f, x, y, 3, 1);
      if (piped) {
        layPipe(g, 4, 7, DIR.N, 20);         // opens uphill, under the puddle
        layPipe(g, 5, 7, DIR.S, 20);         // into its neighbour: interior
        layPipe(g, 6, 7, DIR.S, 20);
        layPipe(g, 7, 7, DIR.S, 20);         // under the parapet and out
      }
      run(f, g, secs);
      let below = 0;
      for (let y = 0; y < 16; y++) for (let x = 8; x < 16; x++) below += depthAt(f, x, y);
      return below;
    };
    expect(build(false, 20)).toBeCloseTo(0, 6);   // sealed: gravity has no route
    // And the pipe has one, and keeps having it — 0.22, 0.88, 1.97 and 4.67
    // at three, six, ten and twenty seconds. A run carries; it does not tip
    // one load over and stop.
    const early = build(true, 6), late = build(true, 20);
    expect(early).toBeGreaterThan(0.5);
    expect(late).toBeGreaterThan(early * 2);
  });

  test("and nothing is created or lost while it carries", () => {
    const g = flat(16, 16);
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) setHeight(g, x, y, x < 8 ? 20 : 0);
    const f = createWaterField(g);
    setWaterEdge(f, false);
    for (let y = 6; y <= 8; y++) for (let x = 2; x <= 4; x++) pourAt(f, x, y, 6, 1);
    for (const [x, d] of [[4, DIR.N], [5, DIR.S], [6, DIR.S], [7, DIR.S]] as const) {
      layPipe(g, x, 7, d);
    }
    const before = totalVolume(f);
    for (let n = 0; n < 60 * 3; n++) {
      runPipes(f, g, 1 / 60);
      stepWater(f, 1 / 60);
      expect(totalVolume(f)).toBeCloseTo(before, 2);
    }
  });

  test("a deep pool PRESSURISES a run, past the crown and into the slot", () => {
    // A pipe under more water than it is tall has nowhere to put the rest of
    // the head except up: past the crown it stands in the slot, which is a
    // pressure head and not a volume the pipe has room for. Where it stops is
    // the pool's own surface, because that is where the head runs out — the
    // same communicating vessels as everywhere else, just above the pipe
    // rather than inside it.
    const g = flat(16, 16);
    const f = createWaterField(g);
    setWaterEdge(f, false);
    for (let x = 4; x <= 8; x++) layPipe(g, x, 7, DIR.S);
    layPipe(g, 4, 7, DIR.N);                 // one opening, under the pool
    // Poured flat over the whole map so it is level from the start: a block
    // dropped on one spot is a dam break, and measuring in the middle of one
    // tells you about the slosh rather than about the pipe.
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) pourAt(f, x, y, 8, 1);
    for (let n = 0; n < 120; n++) stepWater(f, 1 / 60);

    const held = totalVolume(f);
    for (let n = 0; n < 60 * 6; n++) { runPipes(f, g, 1 / 60); stepWater(f, 1 / 60); }
    const at6 = waterInPipes(f);
    for (let n = 0; n < 60 * 6; n++) { runPipes(f, g, 1 / 60); stepWater(f, 1 / 60); }

    expect(at6).toBeGreaterThan(5 * PIPE_FULL);        // past the crown
    expect(waterInPipes(f)).toBeCloseTo(at6, 0);       // and no longer rising
    expect(totalVolume(f)).toBeCloseTo(held, 2);       // out of the pool, not thin air
    let mean = 0;
    for (let x = 4; x <= 8; x++) mean += pipeLevelAt(g, f, x, 7) / 5;
    // Up to about the pool's own surface. About, and not exactly: past the
    // crown the surface inside is a hairline, so the pipe is stiff there and a
    // port trades a little standing head for being able to move water at all
    // — see PORT_BITES. It settles a little under a half step high on eight.
    expect(mean).toBeGreaterThan(PIPE_D);              // genuinely surcharged
    expect(mean).toBeGreaterThan(7);
    expect(mean).toBeLessThan(9.5);
    expect(mean).toBeLessThan(PIPE_D + PIPE_HEAD);     // and nowhere near the rail
  });

  test("a run down a hill carries its water to the BOTTOM", () => {
    // Put it in at the top and it ends up at the foot, which is the whole of
    // what a pipe laid downhill is for. Nothing tells it to go that way.
    const g = flat(16, 16);
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) setHeight(g, x, y, (10 - x) * 2);
    const f = createWaterField(g);
    setWaterEdge(f, false);
    for (let x = 4; x <= 8; x++) layPipe(g, x, 7, DIR.S);
    layPipe(g, 8, 7, DIR.N);                 // sealed at both ends: it stays in
    f.pipe[idx(g, 4, 7)] = PIPE_FULL;             // charged at the high end
    const put = waterInPipes(f);

    for (let n = 0; n < 60 * 8; n++) { runPipes(f, g, 1 / 60); stepWater(f, 1 / 60); }
    expect(waterInPipes(f)).toBeCloseTo(put, 5);  // sealed, so all of it is still there
    expect(f.pipe[idx(g, 8, 7)]).toBeGreaterThan(f.pipe[idx(g, 4, 7)]);
    expect(f.pipe[idx(g, 4, 7)]).toBeLessThan(PIPE_FULL * 0.1);   // the top has drained
  });

  test("a run laid across a ridge goes UNDER it, and joins what it could not", () => {
    // The thing surface pipes could never do. Two pools either side of a ridge
    // taller than both of them: over the ground they are two pools and always
    // will be, and terrain water has no route between them at all. A run laid
    // from one to the other keeps the grade it started at, burrows under the
    // ridge, and they become one body of water that levels out.
    //
    // Nobody tells it to burrow. `layPipe` takes the lower of the ground here
    // and the run it is joining, so a ridge in the way simply does not raise
    // it; the sill rule then does the rest, because a buried invert is below
    // the sill it would otherwise have had to climb.
    const g = flat(20, 20);
    for (let y = 0; y < 20; y++) setHeight(g, 10, y, 20);       // the ridge
    const f = createWaterField(g);
    setWaterEdge(f, false);
    for (let x = 4; x <= 16; x++) layPipe(g, x, 9, DIR.S);
    layPipe(g, 4, 9, DIR.N, g.pipeZ[idx(g, 4, 9)]);            // open, under the pool
    expect(g.pipeZ[idx(g, 10, 9)]).toBe(0);                     // under twenty of rock

    for (let y = 7; y <= 11; y++) for (let x = 1; x <= 8; x++) pourAt(f, x, y, 6, 1);
    const before = totalVolume(f);
    const beyond = () => {
      let sum = 0;
      for (let y = 0; y < 20; y++) for (let x = 11; x < 20; x++) sum += depthAt(f, x, y);
      return sum;
    };
    expect(beyond()).toBe(0);

    for (let n = 0; n < 60 * 25; n++) { runPipes(f, g, 1 / 60); stepWater(f, 1 / 60); }
    expect(beyond()).toBeGreaterThan(0);               // water on the far side
    expect(totalVolume(f)).toBeCloseTo(before, 2);     // and none of it invented
  }, 20000);

  test("and the middle of a buried run is SEALED, so it is a conduit", () => {
    // A hole in the side of a pipe under a hillside opens onto rock. If that
    // were an opening the run would empty into the hill it is crossing, which
    // is not a pipe, it is a leak with extra steps.
    const g = flat(20, 20);
    for (let y = 0; y < 20; y++) setHeight(g, 10, y, 20);
    const f = createWaterField(g);
    setWaterEdge(f, false);
    for (let x = 4; x <= 16; x++) layPipe(g, x, 9, DIR.S);
    layPipe(g, 4, 9, DIR.N, g.pipeZ[idx(g, 4, 9)]);
    // Turn the buried cell's facing so it points at open rock rather than at
    // the next length of pipe: an opening, if anything were listening.
    layPipe(g, 10, 9, DIR.E, g.pipeZ[idx(g, 10, 9)]);
    for (let y = 7; y <= 11; y++) for (let x = 1; x <= 8; x++) pourAt(f, x, y, 6, 1);

    for (let n = 0; n < 60 * 20; n++) { runPipes(f, g, 1 / 60); stepWater(f, 1 / 60); }
    // Nothing has appeared inside the ridge, and the run still carried. A
    // ten-millionth of a unit of float noise is not a leak; a sealed port is a
    // `continue`, and nothing crosses it at all.
    expect(depthAt(f, 10, 8)).toBeLessThan(1e-6);
    expect(waterInPipes(f)).toBeGreaterThan(0);
  }, 20000);
});
