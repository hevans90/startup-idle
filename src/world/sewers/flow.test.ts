import { describe, expect, test } from "bun:test";

import { commit, createHistory } from "../edit/commands";
import { MAIN_BORE, MAIN_SEWER, createGrid, fillTerrain, idx, setHeight, type Grid } from "../grid";
import { resetCooling } from "../projects/cooling";
import { stepSlop, tanksOf } from "../slop/tanks";
import { structureDef } from "../structures/def";
import { placeCommand } from "../structures/place";
import { createWaterField } from "../water/field";
import { layMain, mainReportAt, runMains } from "../water/mains";
import { pollutionOf } from "../water/pollution";
import { planLateral, planSewer, routeSewer } from "./lay";
import { lateralsOf, sewerFillAt, sewerReportsFor, slopInSewers, stepSewers, type SewerHooks } from "./flow";
import { solveSewers } from "./solve";

/** A lake down the west edge, ground at 2 (or `ground(x)`), and a vibe office whose slop port is at (12, 4). */
function street(ground: (x: number) => number = () => 2) {
  const g = createGrid(24, 14);
  fillTerrain(g, 1);
  for (let y = 0; y < 14; y++) for (let x = 0; x < 24; x++) setHeight(g, x, y, x <= 3 ? -2 : ground(x));
  for (let y = 0; y < 14; y++) for (let x = 0; x <= 3; x++) g.pool[idx(g, x, y)] = 4;
  commit(g, createHistory(), placeCommand(g, { ...structureDef("office-vibe")!, placement: undefined }, 10, 3)!);
  const a = [...g.structures.values()].find((s) => s.def === "office-vibe")!;
  return { g, a, field: createWaterField(g) };
}
const wetOf = (g: Grid) => (x: number, y: number) => g.pool[idx(g, x, y)] > 0;

/** A trunk from the lake to (12, 6), laid. */
function trunk(g: Grid) {
  const route = routeSewer(g, { x: 3, y: 6 }, { x: 12, y: 6 }, wetOf(g))!;
  const p = planSewer(g, route, wetOf(g), { unit: 1, liftPrice: 1 });
  if ("refused" in p) throw new Error(p.refused);
  for (const c of p.cells) { const i = idx(g, c.x, c.y); g.sewer[i] = p.staged.sewer[i]; g.sewerFit[i] = p.staged.sewerFit[i]; }
  g.rev++;
  return p;
}
/** A lateral from the office's port to the manhole at (12, 6), laid. */
function lateral(g: Grid) {
  const p = planLateral(g, [{ x: 12, y: 4 }, { x: 12, y: 5 }, { x: 12, y: 6 }], wetOf(g));
  if ("refused" in p) throw new Error(p.refused);
  layMain(g, p.cells, true);
  return p;
}
const hooks = (o: Partial<SewerHooks> = {}): SewerHooks & { out: Map<number, number> } => {
  const out = new Map<number, number>();
  return {
    pay: () => true, room: () => 0, take: () => {}, backedUp: null,
    release: (x, y, n) => out.set(y * 100 + x, (out.get(y * 100 + x) ?? 0) + n),
    ...o, out,
  };
};

describe("a lateral", () => {
  test("runs from a workplace's slop port into a manhole, and drains that workplace", () => {
    const { g, a } = street();
    trunk(g);
    const p = lateral(g);
    expect(p.sources).toEqual([a.id]);
    expect(p.exit).toBe(true);
    expect(lateralsOf(g)[0]).toMatchObject({ sources: [a.id], node: idx(g, 12, 6) });
  });

  test("is refused without a manhole at an end, or past its reach", () => {
    const { g } = street();
    trunk(g);
    expect(planLateral(g, [{ x: 12, y: 4 }, { x: 13, y: 4 }], wetOf(g))).toEqual({ refused: "End it at a sewer node" });
    const far = Array.from({ length: 9 }, (_, k) => ({ x: 12 + k, y: 12 })).concat([{ x: 20, y: 6 }]);
    expect(planLateral(g, far, wetOf(g))).toHaveProperty("refused");
  });
});

