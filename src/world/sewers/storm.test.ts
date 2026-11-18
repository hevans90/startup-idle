/**
 * STORM DRAINS, and outfalls under water. A grate on a trunk's manhole takes
 * down what stands in the street over it, as much as the sewer can carry,
 * and lets it out where the sewer ends; an outfall with water standing over
 * it lets out less, and the sewer backs up behind it. The plan's guards: a
 * flooded street with a drain clears faster than one without, no water is
 * made or lost, and a drowned outfall slows its sewer.
 * @see SEWER_GRATE, plans/pipe-network.md §3, phase 5b
 */
import { describe, expect, test } from "bun:test";

import { commit, createHistory } from "../edit/commands";
import { SEWER_FIT, SEWER_GRATE, createGrid, fillTerrain, idx, setHeight, type Grid } from "../grid";
import { resetCooling } from "../projects/cooling";
import { stepSlop } from "../slop/tanks";
import { structureDef } from "../structures/def";
import { placeCommand } from "../structures/place";
import { createWaterField, depthAt, pourAt, setWaterEdge, stepWater, type WaterField } from "../water/field";
import { layMain, runMains, stormOnDevice } from "../water/mains";
import { H_DRAINS } from "../../fluid/gpu/pipes";
import { shaderTwin } from "../../fluid/gpu/pipes.test-kit";
import { fluidIndexOf } from "../water/materials";
import { foulingIn } from "../water/pollution";
import { DROWNED, OUTFALL_CLEAR, sewerReportsFor, slopInSewers, stepSewers, waterInSewers, type SewerHooks } from "./flow";
import { planLateral, planSewer, planStormDrain, routeSewer } from "./lay";
import { solveSewers } from "./solve";
import { useWorldStore } from "../../state/world.store";

const WATER = fluidIndexOf("water"), SLOP = fluidIndexOf("slop");
const wetOf = (g: Grid) => (x: number, y: number) => g.pool[idx(g, x, y)] > 0;
/** The street's dip: where the flood stands. */
const DIP = { x0: 9, x1: 15, y0: 6, y1: 9 };
const inDip = (x: number, y: number) => x >= DIP.x0 && x <= DIP.x1 && y >= DIP.y0 && y <= DIP.y1;

/**
 * A lake down the west edge, well below the land; a dip in the land with a
 * trunk from the lake to a manhole in the middle of it at (12, 6); and a vibe
 * office whose slop port is at (12, 4).
 */
function street() {
  const g = createGrid(24, 14);
  fillTerrain(g, 1);
  for (let y = 0; y < 14; y++) for (let x = 0; x < 24; x++) setHeight(g, x, y, x <= 3 ? -2 : inDip(x, y) ? 4 : 6);
  for (let y = 0; y < 14; y++) for (let x = 0; x <= 3; x++) g.pool[idx(g, x, y)] = 4;
  commit(g, createHistory(), placeCommand(g, { ...structureDef("office-vibe")!, placement: undefined }, 10, 3)!);
  const a = [...g.structures.values()].find((s) => s.def === "office-vibe")!;
  const route = routeSewer(g, { x: 3, y: 6 }, { x: 12, y: 6 }, wetOf(g))!;
  const p = planSewer(g, route, wetOf(g), { unit: 1, liftPrice: 1 });
  if ("refused" in p) throw new Error(p.refused);
  for (const c of p.cells) { const i = idx(g, c.x, c.y); g.sewer[i] = p.staged.sewer[i]; g.sewerFit[i] = p.staged.sewerFit[i]; }
  g.rev++;
  const f = createWaterField(g);
  setWaterEdge(f, false);
  return { g, a, f, manhole: idx(g, 12, 6) };
}
const grate = (g: Grid, cell: number) => { g.sewer[cell] |= SEWER_GRATE; g.rev++; };
const flood = (f: WaterField, deep: number, material = WATER) => {
  for (let y = DIP.y0; y <= DIP.y1; y++) for (let x = DIP.x0; x <= DIP.x1; x++) pourAt(f, x, y, deep, material);
};
/** Water standing in the dip, half steps over a tile, summed. */
const inStreet = (f: WaterField) => {
  let n = 0;
  for (let y = DIP.y0; y <= DIP.y1; y++) for (let x = DIP.x0; x <= DIP.x1; x++) n += depthAt(f, x, y);
  return n;
};
/** Everything on the map and in the trunks, half steps over a tile: what must not change. */
const all = (g: Grid, f: WaterField) => f.columns.depth.reduce((n, d) => n + d, 0) / 16 + (waterInSewers(g) + slopInSewers(g) * 0.5);
const run = (g: Grid, f: WaterField, secs: number) => {
  for (let k = 0; k < secs * 30; k++) { runMains(f, g, 1 / 30); stepSlop(g, f, new Map(), 0, 1 / 30); stepWater(f, 1 / 30); }
};

