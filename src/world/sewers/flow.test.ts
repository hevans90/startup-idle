import { describe, expect, test } from "bun:test";

import { commit, createHistory } from "../edit/commands";
import { MAIN_BORE, MAIN_SEWER, SEWER_FIT, createGrid, fillTerrain, idx, setHeight, type Grid } from "../grid";
import { resetCooling } from "../projects/cooling";
import { stepSlop, tanksOf } from "../slop/tanks";
import { structureDef } from "../structures/def";
import { placeCommand, sewerInReach } from "../structures/place";
import { createWaterField, stepWater } from "../water/field";
import { layMain, mainReportAt, routeMain, runMains } from "../water/mains";
import { foulingIn } from "../water/pollution";
import { planLateral, planSewer, routeSewer } from "./lay";
import { lateralsOf, sewerFillAt, sewerReportsFor, slopInSewers, stepSewers, type SewerHooks } from "./flow";
import { lateralReach } from "./reach";
import { lateralStrokePlan, laysConnection, sewerStrokePlan } from "./tool";
import { pipeClick } from "../pipes/connect-points";
import { useWorldStore } from "../../state/world.store";
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
    expect(planLateral(g, [{ x: 12, y: 4 }, { x: 13, y: 4 }], wetOf(g))).toEqual({ refused: "End it at a manhole" });
    const far = Array.from({ length: 9 }, (_, k) => ({ x: 12 + k, y: 12 })).concat([{ x: 20, y: 6 }]);
    expect(planLateral(g, far, wetOf(g))).toHaveProperty("refused");
  });
});

describe("a lateral keeps off the roads", () => {
  /** The street, with a trunk whose manhole at (12, 9) is five tiles below the office's port at (12, 4). */
  function below() {
    const { g, a, field } = street();
    const route = routeSewer(g, { x: 3, y: 9 }, { x: 12, y: 9 }, wetOf(g))!;
    const p = planSewer(g, route, wetOf(g), { unit: 1, liftPrice: 1 });
    if ("refused" in p) throw new Error(p.refused);
    for (const c of p.cells) { const i = idx(g, c.x, c.y); g.sewer[i] = p.staged.sewer[i]; g.sewerFit[i] = p.staged.sewerFit[i]; }
    g.rev++;
    return { g, a, field };
  }
  const pave = (g: Grid, cells: [number, number][]) => { for (const [x, y] of cells) g.paved[idx(g, x, y)] = 1; g.rev++; };

  test("it goes round a street's end, and is refused whole where the street leaves no way", () => {
    const { g } = below();
    // A street along y = 7 from x = 9 to 15: the straight way down is across it.
    pave(g, Array.from({ length: 7 }, (_, k) => [9 + k, 7] as [number, number]));
    const straight = [4, 5, 6, 7, 8, 9].map((y) => ({ x: 12, y }));
    expect(planLateral(g, straight, wetOf(g))).toEqual({ refused: "A sewer connection can't cross a road" });
    // The router finds no way within reach it could then be laid by; what it finds is off the road.
    const round = routeMain(g, { x: 12, y: 4 }, { x: 12, y: 9 }, wetOf(g), true)!;
    expect(round.every((c) => g.paved[idx(g, c.x, c.y)] === 0)).toBe(true);
    expect(round.length).toBeGreaterThan(straight.length);
    expect(planLateral(g, round, wetOf(g))).toHaveProperty("refused");
    // Edge to edge, the street leaves no way round at all.
    pave(g, Array.from({ length: 24 }, (_, k) => [k, 7] as [number, number]));
    expect(routeMain(g, { x: 12, y: 4 }, { x: 12, y: 9 }, wetOf(g), true)).toBeNull();
  });

  test("the tool says why there is no way: a street across it, or an end in a road", () => {
    const { g } = below();
    pave(g, Array.from({ length: 24 }, (_, k) => [k, 7] as [number, number]));
    const stroke = (head: { x: number; y: number }) => ({ tool: "sewer" as const, brush: "line" as const, anchor: { x: 12, y: 4 }, head });
    expect(lateralStrokePlan(g, stroke({ x: 12, y: 9 }), wetOf(g))!.plan).toEqual({ refused: "A sewer connection can't cross a road" });
    expect(lateralStrokePlan(g, stroke({ x: 12, y: 7 }), wetOf(g))!.plan).toEqual({ refused: "A sewer connection can't end in a road: lay a trunk into the block" });
  });

  test("laid by clicks, a connection and a trunk run through the corners pinned", () => {
    const { g } = below();
    const pins = [{ x: 12, y: 4 }, { x: 14, y: 6 }];
    const lat = lateralStrokePlan(g, { tool: "sewer", brush: "line", lateral: true, anchor: pins[0], head: { x: 12, y: 9 }, pins }, wetOf(g))!;
    expect(lat.route!.some((c) => c.x === 14 && c.y === 6)).toBe(true);
    expect(lat.route!.at(-1)).toEqual({ x: 12, y: 9 });
    // Round by (14, 6) is seven tiles, past a connection's reach of six: said, not laid.
    expect("refused" in lat.plan ? lat.plan.refused : "").toMatch(/Longer than/);
    const trunkPins = [{ x: 3, y: 12 }, { x: 8, y: 11 }];
    const t = sewerStrokePlan(g, { tool: "sewer", brush: "line", anchor: trunkPins[0], head: { x: 16, y: 12 }, pins: trunkPins }, wetOf(g))!;
    expect("refused" in t).toBe(false);
    if (!("refused" in t)) expect(t.cells.some((c) => c.x === 8 && c.y === 11)).toBe(true);
  });

  test("a water main still crosses a road", () => {
    const { g } = below();
    pave(g, Array.from({ length: 24 }, (_, k) => [k, 7] as [number, number]));
    expect(routeMain(g, { x: 12, y: 5 }, { x: 12, y: 9 }, wetOf(g))).toHaveLength(5);
  });

  test("a manhole in a road can end no lateral, and counts for no building's reach", () => {
    const { g, a } = street();
    trunk(g);
    expect(lateralReach(g)[idx(g, 12, 4)]).toBe(2);
    // The trunk's own street, laid over it afterwards: its manhole at (12, 6) is now in the road.
    pave(g, Array.from({ length: 20 }, (_, k) => [4 + k, 6] as [number, number]));
    expect(planLateral(g, [{ x: 12, y: 4 }, { x: 12, y: 5 }, { x: 12, y: 6 }], wetOf(g))).toEqual({ refused: "A sewer connection can't cross a road" });
    expect(routeMain(g, { x: 12, y: 4 }, { x: 12, y: 6 }, wetOf(g), true)).toBeNull();
    expect(lateralReach(g)[idx(g, 12, 4)]).toBe(-1);
    expect(sewerInReach(g, structureDef(a.def)!, a.x, a.y)).toBe(false);
  });

  test("reach is by the route, not the distance: a manhole two tiles off across a street is out of reach", () => {
    const { g, a } = street();
    trunk(g);
    expect(sewerInReach(g, structureDef(a.def)!, a.x, a.y)).toBe(true);
    // A street along y = 5, edge to edge, between the port and the manhole.
    pave(g, Array.from({ length: 24 }, (_, k) => [k, 5] as [number, number]));
    expect(sewerInReach(g, structureDef(a.def)!, a.x, a.y)).toBe(false);
    // The far side of the street is still lit.
    expect(lateralReach(g)[idx(g, 12, 7)]).toBe(1);
  });

  test("an old save's lateral across a road still drains", () => {
    resetCooling();
    const { g, a, field } = street();
    trunk(g);
    lateral(g);
    pave(g, [[11, 5], [12, 5], [13, 5]]);
    const desks = new Map([[a.id, { used: 1 }]]);
    for (let k = 0; k < 120; k++) { runMains(field, g, 1); stepSlop(g, field, desks, 0.5, 1); }
    expect(tanksOf(g).get(a.id)!.level).toBeLessThan(1);
    expect(mainReportAt(g, 12, 5)?.state).toBe("flowing");
  });
});

