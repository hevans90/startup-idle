import { describe, expect, test } from "bun:test";

import { DIR } from "../../iso/dir";
import { MAIN_MAX, PUMP_MOST, mainFlow, pumpLift } from "../../game/mains";
import { MAIN_BORE, MAIN_END, createGrid, edited, idx, type Grid } from "../grid";
import { pipeGraph } from "./graph";
import { emptyWater, fillOf, settledWater, steadyFlow, stepWater, waterHeld, waterModel, type WaterEnv } from "./hydraulics";

const SIDE_OF = (dx: number, dy: number) => (dx === -1 ? "N" : dx === 1 ? "S" : dy === -1 ? "E" : "W");
const BACK = { N: "S", S: "N", E: "W", W: "E" } as const;
function run(g: Grid, cells: [number, number][], flags = 0) {
  for (let k = 0; k < cells.length; k++) {
    const [x, y] = cells[k];
    g.main[idx(g, x, y)] |= flags;
    if (k === 0) continue;
    const [px, py] = cells[k - 1], side = SIDE_OF(x - px, y - py);
    g.main[idx(g, px, py)] |= DIR[side];
    g.main[idx(g, x, y)] |= DIR[BACK[side]];
  }
  edited(g);
}
const along = (x0: number, y0: number, x1: number, y1: number): [number, number][] => {
  const out: [number, number][] = [];
  for (let x = x0, y = y0; ; x += Math.sign(x1 - x0), y += Math.sign(y1 - y0)) { out.push([x, y]); if (x === x1 && y === y1) break; }
  return out;
};
const end = (g: Grid, x: number, y: number, what: number) => { g.mainEnd[idx(g, x, y)] = what; edited(g); };

/** One run of `tiles` tiles along y = 3, an intake at its west end and an outlet at its east. */
function straight(tiles: number, opts: { wide?: boolean; pump?: boolean } = {}) {
  const g = createGrid(tiles + 4, 8);
  run(g, along(1, 3, tiles, 3), opts.wide ? MAIN_BORE : 0);
  end(g, 1, 3, opts.pump ? MAIN_END.pump : MAIN_END.intake);
  end(g, tiles, 3, MAIN_END.outlet);
  return waterModel(pipeGraph(g), 0);
}
const env = (surface: (number | null)[], sills: number[], open = sills.map(() => true)): WaterEnv =>
  ({ surface, pumping: surface.map(() => true), sill: sills, open });
const total = (a: ArrayLike<number>) => Array.from(a).reduce((n, v) => n + v, 0);

describe("the steady flow, calibrated", () => {
  test("one run of twenty tiles carries what `mainFlow` says, at any head", () => {
    const m = straight(20);
    for (const head of [1, 2.5, 5, 8]) expect(steadyFlow(m, env([head], [0])).out[0]).toBeCloseTo(mainFlow(head, 20), 6);
  });

  test("a widened run carries twice as much; a pump moves no more than it moves", () => {
    expect(steadyFlow(straight(20, { wide: true }), env([5], [0])).out[0]).toBeCloseTo(2 * mainFlow(5, 20), 6);
    // Water four half steps under the floor, lifted eight: the pump's most, not what the head would carry.
    const pumped = steadyFlow(straight(20, { pump: true }), env([-4], [0]));
    expect(mainFlow(-4 + pumpLift(), 20)).toBeGreaterThan(PUMP_MOST);
    expect(pumped.out[0]).toBeCloseTo(PUMP_MOST, 6);
    expect(pumped.pumped[0]).toBe(true);
    // The same pump unpaid is an intake under the floor: nothing.
    expect(steadyFlow(straight(20, { pump: true }), { ...env([-4], [0]), pumping: [false] }).out[0]).toBe(0);
  });

  test("other lengths are near it: within a tenth from five tiles to forty, and never more than a main's most", () => {
    for (const tiles of [5, 10, 30, 40]) {
      const q = steadyFlow(straight(tiles), env([5], [0])).out[0];
      expect(Math.abs(q / mainFlow(5, tiles) - 1)).toBeLessThan(0.1);
    }
    expect(steadyFlow(straight(3), env([200], [0])).out[0]).toBe(MAIN_MAX);
  });

  test("no water, no head, or nothing taking it: no flow", () => {
    const m = straight(20);
    expect(total(steadyFlow(m, env([null], [0])).out)).toBe(0);
    expect(total(steadyFlow(m, env([-1], [0])).out)).toBe(0);
    expect(total(steadyFlow(m, env([5], [0], [false])).out)).toBe(0);
  });
});

/** The twenty-tile run, with a second outlet on a ten-tile branch off its sixteenth tile. */
function branched() {
  const g = createGrid(26, 16);
  run(g, along(1, 3, 20, 3));
  end(g, 1, 3, MAIN_END.intake);
  end(g, 20, 3, MAIN_END.outlet);
  run(g, along(16, 3, 16, 13));
  end(g, 16, 13, MAIN_END.outlet);
  const graph = pipeGraph(g), m = waterModel(graph, 0);
  // Which outlet is the one at the run's end.
  const first = m.outlets.findIndex((o) => o.cell === idx(g, 20, 3));
  return { g, m, first };
}