describe("a storm drain", () => {
  test("is a grate on a trunk's manhole, where the trunk has ground over it and ends in water", () => {
    const { g, manhole } = street();
    expect(planStormDrain(g, { x: 12, y: 6 })).toEqual({ cell: manhole, manhole: true });
    // On a plain tile of the trunk: the manhole goes in with it.
    expect(planStormDrain(g, { x: 9, y: 6 })).toEqual({ cell: idx(g, 9, 6), manhole: false });
    expect(planStormDrain(g, { x: 12, y: 10 })).toEqual({ refused: "A storm drain goes on a sewer" });
    const out = solveSewers(g).nets[0].exits[0];
    expect(planStormDrain(g, { x: out % g.w, y: (out / g.w) | 0 })).toHaveProperty("refused");
    grate(g, manhole);
    expect(planStormDrain(g, { x: 12, y: 6 })).toEqual({ refused: "It has one already" });
  });

  test("is refused on a sewer that ends only at a processor: rain has nowhere to go", () => {
    const { g } = street();
    const out = solveSewers(g).nets[0].exits[0];
    g.sewerFit[out] = SEWER_FIT.inlet;
    g.rev++;
    expect(planStormDrain(g, { x: 12, y: 6 })).toEqual({ refused: "A storm drain needs a sewer that ends in water" });
  });

  test("the Sewer tool's card lays one: the grate, and the manhole under it where there was none", () => {
    const { g } = street();
    useWorldStore.getState().loadGrid(g);
    const st = useWorldStore.getState(), map = st.grid;
    st.addStormDrainAt({ x: 9, y: 6 });
    const i = idx(map, 9, 6);
    expect(map.sewerFit[i]).toBe(SEWER_FIT.node);
    expect(map.sewer[i] & SEWER_GRATE).toBe(SEWER_GRATE);
    // A connection still comes down into it: it is a manhole in every other way.
    expect(planLateral(map, [{ x: 12, y: 4 }, { x: 12, y: 5 }, { x: 12, y: 6 }], wetOf(map))).not.toHaveProperty("refused");
    st.addStormDrainAt({ x: 9, y: 6 });
    expect(useWorldStore.getState().notice?.text).toBe("It has one already");
  });

  test("a flooded street with a drain clears faster than one without, and no water is made or lost", () => {
    const dry = street(), drained = street();
    grate(drained.g, drained.manhole);
    for (const s of [dry, drained]) flood(s.f, 1.5);
    const before = all(drained.g, drained.f), stood = inStreet(drained.f);
    run(dry.g, dry.f, 30);
    run(drained.g, drained.f, 30);
    // Nowhere to go without one: it stands (a little of it up the dip's banks). With one, a third of it is gone in half a minute.
    expect(inStreet(dry.f)).toBeGreaterThan(stood * 0.9);
    expect(inStreet(drained.f)).toBeLessThan(inStreet(dry.f) * 0.7);
    expect(sewerReportsFor(drained.g).get(0)!.trunk.storm).toBeGreaterThan(0.5);
    // Out of the street, down the trunk and into the lake: the same water, wherever it is.
    expect(all(drained.g, drained.f)).toBeCloseTo(before, 2);
    expect(depthAt(drained.f, 2, 6)).toBeGreaterThan(depthAt(dry.f, 2, 6));
    // And it empties it, down to the puddle a grate leaves.
    run(drained.g, drained.f, 90);
    expect(inStreet(drained.f)).toBeLessThan(stood * 0.25);
    expect(all(drained.g, drained.f)).toBeCloseTo(before, 2);
  }, 60_000);

  test("on the device, the water goes down the grate there: as fast as the host's, none made or lost, and none brought up however late the answers", () => {
    const host = street(), dev = street(), late = street();
    for (const s of [host, dev, late]) { grate(s.g, s.manhole); flood(s.f, 1.5); }
    const twin = shaderTwin(dev.f.columns);
    dev.f.columns.pipes = twin.port;
    late.f.columns.pipes = shaderTwin(late.f.columns, 3).port;
    const before = all(dev.g, dev.f), stood = inStreet(dev.f);
    let spilled = 0;
    for (let k = 0; k < 30 * 30; k++) {
      // The reports are the last map's to have run: read as each does.
      for (const s of [host, late, dev]) {
        runMains(s.f, s.g, 1 / 30); stepSlop(s.g, s.f, new Map(), 0, 1 / 30); stepWater(s.f, 1 / 30);
        if (s !== host) spilled += sewerReportsFor(s.g).get(0)!.trunk.spilled;
      }
    }
    // A sewer with no main on the map is packed all the same, for its grate.
    expect(twin.loads()).toBe(1);
    expect(twin.buffer[H_DRAINS]).toBe(1);
    // The street clears as it does on the host: the same rule, read where the water is.
    expect(inStreet(dev.f)).toBeLessThan(stood * 0.7);
    expect(Math.abs(inStreet(dev.f) / inStreet(host.f) - 1)).toBeLessThan(0.1);
    expect(sewerReportsFor(dev.g).get(0)!.trunk.storm).toBeGreaterThan(0.5);
    // The same water, wherever it is — what is on its way back to the host counted with it.
    const o = twin.offsets(), taken = twin.buffer[o.taken] + twin.buffer[o.taken + 1];
    const seen = stormOnDevice(dev.g, dev.manhole, 0);
    expect(seen).not.toBeNull();
    expect(taken).toBeGreaterThan(1);
    expect(all(dev.g, dev.f) + seen!.depth).toBeCloseTo(before, 1);
    // Never more granted than fits: nothing comes up at the manhole, late or not.
    expect(spilled).toBe(0);
    expect(inStreet(late.f)).toBeLessThan(stood * 0.75);
  }, 90_000);

  test("on the device, slop in the street is counted as it goes down: what comes out is as strong as what went in", () => {
    const { g, f, manhole } = street();
    grate(g, manhole);
    flood(f, 1, SLOP);
    f.columns.pipes = shaderTwin(f.columns).port;
    const before = foulingIn(f);
    for (let k = 0; k < 30 * 40; k++) { runMains(f, g, 1 / 30); stepSlop(g, f, new Map(), 0, 1 / 30); stepWater(f, 1 / 30); }
    // It went down as slop and is slop in the trunk or the lake: not turned to water on the way.
    expect(waterInSewers(g)).toBeLessThan(0.05);
    const after = foulingIn(f) + slopInSewers(g) * 0.5 + stormOnDevice(g, manhole, 0)!.depth;
    expect(after).toBeGreaterThan(before * 0.9);
    expect(after).toBeLessThan(before * 1.02);
    expect(foulingIn(f)).toBeLessThan(before);
  }, 90_000);

  test("takes no more than the sewer carries: it does not bring up at the manhole what it took down", () => {
    const { g, f, manhole } = street();
    grate(g, manhole);
    flood(f, 3);
    let spilled = 0;
    for (let k = 0; k < 30 * 20; k++) {
      runMains(f, g, 1 / 30); stepSlop(g, f, new Map(), 0, 1 / 30); stepWater(f, 1 / 30);
      spilled += sewerReportsFor(g).get(0)!.trunk.spilled;
    }
    expect(spilled).toBe(0);
    const r = sewerReportsFor(g).get(0)!;
    expect(r.trunk.storm!).toBeLessThanOrEqual(r.capacity + 0.05);
  }, 30_000);

  test("slop in the street goes down it too, and comes out as slop: none is made or lost", () => {
    const { g, f, manhole } = street();
    grate(g, manhole);
    flood(f, 1, WATER);
    pourAt(f, 12, 6, 2, SLOP);
    pourAt(f, 12, 7, 2, SLOP);
    const before = foulingIn(f);
    run(g, f, 40);
    // Some of it is in the lake now, fouling it.
    let lake = 0;
    for (let i = 0; i < f.columns.depth.length; i++) if ((i % f.columns.nx) < 16) lake += f.columns.depth[i] * f.columns.foul[i];
    expect(lake).toBeGreaterThan(0.5);
    // What stands on the map, and in the trunk, is what was poured — less what has settled out of the water.
    const now = foulingIn(f) + slopInSewers(g) * 0.5;
    expect(now / before).toBeGreaterThan(0.93);
    expect(now / before).toBeLessThan(1.001);
  }, 30_000);
});