describe("the Sewer tool works out what it is laying", () => {
  test("from a slop port, or onto one, a connection; anywhere else, a trunk — and no switch to set", () => {
    const { g } = street();
    trunk(g);
    const port = { x: 12, y: 4 }, manhole = { x: 12, y: 6 }, open = { x: 16, y: 10 };
    expect(laysConnection(g, port, manhole)).toBe(true);
    expect(laysConnection(g, manhole, port)).toBe(true);
    expect(laysConnection(g, manhole, open)).toBe(false);
    expect(laysConnection(g, open, { x: 20, y: 10 })).toBe(false);
    // On from a connection already laid is a connection too.
    lateral(g);
    expect(laysConnection(g, { x: 12, y: 5 }, open)).toBe(true);
  });

  test("the stroke says so as it moves: begun at a manhole it is a trunk, until it reaches a slop port", () => {
    const { g } = street();
    trunk(g);
    const s = () => useWorldStore.getState();
    s().loadGrid(g);
    s().setPlaying(true);
    s().setTool("sewer");
    s().beginStroke({ x: 12, y: 6 });
    expect(s().stroke!.lateral).toBeUndefined();
    s().updateStroke({ x: 12, y: 4 });
    expect(s().stroke!.lateral).toBe(true);
    s().updateStroke({ x: 16, y: 6 });
    expect(s().stroke!.lateral).toBeUndefined();
    s().cancelStroke();
    s().beginStroke({ x: 12, y: 4 });
    expect(s().stroke!.lateral).toBe(true);
    s().setPlaying(false);
  });

  test("a click on a trunk's middle selects it; on a manhole or its far end, a run starts; its card can add a manhole", () => {
    const { g } = street();
    trunk(g);
    expect(pipeClick(g, "sewer", { x: 8, y: 6 })).toBe("select");
    expect(pipeClick(g, "sewer", { x: 12, y: 6 })).toBe("start");
    expect(pipeClick(g, "sewer", { x: 16, y: 10 })).toBe("start");
    lateral(g);
    expect(pipeClick(g, "sewer", { x: 12, y: 5 })).toBe("select");
    const s = () => useWorldStore.getState();
    s().loadGrid(g);
    s().setPlaying(true);
    s().addManholeAt({ x: 8, y: 6 });
    expect(s().grid.sewerFit[idx(s().grid, 8, 6)]).toBe(SEWER_FIT.node);
    s().setPlaying(false);
  });
});

describe("slop through the sewers", () => {
  test("drains a workplace's tank down its lateral and the trunk, out of the outfall into the lake", () => {
    resetCooling();
    const { g, a, field } = street();
    trunk(g);
    lateral(g);
    const desks = new Map([[a.id, { used: 1 }]]);
    // The water runs too, as it does in the game: slop let out and never carried off would stand over the outfall and drown it.
    for (let k = 0; k < 120; k++) { runMains(field, g, 1); stepSlop(g, field, desks, 0.5, 1); stepWater(field, 1); }
    expect(tanksOf(g).get(a.id)!.level).toBeLessThan(1);
    expect(foulingIn(field)).toBeGreaterThan(0);
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