describe("what the one formula had wrong, put right", () => {
  test("a shared trunk's water is shared: two outlets bring more than one and well under twice", () => {
    const one = steadyFlow(straight(20), env([5], [0])).out[0];
    const { m } = branched();
    const two = steadyFlow(m, env([5], [0, 0]));
    expect(total(two.out)).toBeGreaterThan(one * 1.05);
    expect(total(two.out)).toBeLessThan(one * 1.5);
    // What comes in is what goes out.
    expect(total(two.in)).toBeCloseTo(total(two.out), 8);
  });

  test("a dead-end stub costs nothing", () => {
    const one = steadyFlow(straight(20), env([5], [0])).out[0];
    const g = createGrid(26, 16);
    run(g, along(1, 3, 20, 3));
    end(g, 1, 3, MAIN_END.intake);
    end(g, 20, 3, MAIN_END.outlet);
    run(g, along(10, 3, 10, 12));
    end(g, 10, 12, MAIN_END.cap);
    expect(steadyFlow(waterModel(pipeGraph(g), 0), env([5], [0])).out[0]).toBeCloseTo(one, 8);
  });

  test("a near outlet is fed faster than a far one; shut the near one and the far one gets the run to itself", () => {
    const { m, first } = branched();
    const both = steadyFlow(m, env([5], [0, 0]));
    // The run's end is four tiles past the branch; the branch's end is ten.
    expect(both.out[first]).toBeGreaterThan(both.out[1 - first] * 1.1);
    const open = [false, false];
    open[first] = true;
    expect(steadyFlow(m, env([5], [0, 0], open)).out[first]).toBeCloseTo(mainFlow(5, 20), 6);
  });

  test("a higher building takes less of a shared trunk, and none once the water stands under its floor", () => {
    const { m, first } = branched();
    const sills = [0, 0];
    sills[first] = 1;
    const up = steadyFlow(m, env([5], sills));
    expect(up.out[first]).toBeGreaterThan(0);
    expect(up.out[first]).toBeLessThan(up.out[1 - first]);
    sills[first] = 6;
    expect(steadyFlow(m, env([5], sills)).out[first]).toBe(0);
  });
});

describe("water moving through it", () => {
  /** Run a system for `seconds` at 60 frames a second, out of a lake with no bottom into tanks with no top. */
  function play(m: ReturnType<typeof straight>, e: WaterEnv, seconds: number, st = emptyWater(m)) {
    let taken = 0, given = 0, last = 0;
    const filled: number[] = [];
    for (let f = 0; f < seconds * 60; f++) {
      const r = stepWater(m, st, e, 1 / 60, (_, a) => { taken += a; return a; }, (_, a) => { given += a; return a; });
      last = total(r.out) * 60;
      if (filled.length === 0 && m.nodes.every((_, i) => m.intakeAt[i] >= 0 || fillOf(m, st, i) >= 0.999)) filled.push(f / 60);
    }
    return { st, taken, given, last, fullAt: filled[0] ?? Infinity };
  }

  test("an empty main fills, a front at a time, and then carries its steady flow", () => {
    const m = straight(20), e = env([5], [0]);
    const st = emptyWater(m);
    const early = play(m, e, 0.5, st);
    // Half a second in: water at the intake's end, none yet at the far one, nothing delivered.
    const near = m.nodes.findIndex((_, i) => m.intakeAt[i] < 0 && m.links.some((l) => (m.intakeAt[l.a] >= 0 && l.b === i) || (m.intakeAt[l.b] >= 0 && l.a === i)));
    expect(fillOf(m, st, near)).toBeGreaterThan(0.2);
    expect(fillOf(m, st, m.outlets[0].node)).toBeLessThan(0.05);
    expect(early.given).toBe(0);
    const later = play(m, e, 12, st);
    expect(Math.abs(later.last / steadyFlow(m, e).out[0] - 1)).toBeLessThan(0.05);
  });

  test("twenty tiles are full in under three seconds, and sixty in under ten", () => {
    expect(play(straight(20), env([5], [0]), 5).fullAt).toBeLessThan(3);
    expect(play(straight(20), env([5], [0]), 5).fullAt).toBeGreaterThan(0.5);
    expect(play(straight(60), env([5], [0]), 14).fullAt).toBeLessThan(10);
  });

  test("no water is made or lost: what was drawn is what was given and what the pipe holds", () => {
    for (const make of [() => straight(20), () => branched().m]) {
      const m = make(), e = env([5], m.outlets.map(() => 0));
      const r = play(m, e, 8);
      expect(r.taken - r.given - waterHeld(r.st)).toBeCloseTo(0, 6);
    }
  });

  test("a main settled is at its steady flow from the first frame: no dry spell after a load", () => {
    const { m } = branched();
    const e = env([5], [0, 0]);
    const steady = total(steadyFlow(m, e).out);
    const r = play(m, e, 0.5, settledWater(m, e));
    expect(Math.abs(r.last / steady - 1)).toBeLessThan(0.05);
    expect(Math.abs(r.given / (steady * 0.5) - 1)).toBeLessThan(0.05);
  });

  test("with every tank full it stands under pressure and draws nothing; opened, it flows at once", () => {
    const m = straight(20);
    const shut = env([5], [0], [false]);
    const st = settledWater(m, env([5], [0]));
    const idle = play(m, shut, 6, st);
    expect(idle.given).toBe(0);
    // Only what it takes to bring the pipe up to the lake's pressure, and then nothing.
    expect(idle.taken).toBeLessThan(1.5);
    expect(play(m, shut, 2, st).taken).toBeLessThan(1e-3);
    expect(play(m, env([5], [0]), 1, st).given).toBeGreaterThan(0.5);
  });

  test("its intake gone dry, what is in the pipe runs out and then nothing comes", () => {
    const m = straight(20), st = settledWater(m, env([5], [0]));
    const held = waterHeld(st);
    const r = play(m, env([null], [0]), 20, st);
    expect(r.taken).toBe(0);
    expect(r.given).toBeLessThanOrEqual(held + 1e-9);
    expect(r.last).toBeLessThan(0.01);
  });
});