describe("slop through the sewers", () => {
  test("drains a workplace's tank down its lateral and the trunk, out of the outfall into the lake", () => {
    resetCooling();
    const { g, a, field } = street();
    trunk(g);
    lateral(g);
    const desks = new Map([[a.id, { used: 1 }]]);
    for (let k = 0; k < 120; k++) { runMains(field, g, 1); stepSlop(g, field, desks, 0.5, 1); }
    expect(tanksOf(g).get(a.id)!.level).toBeLessThan(1);
    expect(pollutionOf(field.columns).mass.reduce((n, m) => n + m, 0)).toBeGreaterThan(0);
    expect([...sewerReportsFor(g).values()][0].state).toBe("flowing");
    expect(mainReportAt(g, 12, 5)?.state).toBe("flowing");
    // ONE REPORT TYPE: the trunk says what a main does — what it carries, could carry, its length and bore — and its own beside. @see PipeReport
    const r = [...sewerReportsFor(g).values()][0];
    expect(r.flow).toBe(r.trunk.delivered);
    expect(r.flow).toBeGreaterThan(0);
    expect(r.capacity).toBeGreaterThanOrEqual(r.flow);
    expect([r.length, r.bore]).toEqual([solveSewers(g).nets[0].cells.length, 1]);
  });

  test("a sewer beside a port no longer joins it by itself: without a lateral the tank fills and spills", () => {
    resetCooling();
    const { g, a, field } = street();
    trunk(g);
    const desks = new Map([[a.id, { used: 1 }]]);
    for (let k = 0; k < 400; k++) { runMains(field, g, 1); stepSlop(g, field, desks, 1, 1); }
    expect(tanksOf(g).get(a.id)!.spilling).toBe(true);
    expect(g.main.some((m) => m & MAIN_SEWER)).toBe(false);
  });

  test("more than the trunk carries comes up at a manhole — once its pipe and its shaft are full", () => {
    const { g, a } = street();
    trunk(g);
    lateral(g);
    // A wide lateral pours in twice what the flat trunk carries.
    for (let y = 4; y <= 6; y++) g.main[idx(g, 12, y)] |= MAIN_BORE;
    g.rev++;
    const h = hooks(), tank = { level: 100 };
    const step = () => { stepSewers(g, new Map([[a.id, tank]]), 0.25, h); return [...sewerReportsFor(g).values()][0]; };
    // Not at once: the first of it goes into the pipe.
    const first = step();
    expect(first.state).toBe("flowing");
    expect(first.trunk.spilled).toBe(0);
    let r = step();
    for (let k = 0; k < 40; k++) r = step();
    expect(r.state).toBe("surcharged");
    // Two a second in, one a second on down the trunk, the other up in the street.
    expect(r.trunk.inflow).toBeCloseTo(2, 5);
    expect(r.trunk.spilled).toBeCloseTo(1, 1);
    expect(r.trunk.delivered).toBeCloseTo(1, 1);
    // At a manhole, not mid-pipe.
    const s = solveSewers(g);
    const spilt = [...h.out.keys()].filter((k) => !s.nets[0].exits.some((e) => ((e / g.w) | 0) * 100 + (e % g.w) === k));
    expect(spilt.length).toBeGreaterThan(0);
    expect(spilt.every((k) => s.nets[0].nodes.some((n) => ((n / g.w) | 0) * 100 + (n % g.w) === k))).toBe(true);
    // None made or lost: what left the tank is in the pipe, out of the outfall, or up in the street.
    expect(100 - tank.level).toBeCloseTo(slopInSewers(g) + [...h.out.values()].reduce((n, v) => n + v, 0), 9);
  });

  test("a sewer stands as full as it is loaded, and slop takes a moment to come down it", () => {
    const { g, a } = street();
    trunk(g);
    lateral(g);
    const h = hooks(), tank = { level: 100 };
    const step = () => { stepSewers(g, new Map([[a.id, tank]]), 1 / 30, h); return [...sewerReportsFor(g).values()][0]; };
    // The first frames: slop in at the manhole, none yet at the outfall.
    expect(step().trunk.delivered).toBe(0);
    expect(sewerFillAt(g, idx(g, 12, 6))).toBeGreaterThan(0);
    let r = step();
    for (let k = 0; k < 30 * 20; k++) r = step();
    // Settled: all of it through, nothing up in the street, the pipe part full.
    expect(r.state).toBe("flowing");
    expect(r.trunk.delivered).toBeCloseTo(r.trunk.inflow, 2);
    expect(r.trunk.spilled).toBe(0);
    const fill = sewerFillAt(g, idx(g, 12, 6))!;
    expect(fill).toBeGreaterThan(0.2);
    expect(fill).toBeLessThanOrEqual(1);
  });

  test("a backed-up manhole passes nothing on: it fills, and then everything comes up there", () => {
    const { g, a } = street();
    trunk(g);
    lateral(g);
    const node = idx(g, 12, 6);
    const h = hooks({ backedUp: node }), tank = { level: 100 };
    let r = [...sewerReportsFor(g).values()][0];
    for (let k = 0; k < 20; k++) { stepSewers(g, new Map([[a.id, tank]]), 0.25, h); r = [...sewerReportsFor(g).values()][0]; }
    expect(r.state).toBe("backed-up");
    expect(r.trunk.spilled).toBeCloseTo(1, 5);
    expect(r.trunk.delivered).toBe(0);
    // All of it at that manhole, less what its pipe and shaft hold.
    expect([...h.out.keys()]).toEqual([6 * 100 + 12]);
    expect(h.out.get(6 * 100 + 12)! + slopInSewers(g)).toBeCloseTo(100 - tank.level, 9);
  });

  test("an unpaid lift station stops, and the slop comes up behind it", () => {
    // A hill in the way, too high to dig through.
    const { g, a } = street((x) => (x >= 6 && x <= 8 ? 9 : 2));
    trunk(g);
    lateral(g);
    const paid = hooks({ room: () => 0 });
    stepSewers(g, new Map([[a.id, { level: 100 }]]), 1, paid);
    expect([...sewerReportsFor(g).values()][0].trunk.lifts.length).toBe(1);
    expect([...sewerReportsFor(g).values()][0].state).toBe("flowing");
    const unpaid = hooks({ pay: () => false });
    stepSewers(g, new Map([[a.id, { level: 100 }]]), 1, unpaid);
    expect([...sewerReportsFor(g).values()][0].state).toBe("unpaid");
  });
});