describe("an outfall under water", () => {
  /** Hooks that count what is let out at one tile, and nowhere else: what comes up at a manhole is not let out. */
  const hooks = (at: number, w: number, o: Partial<SewerHooks>): SewerHooks & { out: number } => {
    const h = {
      pay: () => true, room: () => 0, take: () => {}, backedUp: null, out: 0,
      release: (x: number, y: number, n: number) => { if (y * w + x === at) h.out += n; },
      ...o,
    };
    return h;
  };
  /** A trunk with a connection from the office, its tank kept at ten. */
  function sewered() {
    resetCooling();
    const s = street();
    const p = planLateral(s.g, [{ x: 12, y: 4 }, { x: 12, y: 5 }, { x: 12, y: 6 }], wetOf(s.g));
    if ("refused" in p) throw new Error(p.refused);
    layMain(s.g, p.cells, true);
    return { ...s, exit: solveSewers(s.g).nets[0].exits[0] };
  }
  /** What the sewer lets out a second, settled, with so much water standing over its outfall. */
  function lets(over: number): { out: number; state: string; held: number } {
    const { g, f, a, exit } = sewered();
    const tanks = new Map([[a.id, { level: 10 }]]);
    const h = hooks(exit, g.w, { surface: (x, y) => (y * g.w + x === exit ? g.height[exit] + over : -Infinity) });
    let out = 0;
    for (let k = 0; k < 30 * 40; k++) {
      tanks.get(a.id)!.level = 10;
      runMains(f, g, 1 / 30);
      const was = h.out;
      stepSewers(g, tanks, 1 / 30, h);
      if (k >= 30 * 30) out += h.out - was;
    }
    return { out: out / 10, state: sewerReportsFor(g).get(0)!.state, held: slopInSewers(g) };
  }

  test("in the open it lets out all the sewer brings — and with the river lapping at its bank, the same", () => {
    const open = lets(0), lapping = lets(OUTFALL_CLEAR);
    expect(open.out).toBeGreaterThan(0.3);
    expect(open.state).toBe("flowing");
    expect(lapping.out).toBeCloseTo(open.out, 6);
    expect(lapping.state).toBe("flowing");
  });

  test("drowned, it lets out less the deeper it stands, and the sewer fills behind it", () => {
    const open = lets(0), half = lets(OUTFALL_CLEAR + DROWNED / 2), deep = lets(OUTFALL_CLEAR + DROWNED * 0.9);
    expect(half.out).toBeLessThan(open.out * 0.75);
    expect(deep.out).toBeLessThan(half.out * 0.5);
    expect(deep.held).toBeGreaterThan(open.held * 1.5);
  });

  test("under a slab of water it lets out nothing: the slop comes up at the manhole", () => {
    const shut = lets(OUTFALL_CLEAR + DROWNED);
    expect(shut.out).toBe(0);
    expect(shut.state).toBe("surcharged");
  });
});
