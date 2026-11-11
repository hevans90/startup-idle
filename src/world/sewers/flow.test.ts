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
import { lateralsOf, sewerReportsFor, stepSewers, type SewerHooks } from "./flow";
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

  test("more than the trunk carries comes up at a manhole: it surcharges", () => {
    const { g, a } = street();
    trunk(g);
    lateral(g);
    // A wide lateral pours in twice what the flat trunk carries.
    for (let y = 4; y <= 6; y++) g.main[idx(g, 12, y)] |= MAIN_BORE;
    g.rev++;
    const h = hooks();
    stepSewers(g, new Map([[a.id, { level: 100 }]]), 1, h);
    const r = [...sewerReportsFor(g).values()][0];
    expect(r.state).toBe("surcharged");
    expect(r.trunk.spilled).toBeGreaterThan(0.5);
    // At a manhole, not mid-pipe.
    const s = solveSewers(g);
    expect(s.nets[0].nodes.some((n) => h.out.has(((n / g.w) | 0) * 100 + (n % g.w)))).toBe(true);
  });

  test("a backed-up manhole passes nothing on: everything comes up there", () => {
    const { g, a } = street();
    trunk(g);
    lateral(g);
    const node = idx(g, 12, 6);
    const h = hooks({ backedUp: node });
    stepSewers(g, new Map([[a.id, { level: 100 }]]), 1, h);
    expect(h.out.get(6 * 100 + 12)).toBeCloseTo(1);
    expect([...sewerReportsFor(g).values()][0].state).toBe("backed-up");
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
